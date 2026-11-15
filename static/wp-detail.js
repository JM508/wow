/**
 * wp-detail.js — 壁纸详情页（/wallpapers/<slug>/）
 * 职责：
 *   1) 下载：fetch webp → canvas 本机转 JPEG，转不动（老浏览器）回退直接存 webp；
 *      跨域失败兜底新标签打开。成功后向 /api/wallpapers/stats 报一次下载。
 *   2) 元信息填充：分辨率比例、下载量、收藏量、色系名称与色块（模仿图库站的信息区）。
 *      下载量与收藏量取自站点接口（D1 全站累计），不是本机记录。
 * 页面数据挂在 article.wp-detail 的 data-wpd-* 属性上（CSP 禁内联样式/脚本，
 * 动态颜色一律走 CSSOM）。
 */
(function () {
  "use strict";

  /* 镜像域没有 Functions：同一路径 404，读与写都指回主站。
     主站 Functions 的 CORS 已对镜像域放行 GET/HEAD +（本接口）POST。 */
  var MAIN_ORIGIN = "https://wow-d9s.pages.dev";
  var MIRROR_HOST = "wow-blog.app.workbuddy.host";
  var API_BASE = location.hostname === MIRROR_HOST ? MAIN_ORIGIN : "";
  var DEV_KEY = "wow-dev-v1";

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

  /* 设备号：只用来给「同一台设备的重复下载」去重，不含任何个人信息 */
  function deviceId() {
    var v = "";
    try { v = localStorage.getItem(DEV_KEY) || ""; } catch (e) { /* 隐私模式 */ }
    if (!/^[a-z0-9]{6,40}$/.test(v)) {
      v = "";
      var buf = new Uint8Array(8);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
      else for (var i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
      for (var j = 0; j < 8; j++) v += ("0" + buf[j].toString(16)).slice(-2);
      try { localStorage.setItem(DEV_KEY, v); } catch (e) { /* 存不住就每次都是临时号 */ }
    }
    return v;
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

  function numText(n) {
    return typeof n === "number" && isFinite(n) && n >= 0 ? String(Math.floor(n)) : "—";
  }
  function paintStats(d) {
    if (!d) return;
    if (dlN) dlN.textContent = numText(d.downloads);
    if (favN) favN.textContent = numText(d.favs);
  }

  function statsUrl() {
    return API_BASE + "/api/wallpapers/stats?slug=" + encodeURIComponent(slug);
  }
  function loadStats() {
    if (typeof fetch !== "function") return;
    fetch(statsUrl(), {
      headers: { accept: "application/json" },
      credentials: API_BASE ? "omit" : "same-origin"
    }).then(function (res) { return res.ok ? res.json() : null; })
      .then(paintStats)
      .catch(function () { /* 接口不可用就保持「—」，不编造数字 */ });
  }

  /* 记一次下载：服务端按设备 + 当天去重，返回全站最新计数 */
  function reportDownload() {
    if (typeof fetch !== "function") return;
    fetch(API_BASE + "/api/wallpapers/stats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: API_BASE ? "omit" : "same-origin",
      body: JSON.stringify({ slug: slug, action: "download", device: deviceId() })
    }).then(function (res) { return res.ok ? res.json() : null; })
      .then(paintStats)
      .catch(function () { /* 计数失败不影响用户已拿到的图 */ });
  }

  loadStats();

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

  /* 下载某个地址（默认 full，高清按钮传 orig）；成功后向站点报一次下载并刷新计数 */
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
        reportDownload();
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
