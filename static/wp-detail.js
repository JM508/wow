/**
 * wp-detail.js — 壁纸详情页（/wallpapers/<slug>/）
 * 职责：
 *   1) 下载：fetch webp → canvas 本机转 JPEG，转不动（老浏览器）回退直接存 webp；
 *      跨域失败兜底新标签打开。成功后把次数写回本机 localStorage（DL_KEY）。
 *   2) 元信息填充：分辨率比例、下载量、收藏量、色系名称与色块（模仿图库站的信息区）。
 * 页面数据挂在 article.wp-detail 的 data-wpd-* 属性上（CSP 禁内联样式/脚本，
 * 动态颜色一律走 CSSOM）。
 */
(function () {
  "use strict";

  var DL_KEY = "wow-wp-dl-v1";
  var FAV_KEY = "wow-wp-fav-v1";
  var root = document.querySelector(".wp-detail");
  if (!root) return;
  var slug = root.getAttribute("data-wpd-slug") || "wallpaper";
  var full = root.getAttribute("data-wpd-full") || "";
  var orig = root.getAttribute("data-wpd-orig") || "";
  var color = root.getAttribute("data-wpd-color") || "";
  var w = parseInt(root.getAttribute("data-wpd-w"), 10) || 0;
  var h = parseInt(root.getAttribute("data-wpd-h"), 10) || 0;
  var btn = document.getElementById("wpd-dl");
  var hdBtn = document.getElementById("wpd-hd");
  var img = document.getElementById("wpd-img");

  /* 占位主色铺图片区：data-wpd-color → CSSOM 赋值（CSP 不拦） */
  if (img && color) img.style.background = color;

  function readJson(k, fb) {
    try {
      var v = JSON.parse(localStorage.getItem(k) || "null");
      return v == null ? fb : v;
    } catch (e) { return fb; }
  }
  function writeJson(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式跳过 */ }
  }

  /* ── 元信息：比例 / 下载量 / 收藏量 / 色系 ── */
  var ratioEl = document.getElementById("wpd-ratio");
  if (ratioEl && w && h) {
    var r = w / h;
    /* 方向（横屏/竖屏）已在「分类」标签里，这里只补比例，避免同一行读两遍 */
    ratioEl.textContent = "· " + (Math.round(r * 100) / 100) + " : 1";
  }

  var dlN = document.getElementById("wpd-dl-n");
  var favN = document.getElementById("wpd-fav-n");
  function paintStats() {
    var m = readJson(DL_KEY, {});
    if (dlN) dlN.textContent = String(m[slug] || 0);
    if (favN) {
      var favs = readJson(FAV_KEY, []);
      favN.textContent = favs.indexOf(slug) >= 0 ? "1" : "0";
    }
  }
  paintStats();

  /* 十六进制主色 → 中文色系名：按 HSL 归类，够用且不需要额外数据字段 */
  function hexToHsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, s = 0, hh = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hh *= 60;
    }
    return { h: hh, s: s * 100, l: l * 100 };
  }
  function colorName(hex) {
    var c = hexToHsl(hex);
    if (!c) return "——";
    if (c.l < 10) return "黑色";
    if (c.l > 93) return "白色";
    if (c.s < 10) return c.l < 45 ? "深灰" : "浅灰";
    var hh = c.h;
    if (hh < 12 || hh >= 345) return "红色";
    if (hh < 40) return "橙色";
    if (hh < 68) return "黄色";
    if (hh < 160) return "绿色";
    if (hh < 195) return "青色";
    if (hh < 255) return "蓝色";
    if (hh < 288) return "紫色";
    if (hh < 320) return "品红";
    return "粉色";
  }
  var nameEl = document.getElementById("wpd-color-name");
  var swatch = document.getElementById("wpd-swatch");
  if (nameEl) {
    var nm = colorName(color);
    /* 有色相信息时带上明暗，如「蓝色（偏暗）」 */
    var c2 = hexToHsl(color);
    if (c2 && c2.s >= 10 && c2.l >= 10 && c2.l <= 93) {
      if (c2.l < 32) nm += "（偏暗）";
      else if (c2.l > 76) nm += "（偏亮）";
    }
    nameEl.textContent = nm;
  }
  if (swatch && color) swatch.style.background = color;

  function addDl(key) {
    var m = readJson(DL_KEY, {});
    m[key] = (m[key] || 0) + 1;
    writeJson(DL_KEY, m);
  }

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

  function extOf(url) {
    var m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url);
    return m ? m[1].toLowerCase() : "webp";
  }

  /* 下载某个地址（默认 full，高清按钮传 orig）；成功后回写计数并刷新页面上的下载量 */
  function download(url, el) {
    if (!url || !el || el.disabled) return;
    var old = el.textContent;
    el.disabled = true;
    el.textContent = "下载中";
    var done = function () { el.disabled = false; el.textContent = old; };
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.blob();
    }).then(function (blob) {
      return toJpeg(blob)["catch"](function () { return null; }).then(function (jb) {
        var ext = jb ? "jpg" : extOf(url);
        saveBlob(jb || blob, "wow-wallpaper-" + slug + "." + ext);
        addDl(slug);
        paintStats();
        done();
      });
    })["catch"](function () {
      done();
      var nb = window.open(url, "_blank");
      if (!nb) location.href = url;
    });
  }

  if (btn) btn.addEventListener("click", function () { download(full, btn); });
  if (hdBtn) hdBtn.addEventListener("click", function () { download(orig || full, hdBtn); });
})();
