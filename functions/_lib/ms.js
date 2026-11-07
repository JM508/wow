/* ══════════════════════════════════════════════════════════════
   扫雷排行榜 —— D1 版（第一条迁移链路）
   ──────────────────────────────────────────────────────────────
   与旧云 ms_scores 的语义保持一致，但把「客户端自觉」改成「服务端必审」：

   旧云的做法是前端先查自己最好成绩、比不过就不提交；
   D1 这里照样在服务端查一次，前端传什么都拦得住。

   对外契约
     GET  /api/scores/ms?mode=easy&limit=100
     GET  /api/scores/ms?mode=easy&before=120&limit=6    比 120 秒快的前 6
     GET  /api/scores/ms?mode=easy&after=120&limit=6     比 120 秒慢的前 6
     GET  /api/scores/ms?mode=daily&nickname=访客%203     某人这个难度的最好成绩
     POST /api/scores/ms  { mode, nickname, seconds, deviceId?, region?, avatar? }

   返回体统一带 { game:"ms", mode, rows } 或 { ok, inserted, row }；
   失败体见 _lib/http.js 的 fail()。
   ══════════════════════════════════════════════════════════════ */

import { json, fail } from "./http.js";

/* 各难度用时上限（秒）：与旧云触发器同口径。
   低于 1 秒的「通关」不存在，下限统一 1。 */
const MODE_LIMITS = { easy: 1800, mid: 3600, hard: 7200, daily: 3600 };
const MODES = Object.keys(MODE_LIMITS);

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const NEAR_LIMIT = 20;              // before/after 查询的硬上限，远小于整榜

const MAX_NICK = 24;
const MAX_REGION = 32;
const MAX_AVATAR = 16384;
const MAX_BODY = 32768;             // 头像 data URL 最长 16KB，留一倍余量

/* 单日写入上限：访客按设备号，登录玩家没有设备号就按昵称。
   数字与旧云触发器的 400 条对齐；昵称口径收紧到 200，避免有人换设备刷同一昵称。 */
const DAY_MAX_BY_DEVICE = 400;
const DAY_MAX_BY_NICK = 200;

/* 访客昵称形态，与前端 GUEST_RE 一致 */
const GUEST_RE = /^访客 [0-9]{1,3}$/;

/* 榜单「今天」按 UTC+8 算：旧实现用浏览器本地时区，跨时区用户看到的 daily 榜不同。
   服务端统一成东八区，所有人看到的是同一份榜。 */
function todayStartISO() {
  const now = new Date();
  const SHIFT = 8 * 3600 * 1000;
  const shifted = new Date(now.getTime() + SHIFT);
  const startUtc =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - SHIFT;
  return new Date(startUtc).toISOString();
}

/* 只保留合法字符：去掉控制字符与零宽字符，避免昵称在榜上撑出怪异宽度 */
function cleanText(v) {
  return String(v == null ? "" : v)
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, "")
    .trim();
}

/* 整数解析：非数字、越界都算非法，返回 null */
function toInt(v, min, max) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/* ═══════════ 读：榜单 ═══════════ */

async function list(env, url, request) {
  const q = url.searchParams;
  const mode = String(q.get("mode") || "").trim();
  if (MODES.indexOf(mode) === -1) {
    return fail(request, 400, "invalid_mode", "mode 只能是 " + MODES.join(" / "));
  }

  const nicknameRaw = q.get("nickname");
  const nickname = nicknameRaw === null ? null : cleanText(nicknameRaw);
  if (nickname !== null && (nickname.length < 1 || nickname.length > MAX_NICK)) {
    return fail(request, 400, "invalid_nickname", "昵称长度需在 1-" + MAX_NICK + " 之间");
  }

  const before = q.has("before") ? toInt(q.get("before"), 1, 7200) : null;
  const after = q.has("after") ? toInt(q.get("after"), 1, 7200) : null;
  if (q.has("before") && before === null) return fail(request, 400, "invalid_before", "before 需为 1-7200 的整数");
  if (q.has("after") && after === null) return fail(request, 400, "invalid_after", "after 需为 1-7200 的整数");

  let limit = toInt(q.get("limit"), 1, MAX_LIMIT);
  if (q.has("limit") && limit === null) return fail(request, 400, "invalid_limit", "limit 需为 1-" + MAX_LIMIT + " 的整数");
  if (limit === null) limit = (before !== null || after !== null) ? NEAR_LIMIT : DEFAULT_LIMIT;

  const dailyFloor = mode === "daily" ? todayStartISO() : null;

  /* 查某人最好成绩：只回一条，前端拿它渲染「我的最好成绩」 */
  if (nickname !== null) {
    const sql =
      "SELECT seconds, created_at FROM ms_scores WHERE mode = ?1 AND nickname = ?2" +
      (dailyFloor ? " AND created_at >= ?3" : "") +
      " ORDER BY seconds ASC, created_at ASC LIMIT 1";
    const stmt = dailyFloor
      ? env.DB.prepare(sql).bind(mode, nickname, dailyFloor)
      : env.DB.prepare(sql).bind(mode, nickname);
    const row = await stmt.first();
    return json(request, { game: "ms", mode: mode, nickname: nickname, row: row || null });
  }

  /* 榜单主查询：升序（用时短的在前），同用时先提交的在前 */
  const where = ["mode = ?1"];
  const args = [mode];
  if (dailyFloor) { args.push(dailyFloor); where.push("created_at >= ?" + args.length); }
  if (before !== null) { args.push(before); where.push("seconds < ?" + args.length); }
  if (after !== null) { args.push(after); where.push("seconds > ?" + args.length); }
  args.push(limit);

  const sql =
    "SELECT nickname, seconds, region, avatar, created_at FROM ms_scores" +
    " WHERE " + where.join(" AND ") +
    " ORDER BY seconds ASC, created_at ASC LIMIT ?" + args.length;

  const res = await env.DB.prepare(sql).bind(...args).all();
  const rows = (res && res.results) || [];
  return json(request, { game: "ms", mode: mode, count: rows.length, rows: rows });
}

