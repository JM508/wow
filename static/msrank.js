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
  var LIMIT = 100;                   // 取前 100 条记录（去重后 ≤100 人）
  var GUEST_RE = /^访客 [0-9]{1,3}$/;
  var MODES = [
    { id: "easy", label: "初级 9×9" },
    { id: "mid",  label: "中级 16×16" },
    { id: "hard", label: "高级 30×16" },
    { id: "daily", label: "每日挑战" }
  ];

  var panel = document.getElementById("ms-rank");
  var btnOpen = document.getElementById("ms-rank-open");
  var btnClose = document.getElementById("ms-rank-close");
  var statusEl = document.getElementById("ms-rank-status");
  var listEl = document.getElementById("ms-rank-list");
  var mineEl = document.getElementById("ms-rank-mine");
  var tabsEl = document.getElementById("ms-rank-tabs");

  if (!panel || !listEl) return;      // 页面没这块 DOM 就整体不启用

  /* 滑动式榜单：一次取 100 条、一次性渲染全部，容器自身滚动（2026-10-06 去分页） */
  var cur = { mode: "easy", rows: [], loading: false, err: null };

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
  /* 榜上头像：有自定义头像就是那张图（已裁圆），没有就按昵称哈希底色 + 首字。
     底色不能写成内联 style 属性再塞进 innerHTML（CSP style-src 'self' 会拦），
     所以先落空壳 + data-h，插完 DOM 再用 JS 属性赋值（CSSOM 不受 CSP 限制）。 */
  function avaHash(s) {
    var n = String(s || ""), h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
    return h;
  }
  function avatarHtml(r) {
    var av = (r && r.avatar) ? String(r.avatar) : "";
    if (av && av.length <= 20000 && av.indexOf("data:image/") === 0) {
      return "<img class='ms-rank-ava' src='" + esc(av) + "' alt='' loading='lazy' decoding='async'>";
    }
    var name = String((r && r.nickname) || "");
    var ch = name ? name.slice(0, 1) : "?";
    return "<span class='ms-rank-ava ms-rank-ava-ph' data-ava-h='" + avaHash(name) + "' aria-hidden='true'>" +
      esc(ch) + "</span>";
  }
  function paintAvas(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var nodes = scope.querySelectorAll(".ms-rank-ava-ph[data-ava-h]");
    for (var i = 0; i < nodes.length; i++) {
      var h = parseInt(nodes[i].getAttribute("data-ava-h"), 10) || 0;
      nodes[i].style.background = "hsl(" + h + ",52%,46%)";
    }
  }

  /* ── 我的身份与昵称（与跑酷榜同一套规则） ── */
  function me() {
    var c = cloud();
    if (!c) return { guest: true, name: "访客" };
    if (c.user && c.user()) return { guest: false, name: c.nickOrDefault() };
    var g = (c.scores && c.scores.guestName) ? c.scores.guestName() : "";
    return { guest: true, name: GUEST_RE.test(g) ? g : "" };
  }

  /* ═══════════ 读取榜单 ═══════════
     每日挑战（mode="daily"）只看今天：过了零点就是新的一局新的一份榜。 */
  function dayStartISO() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }

  function top(mode) {
    var d = cloud().database();
    var q = d.from(TABLE)
      .select("nickname, seconds, region, avatar, created_at")
      .eq("mode", mode)
      .order("seconds", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(LIMIT);
    if (mode === "daily") q = q.gte("created_at", dayStartISO());
    return q;
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

  function load(mode) {
    if (!ready()) {
      cur.err = "unavailable";
      /* 两种「不可用」要分开说：真断网 vs 云 SDK 没就绪（引入漏了 / 加载失败）。
         都报「离线」会把用户支去查网络 —— 2026-10-05 扫雷页漏引 SDK 就是这么被误报的。 */
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

  /* 我在这个难度的最好成绩 + 附近名次（前后各 5 名，未登录时按访客昵称算） */
  function loadMine() {
    if (!mineEl) return;
    var who = me();
    if (!who.name || !ready()) { mineEl.innerHTML = ""; return; }
    var d = cloud().database();
    var q = d.from(TABLE).select("seconds, created_at")
      .eq("mode", cur.mode).eq("nickname", who.name)
      .order("seconds", { ascending: true }).limit(1);
    if (cur.mode === "daily") q = q.gte("created_at", dayStartISO());
    q.then(function (r) {
        var row = r && r.data && r.data[0];
        if (!row) { mineEl.innerHTML = ""; return; }
        var best = Math.max(0, Math.round(Number(row.seconds) || 0));
        mineEl.innerHTML = "<span class='ms-rank-mine-t'>我的最好成绩：<b>" +
          fmtSec(best) + "</b></span><span class='ms-rank-mine-d'>" + esc(fmtDay(row.created_at)) + "</span>";
        loadNear(who.name, best);
      });
  }

  /* ── 附近名次：用时榜是升序（越快越前），严格比我快的 5 条 + 比我慢的 5 条 ── */
  var NEAR = 5;
  function nearQuery(cmp, best) {
    var d = cloud().database();
    var q = d.from(TABLE)
      .select("nickname, seconds, region, avatar, created_at")
      .eq("mode", cur.mode)
      .order("seconds", { ascending: true }).limit(NEAR + 1);
    q = cmp === "above" ? q.lt("seconds", best) : q.gt("seconds", best);
    if (cur.mode === "daily") q = q.gte("created_at", dayStartISO());
    return q;
  }
  function loadNear(myName, best) {
    nearQuery("above", best).then(function (ra) {
      var above = dedupe((ra && ra.data) || []).slice(0, NEAR);
      var exact = above.length < NEAR;
      var rank = exact ? above.length + 1 : null;
      nearQuery("below", best).then(function (rb) {
        var seen = {}, i;
        for (i = 0; i < above.length; i++) seen[String(above[i].nickname || "")] = true;
        var belowAll = dedupe((rb && rb.data) || []);
        var below = [];
        for (i = 0; i < belowAll.length && below.length < NEAR; i++) {
          if (!seen[String(belowAll[i].nickname || "")]) below.push(belowAll[i]);
        }
        paintNear(myName, best, above, rank, below, exact);
      });
    });
  }
  function nearRow(r, no, isMe) {
    return "<li class='ms-rank-row" + (isMe ? " is-me" : "") + "'>" +
      "<b class='ms-rank-no'>" + (no || "·") + "</b>" +
      avatarHtml(r) +
      "<span class='ms-rank-name' title='" + esc(r.nickname) + "'>" + esc(r.nickname) + "</span>" +
      "<span class='ms-rank-sec'>" + fmtSec(r.seconds) + "</span>" +
      "</li>";
  }
  function paintNear(myName, best, above, rank, below, exact) {
    var html = "<div class='grank-near-t'>我的名次：" +
      (rank ? "<b>第 " + rank + " 名</b>" : "<b>5+ 名开外</b>") +
      (exact && rank === 1 ? "，榜首！" : (exact ? "" : "，继续冲")) + "</div><ul class='grank-near-list'>";
    var i, no;
    for (i = 0; i < above.length; i++) {
      no = rank ? rank - above.length + i : null;
      html += nearRow(above[i], no, false);
    }
    html += nearRow({ nickname: myName, seconds: best, avatar: "", region: "" }, rank, true);
    for (i = 0; i < below.length; i++) {
      html += nearRow(below[i], rank ? rank + 1 + i : null, false);
    }
    html += "</ul>";
    var el = document.getElementById("grank-near");
    if (el) { el.innerHTML = html; paintAvas(el); }
  }

  /* ═══════════ 渲染（全量渲染，容器自身滚动） ═══════════ */
  function render() {
    if (statusEl) {
      if (cur.err === "unavailable") statusEl.textContent = cur.errMsg || "离线或云服务不可用，暂时看不到排行榜（离线也能照常玩）。";
      else if (cur.err === "error") statusEl.textContent = "排行榜加载失败，稍后重试。";
      else statusEl.textContent = cur.loading ? "加载中…" : "";
      statusEl.className = "ms-rank-status" + (cur.err ? " is-err" : "");
    }

    var i, rows = cur.rows || [];
    if (!rows.length && !cur.loading && !cur.err) {
      listEl.innerHTML = "<li class='ms-rank-empty'>还没有人通关这个难度，去拿下第一名吧。</li>";
    } else {
      var html = "";
      for (i = 0; i < rows.length; i++) {
        var r = rows[i], no = i + 1;
        html += "<li class='ms-rank-row'>" +
          "<b class='ms-rank-no" + (no <= 3 ? " is-top" : "") + "'>" + no + "</b>" +
          avatarHtml(r) +
          "<span class='ms-rank-name' title='" + esc(r.nickname) + "'>" + esc(r.nickname) +
            (r.region ? "<small class='ms-rank-rg'>IP " + esc(r.region) + "</small>" : "") + "</span>" +
          "<span class='ms-rank-sec'>" + fmtSec(r.seconds) + "</span>" +
          "<span class='ms-rank-day'>" + esc(fmtDay(r.created_at)) + "</span>" +
          "</li>";
      }
      listEl.innerHTML = html || "<li class='ms-rank-empty'>加载中…</li>";
      paintAvas(listEl);
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

  /* ═══════════ 提交成绩（仅通关时调用） ═══════════
     云不可用 / 网络失败不再丢局：进离线队列（score-queue.js），联网后自动补榜。
     best 用负秒数归一成「越大越好」，与队列的去重口径对齐。 */
  function queueOffline(mode, sec) {
    var Q = global.ScoreQueue;
    if (Q) Q.enqueue({
      kind: "ms",
      dedupe: mode,
      best: -sec,
      data: { mode: mode, seconds: sec }
    });
  }

  function submit(mode, seconds) {
    if (!ready()) {
      var sec0 = Math.round(Number(seconds) || 0);
      if (sec0 > 0) queueOffline(mode, sec0);
      return Promise.resolve({ data: null, error: { kind: "unavailable" }, queued: true });
    }
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
    /* 头像快照：登录玩家带上个人中心里那张，榜上这一行才有脸（访客没有账号，也就没有头像） */
    if (!who.guest) {
      var av = (c.avatar && c.avatar.get) ? c.avatar.get() : "";
      if (av && av.length <= 16384 && av.indexOf("data:image/") === 0) row.avatar = av;
    }

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
        if (!r || r.error) {
          /* 网络类失败：进离线队列联网后补榜；参数类失败重试无意义，不进队列 */
          var k = (r && r.error && r.error.kind) || "error";
          if (k !== "invalid-request" && k !== "permission-denied" && k !== "not-found") {
            queueOffline(mode, sec);
            r = r || { data: null, error: { kind: "error" } };
            r.queued = true;
          }
          return r;
        }
        /* 提交成功：如果面板开着且正是这个难度，刷新一下 */
        if (isOpen() && cur.mode === mode) load(mode);
        return r;
      });
  }

  /* ═══════════ 面板开关 ═══════════ */
  function isOpen() { return panel && !panel.classList.contains("hidden"); }
  /* 开合时广播 panel:open / panel:close —— 扫雷据此把计时与局面暂停 */
  function notify(openNow) {
    try {
      document.dispatchEvent(new CustomEvent(openNow ? "panel:open" : "panel:close",
        { detail: { name: "ms-rank" } }));
    } catch (e) {}
  }
  function open(mode) {
    if (!panel) return;
    var was = isOpen();
    panel.classList.remove("hidden");
    load(mode || cur.mode);
    if (btnClose) btnClose.focus();
    if (!was) notify(true);
  }
  function close() {
    if (!panel || !isOpen()) return;
    panel.classList.add("hidden");
    notify(false);
  }

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
      load(b.getAttribute("data-mode"));
    });
  }

  /* 离线队列：注册重发函数 + 启动时先试一轮 */
  if (global.ScoreQueue) {
    global.ScoreQueue.register("ms", function (e) {
      var d = e && e.data;
      if (!d || !(Number(d.seconds) > 0)) return { data: null, error: { kind: "invalid-request" } };
      return submit(d.mode, d.seconds);
    });
    global.ScoreQueue.flush();
  }

  global.MsRank = {
    MODES: MODES,
    submit: submit,
    open: open,
    close: close,
    reload: function () { load(cur.mode); },
    mode: function () { return cur.mode; },
    modeLabel: modeLabel,
    _state: cur                                                    /* 测试用只读快照 */
  };
})(window);
