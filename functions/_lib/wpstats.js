/* ══════════════════════════════════════════════════════════════
   壁纸下载量 / 收藏量 —— 全站统计（2026-11-15）
   ──────────────────────────────────────────────────────────────
   此前这两个数字存在 localStorage，只反映本机行为：换设备归零、
   详情页还得写「仅你可见」。现在改成 D1 累计，全站一个数。

   对外契约
     GET  /api/wallpapers/stats?slug=wp-01   单张计数（详情页用）
     GET  /api/wallpapers/stats              全部计数（运维自查）
     POST /api/wallpapers/stats              记一次行为，返回最新计数
          body: { slug: "wp-01", action: "download" | "fav" | "unfav", device: "<随机串>" }

   去重口径（防刷、也防同一个人刷新页面把数字刷上去）
     · 下载：同一 who + 同一张 + 同一天，只算一次
     · 收藏：同一 who + 同一张，只算一次；取消收藏删行并减一
     · who = sha256(客户端 IP + 设备号) 的前 16 位十六进制。
       IP 与设备号本身不入库，只留不可逆短哈希。

   写操作必须 live 壁纸才受理（下架的图不计入），slug 走白名单正则。
   ══════════════════════════════════════════════════════════════ */

import { fail, json } from "./http.js";

const SLUG_RE = /^wp-[a-z0-9][a-z0-9-]{1,40}$/;
const DEVICE_RE = /^[a-z0-9]{6,40}$/;
const ACTIONS = ["download", "fav", "unfav"];
const MAX_BODY = 1024;

/* 每条语句都带 no-store：计数字随时在变，缓存住就成假数据了 */
const WRITE_OPTS = { write: true };

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function whoOf(request, device) {
  const ip = request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "";
  const extra = device && DEVICE_RE.test(device)
    ? device
    : (request.headers.get("user-agent") || "").slice(0, 120);
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ip + "|" + extra)
  );
  return Array.from(new Uint8Array(buf))
    .slice(0, 8)
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");
}

/* 只给上架中的壁纸计数；不存在/已下架的一律不受理 */
async function isLive(env, slug) {
  const r = await env.DB.prepare(
    "SELECT slug FROM wallpapers WHERE slug = ?1 AND status = 'live'"
  ).bind(slug).first();
  return !!r;
}

async function readOne(env, slug) {
  const r = await env.DB.prepare(
    "SELECT downloads, favs FROM wp_stats WHERE slug = ?1"
  ).bind(slug).first();
  return {
    slug: slug,
    downloads: r ? Number(r.downloads) || 0 : 0,
    favs: r ? Number(r.favs) || 0 : 0
  };
}

/* 「已记录过」= 去重表这次真的插入了行；D1 的 run() 用 meta.changes 回这个 */
function changed(res) {
  return !!(res && res.meta && Number(res.meta.changes) > 0);
}

async function bumpDownloads(env, slug, who) {
  const ins = await env.DB.prepare(
    "INSERT OR IGNORE INTO wp_dl_events (slug, who, day) VALUES (?1, ?2, ?3)"
  ).bind(slug, who, today()).run();
  if (!changed(ins)) return false;
  await env.DB.prepare(
    "INSERT INTO wp_stats (slug, downloads, favs, updated_at) VALUES (?1, 1, 0, ?2)" +
    " ON CONFLICT(slug) DO UPDATE SET downloads = downloads + 1, updated_at = ?2"
  ).bind(slug, new Date().toISOString()).run();
  return true;
}

async function bumpFavs(env, slug, who, add) {
  const now = new Date().toISOString();
  if (add) {
    const ins = await env.DB.prepare(
      "INSERT OR IGNORE INTO wp_fav_events (slug, who) VALUES (?1, ?2)"
    ).bind(slug, who).run();
    if (!changed(ins)) return false;
    await env.DB.prepare(
      "INSERT INTO wp_stats (slug, downloads, favs, updated_at) VALUES (?1, 0, 1, ?2)" +
      " ON CONFLICT(slug) DO UPDATE SET favs = favs + 1, updated_at = ?2"
    ).bind(slug, now).run();
    return true;
  }
  const del = await env.DB.prepare(
    "DELETE FROM wp_fav_events WHERE slug = ?1 AND who = ?2"
  ).bind(slug, who).run();
  if (!changed(del)) return false;
  /* 计数减到 0 就停，避免历史偏差把数字做成负数 */
  await env.DB.prepare(
    "UPDATE wp_stats SET favs = CASE WHEN favs > 0 THEN favs - 1 ELSE 0 END, updated_at = ?2" +
    " WHERE slug = ?1"
  ).bind(slug, now).run();
  return true;
}

async function listAll(env) {
  const res = await env.DB.prepare(
    "SELECT slug, downloads, favs FROM wp_stats ORDER BY downloads DESC, favs DESC, slug ASC"
  ).all();
  const rows = ((res && res.results) || []).map(function (r) {
    return {
      slug: r.slug,
      downloads: Number(r.downloads) || 0,
      favs: Number(r.favs) || 0
    };
  });
  return { count: rows.length, rows: rows };
}

async function handleGet(context, url) {
  const { request, env } = context;
  const slug = String(url.searchParams.get("slug") || "").toLowerCase().trim();
  if (!slug) {
    return json(request, await listAll(env), 200);
  }
  if (!SLUG_RE.test(slug)) {
    return fail(request, 400, "invalid_slug", "slug 形态应为 wp-01 这类");
  }
  const row = await readOne(env, slug);
  return json(request, row, 200);
}

async function handlePost(context) {
  const { request, env } = context;
  const raw = await request.text();
  if (!raw || raw.length > MAX_BODY) {
    return fail(request, 400, "bad_body", "请求体为空或过大", null, WRITE_OPTS);
  }
  let body;
  try { body = JSON.parse(raw); } catch (e) {
    return fail(request, 400, "bad_json", "请求体不是合法 JSON", null, WRITE_OPTS);
  }
  const slug = String((body && body.slug) || "").toLowerCase().trim();
  const action = String((body && body.action) || "").trim();
  const device = String((body && body.device) || "").trim();

  if (!SLUG_RE.test(slug)) {
    return fail(request, 400, "invalid_slug", "slug 形态应为 wp-01 这类", null, WRITE_OPTS);
  }
  if (ACTIONS.indexOf(action) === -1) {
    return fail(request, 400, "invalid_action", "action 只能是 download / fav / unfav", null, WRITE_OPTS);
  }
  if (!(await isLive(env, slug))) {
    return fail(request, 404, "not_found", "没有这张壁纸", null, WRITE_OPTS);
  }

  const who = await whoOf(request, device);
  let counted = false;
  if (action === "download") counted = await bumpDownloads(env, slug, who);
  else counted = await bumpFavs(env, slug, who, action === "fav");

  const row = await readOne(env, slug);
  row.counted = counted;
  return json(request, row, 200, null, WRITE_OPTS);
}

export async function handleWpStats(context) {
  const { request, env } = context;
  if (!env || !env.DB) {
    return fail(request, 503, "d1_unavailable", "D1 尚未绑定，本接口暂不可用");
  }
  const method = request.method.toUpperCase();
  try {
    if (method === "GET" || method === "HEAD") {
      return await handleGet(context, new URL(request.url));
    }
    if (method === "POST") return await handlePost(context);
    return fail(request, 405, "method_not_allowed", "只支持 GET 与 POST");
  } catch (e) {
    console.error("wp stats error", e && e.stack ? e.stack : e);
    return fail(request, 500, "internal_error", "统计读写失败，请稍后重试", null);
  }
}