/* ═══════════ 写：提交成绩 ═══════════ */

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

  const mode = String(body.mode || "").trim();
  if (MODES.indexOf(mode) === -1) {
    return fail(request, 400, "invalid_mode", "mode 只能是 " + MODES.join(" / "));
  }

  const nickname = cleanText(body.nickname);
  if (nickname.length < 1 || nickname.length > MAX_NICK) {
    return fail(request, 400, "invalid_nickname", "昵称长度需在 1-" + MAX_NICK + " 之间");
  }

  const seconds = toInt(body.seconds, 1, MODE_LIMITS[mode]);
  if (seconds === null) {
    return fail(request, 400, "invalid_seconds",
      mode + " 的成绩需为 1-" + MODE_LIMITS[mode] + " 秒的整数");
  }

  const deviceId = cleanText(body.deviceId) || null;
  if (deviceId !== null && (deviceId.length < 8 || deviceId.length > 64)) {
    return fail(request, 400, "invalid_device", "deviceId 长度需在 8-64 之间");
  }
  /* 访客必须有设备号：没有设备号的「访客」无法归属，也没法限流 */
  if (GUEST_RE.test(nickname) && !deviceId) {
    return fail(request, 400, "missing_device_id", "访客成绩必须带 deviceId");
  }

  const region = cleanText(body.region) || null;
  if (region !== null && region.length > MAX_REGION) {
    return fail(request, 400, "invalid_region", "region 不能超过 " + MAX_REGION + " 字");
  }

  const avatar = typeof body.avatar === "string" ? body.avatar : null;
  if (avatar !== null && (avatar.length > MAX_AVATAR || avatar.indexOf("data:image/") !== 0)) {
    return fail(request, 400, "invalid_avatar", "头像需为 data:image/ 开头的 data URL 且不超过 " + MAX_AVATAR + " 字节");
  }

  const dayFloor = todayStartISO();

  /* 防刷：同一设备、同一昵称当天的写入次数 */
  if (deviceId) {
    const c = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ms_scores WHERE device_id = ?1 AND created_at >= ?2"
    ).bind(deviceId, dayFloor).first();
    if (c && Number(c.n) >= DAY_MAX_BY_DEVICE) {
      return fail(request, 429, "daily_quota_exceeded", "这台设备今天的提交次数已用完");
    }
  }
  const cn = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM ms_scores WHERE nickname = ?1 AND created_at >= ?2"
  ).bind(nickname, dayFloor).first();
  if (cn && Number(cn.n) >= DAY_MAX_BY_NICK) {
    return fail(request, 429, "daily_quota_exceeded", "这个昵称今天的提交次数已用完");
  }

  /* 只有更快才写：旧云靠前端自觉 + 触发器，这里服务端直接判 */
  const best = await env.DB.prepare(
    "SELECT seconds FROM ms_scores WHERE mode = ?1 AND nickname = ?2 ORDER BY seconds ASC LIMIT 1"
  ).bind(mode, nickname).first();
  if (best && Number(best.seconds) <= seconds) {
    return json(request, { game: "ms", ok: true, inserted: false, skipped: "not_better" });
  }

  const createdAt = new Date().toISOString();
  const inserted = await env.DB.prepare(
    "INSERT INTO ms_scores (mode, nickname, seconds, device_id, region, avatar, created_at)" +
    " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)" +
    " RETURNING mode, nickname, seconds, created_at"
  ).bind(mode, nickname, seconds, deviceId, region, avatar, createdAt).first();

  return json(request, { game: "ms", ok: true, inserted: true, row: inserted || null });
}

/* ═══════════ 入口 ═══════════ */

export async function handleMs(context) {
  const { request, env } = context;

  /* D1 没绑定就别装死：明确 503，前端据此回退到旧云链路 */
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
    /* D1 故障不能把栈泄给页面；日志留给 CF 的 Functions 观查 */
    console.error("ms api error", e && e.stack ? e.stack : e);
    return fail(request, 500, "internal_error", "数据处理失败，请稍后重试");
  }
}
