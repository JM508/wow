/* ══════════════════════════════════════════════════════════════
   敲木鱼 · 点击次数榜（2026-11-21）
   ──────────────────────────────────────────────────────────────
   与扫雷榜同一条技术链路（Pages Functions + D1），差异只在排序口径：
     · 扫雷比「用时越短越好」，木鱼比「敲得越多越好」
     · 每个昵称只留一行（主键就是 nickname），新值比旧值大才更新点击数
     · 同一台设备换昵称时，把旧昵称那一行的点击数并到新昵称上再删旧行
       —— 这样个人中心改名后，榜上不会留一条旧名字的成绩

   接口
     GET  /api/scores/wf?limit=100[&nickname=xxx]
     POST /api/scores/wf { nickname, clicks, deviceId?, region?, avatar? }

   防刷：同一设备每天最多 240 次写入（前端累计到一定次数或间隔才上报，
   正常敲一天也到不了这个量；没有上限的话几十行 JS 就能把库写满）。
   ══════════════════════════════════════════════════════════════ */

import { json, fail } from "./http.js";
import { regionOf, provinceOnly } from "./region.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const MAX_NICK = 24;
const MAX_REGION = 32;
const MAX_AVATAR = 16384;
const MAX_BODY = 32768;
const MAX_CLICKS = 10000000;         // 一千万次，够任何正常人敲十年
const DAY_MAX_BY_DEVICE = 240;
const GUEST_RE = /^访客 [0-9]{1,3}$/;

function todayStartISO() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/* 昵称清洗：去掉控制字符与首尾空白，压掉连续空白 */
function cleanText(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toInt(v, min, max) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/* ═══════════ 读 ═══════════ */

async function list(env, url, request) {
  const q = url.searchParams;

  let limit = toInt(q.get("limit"), 1, MAX_LIMIT);
  if (q.has("limit") && limit === null) {
    return fail(request, 400, "invalid_limit", "limit 需为 1-" + MAX_LIMIT + " 的整数");
  }
  if (limit === null) limit = DEFAULT_LIMIT;

  const nickRaw = q.get("nickname");
  const nickname = nickRaw === null ? null : cleanText(nickRaw);
  if (nickname !== null && (nickname.length < 1 || nickname.length > MAX_NICK)) {
    return fail(request, 400, "invalid_nickname", "昵称长度需在 1-" + MAX_NICK + " 之间");
  }

  /* 查某人：只回一条，前端拿它渲染「我的名次」 */
  if (nickname !== null) {
    const row = await env.DB.prepare(
      "SELECT clicks, updated_at FROM wf_scores WHERE nickname = ?1"
    ).bind(nickname).first();
    return json(request, { game: "wf", nickname: nickname, row: row || null });
  }

  const res = await env.DB.prepare(
    "SELECT nickname, clicks, region, avatar, updated_at FROM wf_scores" +
    " ORDER BY clicks DESC, updated_at ASC LIMIT ?1"
  ).bind(limit).all();

  const rows = (res && res.results) || [];
  return json(request, { game: "wf", count: rows.length, rows: rows });
}

/* ═══════════ 写 ═══════════ */

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return { tooLarge: true };
  try {
    return { body: JSON.parse(raw) };
  } catch (e) {
    return { invalid: true };
  }
}

