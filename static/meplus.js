/* ══════════════════════════════════════════════════════════════
   个人中心增强（全游戏页共用，2026-10-17）
   ──────────────────────────────────────────────────────────────
   补两块原来没有的能力，都长在 _partials/me-center.html 的「个人」页里：

     ① 云账号登录 / 退出（第 19 项）：四个游戏页都能就地登录，
        不必再跳 /account/。只有邮箱 + 密码这一条主路径 ——
        验证码登录 / 注册 / 找回密码仍在账号页（要发信、要倒计时，
        塞进弹层容易做半截）。
     ② 显示设置（2026-10-22）：主题与大字号 / 减少动效 / 高对比三个开关
        直接内嵌在个人中心第四页签「设置」里（与 /settings/ 同一套存储），
        外加「打开本游戏设置」派发 game:set-open 开本局玩法面板。

   进页面时把 localStorage 里的无障碍偏好应用上（/settings/ 负责写），
   这样设置页之外的所有页面表现一致。纯外链脚本、无内联代码（CSP 同源白名单）。
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  /* 云 SDK 是 defer 加载的，取的时候可能还没就绪 —— 一律懒取，不缓存 */
  function C() { return global.WowCloud || null; }
  /* me-center partial 在页面里排在 cloud.js 之前，本文件执行时 WowCloud
     多半还没定义 —— 直接 C() 会读到 null，登录用户也被画成「未登录」，
     且之后再无重绘。这里等 cloud.js 就绪（defer 脚本按文档序执行，几十毫秒内）
     再跑一次回调；2 秒仍没等到就放弃（云服务不可用的页面保持默认 UI）。 */
  function whenCloud(fn) {
    if (C()) { fn(); return; }
    var n = 0;
    var timer = setInterval(function () {
      if (C()) { clearInterval(timer); fn(); return; }
      if (++n >= 40) clearInterval(timer);
    }, 50);
  }
  var A11Y_KEY = "wow-a11y-v1";
  var html = document.documentElement;

  /* ═══════════ ① 无障碍 ═══════════ */
  function loadA11y() {
    var o = { big: false, calm: false, hc: false };
    try {
      var raw = JSON.parse(localStorage.getItem(A11Y_KEY) || "null");
      if (raw && typeof raw === "object") {
        o.big = !!raw.big; o.calm = !!raw.calm; o.hc = !!raw.hc;
      }
    } catch (e) {}
    return o;
  }
  var A11Y = loadA11y();

  function applyA11y() {
    if (!html || !html.classList) return;
    html.classList.toggle("a11y-big", !!A11Y.big);
    html.classList.toggle("a11y-calm", !!A11Y.calm);
    html.classList.toggle("a11y-hc", !!A11Y.hc);
  }

  /* 2026-10-17 第二批：显示设置（主题 / 大字号 / 减少动效 / 高对比）已搬到
     独立页 /settings/，个人中心里不再有这四个开关。
     本文件只负责「进游戏时把已存的设置应用上」，读写都在设置页做。 */
  applyA11y();

  /* ═══════════ ④ 显示设置（2026-10-22 应用户要求搬回第四页签内嵌） ═══════════
     与 /settings/ 页同一套存储：localStorage["wow-a11y-v1"] + sessionStorage["pref-theme"]，
     只记本机、不上云，两边互相打开都能读到同一份。 */
  function saveA11y() {
    try { localStorage.setItem(A11Y_KEY, JSON.stringify(A11Y)); } catch (e) {}
    applyA11y();
    paintA11y();
    document.dispatchEvent(new CustomEvent("a11y:change", { detail: { big: !!A11Y.big, calm: !!A11Y.calm, hc: !!A11Y.hc } }));
  }

  var btnBig = document.getElementById("me-a11y-big");
  var btnCalm = document.getElementById("me-a11y-calm");
  var btnHc = document.getElementById("me-a11y-hc");
  var btnTheme = document.getElementById("me-theme-sw");

  function paintA11y() {
    var pairs = [[btnBig, A11Y.big], [btnCalm, A11Y.calm], [btnHc, A11Y.hc]];
    for (var i = 0; i < pairs.length; i++) {
      var el = pairs[i][0];
      if (!el) continue;
      el.classList.toggle("is-on", !!pairs[i][1]);
      el.setAttribute("aria-pressed", pairs[i][1] ? "true" : "false");
    }
    if (btnTheme) {
      var light = html.dataset.theme === "light";
      btnTheme.classList.toggle("is-on", light);
      btnTheme.setAttribute("aria-pressed", light ? "true" : "false");
      btnTheme.textContent = light ? "深色主题" : "浅色主题";
    }
  }

  if (btnBig) btnBig.addEventListener("click", function () { A11Y.big = !A11Y.big; saveA11y(); });
  if (btnCalm) btnCalm.addEventListener("click", function () { A11Y.calm = !A11Y.calm; saveA11y(); });
  if (btnHc) btnHc.addEventListener("click", function () { A11Y.hc = !A11Y.hc; saveA11y(); });
  if (btnTheme) {
    btnTheme.addEventListener("click", function () {
      var to = html.dataset.theme === "light" ? "dark" : "light";
      html.dataset.theme = to;
      try { sessionStorage.setItem("pref-theme", to); } catch (e) {}
      paintA11y();
      document.dispatchEvent(new CustomEvent("theme:change", { detail: to }));
    });
  }

  var btnGameSet = document.getElementById("me-game-set");
  /* 扫雷 / 贪吃蛇本来就没有独立设置面板（难度在顶栏、音效一键开关），
     这一格对它们没有意义，直接藏掉，别留一个点了没反应的按钮。 */
  var hasGameSet = !!(document.getElementById("ttt-set") || document.getElementById("run-set"));
  if (btnGameSet && !hasGameSet) {
    btnGameSet.classList.add("hidden");
    btnGameSet.disabled = true;
  }
  if (btnGameSet) {
    btnGameSet.addEventListener("click", function () {
      /* 先关个人中心，再把设置面板顶上 —— 两层弹层叠着会互相抢焦点。
         游戏脚本若没监听（例如页面没有独立设置面板），退化为跳到页脚设置区。 */
      if (global.MeCenter && global.MeCenter.close) global.MeCenter.close();
      else document.dispatchEvent(new CustomEvent("me:close"));
      setTimeout(function () {
        document.dispatchEvent(new CustomEvent("game:set-open"));
      }, 30);
    });
  }

  /* ═══════════ ② 云账号 ═══════════ */
  var elGuest = document.getElementById("me-acc-guest");
  var elOn = document.getElementById("me-acc-on");
  var elWho = document.getElementById("me-acc-who");
  var btnLoginOpen = document.getElementById("me-login-open");
  var btnLogout = document.getElementById("me-logout");
  var elBox = document.getElementById("me-login-box");
  var elEmail = document.getElementById("me-login-email");
  var elPass = document.getElementById("me-login-pass");
  var btnLoginGo = document.getElementById("me-login-go");
  var elHint = document.getElementById("me-login-hint");

  function isLogged() { return !!(C() && C().user && C().user()); }
  function boxOpen() { return !!elBox && !elBox.classList.contains("hidden"); }

  function paintAccount() {
    var on = isLogged();
    if (elGuest) elGuest.classList.toggle("hidden", on);
    if (elOn) elOn.classList.toggle("hidden", !on);
    if (on && elWho) {
      var n = (C().nick && C().nick()) || (C().nickOrDefault && C().nickOrDefault()) || "玩家";
      elWho.textContent = "已登录 · " + n;
    }
    /* 设置页签最下方的退出按钮：登录后才出现（个人中心的第四页签共用这块 UI） */
    var setLogout = document.getElementById("me-set-logout");
    var setLogoutHint = document.getElementById("me-set-logout-hint");
    if (setLogout) setLogout.classList.toggle("hidden", !on);
    if (setLogoutHint) setLogoutHint.classList.toggle("hidden", on);
    if (!on) closeBox();
  }

  function closeBox() {
    if (elBox) elBox.classList.add("hidden");
    if (elPass) elPass.value = "";
  }

  function hint(text, bad) {
    if (!elHint) return;
    elHint.textContent = text;
    elHint.classList.toggle("is-bad", !!bad);
  }

  function login() {
    if (!C() || !C().auth) { hint("云服务当前不可用，请稍后再试", true); return; }
    var email = (elEmail && elEmail.value || "").trim();
    var pass = elPass ? elPass.value : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { hint("请填写正确的邮箱地址", true); return; }
    if (!pass) { hint("请输入密码", true); return; }
    var auth = C().auth();
    if (!auth) { hint("云服务当前不可用，请稍后再试", true); return; }
    if (btnLoginGo) { btnLoginGo.disabled = true; btnLoginGo.textContent = "登录中…"; }
    auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      if (btnLoginGo) { btnLoginGo.disabled = false; btnLoginGo.textContent = "登录"; }
      if (r && r.error) {
        var m = (r.error && (r.error.message || r.error.kind)) || "";
        hint(/password|credential|invalid/i.test(m) ? "邮箱或密码不对，再试一次" : "登录失败：" + (m || "请稍后重试"), true);
        return;
      }
      if (C().clearSessionCache) C().clearSessionCache();
      hint("登录成功，正在同步资料…", false);
      paintAccount();
      /* 换账号后本页缓存（战绩、头像、榜单）都要按新身份重取，
         重载一次最省事也最不容易留脏数据。 */
      setTimeout(function () { location.reload(); }, 600);
    })["catch"](function () {
      if (btnLoginGo) { btnLoginGo.disabled = false; btnLoginGo.textContent = "登录"; }
      hint("网络异常，请稍后重试", true);
    });
  }

  if (btnLoginOpen) {
    btnLoginOpen.addEventListener("click", function () {
      if (!elBox) return;
      elBox.classList.remove("hidden");
      if (elEmail) elEmail.focus();
    });
  }
  if (btnLoginGo) btnLoginGo.addEventListener("click", login);
  if (elPass) {
    elPass.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); login(); }
    });
  }
  if (btnLogout) {
    btnLogout.addEventListener("click", doLogout);
  }
  /* 设置页签（第四页签，2026-10-21）最下方的退出登录：与「个人」页同一条退出路径 */
  var btnSetLogout = document.getElementById("me-set-logout");
  if (btnSetLogout) btnSetLogout.addEventListener("click", doLogout);

  function doLogout() {
    if (!C() || !C().signOut) return;
    if (btnLogout) btnLogout.disabled = true;
    if (btnSetLogout) btnSetLogout.disabled = true;
    C().signOut().then(function () {
      if (btnLogout) btnLogout.disabled = false;
      if (btnSetLogout) btnSetLogout.disabled = false;
      paintAccount();
      setTimeout(function () { location.reload(); }, 400);
    })["catch"](function () {
      if (btnLogout) btnLogout.disabled = false;
      if (btnSetLogout) btnSetLogout.disabled = false;
    });
  }

  /* 登录态变化（别处登录 / token 失效）时同步这块 UI */
  applyA11y();
  paintA11y();
  paintAccount();
  /* 云层就绪后再画一次 + 接上会话查询：user() 在会话回来前恒空，
     不重绘的话已登录用户会一直看到「未登录」（2026-10-22 修，含加载顺序问题） */
  whenCloud(function () {
    if (C().onAuthChange) C().onAuthChange(paintAccount);
    if (C().session) C().session().then(function () { paintAccount(); })["catch"](function () {});
  });

  /* 对外暴露：游戏脚本想读无障碍状态（例如跑酷要据此关掉屏幕震动）可以问这里 */
  global.WeA11y = {
    get: function () { return { big: !!A11Y.big, calm: !!A11Y.calm, hc: !!A11Y.hc }; },
    onChange: function (fn) {
      document.addEventListener("a11y:change", function () { fn(global.WeA11y.get()); });
    }
  };
})(window);
