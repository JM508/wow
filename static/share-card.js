/* ══════════════════════════════════════════════════════════════
   战绩分享卡（2026-10-22）
   ──────────────────────────────────────────────────────────────
   跑酷 / 扫雷 / 贪吃蛇的结算卡上加「分享战绩」：用 canvas 画一张
   背景图 + 分数 + 站点二维码的海报，navigator.share 一键分享；
   不支持带图分享的环境（多数桌面浏览器）降级为下载 PNG。
   · 各游戏只在结算时往按钮上写 data-share-payload（JSON 字符串）：
       { t: 标题, sub: 副标题, big: 主数据, lines: [明细…], url: 可选 }
   · 本脚本统一代理 [data-share-card] 的点击：生成 → 分享 / 下载
   · 二维码用 vendored 的 qrcode-generator（MIT，见文件头），
     无运行时外链依赖，离线也能生成
   · 背景图复用年龄门的 /images/bg/ 系列（读 AgeGate.config，缺省也照画）
   · 纯外链脚本、无内联代码（CSP 同源白名单）
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var SITE = "Wow 娱乐小站";

  function loadImg(src) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }

  function bgCfg() {
    var c = (global.AgeGate && global.AgeGate.config) || {};
    return {
      count: c.bgCount || 0,
      folder: c.bgFolder || "/images/bg/bg",
      ext: c.bgExt || ".jpg",
      ver: c.bgVer || 0
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function makeQr(url) {
    try {
      var qr = global.qrcode(0, "M");
      qr.addData(url);
      qr.make();
      return qr;
    } catch (e) { return null; }
  }

  /* 画海报：900x1200，背景 cover + 压暗渐变，上部文字、下部二维码 */
  function drawCard(p) {
    var W = 900, H = 1200;
    var canvas = document.createElement("canvas");
    if (!canvas.getContext) return Promise.reject(new Error("no-canvas"));
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");
    var cfg = bgCfg();
    var idx = cfg.count ? Math.floor(Math.random() * cfg.count) : -1;
    var src = idx >= 0 ? cfg.folder + (idx + 1) + cfg.ext + (cfg.ver ? "?v=" + cfg.ver : "") : "";
    return loadImg(src).then(function (img) {
      if (img) {
        var s = Math.max(W / img.width, H / img.height);
        var dw = img.width * s, dh = img.height * s;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      } else {
        var bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, "#2a3f55");
        bg.addColorStop(1, "#141d29");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
      }
      /* 压暗渐变：上半段轻、下半段重（底部要放二维码和文字） */
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(0,0,0,0.40)");
      g.addColorStop(0.55, "rgba(0,0,0,0.58)");
      g.addColorStop(1, "rgba(0,0,0,0.82)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      /* 顶栏：站名 */
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.font = "600 30px sans-serif";
      ctx.fillText(SITE, 56, 88);

      /* 标题（游戏 · 难度）+ 副标题 */
      var y = 220;
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 72px sans-serif";
      ctx.fillText(String(p.t || ""), 56, y);
      if (p.sub) {
        y += 56;
        ctx.fillStyle = "rgba(255,255,255,0.82)";
        ctx.font = "500 38px sans-serif";
        ctx.fillText(String(p.sub), 56, y);
      }
      /* 主数据（本局分数 / 通关用时） */
      y += 150;
      ctx.fillStyle = "#ffd166";
      ctx.font = "800 130px sans-serif";
      ctx.fillText(String(p.big || ""), 56, y);
      /* 明细行 */
      y += 84;
      ctx.fillStyle = "rgba(255,255,255,0.94)";
      ctx.font = "500 40px sans-serif";
      var lines = (p.lines || []).slice(0, 5);
      for (var i = 0; i < lines.length; i++) {
        y += 62;
        ctx.fillText(String(lines[i]), 56, y);
      }

      /* 底部：左边站点网址文案，右边二维码（白底圆角） */
      var url = String(p.url || "");
      var QS = 216, QPAD = 14;
      var qx = W - QS - 56, qy = H - QS - 64;
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, qx, qy, QS, QS, 18);
      ctx.fill();
      var qr = makeQr(url);
      if (qr) {
        var n = qr.getModuleCount();
        var cell = (QS - QPAD * 2) / n;
        ctx.fillStyle = "#111111";
        for (var r = 0; r < n; r++) {
          for (var c = 0; c < n; c++) {
            if (qr.isDark(r, c)) {
              ctx.fillRect(qx + QPAD + c * cell, qy + QPAD + r * cell, cell + 0.5, cell + 0.5);
            }
          }
        }
      }
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "600 34px sans-serif";
      ctx.fillText("扫码来挑战", 56, qy + 74);
      ctx.fillStyle = "rgba(255,255,255,0.66)";
      ctx.font = "400 26px sans-serif";
      ctx.fillText(url.replace(/^https?:\/\//, ""), 56, qy + 122);

      return canvas;
    });
  }

  function saveBlob(blob, name) {
    try {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.parentNode.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      return "saved";
    } catch (e) { return "failed"; }
  }

  function share(p) {
    return drawCard(p).then(function (canvas) {
      return new Promise(function (res) {
        if (canvas.toBlob) canvas.toBlob(function (b) { res(b); }, "image/png");
        else res(null);
      });
    }).then(function (blob) {
      if (!blob) return "failed";
      var file = null;
      try { file = new File([blob], "wow-score.png", { type: "image/png" }); } catch (e) { file = null; }
      var nav = global.navigator;
      if (file && nav && nav.canShare && nav.share &&
          nav.canShare({ files: [file] })) {
        return nav.share({
          files: [file],
          title: String(p.t || SITE),
          text: (p.lines || []).join(" ")
        }).then(function () { return "shared"; }).catch(function (err) {
          if (err && err.name === "AbortError") return "cancelled";  // 用户关掉了分享面板
          return saveBlob(blob, "wow-score.png");
        });
      }
      return saveBlob(blob, "wow-score.png");
    });
  }

  /* 统一代理：任何带 data-share-card 的按钮被点，就从 data-share-payload 取数据 */
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-share-card]") : null;
    if (!b) return;
    e.preventDefault();
    var p = null;
    try { p = JSON.parse(b.getAttribute("data-share-payload") || "null"); } catch (err) { p = null; }
    if (!p || !p.t) return;
    p.url = p.url || (global.location && global.location.origin ? global.location.origin + "/" : "");
    var old = b.textContent;
    b.disabled = true;
    b.textContent = "生成中…";
    share(p).then(function (how) {
      b.disabled = false;
      if (how === "shared") b.textContent = "已分享";
      else if (how === "saved") b.textContent = "已保存图片";
      else if (how === "cancelled") b.textContent = old;
      else b.textContent = "没能分享，再试一次";
      setTimeout(function () { b.textContent = old; }, 2600);
    })["catch"](function () {
      /* 画卡 / 取 blob / toBlob 任一环节抛错都要把按钮放开，
         否则 disabled 与「生成中…」永久卡住（2026-10-23 修）。 */
      b.disabled = false;
      b.textContent = "没能分享，再试一次";
      setTimeout(function () { b.textContent = old; }, 2600);
    });
  });

  global.ShareCard = { share: share, drawCard: drawCard };
})(window);
