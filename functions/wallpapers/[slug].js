/* ══════════════════════════════════════════════════════════════
   /wallpapers/:slug —— 详情页「静态优先，D1 兜底」
   ──────────────────────────────────────────────────────────────
   为什么这么做
   · 现有 89 张详情页是 Hugo 构建出来的静态文件，访问最快、SEO 最好，
     不应该为了「动态」把它们改成实时渲染（那是净损失）。
   · 但壁纸元数据搬到 D1 之后，D1 里可能有静态产物还没有的条目
     （图片先上、页面等下次构建）。这类 slug 静态资源是 404，
     由本函数用 /wpshell/ 这份外壳页 + D1 数据现场拼出来。

   所以顺序是：静态命中就直接返回（零回归）→ 未命中才查 D1 → 还没有就原样 404。

   外壳页 /wpshell/ 由 Hugo 用同一个 wpdetail.html 布局渲染，页头页脚、
   CSP、脚本引用全部和真页面一致；本函数只做「整串替换」，
   不重复实现任何布局，避免两份模板漂移。

   注意：本函数要被调用，/wallpapers/* 必须出现在 static/_routes.json 的 include 里。
   ══════════════════════════════════════════════════════════════ */

import { readWallpaper } from "../_lib/wallpapers.js";

const SLUG_RE = /^wp-[a-z0-9][a-z0-9-]{1,40}$/;
const SHELL_PATH = "/wpshell/";
const MAX_SHELL_BYTES = 512 * 1024;

/* ⚠️ Pages 的 static/_headers 只对静态资源生效，Functions 返回的响应不会自动带上，
   所以这几个头必须在这里再写一遍，否则动态渲染出来的详情页是「无 CSP」状态。
   与 static/_headers 的一致性由 _build_check 断言（两处 CSP 必须逐字符相同）。 */
const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
    "img-src 'self' data: blob:; font-src 'self'; " +
    "connect-src 'self' https://wow-blog.app.workbuddy.host https://wow-d9s.pages.dev; " +
    "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; " +
    "frame-ancestors 'none'; upgrade-insecure-requests",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin"
};

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* 标签渲染成与静态页同构的 span 序列（CSP 是 style-src 'self'，这里不加任何内联样式） */
function tagSpans(tags) {
  return (tags || [])
    .slice(0, 8)
    .map(function (t) { return '<span class="wp-tag">' + esc(t) + "</span>"; })
    .join("");
}

function render(shell, row, slug) {
  const desc = "高清壁纸（" + (row.tags || []).join(" / ") + "），原始尺寸 " +
    row.w + " × " + row.h + " 像素，可下载 JPG 格式。";

  let html = shell;

  /* 外壳页的自身地址 → 目标详情页地址：canonical / og:url / 面包屑一并跟着换 */
  html = html.split(SHELL_PATH).join("/wallpapers/" + slug + "/");

  /* 外壳页是内部页面，必须 noindex；渲染出来的却是正经详情页，要放回可索引 */
  html = html.replace(
    /<meta name="robots" content="noindex, nofollow">/,
    '<meta name="robots" content="index, follow">'
  );

  const map = {
    __WP_SLUG__: slug,
    __WP_TITLE__: "壁纸 " + slug,
    __WP_DESC__: desc,
    __WP_FULL__: row.full,
    __WP_THUMB__: row.thumb,
    __WP_ORIG__: row.orig || "",
    __WP_KB__: String(row.kb || 0),
    __WP_W__: String(row.w),
    __WP_H__: String(row.h),
    __WP_COLOR__: row.color || "",
    __WP_ADDED__: row.added || ""
  };
  Object.keys(map).forEach(function (k) {
    html = html.split(k).join(esc(map[k]));
  });

  /* 标签块：外壳页留了一个空占位元素，这里换成真正的 span 序列。
     用元素而不是 HTML 注释，是因为 Go 的 html/template 会把注释吞掉。 */
  html = html.split('<span class="wp-tag" data-wp-tag-slot></span>').join(tagSpans(row.tags));

  /* 顶部 alt 用的是 tags 拼接串，单独替换 */
  html = html.split("__WP_TAGS__").join((row.tags || []).join(" ") || "壁纸");

  return html;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  /* 只接管页面 GET；其余方法交回静态层（静态层会给 405/404） */
  if (request.method !== "GET" && request.method !== "HEAD") {
    return env.ASSETS.fetch(request);
  }

  const slug = String((params && params.slug) || "").toLowerCase();

  /* 1) 静态优先：已有构建产物的页面原样返回，不加任何一层加工 */
  const assetRes = await env.ASSETS.fetch(request);
  if (assetRes.status === 200) return assetRes;

  /* 2) 静态没有 → 查 D1；没绑定或 slug 形态不对，直接给回 404 */
  if (!env.DB || !SLUG_RE.test(slug)) return assetRes;

  let row = null;
  try {
    row = await readWallpaper(env, slug);
  } catch (e) {
    console.error("wp detail fallback error", e && e.stack ? e.stack : e);
    return assetRes;
  }
  if (!row) return assetRes;

  /* 3) 取外壳页。取不到就退回 404，宁可少一页也不吐半截 HTML */
  let shellRes;
  try {
    shellRes = await env.ASSETS.fetch(
      new Request(new URL(SHELL_PATH, url.origin).toString(), { method: "GET" })
    );
  } catch (e) {
    console.error("wp shell fetch error", e && e.stack ? e.stack : e);
    return assetRes;
  }
  if (shellRes.status !== 200) return assetRes;

  const shell = await shellRes.text();
  if (!shell || shell.length > MAX_SHELL_BYTES) return assetRes;

  const html = render(shell, row, slug);
  const headers = Object.assign({}, SECURITY_HEADERS, {
    "content-type": "text/html; charset=utf-8",
    /* 与站内其它 HTML 一致：浏览器每次协商，边缘缓存十分钟 */
    "cache-control": "public, max-age=0, s-maxage=600",
    "x-content-type-options": "nosniff"
  });
  return new Response(html, { status: 200, headers: headers });
}
