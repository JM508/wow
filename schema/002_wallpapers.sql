-- ══════════════════════════════════════════════════════════════
-- 壁纸元数据（D1 版）
-- ──────────────────────────────────────────────────────────────
-- 从 data/wallpapers.yaml 迁过来：D1 成为运行时唯一数据源，
-- yaml 退化为「静态构建快照」，供 Hugo 生成列表页与详情页。
--
-- 字段口径与 yaml 一致；新增 sort_order / status 两列：
--   sort_order  原始顺序（列表按「横屏在前、竖屏在后」再按它排）
--   status      live 上架 / hidden 下架（下架不删行，便于恢复）
--
-- D1 网页 Console 一次只吃一条语句，部署时要逐条执行。
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wallpapers (
  slug       TEXT    PRIMARY KEY CHECK (length(slug) BETWEEN 3 AND 48),
  added      TEXT             CHECK (added IS NULL OR length(added) = 10),
  w          INTEGER NOT NULL CHECK (w > 0 AND w <= 20000),
  h          INTEGER NOT NULL CHECK (h > 0 AND h <= 20000),
  ratio      REAL    NOT NULL CHECK (ratio > 0 AND ratio <= 10),
  color      TEXT             CHECK (color IS NULL OR length(color) BETWEEN 4 AND 9),
  kb         INTEGER NOT NULL DEFAULT 0 CHECK (kb >= 0 AND kb <= 40000),
  kb_thumb   INTEGER NOT NULL DEFAULT 0 CHECK (kb_thumb >= 0 AND kb_thumb <= 40000),
  thumb      TEXT    NOT NULL CHECK (length(thumb) BETWEEN 5 AND 255),
  full       TEXT    NOT NULL CHECK (length(full) BETWEEN 5 AND 255),
  orig       TEXT             CHECK (orig IS NULL OR length(orig) <= 255),
  tags       TEXT    NOT NULL DEFAULT '[]' CHECK (length(tags) BETWEEN 2 AND 200),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status     TEXT    NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'hidden')),
  updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wp_live ON wallpapers (status, sort_order, slug);
CREATE INDEX IF NOT EXISTS idx_wp_added ON wallpapers (added);
