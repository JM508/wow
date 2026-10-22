/* ══════════════════════════════════════════════════════════════
   触感反馈（全站共用，2026-10-22）
   ──────────────────────────────────────────────────────────────
   · 只做一件事：把游戏里的关键动作翻译成 navigator.vibrate 的短震动。
       tap  落子 / 吃苹果 / 合并方块   8ms
       hit  撞墙 / 撞障碍              22ms
       win  通关 / 赢一局              10-40-10
       fail 踩雷 / 结束                60-40-60
   · 默认开启条件：粗指针（手机 / 平板）且系统没开「减少动效」。
     设置页签里可以手动关闭，键名 wow-haptic-v1（"1" 开 / "0" 关）。
   · 不支持 vibrate 的设备（iOS Safari、桌面）静默跳过，不报错。
   · 无内联代码 / 内联样式（CSP 白名单）。
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var KEY = "wow-haptic-v1";
  var PATTERN = {
    tap: [8],
    hit: [22],
    win: [10, 40, 10],
    fail: [60, 40, 60]
  };

  function coarse() {
    try { return !!(global.matchMedia && global.matchMedia("(pointer: coarse)").matches); } catch (e) {}
    return false;
  }

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function calm() {
    try { return document.documentElement.classList.contains("a11y-calm"); } catch (e) { return false; }
  }

  function enabled() {
    var v = stored();
    if (v === "0") return false;
    if (v === "1") return true;
    return coarse();
  }

  function canVibrate() {
    return !!(global.navigator && typeof global.navigator.vibrate === "function");
  }

  function play(kind) {
    if (!canVibrate()) return false;
    if (!enabled() || calm()) return false;
    var p = PATTERN[kind] || PATTERN.tap;
    try { return !!global.navigator.vibrate(p); } catch (e) { return false; }
  }

  function setPref(on) {
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
    paint();
    document.dispatchEvent(new CustomEvent("haptic:change", { detail: { on: !!on } }));
  }

  function paint() {
    var btn = document.getElementById("me-haptic-sw");
    if (!btn) return;
    var on = enabled();
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function wire() {
    var btn = document.getElementById("me-haptic-sw");
    if (btn) btn.addEventListener("click", function () { setPref(!enabled()); });
    paint();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  /* 减少动效开关变化时立刻生效（meplus.js 会派发 a11y:change） */
  document.addEventListener("a11y:change", paint);

  global.WowHaptics = {
    play: play,
    enabled: enabled,
    setPref: setPref,
    supported: canVibrate
  };
})(window);
