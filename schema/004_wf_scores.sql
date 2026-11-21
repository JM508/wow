-- ══════════════════════════════════════════════════════════════
--   004 · 敲木鱼点击榜（wf_scores）
--   ──────────────────────────────────────────────────────────────
--   与 001（扫雷）同一条链路，只把排序口径换成「次数越多越好」：
--     · 主键就是 nickname —— 一个人只占一行，改名靠 Worker 合并，不靠多条记录
--     · clicks 是这台设备累计敲击次数（本机计数，换设备从 0 起）
--     · updated_at 既用于榜单同分排序，也用于单日防刷
--
--   执行：node scripts/d1.mjs exec schema/004_wf_scores.sql
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wf_scores (
  nickname   TEXT    PRIMARY KEY CHECK (length(nickname) >= 1 AND length(nickname) <= 24),
  clicks     INTEGER NOT NULL CHECK (clicks >= 1 AND clicks <= 10000000),
  device_id  TEXT             CHECK (device_id IS NULL OR length(device_id) BETWEEN 8 AND 64),
  region     TEXT             CHECK (region IS NULL OR length(region) <= 32),
  avatar     TEXT             CHECK (avatar IS NULL OR length(avatar) <= 16384),
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

-- 榜单主查询：ORDER BY clicks DESC, updated_at ASC
CREATE INDEX IF NOT EXISTS idx_wf_clicks ON wf_scores (clicks DESC, updated_at ASC);

-- 改名合并与单日防刷：WHERE device_id = ? AND nickname <> ?
CREATE INDEX IF NOT EXISTS idx_wf_device ON wf_scores (device_id);
