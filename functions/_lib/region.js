/* ══════════════════════════════════════════════════════════════
   IP 属地（省级）—— 服务端唯一口径
   ──────────────────────────────────────────────────────────────
   来源是 Cloudflare 边缘的 request.cf（客户端伪造不了），
   只有省份/地区名，**任何情况下都不返回 IP 本身**。

   2026-11-15 收口到省级：此前国内输出「省 市」（如「广东 深圳」），
   榜单上一行太长，用户要求只显示省份。城市级映射已随之删除。

   两处共用：
     · functions/_middleware.js  → /.ip 端点（前端预取后随成绩提交）
     · functions/_lib/ms.js      → 提交成绩时服务端直接判定（首选，前端取不到也有）
   ══════════════════════════════════════════════════════════════ */

/* 中国省级行政区：CF 的 region/regionCode/city 里常见的中英名 → 省名。
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

/* 主要城市 → 省级行政区（CF 只给 city 时的兜底，用拼音前缀匹配） */
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

/* 单个候选值的匹配。
   allowPrefix=false 时只认全等；true 时允许「以该别名开头」，但**只对 4 个字符以上的
   别名生效**——两位缩写（sh / bj / sd …）做前缀会把 Shenzhen 认成上海、
   Shijiazhuang 认成上海，这是 2026-11-15 之前一直存在的错判，这里一并收掉。 */
function matchProvince(value, allowPrefix) {
  const lv = String(value == null ? "" : value).toLowerCase().trim();
  if (!lv) return null;
  for (let i = 0; i < CN_REGIONS.length; i++) {
    const aliases = CN_REGIONS[i];
    for (let k = 1; k < aliases.length; k++) {
      const a = aliases[k];
      if (lv === a) return aliases[0];
      if (allowPrefix && a.length >= 4 && lv.indexOf(a) === 0) return aliases[0];
    }
  }
  return null;
}

function cnRegionName(cf) {
  const candidates = [cf.region, cf.regionCode, cf.city];
  /* 先全等、再前缀：省的拼音名（guangdong / zhejiang）都是长词，
     按候选优先级走，region 命中就不会再被 city 抢先。 */
  let hit = null;
  for (let i = 0; i < candidates.length && !hit; i++) hit = matchProvince(candidates[i], false);
  for (let i = 0; i < candidates.length && !hit; i++) hit = matchProvince(candidates[i], true);
  if (hit) return hit;
  /* 兜底：CF 有时只给 city，用主要城市名映射回省份 */
  const lv = String(cf.city || "").toLowerCase();
  if (lv) {
    for (let i = 0; i < CN_CITIES.length; i++) {
      if (lv.indexOf(CN_CITIES[i][1]) === 0) return CN_CITIES[i][0];
    }
  }
  return null;
}

/* 只保留省/地区名：历史数据里有「广东 深圳」这种带城市的写法，
   显示与写库都统一取第一段（2026-11-15 用户要求「只显示哪个省」）。 */
export function provinceOnly(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return null;
  const head = s.split(/\s+/)[0];
  return head ? head.slice(0, 32) : null;
}

/* 属地字符串（≤32 字，与库约束一致）；取不到就 null，前端静默跳过。
   国内 → 省名；港澳台 → 「中国香港 / 中国澳门 / 中国台湾」；海外 → 国家名。 */
export function regionOf(request) {
  const cf = request && request.cf;
  if (!cf) return null;
  const country = cf.country || null;
  if (country === "CN") return cnRegionName(cf) || "中国";
  if (country === "HK") return "中国香港";
  if (country === "MO") return "中国澳门";
  if (country === "TW") return "中国台湾";
  if (country && COUNTRY_ZH[country]) return COUNTRY_ZH[country];
  if (country) return "海外";
  return null;
}
