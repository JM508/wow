
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
    bgCount: 20,
    bgFolder: "/images/bg/bg",
    bgExt: ".jpg",
    /* 视口 ≤ 此宽度改用手机版小图 bgN-m.webp（1440 宽 webp，约为原图 1/4 体积）：
       手机上加载 300KB 的 1920 宽原图很慢，而背景还盖着一层蒙版，看不出差别。 */
    bgMobileMax: 820,
    bgDimLight: 0.30, // 白天模式蒙版浓度：0 = 原图，1 = 纯色（越大图片越淡）
                      // ⚠️ 白天蒙版是「加白」混合：会同时提亮 + 把颜色往灰拉（发白的根源），
                      // 与夜间的「加黑」压暗（只降亮度、不损色彩）天然不对称，所以白天要更低。
                      // 0.30 ≈ 背景亮度只比原图高约 20%（0.476 时是 +37%）
    bgDimDark: 0.4,   // 夜间模式黑色蒙版浓度
    bgTintLight: "#bcc6d4", // 白天蒙版颜色：灰蓝。越浅/越亮图就越「白」，
                            // 想更通透可再调深（如 #a9b5c7）；想更亮则往 #d5dbe3 方向调
    bgSaturateLight: 1.15,  // 白天给背景图补饱和度，抵消「加白」混合带来的发灰（1 = 不补）

    /* 验证范围：默认只在网站首页（根路径）拦截，站内文章等子页面直接放行 */
    homeOnly: true,

    /* 首页两个悬浮按钮（纯图标，无文字）：
       左下 = ⬇ 下载背景图；右下 = 眼睛 → 点击后隐去正文/游戏入口、去掉蒙版只看原图，
       图标随之变成「眼睛加一道杠」；点屏幕任意处恢复（仅首页可用，站内页不出现） */
    dlLabel: "下载背景图",
    viewLabel: "只看背景图（隐藏页面其他内容）",
    viewExitLabel: "退出看图（恢复页面）",

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
  /* 浏览器是否支持 webp（不支持就退回原图，别让手机背景开天窗） */
  var webpSupport = null;
  function canWebp() {
    if (webpSupport !== null) return webpSupport;
    try {
      var c = document.createElement("canvas");
      webpSupport = !!(c.toDataURL && c.toDataURL("image/webp").indexOf("data:image/webp") === 0);
    } catch (e) { webpSupport = false; }
    return webpSupport;
  }
  /* 窄屏（手机）→ 小图 bgN-m.webp；桌面 → 原图 */
  function bgUrlFor(idx) {
    var base = CFG.bgFolder + (idx + 1) + CFG.bgExt;
    if (CFG.bgMobileMax && window.innerWidth <= CFG.bgMobileMax && canWebp()) {
      return base.replace(/\.jpg$/, "-m.webp");
    }
    return base;
  }

  /* 选图在脚本一加载（head 阶段）就定下来，并立刻注入 <link rel=preload>：
     背景是首屏最大的元素，以前要等 DOMContentLoaded 才开始下载，
     手机上白白慢半屏 —— 提前到解析 head 时就开始拉图。 */
  var bgPicked = (function pickBgIndex() {
    var n = CFG.bgCount;
    if (!n) return -1;
    var idx = -1, last = -1;
    try { idx = parseInt(sessionStorage.getItem("ag_bg"), 10); } catch (e) {}
    if (!(idx >= 0 && idx < n)) {
      try { last = parseInt(localStorage.getItem("ag_bg_last"), 10); } catch (e) {}
      idx = Math.floor(Math.random() * n);
      if (n > 1 && idx === last) idx = (idx + 1) % n;   // 不与上一张重复
      try {
        sessionStorage.setItem("ag_bg", String(idx));
        localStorage.setItem("ag_bg_last", String(idx));
      } catch (e) {}
    }
    return idx;
  })();
  if (bgPicked >= 0) {
    try {
      var agPre = document.createElement("link");
      agPre.rel = "preload";
      agPre.as = "image";
      agPre.href = bgUrlFor(bgPicked);
      document.head.appendChild(agPre);
    } catch (e) {}
  }

  /* ---------- 悬浮按钮图标（内联 SVG，stroke 用 currentColor，跟随明暗主题） ---------- */
  var ICON_DL =
    '<svg class="ag-ico ag-ico-dl" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    ' aria-hidden="true" focusable="false"><path d="M12 4.5v13"/>' +
    '<path d="M6.6 12.4 12 17.8l5.4-5.4"/></svg>';

  var ICON_EYE_BODY =
    '<path d="M2.2 12S6 5.6 12 5.6 21.8 12 21.8 12 18 18.4 12 18.4 2.2 12 2.2 12Z"/>' +
    '<circle cx="12" cy="12" r="3"/>';

  var ICON_EYE =
    '<svg class="ag-ico ag-ico-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    ' aria-hidden="true" focusable="false">' + ICON_EYE_BODY + '</svg>';

  // 眼睛 + 一道杠（专注看图时显示）
  var ICON_EYE_OFF =
    '<svg class="ag-ico ag-ico-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    ' aria-hidden="true" focusable="false">' + ICON_EYE_BODY +
    '<path d="M4.6 4.6 19.4 19.4"/></svg>';

  function applyBg() {
    var n = CFG.bgCount;
    if (!n) return;
    var idx = bgPicked;
    if (!(idx >= 0 && idx < n)) return;
    var el = document.createElement("div");
    el.id = "ag-bg";
    el.setAttribute("aria-hidden", "true");
    var url = CFG.bgFolder + (idx + 1) + CFG.bgExt;
    el.style.backgroundImage = 'url("' + bgUrlFor(idx) + '")';
    el.style.setProperty("--ag-dim", String(CFG.bgDimLight));
    el.style.setProperty("--ag-dim-dark", String(CFG.bgDimDark));
    if (CFG.bgTintLight) el.style.setProperty("--ag-tint", String(CFG.bgTintLight));
    if (CFG.bgSaturateLight && CFG.bgSaturateLight !== 1)
      el.style.setProperty("--ag-sat", String(CFG.bgSaturateLight));
    el.dataset.src = url;                              // 展示中那张（手机可能是压缩版）
    el.dataset.name = "background" + (idx + 1) + CFG.bgExt;
    el.dataset.full = url;                             // 原图（jpg）
    el.dataset.fullName = "background" + (idx + 1) + CFG.bgExt;
    el.dataset.lite = url.replace(/\.jpg$/, "-m.webp"); // 压缩版（webp，约 1/4 体积）
    el.dataset.liteName = "background" + (idx + 1) + "-m.webp";
    document.body.appendChild(el);
    document.documentElement.setAttribute("data-ag-bg", "1");
    // 首页专属的两个悬浮按钮：左下「下载背景图」、右下「看背景图」
    if (isHome) {
      setupDownload(el);
      setupViewer(el);
    }
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

  /* ---------- 左下角「⬇」（下载背景图，纯图标）+ 是/否确认弹窗 ---------- */
  function setupDownload(bg) {
    if (document.getElementById("ag-dl") || !bg) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "ag-dl";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-label", CFG.dlLabel);
    btn.title = CFG.dlLabel;                 // 图标按钮：靠 title 提示含义
    btn.innerHTML = ICON_DL;
    document.body.appendChild(btn);

    var modal = document.createElement("div");
    modal.id = "ag-dl-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "ag-dl-title");
    modal.hidden = true;
    modal.innerHTML =
      '<div class="ag-dl-card">' +
        '<h2 class="ag-dl-title" id="ag-dl-title">下载背景图片</h2>' +
        '<p class="ag-dl-text">选择要下载的版本：</p>' +
        '<div class="ag-dl-actions">' +
          '<button type="button" class="ag-dl-btn ag-dl-yes" id="ag-dl-full">原图下载</button>' +
          '<button type="button" class="ag-dl-btn ag-dl-yes" id="ag-dl-lite">压缩版下载</button>' +
          '<button type="button" class="ag-dl-btn ag-dl-no" id="ag-dl-no">取消</button>' +
        '</div>' +
        '<p class="ag-dl-note">原图（约 300~500KB）画质最佳；压缩版（约 100KB）手机下载更快，桌面看效果几乎一样。</p>' +
      '</div>';
    document.body.appendChild(modal);

    var full = modal.querySelector("#ag-dl-full");
    var lite = modal.querySelector("#ag-dl-lite");
    var no = modal.querySelector("#ag-dl-no");

    function openModal() { modal.hidden = false; setTimeout(function () { try { full.focus(); } catch (e) {} }, 30); }
    function closeModal() { modal.hidden = true; }

    /* 统一下载动作：fetch 拿 blob（保持同源、可带下载名），失败则新标签打开 */
    function doDownload(url, name) {
      closeModal();
      if (!url) return;
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.blob();
      }).then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.parentNode.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      }).catch(function () {                               // 兜底：新标签打开
        var w = window.open(url, "_blank");
        if (!w) location.href = url;
      });
    }

    btn.addEventListener("click", openModal);              // 点「⬇ 下载背景图」→ 弹选择
    full.addEventListener("click", function () {           // 原图（jpg）
      doDownload(bg.dataset.full || bg.dataset.src, bg.dataset.fullName || "background.jpg");
    });
    lite.addEventListener("click", function () {           // 压缩版（webp）
      doDownload(bg.dataset.lite, bg.dataset.liteName || "background-m.webp");
    });
    no.addEventListener("click", closeModal);              // 取消
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }

  /* ---------- 右下角「👁」按钮：专注看原图（进入后图标变「眼睛加一道杠」） ----------
     进入：html[data-ag-view="1"]（CSS 负责隐正文 + 去蒙版 + 锁滚动）
     退出：点屏幕任意处 / 再点按钮 / Esc；两个按钮与下载弹窗内的点击不算「点屏幕」 */
  function setupViewer(bg) {
    if (!bg || document.getElementById("ag-view")) return;

    var root = document.documentElement;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "ag-view";
    btn.innerHTML = ICON_EYE + ICON_EYE_OFF; // 两个图标都放进按钮，由 CSS 按状态切换
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", CFG.viewLabel);
    btn.title = CFG.viewLabel;
    document.body.appendChild(btn);

    function inView() { return root.getAttribute("data-ag-view") === "1"; }
    function enter() {
      root.setAttribute("data-ag-view", "1");
      btn.setAttribute("aria-pressed", "true");
      btn.setAttribute("aria-label", CFG.viewExitLabel);
      btn.title = CFG.viewExitLabel;
    }
    function exit() {
      root.removeAttribute("data-ag-view");
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", CFG.viewLabel);
      btn.title = CFG.viewLabel;
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (inView()) exit(); else enter();
    });

    // 点屏幕任意处恢复（capture 阶段，最先拿到事件）；
    // target 落在两个悬浮按钮或下载弹窗内 → 不动，交给它们自己的逻辑
    document.addEventListener("click", function (e) {
      if (!inView()) return;
      var t = e.target;
      if (t && t.closest && t.closest("#ag-dl, #ag-view, #ag-dl-modal")) return;
      exit();
    }, true);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && inView()) exit();
    });

    // 供调试 / 测试
    window.AgeGateView = { enter: enter, exit: exit, active: inView, button: btn };
  }

  /* ---------- 启动 ---------- */
  if (/[?&]agegate=reset\b/i.test(location.search)) clearStore();
  purgeOld();

  /* 当前是否首页：① 年龄门禁默认只拦首页；② 「下载背景图」按钮只在首页出现 */
  var p = location.pathname.replace(/index\.html?$/i, "");
  var isHome = (p === "/" || p === "");

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBg);
  } else {
    applyBg();
  }

  if (passed()) {
    html.setAttribute("data-ag", "ok");       // 已通过：不遮罩，正文正常显示
  } else if (!CFG.homeOnly || isHome) {
    html.setAttribute("data-ag", "pending");  // 未通过（且在首页）：隐藏正文，画遮罩
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", render);
    } else {
      render();
    }
  }
  // 非首页未验证：不拦截、不写任何标记（进入首页时会重新验证）

  // 调试 / 手动控制入口
  window.AgeGate = {
    reset: function () { clearStore(); location.reload(); },
    open:  function () { html.setAttribute("data-ag", "pending"); render(); },
    clear: clearStore,
    config: CFG
  };
})();
