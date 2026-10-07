/* ══════════════════════════════════════════════════════════════
   贪吃蛇（/snake/）
   ──────────────────────────────────────────────────────────────
   · 绿色小蛇吃苹果，每吃一个变长一格、加 10 分；撞墙或撞自己结束。
   · 三档难度（速度不同）：简单 / 中等 / 困难。
   · 蛇皮肤（2026-10-06）：取 skins.js 里当前装备的配色，个人中心 → 皮肤切换，
     换完立刻生效（监听 shop:change）。
   · 成就（2026-10-06）：本游戏专属一套，走 GameAch（gameach.js）；
     吃苹果与结束时报事件，判定全在引擎里。
   · 得分上云榜（game_scores 表，game="snake"）：GameRank 只收比本人
     榜上更高的分，所以实际每次都是刷新纪录才写库。
   · 操作：方向键 / WASD，手机滑动或屏幕按钮；空格暂停。
   · 打开个人中心 / 排行榜时自动暂停（panel:open / panel:close）。
   · 外链脚本、无内联代码（CSP 同源白名单）。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var root = document.getElementById("snake-root");
  if (!root) return;

  var canvas = document.getElementById("snake-canvas");
  var elScore = document.getElementById("snake-score");
  var elBest = document.getElementById("snake-best");
  var elLevel = document.getElementById("snake-level");
  var elMsg = document.getElementById("snake-msg");
  var elOver = document.getElementById("snake-over");
  var elOverT = document.getElementById("snake-over-t");
  var elOverS = document.getElementById("snake-over-s");
  var elOverBtn = document.getElementById("snake-over-btn");
  var elOverCancel = document.getElementById("snake-over-cancel");
  var btnPause = document.getElementById("snake-pause");
  var dpad = document.getElementById("snake-dpad");

  if (!canvas || !canvas.getContext) return;

  var GRID = 21;                       // 21×21 格
  var SPEEDS = { easy: 6, mid: 9, hard: 13 };   // 格 / 秒
  var KEY_BEST = "snake-best-v1";
  var DIRS = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
  };

  var ctx = canvas.getContext("2d");
  var cell = 20;                       // 像素 / 格（resize 时按画布宽算）
  var mode = elLevel ? elLevel.value : "easy";
  var best = loadBest();

  /* 蛇皮肤（skins.js 缺失时回落默认配色，游戏照常能玩） */
  function snakeSkin(dark) {
    var S = window.RunnerSkins;
    if (S && S.snakeColors) {
      try {
        var c = S.snakeColors(dark);
        if (c && c.head && c.body) return c;
      } catch (e) {}
    }
    return dark ? { head: "#3ddc68", body: "#2fae54" } : { head: "#1d8a40", body: "#37a352" };
  }

  var snake = [];                      // [{x,y}]，头在前
  var dir = DIRS.right;
  var nextDir = DIRS.right;            // 输入缓冲（一格 tick 只吃一次转向）
  var pendingDirs = [];                // 最多缓存 2 个转向，快速连按不丢
  var apple = null;
  var grow = 0;
  var score = 0;
  var state = "ready";                 // ready | playing | paused | over
  var stepMs = 160;
  var acc = 0;
  var lastT = 0;
  var rafId = 0;

  function loadBest() {
    var n = parseInt(localStorage.getItem(KEY_BEST) || "0", 10);
    return n > 0 ? n : 0;
  }
  function saveBest() {
    try { localStorage.setItem(KEY_BEST, String(best)); } catch (e) {}
  }
  function paintHud() {
    if (elScore) elScore.textContent = String(score);
    if (elBest) elBest.textContent = String(best);
  }

  function resize() {
    var w = canvas.clientWidth || 420;
    cell = Math.floor(w / GRID);
    var px = cell * GRID;
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    draw();
  }

  function speed() { return SPEEDS[mode] || SPEEDS.easy; }

  function reset() {
    var mid = Math.floor(GRID / 2);
    snake = [{ x: mid - 1, y: mid }, { x: mid - 2, y: mid }, { x: mid - 3, y: mid }];
    dir = DIRS.right;
    nextDir = dir;
    pendingDirs = [];
    grow = 0;
    score = 0;
    stepMs = Math.round(1000 / speed());
    placeApple();
    state = "ready";
    hideOver();
    paintHud();
    draw();
    if (elMsg) elMsg.textContent = "方向键 / WASD 控制，手机上滑动或点按钮；空格暂停。";
    if (btnPause) btnPause.textContent = "暂停";
  }

  function placeApple() {
    var free = [];
    for (var y = 0; y < GRID; y++) {
      for (var x = 0; x < GRID; x++) {
        var hit = false;
        for (var i = 0; i < snake.length; i++) {
          if (snake[i].x === x && snake[i].y === y) { hit = true; break; }
        }
        if (!hit) free.push({ x: x, y: y });
      }
    }
    apple = free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  function setDir(name) {
    var d = DIRS[name];
    if (!d) return;
    /* 不能 180° 掉头：以「正在生效或队列最后一个」的方向为基准 */
    var base = pendingDirs.length ? pendingDirs[pendingDirs.length - 1] : dir;
    if (d.x === -base.x && d.y === -base.y) return;
    if (d.x === base.x && d.y === base.y) return;
    if (pendingDirs.length < 2) pendingDirs.push(d);
  }

  function start() {
    if (state === "playing") return;
    if (state === "ready" || state === "over") reset();
    state = "playing";
    autoPaused = false;
    if (btnPause) btnPause.textContent = "暂停";
    if (elMsg) elMsg.textContent = "";
    resumeLoop();
  }

  function pause() {
    if (state !== "playing" && state !== "paused") return;
    /* 面板开着时局面必定是「自动暂停」：空格/按钮不许在遮罩后面偷偷续跑，
       关掉面板（panel:close → modalResume）才是唯一的恢复路径 */
    if (state === "paused" && modalDepth > 0) return;
    if (state === "playing") {
      state = "paused";
      if (btnPause) btnPause.textContent = "继续";
      if (elMsg) elMsg.textContent = "已暂停，按空格或点「继续」接着玩。";
    } else {
      state = "playing";
      if (btnPause) btnPause.textContent = "暂停";
      if (elMsg) elMsg.textContent = "";
      resumeLoop();
    }
  }

  /* 暂停会把 rAF 循环停掉（loop() 见 state !== playing 就直接返回），
     所以「继续」必须重新把循环接上，否则画面就冻住了（2026-10-06 修）。 */
  function resumeLoop() {
    lastT = 0;
    acc = 0;
    if (window.requestAnimationFrame) {
      if (!rafId) rafId = window.requestAnimationFrame(loop);
    } else {
      loopTickFallback();
    }
  }

  /* ── 打开个人中心 / 排行榜时自动暂停 ──
     两个遮罩层可能叠着开（比如在个人中心里点开排行榜），所以按深度计数；
     只有「本该在跑」的那次自动暂停才对应自动恢复，手动暂停不在这里动。 */
  var modalDepth = 0, autoPaused = false;
  function modalPause() {
    if (state === "playing") {
      state = "paused";
      autoPaused = true;
      if (btnPause) btnPause.textContent = "继续";
      if (elMsg) elMsg.textContent = "已暂停（关掉这个面板后自动继续）。";
    }
  }
  function modalResume() {
    if (!autoPaused) return;
    autoPaused = false;
    if (state !== "paused") return;
    state = "playing";
    if (btnPause) btnPause.textContent = "暂停";
    if (elMsg) elMsg.textContent = "";
    resumeLoop();
  }
  document.addEventListener("panel:open", function () {
    modalDepth += 1;
    if (modalDepth === 1) modalPause();
  });
  document.addEventListener("panel:close", function () {
    modalDepth = Math.max(0, modalDepth - 1);
    if (modalDepth === 0) modalResume();
  });

  /* rAF 循环 + 兜底 setInterval（requestAnimationFrame 不可用的环境） */
  function loop(ts) {
    rafId = 0;
    if (state !== "playing") return;
    if (!lastT) lastT = ts || 0;
    var dt = (ts || 0) - lastT;
    lastT = ts || 0;
    /* 钳制长帧：切后台 / 手机切应用 / 主线程卡一下，rAF 时间戳会跳好几秒，
       不钳的话 acc 一口气堆出几十步 → 蛇瞬移撞墙（runner.js 的帧循环同样钳 50ms）。 */
    if (!(dt > 0)) dt = 0;                 // 时间戳倒退（少见）也别累加负数
    if (dt > 200) dt = 200;
    acc += dt;
    while (acc >= stepMs) {
      acc -= stepMs;
      step();
      if (state !== "playing") break;
    }
    draw();
    if (state === "playing" && window.requestAnimationFrame) {
      rafId = window.requestAnimationFrame(loop);
    }
  }
  var fallbackTimer = null;
  function loopTickFallback() {
    if (window.requestAnimationFrame) return;    // 正常环境走 rAF
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = setInterval(function () {
      if (state !== "playing") return;
      step();
      draw();
    }, stepMs);
  }

  function step() {
    if (pendingDirs.length) dir = pendingDirs.shift();
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    /* 撞墙 / 撞自己（尾巴尖即将让位的格子允许进入） */
    if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID) { return die(); }
    for (var i = 0; i < snake.length - 1; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) return die();
    }
    snake.unshift(head);
    if (apple && head.x === apple.x && head.y === apple.y) {
      score += 10;
      grow += 1;
      if (score > best) { best = score; saveBest(); }
      paintHud();
      placeApple();
      /* 成就：吃苹果（分数与蛇长一并报上去，单局最高分/最长蛇都在这一条里更新） */
      if (window.GameAch) window.GameAch.report({ kind: "apple", score: score, len: snake.length, mode: mode });
    }
    if (grow > 0) grow -= 1;
    else snake.pop();
  }

  function die() {
    state = "over";
    draw();
    if (elOverT) elOverT.textContent = "游戏结束";
    if (elOverS) elOverS.textContent = "本局得分 " + score + "（最高 " + best + "）";
    if (elOver) elOver.classList.remove("hidden");
    if (elOverBtn) elOverBtn.focus();
    /* 成就：本局结束（局数 + 各难度最高分） */
    if (window.GameAch) window.GameAch.report({ kind: "over", score: score, len: snake.length, mode: mode });
    submitScore();
  }

  function hideOver() { if (elOver) elOver.classList.add("hidden"); }

  /* 取消结束弹窗：收起并回到待开局状态（棋盘重摆、分数清零，不自动开局） */
  function closeOver() {
    reset();
    if (btnStart) btnStart.focus();
  }

  /* 云榜：得分 > 0 就提交，grank 内部「没超过本人最好成绩就不写库」 */
  function submitScore() {
    if (score <= 0 || !window.GameRank) return;
    window.GameRank.submit(mode, score).catch(function () {});
  }

  /* ═══════════ 渲染 ═══════════ */
  function draw() {
    if (!ctx) return;
    var w = canvas.width, h = canvas.height;
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    var bg = dark ? "#1c2128" : "#f2f7ee";
    var gridLine = dark ? "rgba(255,255,255,0.05)" : "rgba(60,120,60,0.07)";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = gridLine;
    ctx.lineWidth = 1;
    for (var g = 1; g < GRID; g++) {
      ctx.beginPath(); ctx.moveTo(g * cell, 0); ctx.lineTo(g * cell, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g * cell); ctx.lineTo(w, g * cell); ctx.stroke();
    }
    /* 苹果 */
    if (apple) {
      ctx.fillStyle = "#e5484d";
      ctx.beginPath();
      ctx.arc(apple.x * cell + cell / 2, apple.y * cell + cell / 2, cell * 0.36, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = "#5d8a3c";
      ctx.fillRect(apple.x * cell + cell / 2 - 1, apple.y * cell + cell * 0.06, 2, cell * 0.18);
    }
    /* 蛇：头深、身浅（色盲友好：靠明度差区分），颜色来自当前装备的蛇皮肤 */
    var skin = snakeSkin(dark);
    for (var i = snake.length - 1; i >= 0; i--) {
      var s = snake[i];
      var pad = i === 0 ? cell * 0.06 : cell * 0.1;
      ctx.fillStyle = i === 0 ? skin.head : skin.body;
      ctx.fillRect(s.x * cell + pad, s.y * cell + pad, cell - pad * 2, cell - pad * 2);
      if (i === 0) {
        /* 眼睛 */
        ctx.fillStyle = "#ffffff";
        var ex = s.x * cell + cell / 2, ey = s.y * cell + cell / 2;
        var off = cell * 0.16;
        ctx.fillRect(ex - off - 1.5, ey - cell * 0.12, 3, 3);
        ctx.fillRect(ex + off - 1.5, ey - cell * 0.12, 3, 3);
      }
    }
    if (state === "ready") {
      ctx.fillStyle = dark ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.6)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = dark ? "#e8e8e8" : "#1f1f1f";
      ctx.font = "700 " + Math.round(cell * 0.9) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("点「开始」或按方向键", w / 2, h / 2);
    }
  }

  /* ═══════════ 事件 ═══════════ */
  var KEYMAP = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right"
  };
  document.addEventListener("keydown", function (e) {
    if (!root || !root.isConnected) return;
    /* 焦点在按钮 / 下拉 / 输入框上时别抢：空格是「点击」、方向键是「换选项」，
       抢了会吃掉按钮激活、还顺手把游戏暂停掉（排行榜关闭按钮上按空格最典型）。
       游戏快捷键只在焦点不在任何控件上时生效。 */
    /* Esc 关闭结束弹窗（「取消」）；放在焦点守卫之前 —— 弹窗默认焦点在「再来一局」按钮上，
       守卫会放过 BUTTON 目标，Esc 就永远轮不到了。Esc 在按钮上也不会触发点击，无冲突。 */
    if (e.code === "Escape" && state === "over") { e.preventDefault(); closeOver(); return; }
    var t = e.target;
    if (t && t !== document && t !== document.body &&
        (t.tagName === "BUTTON" || t.tagName === "SELECT" ||
         t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    var d = KEYMAP[e.code];
    if (d) {
      e.preventDefault();
      /* 结束弹窗开着时不认方向键：要么点「再来一局」，要么先关掉弹窗（2026-10-06 用户要求） */
      if (state === "over") return;
      if (state === "ready") start();
      setDir(d);
      draw();
      return;
    }
    if (e.code === "Space") { e.preventDefault(); if (state !== "over") pause(); }
  });

  /* 触屏滑动 */
  /* 触屏：整个游戏区内都可滑（不只画布），拖动途中实时转向，不必抬手 */
  var touchX = null, touchY = null;
  var touchDead = false;               // 本次触摸起点落在按钮/下拉等控件上，不参与滑动
  function touchSkip(t) {
    return !!(t && t.closest && t.closest("[data-dir], button, select, a, input, textarea"));
  }
  root.addEventListener("touchstart", function (e) {
    if (!e.touches.length) return;
    touchDead = touchSkip(e.target);
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  root.addEventListener("touchmove", function (e) {
    if (touchDead || !e.touches.length) return;
    if (state === "playing") e.preventDefault();          // 玩耍中禁止页面跟着滚
    if (touchX === null || state !== "playing") return;   // 面板开着(自动暂停)时不偷转向
    var dx = e.touches[0].clientX - touchX;
    var dy = e.touches[0].clientY - touchY;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    touchX = e.touches[0].clientX;                        // 锚点前移，一次长滑可连转几弯
    touchY = e.touches[0].clientY;
  }, { passive: false });
  root.addEventListener("touchend", function (e) {
    if (touchDead) { touchX = touchY = null; return; }
    if (touchX === null || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;    // 当成点按，忽略
    if (state === "over") return;                          // 结束后不靠滑动重开
    if (state === "ready") start();
    if (state === "playing")
      setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  }, { passive: true });

  /* 屏幕方向按钮 */
  if (dpad) {
    dpad.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-dir]") : null;
      if (!b) return;
      e.preventDefault();
      if (state === "over") return;                        // 结束后不靠方向键重开
      if (state === "ready") start();
      setDir(b.getAttribute("data-dir"));
    });
  }

  var btnStart = document.getElementById("snake-start");
  if (elOverCancel) elOverCancel.addEventListener("click", closeOver);
  if (btnStart) btnStart.addEventListener("click", start);
  if (btnPause) btnPause.addEventListener("click", pause);
  if (elOverBtn) elOverBtn.addEventListener("click", start);
  /* 结束弹窗只认「再来一局」按钮：点弹窗空白处不再顺手开局（2026-10-06 用户要求） */
  if (elLevel) {
    elLevel.addEventListener("change", function () {
      mode = elLevel.value;
      reset();
    });
  }

  window.addEventListener("resize", resize);
  /* 个人中心里换了蛇皮肤：立刻按新配色重画（不用重开一局）。
     skins.js 广播 wallet:change，shop.js 另外广播 shop:change，两个都听着。 */
  document.addEventListener("shop:change", function () { draw(); });
  document.addEventListener("wallet:change", function () { draw(); });

  /* 切后台 / 切应用时自动暂停（与跑酷一致）：回来按「继续」接着玩，
     也从根上避开后台期间 rAF 停摆、回来时间跳变的问题 */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "playing") pause();
  });

  reset();
  resize();
  if (!window.requestAnimationFrame) loopTickFallback();

  /* 调试/测试出口：只读，不改变任何行为（与 runner 暴露 window.Runner 同理） */
  window.__snakeState = function () {
    return {
      state: state,
      dir: dir ? (dir.x + "," + dir.y) : "",
      pending: pendingDirs.length
    };
  };
})();
