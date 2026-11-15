-- ══════════════════════════════════════════════════════════════
-- 壁纸下载量 / 收藏量 —— 全站统计（2026-11-15）
-- ──────────────────────────────────────────────────────────────
-- 背景：此前这两个数字来自 localStorage，只反映「本机」行为，
-- 换台设备就归零，详情页还得注明「仅你可见」。改成服务端累计：
-- 任何一个访客的下载与收藏都计入同一个数字。
--
-- 三张表分工：
--   wp_stats       聚合计数（读的时候只碰这张，快）
--   wp_dl_events   下载去重：同一设备同一天同一张只算一次
--   wp_fav_events  收藏去重：同一设备对同一张只算一次（取消则删行）
--
-- 去重键 who 由服务端算：sha256(客户端 IP + 设备号) 的前 16 位十六进制。
-- 客户端 IP 与设备号都不入库，只留这个不可逆的短哈希。
--
-- updated_at 只在本表内使用，绝不能影响 wallpapers.updated_at ——
-- 那个字段参与列表版本号（条数.最近更新），一动全站前端就会重绘。
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wp_stats (
  slug       TEXT    PRIMARY KEY CHECK (length(slug) BETWEEN 3 AND 48),
  downloads  INTEGER NOT NULL DEFAULT 0 CHECK (downloads >= 0),
  favs       INTEGER NOT NULL DEFAULT 0 CHECK (favs >= 0),
  updated_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS wp_dl_events (
  slug TEXT NOT NULL,
  who  TEXT NOT NULL,
  day  TEXT NOT NULL,
  PRIMARY KEY (slug, who, day)
);
CREATE TABLE IF NOT EXISTS wp_fav_events (
  slug TEXT NOT NULL,
  who  TEXT NOT NULL,
  PRIMARY KEY (slug, who)
);
CREATE INDEX IF NOT EXISTS idx_wp_dl_day ON wp_dl_events (day);
