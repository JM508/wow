/* ══════════════════════════════════════════════════════════════
   账号与云存档页
   ──────────────────────────────────────────────────────────────
   · 邮箱密码登录 / 邮箱验证码登录 / 验证注册（验证码 + 密码）/ 找回密码
   · 登录后展示云端存档（金币、已购皮肤、更新时间）并提供手动同步
   · 所有网络与权限错误都会给出中文提示，不静默失败
   · 纯外链脚本、无内联代码（CSP 同源白名单）
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CLOUD = window.WowCloud;
  var root = document.getElementById("ac-root");
  if (!root || !CLOUD) return;

  var $ = function (id) { return document.getElementById(id); };
  var elGuest = $("ac-guest");
  var elUserBox = $("ac-user");
  var elMsg = $("ac-msg");
  var elMsg2 = $("ac-msg2");
  var elFacts = $("ac-facts");
  var elWho = $("ac-who");
  var elNick = $("ac-nick");
  var elSyncBtn = $("ac-sync");

  /* ═══════════ 提示与文案 ═══════════ */
  function msg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "ac-msg" + (kind ? " is-" + kind : "");
  }
  function busy(btn, on, textWhenBusy) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.textContent = textWhenBusy || "处理中…";
      btn.disabled = true;
    } else {
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
      btn.disabled = false;
    }
  }
  /* 认证错误统一翻成中文（错误分类见 cloud.js 的 describe） */
  function authMsg(err, ctx) {
    if (!err) return "";
    var k = err.kind || "";
    if (k === "unauthenticated") {
      return ctx === "pw" ? "邮箱或密码不正确，请重试" :
        (ctx === "otp" ? "验证码不正确或已过期，请重新输入或重新获取" : "登录状态已失效，请重新登录");
    }
    if (k === "permission-denied") return CLOUD.describe(err);
    if (k === "network") return "网络连接失败，请检查网络后重试";
    if (k === "rate-limited") return "操作太频繁，请等一会儿再试";
    if (k === "backend-unavailable") return "云服务暂时不可用，请稍后重试";
    if (k === "invalid-request") return "填写的信息有误，请检查后重试";
    return CLOUD.describe(err);
  }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim()); }
  function validPass(v) { return String(v || "").length >= 8; }

  /* 登录成功后的跳转目标（只允许站内相对路径）
     ⚠️ 两道防线：
     1. 浏览器解析 URL 前会先剥掉所有 \t \n \r（/​%09/evil.com → //evil.com），
        所以先把这三个字符剥干净再做前缀判断；
     2. new URL(n, origin).origin 必须等于本站 origin，任何协议相对/
        反斜杠/编码花样都过不了这一关。 */
  function nextPath() {
    try {
      var n = new URLSearchParams(location.search).get("next") || "";
      var clean = String(n).replace(/[\t\n\r]/g, "");
      if (clean.charAt(0) === "/" && clean.charAt(1) !== "/" && clean.charAt(1) !== "\\") {
        var u = new URL(clean, location.origin);
        if (u.origin === location.origin) return clean;
      }
    } catch (e) {}
    return "";
  }

  /* 右上角返回叉：从排行榜「去登录」跳来时回到来源页（跑酷页），否则回首页。
     手机上主题导航折叠成汉堡按钮，没这个叉用户容易卡在登录页出不去。 */
  var elBack = $("ac-back");
  if (elBack) {
    var from = nextPath();
    if (from) elBack.setAttribute("href", from);
  }

  /* ═══════════ 标签页 ═══════════ */
  var tabs = document.querySelectorAll(".ac-tab");
  function showPane(name) {
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].dataset.tab === name;
      tabs[i].classList.toggle("is-on", on);
      tabs[i].setAttribute("aria-selected", on ? "true" : "false");
    }
    var forms = document.querySelectorAll(".ac-form[data-pane]");
    for (var j = 0; j < forms.length; j++) {
      forms[j].classList.toggle("hidden", forms[j].dataset.pane !== name);
    }
    msg(elMsg, "");
  }
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener("click", function () { showPane(this.dataset.tab); });
  }

  /* ═══════════ 验证码：发送与重发倒计时 ═══════════
     发送和提交是两个独立动作：这里只负责发码并把 challenge 存下来，
     提交时绝不再发新码（见 verify 分支）。 */
  var pending = {};              // { pw?:..., otp: {...}, reg: {...}, find: {...} }

  function startCountdown(btn, label) {
    var left = 60;
    btn.disabled = true;
    btn.textContent = label + "（" + left + "s）";
    var timer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = label;
        return;
      }
      btn.textContent = label + "（" + left + "s）";
    }, 1000);
  }

  function sendCode(kind, email, btn, noteEl, label) {
    if (!isEmail(email)) { msg(elMsg, "请先填写正确的邮箱地址", "bad"); return; }
    busy(btn, true, "发送中…");
    CLOUD.auth().sendOtp({ email: email }).then(function (r) {
      busy(btn, false);
      if (r.error) { msg(elMsg, authMsg(r.error), "bad"); return; }
      pending[kind] = {
        email: email,
        verificationId: r.data.verificationId,
        isExistingUser: !!r.data.isExistingUser
      };
      startCountdown(btn, label);
      var extra = "";
      if (kind === "otp" && !pending[kind].isExistingUser) {
        extra = "（这个邮箱还没有账号，请切到「注册」标签，用验证码 + 密码完成注册）";
      }
      if (kind === "reg" && pending[kind].isExistingUser) {
        extra = "（这个邮箱已经注册过了，可以直接用「密码登录」或「验证码登录」）";
      }
      msg(elMsg, "验证码已发送到 " + email + "，请查收邮件。" + extra, "ok");
      if (noteEl) noteEl.textContent = "";
    });
  }

  function bindSend(btnId, kind, emailId, label) {
    var btn = $(btnId), emailEl = $(emailId);
    if (!btn || !emailEl) return;
    btn.addEventListener("click", function () {
      sendCode(kind, emailEl.value.trim(), btn, null, label);
    });
  }
  bindSend("ac-otp-send", "otp", "ac-otp-email", "获取验证码");
  bindSend("ac-reg-send", "reg", "ac-reg-email", "获取验证码");

  /* 找回密码走的是另一条接口：resetPasswordForEmail 本身就是「发码」，
     它返回的 challenge 要留到提交那一步用（提交时不再发新码）。 */
  (function bindFindSend() {
    var btn = $("ac-find-send"), emailEl = $("ac-find-email");
    if (!btn || !emailEl) return;
    btn.addEventListener("click", function () {
      var email = emailEl.value.trim();
      if (!isEmail(email)) { msg(elMsg, "请先填写正确的邮箱地址", "bad"); return; }
      busy(btn, true, "发送中…");
      CLOUD.auth().resetPasswordForEmail(email).then(function (r) {
        busy(btn, false);
        if (r.error) { msg(elMsg, authMsg(r.error), "bad"); return; }
        pending.find = { email: email, challenge: r.data };
        startCountdown(btn, "发送验证码");
        msg(elMsg, "验证码已发送到 " + email + "，请查收邮件后填写新密码", "ok");
      });
    });
  })();

  function requireChallenge(kind, email, formLabel) {
    var p = pending[kind];
    if (!p || p.email !== email) {
      msg(elMsg, "请先点「" + formLabel + "」获取邮箱验证码，再提交", "bad");
      return null;
    }
    return p;
  }

  /* ═══════════ ① 邮箱 + 密码登录 ═══════════ */
  $("ac-form-pw").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("ac-pw-email").value.trim();
    var pass = $("ac-pw-pass").value;
    if (!isEmail(email)) { msg(elMsg, "请填写正确的邮箱地址", "bad"); return; }
    if (!pass) { msg(elMsg, "请输入密码", "bad"); return; }
    var btn = $("ac-pw-go");
    busy(btn, true, "登录中…");
    CLOUD.auth().signInWithPassword({ email: email, password: pass }).then(function (r) {
      busy(btn, false);
      if (r.error) { msg(elMsg, authMsg(r.error, "pw"), "bad"); return; }
      CLOUD.clearSessionCache();
      msg(elMsg, "登录成功，正在同步云存档…", "ok");
      afterLogin();
    });
  });

  /* ═══════════ ② 邮箱验证码登录 ═══════════ */
  $("ac-form-otp").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("ac-otp-email").value.trim();
    var code = $("ac-otp-code").value.trim();
    if (!isEmail(email)) { msg(elMsg, "请填写正确的邮箱地址", "bad"); return; }
    if (!code) { msg(elMsg, "请输入收到的验证码", "bad"); return; }
    var p = requireChallenge("otp", email, "获取验证码");
    if (!p) return;
    if (!p.isExistingUser) {
      msg(elMsg, "这个邮箱还没有账号，请切到「注册」标签，用验证码 + 密码完成注册", "bad");
      return;
    }
    var btn = $("ac-otp-go");
    busy(btn, true, "登录中…");
    CLOUD.auth().verifyOtp({
      email: p.email,
      verificationId: p.verificationId,
      isExistingUser: true,
      token: code
    }).then(function (r) {
      busy(btn, false);
      if (r.error) { msg(elMsg, authMsg(r.error, "otp"), "bad"); return; }
      pending.otp = null;
      CLOUD.clearSessionCache();
      msg(elMsg, "登录成功，正在同步云存档…", "ok");
      afterLogin();
    });
  });

  /* ═══════════ ③ 注册（验证码 + 密码） ═══════════ */
  $("ac-form-reg").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("ac-reg-email").value.trim();
    var code = $("ac-reg-code").value.trim();
    var pass = $("ac-reg-pass").value;
    if (!isEmail(email)) { msg(elMsg, "请填写正确的邮箱地址", "bad"); return; }
    if (!code) { msg(elMsg, "请输入收到的验证码", "bad"); return; }
    if (!validPass(pass)) { msg(elMsg, "密码至少 8 位", "bad"); return; }
    var p = requireChallenge("reg", email, "获取验证码");
    if (!p) return;
    if (p.isExistingUser) {
      msg(elMsg, "这个邮箱已经注册过了，请改用「密码登录」或「验证码登录」", "bad");
      return;
    }
    var btn = $("ac-reg-go");
    busy(btn, true, "注册中…");
    CLOUD.auth().verifyOtp({
      email: p.email,
      verificationId: p.verificationId,
      isExistingUser: false,
      token: code,
      password: pass
    }).then(function (r) {
      busy(btn, false);
      if (r.error) { msg(elMsg, authMsg(r.error, "otp"), "bad"); return; }
      pending.reg = null;
      CLOUD.clearSessionCache();
      msg(elMsg, "注册成功，已自动登录，正在同步云存档…", "ok");
      afterLogin();
    });
  });

  /* ═══════════ ④ 找回密码 ═══════════ */
  $("ac-form-find").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("ac-find-email").value.trim();
    var code = $("ac-find-code").value.trim();
    var pass = $("ac-find-pass").value;
    if (!isEmail(email)) { msg(elMsg, "请填写正确的邮箱地址", "bad"); return; }
    if (!code) { msg(elMsg, "请输入收到的验证码", "bad"); return; }
    if (!validPass(pass)) { msg(elMsg, "新密码至少 8 位", "bad"); return; }
    var p = pending.find;
    if (!p || p.email !== email || !p.challenge) {
      msg(elMsg, "请先点「发送验证码」获取邮箱验证码，再提交", "bad");
      return;
    }
    var btn = $("ac-find-go");
    busy(btn, true, "重设中…");
    p.challenge.updateUser({ nonce: code, password: pass }).then(function (r) {
      busy(btn, false);
      if (r.error) { msg(elMsg, authMsg(r.error, "otp"), "bad"); return; }
      pending.find = null;
      CLOUD.clearSessionCache();
      msg(elMsg, "密码已重设，正在同步云存档…", "ok");
      afterLogin();
    });
  });

  /* ═══════════ 登录成功后的收尾 ═══════════ */
  function afterLogin() {
    CLOUD.session(true).then(function () {
      return CLOUD.wallet.sync();
    }).then(function (r) {
      if (r && r.ok) {
        msg(elMsg, "登录成功，云存档已同步（" + r.coins + " 金币 · " + r.owned + " 件皮肤）", "ok");
      } else if (r && r.error && !r.needLogin) {
        msg(elMsg, "已登录，但云存档同步失败：" + CLOUD.describe(r.error), "bad");
      }
      renderUser();
      var next = nextPath();
      if (next) setTimeout(function () { location.assign(next); }, 700);
    });
  }

  /* ═══════════ 已登录面板 ═══════════ */
  function fact(label, value) {
    return "<li><span>" + label + "</span><b>" + value + "</b></li>";
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "/" + p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " +
      p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function renderUser() {
    var u = CLOUD.user();
    if (!u) {
      elGuest.classList.remove("hidden");
      elUserBox.classList.add("hidden");
      return;
    }
    elGuest.classList.add("hidden");
    elUserBox.classList.remove("hidden");
    elWho.textContent = u.email || "云账号";
    if (elNick) elNick.value = CLOUD.nick();
    refreshFacts();
  }

  function refreshFacts() {
    if (!elFacts) return;
    elFacts.innerHTML = fact("云端存档", "读取中…") + fact("排行榜", "读取中…");
    CLOUD.wallet.pull().then(function (r) {
      var html = "";
      if (r.error) {
        html += fact("云端存档", "读取失败：" + esc(CLOUD.describe(r.error)));
      } else if (!r.data) {
        html += fact("云端存档", "还没有（在游戏里赚到金币后会自动上传）");
      } else {
        var row = r.data;
        var ownedN = Array.isArray(row.owned) ? row.owned.length : 0;
        html += fact("云端金币", (Number(row.coins) || 0) + " 🪙");
        html += fact("云端皮肤", ownedN + " 件");
        html += fact("当前皮肤", esc(row.skin || "默认") + " ｜ " + esc(row.coin_skin || "默认"));
        html += fact("最近同步", esc(fmtTime(row.updated_at)));
      }
      CLOUD.scores.mine(1).then(function (m) {
        if (m.error) {
          html += fact("我的最好成绩", "读取失败：" + esc(CLOUD.describe(m.error)));
        } else if (!m.data || !m.data.length) {
          html += fact("我的最好成绩", "还没有上榜记录");
        } else {
          var best = m.data[0];
          CLOUD.scores.rankAbove(Number(best.score) || 0).then(function (above) {
            var rank = above && !above.error ? (Number(above.count) || 0) + 1 : null;
            var line = (Number(best.score) || 0) + " 分" + (rank ? "（第 " + rank + " 名）" : "");
            elFacts.innerHTML = html + fact("我的最好成绩", esc(line));
          });
          html += fact("我的最好成绩", (Number(best.score) || 0) + " 分");
        }
        elFacts.innerHTML = html;
      });
    });
  }

  if (elSyncBtn) {
    elSyncBtn.addEventListener("click", function () {
      busy(elSyncBtn, true, "同步中…");
      CLOUD.wallet.sync().then(function (r) {
        busy(elSyncBtn, false);
        if (r.ok) {
          msg(elMsg2, "同步完成：" + r.coins + " 金币 · " + r.owned + " 件皮肤已存到云端", "ok");
        } else {
          msg(elMsg2, (r.needLogin ? "登录状态已过期，请重新登录" : "同步失败：" + CLOUD.describe(r.error)), "bad");
        }
        refreshFacts();
      });
    });
  }

  $("ac-reload").addEventListener("click", function () {
    CLOUD.clearSessionCache();
    CLOUD.session(true).then(function () { renderUser(); });
    refreshFacts();
  });

  $("ac-signout").addEventListener("click", function () {
    CLOUD.signOut().then(function () {
      msg(elMsg2, "");
      msg(elMsg, "已退出登录。本地存档仍然保留，可继续离线游玩。", "ok");
      renderUser();
      showPane("pw");
    });
  });

  $("ac-nick-save").addEventListener("click", function () {
    var v = CLOUD.setNick(elNick.value);
    if (!v) { msg(elMsg2, "昵称不能为空", "bad"); return; }
    elNick.value = v;
    msg(elMsg2, "昵称已保存：" + v + "，以后提交成绩就用这个名字", "ok");
    if (CLOUD.user()) CLOUD.wallet.sync().then(refreshFacts);
  });

  $("ac-form-chpw").addEventListener("submit", function (e) {
    e.preventDefault();
    var oldP = $("ac-old").value, newP = $("ac-new").value;
    if (!oldP || !validPass(newP)) { msg(elMsg2, "请填写当前密码，新密码至少 8 位", "bad"); return; }
    var btn = $("ac-chpw-go");
    busy(btn, true, "提交中…");
    CLOUD.auth().resetPasswordForOld({ oldPassword: oldP, newPassword: newP }).then(function (r) {
      busy(btn, false);
      if (r.error) { msg(elMsg2, authMsg(r.error), "bad"); return; }
      $("ac-old").value = ""; $("ac-new").value = "";
      msg(elMsg2, "密码已修改", "ok");
    });
  });

  /* ═══════════ 启动 ═══════════ */
  if (!CLOUD.available()) {
    msg(elMsg, "云服务组件未加载，请刷新页面重试", "bad");
    return;
  }
  CLOUD.wallet.bindAutoPush();
  CLOUD.onAuthChange(function () { renderUser(); });
  CLOUD.session().then(function (r) {
    if (r && r.data) {
      renderUser();
      CLOUD.wallet.sync().then(refreshFacts);
    } else {
      renderUser();
    }
  });
})();
