/* ══════════════════════════════════════════════════════════════
   Functions 内部工具（下划线开头，不会被当成路由）
   ──────────────────────────────────────────────────────────────
   统一 JSON 响应、错误体与跨域策略。

   跨域口径（2026-11-07 定：镜像域只读；2026-11-15 单点放开）
   · pages.dev 是本站主域，同源请求不涉及 CORS；
   · 镜像域 wow-blog.app.workbuddy.host 没有 Functions，页面仍然要能看榜，
     所以只对它放行 **GET**，写入必须回主域；
   · 例外：/api/wallpapers/stats 传 { write: true }，额外放行 POST ——
     镜像访客的「下载 / 收藏」计数得能写回主站，否则镜像流量全丢。
     榜单提交不开这个口子，镜像仍然只读。
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

/* 默认只给白名单来源、且只给 GET/HEAD 加 CORS 头。
   opts.write = true 时额外放行 POST —— 仅壁纸统计接口（/api/wallpapers/stats）用：
   镜像域没有 Functions，页面上的「下载/收藏」要把计数写回主站，
   不让 POST 跨域的话镜像访客的这两个动作就白做了。
   榜单提交（/api/scores/*）不走 write，镜像仍然是只读。 */
export function corsHeaders(request, method, opts) {
  const headers = {};
  const origin = request.headers.get("Origin");
  if (!origin || READ_ORIGINS.indexOf(origin) === -1) return headers;
  const m = String(method || request.method || "GET").toUpperCase();
  const allowed = m === "GET" || m === "HEAD" || (!!(opts && opts.write) && m === "POST");
  if (!allowed) return headers;
  headers["access-control-allow-origin"] = origin;
  headers["vary"] = "Origin";
  return headers;
}

export function json(request, data, status, extraHeaders, opts) {
  const headers = baseHeaders();
  const cors = corsHeaders(request, null, opts);
  Object.keys(cors).forEach(function (k) { headers[k] = cors[k]; });
  if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}

/* 统一的失败体：{ error, message }
   error 是给前端判分支的稳定码，message 是给人看的说明。 */
export function fail(request, status, error, message, extraHeaders, opts) {
  const body = { error: error };
  if (message) body.message = message;
  return json(request, body, status, extraHeaders, opts);
}

/* 预检：镜像域的读请求；opts.write 时对同一来源额外放行 POST */
export function preflight(request, opts) {
  const origin = request.headers.get("Origin");
  const allowed = !!origin && READ_ORIGINS.indexOf(origin) !== -1;
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (allowed) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = (opts && opts.write) ? "GET, HEAD, POST" : "GET, HEAD";
    headers["access-control-allow-headers"] = "content-type";
    headers["access-control-max-age"] = "86400";
    headers["vary"] = "Origin";
  }
  return new Response(null, { status: allowed ? 204 : 403, headers });
}
