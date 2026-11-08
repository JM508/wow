/* ══════════════════════════════════════════════════════════════
   /api/wallpapers —— 壁纸清单（Pages Functions + D1）
   ──────────────────────────────────────────────────────────────
   逻辑在 _lib/wallpapers.js，这里只做路由分发。

   注意：本文件要被调用，路径必须出现在 static/_routes.json 的 include 里。
   ══════════════════════════════════════════════════════════════ */

import { preflight } from "../../_lib/http.js";
import { handleWallpaperList } from "../../_lib/wallpapers.js";

export async function onRequest(context) {
  const { request } = context;
  if (request.method.toUpperCase() === "OPTIONS") return preflight(request);
  return handleWallpaperList(context);
}
