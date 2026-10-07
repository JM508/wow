/* ══════════════════════════════════════════════════════════════
   井字棋（/tictactoe/）
   ──────────────────────────────────────────────────────────────
   · 玩家执 ×，电脑执 ○，按难度决定棋力：
       简单 = 随机落子（偶尔也会撞上赢法）
       中等 = 能赢就赢、要挡就挡，其余随机（会漏，但不好糊弄）
       困难 = minimax 完整搜索，理论上不可战胜（最好结果是平局）
   · 战绩按难度分别存在本机（localStorage）。
   · 积分（2026-10-06 用户要求）：胜 +难度分、负 −难度分、平不动（简单 1 / 中等 2 / 困难 3）。
     每个难度各算各的，排行榜上排的就是这个积分。
   · 云端：把当前难度的积分提交到 game_scores（GameRank 只收比本人更高的分，
     所以输棋掉分那一次不会覆盖榜上的最好成绩）。
     「清空战绩」同时删掉云端排行榜里自己的井字棋成绩。
   · 成就：本游戏专属一套，走 GameAch（gameach.js）；每局结束报胜/负/平。
   · 设置面板：谁先起手（我先 / 电脑先）、清空战绩（带确认弹窗）。
   · 打开个人中心 / 排行榜时不再对局（这不是实时游戏，只把电脑的「思考」压住）。
   · 外链脚本、无内联代码（CSP 同源白名单）。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var root = document.getElementById("ttt-root");
  if (!root) return;

  var elBoard = document.getElementById("ttt-board");
  var elMsg = document.getElementById("ttt-msg");
  var elLevel = document.getElementById("ttt-level");
  var elWin = document.getElementById("ttt-sc-win");
  var elDraw = document.getElementById("ttt-sc-draw");
  var elLose = document.getElementById("ttt-sc-lose");

  var ME = 1, AI = 2, EMPTY = 0;
  var LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  var KEY = "ttt-score-v1";
  var KEY_FIRST = "ttt-first-v1";   // 谁先起手："me"（默认）| "ai"
  var POINTS = { easy: 1, mid: 2, hard: 3 };   // 赢一局的得分（按难度）
  var AI_DELAY = 380;          // 电脑「思考」一下，别像抢答

  var cells = [];
  for (var c = 0; c < 9; c++) cells.push(elBoard.querySelector('[data-i="' + c + '"]'));

  var board = newBoard();
  var over = false;            // 本局已分出结果
  var lock = false;            // 电脑思考中，禁点
  var mode = elLevel ? elLevel.value : "easy";
  var score = loadScore();
  var first = loadFirst();

  function newBoard() { return [0, 0, 0, 0, 0, 0, 0, 0, 0]; }

  /* ═══════════ 设置：谁先起手 ═══════════ */
  function loadFirst() {
    try { return localStorage.getItem(KEY_FIRST) === "ai" ? "ai" : "me"; } catch (e) { return "me"; }
  }
  function saveFirst(v) {
    first = v === "ai" ? "ai" : "me";
    try { localStorage.setItem(KEY_FIRST, first); } catch (e) {}
  }
  function paintFirstUi() {
    var btns = document.querySelectorAll(".ttt-first-btn");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-first") === first;
      btns[i].classList[on ? "add" : "remove"]("is-on");
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /* ═══════════ 战绩（本机，按难度分开） ═══════════ */
  function loadScore() {
    var all = null;
    try { all = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { all = null; }
    if (!all || typeof all !== "object") all = {};
    return {
      easy: norm(all.easy), mid: norm(all.mid), hard: norm(all.hard)
    };
  }
  function norm(o) {
    return { win: Math.max(0, (o && o.win) | 0), draw: Math.max(0, (o && o.draw) | 0), lose: Math.max(0, (o && o.lose) | 0) };
  }
  function saveScore() {
    try { localStorage.setItem(KEY, JSON.stringify(score)); } catch (e) {}
  }
  function paintScore() {
    var s = score[mode];
    if (elWin) elWin.textContent = s.win;
    if (elDraw) elDraw.textContent = s.draw;
    if (elLose) elLose.textContent = s.lose;
  }

  /* 本难度积分：胜 +难度分、负 −难度分、平 0（2026-10-06 用户要求） */
  function points(m) {
    var s = score[m] || { win: 0, lose: 0 };
    return ((s.win | 0) - (s.lose | 0)) * (POINTS[m] || 1);
  }

  /* ═══════════ 规则 ═══════════ */
  function winInfo(b) {
    for (var i = 0; i < LINES.length; i++) {
      var L = LINES[i];
      if (b[L[0]] && b[L[0]] === b[L[1]] && b[L[0]] === b[L[2]]) return { p: b[L[0]], line: L };
    }
    for (var j = 0; j < 9; j++) if (!b[j]) return null;     // 还有空位
    return { p: 3, line: null };                             // 3 = 平局
  }
  function empties(b) {
    var a = [];
    for (var i = 0; i < 9; i++) if (!b[i]) a.push(i);
    return a;
  }

  /* ═══════════ 电脑棋力 ═══════════ */
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  /* 立刻能赢的落点（没有就 null） */
  function winningMove(b, who) {
    var e = empties(b);
    for (var i = 0; i < e.length; i++) {
      b[e[i]] = who;
      var w = winInfo(b);
      b[e[i]] = EMPTY;
      if (w && w.p === who) return e[i];
    }
    return null;
  }

  /* minimax：AI 想赢、玩家会输；同分时随机取，避免每局一模一样 */
  function minimax(b, turn) {
    var w = winInfo(b);
    if (w) {
      if (w.p === AI) return { score: 10 - depth(b) };
      if (w.p === ME) return { score: depth(b) - 10 };
      return { score: 0 };
    }
    var e = empties(b), best = null;
    for (var i = 0; i < e.length; i++) {
      var idx = e[i];
      b[idx] = turn;
      var r = minimax(b, turn === AI ? ME : AI);
      b[idx] = EMPTY;
      r.move = idx;
      if (best === null) best = r;
      else if (turn === AI ? r.score > best.score : r.score < best.score) best = r;
      else if (r.score === best.score && Math.random() < 0.35) best = r;   // 同分随机
    }
    return best || { score: 0, move: -1 };
  }
  function depth(b) {
    var n = 0;
    for (var i = 0; i < 9; i++) if (b[i]) n++;
    return n;
  }

  function aiMove() {
    var e = empties(board);
    if (!e.length) return -1;
    if (mode === "easy") return pick(e);

    if (mode === "mid") {
      var w = winningMove(board, AI);        // 能赢就赢
      if (w !== null) return w;
      var blk = winningMove(board, ME);      // 该挡就挡
      if (blk !== null) return blk;
      if (board[4] === EMPTY && Math.random() < 0.7) return 4;   // 中等：爱占中
      return pick(e);
    }
    /* 困难：完整搜索 */
    var r = minimax(board.slice(), AI);
    return r && r.move >= 0 && board[r.move] === EMPTY ? r.move : pick(e);
  }

  /* ═══════════ 渲染 ═══════════ */
  function paintCell(i) {
    var el = cells[i];
    if (!el) return;
    var v = board[i];
    el.textContent = v === ME ? "×" : (v === AI ? "○" : "");
    el.classList.toggle("ttt-x", v === ME);
    el.classList.toggle("ttt-o", v === AI);
    el.disabled = v !== EMPTY || over || lock;
  }
  function paintAll() {
    for (var i = 0; i < 9; i++) paintCell(i);
  }
  function say(html, isEnd) {
    if (!elMsg) return;
    elMsg.className = "ttt-msg" + (isEnd ? " ttt-msg-end" : "");
    elMsg.innerHTML = html;
  }
  function clearWinHighlight() {
    for (var i = 0; i < 9; i++) cells[i] && cells[i].classList.remove("ttt-win");
  }
  function markWin(line) {
    if (!line) return;
    for (var i = 0; i < line.length; i++) cells[line[i]] && cells[line[i]].classList.add("ttt-win");
  }

  /* ═══════════ 一局流程 ═══════════ */
  /* AI 的「思考中」定时器必须随 reset 清掉：思考中换难度 / 换先手会重开一局，
     旧定时器若还挂着，会在新棋盘上照常落子（先手的 + 新局的 = 电脑一手变两手）。 */
  var aiTimer = null;
  function clearAiTimer() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  }
  function aiLater(fn) {
    clearAiTimer();
    aiTimer = setTimeout(fn, AI_DELAY);
  }

  function reset() {
    clearAiTimer();
    board = newBoard();
    over = false;
    lock = false;
    clearWinHighlight();
    paintAll();
    if (first === "ai") {
      say("电脑执 ○ 先手" + levelLabel() + "，电脑思考中…");
      lock = true;
      paintAll();
      aiLater(function () {
        if (over) { lock = false; return; }
        aiTurn();
      });
    } else {
      say("你执 × 先手，点格子落子" + levelLabel());
    }
    paintScore();
  }
  function levelLabel() {
    return mode === "easy" ? "（简单）" : (mode === "mid" ? "（中等）" : "（困难）");
  }

  function settle(w) {
    over = true;
    if (w.p === ME) { score[mode].win++; saveScore(); }
    else if (w.p === AI) { score[mode].lose++; saveScore(); }
    else { score[mode].draw++; saveScore(); }
    paintScore();
    markWin(w.line);
    paintAll();
    /* 成就：本游戏专属（胜负平 + 连胜 + 累计对局） */
    if (window.GameAch) {
      window.GameAch.report({ kind: w.p === ME ? "win" : (w.p === AI ? "lose" : "draw"), mode: mode });
    }
    var pts = points(mode), pd = POINTS[mode] || 1;
    var txt = w.p === ME ? "你赢了！" : (w.p === AI ? "电脑赢了" : "平局");
    var tipTxt = w.p === ME ? "本局 +" + pd + " 分"
      : (w.p === AI ? "本局 −" + pd + " 分" : "平局不加不减");
    say("<span>" + txt + "（" + tipTxt + "，本难度积分 " + pts + " 分）</span>" +
      "<button type='button' class='ttt-again' id='ttt-again'>再来一局</button>", true);
    var again = document.getElementById("ttt-again");
    if (again) again.addEventListener("click", reset);
    submitScore();
  }

  /* ═══════════ 云端成绩（2026-10-06 改为积分制） ═══════════
     提交的是「本难度的累计积分」，不是单局得分。GameRank 内部只收比本人榜上
     更高的分，所以输棋掉分的那一次会被挡下，榜上留的是这个难度赚到过的最高积分。 */
  function submitScore() {
    if (!window.GameRank) return;
    var pts = points(mode);
    if (pts <= 0) return;
    window.GameRank.submit(mode, pts).then(function (r) {
      if (r && r.error) return;
      var tip = document.createElement("span");
      tip.className = "ttt-msg-tip";
      tip.textContent = r && r.skipped
        ? "（排行榜保留更高的积分，这次不覆盖）"
        : "（已上榜：积分 " + pts + " 分）";
      if (elMsg) elMsg.appendChild(tip);
    }).catch(function () {});
  }

  function aiTurn() {
    var mv = aiMove();
    if (mv < 0) return;
    board[mv] = AI;
    paintCell(mv);
    var w = winInfo(board);
    if (w) { settle(w); return; }
    lock = false;
    paintAll();
    say("轮到你（×）" + levelLabel());
  }

  function play(i) {
    if (over || lock || board[i] !== EMPTY) return;
    board[i] = ME;
    paintCell(i);
    var w = winInfo(board);
    if (w) { settle(w); return; }
    lock = true;
    paintAll();
    say("电脑思考中…");
    aiLater(function () {
      if (over) { lock = false; return; }
      lock = false;
      aiTurn();
    });
  }

  /* ═══════════ 事件 ═══════════ */
  elBoard.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".ttt-cell") : null;
    if (!t) return;
    play(Number(t.getAttribute("data-i")) | 0);
  });

  if (elLevel) {
    elLevel.addEventListener("change", function () {
      mode = elLevel.value;
      reset();
    });
  }

  /* ═══════════ 设置面板（谁先起手 / 清空战绩） ═══════════ */
  var elSet = document.getElementById("ttt-set");
  var btnSetOpen = document.getElementById("ttt-set-open");
  var btnSetClose = document.getElementById("ttt-set-close");
  var elConfirm = document.getElementById("ttt-clear-confirm");

  function setPanelOpen() { return !!elSet && !elSet.classList.contains("hidden"); }
  function openSet() {
    if (!elSet) return;
    elSet.classList.remove("hidden");
    if (elConfirm) elConfirm.classList.add("hidden");
    paintFirstUi();
    if (btnSetClose) btnSetClose.focus();
  }
  function closeSet() { if (elSet) elSet.classList.add("hidden"); }

  if (btnSetOpen) btnSetOpen.addEventListener("click", openSet);
  if (btnSetClose) btnSetClose.addEventListener("click", closeSet);
  if (elSet) elSet.addEventListener("click", function (e) { if (e.target === elSet) closeSet(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && setPanelOpen()) { e.preventDefault(); closeSet(); }
  });
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest(".ttt-first-btn") : null;
    if (!b) return;
    saveFirst(b.getAttribute("data-first"));
    paintFirstUi();
    reset();                                   // 换先手立刻开新一局
  });

  /* 清空战绩：两段确认 —— 第二段里明说「排行榜数据也会清除」 */
  var btnClear = document.getElementById("ttt-clear");
  if (btnClear) btnClear.addEventListener("click", function () {
    if (elConfirm) elConfirm.classList.remove("hidden");
  });
  var btnClearNo = document.getElementById("ttt-clear-no");
  if (btnClearNo) btnClearNo.addEventListener("click", function () {
    if (elConfirm) elConfirm.classList.add("hidden");
  });
  var btnClearYes = document.getElementById("ttt-clear-yes");
  if (btnClearYes) btnClearYes.addEventListener("click", function () {
    score = { easy: { win: 0, draw: 0, lose: 0 }, mid: { win: 0, draw: 0, lose: 0 }, hard: { win: 0, draw: 0, lose: 0 } };
    saveScore();
    paintScore();
    if (elConfirm) elConfirm.classList.add("hidden");
    clearCloudScores();
    reset();
  });

  /* 云端清除：cloud.js 的 RPC（登录按账号删，访客按设备删）。
     云服务不可用时静默跳过 —— 本机战绩已经清了，下次连上云再由用户手动重试。 */
  function clearCloudScores() {
    try {
      if (window.WowCloud && window.WowCloud.games && window.WowCloud.games.clearMy) {
        window.WowCloud.games.clearMy("ttt").then(function (r) {
          if (r && r.error) return;
          if (window.GameRank) window.GameRank.reload();
        }).catch(function () {});
      }
    } catch (e) {}
  }

  reset();
})();
