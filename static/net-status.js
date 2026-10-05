/* ══════════════════════════════════════════════════════════════
   离线提示条：断网时在页面顶部显示一条提示（用户 2026-10-05 要求）
   ──────────────────────────────────────────────────────────────
   · 判定来源两个，任意一个说「没网」就显示：
       ① navigator.onLine === false（浏览器自己的说法）
       ② Service Worker 回报：最近一次页面导航是靠缓存兜住的
          —— 手机「连着 Wi-Fi 但没有出口」时 navigator.onLine 会撒谎，
             这时只有 SW 知道真相（见 sw.js 的 net:probe 消息）
   · 纯外链脚本、无内联代码（CSP 同源白名单）
   · 页面没引这个脚本时什么都不发生，属于渐进增强
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var el = null;
  var swOffline = false;      // SW 回报的离线状态

  function ensure() {
    if (el && el.parentNode) return el;
    if (!document.body) return null;
    el = document.createElement("div");
    el.id = "net-status";
    el.className = "net-status";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    return el;
  }

  function isOffline() {
    return navigator.onLine === false || swOffline === true;
  }

  function paint() {
    var off = isOffline();
    var box = ensure();
    if (!box) return;
    if (off) {
      box.textContent = "当前无网络 · 离线模式：已缓存的小游戏仍可继续玩";
      box.classList.add("is-on");
      document.documentElement.classList.add("has-net-status");
    } else {
      box.textContent = "";
      box.classList.remove("is-on");
      document.documentElement.classList.remove("has-net-status");
    }
  }

  /* 问 Service Worker 一句实话：这次页面是不是从缓存里拿出来的 */
  function askSW() {
    try {
      var sw = navigator.serviceWorker;
      if (!sw || !sw.controller) { swOffline = false; paint(); return; }
      var ch = new MessageChannel();
      ch.port1.onmessage = function (e) {
        swOffline = !!(e.data && e.data.offline);
        paint();
      };
      sw.controller.postMessage({ type: "net:probe" }, [ch.port2]);
    } catch (e) {
      paint();
    }
  }

  window.addEventListener("online", function () { swOffline = false; paint(); askSW(); });
  window.addEventListener("offline", paint);
  if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
    navigator.serviceWorker.addEventListener("controllerchange", askSW);
    navigator.serviceWorker.ready.then(askSW).catch(function () {});
  }

  function boot() {
    paint();          // 先按 navigator.onLine 画一版，不让用户等
    askSW();          // 再问 SW 要准确答案（断网打开的页面会立刻补上提示）
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
