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
  var history = [];            // 悔棋栈：每项 = 一步落子的快照（棋盘 + 谁下的）
  var cursor = 0;              // 键盘落子的当前聚焦格

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
    queueCloudPush();
  }

  /* ═══════════ 战绩云同步（2026-10-17，第 17 项） ═══════════
     战绩原本只在本机 localStorage，换设备就归零。现在登录后：
       · 打开页面先拉云端那份，三个难度逐项取「更大的计数」合并
         （两台设备各自打过几局都不能丢，取 max 才合理）；
       · 本地有变化就防抖 1.5s 推上去。
     走 settings.merge 而不是 push —— user_settings 那一列跑酷设置也在用，
     直接 push 会把跑酷的设置整块冲掉。 */
  var pushTimer = null;
  function queueCloudPush() {
    var C = window.WowCloud;
    if (!C || !C.settings || !C.settings.merge) return;
    if (!(C.user && C.user())) return;              // 未登录：只存本机
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      var snap = { easy: score.easy, mid: score.mid, hard: score.hard };
      try { C.settings.merge({ __ttt: snap })["catch"](function () {}); } catch (e) {}
    }, 1500);
  }

  function pullCloudScore() {
    var C = window.WowCloud;
    if (!C || !C.settings || !C.settings.pull) return;
    if (!(C.user && C.user())) return;
    C.settings.pull().then(function (r) {
      if (r && r.error) return;
      var text = r && r.data && r.data.settings;
      if (!text) return;
      var obj = null;
      try { obj = JSON.parse(text); } catch (e) { return; }
      var remote = obj && obj.__ttt;
      if (!remote) return;
      var changed = false;
      var modes = ["easy", "mid", "hard"];
      for (var i = 0; i < modes.length; i++) {
        var m = modes[i], a = score[m], b = norm(remote[m]);
        var win = Math.max(a.win, b.win), draw = Math.max(a.draw, b.draw), lose = Math.max(a.lose, b.lose);
        if (win !== a.win || draw !== a.draw || lose !== a.lose) changed = true;
        score[m] = { win: win, draw: draw, lose: lose };
      }
      if (changed) {
        try { localStorage.setItem(KEY, JSON.stringify(score)); } catch (e) {}
        paintScore();
        queueCloudPush();                       // 本机这边更全，回推一次把两边拉齐
      }
    })["catch"](function () {});
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
    var glyph = v === ME ? "×" : (v === AI ? "○" : "");
    var cur = el.firstElementChild ? el.firstElementChild.textContent : "";
    /* 只在「真的落了新子」时重建节点：这样落子动画（ttt-drop）每次只播一遍，
       而不是每次 paintAll 都把整盘棋子重新掉一次。 */
    if (glyph && cur !== glyph) {
      el.innerHTML = '<span class="ttt-p ' + (v === ME ? "ttt-px" : "ttt-po") + '">' + glyph + "</span>";
    } else if (!glyph && el.textContent) {
      el.textContent = "";
    }
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

  /* ═══════════ 悔棋（2026-10-17） ═══════════
     一次悔棋退掉「玩家这一手 + 电脑应的一手」，回到玩家落子前。
     已分出结果（over）后不给悔：那一局已经计入战绩、也提交过排行榜积分，
     让玩家事后反悔等于自己改战绩。 */
  var btnUndo = document.getElementById("ttt-undo");
  function canUndo() {
    if (over || lock) return false;
    for (var i = history.length - 1; i >= 0; i--) if (history[i].who === ME) return true;
    return false;
  }
  function paintUndo() {
    if (!btnUndo) return;
    var ok = canUndo();
    btnUndo.disabled = !ok;
    btnUndo.classList.toggle("is-off", !ok);
    btnUndo.setAttribute("aria-disabled", ok ? "false" : "true");
  }
  function undo() {
    if (!canUndo()) return;
    var at = -1;
    for (var i = history.length - 1; i >= 0; i--) if (history[i].who === ME) { at = i; break; }
    if (at < 0) return;
    clearAiTimer();
    board = history[at].before.slice();
    history.length = at;             // 连同这一手之后的电脑应手一起丢掉
    over = false;
    lock = false;
    clearWinHighlight();
    paintAll();
    paintUndo();
    say("已悔棋，轮到你（×）" + levelLabel());
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
    history = [];
    over = false;
    lock = false;
    clearWinHighlight();
    paintAll();
    paintUndo();
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
    paintUndo();
    /* 成就：本游戏专属（胜负平 + 连胜 + 累计对局） */
    if (window.GameAch) {
      window.GameAch.report({ kind: w.p === ME ? "win" : (w.p === AI ? "lose" : "draw"), mode: mode });
    }
    if (window.WowHaptics) window.WowHaptics.play(w.p === ME ? "win" : (w.p === AI ? "hit" : "tap"));
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
    history.push({ before: board.slice(), idx: mv, who: AI });
    board[mv] = AI;
    paintCell(mv);
    var w = winInfo(board);
    if (w) { settle(w); return; }
    lock = false;
    paintAll();
    paintUndo();
    say("轮到你（×）" + levelLabel());
  }

  function play(i) {
    if (over || lock || board[i] !== EMPTY) return;
    history.push({ before: board.slice(), idx: i, who: ME });
    board[i] = ME;
    paintCell(i);
    if (window.WowHaptics) window.WowHaptics.play("tap");
    var w = winInfo(board);
    if (w) { settle(w); return; }
    lock = true;
    paintAll();
    paintUndo();
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

  /* ═══════════ 键盘操作（2026-10-17） ═══════════
     1-9 直接落子（数字小键盘布局，5 就是正中间）；方向键在九宫格里挪焦点，
     Enter / 空格交给 button 原生行为；Backspace / Z 悔棋，R 重开。 */
  document.addEventListener("keydown", function (e) {
    if (setPanelOpen()) return;                 // 设置弹窗开着时不抢键
    /* 个人中心里的登录框、改名框是输入区：在那儿敲 1-9 是打字，不是落子 */
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    /* 难度下拉框（#ttt-level）也有自己的键盘语义：1-9 是数字快选、方向键切换选项。
       不挡住它，焦点会被抢到棋盘格上，纯键盘用户选不了难度（2026-10-23 修）。 */
    if (t && (t.tagName === "SELECT" || (t.closest && t.closest("select")))) return;
    if (window.MeCenter && window.MeCenter.isOpen && window.MeCenter.isOpen()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k >= "1" && k <= "9" && k.length === 1) {
      var idx = Number(k) - 1;
      if (cells[idx] && !cells[idx].disabled) { e.preventDefault(); play(idx); }
      return;
    }
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      var cur = -1;
      for (var i = 0; i < 9; i++) if (cells[i] === document.activeElement) { cur = i; break; }
      if (cur < 0) cur = 4;
      var to = cur;
      if (k === "ArrowLeft" && cur % 3 > 0) to = cur - 1;
      if (k === "ArrowRight" && cur % 3 < 2) to = cur + 1;
      if (k === "ArrowUp" && cur > 2) to = cur - 3;
      if (k === "ArrowDown" && cur < 6) to = cur + 3;
      if (cells[to] && cells[to].focus) { e.preventDefault(); cells[to].focus(); }
      return;
    }
    if (k === "Backspace" || k === "z" || k === "Z") {
      if (canUndo()) { e.preventDefault(); undo(); }
      return;
    }
    if (k === "r" || k === "R") { e.preventDefault(); reset(); }
  });

  if (btnUndo) {
    btnUndo.addEventListener("click", function () {
      if (!canUndo()) { say("现在没有可以悔的棋（电脑思考中或本局已结束）", false); return; }
      undo();
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
  /* 顶栏的「设置」按钮已收进个人中心（第 34 项），入口改由 meplus.js 派发 */
  document.addEventListener("game:set-open", openSet);
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
  pullCloudScore();
})();
