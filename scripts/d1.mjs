#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   D1 命令行（走 Cloudflare REST API，不依赖 wrangler）

   目标：壁纸元数据、榜单、迁移这类 SQL 不再靠人手粘 D1 网页 Console。
   一次配好 token，之后所有 schema/数据变更都是跑一条命令。

   用法
     node scripts/d1.mjs whoami             # 验 token，列可见账号
     node scripts/d1.mjs dbs                # 列 D1 数据库（拿 uuid）
     node scripts/d1.mjs q "SELECT 1"       # 跑单条语句并打印结果
     node scripts/d1.mjs exec schema/seed/add-wp-90.sql   # 文件里所有语句按序执行
     node scripts/d1.mjs migrate            # 执行 schema/migrations 里未应用的
     node scripts/d1.mjs status             # 看已应用的迁移

   凭证
     优先级：--token > $CF_API_TOKEN > <项目/>.cf/d1.env
     .cf/d1.env 内容（键值对，一行一个，不要加引号）：
       CF_API_TOKEN=xxxx
       CF_ACCOUNT_ID=c0f64f15fec2d9f41083a379ac1cef13
       D1_DB=wow-db
     该文件放在仓库之外（项目根 .cf/），不会进 git。

   退出码：0 成功；1 参数/凭证问题；2 API 报错
   ══════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const API = "https://api.cloudflare.com/client/v4";
const DEFAULT_ACCOUNT = "c0f64f15fec2d9f41083a379ac1cef13";
const DEFAULT_DB = "wow-db";

/* ── 参数 ─────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  } else args.push(a);
}
const cmd = args[0] || "help";

/* ── 凭证 ─────────────────────────────────────────────────── */
function readEnvFile() {
  const cands = [
    process.env.CF_D1_ENV,
    path.join(process.cwd(), ".cf", "d1.env"),
    path.join(process.cwd(), "..", ".cf", "d1.env"),
    path.join(os.homedir(), ".cf", "d1.env"),
  ].filter(Boolean);
  for (const p of cands) {
    if (!fs.existsSync(p)) continue;
    const out = {};
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return { file: p, vars: out };
  }
  return { file: null, vars: {} };
}

const envFile = readEnvFile();
const TOKEN = flags.token || process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || envFile.vars.CF_API_TOKEN || "";
const ACCOUNT = flags.account || process.env.CF_ACCOUNT_ID || envFile.vars.CF_ACCOUNT_ID || DEFAULT_ACCOUNT;
const DBNAME = flags.db || process.env.D1_DB || envFile.vars.D1_DB || DEFAULT_DB;

function needToken() {
  if (TOKEN) return;
  console.error("缺少 Cloudflare API Token。");
  console.error("");
  console.error("创建方式（一次性，2 分钟）：");
  console.error("  1. 打开 https://dash.cloudflare.com/profile/api-tokens");
  console.error("  2. Create Token -> Custom token");
  console.error("  3. Permissions 只勾一条：Account / D1 / Edit");
  console.error("  4. Account Resources: Include -> 你的账号");
  console.error("  5. 创建后复制，写进 " + path.join(ROOT, "..", ".cf", "d1.env") + "：");
  console.error("       CF_API_TOKEN=粘在这里");
  console.error("       D1_DB=wow-db");
  console.error("");
  console.error("也可以临时用环境变量：CF_API_TOKEN=xxx node scripts/d1.mjs dbs");
  process.exit(1);
}

/* ── HTTP ─────────────────────────────────────────────────── */
async function cf(pathname, init = {}) {
  const url = API + pathname;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer " + TOKEN,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(Number(flags.timeout || 30000)),
  });
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body };
}

async function resolveDb() {
  const name = DBNAME || DEFAULT_DB;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name)) return name;
  const r = await cf(`/accounts/${ACCOUNT}/d1/database`);
  if (!r.body || !r.body.success) {
    console.error("列数据库失败：", JSON.stringify(r.body && r.body.errors || r.body));
    process.exit(2);
  }
  const hit = (r.body.result || []).find((d) => d.name === name);
  if (!hit) {
    console.error(`账号下没有名为 ${name} 的 D1 库。现有：` +
      (r.body.result || []).map((d) => `${d.name}(${d.uuid})`).join(", "));
    process.exit(1);
  }
  return hit.uuid;
}

