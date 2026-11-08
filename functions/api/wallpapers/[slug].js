/* ══════════════════════════════════════════════════════════════
   /api/wallpapers/:slug —— 单张壁纸元数据
   ──────────────────────────────────────────────────────────────
   详情页兜底渲染（functions/wallpapers/[slug].js）与前端排错都用它。
   ══════════════════════════════════════════════════════════════ */

import { preflight } from "../../../_lib/http.js";
import { handleWallpaperOne } from "../../../_lib/wallpapers.js";

export async function onRequest(context) {
  const { request } = context;
  if (request.method.toUpperCase() === "OPTIONS") return preflight(request);
  return handleWallpaperOne(context);
}
