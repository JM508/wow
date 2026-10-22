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
   · 连击（2026-10-17）：3.2 秒内连着吃到苹果算连击 —— 第 2、3 颗 ×2，
     第 4 颗起 ×3；断连（超时）倍率回 1。分数飘字会标出本次倍率。
   · 手感（2026-10-17）：吃到苹果时 +分飘字 + 蛇头鼓一下；
     蛇头离墙 / 离自身只剩 1~2 格时，画布四周泛红脉冲提醒。
   · 操作：方向键 / WASD，手机上「点画布」朝点击方向转弯（点按即可，不用滑），
     也可以点屏幕方向按钮；空格暂停。
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
  var elCombo = document.getElementById("snake-combo");
  var elComboN = document.getElementById("snake-combo-n");
  var elOver = document.getElementById("snake-over");
  var elOverT = document.getElementById("snake-over-t");
  var elOverS = document.getElementById("snake-over-s");
  var elOverBtn = document.getElementById("snake-over-btn");
  var elOverCancel = document.getElementById("snake-over-cancel");
  var elOverShare = document.getElementById("snake-over-share");
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

  /* ── 每日挑战的种子随机源（与 minesweeper.js 同一套实现，两文件各自内联） ──
     每日模式的苹果落点由「日期种子」决定：同一天开局，苹果出现的序列一致。
     普通模式照旧 Math.random。 */
  function dayKey() {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function strSeed(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = Math.random;               // 当前局的随机源（reset 时按模式选定）

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

  /* ── 连击 / 手感状态（2026-10-17） ──
     combo 是「本次连击吃到第几颗」，comboT 是这把连击的剩余时间（毫秒，按帧衰减）。
     3.2 秒的窗口在三个难度下都够跨十几格，快蛇也不会因为「手慢」莫名断连。 */
  var COMBO_MS = 3200;
  var COMBO_2 = 2;                     // 吃到第 2 颗起 ×2
  var COMBO_3 = 4;                     // 吃到第 4 颗起 ×3
  var combo = 0, comboT = 0, maxCombo = 0;
  var puff = 0;                        // 蛇头「鼓一下」的余量（1 → 0，约 0.22 秒衰减）
  var pops = [];                       // 画布上的 +分飘字 {cx, cy, text, t0}
  var bestAtStart = 0;                 // 本局开始时的个人最高分（算「还差几分」用）

  function loadBest() {
    /* 隐私模式/禁存储下 localStorage 直接抛异常：吞掉按 0 分处理 */
    try {
      var n = parseInt(localStorage.getItem(KEY_BEST) || "0", 10);
      return n > 0 ? n : 0;
    } catch (e) { return 0; }
  }
  function saveBest() {
    try { localStorage.setItem(KEY_BEST, String(best)); } catch (e) {}
  }
  function nowMs() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }
  /* 当前倍率：连吃 1 颗 ×1、2~3 颗 ×2、4 颗起 ×3 */
  function comboMult() {
    if (combo >= COMBO_3) return 3;
    if (combo >= COMBO_2) return 2;
    return 1;
  }
  function paintHud() {
    if (elScore) elScore.textContent = String(score);
    if (elBest) elBest.textContent = String(best);
    /* 连击只在 ≥2 时露出来，平时不占地方 */
    if (elCombo) {
      var on = combo >= COMBO_2;
      elCombo.hidden = !on;
      if (on && elComboN) elComboN.textContent = "×" + comboMult();
    }
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

  function speed() {
    if (mode === "daily") return SPEEDS.mid;   // 每日挑战固定中等速度，大家同一条起跑线
    return SPEEDS[mode] || SPEEDS.easy;
  }

  /* ═══════════ 难度曲线（2026-10-17，第 10 项） ═══════════
     原来一开局就是固定步频，新手第一口苹果就可能撞墙。现在分三层叠：
       ① 热身：前 30 秒只跑 72%，线性升到 100%（给手指和眼睛适应的时间）
       ② 吃食提速：每吃满 5 个 +8%，最多 +48%（吃到 31 个封顶）
       ③ 连死怜悯：连输几局下一局起步更慢（每局 −6%，最多 −24%），
          只要本局吃到 5 个就算「上手了」，连败计数清零，速度回归正常
     三层相乘后由 tickSpeed() 换算成 stepMs。 */
  var WARM_MS = 30000;          // 热身时长
  var EATEN_PER_LEVEL = 5;      // 每吃几个提速一档
  var RAMP_STEP = 0.08;         // 每档 +8%
  var RAMP_MAX_LEVEL = 6;       // 最多 6 档（+48%）
  var MERCY_STEP = 0.06;        // 每连败 −6%
  var MERCY_MAX = 4;            // 最多算 4 连败（−24%）
  var KEY_DEATHS = "snake-deaths-v1";

  var elapsedMs = 0;            // 本局已跑时长（只累计对局中的步进）
  var eaten = 0;                // 本局吃到的苹果数
  var deaths = loadDeaths();

  function loadDeaths() {
    try {
      var n = parseInt(localStorage.getItem(KEY_DEATHS) || "0", 10);
      return isNaN(n) ? 0 : Math.max(0, Math.min(MERCY_MAX, n | 0));
    } catch (e) { return 0; }
  }
  function saveDeaths() {
    try { localStorage.setItem(KEY_DEATHS, String(deaths)); } catch (e) {}
  }

  function speedNow() {
    var warm = 0.72 + 0.28 * Math.min(1, elapsedMs / WARM_MS);
    var lv = Math.min(RAMP_MAX_LEVEL, Math.floor(eaten / EATEN_PER_LEVEL));
    var mercy = 1 - Math.min(MERCY_MAX, deaths) * MERCY_STEP;
    return speed() * warm * (1 + lv * RAMP_STEP) * mercy;
  }
  function tickSpeed() {
    /* 上限 16 格/秒：再快就变成「看不清也反应不过来」，不是难度而是恶心 */
    var s = Math.min(16, Math.max(3, speedNow()));
    stepMs = Math.round(1000 / s);
  }

  function reset() {
    var mid = Math.floor(GRID / 2);
    snake = [{ x: mid - 1, y: mid }, { x: mid - 2, y: mid }, { x: mid - 3, y: mid }];
    dir = DIRS.right;
    nextDir = dir;
    pendingDirs = [];
    grow = 0;
    score = 0;
    combo = 0;
    comboT = 0;
    maxCombo = 0;
    puff = 0;
    pops.length = 0;
    bestAtStart = best;
    elapsedMs = 0;
    eaten = 0;
    /* 每日挑战：开局按今天的日期定种子，苹果序列今天恒定 */
    rng = (mode === "daily") ? mulberry32(strSeed(dayKey() + "|snake")) : Math.random;
    tickSpeed();
    placeApple();
    state = "ready";
    hideOver();
    paintHud();
    draw();
    if (elMsg) {
      elMsg.textContent = mode === "daily"
        ? "每日挑战 " + dayKey() + "：今天的苹果顺序大家都一样，比比谁跑得远。"
        : "方向键 / WASD 控制，手机上点画布朝点的方向转弯；空格暂停。";
    }
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
    apple = free.length ? free[Math.floor(rng() * free.length)] : null;
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
    /* 连击窗口与「鼓一下」的余量都按真实时间衰减（不按步进，转向/卡顿时也准） */
    if (comboT > 0) {
      comboT -= dt;
      if (comboT <= 0) { comboT = 0; if (combo) { combo = 0; paintHud(); } }
    }
    if (puff > 0) puff = Math.max(0, puff - dt / 220);
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
      if (comboT > 0) {
        comboT -= stepMs;
        if (comboT <= 0) { comboT = 0; if (combo) { combo = 0; paintHud(); } }
      }
      if (puff > 0) puff = Math.max(0, puff - stepMs / 220);
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
      /* 连击：窗口内接着吃到就累加，断了从 1 重新算 */
      combo = comboT > 0 ? combo + 1 : 1;
      comboT = COMBO_MS;
      if (combo > maxCombo) maxCombo = combo;
      var mult = comboMult();
      var gain = 10 * mult;
      score += gain;
      grow += 1;
      puff = 1;
      pops.push({
        cx: apple.x, cy: apple.y,
        text: "+" + gain + (mult > 1 ? " ×" + mult : ""),
        t0: nowMs()
      });
      if (score > best) { best = score; saveBest(); }
      eaten += 1;
      /* 吃到 5 个就算上手了：把连败怜悯清零，下一局起速回归正常 */
      if (deaths > 0 && eaten >= EATEN_PER_LEVEL) { deaths = 0; saveDeaths(); }
      tickSpeed();
      paintHud();
      placeApple();
      /* 成就：吃苹果（分数与蛇长一并报上去，单局最高分/最长蛇都在这一条里更新） */
      if (window.GameAch) window.GameAch.report({ kind: "apple", score: score, len: snake.length, mode: mode });
    }
    if (grow > 0) grow -= 1;
    else snake.pop();
    elapsedMs += stepMs;
    tickSpeed();
  }

  function die() {
    state = "over";
    /* 连败计数：这一局又没撑到 5 个苹果，下一局起步再慢一点（最多 4 连） */
    if (eaten < EATEN_PER_LEVEL && deaths < MERCY_MAX) { deaths += 1; saveDeaths(); }
    draw();
    var fresh = score > bestAtStart;                 // 本局是否刷了个人纪录
    var gap = Math.max(0, best - score);
    if (elOverT) elOverT.textContent = fresh ? "新纪录！" : "游戏结束";
    if (elOverS) {
      /* 失败界面别只报个分数：把「本局最高连击」和「离纪录还差几分」摆出来，
         把「输了」变成「就差一点」。 */
      var line = "本局得分 " + score + "（个人最高 " + best + "）";
      if (maxCombo >= COMBO_2) {
        line += "｜最高连击 " + maxCombo + " 连 ×" + (maxCombo >= COMBO_3 ? 3 : 2);
      }
      if (fresh) line += "｜刷新个人纪录";
      else if (gap > 0) line += "｜距离纪录还差 " + gap + " 分";
      elOverS.textContent = line;
    }
    if (elOver) elOver.classList.remove("hidden");
    if (elOverBtn) elOverBtn.focus();
    /* 分享战绩：把这局的分数 / 连击写进分享按钮，点一下画海报（share-card.js） */
    if (elOverShare) {
      fillShare();
      elOverShare.hidden = false;
    }
    /* 成就：本局结束（局数 + 各难度最高分） */
    if (window.GameAch) window.GameAch.report({ kind: "over", score: score, len: snake.length, mode: mode });
    submitScore();
  }

  function hideOver() { if (elOver) elOver.classList.add("hidden"); if (elOverShare) elOverShare.hidden = true; }

  function fillShare() {
    if (!elOverShare) return;
    var lab = mode;
    try {
      if (elLevel && elLevel.selectedOptions && elLevel.selectedOptions[0]) {
        lab = elLevel.selectedOptions[0].text;
      }
    } catch (e) {}
    var lines = ["个人最高 " + best + " 分", "吃到 " + eaten + " 个苹果"];
    if (maxCombo >= COMBO_2) {
      lines[1] = "最高连击 " + maxCombo + " 连（×" + (maxCombo >= COMBO_3 ? 3 : 2) + "）";
    }
    lines.push("本局长度 " + (snake.length + grow) + " 格");
    elOverShare.setAttribute("data-share-payload", JSON.stringify({
      t: "贪吃蛇 · " + lab,
      big: score + " 分",
      lines: lines
    }));
  }

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
  /* 危险等级：0 安全 / 1 两格内 / 2 下一格就出事（墙、自己的身体都算） */
  function dangerLevel() {
    if (state !== "playing" || !snake.length) return 0;
    var h = snake[0], steps = 99;
    if (dir.x === 1) steps = GRID - 1 - h.x;
    else if (dir.x === -1) steps = h.x;
    else if (dir.y === 1) steps = GRID - 1 - h.y;
    else if (dir.y === -1) steps = h.y;
    var bodyHit = 0;
    for (var k = 1; k <= 2 && !bodyHit; k++) {
      var nx = h.x + dir.x * k, ny = h.y + dir.y * k;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      for (var i = 0; i < snake.length - 1; i++) {     // 尾巴尖下一步会让位，不算
        if (snake[i].x === nx && snake[i].y === ny) { bodyHit = k; break; }
      }
    }
    if (bodyHit === 1 || steps <= 1) return 2;
    if (bodyHit === 2 || steps <= 2) return 1;
    return 0;
  }

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
    var hsc = 1 + 0.26 * puff;                     // 刚吃到苹果时蛇头「鼓一下」
    var bsc = 1 + 0.10 * puff;
    for (var i = snake.length - 1; i >= 0; i--) {
      var s = snake[i];
      var pad = i === 0 ? cell * 0.06 : cell * 0.1;
      var box = cell - pad * 2;
      var cx = s.x * cell + cell / 2, cy = s.y * cell + cell / 2;
      var sc = i === 0 ? hsc : bsc;
      ctx.fillStyle = i === 0 ? skin.head : skin.body;
      ctx.fillRect(cx - box * sc / 2, cy - box * sc / 2, box * sc, box * sc);
      if (i === 0) {
        /* 眼睛 */
        ctx.fillStyle = "#ffffff";
        var off = cell * 0.16 * sc;
        ctx.fillRect(cx - off - 1.5, cy - cell * 0.12, 3, 3);
        ctx.fillRect(cx + off - 1.5, cy - cell * 0.12, 3, 3);
      }
    }

    /* 危险预警（2026-10-17）：蛇头离墙 / 离自己只剩 1~2 格时，画布四周泛红脉冲。
       给玩家一个「还来得及拐」的视觉窗口，而不是下一格直接猝死。 */
    var dg = dangerLevel();
    if (dg > 0) {
      var pulse = 0.5 + 0.5 * Math.sin(nowMs() / 130);
      var baseA = (dg === 2 ? 0.34 : 0.18) * (0.55 + 0.45 * pulse);
      for (var k = 0; k < 3; k++) {
        ctx.strokeStyle = "rgba(229,72,77," + (baseA * (1 - k * 0.3)).toFixed(3) + ")";
        ctx.lineWidth = cell * (1.15 - k * 0.32);
        var inset = ctx.lineWidth / 2 + 1;
        ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
      }
    }

    /* +分飘字：0.8 秒内上浮 + 淡出（带描边，浅色深色底都看得清） */
    if (pops.length) {
      var tNow = nowMs(), keep = [];
      ctx.textAlign = "center";
      ctx.font = "700 " + Math.round(cell * 0.72) + "px sans-serif";
      for (var pi = 0; pi < pops.length; pi++) {
        var pop = pops[pi], age = tNow - pop.t0;
        if (age < 0 || age > 800) continue;
        keep.push(pop);
        var kk = age / 800;
        var fx = pop.cx * cell + cell / 2;
        var fy = pop.cy * cell + cell / 2 - kk * cell * 1.6;
        ctx.globalAlpha = 1 - kk;
        ctx.lineWidth = 3;
        ctx.strokeStyle = dark ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.85)";
        ctx.strokeText(pop.text, fx, fy);
        ctx.fillStyle = "#ffd166";
        ctx.fillText(pop.text, fx, fy);
      }
      ctx.globalAlpha = 1;
      pops = keep;
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

  /* ── 触屏 / 鼠标：点画布 → 朝点击的方向转弯（2026-10-17 用户要求「点击就可以移动，不要滑动」） ──
     点按位置相对蛇头在哪个方向，蛇就往哪个方向拐；横向差大就走左右、纵向差大就走上下。
     不需要拖动、不需要抬手确认，也不会因为手指抖一下误判成反向。 */
  function tapAt(clientX, clientY) {
    if (!snake.length) return;
    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    var cw = rect.width || canvas.width || 1;
    var ch = rect.height || canvas.height || canvas.width || 1;
    var gx = (clientX - rect.left) / cw * GRID;
    var gy = (clientY - rect.top) / ch * GRID;
    var head = snake[0];
    var dx = gx - (head.x + 0.5);
    var dy = gy - (head.y + 0.5);
    if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) return;   // 点在蛇头上：当作误触，忽略
    var want = Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? "right" : "left")
      : (dy > 0 ? "down" : "up");
    if (state === "over") return;                           // 结束后不靠点画布重开
    if (state === "ready") start();
    setDir(want);
    draw();
  }

  canvas.addEventListener("click", function (e) {
    tapAt(e.clientX, e.clientY);
  });
  /* 手机上用 touchstart：不用等 click 合成，点下去立刻转向（同一方向重复设置会被 setDir 去重） */
  canvas.addEventListener("touchstart", function (e) {
    if (!e.touches || !e.touches.length) return;
    if (state === "over") return;
    tapAt(e.touches[0].clientX, e.touches[0].clientY);
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
      pending: pendingDirs.length,
      head: snake.length ? (snake[0].x + "," + snake[0].y) : "",
      combo: combo,
      maxCombo: maxCombo,
      pops: pops.length,
      danger: dangerLevel(),
      stepMs: stepMs,
      eaten: eaten,
      deaths: deaths,
      daily: mode === "daily",
      dailyKey: mode === "daily" ? dayKey() : "",
      apple: apple ? (apple.x + "," + apple.y) : ""
    };
  };
  /* 测试钩子：把苹果摆到指定格子（只影响测试，正常玩法不调用） */
  window.__snakeSetApple = function (x, y) {
    apple = { x: x, y: y };
  };
})();
