#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   把旧云（WorkBuddy 云服务 / PostgREST）的扫雷榜导出成 D1 可导入的 SQL
   ──────────────────────────────────────────────────────────────
   背景：扫雷榜是第一条迁到 Cloudflare D1 的链路。为了排行榜不断档，
   把历史成绩搬过去；之后新成绩直接写 D1。

   用法
     node scripts/export-ms-scores.mjs                  # 默认写 .migration/ms_scores.sql
     node scripts/export-ms-scores.mjs --out /tmp/x.sql
     node scripts/export-ms-scores.mjs --dry            # 只统计，不写文件

   拿到 SQL 后执行（wrangler 已登录）：
     wrangler d1 execute <DB_NAME> --file=.migration/ms_scores.sql --remote

   注意
   · 旧云对匿名只开放展示列，device_id 读不到 → 迁过去的行 device_id 为 NULL。
     这不影响榜单展示，只是这些历史行不参与「按设备单日限流」。
   · 同一 mode + 昵称在旧库里可能有多条，这里只保留最快的一条，
     与前端去重口径一致，避免 D1 里堆一堆永远上不了榜的行。
   ══════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/* publishableKey 本来就随页面下发（cloud.js 里明文），这里直接读同一份，
   免得脚本里再存一份、哪天换 key 忘了改。 */
const cloudSrc = fs.readFileSync(path.join(ROOT, "static", "cloud.js"), "utf8");
const KEY = (cloudSrc.match(/publishableKey:\s*"([^"]+)"/) || [])[1];
if (!KEY) {
  console.error("读不到 publishableKey，请检查 static/cloud.js");
  process.exit(1);
}

const BASE = "https://wow-blog.app.workbuddy.host/.cloud/database/rest/ms_scores";
const COLS = "mode,nickname,seconds,region,avatar,created_at";
const PAGE = 500;

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const outIdx = argv.indexOf("--out");
const OUT = outIdx !== -1 && argv[outIdx + 1]
  ? path.resolve(argv[outIdx + 1])
  : path.resolve(process.cwd(), ".migration/ms_scores.sql");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 旧云偶发抽风，GET 重试几次 */
async function fetchPage(offset) {
  const url = BASE + "?select=" + encodeURIComponent(COLS) +
    "&order=created_at.asc&limit=" + PAGE + "&offset=" + offset;
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 25000);
      const r = await fetch(url, {
        signal: c.signal,
        headers: { "x-wb-webapp-access-key": KEY, accept: "application/json" }
      });
      clearTimeout(t);
      if (r.status !== 200 && r.status !== 206) {
        throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 120));
      }
      const rows = await r.json();
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      lastErr = e;
      await sleep(1200);
    }
  }
  throw lastErr || new Error("unknown");
}

/* created_at 归一成毫秒精度 UTC（与 Worker 写入格式一致，保证字符串比较等价时间比较） */
function isoOf(v) {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const q = (v) => {
  if (v === null || v === undefined) return "NULL";
  return "'" + String(v).replace(/'/g, "''") + "'";
};

(async () => {
  console.log("从旧云导出 ms_scores …");
  let all = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await fetchPage(offset);
    if (!rows.length) break;
    all = all.concat(rows);
    process.stdout.write("  已取 " + all.length + " 行\r");
    if (rows.length < PAGE) break;
  }
  console.log("\n  原始行数：" + all.length);

  if (!all.length) {
    console.log("  旧库里这张表是空的，没有历史成绩需要迁移。");
    console.log("  （可以先把 schema 建好，新成绩会直接写进 D1。）");
    if (!dry) {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT,
        "-- 旧云 ms_scores 为空，本文件不含任何数据行。\n" +
        "-- 仅作迁移记录留存；表结构请执行 schema/001_ms_scores.sql。\n", "utf8");
      console.log("  占位文件已写入：" + OUT);
    }
    return;
  }

  /* 同一 mode + 昵称只留最快的一条 */
  const best = new Map();
  for (const r of all) {
    const k = r.mode + "\u0000" + r.nickname;
    const cur = best.get(k);
    if (!cur || Number(r.seconds) < Number(cur.seconds)) best.set(k, r);
  }
  const rows = [...best.values()];

  /* 只保留 schema 允许的 mode；脏数据直接丢掉并报数 */
  const VALID = ["easy", "mid", "hard", "daily"];
  const kept = rows.filter((r) => VALID.includes(String(r.mode)));
  const dropped = rows.length - kept.length;

  console.log("  去重后：" + rows.length + " 行（同人同难度只留最快）");
  if (dropped) console.log("  丢弃非法 mode：" + dropped + " 行");

  const lines = [];
  lines.push("-- 由 scripts/export-ms-scores.mjs 生成：" + new Date().toISOString());
  lines.push("-- 来源：旧云 ms_scores（" + all.length + " 行 → 去重后 " + kept.length + " 行）");
  lines.push("-- 执行：wrangler d1 execute <DB_NAME> --file=<本文件> --remote");
  lines.push("");
  for (const r of kept) {
    lines.push(
      "INSERT INTO ms_scores (mode, nickname, seconds, device_id, region, avatar, created_at) VALUES (" +
      [q(r.mode), q(r.nickname), Number(r.seconds) || 0, "NULL", q(r.region || null), q(r.avatar || null), q(isoOf(r.created_at))].join(", ") +
      ");"
    );
  }
  lines.push("");
  lines.push("-- 导入后自检：SELECT COUNT(*) FROM ms_scores;  期望 " + kept.length);

  if (dry) {
    console.log("  --dry：不落盘。示例行：");
    console.log("  " + lines[4]);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log("  SQL 已写入：" + OUT);
  console.log("  下一步：wrangler d1 execute <DB_NAME> --file=\"" + OUT + "\" --remote");
})();
