/* ══════════════════════════════════════════════════════════════
   界面多语言（中 / 英，2026-10-22）
   ──────────────────────────────────────────────────────────────
   范围：站点的「框架文字」——页标题、页面导语、个人中心页签与设置项、
        页脚法务链接。游戏内的玩法说明与弹窗文案仍为中文（翻译整篇
        说明属于内容本地化，不在本文件里硬编码）。
   用法：模板上加 data-i18n="key"（改 textContent）、data-i18n-page="title"
        或 "lead"（按 location.pathname 取对应译文）。
   存储：localStorage["wow-lang"] = "zh" | "en"，切语言不改任何账号数据。
   无内联脚本（CSP script-src 'self'）。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var KEY = "wow-lang";
  var html = document.documentElement;

  var EN = {
    /* 个人中心 */
    "me.title": "Profile",
    "me.tab.me": "Profile",
    "me.tab.ach": "Achievements",
    "me.tab.shop": "Skins",
    "me.tab.set": "Settings",
    "me.nick": "Leaderboard name",
    "me.save": "Save",
    "games.recent": "Recently played",
    "me.stats": "Stats panel",
    "me.stats.open": "Open stats panel",
    "me.stats.hint": "Play counts, best scores and achievement progress for every game.",
    "me.cloud": "Cloud account",
    "me.login": "Sign in",
    "me.logout": "Sign out",
    "me.display": "Display",
    "me.a11y.big": "Large text",
    "me.a11y.calm": "Reduce motion",
    "me.a11y.hc": "High contrast",
    "me.theme": "Light theme",
    "me.haptic": "Haptics",
    "me.gameset": "Game settings",
    "me.install": "Install app",
    "me.install.hint": "Works offline and opens faster. No extra storage.",
    "me.lang": "Language",
    "me.unlocked": "achievements unlocked in this game",
    "me.disp.hint": "Display settings are stored on this device only.",

    /* 页脚 */
    "footer.privacy": "Privacy",
    "footer.terms": "Terms",
    "footer.disclaimer": "Disclaimer",
    "footer.dmca": "DMCA",
    "footer.cookies": "Cookies"
  };

  /* 按路径取页面标题与导语（英文）；没有条目的页面保持中文 */
  var PAGES = {
    "/": {
      t: "Wow Arcade",
      d: "A tiny arcade you can open and play right away: minesweeper, stickman runner, tic-tac-toe, snake and 2048."
    },
    "/games/": {
      t: "All games",
      d: "Everything on Wow Arcade in one place: minesweeper, stickman runner, tic-tac-toe, snake and 2048."
    },
    "/minesweeper/": {
      t: "Minesweeper",
      d: "Classic minesweeper with three board sizes, a daily challenge and a global leaderboard ranked by clear time."
    },
    "/runner/": {
      t: "Stickman Runner",
      d: "Endless runner: jump and duck, collect coins, unlock skins and chase the distance leaderboard."
    },
    "/tictactoe/": {
      t: "Tic-Tac-Toe",
      d: "Tic-tac-toe against the computer on three difficulty levels, with undo and a global points leaderboard."
    },
    "/snake/": {
      t: "Snake",
      d: "Classic snake with tap-to-turn controls, combo scoring and a daily challenge."
    },
    "/2048/": {
      t: "2048",
      d: "Slide and merge the tiles to reach 2048; keyboard, WASD or swipe, plus a daily challenge."
    },
    "/stats/": {
      t: "My stats",
      d: "Your local play stats for every game on this site: rounds, win rate, best scores and achievement progress."
    },
    "/wallpapers/": {
      t: "Wallpapers",
      d: "Free desktop and phone wallpapers drawn for this site, in WebP and AVIF."
    },
    "/settings/": {
      t: "Settings",
      d: "Display options for this site: theme, large text, reduced motion and high contrast."
    },
    "/account/": {
      t: "Account",
      d: "Sign in to keep achievements, nickname and scores across devices."
    }
  };

  function norm(p) {
    p = String(p || "/");
    if (p.length > 1) p = p.replace(/\/+$/, "") + "/";
    return p;
  }

  function stored() {
    try { return localStorage.getItem(KEY) === "en" ? "en" : "zh"; } catch (e) { return "zh"; }
  }

  var ZH_CACHE = null;

  /* 动态插入的元素（如合集页的「最近在玩」角标由 lastplay.js 后插）赶不上首次
     remember()，缓存里没有它的键；切回中文时会按空串写空。给这类键留一份中文原文。 */
  var ZH_FALLBACK = {
    "games.recent": "最近在玩"
  };

  function remember() {
    if (ZH_CACHE) return;
    ZH_CACHE = { text: {}, page: {} };
    var i, els = document.querySelectorAll("[data-i18n]");
    for (i = 0; i < els.length; i++) ZH_CACHE.text[els[i].getAttribute("data-i18n")] = els[i].textContent;
    els = document.querySelectorAll("[data-i18n-page]");
    for (i = 0; i < els.length; i++) ZH_CACHE.page[els[i].getAttribute("data-i18n-page")] = els[i].textContent;
  }

  function apply(lang) {
    remember();
    var en = lang === "en";
    html.classList.toggle("lang-en", en);
    html.setAttribute("lang", en ? "en" : "zh-CN");

    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) {
      var k = els[i].getAttribute("data-i18n");
      els[i].textContent = en
        ? (EN[k] || ZH_CACHE.text[k] || ZH_FALLBACK[k] || "")
        : (ZH_CACHE.text[k] || ZH_FALLBACK[k] || "");
    }

    var pg = PAGES[norm(location.pathname)];
    var ps = document.querySelectorAll("[data-i18n-page]");
    for (var j = 0; j < ps.length; j++) {
      var what = ps[j].getAttribute("data-i18n-page");
      var zh = ZH_CACHE.page[what] || "";
      if (!en) { ps[j].textContent = zh; continue; }
      ps[j].textContent = pg && pg[what === "title" ? "t" : "d"] ? pg[what === "title" ? "t" : "d"] : zh;
    }
    paint();
    document.dispatchEvent(new CustomEvent("lang:change", { detail: { lang: lang } }));
  }

  function paint() {
    var btn = document.getElementById("me-lang-sw");
    if (!btn) return;
    var en = stored() === "en";
    btn.classList.toggle("is-on", en);
    btn.setAttribute("aria-pressed", en ? "true" : "false");
    btn.textContent = en ? "English" : "中文";
  }

  function set(lang) {
    try { localStorage.setItem(KEY, lang === "en" ? "en" : "zh"); } catch (e) {}
    apply(lang === "en" ? "en" : "zh");
  }

  function wire() {
    var btn = document.getElementById("me-lang-sw");
    if (btn) btn.addEventListener("click", function () { set(stored() === "en" ? "zh" : "en"); });
    apply(stored());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  window.WowLang = {
    get: stored,
    set: set,
    apply: apply,
    has: function (k) { return !!EN[k]; }
  };
})();
