/* ══════════════════════════════════════════════════════════════
   PWA 安装引导（全站，2026-10-22）
   ──────────────────────────────────────────────────────────────
   · Android / 桌面 Chromium：监听 beforeinstallprompt，先把事件留住
     （preventDefault 后浏览器不再自动弹），等我们自己的条幅出现再触发。
   · iOS / iPadOS Safari：没有 beforeinstallprompt，只能给「分享 → 添加到
     主屏幕」的文字指引；用 navigator.standalone 判断是否已装。
   · 已经以独立窗口运行的（display-mode: standalone）一律不打扰。
   · 点「以后再说」记 7 天，避免每次进站都冒出来；装好（appinstalled）直接清掉。
   · 纯外链脚本，无内联代码 / 内联样式（CSP script-src 'self'、style-src 'self'）。
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var KEY = "wow-pwa-hint-v1";
  var SNOOZE_MS = 7 * 24 * 3600 * 1000;
  var BAR_ID = "pwa-bar";

  function store(read) {
    try {
      if (read) return JSON.parse(localStorage.getItem(KEY) || "null");
      localStorage.setItem(KEY, JSON.stringify({ at: Date.now() }));
    } catch (e) {}
    return null;
  }

  function isStandalone() {
    try {
      if (global.matchMedia && global.matchMedia("(display-mode: standalone)").matches) return true;
    } catch (e) {}
    return !!global.navigator.standalone;
  }

  function isIOS() {
    var ua = global.navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    /* iPadOS 13+ 的 Safari 把自己伪装成 Mac：靠触摸点数量区分 */
    return /Macintosh/.test(ua) && (global.navigator.maxTouchPoints || 0) > 1;
  }

  function snoozed() {
    var v = store(true);
    return !!(v && v.at && Date.now() - v.at < SNOOZE_MS);
  }

  var deferred = null;      // beforeinstallprompt 事件
  var shown = false;

  function bar() {
    return document.getElementById(BAR_ID);
  }

  function hide() {
    shown = false;
    var el = bar();
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function build(ios) {
    var el = document.createElement("div");
    el.id = BAR_ID;
    el.className = "pwa-bar";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "安装到桌面");

    var txt = document.createElement("span");
    txt.className = "pwa-txt";
    txt.textContent = ios
      ? "添加到主屏幕：点 Safari 底部的「分享」，选「添加到主屏幕」"
      : "安装到桌面：离线也能玩，打开更快";

    var ok = document.createElement("button");
    ok.type = "button";
    ok.className = "pwa-btn";
    ok.id = "pwa-install";
    ok.textContent = ios ? "知道了" : "安装";

    var no = document.createElement("button");
    no.type = "button";
    no.className = "pwa-x";
    no.id = "pwa-later";
    no.setAttribute("aria-label", "以后再说");
    no.textContent = "\u2715";

    el.appendChild(txt);
    el.appendChild(ok);
    el.appendChild(no);
    document.body.appendChild(el);

    ok.addEventListener("click", function () {
      if (ios || !deferred) { hide(); return; }
      var ev = deferred;
      deferred = null;
      hide();
      try {
        ev.prompt();
        if (ev.userChoice && ev.userChoice.then) {
          ev.userChoice.then(function (r) {
            /* 用户选了「安装」就不再打扰；选「取消」按以后再说处理 */
            if (!r || r.outcome !== "accepted") store(false);
          })["catch"](function () {});
        }
      } catch (e) {}
    });
    no.addEventListener("click", function () {
      store(false);
      hide();
    });
    return el;
  }

  function show(ios) {
    if (shown || !document.body) return false;
    if (isStandalone() || snoozed()) return false;
    shown = true;
    build(!!ios);
    return true;
  }

  global.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    /* 不抢首屏：等页面安静下来再提示 */
    setTimeout(function () { if (!shown) show(false); }, 9000);
  });

  global.addEventListener("appinstalled", function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    deferred = null;
    hide();
  });

  /* iOS 没有事件可等：进站 12 秒后仍留在页面上再提示一次 */
  if (isIOS() && !isStandalone()) {
    setTimeout(function () { show(true); }, 12000);
  }

  /* 设置页签里的「安装到桌面」按钮：能装就直接弹，不能装就给文字说明 */
  function onButton() {
    var btn = document.getElementById("me-pwa-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var hint = document.getElementById("me-pwa-hint");
      if (deferred) {
        var ev = deferred;
        deferred = null;
        try { ev.prompt(); } catch (e) {}
        return;
      }
      if (hint) {
        if (isStandalone()) hint.textContent = "已经在独立窗口里运行了，不用再安装。";
        else if (isIOS()) hint.textContent = "iOS：Safari 底部「分享」→「添加到主屏幕」。";
        else hint.textContent = "这个浏览器没有提供安装入口，可以试试 Chrome / Edge 的「安装应用」。";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onButton);
  } else {
    onButton();
  }

  global.WowPwa = {
    canInstall: function () { return !!deferred; },
    show: function () { return show(isIOS()); },
    hide: hide
  };
})(window);
