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
  var tabs = [].slice.call(document.querySelectorAll(".wp-tab"));

  /* 渲染失败提示：模板没渲染出卡片（数据/构建异常）时，把空态换成明确的错误文案 */
  if (!items.length && empty) {
    empty.textContent = "壁纸加载失败，请刷新重试；若多次失败请通过版权投诉邮箱联系我们。";
  }

  /* 占位底色：图片解码前先铺一层主色，避免大图区域一片白 */
  var brokenCount = 0;
  items.forEach(function (el) {
    var c = el.getAttribute("data-wp-color");
    if (c) el.style.backgroundColor = c;
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
      var hit = tag === "all" || tags.indexOf(tag) >= 0;
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

  /* ── 灯箱 ── */
  var lb = document.getElementById("wp-lb");
  var lbImg = document.getElementById("wp-lb-img");
  var lbCap = document.getElementById("wp-lb-cap");
  var lbDim = document.getElementById("wp-lb-dim");
  var btnX = document.getElementById("wp-lb-x");
  var btnPrev = document.getElementById("wp-lb-prev");
  var btnNext = document.getElementById("wp-lb-next");
  var btnDl = document.getElementById("wp-lb-dl");
  var btnDlZip = document.getElementById("wp-lb-dl-zip");
  var lastFocus = null;
  var pos = -1;

  /* 取某张卡的下载地址：orig=原图（有专属 jpg 用 jpg，否则 1920 宽 webp）；zip=640 压缩 webp */
  function urlOf(el, kind) {
    if (kind === "orig") {
      return el.getAttribute("data-wp-orig") || el.getAttribute("data-wp-full");
    }
    return el.getAttribute("data-wp-thumb") || el.getAttribute("data-wp-full");
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
    var title = el.getAttribute("data-wp-title") || "未命名壁纸";
    var kb = el.getAttribute("data-wp-kb") || "";
    var okb = el.getAttribute("data-wp-origkb") || "";
    lbImg.src = full;
    lbImg.alt = title + " 壁纸";
    lbCap.textContent = title;
    lbDim.textContent = (el.getAttribute("data-wp-size") || "").replace("x", " × ") + " · " +
      (pos + 1) + " / " + arr.length;
    if (btnDl) {
      btnDl.textContent = okb ? "下载原图 · " + okb + "KB" : "下载原图";
      btnDl.setAttribute("aria-label", "下载原图" + (okb ? " · " + okb + "KB" : "") + "，" + title);
    }
    if (btnDlZip) {
      btnDlZip.textContent = kb ? "下载压缩图 · " + kb + "KB" : "下载压缩图";
      btnDlZip.setAttribute("aria-label", "下载压缩图" + (kb ? " · " + kb + "KB" : "") + "，" + title);
    }
    var multi = arr.length > 1;
    btnPrev.hidden = !multi;
    btnNext.hidden = !multi;
  }

  /* ── 下载 ──
     和首页「下载背景图」同一条路径：fetch 拿 blob 再生 a[download]，
     跨域/取不到时兜底新标签打开；文件名用 slug，避免中文名在不同系统乱码。*/
  function saveUrl(url, slug, btn) {
    if (!url) return;
    var name = "wow-wallpaper-" + (slug || "wallpaper") + "." + extOf(url);
    var old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "下载中"; }
    var done = function () { if (btn) { btn.disabled = false; btn.textContent = old; } };
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
      done();
    }).catch(function () {
      done();
      var w = window.open(url, "_blank");
      if (!w) location.href = url;
    });
  }

  function download(kind) {
    var arr = list();
    if (!arr.length || pos < 0) return;
    var el = arr[pos];
    var btn = kind === "orig" ? btnDl : btnDlZip;
    saveUrl(urlOf(el, kind), el.getAttribute("data-wp-key"), btn);
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
  if (btnDl) btnDl.addEventListener("click", function () { download("orig"); });
  if (btnDlZip) btnDlZip.addEventListener("click", function () { download("zip"); });
  lb.addEventListener("click", function (e) {
    /* 点空白处（不是图片/按钮/说明条）关闭 */
    if (e.target === lb) close();
  });

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
      /* 焦点留在灯箱内：按钮循环（关闭 → 上一张 → 下一张 → 下载） */
      var order = [btnX];
      if (!btnPrev.hidden) order.push(btnPrev);
      if (!btnNext.hidden) order.push(btnNext);
      if (btnDl) order.push(btnDl);
      if (btnDlZip) order.push(btnDlZip);
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
    };
  };
})();
