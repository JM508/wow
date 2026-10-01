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

/* 上游偶发连不通（Workers 出口 → 云服务偶尔超时/抖动）会直接把
   upstream_unreachable 甩给页面，表现为「排行榜一会儿能看一会儿连不上」。
   同一请求快速重试一次能消掉绝大部分抖动：
   · 网络层异常（连接失败/超时，请求大概率没送达）→ 所有方法都重试；
   · 上游明确回了 502/503/504 → 只对幂等的 GET/HEAD 重试，
     避免 POST（提交成绩）在上游其实已写入时重复插入。 */
const UPSTREAM_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 400;

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

  /* body 先落地成 ArrayBuffer：可跨重试复用（流式 body 只能读一次） */
  let body;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  /* 带一次重试的转发；signal 每次尝试都要新建（旧的可能已 aborted） */
  const attemptFetch = () => fetch(UPSTREAM_ORIGIN + url.pathname + url.search, {
    method: request.method,
    headers,
    redirect: "manual",
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  });

  let res;
  try {
    res = await attemptFetch();
    const retryable = request.method === "GET" || request.method === "HEAD";
    if (retryable && res.status >= 502 && res.status <= 504) {
      try { if (res.body) await res.body.cancel(); } catch (e) { /* 忽略 */ }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      res = await attemptFetch();
    }
  } catch (e) {
    try {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      res = await attemptFetch();
    } catch (e2) {
      return new Response(
        JSON.stringify({
          error: "upstream_unreachable",
          error_description: String((e2 && e2.message) || e2)
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
