/* ══════════════════════════════════════════════════════════════
   工具页 · 超分辨率（2026-11-07 上线，2026-11-08 改版）
   ──────────────────────────────────────────────────────────────
   库：upscalejs v2.1.0（ONNX Runtime Web 1.24 内核，MIT）
       → /tools/upscale/upscalejs.es.js（ESM，仅在点开始时动态 import）
   模型：/tools/upscale/models/RealESRGAN/RealESRGAN_x4plus_anime_6B_uint8.ort（4×）
        /tools/upscale/models/Swin2SR/swin2SR_uint8.ort（2×）
   运行环境：/tools/upscale/js/ort-wasm-simd-threaded.wasm

   硬约束（按站点预算与稳定性定的，不要随手改）：
     · 单线程：numThreads = 1，workerCount = 1。多线程要 COOP+COEP，
       本站没开（开了会孤立整个站点，影响其它页面）。
     · 一次只算一张：state.busy 互斥，按钮直接禁用，避免并发把内存打爆。
     · 算完立刻 release() + terminate()，并 close() 掉所有 ImageBitmap；
       下次再建新实例。模型文件走浏览器 HTTP 缓存，重建不重新下载。
     · 入口长边按模型封顶（4× → 1024，2× → 1600），输出最大约 4096²，
       峰值内存可控在百 MB 量级。

   CSP：script-src 需 'wasm-unsafe-eval'，worker-src 需 blob:
       （库用 Blob URL 起 worker）。见 static/_headers。
   动态文案（进度 / 尺寸 / 报错）走中文，与各游戏内的动态提示同一口径。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var LIB_PATH = "/tools/upscale/upscalejs.es.js";
  /* 必须是「绝对 URL」而不是 /tools/... 这种站内路径：
     库在 Blob worker 里用 import() 加载 ort-wasm-simd-threaded.mjs，
     blob: 上下文里解析不了以 / 开头的模块说明符。 */
  var BASE = new URL("/tools/upscale/", window.location.href).href;
  var MAX_IN = { "6B": 512, Swin2SR: 384 };    // 入口长边上限（按实测耗时定的，别随手放大）
  var FACTOR = { "6B": 4, Swin2SR: 2 };
  var TILE = { "6B": 256, Swin2SR: 64 };       // 模型分块边长，用于估时
  var MAX_DECODE = 6000;                       // 超过就不解，直接提示先缩小
  var MAX_FILE_MB = 20;
  var SPEED_KEY = "wow-tool-speed-v1";         // { "6B": 每块毫秒, "Swin2SR": 每块毫秒 }

  var root = document.getElementById("tool-upscale");
  if (!root) return;

  var drop = document.getElementById("tol-drop");
  var fileInput = document.getElementById("tol-file");
  var fileInfo = document.getElementById("tol-fileinfo");
  var runBtn = document.getElementById("tol-run");
  var progWrap = document.getElementById("tol-prog");
  var bar = document.getElementById("tol-bar");
  var statusEl = document.getElementById("tol-status");
  var tipEl = document.getElementById("tol-tip");
  var outCard = document.getElementById("tol-outcard");
  var canvas = document.getElementById("tol-canvas");
  var dimsEl = document.getElementById("tol-dims");
  var dlLink = document.getElementById("tol-dl");

  /* 版本号：跟着 tools.js 的 ?v= 走，库改动后不会吃一年强缓存 */
  var ver = "";
  try {
    var self0 = document.currentScript;
    var src = self0 ? self0.src : "";
    var m = /[?&]v=([^&]+)/.exec(src);
    if (m) ver = m[1];
  } catch (e) { /* 拿不到就退回无版本 URL */ }

  var state = {
    bitmap: null,      // 当前选中的原图（ImageBitmap）
    name: "image",
    model: "6B",
    busy: false,
    upscaler: null,
    upModel: "",
    outUrl: "",
    inW: 0,
    inH: 0
  };

  function say(text) { if (statusEl) statusEl.textContent = text; }
  function tip(text) {
    if (!tipEl) return;
    tipEl.textContent = text || "";
    tipEl.hidden = !text;
  }
  function progress(pct, show) {
    if (!progWrap) return;
    progWrap.hidden = !show;
    if (show && bar) bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }
  function humanSize(bytes) {
    if (bytes >= 1048576) return (Math.round(bytes / 104857.6) / 10) + " MB";
    return Math.round(bytes / 1024) + " KB";
  }

  /* ── 耗时估算：按上次实测的「每块耗时」换算 ──
     模型是分块算的（6B 每块 256px，Swin2SR 每块 64px），
     所以耗时随「块数」增长而不是随像素线性增长，估时按块数算才准。 */
  function loadSpeed() {
    try { return JSON.parse(localStorage.getItem(SPEED_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveSpeed(model, ms, tiles) {
    if (!tiles || !isFinite(ms) || ms <= 0) return;
    var o = loadSpeed();
    var per = ms / tiles;
    o[model] = o[model] ? Math.round(o[model] * 0.6 + per * 0.4) : Math.round(per);
    try { localStorage.setItem(SPEED_KEY, JSON.stringify(o)); } catch (e) {}
  }
  function tilesFor(model, w, h) {
    var t = TILE[model] || 256;
    return Math.ceil(w / t) * Math.ceil(h / t);
  }
  function cappedSize(model, w, h) {
    var max = MAX_IN[model] || 512;
    var long = Math.max(w, h);
    if (long <= max) return { w: w, h: h };
    var k = max / long;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  function estimateText(model, w, h) {
    var per = loadSpeed()[model];
    if (!per) return "";
    var c = cappedSize(model, w, h);
    var s = Math.round(tilesFor(model, c.w, c.h) * per / 1000);
    if (s < 4) return "，按上次速度几秒就好";
    if (s >= 60) return "，按上次速度大约 " + (Math.round(s / 6) / 10) + " 分钟";
    return "，按上次速度大约 " + s + " 秒";
  }

  function pickModel() {
    var el = root.querySelector('input[name="tol-model"]:checked');
    return el ? el.value : "6B";
  }

  function syncModelUI() {
    var labels = root.querySelectorAll(".tool-model");
    for (var i = 0; i < labels.length; i++) {
      var input = labels[i].querySelector("input");
      labels[i].classList.toggle("is-on", !!(input && input.checked));
    }
    state.model = pickModel();
    if (state.bitmap && !state.busy) {
      say("已选好，点「开始增强」即可" + estimateText(state.model, state.inW, state.inH));
    }
  }

  /* ── 释放 ─────────────────────────────────────────────── */
  function freeBitmap() {
    if (state.bitmap) { try { state.bitmap.close(); } catch (e) {} state.bitmap = null; }
  }
  function freeCanvas() {
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
    if (state.outUrl) { try { URL.revokeObjectURL(state.outUrl); } catch (e) {} state.outUrl = ""; }
    /* 没有 href 比 href="#" 安全：theme.js 会给所有 a[href^="#"] 挂「页内平滑滚动」
       监听并 preventDefault，那会把下载拦掉。这里干脆不写 href，等 blob 好了再挂。 */
    if (dlLink) {
      dlLink.removeAttribute("href");
      dlLink.setAttribute("aria-disabled", "true");
    }
  }
  function destroyUpscaler() {
    var u = state.upscaler;
    state.upscaler = null;
    state.upModel = "";
    if (!u) return Promise.resolve();
    var released;
    try { released = u.release(); } catch (e) { released = Promise.resolve(); }
    return Promise.resolve(released).catch(function () {}).then(function () {
      try { u.terminate(); } catch (e) {}
    });
  }

  /* ── 实例（一次一个，模型变了就重建）────────────────── */
  function getUpscaler(model) {
    if (state.upscaler && state.upModel === model) return Promise.resolve(state.upscaler);
    return destroyUpscaler().then(function () {
      return import(LIB_PATH + (ver ? "?v=" + ver : ""));
    }).then(function (mod) {
      var Upscaler = mod.Upscaler || (mod.default && mod.default.Upscaler);
      if (!Upscaler) throw new Error("放大的库没加载成功");
      state.upscaler = new Upscaler({
        base: BASE,
        model: model,
        workerCount: 1,     // 单 worker
        numThreads: 1,      // 单线程（多线程要 COOP/COEP，本站没开）
        forceUpscale: true
      });
      state.upModel = model;
      return state.upscaler;
    });
  }

  /* ── 选图 ─────────────────────────────────────────────── */
  function accept(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      say("只支持 JPG / PNG / WebP");
      return;
    }
    if (file.size > MAX_FILE_MB * 1048576) {
      say("图片太大（超过 " + MAX_FILE_MB + " MB），请先压缩或裁剪");
      return;
    }
    if (typeof createImageBitmap !== "function") {
      say("这个浏览器不支持本地放大，请换新版 Chrome / Edge / Safari");
      return;
    }
    tip("");
    freeCanvas();
    if (outCard) outCard.hidden = true;
    freeBitmap();
    state.name = (file.name || "image").replace(/\.[^.]+$/, "");

    /* 先按原始尺寸解码一次，只为拿到宽高；真正计算时会再按上限缩放 */
    createImageBitmap(file).then(function (bmp) {
      if (bmp.width > MAX_DECODE || bmp.height > MAX_DECODE) {
        var w = bmp.width, h = bmp.height;
        bmp.close();
        say("图片尺寸 " + w + "×" + h + " 太大，请先缩到长边 " + MAX_DECODE + "px 以内");
        return;
      }
      state.bitmap = bmp;
      state.inW = bmp.width;
      state.inH = bmp.height;
      if (fileInfo) fileInfo.textContent = bmp.width + " × " + bmp.height + " · " + humanSize(file.size);
      if (runBtn) runBtn.disabled = false;
      say("已选好，点「开始增强」即可" + estimateText(pickModel(), bmp.width, bmp.height));
    }).catch(function () {
      say("这张图读不出来，换一张试试");
    });
  }

  /* 长边超上限就先缩，避免 4 倍后画布太大把内存撑爆 */
  function capInput(bmp, maxEdge) {
    var longEdge = Math.max(bmp.width, bmp.height);
    if (longEdge <= maxEdge) return Promise.resolve(bmp);
    var k = maxEdge / longEdge;
    var w = Math.max(1, Math.round(bmp.width * k));
    var h = Math.max(1, Math.round(bmp.height * k));
    return createImageBitmap(bmp, {
      resizeWidth: w, resizeHeight: h, resizeQuality: "high"
    }).then(function (small) {
      tip("为防内存溢出，输入已从 " + bmp.width + "×" + bmp.height + " 缩到 " + w + "×" + h);
      return small;
    });
  }

  /* ── 主流程 ───────────────────────────────────────────── */
  function run() {
    if (state.busy || !state.bitmap) return;
    /* localhost 也算安全上下文，所以这里只拦真正的 http:// 局域网/域名访问 */
    if (!window.isSecureContext) {
      say("这个页面不在 HTTPS 下，浏览器不允许跑 WASM，请在正式站点使用");
      return;
    }
    var model = pickModel();
    state.busy = true;
    if (runBtn) { runBtn.disabled = true; runBtn.classList.add("is-busy"); }
    say("准备中…");
    progress(0, true);
    tip("");

    var capped = null;
    var out = null;
    var tStart = 0;

    Promise.resolve()
      .then(function () {
        return capInput(state.bitmap, MAX_IN[model]);
      })
      .then(function (input) {
        capped = input;
        say(model === "6B"
          ? "正在计算…（首次要先下载运行环境与模型，约 18 MB）"
          : "正在计算…（首次要先下载运行环境与模型，约 21 MB）");
        return getUpscaler(model);
      })
      .then(function (up) {
        tStart = Date.now();
        return up.upscale(capped, {
          onProgress: function (pct) {
            var p = Math.round(pct || 0);
            progress(p, true);
            say("正在计算… " + p + "%");
          }
        });
      })
      .then(function (result) {
        out = result;
        if (tStart) saveSpeed(model, Date.now() - tStart, tilesFor(model, capped.width, capped.height));
        draw(result);
        var from = (capped === state.bitmap) ? (state.inW + " × " + state.inH) : (capped.width + " × " + capped.height);
        if (dimsEl) {
          dimsEl.textContent = from + " → " + result.width + " × " + result.height +
            "（" + FACTOR[model] + " 倍" + (capped === state.bitmap ? "" : "，已先缩输入") + "）";
        }
        progress(100, true);
        /* 完成后的话术由 draw() 的打包回调负责（「正在打包图片…」→「完成，可以保存了」），
           这里不再写，否则会把「正在打包」覆盖成「完成」，用户点下去还是空链接。 */
        state.busy = false;
        if (runBtn) { runBtn.disabled = false; runBtn.classList.remove("is-busy"); }
        /* 结果已画进 canvas，位图立刻还给浏览器 */
        try { if (out) out.close(); } catch (e) {}
        out = null;
        if (capped && capped !== state.bitmap) { try { capped.close(); } catch (e) {} }
        capped = null;
        return destroyUpscaler();     // 算完就销毁，别让 wasm 堆常驻
      })
      .catch(function (err) {
        say("失败了：" + ((err && err.message) || String(err)));
        progress(0, false);
        state.busy = false;
        if (runBtn) { runBtn.disabled = !state.bitmap; runBtn.classList.remove("is-busy"); }
        try { if (out) out.close(); } catch (e) {}
        if (capped && capped !== state.bitmap) { try { capped.close(); } catch (e) {} }
        capped = null;
        return destroyUpscaler();
      });
  }

  function draw(bitmap) {
    if (!canvas) return;
    freeCanvas();
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画布不可用");
    ctx.drawImage(bitmap, 0, 0);
    if (outCard) outCard.hidden = false;
    /* 打包状态要如实说：canvastoBlob 是异步的，大图要一两秒。
       以前这里先写「完成，可以保存了」再异步转码，用户在这段时间点保存只会跳回页首。 */
    if (dlLink) {
      dlLink.setAttribute("download", state.name + "-upscaled.png");
      say("正在打包图片…");
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (!blob) { say("打包失败，换一张图再试"); return; }
          state.outUrl = URL.createObjectURL(blob);
          dlLink.setAttribute("href", state.outUrl);
          dlLink.setAttribute("aria-disabled", "false");
          say("完成，可以保存了");
        }, "image/png");
      } else {
        /* 极老的浏览器没有 toBlob，退回同步 toDataURL（会卡一下，但至少点得动） */
        try {
          dlLink.setAttribute("href", canvas.toDataURL("image/png"));
          dlLink.setAttribute("aria-disabled", "false");
          say("完成，可以保存了");
        } catch (e) { say("打包失败，换一张图再试"); }
      }
    } else {
      say("完成，可以保存了");
    }
    try {
      canvas.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch (e) {}
  }

  /* ── 事件 ─────────────────────────────────────────────── */
  function openPicker() { if (fileInput) fileInput.click(); }

  if (drop) {
    drop.addEventListener("click", openPicker);
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
    });
    ["dragenter", "dragover"].forEach(function (t) {
      drop.addEventListener(t, function (e) {
        e.preventDefault();
        drop.classList.add("is-over");
      });
    });
    ["dragleave", "dragend"].forEach(function (t) {
      drop.addEventListener(t, function () { drop.classList.remove("is-over"); });
    });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      drop.classList.remove("is-over");
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) accept(dt.files[0]);
    });
  }
  if (fileInput) {
    fileInput.addEventListener("change", function () {
      accept(fileInput.files && fileInput.files[0]);
      fileInput.value = "";             // 允许重复选同一张
    });
  }

  var radios = root.querySelectorAll('input[name="tol-model"]');
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener("change", syncModelUI);
  }

  if (runBtn) runBtn.addEventListener("click", run);

  /* 离开页面把 worker 与画布一起收掉 */
  window.addEventListener("pagehide", function () {
    freeCanvas();
    freeBitmap();
    destroyUpscaler();
  });

  syncModelUI();

  /* 供探针读取状态（不参与业务逻辑） */
  window.__toolState = function () {
    return {
      model: pickModel(),
      busy: state.busy,
      hasImage: !!state.bitmap,
      inW: state.inW,
      inH: state.inH,
      outW: canvas ? canvas.width : 0,
      outH: canvas ? canvas.height : 0,
      upscaler: !!state.upscaler,
      status: statusEl ? statusEl.textContent : "",
      tip: tipEl ? tipEl.textContent : ""
    };
  };
})();
