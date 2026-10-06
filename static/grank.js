/* ══════════════════════════════════════════════════════════════
   通用游戏排行榜（井字棋 / 贪吃蛇共用，读 game_scores 表）
   ──────────────────────────────────────────────────────────────
   · 数据表 game_scores（云库）：公开读安全列、访客/本人可写；
     服务端触发器校验 game / mode / score 范围与提交频率
   · 排名规则：score 降序（最佳分数），同名只留最高的一条
   · 页面在 #grank-root 上用 data-* 声明配置：
       data-game="ttt"            表里的 game 列
       data-title="井字棋排行榜"   面板标题
       data-unit="分"             分数单位（展示用）
       data-modes='easy:简单,mid:中等,hard:困难'
   · 对外暴露 window.GameRank（submit / open / close / reload）
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var TABLE = "game_scores";
  var LIMIT = 100;
  var GUEST_RE = /^访客 [0-9]{1,3}$/;

  var rootEl = document.getElementById("grank-root");
  if (!rootEl) return;                       // 页面没这块 DOM 就整体不启用

  var GAME = rootEl.getAttribute("data-game") || "ttt";
  var UNIT = rootEl.getAttribute("data-unit") || "分";
  var MODES = [];
  (function () {
    var raw = rootEl.getAttribute("data-modes") || "easy:简单,mid:中等,hard:困难";
    var parts = raw.split(",");
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split(":");
      if (kv[0]) MODES.push({ id: kv[0].trim(), label: (kv[1] || kv[0]).trim() });
    }
  })();

  var panel = document.getElementById("grank-panel");
  var btnClose = document.getElementById("grank-close");
  var statusEl = document.getElementById("grank-status");
  var listEl = document.getElementById("grank-list");
  var mineEl = document.getElementById("grank-mine");
  var tabsEl = document.getElementById("grank-tabs");
  var titleEl = document.getElementById("grank-title");

  if (!panel || !listEl) return;

  /* 开榜按钮（页面里可能有多个入口，统一 data-grank-open 委托） */
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-grank-open]") : null;
    if (b) { e.preventDefault(); open(b.getAttribute("data-grank-mode") || cur.mode); }
  });

  var cur = { mode: MODES.length ? MODES[0].id : "easy", rows: [], loading: false, err: null, errMsg: null };

  function cloud() { return global.WowCloud || null; }
  function ready() { var c = cloud(); return !!(c && c.available && c.available() && c.database && c.database()); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDay(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function modeLabel(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i].label;
    return id;
  }

  if (titleEl) titleEl.textContent = rootEl.getAttribute("data-title") || "排行榜";

  /* ── 我的身份与昵称（与跑酷榜 / 扫雷榜同一套规则） ── */
  function me() {
    var c = cloud();
    if (!c) return { guest: true, name: "访客" };
    if (c.user && c.user()) return { guest: false, name: c.nickOrDefault() };
    var g = (c.scores && c.scores.guestName) ? c.scores.guestName() : "";
    return { guest: true, name: GUEST_RE.test(g) ? g : "" };
  }

  /* ═══════════ 读取榜单 ═══════════ */
  function top(mode) {
    var d = cloud().database();
    return d.from(TABLE)
      .select("nickname, score, region, created_at")
      .eq("game", GAME)
      .eq("mode", mode)
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(LIMIT);
  }

  /* 同一昵称多条成绩：只留最高的一条（榜上按人排名） */
  function dedupe(rows) {
    var seen = {}, out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], key = String(r.nickname || "");
      if (seen[key]) continue;
      seen[key] = true;
      out.push(r);
    }
    return out;
  }

  function load(mode) {
    if (!ready()) {
      cur.err = "unavailable";
      var ie = null;
      try { ie = (cloud() && cloud().initError) ? cloud().initError() : null; } catch (e) { ie = null; }
      cur.errMsg = ie
        ? "云服务组件未加载，暂时看不到排行榜（刷新页面试试；单机玩法不受影响）。"
        : "离线或云服务不可用，暂时看不到排行榜（离线也能照常玩）。";
      render(); return;
    }
    cur.errMsg = null;
    cur.loading = true; cur.err = null; cur.mode = mode || cur.mode;
    render();
    top(cur.mode).then(function (r) {
      cur.loading = false;
      if (r && r.error) { cur.err = "error"; cur.rows = []; }
      else { cur.rows = dedupe((r && r.data) || []); }
      render();
      loadMine();
    });
  }

  /* 我在这个难度的最好成绩（未登录时按访客昵称算） */
  function loadMine() {
    if (!mineEl) return;
    var who = me();
    if (!who.name || !ready()) { mineEl.innerHTML = ""; return; }
    var d = cloud().database();
    d.from(TABLE).select("score, created_at")
      .eq("game", GAME).eq("mode", cur.mode).eq("nickname", who.name)
      .order("score", { ascending: false }).limit(1)
      .then(function (r) {
        var row = r && r.data && r.data[0];
        if (!row) { mineEl.innerHTML = ""; return; }
        mineEl.innerHTML = "<span class='grank-mine-t'>我的最好成绩：<b>" +
          (Number(row.score) || 0) + " " + UNIT + "</b></span><span class='grank-mine-d'>" + esc(fmtDay(row.created_at)) + "</span>";
      });
  }

  /* ═══════════ 渲染（全量渲染，容器自身滚动） ═══════════ */
  function render() {
    if (statusEl) {
      if (cur.err === "unavailable") statusEl.textContent = cur.errMsg || "离线或云服务不可用，暂时看不到排行榜（离线也能照常玩）。";
      else if (cur.err === "error") statusEl.textContent = "排行榜加载失败，稍后重试。";
      else statusEl.textContent = cur.loading ? "加载中…" : "";
      statusEl.className = "grank-status" + (cur.err ? " is-err" : "");
    }

    var i, rows = cur.rows || [];
    if (!rows.length && !cur.loading && !cur.err) {
      listEl.innerHTML = "<li class='grank-empty'>这个难度还没有人上榜，去拿下第一名吧。</li>";
    } else {
      var html = "";
      for (i = 0; i < rows.length; i++) {
        var r = rows[i], no = i + 1;
        html += "<li class='grank-row'>" +
          "<b class='grank-no" + (no <= 3 ? " is-top" : "") + "'>" + no + "</b>" +
          "<span class='grank-name' title='" + esc(r.nickname) + "'>" + esc(r.nickname) +
            (r.region ? "<small class='grank-rg'>IP " + esc(r.region) + "</small>" : "") + "</span>" +
          "<span class='grank-score'>" + (Number(r.score) || 0) + " " + UNIT + "</span>" +
          "<span class='grank-day'>" + esc(fmtDay(r.created_at)) + "</span>" +
          "</li>";
      }
      listEl.innerHTML = html || "<li class='grank-empty'>加载中…</li>";
    }
    paintTabs();
  }

  function paintTabs() {
    if (!tabsEl) return;
    var btns = tabsEl.querySelectorAll(".grank-tab");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-mode") === cur.mode;
      btns[i].classList[on ? "add" : "remove"]("is-on");
      btns[i].setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  /* ═══════════ 提交成绩（得分时调用） ═══════════
     只提交比本人榜上更高的分数：分数没超过就不写库（井字棋同难度每次赢的分一样，
     等于每个难度只记头一次赢；贪吃蛇是真正意义上的刷新纪录）。 */
  function submit(mode, score) {
    if (!ready()) return Promise.resolve({ data: null, error: { kind: "unavailable" } });
    var who = me(), sc = Math.round(Number(score) || 0);
    if (!who.name || sc <= 0) return Promise.resolve({ data: null, error: { kind: "invalid-request" } });
    if (who.guest && !GUEST_RE.test(who.name)) {
      return Promise.resolve({ data: null, error: { kind: "invalid-request" } });
    }
    var valid = false;
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === mode) valid = true;
    if (!valid) return Promise.resolve({ data: null, error: { kind: "invalid-request" } });

    var c = cloud(), d = c.database();
    var row = { game: GAME, mode: mode, nickname: who.name, score: sc };
    if (who.guest) row.device_id = c.scores.deviceId();
    var rg = c.scores.region ? c.scores.region() : null;
    if (rg) row.region = rg;

    return d.from(TABLE).select("score")
      .eq("game", GAME).eq("mode", mode).eq("nickname", who.name)
      .order("score", { ascending: false }).limit(1)
      .then(function (r) {
        var best = r && r.data && r.data[0];
        if (best && Number(best.score) >= sc) return { data: null, error: null, skipped: true };
        if (!who.guest && c.setNick) c.setNick(who.name);
        return d.from(TABLE).insert(row).select("game, mode, nickname, score, created_at");
      })
      .then(function (r) {
        if (r && r.skipped) return r;
        if (!r || r.error) return r || { data: null, error: { kind: "error" } };
        if (isOpen() && cur.mode === mode) load(mode);
        return r;
      });
  }

  /* ═══════════ 面板开关 ═══════════ */
  function isOpen() { return panel && !panel.classList.contains("hidden"); }
  function open(mode) {
    if (!panel) return;
    panel.classList.remove("hidden");
    load(mode || cur.mode);
    if (btnClose) btnClose.focus();
  }
  function close() { if (panel) panel.classList.add("hidden"); }

  if (btnClose) btnClose.addEventListener("click", close);
  panel.addEventListener("click", function (e) { if (e.target === panel) close(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) { e.preventDefault(); close(); }
  });
  if (tabsEl) {
    tabsEl.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".grank-tab") : null;
      if (!b) return;
      load(b.getAttribute("data-mode"));
    });
  }

  global.GameRank = {
    MODES: MODES,
    game: GAME,
    submit: submit,
    open: open,
    close: close,
    isOpen: isOpen,
    reload: function () { load(cur.mode); },
    mode: function () { return cur.mode; },
    modeLabel: modeLabel,
    _state: cur                                                    /* 测试用只读快照 */
  };
})(window);
