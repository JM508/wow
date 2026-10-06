/* ══════════════════════════════════════════════════════════════
   游戏合集 · 专属成就引擎（扫雷 / 井字棋 / 贪吃蛇，2026-10-06）
   ──────────────────────────────────────────────────────────────
   · 用户要求：个人中心里的成就只显示「本游戏」的 —— 跑酷的 19 个成就
     （ach.js）只在跑酷页加载；扫雷 / 井字棋 / 贪吃蛇各自一套，由本文件驱动。
   · 三套成就都存在本机浏览器（localStorage：ms-ach / ttt-ach / snake-ach），
     不上云 —— 跑酷成就的云同步走 ach.js + runner_achievements，互不相干。
   · 判定时机：游戏在关键节点调 report(事件)（胜利 / 失败 / 吃苹果…），
     每次事件后全量重判一遍（成就不超过 15 个，开销可忽略）。
   · 面板复用跑酷的 #run-ach 弹层（#ach-progress / #ach-list），样式同 ach.css。
   · 纯外链脚本、无内联代码（CSP 同源白名单）。对外暴露 window.GameAch
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var SCOPE = document.getElementById("ms-root") ? "ms"
    : document.getElementById("snake-root") ? "snake"
    : document.getElementById("ttt-root") ? "ttt" : null;
  if (!SCOPE) return;                       // 只在三个游戏页启用

  var GAME_NAME = { ms: "扫雷", ttt: "井字棋", snake: "贪吃蛇" }[SCOPE];
  var KEY = { ms: "ms-ach", ttt: "ttt-ach", snake: "snake-ach" }[SCOPE];

  /* ═══════════════ 成就定义 ═══════════════
     c = { s: 累计统计, e: 本次事件 }。
     hidden 成就不进常规判定：其余全部解锁的那一刻自动达成（与跑酷同款）。 */
  var DEFS = {

    /* ─────────── 扫雷 ─────────── */
    ms: [
      { id: "first_win", name: "初战告捷", desc: "首次扫雷成功",
        test: function (c) { return c.s.wins >= 1; } },
      { id: "easy_win", name: "小试身手", desc: "通关初级（9×9）",
        test: function (c) { return c.s.w_easy >= 1; } },
      { id: "mid_win", name: "渐入佳境", desc: "通关中级（16×16）",
        test: function (c) { return c.s.w_mid >= 1; } },
      { id: "hard_win", name: "排雷专家", desc: "通关高级（30×16）",
        test: function (c) { return c.s.w_hard >= 1; } },
      { id: "easy_fast", name: "闪电手", desc: "30 秒内通关初级",
        test: function (c) { return c.s.bsec_easy > 0 && c.s.bsec_easy <= 30; } },
      { id: "mid_fast", name: "快刀斩雷", desc: "120 秒内通关中级",
        test: function (c) { return c.s.bsec_mid > 0 && c.s.bsec_mid <= 120; } },
      { id: "hard_fast", name: "稳准狠", desc: "600 秒内通关高级",
        test: function (c) { return c.s.bsec_hard > 0 && c.s.bsec_hard <= 600; } },
      { id: "noflag_easy", name: "裸奔大师", desc: "不插一面旗通关初级",
        test: function (c) { return c.e.kind === "win" && c.e.mode === "easy" && (c.e.flags | 0) === 0; } },
      { id: "noflag_hard", name: "极限操作", desc: "不插一面旗通关高级",
        test: function (c) { return c.e.kind === "win" && c.e.mode === "hard" && (c.e.flags | 0) === 0; } },
      { id: "flags20", name: "红旗猎手", desc: "单局插上 20 面旗",
        test: function (c) { return (c.e.flags | 0) >= 20; } },
      { id: "streak3", name: "三连胜", desc: "连续通关 3 局（中途不踩雷）",
        test: function (c) { return c.s.streak >= 3; } },
      { id: "wins10", name: "身经百战", desc: "累计通关 10 局",
        test: function (c) { return c.s.wins >= 10; } },
      { id: "opens2000", name: "千格开拓者", desc: "累计翻开 2000 格",
        test: function (c) { return c.s.opens >= 2000; } },
      { id: "wins50", name: "排雷老兵", desc: "累计通关 50 局",
        test: function (c) { return c.s.wins >= 50; } },
      { id: "all_done", name: "达成全部成就", desc: "解锁其余全部成就（隐藏成就）",
        hidden: true, test: function () { return false; } }
    ],

    /* ─────────── 井字棋 ───────────
       积分 = (胜 − 负) × 难度分：简单 1 / 中等 2 / 困难 3，平局不计分 */
    ttt: [
      { id: "first_win", name: "开门红", desc: "首次战胜电脑",
        test: function (c) { return c.s.wins >= 1; } },
      { id: "w_easy", name: "热身运动", desc: "击败简单电脑",
        test: function (c) { return c.s.w_easy >= 1; } },
      { id: "w_mid", name: "棋逢对手", desc: "击败中等电脑",
        test: function (c) { return c.s.w_mid >= 1; } },
      { id: "w_hard", name: "破局者", desc: "击败困难电脑",
        test: function (c) { return c.s.w_hard >= 1; } },
      { id: "streak3", name: "三连胜", desc: "连续获胜 3 局",
        test: function (c) { return c.s.streak >= 3; } },
      { id: "streak5", name: "五连胜", desc: "连续获胜 5 局",
        test: function (c) { return c.s.streak >= 5; } },
      { id: "w_hard3", name: "困难克星", desc: "击败困难电脑 3 次",
        test: function (c) { return c.s.w_hard >= 3; } },
      { id: "score10", name: "积分上双", desc: "某个难度的积分达到 10 分（积分 = 胜减负乘难度分）",
        test: function (c) {
          return Math.max((c.s.w_easy - c.s.l_easy) * 1,
                          (c.s.w_mid - c.s.l_mid) * 2,
                          (c.s.w_hard - c.s.l_hard) * 3) >= 10;
        } },
      { id: "wins10", name: "十全十美", desc: "累计获胜 10 局",
        test: function (c) { return c.s.wins >= 10; } },
      { id: "draw10", name: "和棋大师", desc: "累计下出 10 局平局",
        test: function (c) { return c.s.draws >= 10; } },
      { id: "games50", name: "棋盘常客", desc: "累计对局 50 局",
        test: function (c) { return c.s.games >= 50; } },
      { id: "wins50", name: "胜利收藏家", desc: "累计获胜 50 局",
        test: function (c) { return c.s.wins >= 50; } },
      { id: "all_done", name: "达成全部成就", desc: "解锁其余全部成就（隐藏成就）",
        hidden: true, test: function () { return false; } }
    ],

    /* ─────────── 贪吃蛇（每吃一个苹果 +10 分） ─────────── */
    snake: [
      { id: "first_apple", name: "初尝甜头", desc: "吃到第一个苹果",
        test: function (c) { return c.s.apples >= 1; } },
      { id: "b50", name: "小有胃口", desc: "单局拿到 50 分",
        test: function (c) { return c.s.best >= 50; } },
      { id: "b100", name: "百分小蛇", desc: "单局拿到 100 分",
        test: function (c) { return c.s.best >= 100; } },
      { id: "b300", name: "蛇行千里", desc: "单局拿到 300 分",
        test: function (c) { return c.s.best >= 300; } },
      { id: "b600", name: "贪吃大王", desc: "单局拿到 600 分",
        test: function (c) { return c.s.best >= 600; } },
      { id: "len15", name: "十五节", desc: "蛇长到 15 节",
        test: function (c) { return c.s.bestLen >= 15; } },
      { id: "len25", name: "二十五花", desc: "蛇长到 25 节",
        test: function (c) { return c.s.bestLen >= 25; } },
      { id: "easy300", name: "简单满贯", desc: "简单难度单局 300 分",
        test: function (c) { return c.s.b_easy >= 300; } },
      { id: "mid150", name: "中等好手", desc: "中等难度单局 150 分",
        test: function (c) { return c.s.b_mid >= 150; } },
      { id: "hard100", name: "困难百步", desc: "困难难度单局 100 分",
        test: function (c) { return c.s.b_hard >= 100; } },
      { id: "apples50", name: "五十果", desc: "累计吃掉 50 个苹果",
        test: function (c) { return c.s.apples >= 50; } },
      { id: "apples200", name: "两百果", desc: "累计吃掉 200 个苹果",
        test: function (c) { return c.s.apples >= 200; } },
      { id: "games20", name: "常客", desc: "累计玩 20 局",
        test: function (c) { return c.s.games >= 20; } },
      { id: "all_done", name: "达成全部成就", desc: "解锁其余全部成就（隐藏成就）",
        hidden: true, test: function () { return false; } }
    ]
  }[SCOPE];

  /* ═══════════════ 存档 ═══════════════
     { v: 1, got: { 成就id: 解锁时间戳 }, stat: { 累计统计 } } */
  var STAT0 = {
    ms:    { runs: 0, wins: 0, streak: 0, opens: 0,
             w_easy: 0, w_mid: 0, w_hard: 0, bsec_easy: 0, bsec_mid: 0, bsec_hard: 0 },
    ttt:   { games: 0, wins: 0, losses: 0, draws: 0, streak: 0,
             w_easy: 0, w_mid: 0, w_hard: 0, l_easy: 0, l_mid: 0, l_hard: 0 },
    snake: { games: 0, apples: 0, best: 0, bestLen: 0, b_easy: 0, b_mid: 0, b_hard: 0 }
  }[SCOPE];

  var data = load();

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function load() {
    var out = { v: 1, got: {}, stat: {} };
    var raw = null;
    try { raw = JSON.parse(lsGet(KEY) || "null"); } catch (e) { raw = null; }
    if (raw && typeof raw === "object") {
      if (raw.got && typeof raw.got === "object") {
        for (var k in raw.got) {
          if (!Object.prototype.hasOwnProperty.call(raw.got, k)) continue;
          if (!isKnown(k)) continue;
          var ts = Number(raw.got[k]);
          if (ts > 0) out.got[k] = ts;
        }
      }
      if (raw.stat && typeof raw.stat === "object") {
        for (var f in STAT0) {
          var v = Number(raw.stat[f]);
          if (isFinite(v) && v >= 0) out.stat[f] = Math.floor(v);
        }
      }
    }
    for (var f2 in STAT0) if (out.stat[f2] === undefined) out.stat[f2] = STAT0[f2];
    return out;
  }
  function save() { lsSet(KEY, JSON.stringify(data)); }

  function isKnown(id) {
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) return true;
    return false;
  }
  function def(id) {
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) return DEFS[i];
    return null;
  }
  function unlockedCount() {
    var n = 0;
    for (var i = 0; i < DEFS.length; i++) if (data.got[DEFS[i].id]) n++;
    return n;
  }

  /* ═══════════════ 事件 → 统计 ═══════════════ */
  function applyEvent(ev) {
    ev = ev || {};
    var s = data.stat, mode = ev.mode;
    if (SCOPE === "ms") {
      if (ev.kind !== "win" && ev.kind !== "lose") return;
      s.runs += 1;
      s.opens += Math.max(0, ev.opens | 0);
      if (ev.kind === "win") {
        s.wins += 1;
        s.streak += 1;
        if (mode === "easy" || mode === "mid" || mode === "hard") {
          s["w_" + mode] += 1;
          var sec = Math.max(0, Math.round(Number(ev.seconds) || 0));
          var bk = "bsec_" + mode;
          if (sec > 0 && (s[bk] === 0 || sec < s[bk])) s[bk] = sec;
        }
      } else {
        s.streak = 0;
      }
    } else if (SCOPE === "ttt") {
      if (ev.kind === "win") {
        s.games += 1; s.wins += 1; s.streak += 1;
        if (mode === "easy" || mode === "mid" || mode === "hard") s["w_" + mode] += 1;
      } else if (ev.kind === "lose") {
        s.games += 1; s.losses += 1; s.streak = 0;
        if (mode === "easy" || mode === "mid" || mode === "hard") s["l_" + mode] += 1;
      } else if (ev.kind === "draw") {
        s.games += 1; s.draws += 1;
      }
    } else if (SCOPE === "snake") {
      if (ev.kind === "apple") {
        s.apples += 1;
        var sc = Math.max(0, Math.round(Number(ev.score) || 0));
        if (sc > s.best) s.best = sc;
        var len = Math.max(0, ev.len | 0);
        if (len > s.bestLen) s.bestLen = len;
      } else if (ev.kind === "over") {
        s.games += 1;
        var sc2 = Math.max(0, Math.round(Number(ev.score) || 0));
        if (sc2 > s.best) s.best = sc2;
        var len2 = Math.max(0, ev.len | 0);
        if (len2 > s.bestLen) s.bestLen = len2;
        if (ev.mode === "easy" || ev.mode === "mid" || ev.mode === "hard") {
          var bk2 = "b_" + ev.mode;
          if (sc2 > s[bk2]) s[bk2] = sc2;
        }
      }
    }
  }

  /* ═══════════════ 解锁 / 判定 ═══════════════ */
  function unlock(id, quiet) {
    if (data.got[id]) return false;
    data.got[id] = Date.now();
    save();
    var d = def(id);
    try { document.dispatchEvent(new CustomEvent("ach:change", { detail: snapshot() })); } catch (e) {}
    if (!quiet && d) toast("成就解锁「" + GAME_NAME + "」：" + d.name);
    return true;
  }

  function evaluate(c) {
    var out = [], i;
    for (i = 0; i < DEFS.length; i++) {
      var a = DEFS[i];
      if (data.got[a.id] || a.hidden) continue;
      var ok = false;
      try { ok = !!a.test(c); } catch (e) { ok = false; }
      if (ok) out.push(a.id);
    }
    for (i = 0; i < out.length; i++) unlock(out[i], true);
    /* 隐藏成就：其余全部解锁的那一刻自动达成 */
    if (!data.got.all_done && unlockedCount() >= DEFS.length - 1) {
      unlock("all_done", true);
      out.push("all_done");
    }
    if (out.length === 1) {
      var d = def(out[0]);
      toast("成就解锁「" + GAME_NAME + "」：" + (d ? d.name : out[0]));
    } else if (out.length > 1) {
      toast("一次解锁 " + out.length + " 个「" + GAME_NAME + "」成就");
    }
    return out;
  }

  /* 游戏在关键节点调用：report(事件) → 累计统计 → 全量重判 */
  function report(ev) {
    applyEvent(ev);
    save();
    return evaluate({ s: data.stat, e: ev || {} });
  }

  /* ═══════════════ 轻量 toast（游戏页没有跑酷的 toast 组件） ═══════════════ */
  var toastEl = null, toastTimer = null;
  function toast(msg) {
    try {
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.className = "game-toast";
        toastEl.setAttribute("role", "status");
        toastEl.setAttribute("aria-live", "polite");
        (document.body || document.documentElement).appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
    } catch (e) {}
  }

  /* ═══════════════ 面板（复用 #run-ach 弹层） ═══════════════ */
  var panel = document.getElementById("run-ach");
  var elList = document.getElementById("ach-list");
  var elProg = document.getElementById("ach-progress");

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDay(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime()) || !ts) return "";
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  function render() {
    var n = unlockedCount();
    if (elProg) {
      var pct = Math.round(n / DEFS.length * 100);
      elProg.innerHTML =
        "<div class='ach-bar-outer'><i></i></div>" +
        "<p class='ach-bar-text'>" + GAME_NAME + "成就：已解锁 <b>" + n + "</b> / " + DEFS.length +
        " 个（" + pct + "%），保存在本机浏览器</p>";
      /* 宽度走 JS 属性赋值：CSP 是 style-src 'self'，innerHTML 里的 style 属性会被拦 */
      var bar = elProg.querySelector(".ach-bar-outer > i");
      if (bar) bar.style.width = pct + "%";
    }
    if (!elList) return;
    var rows = "";
    for (var j = 0; j < DEFS.length; j++) {
      var a = DEFS[j];
      if (a.hidden && !data.got[a.id]) {
        rows += "<li class='ach-row ach-hidden'>" +
          "<span class='ach-txt'><b>？？？</b><em>隐藏成就：解锁其余全部成就后揭晓</em></span>" +
          "<span class='ach-todo'>未解锁</span></li>";
        continue;
      }
      var ts = data.got[a.id];
      rows += "<li class='ach-row" + (ts ? " is-on" : "") + "'>" +
        "<span class='ach-txt'><b>" + esc(a.name) + "</b><em>" + esc(a.desc) + "</em></span>" +
        (ts ? "<span class='ach-got'>已解锁 · " + fmtDay(ts) + "</span>"
            : "<span class='ach-todo'>未解锁</span>") +
        "</li>";
    }
    elList.innerHTML = "<section class='ach-group'><ul class='ach-rows'>" + rows + "</ul></section>";
  }

  function isOpen() { return !!panel && !panel.classList.contains("hidden"); }
  function open() {
    if (!panel || isOpen()) return;
    panel.classList.remove("hidden");
    render();
    document.dispatchEvent(new CustomEvent("ach:open"));
  }
  function close() {
    if (!panel || !isOpen()) return;
    panel.classList.add("hidden");
    document.dispatchEvent(new CustomEvent("ach:close"));
  }

  if (panel) {
    /* 面板里的 ✕ / 遮罩 / Esc 由 me.js 统一管，这里只兜底 ✕（跑酷页没有 me.js） */
    var btnClose = document.getElementById("run-ach-close");
    if (btnClose) btnClose.addEventListener("click", close);
    panel.addEventListener("click", function (e) { if (e.target === panel) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) { e.preventDefault(); close(); }
    });
    render();
  }

  /* ═══════════════ 对外接口 ═══════════════ */
  function snapshot() {
    return {
      unlocked: unlockedCount(),
      total: DEFS.length,
      got: (function () { var o = {}; for (var k in data.got) if (data.got[k]) o[k] = data.got[k]; return o; })(),
      stat: (function () { var o = {}; for (var f in data.stat) o[f] = data.stat[f]; return o; })(),
      rows: DEFS.map(function (a) { return { id: a.id, name: a.name, got: !!data.got[a.id] }; })
    };
  }

  global.GameAch = {
    scope: SCOPE,
    TOTAL: DEFS.length,
    report: report,
    open: open,
    close: close,
    isOpen: isOpen,
    render: render,
    unlocked: function () {
      var out = [];
      for (var i = 0; i < DEFS.length; i++) if (data.got[DEFS[i].id]) out.push(DEFS[i].id);
      return out;
    },
    snapshot: snapshot,
    /* 测试用：直接塞一份假存档 */
    __setData: function (obj) {
      if (!obj) return;
      data = obj;
      if (!data.got) data.got = {};
      if (!data.stat) data.stat = {};
      for (var f in STAT0) if (data.stat[f] === undefined) data.stat[f] = STAT0[f];
      save();
      render();
    },
    __stat: function () { return data.stat; }
  };
})(window);
