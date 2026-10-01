/* ══════════════════════════════════════════════════════════════
   Cloudflare Pages Function —— 云服务同源代理（仅 /.cloud/* 生效）
   ──────────────────────────────────────────────────────────────
   背景：云服务端对请求的 Origin 做「精确匹配」，白名单里只有本应用的
   发布域（wow-blog.app.workbuddy.host）和本地回环。因此 Cloudflare
   主站（wow-d9s.pages.dev）直连云服务会被 403 access_denied 拒绝。

   做法：主站页面改把请求发到「本站同源」的 /.cloud/*，由本函数转发到
   发布域，并把 Origin 改写成白名单认可的值。对页面来说是同源请求，
   CSP 的 connect-src 'self' 即可覆盖，也不涉及 CORS。

   安全：只放行「本站自己的页面」发起的请求。浏览器会强制附带
   Sec-Fetch-Site / Origin，页面脚本无法伪造这两个头，
   因此第三方站点无法借用本站当作绕过 Origin 校验的跳板。
   ══════════════════════════════════════════════════════════════ */

const UPSTREAM_ORIGIN = "https://wow-blog.app.workbuddy.host";
const CLOUD_PREFIX = "/.cloud";

/* 转发时要剔除的逐跳头 / 会与新响应体冲突的头 */
const STRIP_RESPONSE_HEADERS = [
  "content-encoding", "content-length", "transfer-encoding", "connection",
  "keep-alive", "upgrade", "set-cookie",
  "access-control-allow-origin", "access-control-allow-credentials",
  "access-control-allow-methods", "access-control-allow-headers",
  "access-control-expose-headers"
];

/* 只在同一个 Cloudflare Pages 项目内转发，上游固定，不接受任意目标 */
function isCloudPath(pathname) {
  return pathname === CLOUD_PREFIX || pathname.indexOf(CLOUD_PREFIX + "/") === 0;
}

function deny(reason) {
  return new Response(
    JSON.stringify({ error: "forbidden_origin", error_description: reason }),
    {
      status: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  /* 非云接口请求原样交给静态资源，零影响 */
  if (!isCloudPath(url.pathname)) return next();

  const self = url.origin;

  /* 浏览器强制头：跨站请求一定带 cross-site，本页请求是 same-origin。
     页面 JS 无法改写这两个头，所以这层判定等价于服务端的 Origin 校验。 */
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return deny("cross-site request rejected");

  const origin = request.headers.get("Origin");
  if (origin && origin !== self) return deny("cross-site request rejected");

  /* 两个头都没有 = 不是浏览器发的（或浏览器过旧）：同样不放行，
     否则本站会变成任何人绕过 Origin 校验的跳板。
     现代浏览器的同源请求至少会带 Sec-Fetch-Site，正常用户不受影响。 */
  if (!site && !origin) return deny("missing fetch metadata");

  /* 转发头：Origin 换成白名单里的发布域，这是整个代理的关键一步 */
  const headers = new Headers(request.headers);
  headers.set("Origin", UPSTREAM_ORIGIN);
  headers.delete("Referer");
  headers.delete("Host");
  headers.delete("CF-Connecting-IP");
  headers.delete("CF-IPCountry");
  headers.delete("CF-Ray");
  headers.delete("Sec-Fetch-Site");
  headers.delete("Sec-Fetch-Mode");
  headers.delete("Sec-Fetch-Dest");
  headers.delete("Sec-Fetch-User");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(20000)
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  let res;
  try {
    res = await fetch(UPSTREAM_ORIGIN + url.pathname + url.search, init);
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "upstream_unreachable",
        error_description: String((e && e.message) || e)
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        }
      }
    );
  }

  /* Workers 的 fetch 会自动解压响应体，因此不能再原样带上 content-encoding */
  const out = new Headers(res.headers);
  STRIP_RESPONSE_HEADERS.forEach(function (h) { out.delete(h); });
  if (!out.has("cache-control")) out.set("cache-control", "no-store");

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: out
  });
}
