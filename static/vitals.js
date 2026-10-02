/* ══════════════════════════════════════════════════════════════
   核心 Web 指标监控（真实用户采集 / RUM）
   ──────────────────────────────────────────────────────────────
   · 指标：TTFB / FCP / LCP / CLS / INP（Google Core Web Vitals 口径）
   · 上报：页面隐藏（或卸载）时一次性批量 POST 到自有云表 site_vitals，
     走站点同源 /.cloud/* 代理（CSP connect-src 'self' 即可，无第三方）。
     表在云服务里，匿名只可插入、不可读取，无任何用户身份信息。
   · 兼容：无 PerformanceObserver / 老浏览器直接跳过，不报错、不影响页面。
   · 外链脚本、无内联代码（全站 CSP 同源白名单，禁 unsafe-inline）
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (!window.performance || !window.PerformanceObserver) return;

  var rows = [];
  var sent = false;

  function device() {
    try {
      if (window.matchMedia("(pointer: coarse)").matches) return "mobile";
    } catch (e) {}
    return "desktop";
  }

  function add(metric, value, rating) {
    if (!isFinite(value) || value < 0) return;
    rows.push({
      metric: String(metric).slice(0, 32),
      value: Math.round(value * 1000) / 1000,
      rating: rating ? String(rating).slice(0, 16) : null,
      path: location.pathname.slice(0, 120),
      device: device()
    });
  }

  /* ── TTFB：导航开始 → 响应开始 ── */
  try {
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (nav && nav.responseStart) add("TTFB", nav.responseStart - nav.requestStart || nav.responseStart, nav.responseStart < 800 ? "good" : nav.responseStart < 1800 ? "needs-improvement" : "poor");
  } catch (e) {}

  function ratePaint(t) { return t < 1800 ? "good" : t < 3000 ? "needs-improvement" : "poor"; }
  function rateLcp(t) { return t < 2500 ? "good" : t < 4000 ? "needs-improvement" : "poor"; }
  function rateCls(v) { return v < 0.1 ? "good" : v < 0.25 ? "needs-improvement" : "poor"; }
  function rateInp(t) { return t < 200 ? "good" : t < 500 ? "needs-improvement" : "poor"; }

  /* ── FCP ── */
  try {
    new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) {
        if (es[i].name === "first-contentful-paint") add("FCP", es[i].startTime, ratePaint(es[i].startTime));
      }
    }).observe({ type: "paint", buffered: true });
  } catch (e) {}

  /* ── LCP：取最终值（页面隐藏时定格） ── */
  var lcpValue = 0;
  try {
    new PerformanceObserver(function (list) {
      var es = list.getEntries();
      if (es.length) {
        lcpValue = es[es.length - 1].startTime;
        add("LCP", lcpValue, rateLcp(lcpValue));
        /* 重复上报最终值：send 时以最大者为准 */
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {}

  /* ── CLS：布局偏移累加（不含输入后 500ms 内的偏移） ── */
  var clsValue = 0;
  try {
    new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (e.hadRecentInput) continue;
        clsValue += e.value || 0;
      }
      add("CLS", clsValue, rateCls(clsValue));
    }).observe({ type: "layout-shift", buffered: true });
  } catch (e) {}

  /* ── INP：取交互延迟的最大值 ── */
  var inpValue = 0;
  try {
    new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) {
        var d = es[i].duration || 0;
        if (d > inpValue) inpValue = d;
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16,
      eventTypes: ["pointerdown", "keydown", "click"] });
  } catch (e) {}

  /* ── 批量上报（一次会话一页只发一次） ── */
  function send() {
    if (sent || !rows.length) return;
    sent = true;
    if (inpValue > 0) add("INP", inpValue, rateInp(inpValue));
    /* 同一指标取最大值（LCP/CLS 的 observer 会随时间多次 add） */
    var best = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!best[r.metric] || r.value > best[r.metric].value) best[r.metric] = r;
    }
    var payload = [];
    for (var k in best) payload.push(best[k]);
    if (!payload.length) return;
    try {
      /* keepalive：页面即将卸载时也能发出 */
      fetch("/.cloud/database/rest/site_vitals", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify(payload)
      }).catch(function () {});
    } catch (e) {}
  }

  /* 页面隐藏（切走/最小化）即定格上报；pagehide 兜底 */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) send();
  });
  window.addEventListener("pagehide", send);
})();
