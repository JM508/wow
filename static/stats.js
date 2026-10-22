/* ═══════════════ 统计看板（/stats/） ═══════════════
   纯本机：只读各游戏已有的 localStorage 存档，不写任何键、不发任何请求。
   数据源（与写入方保持同键名）：
     runner-ach  跑酷成就存档  { got, stat: { runs, totalDist, totalCoins, bestScore, bestMeters, bestCoins } }
     ms-ach      扫雷成就存档  { got, stat: { runs, wins, w_easy, w_mid, w_hard, bsec_easy, bsec_mid, bsec_hard } }
     ttt-ach     井字棋成就存档 { got, stat: { games, wins, losses, draws, streak, w_easy, w_mid, w_hard } }
     snake-ach   贪吃蛇成就存档 { got, stat: { games, apples, best, bestLen, b_easy, b_mid, b_hard } }
     runner-best / runner-scores  跑酷本机最高分与最近记录（[{ s, t }]，最多 5 条）
   成就总数写成常量：成就定义在各自游戏脚本里，这里不去解析它们，
   改成就清单时同步改这里（有 _feat_test 断言兜底）。 */
(function () {
  "use strict";

  var ACH_TOTAL = { runner: 19, ms: 15, ttt: 13, snake: 14 };

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function readJSON(k) {
    try {
      var v = JSON.parse(lsGet(k) || "null");
      return v && typeof v === "object" ? v : null;
    } catch (e) { return null; }
  }
  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function pct(a, b) {
    b = num(b);
    if (!b) return "—";
    return Math.round((num(a) / b) * 100) + "%";
  }
  function fmtInt(n) {
    n = num(n);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  /* 秒 → 「1 分 23 秒」；0 或缺失返回 — */
  function fmtSec(s) {
    s = num(s);
    if (!s) return "—";
    if (s < 60) return s + " 秒";
    return Math.floor(s / 60) + " 分 " + (s % 60) + " 秒";
  }
  /* 跑酷最近一局的时间（runner-scores 里 t 最大的一条） */
  function lastRunText() {
    var arr = readJSON("runner-scores");
    if (!arr || !arr.length) return null;
    var latest = 0;
    for (var i = 0; i < arr.length; i++) {
      var t = num(arr[i] && arr[i].t);
      if (t > latest) latest = t;
    }
    if (!latest) return null;
    try {
      var d = new Date(latest);
      return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
    } catch (e) { return null; }
  }
  function row(label, value) {
    return "<div class='stats-row'><span class='stats-k'>" + label +
      "</span><span class='stats-v'>" + value + "</span></div>";
  }
  /* CSP style-src 'self'：动态样式一律 el.style 赋值，不用内联 style 属性 */
  function paintBar(el, ratio) {
    if (!el) return;
    var r = Math.max(0, Math.min(100, Math.round(num(ratio) * 100)));
    el.style.width = r + "%";
  }

  function readAch(key) {
    var d = readJSON(key) || {};
    var stat = (d.stat && typeof d.stat === "object") ? d.stat : {};
    var got = 0;
    if (d.got && typeof d.got === "object") {
      for (var k in d.got) if (d.got[k]) got++;
    }
    return { stat: stat, got: got };
  }

  /* ─────────── 各卡渲染 ─────────── */
  function fillCard(name, html, achRatio) {
    var card = document.querySelector("[data-stat-card='" + name + "']");
    if (!card) return;
    var rows = card.querySelector("[data-stat-rows]");
    if (!rows) return;
    rows.innerHTML = html;
    /* CSP：进度条宽度用 CSSOM 赋值 */
    var bar = rows.querySelector("[data-bar-fill]");
    if (bar) paintBar(bar, achRatio);
  }

  function render() {
    /* ── 火柴人快跑 ── */
    var r = readAch("runner-ach");
    var rBest = num(lsGet("runner-best"));
    var lastRun = lastRunText();
    var rHtml =
      row("总局数", fmtInt(r.stat.runs) + " 局" + (lastRun ? "（最近一局 " + lastRun + "）" : "")) +
      row("总里程", fmtInt(r.stat.totalDist) + " 米") +
      row("总金币", fmtInt(r.stat.totalCoins) + " 枚") +
      row("最高分", rBest ? fmtInt(rBest) + " 分" : "—") +
      row("最远一局", r.stat.bestMeters ? fmtInt(r.stat.bestMeters) + " 米" : "—");
    fillCard("runner", rHtml, r.got / ACH_TOTAL.runner);

    /* ── 扫雷 ── */
    var m = readAch("ms-ach");
    var mHtml =
      row("开局数", fmtInt(m.stat.runs) + " 局") +
      row("通关数", fmtInt(m.stat.wins) + " 局（通关率 " + pct(m.stat.wins, m.stat.runs) + "）") +
      row("初级最快", fmtSec(m.stat.bsec_easy)) +
      row("中级最快", fmtSec(m.stat.bsec_mid)) +
      row("高级最快", fmtSec(m.stat.bsec_hard));
    fillCard("ms", mHtml, m.got / ACH_TOTAL.ms);

    /* ── 井字棋 ── */
    var t = readAch("ttt-ach");
    var tHtml =
      row("总局数", fmtInt(t.stat.games) + " 局") +
      row("胜 / 平 / 负", fmtInt(t.stat.wins) + " / " + fmtInt(t.stat.draws) + " / " + fmtInt(t.stat.losses)) +
      row("胜率", pct(t.stat.wins, t.stat.games)) +
      row("当前连胜", fmtInt(t.stat.streak) + " 局") +
      row("初级胜场", fmtInt(t.stat.w_easy) + " 场") +
      row("中级胜场", fmtInt(t.stat.w_mid) + " 场") +
      row("高级胜场", fmtInt(t.stat.w_hard) + " 场");
    fillCard("ttt", tHtml, t.got / ACH_TOTAL.ttt);

    /* ── 贪吃蛇 ── */
    var s = readAch("snake-ach");
    var sHtml =
      row("总局数", fmtInt(s.stat.games) + " 局") +
      row("累计吃果", fmtInt(s.stat.apples) + " 个") +
      row("最高分", s.stat.best ? fmtInt(s.stat.best) + " 分" : "—") +
      row("最长蛇身", s.stat.bestLen ? fmtInt(s.stat.bestLen) + " 节" : "—") +
      row("简单最佳", s.stat.b_easy ? fmtInt(s.stat.b_easy) + " 分" : "—") +
      row("中等最佳", s.stat.b_mid ? fmtInt(s.stat.b_mid) + " 分" : "—") +
      row("困难最佳", s.stat.b_hard ? fmtInt(s.stat.b_hard) + " 分" : "—");
    fillCard("snake", sHtml, s.got / ACH_TOTAL.snake);

    /* ── 成就完成度（每行一根进度条，各自算比例） ── */
    var names = { runner: "火柴人快跑", ms: "扫雷", ttt: "井字棋", snake: "贪吃蛇" };
    var aHtml = "";
    ["runner", "ms", "ttt", "snake"].forEach(function (k) {
      var a = readAch(k + "-ach");
      var total = ACH_TOTAL[k];
      aHtml += "<div class='stats-row stats-ach-row'>" +
        "<span class='stats-k'>" + names[k] + "</span>" +
        "<span class='stats-v'>" + a.got + " / " + total + "</span>" +
        "<span class='stats-bar' role='presentation'><span class='stats-bar-fill' data-bar-fill='" +
        (total ? a.got / total : 0) + "'></span></span>" +
        "</div>";
    });
    fillCard("ach", aHtml);
    var bars = document.querySelectorAll("[data-stat-card='ach'] [data-bar-fill]");
    for (var b = 0; b < bars.length; b++) {
      paintBar(bars[b], parseFloat(bars[b].getAttribute("data-bar-fill")));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
