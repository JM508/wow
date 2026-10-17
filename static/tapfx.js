/* ══════════════════════════════════════════════════════════════
   点按反馈（2026-10-17）
   ──────────────────────────────────────────────────────────────
   · 站内可点元素（按钮 / 游戏卡片 / 返回按钮）按下时，从落点扩散一个
     半透明水波，0.5 秒淡出 —— 让「点到了」这件事有手感。
   · 悬停放大 + 阴影加深由各自页面的 CSS 负责，这里只补涟漪。
   · 网格格子（扫雷 .ms-cell、井字棋 .ttt-cell）不参与：
     它们的 innerHTML 会被插旗 / 落子整块重写，往里塞节点容易打架。
   · 尊重 prefers-reduced-motion：系统开了「减少动态效果」就整个不启用。
   · 外链脚本、无内联代码（CSP 同源白名单）。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var SEL = "button, .games-row, .games-entry-btn, .site-back";
  var SKIP = /(^|\s)(ms-cell|ttt-cell)(\s|$)/;

  function reduced() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  function ripple(el, clientX, clientY) {
    var r = el.getBoundingClientRect();
    var w = r.width || el.offsetWidth || 40;
    var h = r.height || el.offsetHeight || 40;
    var size = Math.max(w, h) * 2.2;
    var x = typeof clientX === "number" && clientX ? clientX - r.left : w / 2;
    var y = typeof clientY === "number" && clientY ? clientY - r.top : h / 2;
    var s = document.createElement("span");
    s.className = "tap-ripple";
    s.setAttribute("aria-hidden", "true");
    /* 尺寸与落点用 CSSOM 赋值（CSP 的 style-src 'self' 会拦内联 style 属性） */
    s.style.width = size + "px";
    s.style.height = size + "px";
    s.style.left = x + "px";
    s.style.top = y + "px";
    el.appendChild(s);
    window.setTimeout(function () {
      if (s.parentNode) s.parentNode.removeChild(s);
    }, 520);
  }

  document.addEventListener("pointerdown", function (e) {
    if (e.button !== undefined && e.button > 0) return;            // 只认主键 / 触摸
    var t = e.target;
    var el = t && t.closest ? t.closest(SEL) : null;
    if (!el || el.disabled) return;
    if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return;
    var cls = typeof el.className === "string" ? el.className : "";
    if (SKIP.test(cls)) return;
    if (reduced()) return;
    el.classList.add("tap-host");
    ripple(el, e.clientX, e.clientY);
  }, { passive: true });
})();
