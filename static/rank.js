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
  var elPager   = document.getElementById("rank-pager");

  /* 榜单一次取满 100 条（= 10 页 × 10），翻页纯前端切片，不再发第二次请求 */
  var PAGE_SIZE = CLOUD.LEADER_PAGE || 10;
  var MAX_PAGES = Math.max(1, Math.ceil((CLOUD.LEADER_LIMIT || 100) / PAGE_SIZE));

  var loaded = false;       // 是否已成功拉过榜单
  var lastSubmit = 0;       // 上一次【成功上传】的成绩，避免同一局重复上传
  var lastTop = null;       // 最近一次拉到的榜单（null = 还没拉到）
  var mineNames = null;     // 我的昵称集合（榜单里高亮「是我」）
  var pending = null;       // 上传失败时暂存的一局成绩（登录成功 / 下一局自动补传）
  var page = 0;             // 当前页码（0 起）
  var guestChecking = false; // 访客编号正在分配时，后续局稍等（避免并发重复查询）

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
    page = 0;                        // 每次打开都从榜首看起
    document.dispatchEvent(new CustomEvent("rank:open"));
    refresh();
  }
  function close() {
    if (!isOpen()) return;
    panel.classList.add("hidden");
    document.dispatchEvent(new CustomEvent("rank:close"));
  }

  /* ═══════════ 渲染 ═══════════
     · 名次是「全局名次」：第 3 页第一条显示 41，不是 1
     · 前三名的金银铜配色只看全局名次，翻到后面的页不会再出现 */
  /* ═══════════ 头像 ═══════════
     榜上每一行都带一张脸：玩家在「个人中心 → 个人」里设过头像就显示他自己的，
     没设过（含访客）就用昵称现做一张 —— 首字 + 由昵称算出的固定底色，
     同一个人每次进来颜色都一样，不会满屏灰头像。 */
  function avatarHtml(r) {
    var av = (r && r.avatar) ? String(r.avatar) : "";
    if (av && av.indexOf("data:image/") === 0) {
      return "<img class='rank-ava' src='" + esc(av) + "' alt='' loading='lazy' decoding='async'>";
    }
    var name = String((r && r.nickname) || "");
    var ch = name ? name.slice(0, 1) : "?";
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return "<span class='rank-ava rank-ava-ph' style='background:hsl(" + h + ",52%,46%)' aria-hidden='true'>" +
      esc(ch) + "</span>";
  }

  function renderRows(rows, mineSet) {
    if (!elList) return;
    if (!rows || !rows.length) {
      elList.innerHTML = "<li class='rank-empty'>还没有人上榜，登录后跑一局就是第一名。</li>";
      renderPager(0);
      return;
    }
    var pages = Math.min(MAX_PAGES, Math.ceil(rows.length / PAGE_SIZE));
    if (page > pages - 1) page = pages - 1;      // 榜单变短时把页码收回来
    if (page < 0) page = 0;

    var start = page * PAGE_SIZE;
    var slice = rows.slice(start, start + PAGE_SIZE);
    var html = "";
    for (var i = 0; i < slice.length; i++) {
      var r = slice[i];
      var no = start + i + 1;
      var mine = mineSet && mineSet[r.nickname];
      /* IP 属地（省级/国家级，来自提交成绩时的边缘判定；老行/取不到时不显示） */
      var rg = r && r.region ? String(r.region).slice(0, 32) : "";
      html += "<li class='rank-row" + (mine ? " is-me" : "") + "'>" +
        "<b class='rank-no " + (no <= 3 ? "rank-top" + no : "") + "'>" + no + "</b>" +
        avatarHtml(r) +
        "<span class='rank-name' title='" + esc(r.nickname) + "'>" + esc(r.nickname) +
          (rg ? " <small class='rank-rg'>IP " + esc(rg) + "</small>" : "") + "</span>" +
        "<span class='rank-score'>" + (Number(r.score) || 0) + "</span>" +
        "<span class='rank-day'>" + esc(fmtDay(r.created_at)) + "</span>" +
        "</li>";
    }
    elList.innerHTML = html;
    if (elList.start !== undefined) elList.start = start + 1;   // <ol> 语义上从第 N 名开始
    renderPager(rows.length, pages);
  }

  /* ═══════════ 分页条 ═══════════
     只有一页时不渲染（不占位）；首末页的 ‹ › 置灰 */
  function renderPager(total, pages) {
    if (!elPager) return;
    if (!total || !pages || pages <= 1) { elPager.innerHTML = ""; return; }
    var html = "<button type='button' class='rank-pg' data-pg='" + (page - 1) + "'" +
      (page === 0 ? " disabled" : "") + " aria-label='上一页'>‹</button>";
    for (var p = 0; p < pages; p++) {
      html += "<button type='button' class='rank-pg rank-pg-no" + (p === page ? " is-cur" : "") +
        "' data-pg='" + p + "'" + (p === page ? " aria-current='page'" : "") +
        " aria-label='第 " + (p + 1) + " 页'>" + (p + 1) + "</button>";
    }
    html += "<button type='button' class='rank-pg' data-pg='" + (page + 1) + "'" +
      (page >= pages - 1 ? " disabled" : "") + " aria-label='下一页'>›</button>";
    html += "<span class='rank-pg-info'>第 " + (page + 1) + "/" + pages + " 页 · 共 " + total + " 人</span>";
    elPager.innerHTML = html;
  }

  /* 翻页后把列表开头带回视野（面板自身可滚动，短列表则不滚） */
  function scrollToList() {
    if (!elList) return;
    var box = elList.parentNode;
    while (box && box !== document.body && box.scrollHeight <= box.clientHeight + 4) box = box.parentNode;
    if (!box || box === document.body) return;
    var top = 0, n = elList;
    while (n && n !== box) { top += n.offsetTop; n = n.offsetParent; }
    box.scrollTop = Math.max(0, top - 8);
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

  /* ═══════════ 拉取并渲染 ═══════════
     ⚠️ 必须先等 CLOUD.session() 返回再判断登录态：页面刚加载时 SDK 还在
     恢复会话，此时 user() 是 null——直接判断会把已登录用户画成「未登录」，
     这正是「明明登录了、面板却一会儿未登录一会儿报错」的根源之一。 */
  function renderAll() {
    if (lastTop !== null) renderRows(lastTop, mineNames);
  }

  function loadTop() {
    CLOUD.scores.top(CLOUD.LEADER_LIMIT).then(function (top) {
      if (top.error) {
        lastTop = null;
        if (elList) elList.innerHTML = "";
        setStatus(esc(CLOUD.describe(top.error)), "bad");
        return;
      }
      loaded = true;
      lastTop = top.data || [];
      renderAll();
    });
  }

  function loadMine() {
    CLOUD.scores.mine(3).then(function (mine) {
      if (mine && mine.error) {
        /* 查询失败必须如实报错，不能装成「还没有你的成绩」误导人 */
        if (elMine) elMine.innerHTML = "<p class='rank-mine-empty'>" + esc(CLOUD.describe(mine.error)) + "</p>";
        return;
      }
      var rows = (mine && mine.data) || [];
      var names = {};
      for (var i = 0; i < rows.length; i++) names[rows[i].nickname] = true;
      names[CLOUD.nickOrDefault()] = true;          // 昵称刚改过也算自己
      mineNames = names;
      renderAll();
      if (!rows.length) { renderMine([]); return; }
      CLOUD.scores.rankAbove(Number(rows[0].score) || 0).then(function (above) {
        renderMine(rows, above && !above.error ? (Number(above.count) || 0) + 1 : null);
      });
    });
  }

  function refresh() {
    if (!CLOUD.available()) {
      setStatus("云服务组件未加载，请刷新页面重试。", "bad");
      return;
    }
    setStatus("正在读取排行榜…");
    loadTop();                                       // 榜单所有人都能看，与登录无关

    CLOUD.session().then(function (r) {
      if (r && r.error) {
        /* 会话查询失败 ≠ 未登录：把真实原因报出来，下次打开会重试 */
        setStatus(esc(CLOUD.describe(r.error)), "bad");
        if (elMine) elMine.innerHTML = "";
        return;
      }
      var me = CLOUD.user();
      if (!me) {
        mineNames = null;
        renderAll();
        /* 访客模式不能取名：昵称输入行只对登录用户开放 */
        if (elNickRow) elNickRow.style.display = "none";
        setStatus("未登录：<b>访客模式</b>已开启，成绩以「访客 N」自动上传上榜 ｜ " + loginLine(), "warn");
        renderMine([]);
        return;
      }
      if (elNickRow) elNickRow.style.display = "";
      setStatus("已登录 <b>" + esc((me.email || "云账号").split("@")[0]) + "</b> ｜ 每局结束自动上传成绩", "ok");
      loadMine();
      flushPending();
    });
  }

  /* ═══════════ 成绩自动上传（每局一次） ═══════════
     · 未登录 = 访客模式：自动取「访客 N」空号直接上传（服务端只放行这种名字）
     · 已登录：上传前先查重名 —— 排行榜上不允许出现两个同名的人，
       撞名时提示换名字，这局先暂存，改名后自动补传
     · 上传失败绝不静默丢弃：暂存，之后自动补传
     · 服务端会校验成绩（数据自洽 + 距离/用时的物理一致性），
       校验不过的属于「这组数据本身不成立」，暂存重传没有意义，直接如实告知 */
  function stash(entry, score, guest, guestName) {
    var p = {
      score: score,
      coins: entry && entry.coins,
      distance: entry && entry.distance,
      durationMs: entry && entry.durationMs,   // 物理凭证，补传时必须整包带上
      guest: !!guest
    };
    if (guestName) p.guestName = guestName;
    return p;
  }

  function submit(entry) {
    var score = Math.floor((entry && entry.score) || 0);
    if (score <= 0 || score === lastSubmit) return;
    if (!CLOUD.user()) {
      /* 访客模式：分配/复用访客编号后直接上传 */
      if (guestChecking) {
        if (!pending || score > pending.score) pending = stash(entry, score, true);
        return;
      }
      guestChecking = true;
      CLOUD.scores.guestName().then(function (name) {
        guestChecking = false;
        if (pending && pending.guest && pending.score > score) { flushPending(); return; }
        doSubmit(score, entry, name, true);
      });
      return;
    }
    /* 已登录：先查重名 */
    var name = CLOUD.nickOrDefault();
    CLOUD.scores.nameTaken(name).then(function (r) {
      if (r && r.data) {
        if (!pending || score > pending.score) pending = stash(entry, score, false);
        toast("⚠️ 榜上已有「" + name + "」，请换个昵称（下方输入框），改名后自动补传");
        var nickInput = document.getElementById("rank-nick");
        if (nickInput) { try { nickInput.focus(); } catch (e) {} }
        return;
      }
      doSubmit(score, entry, null, false);
    });
  }

  function doSubmit(score, entry, guestName, isGuest) {
    if (score <= 0 || score === lastSubmit) return;
    CLOUD.scores.submit({
      nickname: isGuest ? guestName : undefined,
      score: score,
      coins: entry && entry.coins,
      distance: entry && entry.distance,
      durationMs: entry && entry.durationMs
    }).then(function (r) {
      if (r.error) {
        /* 服务端校验拦下：这组成绩数据本身不成立（分数与距离对不上 /
           用时跑不出这个距离 / 提交太频繁），重传多少次都一样，丢弃并说明 */
        if (r.error.permanent) {
          toast("⚠️ 这一局没有上榜：" + CLOUD.describe(r.error));
          if (pending && pending.score <= score) pending = null;
          return;
        }
        /* lastSubmit 只在成功后记账：失败的这局下一回还有机会补传 */
        if (!pending || score > pending.score) pending = stash(entry, score, isGuest, guestName);
        toast("☁️ 成绩上传失败：" + CLOUD.describe(r.error));
        return;
      }
      lastSubmit = score;
      if (pending && pending.score <= score) pending = null;
      CLOUD.scores.rankAbove(score).then(function (above) {
        var rank = above.error ? 0 : (Number(above.count) || 0) + 1;
        var TOP = CLOUD.LEADER_LIMIT || 100;
        if (rank && rank <= TOP) {
          toast((isGuest ? "🏃 访客模式已上榜：第 " : "☁️ 已上榜：第 ") + rank + " 名");
          return;
        }
        /* 榜外：只报与上榜门槛的差距，不再说「已上榜」。
           门槛 = 第 TOP 名的分数；查不到（网络异常/榜单被清）则退回中性文案。 */
        CLOUD.scores.cutoff().then(function (cut) {
          var gap = (cut && !cut.error && cut.data != null) ? (cut.data - score) : null;
          var head = isGuest ? "🏃 访客模式：" : "☁️ ";
          toast(gap != null && gap > 0
            ? (head + "成绩已上传：距第 " + TOP + " 名还差 " + gap + " 分")
            : (head + "成绩已上传云端"));
        });
      });
      if (isOpen()) refresh();
    });
  }

  /* 登录态就绪（或访客编号分配完成）后补传暂存的成绩 */
  function flushPending() {
    if (!pending) return;
    if (!pending.guest && !CLOUD.user()) return;
    var p = pending;
    pending = null;
    if (p.guest) doSubmit(p.score, p, p.guestName || "访客 0", true);
    else doSubmit(p.score, p, null, false);
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

  /* 翻页：事件委托（分页按钮每次渲染都会重建，逐个绑会漏） */
  if (elPager) {
    elPager.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-pg]") : null;
      if (!t || t.disabled) return;
      var attr = t.getAttribute("data-pg");
      if (attr === null || attr === undefined) return;
      var p = parseInt(attr, 10);
      if (isNaN(p) || p === page || p < 0) return;
      page = p;
      renderAll();
      scrollToList();
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) {
      /* runner.js 也监听了 Escape（暂停/继续）。面板开着时这里必须把事件截住，
         否则关面板的动作会被 runner 再处理一次 → 面板关了却又弹出「已暂停」。
         rank.js 先于 runner.js 注册，stopImmediatePropagation 恰好只拦住后者。 */
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
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
      /* 排行榜不许重名：改名字前先查榜上有没有人已经在用 */
      CLOUD.scores.nameTaken(v).then(function (r) {
        if (r && r.data) {
          toast("⚠️ 「" + v + "」已在排行榜上被使用，请换一个名字");
          return;
        }
        elNick.value = v;
        toast("昵称已保存：" + v);
        flushPending();              // 如果有因撞名暂存的成绩，现在可以补传了
        refresh();
      });
    });
  }

  /* 游戏结束 → 可能是本局成绩，交给上传（登录后才会真的发请求） */
  document.addEventListener("run:over", function (e) { submit(e.detail); });

  /* ═══════════ 访客成绩过户 ═══════════
     登录后把本机之前以「访客 N」上传的成绩收进账号名下（改 owner + 昵称），
     榜单随之刷新——访客条目不再以访客身份留在榜上。
     昵称已被别人占用时保留「访客 N」只换归属（避免制造重名）。
     幂等：过户完成后这些行不再属于 anon，重复调用不会再命中。 */
  function claimGuestRuns() {
    var name = CLOUD.nickOrDefault();
    CLOUD.scores.nameTaken(name).then(function (r) {
      return CLOUD.scores.claimGuest(!(r && r.data));
    }).then(function (res) {
      if (!res || res.error || !res.data) return;    // 没有过户任何行 / 失败 → 下次再试
      toast("☁️ 已把本机访客成绩收入账号名下（" + res.data + " 条）");
      if (isOpen()) refresh(); else loadTop();
    });
  }

  /* 启动：绑定钱包自动回传 + 登录状态下先同步一次 */
  CLOUD.wallet.bindAutoPush();
  CLOUD.session().then(function (r) {
    if (r && r.data) {
      syncWallet(true);
      claimGuestRuns();                // 登录状态打开页面：把之前的访客成绩收进账号
    }
    flushPending();                    // 上一页/上一局暂存的成绩，登录了就补传
  });

  /* 登录态变化：刚登录 → 过户访客成绩 + 补传暂存成绩；面板开着 → 立刻如实刷新状态。
     （会话恢复完成 / 在账号页登录后跳回来，都会走到这里。） */
  var lastUserId = null;
  CLOUD.onAuthChange(function () {
    var u = CLOUD.user();
    var id = u ? u.id : null;
    if (id && id !== lastUserId) {
      claimGuestRuns();
      flushPending();
      if (isOpen()) refresh();
    } else if (!id && lastUserId && isOpen()) {
      refresh();                       // 掉线了，面板如实反映，别停留在「已登录」
    }
    lastUserId = id;
  });
})();
