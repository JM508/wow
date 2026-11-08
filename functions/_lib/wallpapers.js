/* ══════════════════════════════════════════════════════════════
   壁纸元数据 —— D1 版（2026-11-08）
   ──────────────────────────────────────────────────────────────
   背景：此前图片清单靠 Python 脚本写进 data/wallpapers.yaml，
   改一个标签、调一下顺序都要重跑构建 + 重发部署。这里把元数据挪到
   D1，页面运行时直接读，内容改动不再等构建。

   对外契约
     GET /api/wallpapers            全部上架壁纸（含 version，供前端比对）
     GET /api/wallpapers?tag=游戏   按标签过滤
     GET /api/wallpapers/<slug>     单张（详情页兜底渲染用）

   排序：横屏在前、竖屏在后，各自按 sort_order 升序（与静态快照一致）。

   缓存：列表里是公开内容，允许边缘缓存 60 秒；version 变了 ETag 就变，
   前端拿到 200 与新的 version 才会重建网格，平时只花一次条件请求。
   ══════════════════════════════════════════════════════════════ */

import { fail, corsHeaders } from "./http.js";

const MAX_LIMIT = 500;
const SLUG_RE = /^wp-[a-z0-9][a-z0-9-]{1,40}$/;

/* 只取展示需要的列：设备号、内部 id 之类一概不出库 */
const COLS =
  "slug, added, w, h, ratio, color, kb, kb_thumb, thumb, full, orig, tags, sort_order";

function parseTags(raw) {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) {
      return v.map(function (t) { return String(t); }).filter(Boolean).slice(0, 8);
    }
  } catch (e) { /* 脏数据当无标签，不让整页挂掉 */ }
  return [];
}

function toRow(r) {
  return {
    slug: r.slug,
    added: r.added || "",
    w: Number(r.w),
    h: Number(r.h),
    ratio: Number(r.ratio),
    color: r.color || "",
    kb: Number(r.kb || 0),
    kb_thumb: Number(r.kb_thumb || 0),
    thumb: r.thumb,
    full: r.full,
    orig: r.orig || "",
    tags: parseTags(r.tags)
  };
}

/* 版本号：条数 + 最近更新时间。
   条数变了（上架/下架）或任何一行被改，version 都会变，前端据此决定要不要重绘。 */
async function currentVersion(env) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS m FROM wallpapers WHERE status = 'live'"
  ).first();
  const n = r && r.n != null ? Number(r.n) : 0;
  const m = (r && r.m) || "";
  return n + "." + m;
}

/* 公开内容：允许浏览器 30 秒、边缘 60 秒缓存；带 ETag 让重复访问走 304 */
function cachedJson(request, data, etag) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
    "etag": '"' + etag + '"',
    "x-content-type-options": "nosniff"
  };
  const cors = corsHeaders(request, "GET");
  Object.keys(cors).forEach(function (k) { headers[k] = cors[k]; });

  /* 弱比较：CF 压缩响应时会把 ETag 改写成 W/"..."，浏览器回传的就是带 W/ 的形式。
     RFC 7232 对 If-None-Match 要求弱比较，所以比较前先去掉 W/ 前缀。 */
  const inm = String(request.headers.get("If-None-Match") || "")
    .trim()
    .replace(/^W\//i, "");
  if (inm && inm === headers.etag) {
    return new Response(null, { status: 304, headers: headers });
  }
  return new Response(JSON.stringify(data), { status: 200, headers: headers });
}

/* ═══════════ 读：列表 ═══════════ */

async function listAll(env, url) {
  const tag = String(url.searchParams.get("tag") || "").trim().slice(0, 16);
  const version = await currentVersion(env);

  /* 排序与静态快照同一口径：横屏（ratio >= 1）在前，组内按 sort_order */
  const res = await env.DB.prepare(
    "SELECT " + COLS + " FROM wallpapers WHERE status = 'live'" +
    " ORDER BY (ratio >= 1.0) DESC, sort_order ASC, slug ASC" +
    " LIMIT ?1"
  ).bind(MAX_LIMIT).all();

  let rows = ((res && res.results) || []).map(toRow);
  if (tag) {
    rows = rows.filter(function (r) { return r.tags.indexOf(tag) >= 0; });
  }

  return {
    body: { version: version, count: rows.length, tag: tag || null, rows: rows },
    version: version
  };
}

/* ═══════════ 读：单张 ═══════════ */

async function getOne(env, slug) {
  const row = await env.DB.prepare(
    "SELECT " + COLS + ", status, updated_at FROM wallpapers WHERE slug = ?1"
  ).bind(slug).first();
  if (!row || row.status !== "live") return null;
  const out = toRow(row);
  out.updated_at = row.updated_at;
  return out;
}

/* ═══════════ 入口 ═══════════ */

export async function handleWallpaperList(context) {
  const { request, env } = context;
  if (!env || !env.DB) {
    return fail(request, 503, "d1_unavailable", "D1 尚未绑定，本接口暂不可用");
  }
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return fail(request, 405, "method_not_allowed", "只支持 GET");
  }
  try {
    const got = await listAll(env, new URL(request.url));
    return cachedJson(request, got.body, got.version);
  } catch (e) {
    console.error("wallpapers list error", e && e.stack ? e.stack : e);
    return fail(request, 500, "internal_error", "读取壁纸清单失败，请稍后重试");
  }
}

export async function handleWallpaperOne(context) {
  const { request, env, params } = context;
  if (!env || !env.DB) {
    return fail(request, 503, "d1_unavailable", "D1 尚未绑定，本接口暂不可用");
  }
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return fail(request, 405, "method_not_allowed", "只支持 GET");
  }
  const slug = String((params && params.slug) || "").toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return fail(request, 400, "invalid_slug", "slug 形态应为 wp-01 这类");
  }
  try {
    const row = await getOne(env, slug);
    if (!row) return fail(request, 404, "not_found", "没有这张壁纸");
    return cachedJson(request, { row: row }, row.updated_at || slug);
  } catch (e) {
    console.error("wallpapers one error", e && e.stack ? e.stack : e);
    return fail(request, 500, "internal_error", "读取壁纸失败，请稍后重试");
  }
}

export { getOne as readWallpaper };
