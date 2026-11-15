/* ══════════════════════════════════════════════════════════════
   /api/wallpapers/stats —— 壁纸下载量 / 收藏量（Pages Functions + D1）
   ──────────────────────────────────────────────────────────────
   逻辑在 _lib/wpstats.js，这里只做路由分发。
   与其它接口的唯一差别：镜像域页面也要能把计数写回来（镜像没有
   Functions），所以预检与响应头放开 POST，仅此一个接口。

   注意：本文件要被调用，路径必须出现在 static/_routes.json 的
   include 里（已有 /api/*，无需再改）。
   ══════════════════════════════════════════════════════════════ */

import { preflight } from "../../_lib/http.js";
import { handleWpStats } from "../../_lib/wpstats.js";

export async function onRequest(context) {
  const { request } = context;
  if (request.method.toUpperCase() === "OPTIONS") return preflight(request, { write: true });
  return handleWpStats(context);
}
