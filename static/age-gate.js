
(function () {
  "use strict";

  /* ═══════════════════ 可配置项：只改这一段 ═══════════════════ */
  var CFG = {
    ver: 1,          // 规则版本号
    minAge: 18,      // 最低年龄

    title: "年龄验证",
    yesText: "是，我已满 18 周岁",
    noText: "否，我未满 18 周岁",

    yesRedirect: "", // 选「是」后额外跳转的地址，留空 = 留在当前页

    /* 站点背景图：/images/bg/bg1.jpg ~ bg{bgCount}.jpg
       每次新开浏览器访问随机换一张（保证与上一张不同） */
    bgCount: 10,
    bgFolder: "/images/bg/bg",
    bgExt: ".jpg",
    bgDim: 0.4,      // 白色蒙版浓度：0 = 原图，1 = 纯白。调低文字可读性变差

    // 选「否」时随机跳转的目标（可自由增删）
    noTargets: [
      { name: "哔哩哔哩", url: "https://www.bilibili.com/" },
      { name: "快手",     url: "https://www.kuaishou.com/" },
      { name: "抖音",     url: "https://www.douyin.com/" },
      { name: "小红书",   url: "https://www.xiaohongshu.com/" },
      { name: "西瓜视频", url: "https://www.ixigua.com/" }
    ],
    noDelay: 1100    // 选「否」后停留多久（毫秒）再跳转
  };

  CFG.question = "您是否已满 " + CFG.minAge + " 周岁？";
  CFG.desc = "本站内容可能包含仅适合成年人浏览的娱乐内容。请确认您已年满 <b>" +
             CFG.minAge + " 周岁</b>；未满 " + CFG.minAge + " 周岁请选择「否」。";
  CFG.foot = "本站内容可能包含成人向娱乐内容，请确认您已年满 " + CFG.minAge + " 周岁。";
  /* ═══════════════════════════════════════════════════════════ */

  var KEY = "age_ok_v" + CFG.ver;
  var html = document.documentElement;

  /* ---------- 读写状态（仅当前浏览会话，无长期缓存） ---------- */
  function readStore() {
    try { return sessionStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }
  function writeStore() {
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
  }
  function clearStore() {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }
  // 清理旧版本遗留的键：sessionStorage 旧版本号 + 老版本的 localStorage / Cookie（14 天缓存时期的残留）
  function purgeOld() {
    try {
      for (var i = sessionStorage.length - 1; i >= 0; i--) {
        var k = sessionStorage.key(i);
        if (k && k.indexOf("age_ok_v") === 0 && k !== KEY) sessionStorage.removeItem(k);
      }
      for (var j = localStorage.length - 1; j >= 0; j--) {
        var lk = localStorage.key(j);
        if (lk && lk.indexOf("age_ok_v") === 0) localStorage.removeItem(lk);
      }
      document.cookie = "age_ok_v1=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax";
    } catch (e) {}
  }

  var passed = readStore;

  /* ---------- 会话背景图：每次新开浏览器随机换一张（与上次不同） ---------- */
  function applyBg() {
    var n = CFG.bgCount;
    if (!n) return;
    var idx = -1, last = -1;
    try { idx = parseInt(sessionStorage.getItem("ag_bg"), 10); } catch (e) {}
    if (!(idx >= 0 && idx < n)) {                 // 本会话还没选过 → 选一张
      try { last = parseInt(localStorage.getItem("ag_bg_last"), 10); } catch (e) {}
      idx = Math.floor(Math.random() * n);
      if (n > 1 && idx === last) idx = (idx + 1) % n;   // 不与上一张重复
      try {
        sessionStorage.setItem("ag_bg", String(idx));
        localStorage.setItem("ag_bg_last", String(idx));
      } catch (e) {}
    }
    var el = document.createElement("div");
    el.id = "ag-bg";
    el.setAttribute("aria-hidden", "true");
    el.style.backgroundImage = 'url("' + CFG.bgFolder + (idx + 1) + CFG.bgExt + '")';
    el.style.setProperty("--ag-dim", String(CFG.bgDim));
    document.body.appendChild(el);
    document.documentElement.setAttribute("data-ag-bg", "1");
  }

  /* ---------- 遮罩渲染 ---------- */
  function render() {
    if (document.getElementById("ag-root")) return;

    var el = document.createElement("div");
    el.id = "ag-root";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "ag-title");
    el.innerHTML =
      '<div class="ag-card">' +
        '<div class="ag-badge" aria-hidden="true">🔞</div>' +
        '<h1 class="ag-title" id="ag-title">' + CFG.title + '</h1>' +
        '<p class="ag-question" id="ag-text">' + CFG.question + '</p>' +
        '<p class="ag-desc">' + CFG.desc + '</p>' +
        '<div class="ag-actions">' +
          '<button type="button" class="ag-btn ag-yes" id="ag-yes">' + CFG.yesText + '</button>' +
          '<button type="button" class="ag-btn ag-no" id="ag-no">' + CFG.noText + '</button>' +
        '</div>' +
        '<div class="ag-loading" aria-hidden="true"><span></span></div>' +
        '<p class="ag-foot">' + CFG.foot + '</p>' +
      '</div>';
    document.body.appendChild(el);

    var card = el.querySelector(".ag-card");
    var yes = el.querySelector("#ag-yes");
    var no = el.querySelector("#ag-no");
    var busy = false;                          // 防重复点击

    // 选「是」：写入会话级标记 → 淡出 → 进入网站
    yes.addEventListener("click", function () {
      if (busy) return;
      busy = true;
      writeStore();
      purgeOld();
      html.removeAttribute("data-ag");       // 先解除正文隐藏，让遮罩淡出时正好露出内容
      el.classList.add("ag-out");
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        if (CFG.yesRedirect) location.href = CFG.yesRedirect;
      }, 320);
    });

    // 选「否」：不写入任何缓存 → 随机跳转短视频官网
    no.addEventListener("click", function () {
      if (busy) return;
      busy = true;
      clearStore();
      var list = CFG.noTargets && CFG.noTargets.length ? CFG.noTargets : [{ name: "短视频平台", url: "https://www.douyin.com/" }];
      var t = list[Math.floor(Math.random() * list.length)];

      var titleEl = el.querySelector("#ag-title");
      var textEl = el.querySelector("#ag-text");
      if (titleEl) titleEl.textContent = "正在跳转…";
      if (textEl) {
        textEl.innerHTML = "未满 " + CFG.minAge + " 周岁的访客无法浏览本站，正在带你前往 <b>" +
                           t.name + "</b> …";
      }
      document.documentElement.style.overflow = "hidden";
      card.classList.add("ag-bye");

      // 立即锁死两个按钮，避免跳转等待期间被重复点击
      var acts = el.querySelector(".ag-actions");
      if (acts) acts.style.display = "none";
      yes.disabled = true;
      no.disabled = true;
      yes.style.pointerEvents = "none";
      no.style.pointerEvents = "none";
      yes.setAttribute("aria-hidden", "true");
      no.setAttribute("aria-hidden", "true");

      setTimeout(function () { location.replace(t.url); }, CFG.noDelay);
    });

    setTimeout(function () { try { yes.focus(); } catch (e) {} }, 60);
  }

  /* ---------- 启动 ---------- */
  if (/[?&]agegate=reset\b/i.test(location.search)) clearStore();
  purgeOld();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBg);
  } else {
    applyBg();
  }

  if (passed()) {
    html.setAttribute("data-ag", "ok");       // 已通过：不遮罩，正文正常显示
  } else {
    html.setAttribute("data-ag", "pending");  // 未通过：立刻隐藏正文，等 DOM 好了再画遮罩
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", render);
    } else {
      render();
    }
  }

  // 调试 / 手动控制入口
  window.AgeGate = {
    reset: function () { clearStore(); location.reload(); },
    open:  function () { html.setAttribute("data-ag", "pending"); render(); },
    clear: clearStore,
    config: CFG
  };
})();
