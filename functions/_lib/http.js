/* ══════════════════════════════════════════════════════════════
   Functions 内部工具（下划线开头，不会被当成路由）
   ──────────────────────────────────────────────────────────────
   统一 JSON 响应、错误体与跨域策略。

   跨域口径（2026-11-07 定：镜像域只读）
   · pages.dev 是本站主域，同源请求不涉及 CORS；
   · 镜像域 wow-blog.app.workbuddy.host 没有 Functions，页面仍然要能看榜，
     所以只对它放行 **GET**，写入必须回主域；
   · 其他来源一律不发 CORS 头，浏览器自己会挡。
   ══════════════════════════════════════════════════════════════ */

const JSON_TYPE = "application/json; charset=utf-8";

/* 允许只读跨域的来源：镜像域。主域同源不需要出现在这里。 */
const READ_ORIGINS = ["https://wow-blog.app.workbuddy.host"];

function baseHeaders() {
  return {
    "content-type": JSON_TYPE,
    /* 榜单数据随时在变，不允许任何中间层缓存 */
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
}

/* 只给白名单来源、且只给 GET/HEAD 加 CORS 头 */
export function corsHeaders(request, method) {
  const headers = {};
  const origin = request.headers.get("Origin");
  if (!origin || READ_ORIGINS.indexOf(origin) === -1) return headers;
  const m = String(method || request.method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") return headers;
  headers["access-control-allow-origin"] = origin;
  headers["vary"] = "Origin";
  return headers;
}

export function json(request, data, status, extraHeaders) {
  const headers = baseHeaders();
  const cors = corsHeaders(request);
  Object.keys(cors).forEach(function (k) { headers[k] = cors[k]; });
  if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}

/* 统一的失败体：{ error, message }
   error 是给前端判分支的稳定码，message 是给人看的说明。 */
export function fail(request, status, error, message, extraHeaders) {
  const body = { error: error };
  if (message) body.message = message;
  return json(request, body, status, extraHeaders);
}

/* 预检：只有镜像域的 GET 需要，其他方法一律不放行 */
export function preflight(request) {
  const origin = request.headers.get("Origin");
  const allowed = !!origin && READ_ORIGINS.indexOf(origin) !== -1;
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (allowed) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, HEAD";
    headers["access-control-allow-headers"] = "content-type";
    headers["access-control-max-age"] = "86400";
    headers["vary"] = "Origin";
  }
  return new Response(null, { status: allowed ? 204 : 403, headers });
}
