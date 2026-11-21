/* ══════════════════════════════════════════════════════════════
   敲木鱼排行榜（/woodfish/，2026-11-21）
   ──────────────────────────────────────────────────────────────
   与扫雷榜同一条 D1 链路（/api/scores/wf），差别只有排序：次数越多越靠前。
   样式全部复用扫雷榜的 .ms-rank 系列，因此本文件只负责取数与拼 DOM。

   · 打开榜单才拉数据（不在首屏多打一个请求）
   · 上报走节流：只有「比上次上报更大」才真发，切页 / 隐藏时补最后一次
   · 头像与昵称改了会收到 rank:nick-changed / rank:avatar-changed 事件，
     榜单开着就立刻重取，不用刷新页面
   · 镜像域没有 Functions：API 指回主站，写入一律跳过（只读）
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var panel = document.getElementById("wf-rank");
  var root = document.getElementById("wf-root");
  if (!panel || !root) return;

  var MAIN_ORIGIN = "https://wow-d9s.pages.dev";
  var MIRROR_HOST = "wow-blog.app.workbuddy.host";
  var onMirror = location.hostname === MIRROR_HOST;
  var API = (onMirror ? MAIN_ORIGIN : "") + "/api/scores/wf";
  var LIMIT = 100;
  var GUEST_RE = /^访客 [0-9]{1,3}$/;

  var listEl = document.getElementById("wf-rank-list");
  var statusEl = document.getElementById("wf-rank-status");
  var mineEl = document.getElementById("wf-rank-mine");
  var btnOpen = document.getElementById("wf-rank-open");
  var btnClose = document.getElementById("wf-rank-close");

  var cur = { rows: [], loading: false, err: null };
  var lastSent = 0;
  var inflight = false;

  function cloud() { return global.WowCloud || null; }
  function ready() {
    var c = cloud();
    return !!(c && c.available && c.available() && c.scores);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function provOf(v) {
    var s = String(v == null ? "" : v).trim();
    return s ? s.split(/\s+/)[0].slice(0, 32) : "";
  }
  function fmtDay(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function fmtNum(n) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
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

  /* 我的身份：登录用账号昵称，未登录用「访客 N」 */
  function me() {
    var c = cloud();
    if (!c) return { guest: true, name: "" };
    if (c.user && c.user()) return { guest: false, name: c.nickOrDefault ? c.nickOrDefault() : "玩家" };
    var g = (c.scores && c.scores.guestName) ? c.scores.guestName() : "";
    return { guest: true, name: GUEST_RE.test(g) ? g : "" };
  }

  function apiJson(query) {
    var qs = [];
    for (var k in query) if (query[k] !== null && query[k] !== undefined) {
      qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(query[k]));
    }
    return fetch(API + (qs.length ? "?" + qs.join("&") : ""), {
      credentials: "omit", cache: "no-store", headers: { accept: "application/json" }
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function render() {
    if (statusEl) {
      if (cur.err) statusEl.textContent = cur.err === "unavailable"
        ? "云服务暂时不可用，稍后再看（敲木鱼照常玩）。"
        : "排行榜加载失败，稍后重试。";
      else statusEl.textContent = cur.loading ? "加载中…" : (onMirror ? "镜像站只读，次数请回主站上报。" : "");
      statusEl.className = "ms-rank-status" + (cur.err ? " is-err" : "");
    }
    if (!listEl) return;

    var rows = cur.rows || [];
    if (!rows.length && !cur.loading && !cur.err) {
      listEl.innerHTML = "<li class='ms-rank-empty'>榜上还没有人，敲几下就是第一名。</li>";
      return;
    }
    var myName = me().name, html = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], no = i + 1, rg = provOf(r.region);
      var isMe = myName && r.nickname === myName;
      html += "<li class='ms-rank-row" + (isMe ? " is-me" : "") + "'>" +
        "<b class='ms-rank-no" + (no <= 3 ? " is-top" : "") + "'>" + no + "</b>" +
        avatarHtml(r) +
        "<span class='ms-rank-name' title='" + esc(r.nickname) + "'>" + esc(r.nickname) +
          (rg ? "<small class='ms-rank-rg'>IP " + esc(rg) + "</small>" : "") + "</span>" +
        "<span class='ms-rank-sec'>" + fmtNum(r.clicks) + " 次</span>" +
        "<span class='ms-rank-day'>" + esc(fmtDay(r.updated_at)) + "</span>" +
        "</li>";
    }
    listEl.innerHTML = html;
    paintAvas(listEl);
  }

  function paintMine() {
    if (!mineEl) return;
    var who = me();
    var my = null;
    for (var i = 0; i < cur.rows.length; i++) {
      if (cur.rows[i].nickname === who.name) { my = cur.rows[i]; break; }
    }
    var total = (global.WowWoodfish && global.WowWoodfish.count) ? global.WowWoodfish.count() : 0;
    if (my) {
      mineEl.innerHTML = "<span class='ms-rank-mine-t'>我：</span>" +
        "<b>" + esc(who.name) + "</b>" +
        "<span class='ms-rank-mine-n'>" + fmtNum(my.clicks) + " 次 · 第 " +
        (cur.rows.indexOf(my) + 1) + " 名</span>";
    } else if (who.name) {
      mineEl.innerHTML = "<span class='ms-rank-mine-t'>我：</span>" +
        "<b>" + esc(who.name) + "</b>" +
        "<span class='ms-rank-mine-n'>本机累计 " + fmtNum(total) + " 次，还没进前 " + LIMIT + "</span>";
    } else {
      mineEl.innerHTML = "<span class='ms-rank-mine-t'>未登录也能上榜：</span>" +
        "<span class='ms-rank-mine-n'>敲几下就会以「访客 N」自动上榜</span>";
    }
  }

  function load() {
    if (!ready()) {
      cur.err = "unavailable";
      cur.loading = false;
      render();
      return Promise.resolve();
    }
    cur.loading = true;
    cur.err = null;
    render();
    return apiJson({ limit: LIMIT }).then(function (b) {
      cur.rows = (b && b.rows) || [];
      cur.loading = false;
      render();
      paintMine();
    })["catch"](function () {
      cur.loading = false;
      cur.err = "error";
      render();
    });
  }

  /* ── 上报 ──
     只有比上次上报更大才发，且同一时刻只允许一个请求在飞。
     镜像域不发（没有 Functions），登录与否都靠 deviceId 归属。 */
  function report(n) {
    n = Math.floor(Number(n) || 0);
    if (n <= 0 || n <= lastSent || onMirror || inflight) return Promise.resolve(null);
    if (!ready()) return Promise.resolve(null);
    var who = me();
    if (!who.name) return Promise.resolve(null);
    var c = cloud();
    var body = { nickname: who.name, clicks: n };
    var dev = (c.scores && c.scores.deviceId) ? c.scores.deviceId() : "";
    if (dev) body.deviceId = dev;
    var rg = (c.scores && c.scores.region) ? c.scores.region() : "";
    if (rg) body.region = rg;
    var av = (c.avatar && c.avatar.get) ? c.avatar.get() : "";
    if (!who.guest && av && av.length <= 16384 && av.indexOf("data:image/") === 0) body.avatar = av;

    inflight = true;
    return fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (b) {
      inflight = false;
      if (b && b.ok) lastSent = n;
      if (b && b.ok && isOpen()) load();
      return b;
    })["catch"](function () { inflight = false; return null; });
  }

  function isOpen() { return !!panel && !panel.classList.contains("hidden"); }
  function open() {
    if (!panel) return;
    var was = isOpen();
    panel.classList.remove("hidden");
    if (!was) {
      load();
      document.dispatchEvent(new CustomEvent("panel:open", { detail: { name: "wf-rank" } }));
    }
    if (btnClose) btnClose.focus();
  }
  function close() {
    if (!panel || !isOpen()) return;
    panel.classList.add("hidden");
    document.dispatchEvent(new CustomEvent("panel:close", { detail: { name: "wf-rank" } }));
  }

  if (btnOpen) btnOpen.addEventListener("click", open);
  if (btnClose) btnClose.addEventListener("click", close);
  panel.addEventListener("click", function (e) { if (e.target === panel) close(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) { e.preventDefault(); close(); }
  });

  /* 头像 / 昵称改完立刻反映到榜上（不清空，等新数据回来再替换） */
  ["rank:nick-changed", "rank:avatar-changed"].forEach(function (ev) {
    document.addEventListener(ev, function () {
      lastSent = 0;                       // 允许用同一计数再写一次，把新头像同步上去
      if (isOpen()) load();
    });
  });

  global.WowWfRank = {
    report: report,
    open: open,
    close: close,
    reload: load,
    __rows: function () { return cur.rows; }
  };
})(window);
