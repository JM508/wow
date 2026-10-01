/* ══════════════════════════════════════════════════════════════
   火柴人快跑 —— 横版无尽跑酷小游戏（外链版）
   ──────────────────────────────────────────────────────────────
   · 全部画面用 canvas 2D 程序化绘制，不依赖任何图片 / 字体文件
   · 音效用 WebAudio 实时合成，不依赖任何音频文件
     （本站 CSP 为纯同源白名单、无 unsafe-inline，禁止内联脚本）
   · 逻辑分辨率固定 960×360，由 CSS 等比缩放适配各种屏幕
   · 末尾暴露 window.Runner 供控制台调试与自动化测试驱动
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var root = document.getElementById("run-root");
  if (!root) return;
  var canvas = document.getElementById("run-canvas");
  var stage = document.getElementById("run-stage");
  var ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return;

  /* ═══════════ 可调参数 ═══════════ */
  var CFG = {
    W: 960, H: 360,
    GROUND: 300,            // 地面线（逻辑坐标 y）
    PX: 148,                // 角色固定 x

    BODY_W: 30,             // 站立碰撞盒宽
    STAND_H: 62,            // 站立碰撞盒高
    DUCK_H: 34,             // 下蹲碰撞盒高
    HIT_PAD: 5,             // 碰撞盒内缩（手感宽容度）

    GRAVITY: 2900,          // 重力加速度 px/s²
    JUMP_V: -950,           // 起跳初速度
    JUMP_CUT: 1500,         // 松开跳跃键后的额外下坠加速度（可变跳跃高度）
    JUMP_CUT_MIN: -420,     // 速度比此值更慢时不再施加 JUMP_CUT
    FAST_FALL: 2100,        // 空中按下蹲键的额外下坠加速度
    COYOTE: 0.10,           // 离地宽限起跳时间（秒）

    SPEED0: 330,            // 初始速度 px/s
    SPEED_MAX: 880,         // 速度上限
    SPEED_ACC: 7,           // 每秒速度增量

    SCORE_PER_PX: 1 / 12,   // 每前进 12px 得 1 分
    COIN_SCORE: 10,         // 每枚金币分值

    SHIELD_TIME: 3.6,       // 护盾无敌时长（秒）
    BOOST_MULT: 1.18,       // 无敌期间速度倍率（冲刺也要留反应余地，不能快到「无敌一过就撞墙」）
    BOOST_TAIL: 1.10,       // 冲刺收尾期（秒）：这 1.1 秒不再生成新障碍，把前方跑空
    BOOST_CLEAR: 40,        // 归零兜底：只清「几乎已经贴到身上」的障碍（真正的应急，正常不触发）
    END_GRACE: 0.30,        // 归零宽限（秒）：前方还有 <0.3s 就撞上的障碍时，无敌再续这么一小段

    /* 无敌冲刺「金币雨」：冲刺期间贴地成排出金币，随出随扫 */
    DASH_GAP_MIN: 460,      // 两排金币的最小间隔（px）
    DASH_GAP_MAX: 640,      // 两排金币的最大间隔（px）
    DASH_FIRST: 260,        // 吃到护盾后第一排金币最迟出现距离（px）
    DASH_COINS_MIN: 3,      // 每排最少颗数
    DASH_COINS_MAX: 5,      // 每排最多颗数
    DASH_Y: 36,             // 冲刺币中心离地高度（站着跑就能吃到）

    AIR_GAP: 44,            // 飞行物底边离地高度（只能下蹲穿过）
    GAP_MIN: 0.80,          // 障碍间距系数下限（× 当前速度）
    GAP_MAX: 1.55,          // 障碍间距系数上限

    /* 金币「跑道」：金币出生点前方留出的无障碍距离
       = 最高速下一次完整跳跃的飞行距离 + 余量（保证玩家能落地、再从容起跳，
         而不是刚跳过障碍还悬在半空，眼看着金币从脚下飞过去） */
    RUNWAY_MIN: 360,        // 低速段的下限
    RUNWAY_PAD: 150,        // 在「一次完整跳跃」之外再留的余量
    GAP_AFTER_RATIO: 0.6,   // 金币串之后给障碍留的空档（占一次完整跳跃的比例）
    GAP_AFTER_MIN: 280,     // 该空档的下限
    COIN_MAGNET: 90,        // 金币磁吸半径：进到这个范围内金币会主动飞向玩家
    MAGNET_SPEED: 1000,     // 磁吸飞行速度 px/s
    COIN_PICK: 30,          // 金币拾取半径 = r + 30（比道具宽松一点）

    PHASE_DIST: 9000,       // 昼夜每阶段推进距离（px）
    DPR_MAX: 2
  };

  var AIR_TIME = 2 * Math.abs(CFG.JUMP_V) / CFG.GRAVITY;   // 一次完整跳跃的滞空时间 ≈ 0.655s
  /* 金币出生点前方要留的跑道：够玩家「落地 → 再起跳」 */
  function itemRunway() { return Math.max(CFG.RUNWAY_MIN, S.speed * AIR_TIME + CFG.RUNWAY_PAD); }
  /* 金币串之后给障碍留的空档：够玩家落地并看清下一个障碍（不用整跳那么长，
     否则每一串金币都会挤掉一波障碍，节奏会变松） */
  function waveRunway() {
    return Math.max(CFG.GAP_AFTER_MIN, S.speed * AIR_TIME * CFG.GAP_AFTER_RATIO + 120);
  }

  /* ── 无敌冲刺的速度倍率 ──
     收尾期（boost ≤ BOOST_TAIL）里从 BOOST_MULT 线性回落到 1，
     避免「一过无敌就急刹车」的顿挫；同时也让障碍生成间隔能跟着实际位移一起收。 */
  function boostMul() {
    if (!S || S.boost <= 0) return 1;
    if (S.boost >= CFG.BOOST_TAIL) return CFG.BOOST_MULT;
    return 1 + (CFG.BOOST_MULT - 1) * (S.boost / CFG.BOOST_TAIL);
  }

  /* ── 冲刺归零的「安全落地窗口」──
     冲刺时速度本就偏快，障碍又一直在生成。如果恰好在障碍面前归零，
     玩家一帧之内根本来不及起跳 —— 这就是「无敌时间一过直接撞死」的原因。
     解法分两层：
       ① 收尾期 BOOST_TAIL 秒内不再生成新障碍，前方自然跑空（主要手段，
          实测关掉 ② 之后 26/26 次归零前方都是空的，它自己就够）；
       ② 归零那一帧再做一次极窄的兜底清扫（只碰几乎贴到身上的障碍），
          并把下一波障碍的生成点推远，让玩家平稳接回正常节奏。
     ② 的窗口必须很小：以前是 220px，一旦触发就是「前方障碍凭空消失」，
     比它要防的问题还显眼。 */
  function endBoost() {
    /* 归零宽限：判定盒跟着画面收窄之后，个别障碍会比以前晚一帧才被撞碎，
       归零瞬间它可能还悬在脸前（实测最差只剩 0.08s 反应）。
       与其把远处障碍清掉（那就是「凭空消失」），不如让无敌再续一小段，
       玩家会把它自然撞碎 —— 对玩家隐形，也不欠公平。 */
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.x + o.w <= CFG.PX) continue;
      if (o.kind === "air" && P.duck) continue;          // 蹲着能钻过去的就不用续
      var gap = o.x - (CFG.PX + CFG.BODY_W / 2);
      if (gap / Math.max(1, S.speed) < CFG.END_GRACE) {
        S.boost = CFG.END_GRACE;
        return;
      }
    }

    var cleared = 0;
    for (var i = obstacles.length - 1; i >= 0; i--) {
      var o = obstacles[i];
      if (o.x + o.w > CFG.PX - 24 && o.x < CFG.PX + CFG.BOOST_CLEAR) {
        addDebris(o);
        sparkle(o.x + o.w / 2, o.y + o.h / 2, 10, "#8ab4ff");
        obstacles.splice(i, 1);
        cleared++;
      }
    }
    S.spawnGap = Math.max(S.spawnGap, S.speed * CFG.GAP_MIN);   // 下一波至少隔一个正常最小间距
    if (cleared) shake = Math.max(shake, 5);
  }

  /* ═══════════ DOM 引用 ═══════════ */
  var elScore   = document.getElementById("run-score");
  var elBest    = document.getElementById("run-best");
  var elCoins   = document.getElementById("run-coins");
  var elWallet  = document.getElementById("run-wallet");
  var elOverlay = document.getElementById("run-overlay");
  var elOvTitle = document.getElementById("run-ov-title");
  var elOvText  = document.getElementById("run-ov-text");
  var elOvBtn   = document.getElementById("run-ov-btn");
  var elRecords = document.getElementById("run-records");
  var elToast   = document.getElementById("run-toast");
  var btnJumpIn = document.getElementById("run-jump");
  var btnDuckIn = document.getElementById("run-duck");
  var btnMute   = document.getElementById("run-mute");
  var btnHelp   = document.getElementById("run-help");
  var elShop    = document.getElementById("run-shop");        // 商店弹层（骨架在页面里，内容由 shop.js 填）
  var btnShopX  = document.getElementById("run-shop-close");
  var elRank    = document.getElementById("run-rank");        // 云端排行榜弹层（内容由 rank.js 填）

  var KEY_BEST = "runner-best";
  var KEY_SCORES = "runner-scores";
  var KEY_MUTE = "runner-mute";

  /* ═══════════ 皮肤仓库（static/skins.js，与商店页共用同一份） ═══════════
     正常情况下 skins.js 与本文件同目录同源、由页面先加载；万一没加载到，
     退回到内置的最小实现，至少不会白屏。 */
  var Skins = window.RunnerSkins;
  if (!Skins) {
    var DEF_P = { id: "classic", name: "经典火柴人", ink: "#28324a", inkNight: "#f2f5fa", scarf: "#ff5f6d", eye: "#28324a" };
    var DEF_C = { id: "gold", name: "经典金币", shape: "coin", dark: "#d99a1c", face: "#f7c33d", hi: "#ffe9a8", halo: "rgba(255,209,102,0.22)" };
    Skins = {
      getPlayer: function () { return DEF_P; },
      getCoin: function () { return DEF_C; },
      getWallet: function () { return 0; },
      addWallet: function () { return 0; },
      setWallet: function () { return 0; },
      equipped: function () { return null; },
      drawStick: function (c, sk, o) {                    // 简化火柴人
        o = o || {};
        var ink = (o.night ? sk.inkNight : sk.ink) || sk.ink;
        c.save(); c.scale(o.scale || 1, o.scale || 1);
        c.strokeStyle = sk.scarf; c.lineWidth = 4.6; c.lineCap = "round";
        c.beginPath(); c.moveTo(-2, -41);
        c.quadraticCurveTo(-14, -33, -25, -35); c.stroke();
        c.strokeStyle = ink; c.lineWidth = 4;
        c.beginPath();
        c.moveTo(1, -42); c.lineTo(0, -22);
        c.moveTo(0, -22); c.lineTo(-11, -1); c.moveTo(0, -22); c.lineTo(12, -1);
        c.moveTo(0, -37); c.lineTo(-10, -26); c.moveTo(0, -37); c.lineTo(11, -26);
        c.stroke();
        c.fillStyle = "#ffdfc6";
        c.beginPath(); c.arc(1, -52, 10, 0, 6.2832); c.fill();
        c.strokeStyle = ink; c.lineWidth = 1.5;
        c.beginPath(); c.arc(1, -52, 10, 0, 6.2832); c.stroke();
        c.fillStyle = "#28324a";
        c.beginPath(); c.arc(4.6, -53.4, 1.7, 0, 6.2832); c.fill();
        c.restore();
      },
      drawCoin: function (c, sk, o) {                     // 简化金币
        o = o || {};
        var cy = o.y + Math.sin((o.t || 0) * 5 + (o.ph || 0)) * 3;
        var rw = 5.5 + Math.abs(Math.sin((o.t || 0) * 3.2 + (o.ph || 0))) * 5.5;
        c.fillStyle = sk.dark;
        c.beginPath(); c.ellipse(o.x, cy, rw, 11, 0, 0, 6.2832); c.fill();
        c.fillStyle = sk.face;
        c.beginPath(); c.ellipse(o.x, cy, Math.max(1.5, rw - 2), 8.8, 0, 0, 6.2832); c.fill();
        c.fillStyle = sk.hi;
        c.beginPath(); c.ellipse(o.x, cy, Math.max(0.7, rw * 0.44), 4.8, 0, 0, 6.2832); c.fill();
      }
    };
  }

  /* 当前装备的皮肤（存档里的 id 失效时由 skins.js 回落到默认款） */
  var skinPlayer = Skins.getPlayer(Skins.equipped ? Skins.equipped("player") : null);
  var skinCoin = Skins.getCoin(Skins.equipped ? Skins.equipped("coin") : null);

  /* ═══════════ 基础工具 ═══════════ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  var random = Math.random;                       // 测试可替换
  function rnd(a, b) { return a + random() * (b - a); }
  function pick(arr) { return arr[Math.floor(random() * arr.length) % arr.length]; }

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) {}
    return null;
  }

  function hex2rgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function mix(a, b, t) {
    var A = hex2rgb(a), B = hex2rgb(b), o = "#";
    for (var i = 0; i < 3; i++) {
      var v = Math.round(A[i] + (B[i] - A[i]) * t);
      o += (v < 16 ? "0" : "") + v.toString(16);
    }
    return o;
  }
  function rgba(hex, a) { var c = hex2rgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  /* 圆角矩形路径（不依赖 ctx.roundRect，兼容老浏览器） */
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function pad5(n) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < 5) s = "0" + s;
    return s;
  }

  /* ═══════════ 音效（WebAudio 实时合成） ═══════════ */
  var Sfx = (function () {
    var ac = null, muted = store(KEY_MUTE) === "1";
    function ctxAudio() {
      if (ac) return ac;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (e) { ac = null; }
      return ac;
    }
    function tone(freq, dur, type, gain, slideTo) {
      if (muted) return;
      var a = ctxAudio(); if (!a) return;
      if (a.state === "suspended" && a.resume) a.resume();
      var o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime;
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.06, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(dur, gain) {
      if (muted) return;
      var a = ctxAudio(); if (!a) return;
      var len = Math.floor(a.sampleRate * dur);
      var buf = a.createBuffer(1, len, a.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var s = a.createBufferSource(), g = a.createGain();
      s.buffer = buf; g.gain.value = gain || 0.15;
      s.connect(g); g.connect(a.destination); s.start();
    }
    function seq(freqs, gap, dur, type, gain) {
      freqs.forEach(function (f, i) {
        setTimeout(function () { tone(f, dur, type, gain); }, i * gap);
      });
    }
    return {
      jump:  function () { tone(430, 0.13, "square", 0.05, 780); },
      land:  function () { tone(150, 0.06, "sine", 0.035); },
      coin:  function () { tone(880, 0.07, "triangle", 0.05); setTimeout(function () { tone(1320, 0.09, "triangle", 0.045); }, 55); },
      boost: function () { seq([523, 659, 784, 1046], 70, 0.12, "triangle", 0.05); },
      crash: function () { noise(0.28, 0.16); tone(320, 0.42, "sawtooth", 0.07, 70); },
      best:  function () { seq([659, 784, 988, 1318], 110, 0.16, "square", 0.045); },
      isMuted: function () { return muted; },
      setMuted: function (v) { muted = !!v; store(KEY_MUTE, muted ? "1" : "0"); },
      wake: function () { var a = ctxAudio(); if (a && a.state === "suspended" && a.resume) a.resume(); }
    };
  })();

  /* ═══════════ 昼夜调色板 ═══════════ */
  var PALETTES = [
    { name: "清晨", dark: false, top: "#9ed7ff", bottom: "#eaf6ff", far: "#c7dcef", mid: "#dbe9f6",
      ground: "#eef2f7", line: "#c3d2e0", ink: "#26313f", orb: "#ffd166", star: 0,   cloud: "#ffffff" },
    { name: "黄昏", dark: false, top: "#ffb187", bottom: "#ffe7c9", far: "#e0a98c", mid: "#f3cdae",
      ground: "#f6e6d6", line: "#d9bda4", ink: "#3b2a24", orb: "#ff8f5e", star: 0.15, cloud: "#fff0e2" },
    { name: "深夜", dark: true,  top: "#0b1723", bottom: "#1d3350", far: "#16324d", mid: "#0f2438",
      ground: "#16283a", line: "#0b1a28", ink: "#e8f1ff", orb: "#f3f0d8", star: 1,   cloud: "#20364c" },
    { name: "破晓", dark: true,  top: "#2a3b66", bottom: "#7d7fb0", far: "#3d4a75", mid: "#4b5686",
      ground: "#4b5470", line: "#333a52", ink: "#f2f5ff", orb: "#ffe9b0", star: 0.6, cloud: "#6a6f9c" }
  ];

  /* 按行进距离取当前配色；每两个阶段之间留出过渡带，避免生硬跳变 */
  function paletteAt(dist) {
    var n = PALETTES.length;
    var f = (dist / CFG.PHASE_DIST) % n;
    if (f < 0) f += n;
    var i = Math.floor(f), t = f - i;
    var a = PALETTES[i], b = PALETTES[(i + 1) % n];
    var tt = t < 0.65 ? 0 : (t - 0.65) / 0.35;      // 前 65% 保持，后 35% 平滑过渡
    return {
      name: tt < 0.5 ? a.name : b.name,
      dark: tt < 0.5 ? a.dark : b.dark,
      top: mix(a.top, b.top, tt), bottom: mix(a.bottom, b.bottom, tt),
      far: mix(a.far, b.far, tt), mid: mix(a.mid, b.mid, tt),
      ground: mix(a.ground, b.ground, tt), line: mix(a.line, b.line, tt),
      ink: mix(a.ink, b.ink, tt), orb: mix(a.orb, b.orb, tt),
      cloud: mix(a.cloud, b.cloud, tt),
      star: a.star + (b.star - a.star) * tt,
      nightK: (a.dark ? 1 : 0) + ((b.dark ? 1 : 0) - (a.dark ? 1 : 0)) * tt
    };
  }

  /* ═══════════ 场景装饰（程序化生成，只算一次） ═══════════ */
  var SKYLINE = (function () {
    var arr = [], x = 0, seed = 20261001;
    function nx() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; }
    while (x < 2600) {
      var w = 46 + Math.floor(nx() * 66);
      var h = 60 + Math.floor(nx() * 150);
      arr.push({ x: x, w: w, h: h, light: nx() });
      x += w + 12 + Math.floor(nx() * 30);
    }
    return arr;
  })();

  var CLOUDS = (function () {
    var arr = [];
    for (var i = 0; i < 6; i++) arr.push({ x: i * 210 + 40 * i % 90, y: 34 + (i * 53 % 76), s: 0.6 + (i % 3) * 0.28 });
    return arr;
  })();

  /* ═══════════ 运行状态 ═══════════ */
  var state = "ready";        // ready | playing | paused | over
  var S = null;               // 局面数据
  var P = null;               // 角色
  var obstacles = [], items = [], parts = [];
  var debris = [];                             // 被无敌撞碎的障碍：短暂存活、被打飞、淡出
  var input = { jumpHeld: false, duckHeld: false };
  var shake = 0, overAt = 0, lastBest = 0, prevState = "ready";
  var bgDist = 0;             // 背景滚动距离（非游戏中也缓慢流动）

  function newState() {
    return {
      speed: CFG.SPEED0, dist: 0, score: 0, coins: 0, earned: 0,
      spawnGap: 520, itemGap: 900, boost: 0, banked: false,
      itemHold: 0, waveHold: 0,                 // 障碍/道具互相避让的距离闸门
      itemPending: false,                       // 金币到点待生成：障碍先让路
      waves: 0, groups: 0,                      // 本局生成的障碍波数 / 道具串数（调试用）
      time: 0, best: lastBest, isBest: false
    };
  }

  function resetGame() {
    S = newState();
    P = { y: CFG.GROUND, vy: 0, onGround: true, duck: false, coyote: 0, run: 0 };
    obstacles.length = 0; items.length = 0; parts.length = 0; debris.length = 0;
    itemLog.length = 0;                            // 道具出生记录也一起清
    input.jumpHeld = false; input.duckHeld = false;
    shake = 0;
    state = "ready";
    showOverlay("ready");
    updateHud();
  }

  /* ═══════════ 障碍 / 道具 ═══════════ */
  var GROUND_KINDS = [
    { id: "cup",   w: 32, h: 46 },
    { id: "box",   w: 46, h: 52 },
    { id: "cone",  w: 36, h: 50 },
    { id: "stack", w: 44, h: 72 }
  ];
  var AIR_KINDS = [
    { id: "paper", w: 40, h: 26 },
    { id: "drone", w: 56, h: 30 }
  ];

  function addObstacle(kind, x, hOverride) {
    var def = kind === "air" ? pick(AIR_KINDS) : pick(GROUND_KINDS);
    var h = hOverride || def.h;
    var o = {
      kind: kind, id: def.id, x: x, w: def.w, h: h,
      y: kind === "air" ? CFG.GROUND - CFG.AIR_GAP - h : CFG.GROUND - h,
      phase: random() * 6.28
    };
    obstacles.push(o);
    return o;
  }

  /* ── 道具出生记录（调试/测试用：核对每颗金币是不是真的吃得到） ── */
  var itemSeq = 0;                             // 道具自增 id：外部（测试）可精确追踪同一颗金币
  var itemLog = [];
  function logItem(it) {
    if (itemLog.length >= 800) return;
    itemLog.push({
      id: it.id, kind: it.kind, x0: it.x, y: it.y, r: it.r,
      h: CFG.GROUND - it.y,                       // 出生时中心离地高度
      dash: !!it.dash,                            // 冲刺金币雨标记（不受跑道闸门约束）
      dist: S ? S.dist : 0, speed: S ? S.speed : 0
    });
  }

  function addFishArc(x, count) {
    /* 拱顶 ≤ 148px 可达（满跳脚底 155px、判定半径 33 → 玩家中心最高够到 ~157px），
       旧参数 78+rnd(0,46) 时拱顶最高 158px，最高处几颗永远吃不到 */
    var baseY = CFG.GROUND - (76 + rnd(0, 30));
    var ph = rnd(0, 6.28);                        // 整串同相位浮动，排列整齐不东倒西歪
    var span = Math.max(1, count - 1);
    for (var i = 0; i < count; i++) {
      var it = {
        id: ++itemSeq, kind: "coin", x: x + i * 42, r: 11, ph: ph,
        y: baseY - Math.sin(i / span * Math.PI) * 34
      };
      items.push(it);
      logItem(it);
    }
    return span * 42 + 22;                        // 整串宽度（给「后方空档」用）
  }
  function addCoffee(x) {
    var it = { id: ++itemSeq, kind: "coffee", x: x, y: CFG.GROUND - 74 - rnd(0, 40), r: 14, ph: 0 };
    items.push(it);
    logItem(it);
  }
  /* 无敌冲刺专用「金币雨」：贴地一排，冲刺时直接扫进兜里。
     · 不需要跑道（无敌撞不坏障碍），也不用等障碍让路；
     · 贴地摆放（y = 地面上方 DASH_Y），站着跑就能吃到，绝不会变成「吃不到的金币」；
     · 放在障碍出生区（W+40~140）之外，不干扰障碍生成；
     · dash 标记：外部测试区分「冲刺币」与常规金币（常规币受跑道闸门约束）。 */
  function addDashLine(x) {
    var ph = rnd(0, 6.28);
    var n = CFG.DASH_COINS_MIN + Math.floor(random() * (CFG.DASH_COINS_MAX - CFG.DASH_COINS_MIN + 1));
    for (var i = 0; i < n; i++) {
      var it = { id: ++itemSeq, kind: "coin", x: x + i * 42, r: 11, ph: ph, y: CFG.GROUND - CFG.DASH_Y, dash: true };
      items.push(it);
      logItem(it);
    }
    return n * 42;
  }
  /* [x0, x1] 区间是否没有障碍（生成道具用） */
  function areaClear(x0, x1) {
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.x < x1 && o.x + o.w > x0) return false;
    }
    return true;
  }
  /* [x0, x1] 区间是否没有道具（生成障碍用，防止金币卡进障碍里） */
  function itemsClear(x0, x1) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.x > x0 - 30 && it.x < x1 + 30) return false;
    }
    return true;
  }

  /* ═══════════ 粒子 ═══════════ */
  function puff(x, y, n, color, spread) {
    for (var i = 0; i < n; i++) {
      parts.push({
        x: x, y: y, vx: -rnd(20, 120), vy: -rnd(10, 90) * (spread || 1),
        life: rnd(0.28, 0.6), max: 0.6, r: rnd(1.6, 3.6), c: color || "#c9d3de", g: 260
      });
    }
  }
  function sparkle(x, y, n, color) {
    for (var i = 0; i < n; i++) {
      var a = rnd(0, 6.28), sp = rnd(60, 220);
      parts.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: rnd(0.3, 0.65), max: 0.65, r: rnd(1.6, 3.4), c: color || "#ffd166", g: 300
      });
    }
  }

  /* ═══════════ 操作 ═══════════ */
  function curH() { return P.duck ? CFG.DUCK_H : CFG.STAND_H; }

  function doJump() {
    if (state !== "playing") return;
    if (P.onGround || P.coyote > 0) {
      P.vy = CFG.JUMP_V;
      P.onGround = false;
      P.coyote = 0;
      P.duck = false;
      puff(CFG.PX, CFG.GROUND, 6, "#ffffff", 0.6);
      Sfx.jump();
    }
  }

  function applyDuck(on) {
    if (state !== "playing") return;
    P.duck = on;
  }

  function togglePause() {
    if (state === "playing") { state = "paused"; showOverlay("paused"); }
    else if (state === "paused") { state = "playing"; hideOverlay(); Sfx.wake(); }
  }

  function startGame() {
    var prevBest = lastBest;
    resetGame();
    lastBest = prevBest;
    S.best = prevBest;
    state = "playing";
    hideOverlay();
    updateHud();
    Sfx.wake();
  }

  function gameOver() {
    state = "over";
    overAt = Date.now();
    shake = 16;
    puff(CFG.PX, P.y - 20, 18, "#8d98a6", 1.4);
    sparkle(CFG.PX, P.y - 34, 12, "#ff7a86");
    Sfx.crash();

    var score = Math.floor(S.score);
    S.isBest = score > S.best;
    if (S.isBest) {
      S.best = score;
      lastBest = score;
      store(KEY_BEST, String(score));
      Sfx.best();
      toast("🎉 新纪录！");
    }
    saveRecord(score);
    S.earned = bankCoins();                      // 本局金币进钱包（S.banked 保证只入账一次）
    showOverlay("over");
    updateHud();
    /* 交给云端排行榜：未登录时 rank.js 不会发任何请求 */
    try {
      document.dispatchEvent(new CustomEvent("run:over", {
        detail: { score: score, coins: S.coins, distance: Math.floor(S.dist / 100) }
      }));
    } catch (e) {}
  }

  /* ═══════════ 本机记录（localStorage，最多 5 条） ═══════════ */
  function loadRecords() {
    try {
      var raw = store(KEY_SCORES);
      var arr = raw ? JSON.parse(raw) : [];
      return Object.prototype.toString.call(arr) === "[object Array]" ? arr : [];
    } catch (e) { return []; }
  }
  function saveRecord(score) {
    if (score <= 0) return;
    var arr = loadRecords();
    arr.push({ s: score, t: Date.now() });
    arr.sort(function (a, b) { return b.s - a.s; });
    arr = arr.slice(0, 5);
    try { store(KEY_SCORES, JSON.stringify(arr)); } catch (e) {}
  }
  function renderRecords() {
    if (!elRecords) return;
    var arr = loadRecords();
    if (!arr.length) { elRecords.innerHTML = ""; return; }
    var html = "";
    for (var i = 0; i < arr.length; i++) {
      var d = new Date(arr[i].t);
      html += "<li><b>#" + (i + 1) + "</b><span>" + arr[i].s + " 分</span><span>" +
        (d.getMonth() + 1) + "/" + d.getDate() + "</span></li>";
    }
    elRecords.innerHTML = html;
  }

  /* ═══════════ 遮罩层 ═══════════ */
  var SHOP_LINK = "<button type='button' class='run-shop-link' data-open-shop>🛍 皮肤商店</button>";

  var HELP_HTML = "按 <b>空格</b>/<b>↑</b>/<b>W</b> 起跳，长按跳得更高；<br>" +
    "按 <b>↓</b>/<b>S</b> 下蹲，空中按下蹲可加速下落；<br>" +
    "地面的障碍要 <b>跳过</b>，飞在空中的要 <b>下蹲</b> 躲开；<br>" +
    "金币 +10 分并存入钱包，<em>护盾</em> 让你 3.6 秒无敌冲刺：撞坏障碍额外加分，一路还有贴地金币雨扫进兜里。<br>" +
    "钱包里的金币可以到商店兑换火柴人皮肤和金币皮肤。<br>" +
    "速度会越来越快，坚持越久分数越高。";

  function showOverlay(kind) {
    if (!elOverlay) return;
    elOvBtn.dataset.mode = "";
    elOverlay.classList.remove("hidden");
    if (kind === "ready") {
      elOvTitle.textContent = "火柴人快跑";
      elOvText.innerHTML = "按 <b>空格</b> / <b>↑</b> 起跳，长按跳更高；<b>↓</b> 下蹲躲飞行物。<br>" +
        "收集金币存进钱包，<em>护盾</em> 可短暂无敌冲刺，冲刺期间出金币雨。<br>" +
        "钱包余额 <b>" + Skins.getWallet() + "</b> 🪙 · " + SHOP_LINK;
      elOvBtn.textContent = "开始奔跑";
      renderRecords();
    } else if (kind === "paused") {
      elOvTitle.textContent = "已暂停";
      elOvText.innerHTML = "按 <b>P</b> 或点下面的按钮继续。";
      elOvBtn.textContent = "继续";
      elRecords.innerHTML = "";
    } else if (kind === "over") {
      elOvTitle.textContent = S.isBest ? "🎉 新纪录！" : "本轮结束";
      elOvText.innerHTML = "<span class='run-big'>" + Math.floor(S.score) + "</span>" +
        "最高分 <b>" + Math.floor(S.best) + "</b> ｜ 跑了 <b>" + Math.floor(S.dist / 100) + "</b> 米<br>" +
        "本局金币 <b>" + S.coins + "</b> 枚 ｜ 钱包余额 <b>" + Skins.getWallet() + "</b> 🪙<br>" + SHOP_LINK;
      elOvBtn.textContent = "再来一局";
      renderRecords();
    }
  }
  function hideOverlay() { if (elOverlay) elOverlay.classList.add("hidden"); }

  /* ═══════════ 皮肤商店（就在本页弹层里，不跳页） ═══════════
     shop.js 负责商品与购买，这里只管「逛店时把局面定格、关掉后原样恢复」。 */
  var shopPrev = null;                       // 进商店前的游戏状态

  function shopOpen() { return !!elShop && !elShop.classList.contains("hidden"); }
  function rankOpen() { return !!elRank && !elRank.classList.contains("hidden"); }

  function refreshSkin() {                   // 换上的皮肤立刻生效
    skinPlayer = Skins.getPlayer(Skins.equipped ? Skins.equipped("player") : null);
    skinCoin = Skins.getCoin(Skins.equipped ? Skins.equipped("coin") : null);
    updateHud();
  }

  function afterShopOpen() {
    shopPrev = state;
    if (state === "playing") state = "paused";   // 逛商店时先定格，回来再接着跑
    hideOverlay();
  }

  function afterShopClose() {
    if (shopPrev === "playing") { state = "playing"; hideOverlay(); }
    else if (shopPrev === "over") showOverlay("over");
    else if (shopPrev === "paused") showOverlay("paused");
    else showOverlay("ready");
    shopPrev = null;
    refreshSkin();
  }

  function openShop() {
    if (!elShop || shopOpen()) return;
    if (window.Shop && window.Shop.open) window.Shop.open();   // open() 会派发 shop:open
    else { elShop.classList.remove("hidden"); afterShopOpen(); }
  }
  function closeShop() {
    if (!shopOpen()) return;
    if (window.Shop && window.Shop.close) window.Shop.close(); // close() 会派发 shop:close
    else { elShop.classList.add("hidden"); afterShopClose(); }
  }

  document.addEventListener("shop:open", afterShopOpen);
  document.addEventListener("shop:close", afterShopClose);
  document.addEventListener("shop:change", refreshSkin);       // 买完立即换装
  /* 云端排行榜弹层用的是同一套「开面板先定格、关掉原样恢复」逻辑 */
  document.addEventListener("rank:open", afterShopOpen);
  document.addEventListener("rank:close", afterShopClose);
  /* rank.js 借这里弹提示（成绩上传结果、云存档同步结果） */
  document.addEventListener("run:toast", function (e) { if (e.detail) toast(e.detail); });

  var toastTimer = null;
  function toast(msg) {
    if (!elToast) return;
    elToast.textContent = msg;
    elToast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.classList.remove("show"); }, 1800);
  }

  function updateHud() {
    if (elScore) elScore.textContent = "SCORE: " + pad5(S ? S.score : 0);
    if (elBest) elBest.textContent = "HI: " + pad5(lastBest);
    if (elCoins) elCoins.textContent = "🪙 " + (S ? S.coins : 0);
    if (elWallet) elWallet.textContent = "钱包 " + Skins.getWallet();
  }

  /* 局末把本局收集的金币存进钱包；S.banked 保证同一局只入账一次 */
  function bankCoins() {
    if (!S || S.banked || S.coins <= 0) return 0;
    S.banked = true;
    Skins.addWallet(S.coins);
    return S.coins;
  }

  /* ═══════════ 主逻辑步进 ═══════════ */
  function step(dt) {
    if (state !== "playing") {
      bgDist += 40 * dt;
      updateParticles(dt);
      updateDebris(dt);
      if (shake > 0) shake = Math.max(0, shake - 60 * dt);
      return;
    }

    var boosting = S.boost > 0;
    var mul = boostMul();                          // 冲刺倍率（收尾期平滑回落）
    S.time += dt;
    S.speed = Math.min(CFG.SPEED_MAX, CFG.SPEED0 + CFG.SPEED_ACC * S.time);
    var move = S.speed * mul * dt;

    S.dist += move;
    S.score += move * CFG.SCORE_PER_PX * (boosting ? 1.35 : 1);
    if (boosting) {
      S.boost = Math.max(0, S.boost - dt);
      if (S.boost <= 0) endBoost();                // 归零：清掉贴脸障碍、重置出障碍节奏
    }

    /* ── 角色物理 ── */
    if (P.onGround) P.y = CFG.GROUND;
    P.coyote = P.onGround ? CFG.COYOTE : Math.max(0, P.coyote - dt);
    P.vy += CFG.GRAVITY * dt;
    if (!P.onGround && input.duckHeld) P.vy += CFG.FAST_FALL * dt;
    if (!input.jumpHeld && P.vy < CFG.JUMP_CUT_MIN) P.vy += CFG.JUMP_CUT * dt;
    P.y += P.vy * dt;

    if (P.y >= CFG.GROUND) {
      if (!P.onGround) { puff(CFG.PX, CFG.GROUND, 5, "#ffffff", 0.5); Sfx.land(); }
      P.y = CFG.GROUND; P.vy = 0; P.onGround = true;
    } else {
      P.onGround = false;
    }
    P.run += (P.onGround ? S.speed : 0) * dt * 0.055;
    if (P.onGround && !P.duck && random() < 0.16) puff(CFG.PX - 12, CFG.GROUND, 1, "#ffffff", 0.35);

    /* ── 生成障碍 ──
       · waveHold：金币串刚过去没多久就不放障碍，免得玩家刚吃完金币、人还在空中就撞上；
       · itemPending：金币已经「到点该生成」但跑道还没空出来时，障碍先让路，
         否则障碍比跑道还密的话，金币会被无限期挤掉（永远等不到空档）；
       · itemsClear：出生点附近有道具时先避让，防止道具卡进障碍里。 */
    var boostTail = boosting && S.boost <= CFG.BOOST_TAIL;   // 冲刺收尾：只收尾、不出新障碍
    S.spawnGap -= move;
    if (S.spawnGap <= 0) {
      if (!boostTail && !S.itemPending && S.dist >= S.waveHold && itemsClear(CFG.W + 40, CFG.W + 140)) {
        spawnWave();
        /* 间距按「实际位移倍率」换算：冲刺时人跑得快，若还按 S.speed 算间隔，
           障碍在时间上会密 1.18 倍 —— 那正是「冲太快」的一部分 */
        S.spawnGap = S.speed * mul * rnd(CFG.GAP_MIN, CFG.GAP_MAX);
      } else {
        S.spawnGap = 140;                        // 被挡：往前挪一点再试，不整波吞掉
      }
    }

    /* ── 生成道具 ──
       无敌冲刺期间走「金币雨」：贴地成排、间隔短、不等跑道（无敌撞不坏障碍）；
       平时走常规金币/护盾生成（itemHold + areaClear 跑道闸门）。 */
    S.itemGap -= move;
    if (S.itemGap <= 0) {
      if (boosting) {
        /* 无敌 = 金币雨：冲刺的 3.6 秒里金币不断，随出随扫进兜里 */
        addDashLine(CFG.W + 260);
        S.itemGap = rnd(CFG.DASH_GAP_MIN, CFG.DASH_GAP_MAX);
        S.groups++;
      } else {
        /* 金币落点的两个前提：
           ① 距上一波障碍已过去 itemRunway()（够玩家落地、再从容起跳）；
           ② 出生点前方 itemRunway() 内没有障碍 —— 否则玩家会「刚跳过障碍、还在半空」
              眼看着金币从脚下溜走，这就是之前「有些金币根本吃不到」的原因。 */
        var runway = itemRunway();
        S.itemPending = true;                    // 先占位：让障碍暂停生成，把跑道空出来
        if (S.dist >= S.itemHold && areaClear(CFG.W + 60 - runway, CFG.W + 380)) {
          var w;
          if (random() < 0.18) { addCoffee(CFG.W + 60); w = 28; }
          else w = addFishArc(CFG.W + 60, 3 + Math.floor(random() * 3));
          S.itemGap = rnd(900, 1700) + S.speed;
          S.waveHold = S.dist + w + waveRunway();
          S.groups++;
          S.itemPending = false;
        } else {
          S.itemGap = 120;
        }
      }
    }

    /* ── 障碍推进 + 碰撞 ── */
    for (var i = obstacles.length - 1; i >= 0; i--) {
      var o = obstacles[i];
      o.x -= move;
      if (o.x + o.w < -40) { obstacles.splice(i, 1); continue; }
      if (hit(o)) {
        if (boosting) {
          addDebris(o);                            // 击飞表现：障碍本体翻滚着飞出去
          sparkle(o.x + o.w / 2, o.y, 14, "#ffd166");
          S.score += 8;
          shake = Math.max(shake, 6);
          obstacles.splice(i, 1);
          continue;
        }
        gameOver();
        return;
      }
    }

    /* ── 道具推进 + 拾取 ──
       金币带「磁吸」：只要玩家跳到金币附近（默认 76px 内），金币就会主动飞过来。
       跑步类游戏里金币是奖励不是惩罚，宁可让手感松一点，也不要「差一点吃不到」。 */
    for (var j = items.length - 1; j >= 0; j--) {
      var it = items[j];
      it.x -= move;
      if (it.x + it.r < -30) { items.splice(j, 1); continue; }

      var pcx = CFG.PX, pcy = P.y - curH() * 0.5;      // 玩家碰撞盒中心
      var dx = pcx - it.x, dy = pcy - it.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var pick = it.r + (it.kind === "coin" ? CFG.COIN_PICK : 22);

      if (it.kind === "coin" && dist < CFG.COIN_MAGNET && dist > 0.001) {
        var pullStep = Math.min(CFG.MAGNET_SPEED * dt, dist);
        it.x += (dx / dist) * pullStep;
        it.y += (dy / dist) * pullStep;
        dx = pcx - it.x; dy = pcy - it.y;
        dist = Math.sqrt(dx * dx + dy * dy);
      }

      if (dist < pick) {
        if (it.kind === "coin") {
          S.coins++; S.score += CFG.COIN_SCORE;
          sparkle(it.x, it.y, 6, "#ffd166"); Sfx.coin();
        } else {
          S.boost = CFG.SHIELD_TIME;
          sparkle(it.x, it.y, 18, "#8ab4ff"); Sfx.boost();
          toast("🛡 护盾开启！无敌冲刺 · 金币雨");
          /* 开场先在玩家前方撒一排（屏幕中段，半秒内就到），别让冲刺开头空手；
             后续的排由出币计时器按 DASH_FIRST/DASH_GAP 接力 */
          addDashLine(CFG.PX + 320);
          S.itemGap = Math.min(S.itemGap, CFG.DASH_FIRST);
        }
        items.splice(j, 1);
      }
    }

    updateParticles(dt);
    updateDebris(dt);
    if (shake > 0) shake = Math.max(0, shake - 60 * dt);
    updateHud();
  }

  /* 生成一波障碍。
     间距由 step() 按当前速度换算，保证「任意速度下都能落地再起跳」；
     另外连排障碍的高度和数量都做了限制——
     跳跃滞空时间 ≈ 0.655s，若一组障碍太宽／太高，低速时会出现理论无解。
     实测约束：双连高度 ≤ 44、三连只在速度 ≥ 520 出现且高度 ≤ 40。 */
  var CLUSTER_H2 = 44;
  var CLUSTER_H3 = 40;
  var TRIPLE_MIN_SPEED = 520;

  function spawnWave() {
    var speed = S.speed;
    var from = CFG.W + 60;
    var end = from;                                // 这一波最右侧（决定后方要留多少空档）
    function push(kind, x, h) {
      var o = addObstacle(kind, x, h);
      if (x + o.w > end) end = x + o.w;
      return o;
    }

    if (speed > 600 && random() < 0.32) {
      push("air", from);                           // 飞行物：必须下蹲
    } else {
      var r = random();
      if (r < 0.5) {
        push("ground", from);
      } else if (r < 0.82 || speed < TRIPLE_MIN_SPEED) {
        var o1 = push("ground", from);
        push("ground", from + o1.w + 6, Math.min(o1.h, CLUSTER_H2));
      } else {
        var o2 = push("ground", from);
        push("ground", from + o2.w + 6, CLUSTER_H3);
        push("ground", from + o2.w * 2 + 12, Math.min(o2.h, CLUSTER_H3 - 6));
      }
    }

    /* 这一波之后必须留够「落地 + 再起跳」的距离，才允许生成金币 */
    S.itemHold = S.dist + (end - from) + itemRunway();
    S.waves++;
  }

  function hit(o) {
    var pw = CFG.BODY_W - CFG.HIT_PAD * 2;
    var ph = curH() - CFG.HIT_PAD * 2;
    var px = CFG.PX - pw / 2, py = P.y - CFG.HIT_PAD - ph;
    /* 横向判定宽度必须跟**画面**一致：
       地面障碍换成贴图后，图片是按高度定比例的细长条（巧乐兹宽高比 0.42），
       画出来比碰撞盒窄 18px 左右；若还按碰撞盒算，玩家会在离障碍还有十几像素
       时就看到它碎掉（无敌冲刺撞碎时特别刺眼）。
       画面比碰撞盒宽的（空中雪碧瓶）仍按碰撞盒算——那是偏袒玩家的宽容。 */
    var vis = obVisual(o);
    var ow = vis ? Math.min(o.w, vis.w) : o.w;
    var ox = o.x + (o.w - ow) / 2;                // 图片以碰撞盒中心为轴，左右对称
    var oy = o.y + 3, oh = o.h - 6;
    return px < ox + ow && px + pw > ox && py < oy + oh && py + ph > oy;
  }

  function updateParticles(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (state === "playing") p.x -= S.speed * dt * 0.55;
    }
  }

  /* ── 无敌撞碎的「击飞」表现 ──
     以前障碍被撞就是当帧整个消失，只留几个小光点 —— 玩家看到的是
     「障碍还在眼前，下一帧凭空没了」，尤其冲刺速度快，观感是「没碰到就碎」。
     现在把障碍本体变成碎块：往后上方翻滚飞出、重力下坠、淡出，
     眼睛能看到「它被撞飞了」，而不是「它没了」。 */
  function addDebris(o) {
    var vis = obVisual(o);
    var im = vis ? vis.im : null;
    var w = vis ? vis.w : o.w, h = vis ? vis.h : o.h;
    var cy = o.kind === "ground" ? CFG.GROUND - h / 2 : o.y + o.h / 2;
    debris.push({
      im: im, w: w, h: h, kind: o.kind,
      x: o.x + o.w / 2,
      y: cy,
      /* 撞击点就在角色脸上，碎块必须立刻离开角色：先向上抛起，
         再随世界后掠（约 0.75 倍世界速度）从角色**身后**扫过去 ——
         碎块画在角色图层之下，看起来就是「撞碎了、残骸从身后飞走」 */
      vx: rnd(-60, 140), vy: -rnd(200, 400),
      rot: 0, vr: rnd(3.5, 9) * (random() < 0.5 ? -1 : 1),
      life: rnd(0.35, 0.5), max: 0.5
    });
    if (debris.length > 20) debris.shift();    // 兜底，防止极端情况堆积
  }

  function updateDebris(dt) {
    for (var i = debris.length - 1; i >= 0; i--) {
      var b = debris[i];
      b.life -= dt;
      if (b.life <= 0) { debris.splice(i, 1); continue; }
      b.x += (b.vx - (state === "playing" ? S.speed * 0.75 : 0)) * dt;
      b.y += b.vy * dt;
      b.vy += 1100 * dt;
      b.rot += b.vr * dt;
    }
  }

  function drawDebris() {
    for (var i = 0; i < debris.length; i++) {
      var b = debris[i];
      var a = clamp(b.life / b.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      if (b.im) ctx.drawImage(b.im, -b.w / 2, -b.h / 2, b.w, b.h);
      else { ctx.fillStyle = "#b9c4cf"; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); }
      ctx.restore();
    }
  }

  /* ═══════════ 渲染 ═══════════ */
  var dpr = 1;
  function resize() {
    dpr = Math.min(CFG.DPR_MAX, window.devicePixelRatio || 1);
    canvas.width = Math.round(CFG.W * dpr);
    canvas.height = Math.round(CFG.H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldDist() { return bgDist + (S ? S.dist : 0); }

  function render() {
    var pal = paletteAt(worldDist() * 0.4);
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake) * 0.4, rnd(-shake, shake) * 0.4);
    drawSky(pal);
    drawSkyline(pal);
    drawGround(pal);
    for (var k = 0; k < items.length; k++) drawItem(items[k]);
    for (var m = 0; m < obstacles.length; m++) drawObstacle(obstacles[m], pal);
    drawDebris();
    drawPlayer(pal);
    drawParticles();
    drawBoostFx();
    ctx.restore();
  }

  function drawSky(pal) {
    var g = ctx.createLinearGradient(0, 0, 0, CFG.GROUND);
    g.addColorStop(0, pal.top);
    g.addColorStop(1, pal.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CFG.W, CFG.GROUND);

    if (pal.star > 0.05) {                       // 星空
      ctx.fillStyle = "rgba(255,255,255," + (0.85 * pal.star) + ")";
      for (var i = 0; i < 46; i++) {
        var tw = 0.7 + 0.5 * Math.sin((S ? S.time : 0) * 2 + i);
        ctx.fillRect((i * 137.5) % CFG.W, (i * 61.7) % 190, 1.7 * tw, 1.7 * tw);
      }
    }

    var orbX = CFG.W - 150, orbY = 74;           // 太阳 / 月亮
    ctx.fillStyle = rgba(pal.orb, 0.26);
    ctx.beginPath(); ctx.arc(orbX, orbY, 40, 0, 6.2832); ctx.fill();
    ctx.fillStyle = pal.orb;
    ctx.beginPath(); ctx.arc(orbX, orbY, 25, 0, 6.2832); ctx.fill();
    if (pal.nightK > 0.5) {                      // 夜里补成月牙
      ctx.fillStyle = pal.top;
      ctx.beginPath(); ctx.arc(orbX - 12, orbY - 7, 22, 0, 6.2832); ctx.fill();
    }

    ctx.fillStyle = rgba(pal.cloud, pal.nightK > 0.5 ? 0.24 : 0.9);
    var off = (worldDist() * 0.05) % 1500;
    for (var c = 0; c < CLOUDS.length; c++) {
      var cl = CLOUDS[c];
      cloud(((cl.x - off) % 1500 + 1500) % 1500 - 150, cl.y, cl.s);
    }
  }

  function cloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 16 * s, 0, 6.2832);
    ctx.arc(x + 20 * s, y - 9 * s, 20 * s, 0, 6.2832);
    ctx.arc(x + 44 * s, y, 15 * s, 0, 6.2832);
    ctx.rect(x, y, 44 * s, 14 * s);
    ctx.fill();
  }

  function drawSkyline(pal) {
    var base = CFG.GROUND;
    var offF = (worldDist() * 0.22) % 2600;
    ctx.fillStyle = pal.far;
    for (var i = 0; i < SKYLINE.length; i++) {
      var b = SKYLINE[i], bx = b.x - offF;
      if (bx > CFG.W + 60 || bx + b.w < -60) continue;
      ctx.fillRect(bx, base - b.h - 26, b.w, b.h + 26);
    }
    var offM = (worldDist() * 0.42) % 2600;
    for (var j = 0; j < SKYLINE.length; j++) {
      var b2 = SKYLINE[j], bx2 = b2.x * 1.14 - offM;
      if (bx2 > CFG.W + 60 || bx2 + b2.w < -60) continue;
      var h2 = b2.h * 0.62;
      ctx.fillStyle = pal.mid;
      ctx.fillRect(bx2, base - h2 - 8, b2.w * 0.8, h2 + 8);
      if (b2.light > 0.45) {                     // 窗户灯光
        ctx.fillStyle = rgba(pal.orb, pal.nightK > 0.5 ? 0.5 : 0.22);
        for (var wy = 0; wy < 3; wy++) {
          for (var wx = 0; wx < 2; wx++) ctx.fillRect(bx2 + 8 + wx * 18, base - h2 + 10 + wy * 22, 9, 12);
        }
      }
    }
  }

  function drawGround(pal) {
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, CFG.GROUND, CFG.W, CFG.H - CFG.GROUND);
    ctx.fillStyle = pal.line;
    ctx.fillRect(0, CFG.GROUND, CFG.W, 3);

    var off = worldDist() % 90;                  // 地砖纹理，强化速度感
    ctx.strokeStyle = rgba(pal.line, 0.85);
    ctx.lineWidth = 2;
    for (var x = -off; x < CFG.W + 90; x += 90) {
      ctx.beginPath(); ctx.moveTo(x, CFG.GROUND + 6); ctx.lineTo(x - 26, CFG.H); ctx.stroke();
    }
    ctx.strokeStyle = rgba(pal.line, 0.5);
    for (var y = CFG.GROUND + 20; y < CFG.H; y += 18) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CFG.W, y); ctx.stroke();
    }
  }

  /* ── 障碍外观素材（致谢 seia-runner：地面=巧乐兹、空中=雪碧瓶）──
     图片未加载完 / 加载失败（含无图测试环境）时自动回退到下面的矢量画法 */
  var OB_IMG = {};
  (function () {
    var srcs = {
      qiaolezi: "/img/qiaolezi.webp", qiaoleziAlt: "/img/qiaolezi-alt.webp",
      sprite: "/img/sprite-bottle.webp"
    };
    for (var k in srcs) {
      var im = null;
      try { im = new Image(); im.src = srcs[k]; } catch (e) { im = null; }
      OB_IMG[k] = im;
    }
  })();
  function obImgOk(im) { return !!im && im.complete && im.naturalWidth > 0; }

  /* 障碍「看起来多大」的参数。地面障碍按碰撞盒高定画面高（略大一点点），
     空中障碍按碰撞盒宽定画面宽。 */
  var OB_VIS = {
    ghScale: 1.12, ghPad: 8, ghMin: 48, ghMax: 82,     // 地面：画面高 = clamp(h × 1.12 + 8, 48, 82)
    airScale: 1.05, airPad: 4                          // 空中：画面宽 = w × 1.05 + 4
  };

  /* ⚠️ 绘制与判定**共用同一份几何**（hit() 也调它）。
     曾经两边各算各的：画面按高度定比例画出 27px 宽，判定还按 46px 的碰撞盒算，
     结果「人还没碰到障碍它就碎了」——无敌冲刺撞碎时最明显。
     图片没加载出来（含无图测试环境）时返回 null，两边一起退回矢量画法 / 碰撞盒。 */
  function obVisual(o) {
    var im, w, h;
    if (o.kind === "ground") {
      im = (o.id === "box" || o.id === "stack") ? OB_IMG.qiaoleziAlt : OB_IMG.qiaolezi;
      if (!obImgOk(im)) return null;
      h = clamp(o.h * OB_VIS.ghScale + OB_VIS.ghPad, OB_VIS.ghMin, OB_VIS.ghMax);
      w = h * im.naturalWidth / im.naturalHeight;
    } else {
      im = OB_IMG.sprite;
      if (!obImgOk(im)) return null;
      w = o.w * OB_VIS.airScale + OB_VIS.airPad;
      h = w * im.naturalHeight / im.naturalWidth;
    }
    return { im: im, w: w, h: h };
  }

  /* ── 障碍绘制 ── */
  function drawObstacle(o, pal) {
    ctx.save();

    /* 图片外观：跟着碰撞盒走（以前按「碰撞盒宽 ×2」定比例，画出来 90~112px 高，
       比角色还高一倍，看着太唬人） */
    var vis = obVisual(o);
    if (vis) {
      if (o.kind === "ground") {
        /* 影子跟着画面宽度走 */
        ctx.fillStyle = "rgba(0,0,0,0.16)";
        ctx.beginPath();
        ctx.ellipse(o.x + o.w / 2, CFG.GROUND + 3, vis.w * 0.55, 5, 0, 0, 6.2832);
        ctx.fill();
        ctx.drawImage(vis.im, o.x + o.w / 2 - vis.w / 2, CFG.GROUND - vis.h, vis.w, vis.h);
      } else {
        /* 贴图底边锚在「碰撞盒底再往上抬 10px」，而不是中心对齐：
           · 空中障碍碰撞盒只有 26~30px 高，按中心对齐时 42~57px 高的瓶子图会往下
             多出 8~14px，正好压进下蹲角色的头部 —— 看着像穿模；
           · 下蹲姿态的可见头顶（精灵皮肤 252 / 矢量 267）也比碰撞盒顶（266）高，
             底边只锚到盒底（256±浮动 3.5）仍会蹭到精灵皮肤的头发，
             抬 10px 后瓶子最低点 249.5，与可见头顶最少留 2.5px。 */
        var bob = Math.sin(o.phase + (S ? S.time : 0) * 5.5) * 3.5;      // 沿用飞行物的浮动
        ctx.drawImage(vis.im, o.x + o.w / 2 - vis.w / 2, o.y + o.h - vis.h - 10 + bob, vis.w, vis.h);
      }
      ctx.restore();
      return;
    }

    var x = o.x, y = o.y, w = o.w, h = o.h;

    if (o.id === "cup") {                        // 咖啡杯
      ctx.fillStyle = "#ffffff"; rr(ctx, x, y + 8, w, h - 8, 7); ctx.fill();
      ctx.fillStyle = "#c9613f"; rr(ctx, x - 2, y, w + 4, 12, 5); ctx.fill();
      ctx.fillStyle = "#e8edf3"; rr(ctx, x + 5, y + 20, w - 10, 12, 4); ctx.fill();
      ctx.strokeStyle = "#b9c4cf"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 7, y + 12); ctx.lineTo(x + 7, y + h - 8); ctx.stroke();
    } else if (o.id === "box") {                 // 快递箱
      ctx.fillStyle = "#c48b52"; rr(ctx, x, y, w, h, 6); ctx.fill();
      ctx.fillStyle = "#a9723e"; rr(ctx, x, y, w, 12, 6); ctx.fill();
      ctx.fillStyle = "#e3c39b"; ctx.fillRect(x + w / 2 - 5, y, 10, h);
      ctx.strokeStyle = "#8a5c2e"; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 6); ctx.stroke();
    } else if (o.id === "cone") {                // 路障
      ctx.fillStyle = "#f5842b";
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.fillRect(x + 6, y + h * 0.45, w - 12, 9);
      ctx.fillStyle = "#d96d1c"; rr(ctx, x - 4, y + h - 8, w + 8, 8, 3); ctx.fill();
    } else if (o.id === "stack") {               // 文件堆
      ctx.fillStyle = "#6f7f96"; rr(ctx, x, y + h * 0.5, w, h * 0.5, 6); ctx.fill();
      ctx.fillStyle = "#8b9bb2"; rr(ctx, x + 6, y + h * 0.22, w - 12, h * 0.3, 5); ctx.fill();
      ctx.fillStyle = "#eef2f7"; rr(ctx, x + 14, y, w - 28, h * 0.24, 4); ctx.fill();
      ctx.strokeStyle = "#5b6a80"; ctx.lineWidth = 2; rr(ctx, x, y + h * 0.5, w, h * 0.5, 6); ctx.stroke();
    } else if (o.id === "paper") {               // 飞舞的 A4 纸
      ctx.translate(0, Math.sin(o.phase + (S ? S.time : 0) * 6) * 3);
      ctx.fillStyle = "#ffffff"; rr(ctx, x, y, w, h, 3); ctx.fill();
      ctx.strokeStyle = "#c9d3de"; ctx.lineWidth = 1.5;
      for (var i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.moveTo(x + 5, y + i * 6); ctx.lineTo(x + w - 5, y + i * 6); ctx.stroke();
      }
      ctx.strokeStyle = "#aab6c4"; rr(ctx, x, y, w, h, 3); ctx.stroke();
    } else if (o.id === "drone") {               // 无人机
      ctx.translate(0, Math.sin(o.phase + (S ? S.time : 0) * 5) * 4);
      ctx.strokeStyle = "#4a5568"; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 5); ctx.lineTo(x + w - 8, y + 5);
      ctx.moveTo(x + 8, y + 5); ctx.lineTo(x + 5, y + 13);
      ctx.moveTo(x + w - 8, y + 5); ctx.lineTo(x + w - 5, y + 13);
      ctx.stroke();
      ctx.fillStyle = "#5b6a80"; rr(ctx, x + 12, y + 13, w - 24, h - 17, 7); ctx.fill();
      ctx.fillStyle = "#ff5f6d";
      ctx.beginPath(); ctx.arc(x + w - 18, y + 23, 3.2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#8b9bb2";
      ctx.beginPath();
      ctx.arc(x + 8, y + 4, 6, 0, 6.2832);
      ctx.arc(x + w - 8, y + 4, 6, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ── 道具绘制 ── */
  function drawItem(it) {
    var t = S ? S.time : 0;
    if (it.kind === "coin") {                    // 金币：外观由商店里装备的皮肤决定
      Skins.drawCoin(ctx, skinCoin, { x: it.x, y: it.y, t: t, ph: it.ph || 0 });
    } else {                                     // 护盾（无敌道具）
      var y2 = it.y + Math.sin(t * 4) * 2;
      var pulse = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.fillStyle = "rgba(138,180,255," + (0.16 + 0.16 * pulse) + ")";
      ctx.beginPath(); ctx.arc(it.x, y2, 24, 0, 6.2832); ctx.fill();
      var sw = 14, sh = 16;                              // 盾牌：上平下尖
      ctx.beginPath();
      ctx.moveTo(it.x, y2 - sh);
      ctx.lineTo(it.x + sw, y2 - sh + 6);
      ctx.lineTo(it.x + sw * 0.8, y2 + 7);
      ctx.quadraticCurveTo(it.x + sw * 0.5, y2 + 15, it.x, y2 + sh + 4);
      ctx.quadraticCurveTo(it.x - sw * 0.5, y2 + 15, it.x - sw * 0.8, y2 + 7);
      ctx.lineTo(it.x - sw, y2 - sh + 6);
      ctx.closePath();
      ctx.fillStyle = "#5b8def"; ctx.fill();
      ctx.strokeStyle = "#2f57ab"; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.62)"; ctx.lineWidth = 1.6;
      ctx.beginPath();                                   // 盾面十字
      ctx.moveTo(it.x, y2 - sh + 4); ctx.lineTo(it.x, y2 + sh - 3);
      ctx.moveTo(it.x - 7, y2 - 2); ctx.lineTo(it.x + 7, y2 - 2);
      ctx.stroke();
      ctx.fillStyle = "#eaf1ff";                          // 两颗能量小星
      var sp = t * 2;
      for (var k = 0; k < 2; k++) {
        var a = sp + k * Math.PI, rx = it.x + Math.cos(a) * 20, ry = y2 + Math.sin(a) * 15;
        ctx.beginPath(); ctx.arc(rx, ry, 1.7, 0, 6.2832); ctx.fill();
      }
    }
  }

  /* ── 角色：火柴人（外观由 skins.js 的装备皮肤决定） ── */
  function drawPlayer(pal) {
    var x = CFG.PX, gy = P.y;
    var ducking = P.duck && P.onGround;
    var h = ducking ? CFG.DUCK_H : CFG.STAND_H;
    var t = S ? S.time : 0;

    ctx.fillStyle = "rgba(0,0,0,0.18)";           // 地面影子
    var shrink = clamp(1 - (CFG.GROUND - gy) / 260, 0.35, 1);
    ctx.beginPath();
    ctx.ellipse(x, CFG.GROUND + 3, 18 * shrink, 5 * shrink, 0, 0, 6.2832);
    ctx.fill();

    ctx.save();
    ctx.translate(x, gy);
    Skins.drawStick(ctx, skinPlayer, {
      pose: ducking ? "duck" : (P.onGround ? "run" : "jump"),
      t: t, run: P.run, night: pal.nightK > 0.5
    });

    if (S && S.boost > 0) {                       // 护盾光环（收尾期转暗、闪烁加快 = 无敌要没了）
      var tailK = S.boost < CFG.BOOST_TAIL ? (S.boost / CFG.BOOST_TAIL) : 1;
      var flick = tailK < 1 ? 0.5 + 0.5 * Math.sin(t * 24) : (0.5 + 0.5 * Math.sin(t * 12));
      ctx.strokeStyle = "rgba(91,141,239," + ((0.4 + 0.45 * flick) * (0.4 + 0.6 * tailK)).toFixed(3) + ")";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, -h / 2, 28, h * 0.72, 0, 0, 6.2832); ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var a = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = rgba(p.c, a * 0.85);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * a, 0, 6.2832); ctx.fill();
    }
  }

  function drawBoostFx() {
    if (!S || S.boost <= 0) return;
    ctx.strokeStyle = "rgba(138,180,255,0.5)";
    ctx.lineWidth = 2;
    for (var i = 0; i < 7; i++) {
      var y = 60 + i * 34 + Math.sin(S.time * 8 + i) * 6;
      var len = 60 + ((i * 37) % 90);
      var x = ((S.time * 1400 + i * 220) % (CFG.W + 300)) - 150;
      ctx.beginPath(); ctx.moveTo(CFG.W - x, y); ctx.lineTo(CFG.W - x + len, y); ctx.stroke();
    }
  }

  /* ═══════════ 主循环驱动 ═══════════ */
  var last = 0, rafId = 0;
  function frame(ts) {
    if (window.__RUNNER_MANUAL__) return;         // 测试模式：由 Runner.tick() 手动驱动
    var dt = last ? (ts - last) / 1000 : 0.016;
    last = ts;
    step(clamp(dt, 0, 0.05));
    render();
    rafId = window.requestAnimationFrame(frame);
  }

  /* ═══════════ 事件 ═══════════ */
  function isJumpKey(k, code) {
    return code === "Space" || k === " " || k === "Spacebar" || k === "ArrowUp" || k === "w" || k === "W";
  }
  function isDuckKey(k) { return k === "ArrowDown" || k === "s" || k === "S"; }

  function mayRestart() { return state !== "over" || Date.now() - overAt > 400; }

  function onKeyDown(e) {
    var k = e.key, code = e.code;

    /* 商店开着的时候，键盘只用来关商店，不打扰人物 */
    if (shopOpen()) {
      if (k === "Escape" || k === "p" || k === "P") { e.preventDefault(); closeShop(); }
      else if (k === "m" || k === "M") toggleMute();
      return;
    }
    /* 排行榜弹层同理：开着时按键不穿透到游戏，否则空格会在面板后面把游戏跑起来，
       玩家看不见角色、直接撞死。Escape 由 rank.js 自己处理（关面板），这里不再触发暂停。 */
    if (rankOpen()) {
      if (k === "m" || k === "M") toggleMute();
      return;
    }

    if (isJumpKey(k, code)) {
      e.preventDefault();
      if (state === "paused") { togglePause(); return; }
      if (state === "ready" || state === "over") { if (mayRestart()) startGame(); return; }
      if (!input.jumpHeld) { input.jumpHeld = true; doJump(); }
      return;
    }
    if (isDuckKey(k)) {
      if (state === "playing" || state === "ready") e.preventDefault();
      input.duckHeld = true;
      applyDuck(true);
      return;
    }
    if (k === "p" || k === "P" || k === "Escape") { togglePause(); return; }
    if (k === "m" || k === "M") { toggleMute(); return; }
    if (k === "Enter" && (state === "ready" || state === "over") && mayRestart()) startGame();
  }

  function onKeyUp(e) {
    var k = e.key, code = e.code;
    if (isJumpKey(k, code)) input.jumpHeld = false;
    if (isDuckKey(k)) { input.duckHeld = false; applyDuck(false); }
  }

  function pressJump() { input.jumpHeld = true; doJump(); }
  function releaseJump() { input.jumpHeld = false; }
  function pressDuck() { input.duckHeld = true; applyDuck(true); }
  function releaseDuck() { input.duckHeld = false; applyDuck(false); }

  function bindHold(el, down, up) {
    if (!el) return;
    el.addEventListener("mousedown", function (e) { e.preventDefault(); down(); });
    el.addEventListener("mouseup", function () { up(); });
    el.addEventListener("mouseleave", function () { up(); });
    el.addEventListener("touchstart", function (e) { e.preventDefault(); down(); }, { passive: false });
    el.addEventListener("touchend", function (e) { e.preventDefault(); up(); }, { passive: false });
    el.addEventListener("touchcancel", function () { up(); }, { passive: true });
  }

  function toggleMute() {
    Sfx.setMuted(!Sfx.isMuted());
    if (btnMute) {
      btnMute.setAttribute("aria-pressed", Sfx.isMuted() ? "true" : "false");
      btnMute.textContent = Sfx.isMuted() ? "🔇 静音" : "🔊 音效";
    }
  }

  function openHelp() {
    prevState = state;
    if (state === "playing") state = "paused";
    showOverlay("paused");
    elOvTitle.textContent = "玩法说明";
    elOvText.innerHTML = HELP_HTML;
    elOvBtn.textContent = "知道了";
    elRecords.innerHTML = "";
    elOvBtn.dataset.mode = "back";
  }

  function bind() {
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    bindHold(btnJumpIn, pressJump, releaseJump);
    bindHold(btnDuckIn, pressDuck, releaseDuck);
    bindHold(btnMute, toggleMute, function () {});
    if (btnHelp) btnHelp.addEventListener("click", openHelp);

    /* 所有「🛍 商店 / 皮肤商店」入口共用一套点击委托 */
    root.addEventListener("click", function (e) {
      var n = e.target;
      while (n && n !== root) {
        if (n.hasAttribute && n.hasAttribute("data-open-shop")) {
          e.preventDefault();
          openShop();
          return;
        }
        n = n.parentNode;
      }
    });
    if (btnShopX) btnShopX.addEventListener("click", closeShop);
    if (elShop) elShop.addEventListener("click", function (e) {   // 点遮罩空白处也关掉
      if (e.target === elShop) closeShop();
    });

    if (elOvBtn) elOvBtn.addEventListener("click", function () {
      if (elOvBtn.dataset.mode === "back") {
        elOvBtn.dataset.mode = "";
        if (prevState === "over") showOverlay("over");
        else if (prevState === "paused") showOverlay("paused");
        else if (prevState === "playing") { state = "playing"; hideOverlay(); }
        else showOverlay("ready");
        return;
      }
      if (state === "paused") togglePause();
      else startGame();
    });

    if (stage) {
      stage.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest("[data-open-shop]")) return;  // 点商店入口别顺手开局
        if (state === "paused") { togglePause(); return; }
        if (state === "ready" || state === "over") { if (mayRestart()) startGame(); return; }
        pressJump();
      });
      stage.addEventListener("mouseup", releaseJump);
      stage.addEventListener("mouseleave", releaseJump);

      var touchY = null;
      stage.addEventListener("touchstart", function (e) {
        if (e.target && e.target.closest && e.target.closest("[data-open-shop]")) return;  // 同上
        if (state === "paused") { e.preventDefault(); togglePause(); return; }
        if (state === "ready" || state === "over") {
          e.preventDefault();
          if (mayRestart()) startGame();
          return;
        }
        e.preventDefault();
        touchY = e.touches[0].clientY;
        pressJump();
      }, { passive: false });
      stage.addEventListener("touchmove", function (e) {
        if (touchY == null) return;
        e.preventDefault();
        if (e.touches[0].clientY - touchY > 28) { releaseJump(); pressDuck(); }
      }, { passive: false });
      stage.addEventListener("touchend", function (e) {
        e.preventDefault();
        touchY = null;
        releaseJump(); releaseDuck();
      }, { passive: false });
    }

    window.addEventListener("blur", function () { if (state === "playing") togglePause(); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state === "playing") togglePause();
    });
    window.addEventListener("resize", resize);
  }

  /* ═══════════ 初始化 ═══════════ */
  lastBest = parseInt(store(KEY_BEST) || "0", 10) || 0;
  resize();
  resetGame();
  bind();
  if (btnMute) {
    btnMute.setAttribute("aria-pressed", Sfx.isMuted() ? "true" : "false");
    btnMute.textContent = Sfx.isMuted() ? "🔇 静音" : "🔊 音效";
  }
  render();
  if (!window.__RUNNER_MANUAL__ && window.requestAnimationFrame) rafId = window.requestAnimationFrame(frame);

  /* ═══════════ 对外接口（控制台调试 / 自动化测试） ═══════════ */
  window.Runner = {
    CFG: CFG,
    state: function () { return state; },
    start: startGame,
    reset: resetGame,
    pause: function () { if (state === "playing") togglePause(); },
    resume: function () { if (state === "paused") togglePause(); },
    tick: function (ms) { step(clamp((ms === undefined ? 16.7 : ms) / 1000, 0, 0.05)); render(); },
    jump: pressJump,
    release: function () { releaseJump(); releaseDuck(); },
    duck: function (on) { on ? pressDuck() : releaseDuck(); },
    spawnObstacle: function (kind, x, h) { return addObstacle(kind || "ground", x, h); },
    spawnItem: function (kind, x, y) {
      if (kind === "coffee") addCoffee(x === undefined ? CFG.W + 60 : x);
      else addFishArc(x === undefined ? CFG.W + 60 : x, 1);
      var it = items[items.length - 1];
      if (it && typeof y === "number") it.y = y;
      return it || null;
    },
    records: loadRecords,
    /* 商店弹层（供控制台与测试使用） */
    openShop: openShop,
    closeShop: closeShop,
    shopOpen: shopOpen,
    /* 钱包 / 皮肤（供控制台与测试使用） */
    wallet: function () { return Skins.getWallet(); },
    setWallet: function (n) { var v = Skins.setWallet(n); updateHud(); return v; },
    skins: function () { return { player: skinPlayer, coin: skinCoin }; },
    clearObstacles: function () { obstacles.length = 0; },
    /* 只读快照：供调试与「自动试跑」测试读取当前障碍分布 */
    obstacles: function () {
      return obstacles.map(function (o) {
        return { kind: o.kind, id: o.id, x: o.x, y: o.y, w: o.w, h: o.h };
      });
    },
    items: function () {
      return items.map(function (it) {
        return { id: it.id, kind: it.kind, x: it.x, y: it.y, r: it.r, ph: it.ph, dash: !!it.dash };
      });
    },
    /* 本局所有道具的出生信息（含离地高度），用于核对金币可达性 */
    spawned: function () { return itemLog.slice(); },
    clearRecords: function () {
      try { localStorage.removeItem(KEY_SCORES); localStorage.removeItem(KEY_BEST); } catch (e) {}
      lastBest = 0;                                 // 同步清掉内存里的最高分
      if (S) S.best = 0;
      updateHud();
    },
    setRandom: function (fn) { random = typeof fn === "function" ? fn : Math.random; },
    snapshot: function () {
      return {
        state: state, speed: S.speed, dist: S.dist, score: S.score, coins: S.coins,
        boost: S.boost, best: lastBest, isBest: S.isBest,
        wallet: Skins.getWallet(), banked: S.banked,
        player: { y: P.y, vy: P.vy, onGround: P.onGround, duck: P.duck, h: curH() },
        obstacles: obstacles.length, items: items.length,
        waves: S.waves, groups: S.groups
      };
    }
  };
})();
