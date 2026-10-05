/* ══════════════════════════════════════════════════════════════
   皮肤商店 —— 用《火柴人快跑》里收集的金币兑换火柴人皮肤 / 金币皮肤
   ──────────────────────────────────────────────────────────────
   · 商店挂在跑酷页面里，以弹层形式打开（点游戏里的「商店」）
   · 商品数据与绘制全部来自 static/skins.js（与游戏共用同一份），
     所以预览里看到的就是游戏里跑出来的样子
   · 预览用 canvas 实时渲染，跟着明暗主题自动换线条配色；
     弹层关着的时候不跑渲染循环，不白烧 CPU
   · 外链脚本、无内联代码（CSP 同源白名单）
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var Skins = window.RunnerSkins;
  var root = document.getElementById("shop-root");
  if (!root || !Skins) return;

  /* 弹层外壳：页面里用 data-shop-panel 标记。
     没有外壳时（直接嵌在正文里）当作常显区块。 */
  var panel = root.closest ? root.closest("[data-shop-panel]") : null;

  var elWalletNum = null, elHint = null, gridPlayers = null, gridCoins = null;
  var previews = [];                       // { canvas, ctx, kind, item, ph }
  var hintTimer = null;
  var built = false;
  var rafId = 0;

  var HINT_DEFAULT = "";   /* 默认不显示说明文字（elHint 保留用于「金币不足」等提示） */

  /* ── 小工具：建元素 ── */
  function mk(tag, cls, parent, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  /* ── 主题：本站默认暗色，只有明确切成浅色才用深色线条 ── */
  function isNight() {
    return document.documentElement.getAttribute("data-theme") !== "light";
  }

  function fire(name) {
    try {
      document.dispatchEvent(new CustomEvent(name));
    } catch (e) {
      try {
        var ev = document.createEvent("Event");
        ev.initEvent(name, false, false);
        document.dispatchEvent(ev);
      } catch (e2) {}
    }
  }

  /* ── 提示条 ── */
  function say(msg, warn) {
    if (!elHint) return;
    elHint.textContent = msg;
    elHint.classList.toggle("shop-warn", !!warn);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      elHint.textContent = HINT_DEFAULT;
      elHint.classList.remove("shop-warn");
    }, 3600);
  }

  /* ══════════ 搭骨架（第一次打开商店时才建，页面初始加载更轻） ══════════ */
  function buildUI() {
    var bar = mk("div", "shop-wallet", root);
    var left = mk("div", "shop-wallet-left", bar);
    mk("span", "shop-wallet-label", left, "钱包余额");
    var strong = mk("strong", "shop-wallet-num", left);
    elWalletNum = mk("span", null, strong, "0");
    elWalletNum.id = "shop-coins";
    strong.appendChild(document.createTextNode(" 💰"));

    if (panel) {                                   // 弹层里给一个「关掉继续玩」的出口
      var back = mk("button", "shop-go", bar, "继续奔跑");
      back.type = "button";
      back.id = "shop-close";
      back.addEventListener("click", function () { close(); });
    } else {                                       // 独立商店页：给个去游戏的入口
      var go = mk("a", "shop-go", bar, "🏃 去赚金币");
      go.href = "/runner/";
    }

    elHint = mk("p", "shop-hint", root, HINT_DEFAULT);
    elHint.id = "shop-hint";

    var sec1 = mk("section", "shop-sec", root);
    mk("h2", "shop-sec-title", sec1, "火柴人皮肤");
    gridPlayers = mk("div", "shop-grid", sec1);
    gridPlayers.id = "shop-players";

    var sec2 = mk("section", "shop-sec", root);
    mk("h2", "shop-sec-title", sec2, "金币皮肤");
    gridCoins = mk("div", "shop-grid", sec2);
    gridCoins.id = "shop-coins-grid";

    mk("p", "shop-foot", root,
      "皮肤与金币余额保存在本机浏览器；登录账号后自动同步到云端，换设备也不会丢。清除浏览数据会清掉本地记录。");
  }

  /* ── 生成一张商品卡 ── */
  function buildCard(kind, item) {
    var card = document.createElement("article");
    card.className = "shop-card";
    card.dataset.id = item.id;
    card.dataset.kind = kind;

    var prev = document.createElement("div");
    prev.className = "shop-prev";
    var cv = document.createElement("canvas");
    cv.width = 300;                        // 内部 2 倍尺寸，高清屏不糊
    cv.height = 260;
    cv.className = "shop-canvas";
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", item.name + " 预览");
    prev.appendChild(cv);

    var info = document.createElement("div");
    info.className = "shop-info";
    var name = document.createElement("h3");
    name.className = "shop-name";
    name.appendChild(document.createTextNode(item.name));
    if (item.tag) {
      var tag = document.createElement("span");
      tag.className = "shop-tag";
      tag.textContent = item.tag;
      name.appendChild(tag);
    }
    var desc = document.createElement("p");
    desc.className = "shop-desc";
    desc.textContent = item.desc;
    info.appendChild(name);
    info.appendChild(desc);

    var act = document.createElement("div");
    act.className = "shop-act";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "shop-btn";
    act.appendChild(btn);

    card.appendChild(prev);
    card.appendChild(info);
    card.appendChild(act);

    previews.push({
      canvas: cv, ctx: cv.getContext("2d"), kind: kind, item: item,
      ph: previews.length * 0.7
    });
    return card;
  }

  function renderAll() {
    var i;
    /* 商店排序规则（用户定下的固定规则）：限定沉底，其余按价格升序。
       即普通/史诗皮肤在前（便宜在前），限定皮肤永远排在最后（限定内部仍按价格）。
       排序副本渲染，不改 Skins 内部定义顺序。 */
    function shopRank(item) {
      return item.tag === "限定" ? 1 : 0;
    }
    function byShopOrder(list) {
      return [].slice.call(list).sort(function (a, b) {
        var r = shopRank(a) - shopRank(b);
        return r !== 0 ? r : a.price - b.price;
      });
    }
    var players = byShopOrder(Skins.PLAYERS);
    var coins = byShopOrder(Skins.COINS);
    for (i = 0; i < players.length; i++) {
      gridPlayers.appendChild(buildCard("player", players[i]));
    }
    for (i = 0; i < coins.length; i++) {
      gridCoins.appendChild(buildCard("coin", coins[i]));
    }
  }

  function ensureBuilt() {
    if (built) return;
    built = true;
    buildUI();
    renderAll();
    paint();
  }

  /* ── 刷新余额与每张卡的按钮状态 ── */
  function paint() {
    var wallet = Skins.getWallet();
    if (elWalletNum) elWalletNum.textContent = String(wallet);

    var cards = root.querySelectorAll(".shop-card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var kind = card.dataset.kind, id = card.dataset.id;
      var def = Skins.get(kind, id);
      var owned = Skins.isOwned(kind, id);
      var using = Skins.equipped(kind) === id;
      var btn = card.querySelector(".shop-btn");
      if (!btn) continue;

      btn.disabled = false;
      btn.classList.remove("is-own", "is-on", "is-poor");
      card.classList.toggle("is-using", using);

      if (using) {
        btn.textContent = "✓ 使用中";
        btn.classList.add("is-on");
        btn.disabled = true;
      } else if (owned) {
        btn.textContent = "装备";
        btn.classList.add("is-own");
      } else {
        btn.textContent = "💰 " + def.price;
        if (wallet < def.price) btn.classList.add("is-poor");
      }
    }
  }

  /* ── 点击：购买 / 装备 ── */
  root.addEventListener("click", function (e) {
    var node = e.target;
    while (node && node !== root && !(node.className && String(node.className).indexOf("shop-btn") >= 0)) {
      node = node.parentNode;
    }
    if (!node || node === root || node.disabled) return;

    var card = node.parentNode;
    while (card && card !== root && !card.dataset.kind) card = card.parentNode;
    if (!card || card === root) return;

    var kind = card.dataset.kind, id = card.dataset.id;
    var def = Skins.get(kind, id);
    if (!def) return;

    if (Skins.isOwned(kind, id)) {
      if (Skins.equip(kind, id)) say("已换上「" + def.name + "」，回游戏就能看到。");
    } else {
      var r = Skins.buy(kind, id);
      if (r.ok) {
        say("🎉 买下了「" + def.name + "」并自动换上，钱包还剩 " + r.left + " 💰。");
      } else if (r.reason === "poor") {
        say("金币不够，还差 " + r.need + " 枚 —— 再去跑几局吧！", true);
      }
    }
    paint();
    fire("shop:change");                   // 游戏那边好同步 HUD 与装备
  });

  /* ── 预览渲染循环（小画布，开销可以忽略；关掉弹层就停） ── */
  var T0 = (window.performance && performance.now) ? performance.now() : Date.now();

  function drawPreview(p, t) {
    var g = p.ctx, W = p.canvas.width, H = p.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    var night = isNight();

    if (p.kind === "player") {
      g.save();
      /* 立绘皮肤（限定款）比火柴人高：78 × 3.1 ≈ 242，画布才 260，
         沿用火柴人的脚底基线会头顶顶出上沿、脚下空一大截（底部空隙 40 vs 其他卡 22~26），
         看起来「展示太靠上」。限定款按画布高度微收缩放（顶留 12 / 底留 24），
         基线也随之下沉；普通火柴人维持原样不动。 */
      var scale = 3.1, baseY = H - 34;
      if (p.item.sprite) {
        scale = Math.min(scale, (H - 36) / (p.item.runH || 66));
        baseY = H - 24;
      }
      g.translate(W / 2, baseY);                  // 脚底
      Skins.drawStick(g, p.item, {
        pose: "run", t: t, run: t * 8.5, night: night, scale: scale
      });
      g.restore();
    } else {
      Skins.drawCoin(g, p.item, {
        x: W / 2, y: H / 2, t: t, ph: p.ph, scale: 4.2
      });
    }
  }

  function loop(now) {
    var ms = (now === undefined ? Date.now() : now) - T0;
    var t = ms / 1000;
    for (var i = 0; i < previews.length; i++) drawPreview(previews[i], t);
    rafId = window.requestAnimationFrame ? window.requestAnimationFrame(loop) : 0;
  }

  function startLoop() {
    if (rafId || !built) return;
    if (window.requestAnimationFrame) rafId = window.requestAnimationFrame(loop);
    else loop();
  }
  function stopLoop() {
    if (rafId && window.cancelAnimationFrame) window.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ══════════ 弹层开关 ══════════ */
  function isOpen() {
    return !panel || !panel.classList.contains("hidden");
  }
  function open() {
    if (panel) panel.classList.remove("hidden");
    ensureBuilt();
    paint();
    startLoop();
    fire("shop:open");
  }
  function close() {
    if (!isOpen()) return;
    if (panel) panel.classList.add("hidden");
    stopLoop();
    fire("shop:close");
  }

  /* ── 调试入口：?grant=2000 直接给钱包加金币（方便一次看完所有皮肤） ── */
  var m = /[?&]grant=(\d+)/.exec(location.search);
  if (m) {
    Skins.addWallet(parseInt(m[1], 10) || 0);
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
  }

  /* 页面里直接嵌着（没有弹层）时立即渲染；否则等 open() */
  if (isOpen()) {
    ensureBuilt();
    startLoop();
  }

  /* 调试 / 自动化测试接口 */
  window.Shop = {
    open: open,
    close: close,
    toggle: function () { isOpen() ? close() : open(); },
    isOpen: isOpen,
    refresh: function () { ensureBuilt(); paint(); },
    grant: function (n) { Skins.addWallet(n); ensureBuilt(); paint(); return Skins.getWallet(); },
    wallet: function () { return Skins.getWallet(); },
    isNight: isNight,
    cards: function () {
      return [].slice.call(root.querySelectorAll(".shop-card")).map(function (c) {
        var b = c.querySelector(".shop-btn");
        return {
          kind: c.dataset.kind, id: c.dataset.id,
          label: b ? b.textContent : "",
          disabled: b ? b.disabled : false
        };
      });
    },
    stop: stopLoop
  };
})();
