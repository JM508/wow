/* 最近在玩（2026-10-22）
   游戏页：把最近玩过的游戏记到 localStorage["wow-lastplay"]（仅本机展示，不上云）。
   合集页（/games/）：在对应游戏名后面插入「最近在玩」小角标。
   领域事件统一走已有约定：本脚本只做展示，不改任何游戏逻辑。 */
(function () {
  "use strict";
  var KEY = "wow-lastplay";
  var GAMES = {
    "/minesweeper/": 1,
    "/runner/": 1,
    "/tictactoe/": 1,
    "/snake/": 1,
    "/2048/": 1
  };
  var path = location.pathname;

  function isGamesPage() {
    return path === "/games/" || path === "/games/index.html";
  }

  function save() {
    if (!GAMES[path]) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ p: path, t: Date.now() }));
    } catch (e) { /* 隐私模式等场景静默失败 */ }
  }

  function badge() {
    if (!isGamesPage()) return;
    var rec = null;
    try { rec = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
    if (!rec || !GAMES[rec.p]) return;
    var row = document.querySelector('.games-row[href="' + rec.p + '"]');
    if (!row) return;
    var name = row.querySelector(".games-name");
    if (!name || name.querySelector(".games-recent")) return;
    var b = document.createElement("span");
    b.className = "games-recent";
    b.setAttribute("data-i18n", "games.recent");
    b.textContent = (localStorage.getItem("wow-lang") === "en") ? "Recently played" : "最近在玩";
    name.appendChild(b);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { save(); badge(); });
  } else {
    save();
    badge();
  }
})();
