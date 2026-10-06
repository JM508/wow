/* ══════════════════════════════════════════════════════════════
   个人中心（扫雷 / 井字棋 / 贪吃蛇页共用）
   ──────────────────────────────────────────────────────────────
   · 与跑酷页的同一套面板 DOM 共存（layouts/_partials/me-center.html）；
     跑酷页由 runner.js 驱动，其余游戏页由本文件驱动，两边不共存。
   · 三页签：皮肤（shop.js）/ 成就（ach.js）/ 个人（本文件渲染）。
   · 「个人」页：头像（本地 + 云端）、排行榜昵称（登录后可改名）、IP 属地、
     成就进度。皮肤与成就是全游戏共用的本地存档，任何页面打开都是同一份。
   · 云服务不可用时优雅降级：本地能看的照常看，云端相关显示降级文案。
   · 纯外链脚本、无内联代码（CSP 同源白名单）。对外暴露 window.MeCenter
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var CLOUD = global.WowCloud || null;
  var elShop = document.getElementById("run-shop");
  var elAch  = document.getElementById("run-ach");
  var elMe   = document.getElementById("run-me");
  if (!elShop || !elAch || !elMe) return;

  var btnShopX = document.getElementById("run-shop-close");
  var btnAchX  = document.getElementById("run-ach-close");
  var btnMeX   = document.getElementById("run-me-close");

  var elMeAvaImg = document.getElementById("me-ava-img");
  var elMeAvaPh  = document.getElementById("me-ava-ph");
  var elMeNick   = document.getElementById("me-nick");
  var elMeSub    = document.getElementById("me-sub");
  var elMeRegion = document.getElementById("me-region");
  var btnMePick  = document.getElementById("me-ava-pick");
  var btnMeClear = document.getElementById("me-ava-clear");
  var elMeFile   = document.getElementById("me-ava-file");
  var elMeHint   = document.getElementById("me-ava-hint");
  var elNickInput = document.getElementById("me-nick-input");
  var btnNickSave = document.getElementById("me-nick-save");
  var elNickRow   = document.getElementById("me-nick-row");
  var elNickHint  = document.getElementById("me-nick-hint");
  var elMeGot  = document.getElementById("me-ach-got");
  var elMeTotal = document.getElementById("me-ach-total");
  var elMeBar  = document.getElementById("me-bar");
  var elMeBarFill = document.getElementById("me-bar-fill");

  var ME_TABS = ["shop", "ach", "me"];

  /* ═══════════ 面板开关与页签 ═══════════ */
  function shopOpen() { return !!elShop && !elShop.classList.contains("hidden"); }
  function achOpen()  { return !!elAch  && !elAch.classList.contains("hidden"); }
  function meOpen()   { return !!elMe   && !elMe.classList.contains("hidden"); }
  function tabOpen(t) {
    if (t === "shop") return shopOpen();
    if (t === "ach") return achOpen();
    return meOpen();
  }
  function openTab(t) {
    if (t === "shop") {
      elAch.classList.add("hidden");
      elMe.classList.add("hidden");
      elShop.classList.remove("hidden");
      if (global.Shop && global.Shop.open) global.Shop.open();
    } else if (t === "ach") {
      elShop.classList.add("hidden");
      elMe.classList.add("hidden");
      elAch.classList.remove("hidden");
      if (global.Ach && global.Ach.open) global.Ach.open();
    } else {
      elShop.classList.add("hidden");
      elAch.classList.add("hidden");
      elMe.classList.remove("hidden");
      renderMe();
      document.dispatchEvent(new CustomEvent("me:open"));
      if (CLOUD && CLOUD.avatar && CLOUD.avatar.sync) CLOUD.avatar.sync();
    }
  }
  function closeTab(t) {
    if (t === "shop") {
      elShop.classList.add("hidden");
      if (global.Shop && global.Shop.close) global.Shop.close();
    } else if (t === "ach") {
      elAch.classList.add("hidden");
      if (global.Ach && global.Ach.close) global.Ach.close();
    } else {
      elMe.classList.add("hidden");
      document.dispatchEvent(new CustomEvent("me:close"));
    }
  }
  function anyTabOpen() {
    for (var i = 0; i < ME_TABS.length; i++) if (tabOpen(ME_TABS[i])) return ME_TABS[i];
    return null;
  }
  function open(tab) {
    var want = (tab === "shop" || tab === "ach") ? tab : "me";
    if (tabOpen(want)) return;
    var cur = anyTabOpen();
    if (cur) { closeTab(cur); openTab(want); return; }
    openTab(want);
  }
  function close() {
    var cur = anyTabOpen();
    if (cur) closeTab(cur);
  }

  /* ═══════════ 小工具 ═══════════ */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function toast(msg) {
    document.dispatchEvent(new CustomEvent("run:toast", { detail: msg }));
  }

  /* ═══════════ 头像（与 runner.js 同一套规则） ═══════════
     本地一份（runner-avatar）+ 云端一份（runner_scores.avatar，公开列）。
     选图 → canvas 居中裁正方形 → 压到 96×96 webp（不支持退 jpeg）。
     必须用 FileReader 读 data URL：CSP 是 img-src 'self' data:，blob: 会被拦。 */
  var AVATAR_SIDE = 96;
  var AVATAR_MAX_BYTES = 8 * 1024 * 1024;

  function avatarLocal() { return (CLOUD && CLOUD.avatar) ? CLOUD.avatar.get() : ""; }

  function renderAvatar() {
    var av = avatarLocal();
    if (elMeAvaImg) {
      if (av) {
        if (elMeAvaImg.getAttribute("src") !== av) elMeAvaImg.src = av;
        elMeAvaImg.classList.remove("hidden");
      } else {
        elMeAvaImg.removeAttribute("src");
        elMeAvaImg.classList.add("hidden");
      }
    }
    if (elMeAvaPh) elMeAvaPh.classList.toggle("hidden", !!av);
    if (btnMeClear) btnMeClear.classList.toggle("hidden", !av);
  }

  function compressAvatar(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || "")) { reject(new Error("请选择图片文件")); return; }
      if (file.size > AVATAR_MAX_BYTES) { reject(new Error("图片太大了（超过 8MB），换一张小一点的")); return; }
      if (!global.FileReader || !document.createElement) { reject(new Error("这个浏览器不支持图片处理")); return; }
      var fr = new FileReader();
      var done = false;
      var once = function (fn) { return function (v) { if (done) return; done = true; fn(v); }; };
      fr.onerror = once(function () { reject(new Error("这张图读不出来，换一张试试")); });
      fr.onload = once(function () {
        var src = String(fr.result || "");
        if (src.indexOf("data:image/") !== 0) { reject(new Error("这张图读不出来，换一张试试")); return; }
        var img = new Image();
        img.onerror = function () { reject(new Error("这张图读不出来，换一张试试")); };
        img.onload = function () {
          try {
            var side = AVATAR_SIDE;
            var cv = document.createElement("canvas");
            cv.width = side; cv.height = side;
            var ctx = cv.getContext && cv.getContext("2d");
            if (!ctx) { reject(new Error("这个浏览器不支持图片处理")); return; }
            var w = img.naturalWidth || img.width || side;
            var h = img.naturalHeight || img.height || side;
            var s = Math.min(w, h) || side;
            ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, side, side);
            var out = "";
            try { out = cv.toDataURL("image/webp", 0.72); } catch (e) {}
            if (!out || out.indexOf("data:image/webp") !== 0) out = cv.toDataURL("image/jpeg", 0.8);
            if (!out || out.indexOf("data:image/") !== 0) { reject(new Error("图片转换失败，换一张试试")); return; }
            resolve(out);
          } catch (e) { reject(e); }
        };
        img.src = src;
      });
      try { fr.readAsDataURL(file); } catch (e) { reject(new Error("这张图读不出来，换一张试试")); }
    });
  }

  function saveAvatar(dataUrl) {
    if (!CLOUD || !CLOUD.avatar) { toast("头像功能暂时不可用，请刷新页面重试"); return Promise.resolve(); }
    return CLOUD.avatar.set(dataUrl).then(function (r) {
      renderAvatar();
      if (r && r.error) toast("头像保存失败：" + (CLOUD.describe ? CLOUD.describe(r.error) : "未知错误"));
      else toast(dataUrl ? "头像已保存" : "已移除头像");
    });
  }

  /* ═══════════ 「个人」页渲染 ═══════════ */
  function logged() { return !!(CLOUD && CLOUD.user && CLOUD.user()); }

  function renderNick() {
    var isLogged = logged();
    if (elMeNick) {
      elMeNick.textContent = isLogged ? (CLOUD.nickOrDefault ? CLOUD.nickOrDefault() : "玩家")
        : (guestNameNow() || "未登录");
    }
    if (elMeSub) {
      elMeSub.textContent = isLogged
        ? "已登录 · 头像、昵称与成就跟账号走，换设备也在"
        : "未登录 · 头像只存在本机，成绩以「访客 N」自动上传";
    }
    /* 改名只对登录用户开放；访客走自动编号 */
    if (elNickRow) elNickRow.classList.toggle("hidden", !isLogged);
    if (elNickHint) {
      elNickHint.textContent = isLogged
        ? "改名后会显示在排行榜上（不允许重名），改名立刻生效。"
        : "未登录时成绩以「访客 N」自动上榜；登录后可以在这里自己取名。";
    }
    if (isLogged && elNickInput && document.activeElement !== elNickInput) {
      elNickInput.value = CLOUD.nick ? CLOUD.nick() : "";
    }
  }

  function guestNameNow() {
    if (!CLOUD || !CLOUD.scores || !CLOUD.scores.guestName) return "";
    /* guestName() 是异步的；这里只读会话缓存（sessionStorage）同步展示 */
    try { return global.sessionStorage.getItem("rank-guest-name") || ""; } catch (e) { return ""; }
  }

  function renderRegion() {
    if (!elMeRegion) return;
    var rg = (CLOUD && CLOUD.scores && CLOUD.scores.region) ? CLOUD.scores.region() : "";
    if (rg) {
      elMeRegion.textContent = "IP " + String(rg).slice(0, 32);
      elMeRegion.classList.remove("hidden");
    } else {
      elMeRegion.textContent = "";
      elMeRegion.classList.add("hidden");
    }
  }

  function renderMeAch() {
    var snap = (global.Ach && global.Ach.snapshot) ? global.Ach.snapshot() : null;
    if (!snap) return;
    var got = snap.unlocked || 0, total = snap.total || 0;
    if (elMeGot) elMeGot.textContent = got;
    if (elMeTotal) elMeTotal.textContent = total;
    if (elMeBarFill) elMeBarFill.style.width = (total ? Math.round(got * 100 / total) : 0) + "%";
    if (elMeBar) {
      elMeBar.setAttribute("aria-valuemax", String(total));
      elMeBar.setAttribute("aria-valuenow", String(got));
    }
  }

  function renderMe() {
    renderNick();
    renderRegion();
    renderAvatar();
    renderMeAch();
  }

  /* ═══════════ 改名（排行榜取名入口挪进个人中心） ═══════════ */
  function saveNick() {
    if (!CLOUD || !CLOUD.setNick) return;
    var v = CLOUD.setNick(elNickInput ? elNickInput.value : "");
    if (!v) { toast("昵称不能为空"); return; }
    /* 排行榜不许重名：改名字前先查榜上有没有人已经在用 */
    CLOUD.scores.nameTaken(v).then(function (r) {
      if (r && r.data) { toast("「" + v + "」已在排行榜上被使用，请换一个名字"); return; }
      toast("昵称已保存：" + v);
      document.dispatchEvent(new CustomEvent("rank:nick-changed"));
      renderNick();
    });
  }

  /* ═══════════ 事件绑定 ═══════════ */
  document.addEventListener("click", function (e) {
    var n = e.target && e.target.closest ? e.target.closest("[data-open-me],[data-open-shop]") : null;
    if (n && n.hasAttribute("data-open-me")) { e.preventDefault(); open("me"); return; }
    if (n && n.hasAttribute("data-open-shop")) { e.preventDefault(); open("shop"); return; }
    var t = e.target && e.target.closest ? e.target.closest("[data-me-tab]") : null;
    if (t) { e.preventDefault(); open(t.getAttribute("data-me-tab")); }
  });
  if (btnShopX) btnShopX.addEventListener("click", function () { closeTab("shop"); });
  if (btnAchX)  btnAchX.addEventListener("click", function () { closeTab("ach"); });
  if (btnMeX)   btnMeX.addEventListener("click", function () { closeTab("me"); });
  elShop.addEventListener("click", function (e) { if (e.target === elShop) closeTab("shop"); });
  elAch.addEventListener("click", function (e) { if (e.target === elAch) closeTab("ach"); });
  elMe.addEventListener("click", function (e) { if (e.target === elMe) closeTab("me"); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var cur = anyTabOpen();
    if (cur) { e.preventDefault(); e.stopImmediatePropagation(); closeTab(cur); }
  });

  if (btnMePick && elMeFile) {
    btnMePick.addEventListener("click", function () { elMeFile.click(); });
    elMeFile.addEventListener("change", function () {
      var f = elMeFile.files && elMeFile.files[0];
      elMeFile.value = "";
      if (!f) return;
      compressAvatar(f).then(saveAvatar).catch(function (err) {
        toast((err && err.message) || "图片处理失败");
      });
    });
  }
  if (btnMeClear) btnMeClear.addEventListener("click", function () { saveAvatar(""); });
  if (btnNickSave) {
    btnNickSave.addEventListener("click", saveNick);
    if (elNickInput) {
      elNickInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); saveNick(); }
      });
    }
  }

  /* 皮肤/成就页签打开时各自模块自渲染；成就变化后「个人」页进度需要重画 */
  document.addEventListener("ach:change", renderMeAch);

  /* 登录态变化：重画「个人」页 */
  if (CLOUD && CLOUD.onAuthChange) {
    CLOUD.onAuthChange(function () { if (meOpen()) renderMe(); });
  }

  global.MeCenter = {
    open: open,
    close: close,
    isOpen: function () { return !!anyTabOpen(); },
    refresh: renderMe
  };
})(window);
