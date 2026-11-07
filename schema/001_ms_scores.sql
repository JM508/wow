-- ══════════════════════════════════════════════════════════════
--   001 · 扫雷排行榜（ms_scores）
--   ──────────────────────────────────────────────────────────────
--   第一条从 WorkBuddy 云服务迁到 Cloudflare D1 的数据链路。
--   字段与旧云表一一对应，created_at 统一存 ISO8601 UTC 字符串
--   （2026-11-07T12:00:00.000Z），这样 SQLite 的字符串比较等价于时间比较，
--   迁移过来的旧数据也按同一格式归一化。
--
--   约束分两层，故意重复：
--     · 这里的 CHECK 是最后一道闸，任何绕过 Worker 的写入口都拦得住；
--     · 更细的规则（按难度限速、单日条数、只收更快成绩）在 Worker 里判，
--       SQLite 表达不了「跨行比较 + 按 mode 变上限」这类逻辑。
--
--   执行：wrangler d1 execute wow-db --file=schema/001_ms_scores.sql --remote
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ms_scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mode        TEXT    NOT NULL CHECK (mode IN ('easy', 'mid', 'hard', 'daily')),
  nickname    TEXT    NOT NULL CHECK (length(nickname) >= 1 AND length(nickname) <= 24),
  -- 秒数上限先按最宽的高级 7200 兜底，各难度的真实上限在 Worker 里按 mode 判
  seconds     INTEGER NOT NULL CHECK (seconds >= 1 AND seconds <= 7200),
  -- 访客的凭证；登录玩家为空（登录态由云账号体系负责，不进 D1）
  device_id   TEXT             CHECK (device_id IS NULL OR length(device_id) BETWEEN 8 AND 64),
  region      TEXT             CHECK (region IS NULL OR length(region) <= 32),
  -- 头像快照（data URL），与旧云同口径 ≤16KB
  avatar      TEXT             CHECK (avatar IS NULL OR length(avatar) <= 16384),
  created_at  TEXT    NOT NULL
);

-- 榜单主查询：WHERE mode = ? ORDER BY seconds ASC, created_at ASC
CREATE INDEX IF NOT EXISTS idx_ms_mode_time ON ms_scores (mode, seconds, created_at);

-- 单日防刷：WHERE device_id = ? AND created_at >= ?
CREATE INDEX IF NOT EXISTS idx_ms_device_day ON ms_scores (device_id, created_at);

-- 「我的最好成绩」与去重：WHERE mode = ? AND nickname = ?
CREATE INDEX IF NOT EXISTS idx_ms_name_best ON ms_scores (mode, nickname, seconds);

-- 单日按昵称防刷（登录玩家没有 device_id，只能按昵称限流）
CREATE INDEX IF NOT EXISTS idx_ms_name_day ON ms_scores (nickname, created_at);
