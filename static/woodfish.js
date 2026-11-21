/* ══════════════════════════════════════════════════════════════
   敲木鱼（/woodfish/，2026-11-21）
   ──────────────────────────────────────────────────────────────
   · 点一下木鱼：功德 +1、木鱼下压、槌子敲击、飘字、一声「笃」
   · 音效用 WebAudio 现场合成（三角波 + 快速衰减），不额外下音频文件；
     第一次点击时才建 AudioContext（浏览器要求用户手势后才能出声）
   · 累计次数存本机 localStorage（wow-wf-count-v1），换设备从 0 起；
     云排行榜只收「这台设备的累计次数」，由 wfrank.js 负责上报
   · 成就交给 gameach.js：本页 report({kind:"tap"}) 累计，1 万次解锁「手指酸痛者」
   · 纯外链脚本、无内联代码（CSP 同源白名单）。对外暴露 window.WowWoodfish
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var root = document.getElementById("wf-root");
  if (!root) return;

  var KEY = "wow-wf-count-v1";
  var MILESTONE = 10000;
  var SEND_EVERY = 12;          // 每敲 12 下上报一次
  var SEND_IDLE_MS = 10000;     // 或者停手 10 秒后补一次
  var FLY_MAX = 14;             // 同时存在的飘字上限，避免连点把 DOM 撑爆

  var elCount = document.getElementById("wf-count");
  var elSub = document.getElementById("wf-sub");
  var elHint = document.getElementById("wf-hint");
  var elFloat = document.getElementById("wf-float");
  var elFish = document.getElementById("wf-fish");
  var elStage = document.getElementById("wf-stage");

  var count = 0;
  var sinceSend = 0;
  var idleTimer = 0;
  var hitTimer = 0;
  var audio = null;
  var flying = 0;

  /* ── 本机计数 ── */
  function loadCount() {
    var n = 0;
    try { n = parseInt(localStorage.getItem(KEY) || "0", 10); } catch (e) { n = 0; }
    return isFinite(n) && n > 0 ? n : 0;
  }
  function saveCount() {
    try { localStorage.setItem(KEY, String(count)); } catch (e) {}
  }
  function fmt(n) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* ── 音效：合成的木鱼「笃」 ──
     先生一个高频三角波再迅速掉到低频，同时增益 0.2 秒内收到 0，
     听感接近木鱼被敲一下的「笃」；不依赖任何外部音频文件。 */
  function knock() {
    try {
      if (!audio) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        audio = new AC();
      }
      if (audio.state === "suspended" && audio.resume) audio.resume();
      var t = audio.currentTime;
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(430, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.12);
      gain.gain.setValueAtTime(0.26, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.17);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.19);
    } catch (e) { /* 没声卡 / 被策略拦：静默失败，不影响敲 */ }
  }

  /* ── 飘字：功德 +1 ──
     位置用 CSSOM 赋值（CSP 只拦 HTML 里的 style 属性，不拦 JS 赋值） */
  function flyPlus() {
    if (!elFloat || flying >= FLY_MAX) return;
    var el = document.createElement("span");
    el.className = "wf-plus";
    el.textContent = "功德 +1";
    el.style.left = (44 + Math.random() * 12).toFixed(1) + "%";
    el.style.setProperty("--wf-drift", (Math.random() * 26 - 13).toFixed(1) + "px");
    elFloat.appendChild(el);
    flying++;
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      flying = Math.max(0, flying - 1);
    }, 1000);
  }

  function paint() {
    if (elCount) elCount.textContent = fmt(count);
    if (elSub) {
      var left = MILESTONE - count;
      elSub.textContent = left > 0
        ? "累计敲击 " + fmt(count) + " 次 · 再敲 " + fmt(left) + " 次解锁成就「手指酸痛者」"
        : "累计敲击 " + fmt(count) + " 次 · 已解锁成就「手指酸痛者」";
    }
  }

  /* ── 成就引擎对齐 ──
     gameach 自己也在累加 clicks；若两边因为清过某个 storage 而漂移，
     以本机计数为准校正一次（保留已解锁的成就，只补统计）。 */
  function syncAch() {
    var A = global.GameAch;
    if (!A || !A.__stat || !A.snapshot) return;
    var stat = A.__stat();
    if (!stat || typeof stat.clicks !== "number" || stat.clicks === count) return;
    var snap = A.snapshot();
    var data = { v: 1, got: snap.got || {}, stat: snap.stat || {} };
    data.stat.clicks = count;
    A.__setData(data);
  }

  function reportAch() {
    var A = global.GameAch;
    if (A && A.report) {
      try { A.report({ kind: "tap" }); } catch (e) {}
    }
  }

  /* ── 上报榜单（节流）── */
  function send() {
    sinceSend = 0;
    var R = global.WowWfRank;
    if (R && R.report) {
      try { R.report(count); } catch (e) {}
    }
  }
  function scheduleSend() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(send, SEND_IDLE_MS);
  }

  /* ── 敲一下 ── */
  function hit() {
    count += 1;
    sinceSend += 1;
    saveCount();
    paint();
    flyPlus();
    knock();
    reportAch();

    /* 动画：先移除再强制重排，连点也能每次都重放；150ms 后收回去让 transition 回弹 */
    if (elFish) {
      elFish.classList.remove("is-hit");
      /* eslint-disable-next-line no-unused-expressions */
      void elFish.offsetWidth;
      elFish.classList.add("is-hit");
      clearTimeout(hitTimer);
      hitTimer = setTimeout(function () { elFish.classList.remove("is-hit"); }, 150);
    }

    if (sinceSend >= SEND_EVERY) send();
    else scheduleSend();
  }

  if (elFish) {
    elFish.addEventListener("click", function (e) {
      e.preventDefault();
      /* 触摸设备上 touchstart 已经敲过了，别因为后续合成的 click 又敲一下 */
      if (Date.now() - lastTouch < 600) return;
      hit();
    });
    /* 空格 / 回车也能敲（按钮默认会触发 click，这里只兜底 keydown 的重复触发） */
    elFish.addEventListener("keydown", function (e) {
      if (e.key === " " || e.key === "Enter") e.preventDefault();
    });
  }

  /* 触摸设备：按下即响，别等 300ms 后的 click（手感差别很大） */
  var lastTouch = 0;
  if (elStage && ("ontouchstart" in global)) {
    elStage.addEventListener("touchstart", function (e) {
      if (!e.target || !e.target.closest) return;
      if (!e.target.closest("#wf-fish")) return;
      e.preventDefault();
      lastTouch = Date.now();
      hit();
    }, { passive: false });
  }

  /* 离开页面前把最后一次计数发出去 */
  global.addEventListener("pagehide", send);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") send();
  });

  /* 提示语随第一次敲击消失，别一直占着位置 */
  function hideHint() {
    if (elHint && !elHint.classList.contains("wf-hint-off")) {
      elHint.classList.add("wf-hint-off");
    }
  }
  if (elFish) elFish.addEventListener("click", hideHint, { once: true });

  count = loadCount();
  paint();
  syncAch();

  global.WowWoodfish = {
    count: function () { return count; },
    hit: hit,
    add: function (n) {           /* 测试与调试用：一次加 n 次，不走音效 */
      n = Math.max(0, Math.floor(Number(n) || 0));
      count += n;
      saveCount();
      paint();
      /* 先把成就统计校到 count，再让引擎判一次（report 自带一次 +1 的累加，
         但 unlock 判的是 >= 阈值，多这一下不影响结果） */
      syncAch();
      reportAch();
      send();
      return count;
    }
  };
})(window);
