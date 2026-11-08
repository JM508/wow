/* ══ 壁纸页（/wallpapers/）══
   筛选 + 收藏 + 下载计数（本机 localStorage）。
   卡片是可点击的 <a href="/wallpapers/<slug>/">，点一下进入独立详情页（网址变化）。

   2026-11-08 起多一层「运行时校准」：
   静态 HTML 是构建时的快照（SEO 与无 JS 环境靠它），页面打开后再问一次
   /api/wallpapers。版本号与静态快照一致就什么都不做；不一致（D1 里上架/下架/
   改标签/调顺序了）才按接口数据重绘网格 —— 内容改动不必等构建。
   重绘后会重新初始化一次，筛选、收藏、排序的行为完全不变。

   CSP 是 style-src 'self'，这里改样式一律走 CSSOM（el.style.x = ...），
   不往 innerHTML 里塞 style 属性。 */
(function () {
  "use strict";

  var root = document.getElementById("wp-root");
  if (!root) return;

  var grid = document.getElementById("wp-grid");
  var empty = document.getElementById("wp-empty");

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
  function isFav(slug) { return favs.indexOf(slug) >= 0; }

  function tagListOf(el) { return (el.getAttribute("data-wp-tags") || "").split(","); }

  /* ═══════════ 按接口数据重绘网格 ═══════════
     只在版本不一致时走这里；DOM 结构与 layouts/_shortcodes/wallpapers.html 对齐。 */
  var FAV_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 ' +
    '0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 ' +
    '11.54L12 21.35z"/></svg>';

  function buildCard(row, i) {
    var cell = document.createElement("div");
    cell.className = "wp-cell";
    cell.setAttribute("data-wp-cell", row.slug);

    var a = document.createElement("a");
    a.className = "wp-item";
    a.setAttribute("href", "/wallpapers/" + row.slug + "/");
    a.setAttribute("data-wp-key", row.slug);
    a.setAttribute("data-wp-tags", (row.tags || []).join(","));
    a.setAttribute("data-wp-color", row.color || "");
    a.setAttribute("data-wp-size", row.w + "x" + row.h);
    a.setAttribute("aria-label", (row.tags || []).join(" ") + "，查看详情");

    var pic = document.createElement("picture");
    pic.className = "wp-pic";
    if (row.thumb) {
      var source = document.createElement("source");
      source.setAttribute("srcset", row.thumb.replace(".webp", ".avif"));
      source.setAttribute("type", "image/avif");
      pic.appendChild(source);
    }
    var img = document.createElement("img");
    img.className = "wp-img";
    img.setAttribute("src", row.thumb);
    img.setAttribute("width", "640");
    img.setAttribute("height", String(Math.round((640 * row.h) / row.w)));
    img.setAttribute("alt", "壁纸");
    img.setAttribute("loading", i < 3 ? "eager" : "lazy");
    img.setAttribute("decoding", "async");
    if (!i) img.setAttribute("fetchpriority", "high");
    pic.appendChild(img);
    a.appendChild(pic);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wp-fav";
    btn.setAttribute("data-wp-fav", row.slug);
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "收藏这张壁纸");
    btn.innerHTML = FAV_SVG;

    cell.appendChild(a);
    cell.appendChild(btn);
    return cell;
  }

  function countByTag(rows, tag) {
    var n = 0;
    rows.forEach(function (r) {
      if ((r.tags || []).indexOf(tag) >= 0) n++;
    });
    return n;
  }

  /* 页签上的计数跟着重绘更新（静态快照里的数字会过期） */
  function paintTabCounts(rows) {
    var portrait = 0;
    rows.forEach(function (r) { if (Number(r.ratio) < 1) portrait++; });
    var map = {
      all: rows.length,
      "游戏": countByTag(rows, "游戏"),
      "二次元": countByTag(rows, "二次元"),
      "党政": countByTag(rows, "党政"),
      "人物": countByTag(rows, "人物"),
      "横屏": rows.length - portrait,
      "竖屏": portrait
    };
    var tabs = [].slice.call(document.querySelectorAll(".wp-tab[data-wp-tag]"));
    tabs.forEach(function (b) {
      var key = b.getAttribute("data-wp-tag");
      if (key === "fav") return;           /* 收藏数由 paintFav 负责 */
      var n = map[key];
      if (n === undefined) return;
      var badge = b.querySelector(".wp-n");
      if (badge) badge.textContent = String(n);
    });
  }

  function renderGrid(rows) {
    if (!grid) return;
    var frag = document.createDocumentFragment();
    rows.forEach(function (r, i) { frag.appendChild(buildCard(r, i)); });
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    grid.appendChild(frag);
    paintTabCounts(rows);
  }

  /* ═══════════ 页面初始化 ═══════════
     重绘后要再跑一次（节点全新、监听要重绑），所以包成函数。
     文档级监听用 AbortController 统一回收，避免多次初始化后重复响应。 */
  var ac = null;

  function boot() {
    if (!grid) return;
    var items = [].slice.call(grid.querySelectorAll(".wp-item"));
    /* 只收「分类」页签（带 data-wp-tag）；「最多下载」是排序开关，不算分类，
       混进来会让 applyTag(null) 把所有卡片藏掉 */
    var tabs = [].slice.call(document.querySelectorAll(".wp-tab[data-wp-tag]"));

    if (ac) ac.abort();
    ac = typeof AbortController === "function" ? new AbortController() : null;
    var sig = ac ? { signal: ac.signal } : undefined;

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
        var tags = tagListOf(el);
        var hit = tag === "all" ||
          (tag === "fav" ? isFav(el.getAttribute("data-wp-key")) : tags.indexOf(tag) >= 0);
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

    paintFav();

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
    }, sig);

    /* 2026-11-01 用户要求：手机打开先看竖屏、电脑打开先看横屏。
       判断用视口宽度（≤820 与站点其他「手机形态」断点一致，也贴合窄窗桌面）；
       若该方向一张图都没有，回退「全部」，避免进来就是空页。 */
    function defaultTag() {
      var isPhone = false;
      try { isPhone = window.matchMedia("(max-width: 820px)").matches; } catch (e) { /* 老浏览器按电脑处理 */ }
      var want = isPhone ? "竖屏" : "横屏";
      var has = items.some(function (el) { return tagListOf(el).indexOf(want) >= 0; });
      return has ? want : "all";
    }

    applyTag(defaultTag());

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
  }

  /* ── 版权公告 ──
     首页点「壁纸」进来即弹出；5 秒倒计时后「我已知晓」才可点；
     勾选「不再出现」后写入 localStorage，之后不再弹。
     只绑一次（重绘不影响这块 DOM）。 */
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

  boot();

  /* ═══════════ 运行时校准：D1 有变化才重绘 ═══════════ */
  function refresh() {
    if (typeof fetch !== "function") return;
    var built = root.getAttribute("data-wp-version") || "";
    fetch("/api/wallpapers", { headers: { accept: "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.rows || !d.version) return;
        if (built && d.version === built) return;      /* 和快照一致，什么都不做 */
        if (!d.rows.length) return;                    /* 接口空数据不拿来覆盖好页面 */
        renderGrid(d.rows);
        root.setAttribute("data-wp-version", d.version);
        boot();
      })
      .catch(function () { /* 接口不可用就用静态快照，功能不受影响 */ });
  }

  refresh();
})();
