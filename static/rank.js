/* ══════════════════════════════════════════════════════════════
   火柴人快跑 · 云端排行榜 + 云存档（页内弹层，不跳页）
   ──────────────────────────────────────────────────────────────
   · 排行榜数据来自云数据库 runner_scores：所有访客都能看，
     提交成绩需要先登录（登录后每局结束自动上传）
   · 钱包云存档：登录后与本地存档双向合并（金币取大、皮肤取并集）
   · 未登录 = 完全保持原来的本地玩法，不做任何「假装云同步」
   · 纯外链脚本、无内联代码（CSP 同源白名单）
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CLOUD = window.WowCloud;
  var root = document.getElementById("run-root");
  var panel = document.getElementById("run-rank");
  if (!root || !panel || !CLOUD) return;

  var btnOpen   = document.getElementById("run-rank-btn");
  var btnClose  = document.getElementById("run-rank-close");
  var elStatus  = document.getElementById("rank-status");
  var elList    = document.getElementById("rank-list");
  var elMine    = document.getElementById("rank-mine");
  var elNick    = document.getElementById("rank-nick");
  var btnNick   = document.getElementById("rank-nick-save");
  var elNickRow = document.getElementById("rank-nick-row");

  var loaded = false;       // 是否已拉过榜单
  var lastSubmit = 0;       // 上一次提交的成绩，避免同一局重复上传

  /* ═══════════ 小工具 ═══════════ */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDay(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return (d.getMonth() + 1) + "/" + d.getDate();
  }
  function toast(msg) {
    document.dispatchEvent(new CustomEvent("run:toast", { detail: msg }));
  }
  function setStatus(html, kind) {
    if (!elStatus) return;
    elStatus.className = "rank-status" + (kind ? " is-" + kind : "");
    elStatus.innerHTML = html;
  }

  /* ═══════════ 弹层开关（打开时把局面定格） ═══════════ */
  function isOpen() { return !panel.classList.contains("hidden"); }
  function open() {
    if (isOpen()) return;
    panel.classList.remove("hidden");
    document.dispatchEvent(new CustomEvent("rank:open"));
    refresh();
  }
  function close() {
    if (!isOpen()) return;
    panel.classList.add("hidden");
    document.dispatchEvent(new CustomEvent("rank:close"));
  }

  /* ═══════════ 渲染 ═══════════ */
  function renderRows(rows, mineNames) {
    if (!elList) return;
    if (!rows || !rows.length) {
      elList.innerHTML = "<li class='rank-empty'>还没有人上榜，登录后跑一局就是第一名。</li>";
      return;
    }
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var mine = mineNames && mineNames[r.nickname];
      html += "<li class='rank-row" + (mine ? " is-me" : "") + "'>" +
        "<b class='rank-no " + (i < 3 ? "rank-top" + (i + 1) : "") + "'>" + (i + 1) + "</b>" +
        "<span class='rank-name' title='" + esc(r.nickname) + "'>" + esc(r.nickname) + "</span>" +
        "<span class='rank-score'>" + (Number(r.score) || 0) + "</span>" +
        "<span class='rank-day'>" + esc(fmtDay(r.created_at)) + "</span>" +
        "</li>";
    }
    elList.innerHTML = html;
  }

  function renderMine(rows, rank) {
    if (!elMine) return;
    if (!rows || !rows.length) {
      elMine.innerHTML = "<p class='rank-mine-empty'>还没有你的成绩，跑一局就会自动上榜。</p>";
      return;
    }
    var html = "<p class='rank-mine-head'>我的最佳 <b>" + (Number(rows[0].score) || 0) + "</b> 分" +
      (rank ? "（第 <b>" + rank + "</b> 名）" : "") + "</p><ul>";
    var arr = rows.slice(0, 3);
    for (var i = 0; i < arr.length; i++) {
      html += "<li><span>" + (Number(arr[i].score) || 0) + " 分</span><span>" +
        (Number(arr[i].distance) || 0) + " 米</span><span>" + esc(fmtDay(arr[i].created_at)) + "</span></li>";
    }
    elMine.innerHTML = html + "</ul>";
  }

  function loginLine() {
    return "<a class='rank-login' href='/account/?next=%2Frunner%2F'>去登录</a>";
  }

  /* ═══════════ 拉取并渲染 ═══════════ */
  function refresh() {
    if (!CLOUD.available()) {
      setStatus("云服务组件未加载，请刷新页面重试。", "bad");
      return;
    }
    setStatus("正在读取排行榜…");
    var me = CLOUD.user();

    var withTop = function (mineNames) {
      CLOUD.scores.top(CLOUD.LEADER_LIMIT).then(function (top) {
        if (top.error) {
          setStatus(esc(CLOUD.describe(top.error)), "bad");
          if (elList) elList.innerHTML = "";
          return;
        }
        loaded = true;
        renderRows(top.data || [], mineNames);
      });
    };

    if (!me) {
      setStatus("未登录：可以先看榜，登录后成绩才会保存到云端 ｜ " + loginLine(), "warn");
      renderMine([]);
      withTop(null);
      return;
    }

    setStatus("已登录 <b>" + esc((me.email || "云账号").split("@")[0]) + "</b> ｜ 每局结束自动上传成绩", "ok");
    CLOUD.scores.mine(3).then(function (mine) {
      var rows = (mine && !mine.error && mine.data) || [];
      var names = {};
      for (var i = 0; i < rows.length; i++) names[rows[i].nickname] = true;
      names[CLOUD.nickOrDefault()] = true;          // 昵称刚改过也算自己
      withTop(names);
      if (!rows.length) { renderMine([]); return; }
      CLOUD.scores.rankAbove(Number(rows[0].score) || 0).then(function (above) {
        renderMine(rows, above && !above.error ? (Number(above.count) || 0) + 1 : null);
      });
    });
  }

  /* ═══════════ 成绩自动上传（每局一次） ═══════════ */
  function submit(entry) {
    if (!entry || !CLOUD.user()) return;
    var score = Math.floor(entry.score || 0);
    if (score <= 0 || score === lastSubmit) return;
    lastSubmit = score;
    CLOUD.scores.submit({
      nickname: CLOUD.nickOrDefault(),
      score: score,
      coins: entry.coins,
      distance: entry.distance
    }).then(function (r) {
      if (r.error) { toast("☁️ 成绩上传失败：" + CLOUD.describe(r.error)); return; }
      CLOUD.scores.rankAbove(score).then(function (above) {
        var rank = above.error ? 0 : (Number(above.count) || 0) + 1;
        toast(rank ? ("☁️ 已上榜：第 " + rank + " 名") : "☁️ 成绩已上传云端");
      });
      if (isOpen()) refresh();
    });
  }

  /* ═══════════ 钱包云存档 ═══════════ */
  function syncWallet(quiet) {
    return CLOUD.wallet.sync().then(function (r) {
      if (r.ok) {
        if (!quiet) toast("☁️ 云存档已同步（" + r.coins + " 金币 · " + r.owned + " 件皮肤）");
        document.dispatchEvent(new CustomEvent("cloud:wallet", { detail: r }));
      } else if (!quiet && !r.needLogin) {
        toast("☁️ 云存档同步失败：" + CLOUD.describe(r.error));
      }
      return r;
    });
  }

  /* ═══════════ 事件绑定 ═══════════ */
  if (btnOpen) btnOpen.addEventListener("click", open);
  var links = document.querySelectorAll("[data-open-rank]");
  for (var li = 0; li < links.length; li++) links[li].addEventListener("click", open);
  if (btnClose) btnClose.addEventListener("click", close);
  panel.addEventListener("click", function (e) { if (e.target === panel) close(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) close();
  });
  if (elNick) {
    elNick.value = CLOUD.nick();
    elNick.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (btnNick) btnNick.click(); }
    });
  }
  if (btnNick) {
    btnNick.addEventListener("click", function () {
      var v = CLOUD.setNick(elNick ? elNick.value : "");
      if (!v) { toast("昵称不能为空"); return; }
      elNick.value = v;
      toast("昵称已保存：" + v);
      refresh();
    });
  }

  /* 游戏结束 → 可能是本局成绩，交给上传（登录后才会真的发请求） */
  document.addEventListener("run:over", function (e) { submit(e.detail); });

  /* 启动：绑定钱包自动回传 + 登录状态下先同步一次 */
  CLOUD.wallet.bindAutoPush();
  CLOUD.session().then(function (r) {
    if (r && r.data) syncWallet(true);
  });
})();