async function submit(request, env) {
  const parsed = await readBody(request);
  if (parsed.tooLarge) return fail(request, 413, "payload_too_large", "请求体超过 " + MAX_BODY + " 字节");
  if (parsed.invalid) return fail(request, 400, "invalid_json", "请求体不是合法 JSON");
  const body = parsed.body || {};

  const nickname = cleanText(body.nickname);
  if (nickname.length < 1 || nickname.length > MAX_NICK) {
    return fail(request, 400, "invalid_nickname", "昵称长度需在 1-" + MAX_NICK + " 之间");
  }

  const clicks = toInt(body.clicks, 1, MAX_CLICKS);
  if (clicks === null) {
    return fail(request, 400, "invalid_clicks", "clicks 需为 1-" + MAX_CLICKS + " 的整数");
  }

  const deviceId = cleanText(body.deviceId) || null;
  if (deviceId !== null && (deviceId.length < 8 || deviceId.length > 64)) {
    return fail(request, 400, "invalid_device", "deviceId 长度需在 8-64 之间");
  }
  if (GUEST_RE.test(nickname) && !deviceId) {
    return fail(request, 400, "missing_device_id", "访客成绩必须带 deviceId");
  }

  const clientRegion = cleanText(body.region) || null;
  if (clientRegion !== null && clientRegion.length > MAX_REGION) {
    return fail(request, 400, "invalid_region", "region 不能超过 " + MAX_REGION + " 字");
  }
  const region = regionOf(request) || provinceOnly(clientRegion);

  const avatar = typeof body.avatar === "string" ? body.avatar : null;
  if (avatar !== null && (avatar.length > MAX_AVATAR || avatar.indexOf("data:image/") !== 0)) {
    return fail(request, 400, "invalid_avatar", "头像需为 data:image/ 开头的 data URL 且不超过 " + MAX_AVATAR + " 字节");
  }

  if (deviceId) {
    const c = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM wf_scores WHERE device_id = ?1 AND updated_at >= ?2"
    ).bind(deviceId, todayStartISO()).first();
    if (c && Number(c.n) >= DAY_MAX_BY_DEVICE) {
      return fail(request, 429, "daily_quota_exceeded", "这台设备今天的上报次数已用完");
    }
  }

  const now = new Date().toISOString();
  const cur = await env.DB.prepare(
    "SELECT clicks FROM wf_scores WHERE nickname = ?1"
  ).bind(nickname).first();

  let inserted = false;
  let row;
  if (!cur) {
    row = await env.DB.prepare(
      "INSERT INTO wf_scores (nickname, clicks, device_id, region, avatar, created_at, updated_at)" +
      " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING nickname, clicks, region, updated_at"
    ).bind(nickname, clicks, deviceId, region, avatar, now, now).first();
    inserted = true;
  } else if (clicks > Number(cur.clicks)) {
    row = await env.DB.prepare(
      "UPDATE wf_scores SET clicks = ?2, region = ?3, avatar = ?4, updated_at = ?5" +
      (deviceId ? ", device_id = ?6" : "") +
      " WHERE nickname = ?1 RETURNING nickname, clicks, region, updated_at"
    ).bind(...(deviceId
      ? [nickname, clicks, region, avatar, now, deviceId]
      : [nickname, clicks, region, avatar, now])).first();
    inserted = true;
  } else {
    /* 点击数没涨（同一进度重复上报）：只把头像 / 属地刷新一下，
       用户刚换头像时榜上那张脸要能立刻跟着换。 */
    await env.DB.prepare(
      "UPDATE wf_scores SET region = ?2, avatar = ?3, updated_at = ?4" +
      (deviceId ? ", device_id = ?5" : "") +
      " WHERE nickname = ?1"
    ).bind(...(deviceId
      ? [nickname, region, avatar, now, deviceId]
      : [nickname, region, avatar, now])).run();
    row = { nickname: nickname, clicks: Number(cur.clicks), region: region, updated_at: now };
  }

  /* 改名联动：这台设备以前用别的昵称上榜时，把那些行的次数并到新昵称再删旧行。
     主键是 nickname，不合并的话「换个名字敲」会凭空多出第二条成绩。 */
  let merged = 0;
  if (deviceId) {
    const olds = await env.DB.prepare(
      "SELECT nickname, clicks, avatar FROM wf_scores WHERE device_id = ?1 AND nickname <> ?2"
    ).bind(deviceId, nickname).all();
    for (const o of (olds && olds.results) || []) {
      if (Number(o.clicks) > Number(row.clicks)) {
        row = await env.DB.prepare(
          "UPDATE wf_scores SET clicks = ?2, updated_at = ?3 WHERE nickname = ?1" +
          " RETURNING nickname, clicks, region, updated_at"
        ).bind(nickname, Number(o.clicks), now).first() || row;
      }
      await env.DB.prepare("DELETE FROM wf_scores WHERE nickname = ?1").bind(o.nickname).run();
      merged++;
    }
  }

  return json(request, {
    game: "wf", ok: true, inserted: inserted, merged: merged, row: row || null
  });
}

/* ═══════════ 入口 ═══════════ */

export async function handleWf(context) {
  const { request, env } = context;

  if (!env || !env.DB) {
    return fail(request, 503, "d1_unavailable", "D1 尚未绑定，本接口暂不可用");
  }

  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  try {
    if (method === "GET" || method === "HEAD") return await list(env, url, request);
    if (method === "POST") return await submit(request, env);
    return fail(request, 405, "method_not_allowed", "只支持 GET 与 POST");
  } catch (e) {
    console.error("wf api error", e && e.stack ? e.stack : e);
    return fail(request, 500, "internal_error", "数据处理失败，请稍后重试");
  }
}
