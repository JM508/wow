-- ══════════════════════════════════════════════════════════════
--   005 · 复合索引修正（2026-11-21）
--   ──────────────────────────────────────────────────────────────
--   不是「凭感觉加索引」，两条都来自 EXPLAIN QUERY PLAN 的实测结果：
--
--   1) wf_scores 单日防刷
--        上报热路径：SELECT COUNT(*) WHERE device_id = ? AND updated_at >= ?
--        旧计划：SEARCH wf_scores USING INDEX idx_wf_device (device_id=?)
--                —— 只定位到设备，updated_at 无下界，逐行回表比较
--        新计划：SEARCH ... (device_id=? AND updated_at>?)  两列同时生效
--        顺带把别名单列索引升级掉，不新增第二条索引（前缀兼容改名合并查询）
--
--   2) ms_scores「我的最好成绩」
--        查询：SELECT seconds, created_at WHERE mode = ? AND nickname = ?
--              ORDER BY seconds ASC, created_at ASC LIMIT 1
--        旧计划：SEARCH ms_scores USING INDEX idx_ms_mode_time (mode=?)
--                —— 优化器放弃了 (mode,nickname,seconds)，因为还缺 created_at，
--                   用它排序后仍要回表；于是退化成扫整个 mode
--        新计划：(mode, nickname, seconds, created_at) 覆盖整条查询，SEARCH + COVERING
--
--   写入代价：索引从 3 列变 4 列、单列变双列，行宽增加可忽略；
--   当前线上 ms_scores / wf_scores 均为 0 行，建索引即刻完成，零窗口。
--
--   执行：node scripts/d1.mjs exec schema/005_indexes.sql
--   复核：node scripts/d1.mjs q "EXPLAIN QUERY PLAN ..."（见 scripts/d1.mjs 头部说明）
-- ══════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_wf_device;
CREATE INDEX IF NOT EXISTS idx_wf_device_day ON wf_scores (device_id, updated_at);

DROP INDEX IF EXISTS idx_ms_name_best;
CREATE INDEX IF NOT EXISTS idx_ms_name_best ON ms_scores (mode, nickname, seconds, created_at);
