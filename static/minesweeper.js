
/* 扫雷小游戏逻辑（外链版，无内联脚本，兼容 CSP 纯同源白名单） */
(function () {
  "use strict";

  var LEVELS = {
    easy: { cols: 9,  rows: 9,  mines: 10, max: 30 },
    mid:  { cols: 16, rows: 16, mines: 40, max: 30 },
    hard: { cols: 30, rows: 16, mines: 99, max: 28 }
  };

  var root = document.getElementById("ms-root");
  if (!root) return;

  var GAP = 3;    // 格子间距（与 CSS #ms-board 的 gap 保持一致）
  var PAD = 10;   // 棋盘内边距（与 CSS #ms-board 的 padding 保持一致）

  var boardEl = document.getElementById("ms-board");
  var levelEl = document.getElementById("ms-level");
  var minesEl = document.getElementById("ms-mines");
  var timeEl  = document.getElementById("ms-time");
  var faceEl  = document.getElementById("ms-face");
  var flagBtn = document.getElementById("ms-flagmode");
  var msgEl   = document.getElementById("ms-msg");
  var overEl  = document.getElementById("ms-over");          // 失败弹窗
  var overSubEl = document.getElementById("ms-over-s");
  var overBtnEl = document.getElementById("ms-over-btn");

  var S = null;          // 当前局面状态
  var timerId = null;

  function newGame() {
    stopTimer();
    var lv = LEVELS[levelEl.value] || LEVELS.easy;
    S = {
      cols: lv.cols, rows: lv.rows, mines: lv.mines, max: lv.max,
      cells: [],                 // {mine, adj, open, flag, el}
      placed: false,             // 首次点击后才布雷（保证首点安全）
      over: false, won: false,
      opened: 0, flags: 0,
      seconds: 0
    };
    boardEl.innerHTML = "";
    // 棋盘宽度上限：避免初级难度被拉得过大
    boardEl.style.maxWidth = (S.cols * S.max + GAP * (S.cols - 1) + PAD * 2) + "px";

    var frag = document.createDocumentFragment();
    for (var r = 0; r < S.rows; r++) {
      for (var c = 0; c < S.cols; c++) {
        (function (r, c) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "ms-cell";
          b.setAttribute("role", "gridcell");
          b.setAttribute("aria-label", "未翻开");
          b.addEventListener("click", function () { onCell(r, c, "primary"); });
          b.addEventListener("contextmenu", function (e) {
            e.preventDefault();
            onCell(r, c, "flag");
          });
          // 手机长按插旗
          var lp = null, fired = false;
          b.addEventListener("touchstart", function () {
            fired = false;
            lp = setTimeout(function () { fired = true; onCell(r, c, "flag"); }, 400);
          }, { passive: true });
          b.addEventListener("touchend", function () { clearTimeout(lp); }, { passive: true });
          b.addEventListener("touchmove", function () { clearTimeout(lp); }, { passive: true });
          b.addEventListener("click", function (e) {
            if (fired) { e.stopImmediatePropagation(); fired = false; }
          }, true);
          S.cells.push({ r: r, c: c, mine: false, adj: 0, open: false, flag: false, el: b, lpEl: b });
          frag.appendChild(b);
        })(r, c);
      }
    }
    boardEl.appendChild(frag);
    fitCells();
    hideOver();

    minesEl.textContent = String(S.mines);
    timeEl.textContent = "0";
    faceEl.textContent = "🙂 新游戏";
    msgEl.textContent = "";
    msgEl.className = "ms-msg";
  }

  function idx(r, c) { return r * S.cols + c; }
  function inb(r, c) { return r >= 0 && r < S.rows && c >= 0 && c < S.cols; }  function neighbors(r, c) {
    var out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        if (inb(r + dr, c + dc)) out.push(S.cells[idx(r + dr, c + dc)]);
      }
    }
    return out;
  }

  /* 自适应格子大小：按容器宽度算，超出容器时横向滚动（高级棋盘更宽） */
  function fitCells() {
    if (!S || !boardEl) return;
    var avail = boardEl.clientWidth - PAD * 2;
    var size = Math.floor((avail - GAP * (S.cols - 1)) / S.cols);
    if (!isFinite(size) || size > S.max) size = S.max;   // 上限：不把格子拉太大
    if (size < 22) size = 22;                            // 下限：保证可点击，超出部分横向滚动
    boardEl.style.gridTemplateColumns = "repeat(" + S.cols + ", " + size + "px)";
    boardEl.style.gridAutoRows = size + "px";
    boardEl.style.fontSize = Math.round(size * 0.56) + "px";
  }
  window.addEventListener("resize", fitCells);

  function placeMines(safeR, safeC) {
    var safe = {};
    safe[idx(safeR, safeC)] = true;
    // 首点周围一圈也尽量安全，开局体验更好
    neighbors(safeR, safeC).forEach(function (n) { safe[idx(n.r, n.c)] = true; });
    var pool = [];
    for (var i = 0; i < S.cells.length; i++) if (!safe[i]) pool.push(i);
    // 若雷数接近格子总数，则只保证首格本身安全
    if (pool.length < S.mines) {
      pool = [];
      for (var j = 0; j < S.cells.length; j++) if (j !== idx(safeR, safeC)) pool.push(j);
    }
    for (var k = pool.length - 1; k > 0; k--) {         // Fisher–Yates 洗牌
      var m = Math.floor(Math.random() * (k + 1));
      var t = pool[k]; pool[k] = pool[m]; pool[m] = t;
    }
    for (var x = 0; x < S.mines && x < pool.length; x++) S.cells[pool[x]].mine = true;
    S.cells.forEach(function (cell) {
      cell.adj = cell.mine ? 0 : neighbors(cell.r, cell.c).filter(function (n) { return n.mine; }).length;
    });
    S.placed = true;
    startTimer();
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(function () {
      S.seconds++;
      timeEl.textContent = String(S.seconds);
    }, 1000);
  }
  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  function updateMineCounter() {
    /* 超插旗时夹在 0：显示 -5 会让人以为出了 bug（经典扫雷允许负数，但这里宁可收敛） */
    minesEl.textContent = String(Math.max(0, S.mines - S.flags));
  }

  function onCell(r, c, mode) {
    if (!S || S.over) return;
    if (mode === "primary" && flagBtn.getAttribute("aria-pressed") === "true") mode = "flag";
    var cell = S.cells[idx(r, c)];
    if (mode === "flag") {
      if (cell.open) return;
      cell.flag = !cell.flag;
      cell.flag ? S.flags++ : S.flags--;
      cell.el.textContent = cell.flag ? "🚩" : "";
      cell.el.setAttribute("aria-label", cell.flag ? "已插旗" : "未翻开");
      updateMineCounter();
      return;
    }
    if (cell.flag || cell.open) return;
    if (!S.placed) placeMines(r, c);
    if (cell.mine) { return lose(cell); }
    openCell(cell);
    checkWin();
  }

  function openCell(cell) {
    if (cell.open || cell.flag) return;
    cell.open = true;
    S.opened++;
    cell.el.disabled = true;
    cell.el.classList.add("open");
    cell.el.setAttribute("aria-label", cell.mine ? "地雷" : String(cell.adj));
    if (cell.adj > 0) {
      cell.el.textContent = String(cell.adj);
      cell.el.classList.add("n" + cell.adj);
    }
    if (cell.adj === 0 && !cell.mine) {
      neighbors(cell.r, cell.c).forEach(openCell);      // 空白格泛洪展开
    }
  }

  function lose(boomCell) {
    S.over = true;
    stopTimer();
    boomCell.el.classList.add("boom");
    boomCell.el.textContent = "💥";
    S.cells.forEach(function (cell) {
      cell.el.disabled = true;
      if (cell.mine && cell !== boomCell && !cell.flag) {
        cell.el.textContent = "💣";
        cell.el.classList.add("open");
      }
      if (!cell.mine && cell.flag) {                    // 误标
        cell.el.textContent = "❌";
        cell.el.classList.add("wrongflag");
      }
    });
    faceEl.textContent = "😵 再来一局";
    msgEl.textContent = "💥 踩到地雷了！坚持了 " + S.seconds + " 秒。";
    msgEl.className = "ms-msg lose";
    showOver(S.seconds);            // 失败弹窗：自动弹出，只有「再来一局」能关
  }

  /* ── 失败弹窗 ── */
  function showOver(seconds) {
    if (!overEl) return;
    if (overSubEl) overSubEl.textContent = "坚持了 " + seconds + " 秒";
    overEl.classList.remove("hidden");
    if (overBtnEl) overBtnEl.focus();
  }
  function hideOver() {
    if (overEl) overEl.classList.add("hidden");
  }

  function checkWin() {
    if (S.opened === S.cols * S.rows - S.mines) {
      S.over = true; S.won = true;
      stopTimer();
      S.cells.forEach(function (cell) {
        cell.el.disabled = true;
        if (cell.mine) {
          cell.flag = true;
          cell.el.textContent = "🚩";
        }
      });
      S.flags = S.mines;      // 胜利时剩余雷全部自动插旗，计数同步归零
      updateMineCounter();
      faceEl.textContent = "😎 太棒了";
      msgEl.textContent = "🎉 扫雷成功！用时 " + S.seconds + " 秒。";
      msgEl.className = "ms-msg win";
    }
  }

  faceEl.addEventListener("click", newGame);
  levelEl.addEventListener("change", newGame);
  if (overBtnEl) overBtnEl.addEventListener("click", newGame);
  flagBtn.addEventListener("click", function () {
    var on = flagBtn.getAttribute("aria-pressed") === "true";
    flagBtn.setAttribute("aria-pressed", on ? "false" : "true");
    flagBtn.textContent = on ? "🚩 插旗模式：关" : "🚩 插旗模式：开";
  });
  // 阻止雷区上的浏览器默认右键菜单
  boardEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  newGame();
})();