/* 一条语句一次请求：D1 的 /query 接口不接受多语句 */
async function runOne(dbId, sql, params) {
  const r = await cf(`/accounts/${ACCOUNT}/d1/database/${dbId}/query`, {
    method: "POST",
    body: JSON.stringify(params ? { sql, params } : { sql }),
  });
  const ok = r.body && r.body.success;
  const first = ok ? (r.body.result || [])[0] : null;
  if (!ok) {
    const errs = (r.body && r.body.errors) || [];
    const msg = errs.map((e) => `${e.code || ""} ${e.message || ""}`.trim()).join("; ") || JSON.stringify(r.body);
    const e = new Error(`D1 报错 HTTP ${r.status}：${msg}`);
    e.sql = sql;
    throw e;
  }
  return first;
}

/* ── SQL 切分：处理引号、行注释、块注释 ──────────────────── */
export function splitSql(text) {
  const out = [];
  let buf = "";
  let i = 0;
  let state = "code"; // code | sq | dq | line | block
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (state === "code") {
      if (c === "-" && n === "-") { state = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; buf += c; i++; continue; }
      if (c === '"') { state = "dq"; buf += c; i++; continue; }
      if (c === ";") {
        const s = buf.trim();
        if (s) out.push(s);
        buf = "";
        i++;
        continue;
      }
      buf += c; i++; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; buf += "\n"; }
      i++; continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") { state = "code"; i += 2; } else i++;
      continue;
    }
    // sq / dq：SQL 里连续两个引号表示转义
    if (c === "'" && state === "sq") {
      if (n === "'") { buf += "''"; i += 2; continue; }
      state = "code"; buf += c; i++; continue;
    }
    if (c === '"' && state === "dq") {
      if (n === '"') { buf += '""'; i += 2; continue; }
      state = "code"; buf += c; i++; continue;
    }
    buf += c; i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/* ── 输出 ─────────────────────────────────────────────────── */
function printRows(rows, meta) {
  if (!rows || !rows.length) {
    console.log(meta ? `(0 行，耗时 ${meta.duration ?? "?"}ms)` : "(0 行)");
    return;
  }
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(String(c).length, ...rows.map((r) => fmt(r[c]).length))
  );
  const line = (cells) => cells.map((s, i) => String(s).padEnd(widths[i])).join(" | ");
  console.log(line(cols));
  console.log(widths.map((w) => "-".repeat(w)).join("-+-"));
  for (const r of rows) console.log(line(cols.map((c) => fmt(r[c]))));
  console.log(`(${rows.length} 行${meta && meta.duration != null ? `，耗时 ${meta.duration}ms` : ""})`);
}
function fmt(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/* ── 命令 ─────────────────────────────────────────────────── */
async function cmdWhoami() {
  needToken();
  const r = await cf("/user/tokens/verify");
  if (!r.body || !r.body.success) {
    console.error("token 校验失败：", JSON.stringify((r.body && r.body.errors) || r.body));
    process.exit(2);
  }
  console.log("token 有效：" + r.body.result.status);
  const a = await cf("/accounts?per_page=50");
  if (a.body && a.body.success) {
    for (const acc of a.body.result || []) console.log(`账号 ${acc.id}  ${acc.name}`);
  }
  console.log(`默认账号 ${ACCOUNT} / 默认库 ${DBNAME}`);
  if (envFile.file) console.log(`凭证文件 ${envFile.file}`);
}

async function cmdDbs() {
  needToken();
  const r = await cf(`/accounts/${ACCOUNT}/d1/database`);
  if (!r.body || !r.body.success) {
    console.error("列数据库失败：", JSON.stringify((r.body && r.body.errors) || r.body));
    process.exit(2);
  }
  for (const d of r.body.result || []) {
    console.log(`${d.name}\t${d.uuid}\t${d.version || ""}`);
  }
}

async function cmdQ() {
  needToken();
  const sql = args[1] || flags.sql;
  if (!sql) { console.error("用法：node scripts/d1.mjs q \"SELECT ...\""); process.exit(1); }
  const dbId = await resolveDb();
  if (flags["dry-run"]) { console.log(sql + ";"); return; }
  const first = await runOne(dbId, sql.trim().replace(/;\s*$/, ""));
  printRows(first && first.results, first && first.meta);
}

async function cmdExec() {
  if (!flags["dry-run"]) needToken();
  const files = args.slice(1);
  if (!files.length) { console.error("用法：node scripts/d1.mjs exec <file.sql> [...]"); process.exit(1); }
  const dbId = flags["dry-run"] ? null : await resolveDb();
  let total = 0;
  for (const f of files) {
    const p = path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) { console.error("文件不存在：" + p); process.exit(1); }
    const stmts = splitSql(fs.readFileSync(p, "utf8"));
    console.log(`== ${path.relative(ROOT, p) || p}（${stmts.length} 条语句）`);
    for (let k = 0; k < stmts.length; k++) {
      const s = stmts[k];
      const head = s.replace(/\s+/g, " ").slice(0, 70);
      if (flags["dry-run"]) {
        console.log(`  [${k + 1}/${stmts.length}] ${s.length} 字符  ${head}${s.length > 70 ? "..." : ""}`);
        continue;
      }
      try {
        const first = await runOne(dbId, s);
        const rows = (first && first.results) || [];
        const meta = (first && first.meta) || {};
        const info = rows.length
          ? `${rows.length} 行返回`
          : `changes=${meta.changes ?? 0}`;
        console.log(`  [${k + 1}/${stmts.length}] ok ${info}  ${head}${s.length > 70 ? "..." : ""}`);
        total += meta.changes || 0;
      } catch (e) {
        console.error(`  [${k + 1}/${stmts.length}] FAILED: ${e.message}`);
        console.error(`  SQL: ${s.slice(0, 300)}`);
        process.exit(2);
      }
    }
  }
  console.log(`完成，累计变更 ${total} 行。`);
}

