/* ══════════════════════════════════════════════════════════════
   /api/scores/:game —— 成绩与排行榜 API（Pages Functions + D1）
   ──────────────────────────────────────────────────────────────
   目前只接入了 ms（扫雷）。其他游戏仍走旧云链路，
   这里明确回 501，避免前端误判成「没数据」。

   为什么用动态段：每条游戏链路的结构差异很大（跑酷还要钱包与成就），
   拆成独立文件比堆在一个大 if 里好维护；新增游戏只需加一个 case。

   注意：本文件要被调用，路径必须出现在 static/_routes.json 的 include 里。
   ══════════════════════════════════════════════════════════════ */

import { preflight, fail } from "../../_lib/http.js";
import { handleMs } from "../../_lib/ms.js";

const MIGRATED = ["ms"];                        // 已迁到 D1 的游戏
const KNOWN = ["ms", "runner", "ttt", "snake"]; // 站内存在的游戏，未迁的也要认得，好给准确提示

export async function onRequest(context) {
  const { request, params } = context;

  /* 镜像域只读跨域用得到预检；写入不在这里放行 */
  if (request.method.toUpperCase() === "OPTIONS") return preflight(request);

  const game = String((params && params.game) || "").toLowerCase();

  if (KNOWN.indexOf(game) === -1) {
    return fail(request, 404, "unknown_game", "未知的游戏标识：" + (game || "(空)"));
  }
  if (MIGRATED.indexOf(game) === -1) {
    return fail(request, 501, "game_not_migrated", "该游戏尚未迁到 D1，请走原有云链路");
  }

  if (game === "ms") return handleMs(context);
  return fail(request, 501, "game_not_migrated", "该游戏尚未迁到 D1，请走原有云链路");
}
