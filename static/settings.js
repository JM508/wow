/* ══════════════════════════════════════════════════════════════
   设置页（/settings/，2026-10-17）
   ──────────────────────────────────────────────────────────────
   把个人中心里的「设置」搬到独立页面：
     · 浅色主题（与页头开关同一套 data-theme / sessionStorage）
     · 无障碍三开关（大字号 / 减少动效 / 高对比）
   读写口径与 /meplus.js 完全一致：
     localStorage["wow-a11y-v1"] = { big, calm, hc }
     sessionStorage["pref-theme"] = "light" | "dark"
   只在本机生效，不写云端、不跟账号同步。
   纯外链脚本，无内联代码（CSP 同源白名单）。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var root = document.getElementById("set-root");
  if (!root) return;

  var html = document.documentElement;
  var KEY = "wow-a11y-v1";

  var btnBig = document.getElementById("set-big");
  var btnCalm = document.getElementById("set-calm");
  var btnHc = document.getElementById("set-hc");
  var btnTheme = document.getElementById("set-theme");
  var btnReset = document.getElementById("set-reset");
  var hintEl = document.getElementById("set-hint");

  function load() {
    var o = { big: false, calm: false, hc: false };
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && typeof raw === "object") {
        o.big = !!raw.big;
        o.calm = !!raw.calm;
        o.hc = !!raw.hc;
      }
    } catch (e) {}
    return o;
  }

  var A11Y = load();

  function apply() {
    html.classList.toggle("a11y-big", !!A11Y.big);
    html.classList.toggle("a11y-calm", !!A11Y.calm);
    html.classList.toggle("a11y-hc", !!A11Y.hc);
  }

  function paintTheme() {
    if (!btnTheme) return;
    var light = html.dataset.theme === "light";
    btnTheme.classList.toggle("is-on", light);
    btnTheme.setAttribute("aria-checked", light ? "true" : "false");
  }

  function paint() {
    var pairs = [[btnBig, A11Y.big], [btnCalm, A11Y.calm], [btnHc, A11Y.hc]];
    for (var i = 0; i < pairs.length; i++) {
      var el = pairs[i][0];
      if (!el) continue;
      el.classList.toggle("is-on", !!pairs[i][1]);
      el.setAttribute("aria-checked", pairs[i][1] ? "true" : "false");
    }
    paintTheme();
  }

  /* 屏幕阅读器也能听到结果：开关本身有 aria-checked，这里补一句文字反馈 */
  function say(text) {
    if (hintEl) hintEl.textContent = text;
  }

  function save(a11y) {
    try { localStorage.setItem(KEY, JSON.stringify(A11Y)); } catch (e) {}
    apply();
    paint();
    if (a11y) {
      document.dispatchEvent(new CustomEvent("a11y:change", {
        detail: { big: !!A11Y.big, calm: !!A11Y.calm, hc: !!A11Y.hc },
      }));
    }
  }

  if (btnBig) btnBig.addEventListener("click", function () {
    A11Y.big = !A11Y.big; save(true); say(A11Y.big ? "已开启大字号" : "已关闭大字号");
  });
  if (btnCalm) btnCalm.addEventListener("click", function () {
    A11Y.calm = !A11Y.calm; save(true); say(A11Y.calm ? "已开启减少动效" : "已关闭减少动效");
  });
  if (btnHc) btnHc.addEventListener("click", function () {
    A11Y.hc = !A11Y.hc; save(true); say(A11Y.hc ? "已开启高对比" : "已关闭高对比");
  });

  if (btnTheme) {
    btnTheme.addEventListener("click", function () {
      var to = html.dataset.theme === "light" ? "dark" : "light";
      html.dataset.theme = to;
      try { sessionStorage.setItem("pref-theme", to); } catch (e) {}
      paintTheme();
      say(to === "light" ? "已切换到浅色主题" : "已切换到深色主题");
      document.dispatchEvent(new CustomEvent("theme:change", { detail: to }));
    });
  }

  if (btnReset) {
    btnReset.addEventListener("click", function () {
      A11Y = { big: false, calm: false, hc: false };
      html.dataset.theme = "dark";
      try { sessionStorage.setItem("pref-theme", "dark"); } catch (e) {}
      save(true);
      say("已恢复默认设置");
      document.dispatchEvent(new CustomEvent("theme:change", { detail: "dark" }));
    });
  }

  apply();
  paint();

  /* 供测试与探针读取状态 */
  window.__setState = function () {
    return {
      big: !!A11Y.big,
      calm: !!A11Y.calm,
      hc: !!A11Y.hc,
      theme: html.dataset.theme || "dark",
      classes: html.className,
    };
  };
})();
