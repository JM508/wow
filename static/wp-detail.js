/**
 * wp-detail.js — 壁纸详情页（/wallpapers/<slug>/）的下载脚本
 * 下载逻辑与壁纸页灯箱同一条路径：fetch webp → canvas 本机转 JPEG，
 * 转不动（老浏览器）就回退直接存 webp；跨域失败时兜底新标签打开。
 * 页面数据挂在 article.wp-detail 的 data-wpd-* 属性上（CSP 禁内联样式/脚本）。
 */
(function () {
  "use strict";

  var root = document.querySelector(".wp-detail");
  if (!root) return;
  var slug = root.getAttribute("data-wpd-slug") || "wallpaper";
  var full = root.getAttribute("data-wpd-full") || "";
  var btn = document.getElementById("wpd-dl");
  var img = document.getElementById("wpd-img");

  /* 占位主色铺图片区：data-wpd-color → CSSOM 赋值（CSP 不拦） */
  if (img) {
    var c = root.getAttribute("data-wpd-color");
    if (c) img.style.background = c;
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

  function download() {
    if (!full || !btn || btn.disabled) return;
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "下载中";
    var done = function () { btn.disabled = false; btn.textContent = old; };
    fetch(full).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.blob();
    }).then(function (blob) {
      return toJpeg(blob)["catch"](function () { return null; }).then(function (jb) {
        var ext = jb ? "jpg" : extOf(full);
        saveBlob(jb || blob, "wow-wallpaper-" + slug + "." + ext);
        done();
      });
    })["catch"](function () {
      done();
      var w = window.open(full, "_blank");
      if (!w) location.href = full;
    });
  }

  if (btn) btn.addEventListener("click", download);
})();
