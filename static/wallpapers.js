/* ══ 壁纸页（/wallpapers/）══
   筛选 + 收藏 + 下载计数（本机 localStorage）。
   卡片是可点击的 <a href="/wallpapers/<slug>/">，点一下进入独立详情页（网址变化）。
   CSP 是 style-src 'self'，这里改样式一律走 CSSOM（el.style.x = ...），
   不往 innerHTML 里塞 style 属性。 */
(function () {
  "use strict";

  var root = document.getElementById("wp-root");
  if (!root) return;

  var grid = document.getElementById("wp-grid");
  var empty = document.getElementById("wp-empty");
  var items = [].slice.call(grid.querySelectorAll(".wp-item"));
  /* 只收「分类」页签（带 data-wp-tag）；「最多下载」是排序开关，不算分类，
     混进来会让 applyTag(null) 把所有卡片藏掉 */
  var tabs = [].slice.call(document.querySelectorAll(".wp-tab[data-wp-tag]"));

  /* ── 收藏与下载计数（本机 localStorage，不上云） ──
     dlCounts = slug -> 次数；真正的下载发生在详情页（/wp-detail.js 写回 DL_KEY），
     这里只读取并展示徽标 / 参与排序。 */
  var FAV_KEY = "wow-wp-fav-v1";
  var DL_KEY = "wow-wp-dl-v1";
  function loadJson(k, fb) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? fb : v; }
    catch (e) { return fb; }
  }
  function saveJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var favs = loadJson(FAV_KEY, []);
  var dlCounts = loadJson(DL_KEY, {});
  function slugOf(el) { return el.getAttribute("data-wp-key"); }
  function isFav(slug) { return favs.indexOf(slug) >= 0; }

  /* 渲染失败提示：模板没渲染出卡片（数据/构建异常）时，把空态换成明确的错误文案 */
  if (!items.length && empty) {
    empty.textContent = "壁纸加载失败，请刷新重试；若多次失败请通过版权投诉邮箱联系我们。";
  }

  /* 占位底色：图片解码前先在图片区铺一层主色，避免大图区域一片白。
     2026-10-22 起铺在 .wp-pic（只盖图片区），不再铺整卡 —— 说明区保持主题底色。 */
  items.forEach(function (el) {
    var c = el.getAttribute("data-wp-color");
    var pic = el.querySelector(".wp-pic");
    if (c && pic) pic.style.backgroundColor = c;
  });

  /* 图片解码完成后淡入（loading=lazy，长列表里逐个出现） */
  var brokenCount = 0;
  items.forEach(function (el) {
    var img = el.querySelector(".wp-img");
    if (!img) return;
    if (img.complete && img.naturalWidth) { el.classList.add("is-ready"); return; }
    img.addEventListener("load", function () { el.classList.add("is-ready"); });
    img.addEventListener("error", function () {
      el.classList.add("is-ready", "is-broken");
      brokenCount++;
      if (brokenCount === items.length && empty) {
        empty.textContent = "壁纸图片加载失败，请检查网络后刷新重试。";
        empty.hidden = false;
      }
    });
  });

  /* ── 筛选 ── */
  var current = "all";
  /* 卡片外面还有一层 .wp-cell（用来放下载按钮/星标，避免链接套按钮）；
     隐藏要落在 cell 上，否则网格里会留下空位。 */
  function cellOf(el) { return el.closest ? el.closest(".wp-cell") : el.parentNode; }
  function visible() {
    return items.filter(function (el) { var c = cellOf(el); return !c || !c.hidden; });
  }
  function applyTag(tag) {
    current = tag;
    var shown = 0;
    items.forEach(function (el) {
      var tags = (el.getAttribute("data-wp-tags") || "").split(",");
      var hit = tag === "all" ||
        (tag === "fav" ? isFav(slugOf(el)) : tags.indexOf(tag) >= 0);
      var c = cellOf(el);
      if (c) c.hidden = !hit;
      el.hidden = !hit;
      if (hit) shown++;
    });
    tabs.forEach(function (b) {
      var on = b.getAttribute("data-wp-tag") === tag;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (empty) empty.hidden = shown > 0;
  }
  tabs.forEach(function (b) {
    b.addEventListener("click", function () { applyTag(b.getAttribute("data-wp-tag")); });
  });

  /* ── 最多下载排序：按本机下载次数从多到少，同次数保持原顺序 ── */
  var sortBtn = document.getElementById("wp-sort-dl");
  var sortOn = false;
  var cells = [];
  items.forEach(function (el) {
    var c = cellOf(el);
    if (c && cells.indexOf(c) < 0) cells.push(c);
  });
  cells.forEach(function (c, i) { c.setAttribute("data-wp-idx", String(i)); });
  function byOrigIdx(a, b) {
    return Number(a.getAttribute("data-wp-idx")) - Number(b.getAttribute("data-wp-idx"));
  }
  function sortByDl() {
    cells.slice().sort(function (a, b) {
      var da = dlCounts[a.getAttribute("data-wp-cell")] || 0;
      var db = dlCounts[b.getAttribute("data-wp-cell")] || 0;
      return da !== db ? db - da : byOrigIdx(a, b);
    }).forEach(function (c) { grid.appendChild(c); });
  }
  function restoreOrder() {
    cells.slice().sort(byOrigIdx).forEach(function (c) { grid.appendChild(c); });
  }
  if (sortBtn) {
    sortBtn.addEventListener("click", function () {
      sortOn = !sortOn;
      sortBtn.classList.toggle("is-on", sortOn);
      sortBtn.setAttribute("aria-pressed", sortOn ? "true" : "false");
      if (sortOn) sortByDl(); else restoreOrder();
    });
  }

  /* ── 收藏（只记本机）：卡片右上角星标 ── */
  var favN = document.getElementById("wp-n-fav");
  var favBtns = [].slice.call(document.querySelectorAll(".wp-fav"));
  function paintFav() {
    favBtns.forEach(function (b) {
      var on = isFav(b.getAttribute("data-wp-fav"));
      b.classList.toggle("is-fav", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (favN) favN.textContent = String(favs.length);
  }
  function toggleFav(slug) {
    var i = favs.indexOf(slug);
    if (i >= 0) favs.splice(i, 1); else favs.push(slug);
    saveJson(FAV_KEY, favs);
    paintFav();
    /* 正看着「收藏」页签时取消收藏，卡片要当场移出列表 */
    if (current === "fav") applyTag("fav");
  }
  favBtns.forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleFav(b.getAttribute("data-wp-fav"));
    });
  });

  /* ── 下载计数徽标（本机）：下载过才显示，卡片下方名称行左端 ── */
  var dlBadges = null;
  function paintDl() {
    if (!dlBadges) {
      dlBadges = [];
      items.forEach(function (el) {
        var b = el.querySelector(".wp-dl-n");
        if (b) dlBadges.push([el, b]);
      });
    }
    dlBadges.forEach(function (pair) {
      var n = dlCounts[slugOf(pair[0])] || 0;
      pair[1].hidden = n <= 0;
      pair[1].textContent = n > 0 ? "已下载 " + n : "";
    });
  }

  paintFav();
  paintDl();

  /* ── 版权公告 ──
     首页点「壁纸」进来即弹出；5 秒倒计时后「我已知晓」才可点；
     勾选「不再出现」后写入 localStorage，之后不再弹。 */
  var notice = document.getElementById("wp-notice");
  var noticeOk = document.getElementById("wp-notice-ok");
  var noticeKeep = document.getElementById("wp-notice-keep");
  var NOTICE_KEY = "wp-notice-ack-v1";
  if (notice && noticeOk) {
    var acked = false;
    try { acked = localStorage.getItem(NOTICE_KEY) === "1"; } catch (e) { /* 隐私模式下照常弹 */ }
    if (!acked) {
      notice.hidden = false;
      var left = 5;
      var timer = setInterval(function () {
        left--;
        if (left <= 0) {
          clearInterval(timer);
          noticeOk.disabled = false;
          noticeOk.textContent = "我已知晓";
        } else {
          noticeOk.textContent = "我已知晓（" + left + "）";
        }
      }, 1000);
      noticeOk.addEventListener("click", function () {
        if (noticeOk.disabled) return;
        if (noticeKeep && noticeKeep.checked) {
          try { localStorage.setItem(NOTICE_KEY, "1"); } catch (e) { /* 写不进就每次都弹 */ }
        }
        notice.hidden = true;
      });
    }
  }

  /* 未聚焦在灯箱时：左右方向键在筛选栏之间切换（键盘可达性）。
     卡片是链接，点一下进详情页；这里只管分类页签的键盘导航。 */
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      var i = tabs.findIndex(function (b) { return b.getAttribute("data-wp-tag") === current; });
      if (i < 0) return;
      var n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      applyTag(n.getAttribute("data-wp-tag"));
      n.focus();
      e.preventDefault();
    }
  });

  applyTag("all");

  /* 供测试与探针读取状态 */
  window.__wpState = function () {
    var arr = visible();
    return {
      tag: current,
      total: items.length,
      visible: arr.map(function (el) { return el.getAttribute("data-wp-key"); }),
      notice: !!(notice && !notice.hidden),
      favs: favs.slice(),
      dl: JSON.parse(JSON.stringify(dlCounts)),
      sortOn: sortOn,
    };
  };
})();
