/**
 * theme.js — PaperMod 主题内联脚本的外置复刻版
 * ════════════════════════════════════════════════════════════════
 * 背景：CSP 已去除 'unsafe-inline'（安全评级 A+），主题 head.html /
 * footer.html 里的 4 段内联脚本在 pages.dev 上会被浏览器拦截。
 * 本文件以外部脚本（'self' 放行）复刻它们的行为。
 *
 * ⚠️ 镜像站（WorkBuddy 托管）没有 CSP，主题内联脚本会正常执行。
 *    为避免事件双重绑定（切主题按钮一次点击翻两次 = 看似没反应），
 *    用 eval 探测 CSP 是否生效：被拦截（CSP 存在）才绑定。
 *    —— eval() 在无 'unsafe-eval' 的 CSP 下必然抛错，可作同步探测。
 *
 * 本文件在 <head> 中同步加载，主题初始化在首帧前完成，不会闪主题。
 * 若日后修改 hugo.toml 的 defaultTheme / disableThemeToggle，需同步核对本文件。
 */
(function () {
  "use strict";

  var html = document.documentElement;

  /* ── 1) 主题初始化（对应 head.html 的内联脚本，defaultTheme = "dark"）──
     必须在任何渲染发生前执行：本文件同步加载于 <head>
     默认暗色；手动切浅色只记住「当前浏览会话」（sessionStorage），
     重开浏览器恢复黑色，不做永久记忆。
     旧版把偏好写在 localStorage，这里顺带清掉，让老访客也回归默认黑。 */
  try {
    localStorage.removeItem("pref-theme");
    var pref = sessionStorage.getItem("pref-theme");
    if (pref === "light") html.dataset.theme = "light";
    else html.dataset.theme = "dark";
  } catch (e) {}

  /* ── 2) CSP 探测 ── */
  var cspBlocked = false;
  try { eval("void 0"); } catch (e) { cspBlocked = true; }

  function initUI() {
    /* 菜单横向滚动位置记忆（footer.html 内联脚本 1）*/
    var menu = document.getElementById("menu");
    if (menu) {
      try {
        var sp = localStorage.getItem("menu-scroll-position");
        if (sp) menu.scrollLeft = parseInt(sp, 10) || 0;
        menu.onscroll = function () {
          localStorage.setItem("menu-scroll-position", menu.scrollLeft);
        };
      } catch (e) {}
    }

    /* 页内锚点平滑滚动（footer.html 内联脚本 1 后半段）
       加 data 标记防重复绑定（镜像站上主题内联脚本也会绑一次）*/
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      if (anchor.dataset.agSmooth) return;
      anchor.dataset.agSmooth = "1";
      anchor.addEventListener("click", function (e) {
        e.preventDefault();
        var id = anchor.getAttribute("href").substr(1);
        var target = document.querySelector("[id='" + decodeURIComponent(id) + "']");
        if (!target) return;
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          target.scrollIntoView({ behavior: "smooth" });
        } else {
          target.scrollIntoView();
        }
        if (id === "top") history.replaceState(null, null, " ");
        else history.pushState(null, null, "#" + id);
      });
    });

    /* 回到顶部按钮显隐（footer.html 内联脚本 2；直接赋值，天然幂等）*/
    var toplink = document.getElementById("top-link");
    if (toplink) {
      window.onscroll = function () {
        var t = window.innerHeight;
        if (document.body.scrollTop > t || document.documentElement.scrollTop > t) {
          toplink.classList.remove("hidden");
        } else {
          toplink.classList.add("hidden");
        }
      };
    }

    /* 黑夜/白天切换（footer.html 内联脚本 3）
       仅在 CSP 已拦截主题内联脚本时绑定，防止镜像站双重绑定 */
    var toggle = document.getElementById("theme-toggle");
    if (toggle && cspBlocked) {
      toggle.addEventListener("click", function () {
        if (html.dataset.theme === "dark") {
          html.dataset.theme = "light";
          try { sessionStorage.setItem("pref-theme", "light"); } catch (e) {}
        } else {
          html.dataset.theme = "dark";
          try { sessionStorage.setItem("pref-theme", "dark"); } catch (e) {}
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUI);
  } else {
    initUI();
  }
})();