const MIG_DIR = path.join(ROOT, "schema", "migrations");

async function ensureLedger(dbId) {
  await runOne(dbId, `CREATE TABLE IF NOT EXISTS _d1_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`);
}

async function appliedSet(dbId) {
  const first = await runOne(dbId, "SELECT name FROM _d1_migrations");
  return new Set(((first && first.results) || []).map((r) => r.name));
}

async function cmdMigrate() {
  needToken();
  if (!fs.existsSync(MIG_DIR)) { console.error("没有 schema/migrations 目录"); process.exit(1); }
  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) { console.log("没有迁移文件"); return; }
  const dbId = await resolveDb();
  await ensureLedger(dbId);
  const done = await appliedSet(dbId);
  let n = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const stmts = splitSql(fs.readFileSync(path.join(MIG_DIR, f), "utf8"));
    console.log(`== 应用 ${f}（${stmts.length} 条）`);
    for (const s of stmts) await runOne(dbId, s);
    await runOne(dbId, `INSERT OR REPLACE INTO _d1_migrations (name, applied_at) VALUES (?, ?)`, [f, new Date().toISOString()]);
    n++;
  }
  console.log(n ? `已应用 ${n} 个迁移。` : "全部已应用，无待执行。");
}

async function cmdStatus() {
  needToken();
  const dbId = await resolveDb();
  await ensureLedger(dbId);
  const done = await appliedSet(dbId);
  const files = fs.existsSync(MIG_DIR) ? fs.readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort() : [];
  for (const f of files) console.log(`${done.has(f) ? "已应用" : "待执行"}  ${f}`);
  const extra = [...done].filter((d) => !files.includes(d));
  for (const e of extra) console.log(`记录中存在但文件已删  ${e}`);
  const first = await runOne(dbId, "SELECT count(*) AS n FROM wallpapers WHERE status='live'");
  const row = ((first && first.results) || [])[0];
  if (row) console.log(`壁纸 live 条数：${row.n}`);
}

function help() {
  console.log(`D1 命令行（REST API）

  node scripts/d1.mjs whoami
  node scripts/d1.mjs dbs
  node scripts/d1.mjs q "SELECT count(*) FROM wallpapers"
  node scripts/d1.mjs exec <file.sql> [more.sql]
  node scripts/d1.mjs migrate
  node scripts/d1.mjs status

  选项：--db <name|uuid>  --account <id>  --token <token>  --dry-run
  凭证：<项目>/.cf/d1.env 里的 CF_API_TOKEN / CLOUDFLARE_API_TOKEN`);
}

const table = { whoami: cmdWhoami, dbs: cmdDbs, q: cmdQ, exec: cmdExec, migrate: cmdMigrate, status: cmdStatus, help };
const fn = table[cmd];
if (!fn) { help(); process.exit(1); }
fn().catch((e) => {
  console.error("失败：" + (e && e.message ? e.message : e));
  if (e && e.sql) console.error("SQL: " + e.sql.slice(0, 300));
  process.exit(2);
});
