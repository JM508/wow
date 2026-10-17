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

  /* 占位底色：图片解码前先铺一层主色，避免大图区域一片白 */
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
    img.addEventListener("error", function () { el.classList.add("is-ready", "is-broken"); });
  });

  /* ── 筛选 ── */
  var current = "all";
  function visible() {
    return items.filter(function (el) { return !el.hidden; });
  }
  function applyTag(tag) {
    current = tag;
    var shown = 0;
    items.forEach(function (el) {
      var tags = (el.getAttribute("data-wp-tags") || "").split(",");
      var hit = tag === "all" || tags.indexOf(tag) >= 0;
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
  var lastFocus = null;
  var pos = -1;

  function list() { return visible(); }

  function show(idx) {
    var arr = list();
    if (!arr.length) return;
    pos = (idx + arr.length) % arr.length;
    var el = arr[pos];
    var full = el.getAttribute("data-wp-full");
    var title = el.getAttribute("data-wp-title") || "";
    lbImg.src = full;
    lbImg.alt = title + " 壁纸";
    lbCap.textContent = title;
    lbDim.textContent = (el.getAttribute("data-wp-size") || "").replace("x", " × ") + " · " +
      (pos + 1) + " / " + arr.length;
    var multi = arr.length > 1;
    btnPrev.hidden = !multi;
    btnNext.hidden = !multi;
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
      /* 焦点留在灯箱内：三个按钮循环 */
      var order = [btnX];
      if (!btnPrev.hidden) order.push(btnPrev);
      if (!btnNext.hidden) order.push(btnNext);
      var at = order.indexOf(document.activeElement);
      var next = e.shiftKey ? (at <= 0 ? order.length - 1 : at - 1) : (at === order.length - 1 ? 0 : at + 1);
      order[next].focus();
      e.preventDefault();
    }
  });

  applyTag("all");

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
    };
  };
})();
