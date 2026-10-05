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

/* PostgREST OpenAPI 文档根路径（P-2）：暴露全部表结构、字段、技术栈版本与
   内网拓扑。publishableKey 本就公开，等于把攻击面地图送给攻击者。
   只拦文档根：真实数据路径都带表名段（/database/rest/<table>、/rpc/<fn>），不受影响。 */
function isOpenApiRoot(pathname) {
  const rest = CLOUD_PREFIX + "/database/rest";
  return pathname === rest || pathname === rest + "/";
}

function notFound() {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
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

/* ══════════════════════════════════════════════════════════════
   /.ip —— 排行榜「IP 属地」数据端点（只给省级/国家级，绝不返回 IP 本身）
   ──────────────────────────────────────────────────────────────
   数据来自 Cloudflare 边缘自带的 request.cf（客户端无法伪造）：
   中国大陆访客 → 省级行政区中文名；海外访客 → 国家/地区中文名。
   镜像域页面（connect-src 允许）会跨域 GET 本端点，所以带精确 Origin 白名单的 CORS。
   ══════════════════════════════════════════════════════════════ */

/* 中国省级行政区：CF 的 region/regionCode/city 里常见的中英名 → 属地名。
   注意：港/澳/台按规范冠以「中国」。 */
const CN_REGIONS = [
  ["北京", "beijing", "北京", "bj"],
  ["天津", "tianjin", "天津", "tj"],
  ["上海", "shanghai", "上海", "sh"],
  ["重庆", "chongqing", "重庆", "cq"],
  ["河北", "hebei", "河北", "he"],
  ["山西", "shanxi", "山西", "sx"],
  ["辽宁", "liaoning", "辽宁", "ln"],
  ["吉林", "jilin", "吉林", "jl"],
  ["黑龙江", "heilongjiang", "黑龙江", "hl"],
  ["江苏", "jiangsu", "江苏", "js"],
  ["浙江", "zhejiang", "浙江", "zj"],
  ["安徽", "anhui", "安徽", "ah"],
  ["福建", "fujian", "福建", "fj"],
  ["江西", "jiangxi", "江西", "jx"],
  ["山东", "shandong", "山东", "sd"],
  ["河南", "henan", "河南", "ha"],
  ["湖北", "hubei", "湖北", "hb"],
  ["湖南", "hunan", "湖南", "hn"],
  ["广东", "guangdong", "广东", "gd"],
  ["海南", "hainan", "海南", "hi"],
  ["四川", "sichuan", "四川", "sc"],
  ["贵州", "guizhou", "贵州", "gz"],
  ["云南", "yunnan", "云南", "yn"],
  ["陕西", "shaanxi", "陕西", "sn"],
  ["甘肃", "gansu", "甘肃", "gs"],
  ["青海", "qinghai", "青海", "qh"],
  ["广西", "guangxi", "广西", "gx"],
  ["内蒙古", "neimenggu", "inner mongolia", "内蒙古", "nm"],
  ["宁夏", "ningxia", "宁夏", "nx"],
  ["新疆", "xinjiang", "新疆", "xj"],
  ["西藏", "xizang", "tibet", "西藏", "xz"],
  ["中国香港", "hong kong", "香港", "hk"],
  ["中国澳门", "macau", "macao", "澳门", "mo"],
  ["中国台湾", "taiwan", "台湾", "tw"]
];

/* 常见海外国家/地区 ISO 码 → 中文名；表外一律「海外」 */
const COUNTRY_ZH = {
  US: "美国", JP: "日本", KR: "韩国", SG: "新加坡", MY: "马来西亚",
  TH: "泰国", VN: "越南", PH: "菲律宾", ID: "印度尼西亚", IN: "印度",
  GB: "英国", FR: "法国", DE: "德国", IT: "意大利", ES: "西班牙",
  NL: "荷兰", PT: "葡萄牙", IE: "爱尔兰", AT: "奥地利", CH: "瑞士",
  SE: "瑞典", NO: "挪威", DK: "丹麦", FI: "芬兰", PL: "波兰",
  CZ: "捷克", HU: "匈牙利", GR: "希腊", RU: "俄罗斯", UA: "乌克兰",
  TR: "土耳其", IL: "以色列", AE: "阿联酋", SA: "沙特阿拉伯",
  CA: "加拿大", MX: "墨西哥", BR: "巴西", AR: "阿根廷",
  AU: "澳大利亚", NZ: "新西兰", ZA: "南非"
};

function cnRegionName(cf) {
  const candidates = [cf.region, cf.regionCode, cf.city];
  for (let i = 0; i < CN_REGIONS.length; i++) {
    const aliases = CN_REGIONS[i];
    for (let j = 0; j < candidates.length; j++) {
      const v = candidates[j];
      if (!v) continue;
      const lv = String(v).toLowerCase();
      for (let k = 1; k < aliases.length; k++) {
        if (lv === aliases[k] || lv.indexOf(aliases[k]) === 0) return aliases[0];
      }
    }
  }
  /* 兜底：CF 有时只给 city，用主要城市名映射 */
  const lv = String(cf.city || "").toLowerCase();
  if (lv) {
    for (let i = 0; i < CN_CITIES.length; i++) {
      if (lv.indexOf(CN_CITIES[i][1]) === 0) return CN_CITIES[i][0];
    }
  }
  return null;
}

/* 主要城市 → 省级行政区（拼音小写前缀匹配） */
const CN_CITIES = [
  ["广东", "guangzhou"], ["广东", "shenzhen"], ["广东", "dongguan"], ["广东", "foshan"],
  ["江苏", "nanjing"], ["江苏", "suzhou"], ["江苏", "wuxi"], ["江苏", "changzhou"],
  ["浙江", "hangzhou"], ["浙江", "ningbo"], ["浙江", "wenzhou"],
  ["山东", "jinan"], ["山东", "qingdao"], ["山东", "yantai"],
  ["河南", "zhengzhou"], ["河南", "luoyang"],
  ["湖北", "wuhan"], ["湖北", "yichang"],
  ["湖南", "changsha"], ["湖南", "zhuzhou"],
  ["四川", "chengdu"], ["四川", "mianyang"],
  ["福建", "fuzhou"], ["福建", "xiamen"], ["福建", "quanzhou"],
  ["安徽", "hefei"], ["河北", "shijiazhuang"], ["河北", "tangshan"],
  ["山西", "taiyuan"], ["江西", "nanchang"],
  ["辽宁", "shenyang"], ["辽宁", "dalian"],
  ["吉林", "changchun"], ["黑龙江", "haerbin"], ["黑龙江", "harbin"],
  ["陕西", "xian"], ["陕西", "xianyang"],
  ["甘肃", "lanzhou"], ["贵州", "guiyang"], ["云南", "kunming"],
  ["广西", "nanning"], ["海南", "haikou"], ["海南", "sanya"],
  ["新疆", "wulumuqi"], ["新疆", "urumqi"], ["内蒙古", "huhehaote"],
  ["内蒙古", "hohhot"], ["宁夏", "yinchuan"], ["青海", "xining"], ["西藏", "lhasa"]
];

/* 2026-10-05 用户要求属地精确到市：CF 的 cf.city 是英文城市名 → 中文名。
   覆盖国内主要城市；表外城市沿用省级展示（不至于空白）。 */
const CN_CITY_ZH = {
  beijing:"北京", tianjin:"天津", shanghai:"上海", chongqing:"重庆",
  guangzhou:"广州", shenzhen:"深圳", dongguan:"东莞", foshan:"佛山", zhuhai:"珠海", zhongshan:"中山", huizhou:"惠州",
  nanjing:"南京", suzhou:"苏州", wuxi:"无锡", changzhou:"常州", nantong:"南通", xuzhou:"徐州", yangzhou:"扬州",
  hangzhou:"杭州", ningbo:"宁波", wenzhou:"温州", jiaxing:"嘉兴", shaoxing:"绍兴", jinhua:"金华",
  jinan:"济南", qingdao:"青岛", yantai:"烟台", weifang:"潍坊", linyi:"临沂",
  zhengzhou:"郑州", luoyang:"洛阳", kaifeng:"开封", xinxiang:"新乡",
  wuhan:"武汉", yichang:"宜昌", xiangyang:"襄阳",
  changsha:"长沙", zhuzhou:"株洲", xiangtan:"湘潭", hengyang:"衡阳",
  chengdu:"成都", mianyang:"绵阳", deyang:"德阳",
  fuzhou:"福州", xiamen:"厦门", quanzhou:"泉州", zhangzhou:"漳州",
  hefei:"合肥", wuhu:"芜湖",
  shijiazhuang:"石家庄", tangshan:"唐山", baoding:"保定",
  taiyuan:"太原", nanchang:"南昌", ganzhou:"赣州",
  shenyang:"沈阳", dalian:"大连", anshan:"鞍山",
  changchun:"长春", jilin:"吉林", harbin:"哈尔滨", haerbin:"哈尔滨", daqing:"大庆",
  xian:"西安", xianyang:"咸阳",
  lanzhou:"兰州", guiyang:"贵阳", kunming:"昆明", qujing:"曲靖",
  nanning:"南宁", liuzhou:"柳州", haikou:"海口", sanya:"三亚",
  wulumuqi:"乌鲁木齐", urumqi:"乌鲁木齐", huhehaote:"呼和浩特", hohhot:"呼和浩特",
  yinchuan:"银川", xining:"西宁", lhasa:"拉萨"
};

/* 属地字符串（≤32 字，与库约束一致）；取不到就 null，前端静默跳过。
   2026-10-05 用户要求精确到市：国内输出「省 市」（如「广东 深圳」），
   直辖市与省级同名时只输出一遍（如「上海」）；海外仍到国家。 */
function regionOf(request) {
  const cf = request.cf;
  if (!cf) return null;
  const country = cf.country || null;
  if (country === "CN") {
    const prov = cnRegionName(cf);
    const city = cf.city ? CN_CITY_ZH[String(cf.city).toLowerCase()] : null;
    if (prov && city && city !== prov) return (prov + " " + city);
    if (prov) return prov;
    if (city) return city;
    return "中国";
  }
  if (country === "HK") return "中国香港";
  if (country === "MO") return "中国澳门";
  if (country === "TW") return "中国台湾";
  if (country && COUNTRY_ZH[country]) return COUNTRY_ZH[country];
  if (country) return "海外";
  return null;
}

/* /.ip 只允许本站页面（same-origin）与镜像域页面（白名单 Origin）读取 */
function ipInfo(request, url) {
  const self = url.origin;
  const allowOrigin = ["https://wow-blog.app.workbuddy.host"];
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");

  const sameOrigin = (site && site === "same-origin") || (!origin && !site);
  const mirrorOrigin = origin && allowOrigin.indexOf(origin) !== -1;
  if (!sameOrigin && !mirrorOrigin) return deny("cross-site request rejected");

  const region = regionOf(request);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  };
  if (origin && allowOrigin.indexOf(origin) !== -1) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return new Response(JSON.stringify({ region: region }), { headers });
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  /* 排行榜 IP 属地端点：先于云代理短路处理 */
  if (url.pathname === "/.ip") return ipInfo(request, url);

  /* 渗透测试修复（2026-10-05）：服务器源码不允许被当静态资源下载。
     public 里必须保留 server.js（镜像部署入口），故用 Functions 拦，
     _redirects 的 404 状态码 CF Pages 不支持。 */
  if (url.pathname === "/server.js") return notFound();

  /* 非云接口请求原样交给静态资源，零影响 */
  if (!isCloudPath(url.pathname)) return next();

  /* OpenAPI 文档根：无论来源一律 404（防结构泄漏） */
  if (isOpenApiRoot(url.pathname)) return notFound();

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
