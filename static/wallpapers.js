/* ══ 壁纸页（/wallpapers/）══
   筛选 + 灯箱。约 4KB，不依赖任何框架。
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

  /* ── 收藏与下载计数（2026-10-23）：只记本机 localStorage，不上云 ──
     favs = slug 数组（按收藏先后）；dlCounts = slug -> 次数 */
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
  var brokenCount = 0;
  items.forEach(function (el) {
    var c = el.getAttribute("data-wp-color");
    var pic = el.querySelector(".wp-pic");
    if (c && pic) pic.style.backgroundColor = c;
  });

  /* 图片解码完成后淡入（loading=lazy，长列表里逐个出现） */
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
  /* 卡片外面还有一层 .wp-cell（用来放下载按钮，避免按钮套按钮）；
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
    /* 灯箱开着时切分类：原来的序号可能落到新列表之外，回到第一张 */
    if (lb && !lb.hidden && shown > 0) show(0);
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

  /* ── 灯箱 ── */
  var lb = document.getElementById("wp-lb");
  var lbImg = document.getElementById("wp-lb-img");
  var lbCap = document.getElementById("wp-lb-cap");
  var lbDim = document.getElementById("wp-lb-dim");
  var btnX = document.getElementById("wp-lb-x");
  var btnPrev = document.getElementById("wp-lb-prev");
  var btnNext = document.getElementById("wp-lb-next");
  var btnDl = document.getElementById("wp-lb-dl");
  var btnDl2 = document.getElementById("wp-lb-dl2");
  var btnLbFav = document.getElementById("wp-lb-fav");
  var lbFavTxt = document.getElementById("wp-lb-fav-txt");
  var lastFocus = null;
  var pos = -1;

  /* 取某张卡的下载地址：orig=原图（有专属 jpg 用 jpg，否则 1920 宽 webp） */
  function urlOf(el) {
    return el.getAttribute("data-wp-orig") || el.getAttribute("data-wp-full");
  }
  function extOf(url) {
    var m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url || "");
    return m ? m[1] : "webp";
  }

  function list() { return visible(); }

  function show(idx) {
    var arr = list();
    if (!arr.length) return;
    pos = (idx + arr.length) % arr.length;
    var el = arr[pos];
    var full = el.getAttribute("data-wp-full");
    /* 2026-10-25 去掉全部壁纸名字：标题位改用标签串（如「人物 / 竖屏」），没有名字概念 */
    var title = (el.getAttribute("data-wp-tags") || "").split(",").filter(Boolean).join(" / ") || "壁纸";
    var kb = el.getAttribute("data-wp-kb") || "";
    var okb = el.getAttribute("data-wp-origkb") || "";
    var key = slugOf(el);
    lbImg.src = full;
    lbImg.alt = "壁纸大图" + (title !== "壁纸" ? "（" + title + "）" : "");
    lbCap.textContent = title;
    lbDim.textContent = (el.getAttribute("data-wp-size") || "").replace("x", " × ") + " · " +
      (pos + 1) + " / " + arr.length +
      (dlCounts[key] ? " · 已下载 " + dlCounts[key] + " 次" : "");
    if (btnDl) {
      btnDl.textContent = "下载 JPG";
      btnDl.setAttribute("aria-label", "下载 JPG 格式壁纸（本机转码），" + title);
    }
    if (btnDl2) {
      var size = okb || kb;
      btnDl2.textContent = size ? "WebP · " + size + "KB" : "WebP";
      btnDl2.setAttribute("aria-label", "下载 WebP 原图" + (size ? " · " + size + "KB" : "") + "，" + title);
    }
    paintLbFav();
    var multi = arr.length > 1;
    btnPrev.hidden = !multi;
    btnNext.hidden = !multi;
  }

  /* ── 下载 ──
     两条路径：
     ① 下载 JPG（主按钮）：fetch 拿 webp 后用 canvas 本机转成 JPEG —— 27/28 张
        没有专属 jpg 原图（原图是 8000px 级别的 3-70MB 大图，不能上站），
        转码在本机完成、不增加流量；转不了（老浏览器）就回退下载 webp 文件。
     ② 下载 WebP（副按钮）：直接存 1920 宽 webp，体积最小。
     跨域/取不到时兜底新标签打开；文件名用 slug，避免中文名乱码。 */
  function toJpeg(blob) {
    if (typeof createImageBitmap !== "function" ||
        !window.HTMLCanvasElement || !HTMLCanvasElement.prototype.toBlob) {
      return Promise.reject(new Error("no-convert"));
    }
    return createImageBitmap(blob).then(function (bmp) {
      var c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      return new Promise(function (res, rej) {
        c.toBlob(function (b) { b ? res(b) : rej(new Error("toBlob")); }, "image/jpeg", 0.92);
      });
    });
  }

  function saveBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function saveUrl(url, slug, btn, wantJpg, key) {
    if (!url) return;
    var alreadyJpg = /\.jpe?g$/i.test(url);
    var old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "下载中"; }
    var done = function () { if (btn) { btn.disabled = false; btn.textContent = old; } };
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.blob();
    }).then(function (blob) {
      var conv = (wantJpg && !alreadyJpg)
        ? toJpeg(blob)["catch"](function () { return null; })
        : Promise.resolve(null);
      return conv.then(function (jb) {
        var ext = jb ? "jpg" : (alreadyJpg ? "jpg" : extOf(url));
        saveBlob(jb || blob, "wow-wallpaper-" + (slug || "wallpaper") + "." + ext);
        if (key) addDl(key);
        done();
      });
    })["catch"](function () {
      done();
      var w = window.open(url, "_blank");
      if (!w) location.href = url;
    });
  }

  function download() {
    var arr = list();
    if (!arr.length || pos < 0) return;
    var el = arr[pos];
    saveUrl(urlOf(el), slugOf(el), btnDl, true, slugOf(el));
  }

  function downloadWebp() {
    var arr = list();
    if (!arr.length || pos < 0) return;
    var el = arr[pos];
    saveUrl(el.getAttribute("data-wp-full"), slugOf(el), btnDl2, false, slugOf(el));
  }

  function open(el) {
    lastFocus = el;
    lb.hidden = false;
    document.documentElement.classList.add("wp-lb-open");
    document.body.style.overflow = "hidden";
    show(list().indexOf(el));
    btnX.focus();
  }

  function close() {
    lb.hidden = true;
    document.documentElement.classList.remove("wp-lb-open");
    document.body.style.overflow = "";
    lbImg.removeAttribute("src");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  items.forEach(function (el) {
    el.addEventListener("click", function () { open(el); });
  });

  btnX.addEventListener("click", close);
  btnPrev.addEventListener("click", function () { show(pos - 1); });
  btnNext.addEventListener("click", function () { show(pos + 1); });
  if (btnDl) btnDl.addEventListener("click", download);
  if (btnDl2) btnDl2.addEventListener("click", downloadWebp);
  lb.addEventListener("click", function (e) {
    /* 点空白处（不是图片/按钮/说明条）关闭 */
    if (e.target === lb) close();
  });

  /* ── 收藏（只记本机）：卡片右上角星标 + 灯箱按钮，同一份数据 ── */
  var favN = document.getElementById("wp-n-fav");
  var favBtns = [].slice.call(document.querySelectorAll(".wp-fav"));
  function paintLbFav() {
    if (!btnLbFav) return;
    var arr = list();
    var el = arr[pos];
    var on = !!(el && isFav(slugOf(el)));
    btnLbFav.classList.toggle("is-fav", on);
    btnLbFav.setAttribute("aria-pressed", on ? "true" : "false");
    if (lbFavTxt) lbFavTxt.textContent = on ? "已收藏" : "收藏";
  }
  function paintFav() {
    favBtns.forEach(function (b) {
      var on = isFav(b.getAttribute("data-wp-fav"));
      b.classList.toggle("is-fav", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (favN) favN.textContent = String(favs.length);
    if (lb && !lb.hidden) paintLbFav();
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
  if (btnLbFav) {
    btnLbFav.addEventListener("click", function () {
      var arr = list();
      if (!arr.length || pos < 0) return;
      toggleFav(slugOf(arr[pos]));
    });
  }

  /* ── 下载计数（只记本机）：卡片「已下载 N」徽标 + 灯箱计数 + 排序依据 ── */
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
  function addDl(key) {
    dlCounts[key] = (dlCounts[key] || 0) + 1;
    saveJson(DL_KEY, dlCounts);
    paintDl();
    if (lb && !lb.hidden) show(pos);   /* 灯箱计数同步刷新 */
    if (sortOn) sortByDl();
  }

  paintFav();
  paintDl();

  /* 灯箱里左右滑动切图（触屏） */
  var tx = 0, ty = 0;
  lb.addEventListener("touchstart", function (e) {
    if (!e.touches || !e.touches.length) return;
    tx = e.touches[0].clientX; ty = e.touches[0].clientY;
  }, { passive: true });
  lb.addEventListener("touchend", function (e) {
    if (!e.changedTouches || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - tx;
    var dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(pos + (dx < 0 ? 1 : -1));
  }, { passive: true });

  document.addEventListener("keydown", function (e) {
    if (lb.hidden) {
      /* 未打开时：左右方向键在筛选栏之间切换 */
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        var i = tabs.findIndex(function (b) { return b.getAttribute("data-wp-tag") === current; });
        if (i < 0) return;
        var n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        applyTag(n.getAttribute("data-wp-tag"));
        n.focus();
        e.preventDefault();
      }
      return;
    }
    if (e.key === "Escape") { close(); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { show(pos - 1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { show(pos + 1); e.preventDefault(); }
    else if (e.key === "Tab") {
      /* 焦点留在灯箱内：按钮循环（关闭 → 翻页 → 收藏 → 下载 JPG → 下载 WebP） */
      var order = [btnX];
      if (!btnPrev.hidden) order.push(btnPrev);
      if (!btnNext.hidden) order.push(btnNext);
      if (btnLbFav) order.push(btnLbFav);
      if (btnDl) order.push(btnDl);
      if (btnDl2) order.push(btnDl2);
      var at = order.indexOf(document.activeElement);
      var next = e.shiftKey ? (at <= 0 ? order.length - 1 : at - 1) : (at === order.length - 1 ? 0 : at + 1);
      order[next].focus();
      e.preventDefault();
    }
  });

  applyTag("all");

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

  /* 供测试与探针读取状态 */
  window.__wpState = function () {
    var arr = list();
    var cur = pos >= 0 && pos < arr.length ? arr[pos].getAttribute("data-wp-key") : null;
    return {
      tag: current,
      total: items.length,
      visible: arr.map(function (el) { return el.getAttribute("data-wp-key"); }),
      lightbox: !lb.hidden,
      current: cur,
      notice: !!(notice && !notice.hidden),
      favs: favs.slice(),
      dl: JSON.parse(JSON.stringify(dlCounts)),
      sortOn: sortOn,
    };
  };
})();
