/* ══════════════════════════════════════════════════════════════
   扫雷 · 云端排行榜（用时越短越靠前）
   ──────────────────────────────────────────────────────────────
   · 只收「通关」成绩：初级 / 中级 / 高级 各一份榜，按用时升序
   · 数据表 ms_scores（云库）：公开读、本人可写；服务端触发器校验
     用时下限与提交频率，作弊数据在库里就被挡掉
   · 未登录走访客模式：昵称固定「访客 N」，本机 device_id 作为凭证
   · 纯外链脚本、无内联代码（CSP 同源白名单）
   对外暴露 window.MsRank
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var TABLE = "ms_scores";
  var PAGE = 10;                     // 每页 10 名
  var LIMIT = 100;                   // 取前 100 条记录（去重后 ≤100 人）
  var GUEST_RE = /^访客 [0-9]{1,3}$/;
  var MODES = [
    { id: "easy", label: "初级 9×9" },
    { id: "mid",  label: "中级 16×16" },
    { id: "hard", label: "高级 30×16" }
  ];

  var panel = document.getElementById("ms-rank");
  var btnOpen = document.getElementById("ms-rank-open");
  var btnClose = document.getElementById("ms-rank-close");
  var statusEl = document.getElementById("ms-rank-status");
  var listEl = document.getElementById("ms-rank-list");
  var pagerEl = document.getElementById("ms-rank-pager");
  var mineEl = document.getElementById("ms-rank-mine");
  var tabsEl = document.getElementById("ms-rank-tabs");

  if (!panel || !listEl) return;      // 页面没这块 DOM 就整体不启用

  var cur = { mode: "easy", page: 1, rows: [], loading: false, err: null };

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
  function fmtSec(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    if (n < 60) return n + " 秒";
    var m = Math.floor(n / 60), s = n % 60;
    return m + " 分 " + (s < 10 ? "0" : "") + s + " 秒";
  }
  function modeLabel(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i].label;
    return id;
  }

  /* ── 我的身份与昵称（与跑酷榜同一套规则） ── */
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
      .select("nickname, seconds, region, created_at")
      .eq("mode", mode)
      .order("seconds", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(LIMIT);
  }

  /* 同一昵称多次通关：只留最快的一条（榜上按人排名，不按记录） */
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

  function load(mode, page) {
    if (!ready()) { cur.err = "unavailable"; render(); return; }
    cur.loading = true; cur.err = null; cur.mode = mode || cur.mode; cur.page = page || 1;
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
    d.from(TABLE).select("seconds, created_at")
      .eq("mode", cur.mode).eq("nickname", who.name)
      .order("seconds", { ascending: true }).limit(1)
      .then(function (r) {
        var row = r && r.data && r.data[0];
        if (!row) { mineEl.innerHTML = ""; return; }
        mineEl.innerHTML = "<span class='ms-rank-mine-t'>我的最好成绩：<b>" +
          fmtSec(row.seconds) + "</b></span><span class='ms-rank-mine-d'>" + esc(fmtDay(row.created_at)) + "</span>";
      });
  }

  /* ═══════════ 渲染 ═══════════ */
  function render() {
    if (statusEl) {
      if (cur.err === "unavailable") statusEl.textContent = "离线或云服务不可用，暂时看不到排行榜（离线也能照常玩）。";
      else if (cur.err === "error") statusEl.textContent = "排行榜加载失败，稍后重试。";
      else statusEl.textContent = cur.loading ? "加载中…" : "";
      statusEl.className = "ms-rank-status" + (cur.err ? " is-err" : "");
    }

    var i, rows = cur.rows || [], start = (cur.page - 1) * PAGE, slice = rows.slice(start, start + PAGE);
    if (!rows.length && !cur.loading && !cur.err) {
      listEl.innerHTML = "<li class='ms-rank-empty'>还没有人通关这个难度，去拿下第一名吧。</li>";
    } else {
      var html = "";
      for (i = 0; i < slice.length; i++) {
        var r = slice[i], no = start + i + 1;
        html += "<li class='ms-rank-row'>" +
          "<b class='ms-rank-no" + (no <= 3 ? " is-top" : "") + "'>" + no + "</b>" +
          "<span class='ms-rank-name' title='" + esc(r.nickname) + "'>" + esc(r.nickname) +
            (r.region ? "<small class='ms-rank-rg'>IP " + esc(r.region) + "</small>" : "") + "</span>" +
          "<span class='ms-rank-sec'>" + fmtSec(r.seconds) + "</span>" +
          "<span class='ms-rank-day'>" + esc(fmtDay(r.created_at)) + "</span>" +
          "</li>";
      }
      listEl.innerHTML = html || "<li class='ms-rank-empty'>加载中…</li>";
    }

    if (pagerEl) {
      var pages = Math.max(1, Math.ceil(rows.length / PAGE));
      if (pages <= 1) { pagerEl.innerHTML = ""; }
      else {
        var p = "";
        for (i = 1; i <= pages; i++) {
          p += "<button type='button' class='ms-rank-pg" + (i === cur.page ? " is-on" : "") +
            "' data-page='" + i + "'" + (i === cur.page ? " aria-current='page'" : "") + ">" + i + "</button>";
        }
        pagerEl.innerHTML = p;
      }
    }
    paintTabs();
  }

  function paintTabs() {
    if (!tabsEl) return;
    var btns = tabsEl.querySelectorAll(".ms-rtab");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-mode") === cur.mode;
      btns[i].classList[on ? "add" : "remove"]("is-on");
      btns[i].setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  /* ═══════════ 提交成绩（仅通关时调用） ═══════════ */
  function submit(mode, seconds) {
    if (!ready()) return Promise.resolve({ data: null, error: { kind: "unavailable" } });
    var who = me(), sec = Math.round(Number(seconds) || 0);
    if (!who.name || sec <= 0) return Promise.resolve({ data: null, error: { kind: "invalid-request" } });
    if (who.guest && !GUEST_RE.test(who.name)) {
      return Promise.resolve({ data: null, error: { kind: "invalid-request" } });
    }
    var c = cloud(), d = c.database();
    var row = { mode: mode, nickname: who.name, seconds: sec };
    if (who.guest) row.device_id = c.scores.deviceId();
    var rg = c.scores.region ? c.scores.region() : null;
    if (rg) row.region = rg;

    /* 先看自己的最好成绩：不比它快就不写库（少一堆没意义的行） */
    return d.from(TABLE).select("seconds")
      .eq("mode", mode).eq("nickname", who.name)
      .order("seconds", { ascending: true }).limit(1)
      .then(function (r) {
        var best = r && r.data && r.data[0];
        if (best && Number(best.seconds) <= sec) return { data: null, error: null, skipped: true };
        if (!who.guest && c.setNick) c.setNick(who.name);     // 登录昵称顺手落本地
        return d.from(TABLE).insert(row).select("mode, nickname, seconds, created_at");
      })
      .then(function (r) {
        if (r && r.skipped) return r;
        if (!r || r.error) return r || { data: null, error: { kind: "error" } };
        /* 提交成功：如果面板开着且正是这个难度，刷新一下 */
        if (isOpen() && cur.mode === mode) load(mode, 1);
        return r;
      });
  }

  /* ═══════════ 面板开关 ═══════════ */
  function isOpen() { return panel && !panel.classList.contains("hidden"); }
  function open(mode) {
    if (!panel) return;
    panel.classList.remove("hidden");
    load(mode || cur.mode, 1);
    if (btnClose) btnClose.focus();
  }
  function close() { if (panel) panel.classList.add("hidden"); }

  if (btnOpen) btnOpen.addEventListener("click", function () { open(cur.mode); });
  if (btnClose) btnClose.addEventListener("click", close);
  panel.addEventListener("click", function (e) { if (e.target === panel) close(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) { e.preventDefault(); close(); }
  });
  if (tabsEl) {
    tabsEl.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".ms-rtab") : null;
      if (!b) return;
      load(b.getAttribute("data-mode"), 1);
    });
  }
  if (pagerEl) {
    pagerEl.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".ms-rank-pg") : null;
      if (!b) return;
      cur.page = Number(b.getAttribute("data-page")) || 1;
      render();
      listEl.scrollTop = 0;
    });
  }

  global.MsRank = {
    MODES: MODES,
    submit: submit,
    open: open,
    close: close,
    reload: function () { load(cur.mode, cur.page); },
    mode: function () { return cur.mode; },
    modeLabel: modeLabel,
    _state: cur                                                    /* 测试用只读快照 */
  };
})(window);
