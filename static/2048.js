/* ══════════════════════════════════════════════════════════════
   2048（2026-10-22 新增）
   ──────────────────────────────────────────────────────────────
   · 4×4 棋盘，方向键 / WASD / 触屏滑动移动，相同数字合并
   · 经典模式真随机；每日挑战按日期种子（mulberry32）——
     同一天所有人拿到的方块序列完全一致
   · 分数上报走 GameRank（game_scores 表，game=2048，经典=easy / 每日=daily）
   · 云不可用 / 网络失败不丢局：ScoreQueue 离线队列联网自动补榜
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var SIZE = 4;
  var KEY_BEST = "g2048-best-v1";

  var rootEl = document.getElementById("g2048-root");
  if (!rootEl) return;

  var boardEl = document.getElementById("g2048-board");
  var tilesEl = document.getElementById("g2048-tiles");
  var scoreEl = document.getElementById("g2048-score");
  var bestEl = document.getElementById("g2048-best");
  var msgEl = document.getElementById("g2048-msg");
  var overEl = document.getElementById("g2048-over");
  var overTEl = document.getElementById("g2048-over-t");
  var overSEl = document.getElementById("g2048-over-s");
  var overBtn = document.getElementById("g2048-over-btn");
  var overCancel = document.getElementById("g2048-over-cancel");
  var newBtn = document.getElementById("g2048-new");
  var levelEl = document.getElementById("g2048-level");

  /* ── 随机源：经典 = 真随机；每日 = 日期种子（与扫雷/贪吃蛇同款） ── */
  function dayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mode() { return levelEl ? levelEl.value : "easy"; }
  function isDaily() { return mode() === "daily"; }
  function rand() {
    if (!state.rand) state.rand = Math.random;
    return state.rand();
  }

  /* ── 状态 ──
     grid: 16 长度数组，null 或 { id, v, r, c }（r/c 用于动画定位） */
  var state = { grid: [], score: 0, best: 0, over: false, won: false, winShown: false, uid: 0, rand: null, busy: false };

  function bestLoad() {
    try { return Math.max(0, parseInt(localStorage.getItem(KEY_BEST) || "0", 10) || 0); } catch (e) { return 0; }
  }
  function bestSave() {
    try { localStorage.setItem(KEY_BEST, String(state.best)); } catch (e) {}
  }

  /* ── 渲染：全量重画。CSP 禁内联 style，位置/字号用 CSSOM 赋值 ── */
  function tileStyle(el, t) {
    var pad = 8;                       /* 与 .g2048-board padding 一致 */
    var w = tilesEl.clientWidth;
    if (!w) return;
    var cell = (w - 3 * 8) / 4;
    el.style.width = cell + "px";
    el.style.height = cell + "px";
    el.style.left = (t.c * (cell + 8)) + "px";
    el.style.top = (t.r * (cell + 8)) + "px";
    var fs = t.v >= 1024 ? Math.round(cell * 0.28) : t.v >= 128 ? Math.round(cell * 0.34) : Math.round(cell * 0.4);
    el.style.fontSize = fs + "px";
  }
  function render(animNew, animMerged) {
    scoreEl.textContent = String(state.score);
    bestEl.textContent = String(state.best);
    var html = "";
    for (var i = 0; i < state.grid.length; i++) {
      var t = state.grid[i];
      if (!t) continue;
      var cls = "g2048-tile g2048-tile" +
        (animNew && animNew.id === t.id ? " is-new" : "") +
        (animMerged && animMerged.id === t.id ? " is-merged" : "");
      var v = t.v <= 2048 ? String(t.v) : "big";
      html += "<div class='" + cls + "' data-v='" + v + "'>" + t.v + "</div>";
    }
    tilesEl.innerHTML = html;
    var k = 0;
    for (var j = 0; j < state.grid.length; j++) {
      var tt = state.grid[j];
      if (!tt) continue;
      tileStyle(tilesEl.children[k], tt);
      k++;
    }
  }

  function emptyCells() {
    var out = [];
    for (var i = 0; i < SIZE * SIZE; i++) if (!state.grid[i]) out.push(i);
    return out;
  }
  function spawn() {
    var empties = emptyCells();
    if (!empties.length) return;
    var idx = empties[Math.floor(rand() * empties.length)];
    var v = rand() < 0.9 ? 2 : 4;
    var t = { id: ++state.uid, v: v, r: Math.floor(idx / SIZE), c: idx % SIZE };
    state.grid[idx] = t;
    return t;
  }

  /* ── 移动与合并：dir = left/right/up/down ── */
  function linesFor(dir) {
    /* 返回 4 条「处理顺序」的索引线：靠近移动方向的格子先处理 */
    var lines = [];
    for (var i = 0; i < SIZE; i++) {
      var line = [];
      for (var j = 0; j < SIZE; j++) {
        var r = dir === "left" || dir === "right" ? i : j;
        var c = dir === "left" || dir === "right" ? j : i;
        if (dir === "right") c = SIZE - 1 - c;
        if (dir === "down") r = SIZE - 1 - r;
        line.push(r * SIZE + c);
      }
      lines.push(line);
    }
    return lines;
  }
  function slide(line) {
    var tiles = [];
    for (var i = 0; i < line.length; i++) if (state.grid[line[i]]) tiles.push(state.grid[line[i]]);
    var merged = null, gained = 0, out = [];
    for (var k = 0; k < tiles.length; k++) {
      if (k + 1 < tiles.length && tiles[k].v === tiles[k + 1].v) {
        var nv = tiles[k].v * 2;
        merged = { id: ++state.uid, v: nv, r: tiles[k].r, c: tiles[k].c };
        out.push(merged);
        gained += nv;
        if (nv === 2048) state.won = true;
        k++;                             /* 跳过被合并的那块 */
      } else {
        out.push(tiles[k]);
      }
    }
    return { out: out, gained: gained, merged: merged };
  }
  function move(dir) {
    if (state.over || state.busy) return false;
    var lines = linesFor(dir);
    var moved = false, gain = 0, mergedTile = null, newGrid = new Array(SIZE * SIZE).fill(null);
    for (var i = 0; i < lines.length; i++) {
      var res = slide(lines[i]);
      gain += res.gained;
      if (res.merged) mergedTile = res.merged;
      for (var j = 0; j < res.out.length; j++) {
        var t = res.out[j];
        var idx = lines[i][j];
        if (t.r !== Math.floor(idx / SIZE) || t.c !== idx % SIZE) moved = true;
        t.r = Math.floor(idx / SIZE);
        t.c = idx % SIZE;
        newGrid[idx] = t;
      }
    }
    if (!moved) return false;
    state.grid = newGrid;
    state.score += gain;
    /* 合并成功才给一下触感；纯滑动不震，避免每滑一下都抖 */
    if (gain > 0 && window.WowHaptics) window.WowHaptics.play("tap");
    if (state.score > state.best) { state.best = state.score; bestSave(); }
    var fresh = spawn();
    render(fresh, mergedTile);
    /* 先判「真的走不动了」，再判「刚达成 2048」——否则达成那一刻棋盘还有空位也会
       被当成结束。达成 2048 只是弹个提示，本局继续（文案就写着能拿更高分）。 */
    if (!canMove()) {
      showOver(false);
      return true;
    }
    if (state.won && !state.winShown) showOver(true);
    return true;
  }
  function canMove() {
    if (emptyCells().length) return true;
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var v = state.grid[r * SIZE + c].v;
        if (c + 1 < SIZE && state.grid[r * SIZE + c + 1].v === v) return true;
        if (r + 1 < SIZE && state.grid[(r + 1) * SIZE + c].v === v) return true;
      }
    }
    return false;
  }

  /* ── 结束弹窗 ──
     win=true 是「达成 2048」的中途提示，不是结束：state.over 必须留 false，
     否则点「知道了」只藏弹层、棋盘却被 move() 的 state.over 守卫锁死（2026-10-23 修）。
     winShown 保证同局只提示一次，继续合并不会每步都弹。 */
  function showOver(win) {
    state.over = !win;
    if (win) state.winShown = true;
    if (window.WowHaptics) window.WowHaptics.play(win ? "win" : "fail");
    if (overTEl) overTEl.textContent = win ? "达成 2048！" : "棋盘满了";
    if (overSEl) {
      overSEl.textContent = (win ? "继续合并还能拿更高分。" : "") +
        "本局得分 " + state.score + " 分" + (isDaily() ? "（每日挑战）" : "") + "。";
    }
    if (overEl) {
      overEl.classList.remove("hidden");
      if (overBtn) overBtn.focus();
    }
    submitScore();
  }
  function hideOver() { if (overEl) overEl.classList.add("hidden"); }

  /* ── 上报（复用 GameRank：云不可用时 grank 内部已进 ScoreQueue 离线队列，
     这里不再重复入队） ── */
  function submitScore() {
    var R = global.GameRank;
    if (R && state.score > 0) R.submit(mode(), state.score);
  }

  /* ── 开局 ── */
  function newGame() {
    state.grid = new Array(SIZE * SIZE).fill(null);
    state.score = 0;
    state.over = false;
    state.won = false;
    state.winShown = false;
    state.rand = isDaily() ? mulberry32(fnv1a("g2048|" + dayKey())) : Math.random;
    var a = spawn(), b = spawn();
    hideOver();
    render(a, null);
    if (msgEl) {
      msgEl.textContent = isDaily()
        ? "每日挑战 " + dayKey() + "：全网同一开局，冲榜吧。"
        : "方向键 / WASD / 滑动来移动方块";
    }
  }

  /* ── 输入 ── */
  var KEYMAP = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    a: "left", d: "right", w: "up", s: "down",
    A: "left", D: "right", W: "up", S: "down"
  };
  document.addEventListener("keydown", function (e) {
    if (state.over) return;
    var dir = KEYMAP[e.key];
    if (!dir) return;
    /* 弹层开着时不抢按键（个人中心 / 排行榜内部有自己的键盘逻辑） */
    if (document.querySelector(".me-pop:not(.hidden), .grank:not(.hidden)")) return;
    e.preventDefault();
    move(dir);
  });

  var touch = null;
  boardEl.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  boardEl.addEventListener("touchend", function (e) {
    if (!touch) return;
    var dx = e.changedTouches[0].clientX - touch.x;
    var dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  }, { passive: true });

  if (newBtn) newBtn.addEventListener("click", newGame);
  if (overBtn) overBtn.addEventListener("click", newGame);
  if (overCancel) overCancel.addEventListener("click", hideOver);
  if (levelEl) levelEl.addEventListener("change", newGame);
  window.addEventListener("resize", function () { render(null, null); });

  /* ═══════════ 对外（测试钩子） ═══════════ */
  global.G2048 = {
    newGame: newGame,
    move: move,
    state: function () {
      return {
        score: state.score, best: state.best, over: state.over, winShown: state.winShown,
        grid: state.grid.map(function (t) { return t ? t.v : 0; }),
        daily: isDaily(), dailyKey: isDaily() ? dayKey() : ""
      };
    }
  };

  state.best = bestLoad();
  newGame();
})(window);
