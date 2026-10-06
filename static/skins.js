/* ══════════════════════════════════════════════════════════════
   火柴人快跑 · 皮肤仓库 + 钱包（游戏页 / 商店页共用）
   ──────────────────────────────────────────────────────────────
   · 纯外链脚本、无内联代码（全站 CSP 为同源白名单，禁 unsafe-inline）
   · 数据 / 存储 / 绘制三合一：游戏与商店调用的是同一套绘制函数，
     商店预览里看到的样子，就是游戏里跑起来的样子
   · 对外暴露 window.RunnerSkins
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  /* ═══════════ 本地存储键 ═══════════ */
  var KEY_WALLET = "runner-coins";    // 金币余额（跑酷专属）
  var KEY_OWNED  = "runner-owned";    // 已购皮肤 id 列表（JSON 数组）
  var KEY_SKIN   = "runner-skin";     // 当前装备的火柴人皮肤 id
  var KEY_COIN   = "runner-coin";     // 当前装备的金币皮肤 id
  var KEY_FLAG   = "runner-flag";     // 当前装备的旗子皮肤 id（扫雷插旗颜色）
  var KEY_MINE   = "ms-mine";         // 当前装备的雷皮肤 id（扫雷，2026-10-06）
  var KEY_SNAKE  = "snake-skin";      // 当前装备的蛇皮肤 id（贪吃蛇，2026-10-06）

  /* ── 游戏作用域 ──
     同一份 skins.js 服务四个游戏页：跑酷（火柴人/金币皮肤，有钱包）、
     扫雷（旗子/雷皮肤）、贪吃蛇（蛇皮肤）、井字棋（无皮肤）。
     每个游戏页都有自己的根元素 id，据此判断当前是哪个游戏 ——
     商店只展示本游戏的皮肤（用户 2026-10-06 要求），存档键也互不干扰。 */
  var SCOPE = (function () {
    var map = { "run-root": "runner", "ms-root": "ms", "snake-root": "snake", "ttt-root": "ttt" };
    for (var id in map) {
      if (Object.prototype.hasOwnProperty.call(map, id) && document.getElementById(id)) return map[id];
    }
    return "runner";                 // 独立站等识别不了的场景按跑酷处理
  })();

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) {}
  }

  /* ═══════════════ 火柴人皮肤 ═══════════════
     ink / inkNight : 线条主色（夜间需换浅色，否则深色背景看不清）
     scarf          : 围巾色
     glow           : 线条外发光（可选）
     headFill       : 头部填充色（默认肤色）
     eye            : 眼睛颜色
     deco / decoColor : 头顶装饰（helmet 头盔 / band 头带 / petal 花 / horn 焰角 / antenna 天线）
     alpha          : 整体不透明度（幽灵用）
  */
  var PLAYERS = [
    {
      id: "classic", name: "经典火柴人", price: 0, tag: "默认",
      desc: "最初的那根线条，配一条红围巾。",
      ink: "#28324a", inkNight: "#f2f5fa", scarf: "#ff5f6d", eye: "#28324a"
    },
    {
      id: "neon", name: "霓虹赛博", price: 120, tag: "发光",
      desc: "青蓝色霓虹管线，跑起来带电子残光。",
      ink: "#17b8c9", inkNight: "#62f4ff", scarf: "#b14bff", eye: "#86ffff",
      glow: "#2ff3ff", headFill: "#0f3540", headFillNight: "#12414d"
    },
    {
      id: "gold", name: "黄金骑士", price: 260, tag: "发光",
      desc: "金色铠甲线条，头顶尖盔，走路带金光。",
      ink: "#d9a017", inkNight: "#ffd34d", scarf: "#ff7a1a", eye: "#7a5200",
      glow: "#ffb300", headFill: "#fff0c2", deco: "helmet", decoColor: "#e8a90a"
    },
    {
      id: "shadow", name: "暗影忍者", price: 420, tag: "头带",
      desc: "深紫线条配红头带，飘带在身后甩。",
      ink: "#5b46b8", inkNight: "#b9a6ff", scarf: "#241a45", eye: "#ff3b6b",
      glow: "#7b5cff", headFill: "#2a2145", headFillNight: "#332a52",
      deco: "band", decoColor: "#ff3b6b"
    },
    {
      id: "sakura", name: "樱花少女", price: 600, tag: "花朵",
      desc: "粉樱配色，头顶开着一朵小花。",
      ink: "#f278b0", inkNight: "#ffa8d2", scarf: "#ffd0e6", eye: "#8a3b5f",
      headFill: "#ffe8d8", deco: "petal", decoColor: "#ff8fc0"
    },
    {
      id: "ghost", name: "幽灵", price: 800, tag: "半透明",
      desc: "淡蓝半透明的身子，飘忽忽地往前跑。",
      ink: "#cfe6ff", inkNight: "#eaf6ff", scarf: "#b8d4ff", eye: "#4a6fa5",
      glow: "#8ab4ff", headFill: "#e6f1ff", headFillNight: "#eaf6ff", alpha: 0.72
    },
    {
      id: "flame", name: "烈焰", price: 1100, tag: "焰角",
      desc: "烧红的线条，头顶两簇不灭的火。",
      ink: "#ff5a2b", inkNight: "#ffb35c", scarf: "#ffd166", eye: "#8a2b00",
      glow: "#ff7a1a", headFill: "#ffe0c2", deco: "horn", decoColor: "#ff9d2b"
    },
    {
      id: "robot", name: "机械体", price: 1400, tag: "天线",
      desc: "合金灰外壳，一根闪灯天线，围巾换成数据线。",
      ink: "#93a1b5", inkNight: "#cfe0f5", scarf: "#2fe0a0", eye: "#2fe0a0",
      headFill: "#cfd8e4", headFillNight: "#dbe6f5", deco: "antenna", decoColor: "#2fe0a0"
    },
    {
      id: "seia", name: "圣娅", price: 2888, tag: "限定",
      desc: "来自碧蓝档案的百合园圣娅",
      sprite: { run: "seia-runner", duck: "seia-duck" },
      runH: 78, duckH: 34
    },
    {
      id: "zxf", name: "张雪峰", price: 1888, tag: "限定",
      desc: "白衬衫加眼镜，一手话筒一手规划，冲就完事了。",
      sprite: { run: "zhang-runner", duck: "zhang-duck" },
      runH: 78, duckH: 34
    }
  ];

  /* ── 素材基址：脚本所在目录 + img/ ──
     主站（wow）脚本挂在站点根（/skins.js → /img/），独立站挂在子路径
     （/stick-runner/skins.js → /stick-runner/img/）。
     以前写死 "/img/" 绝对路径，独立站的贴图全部 404（GitHub Pages 项目站
     带 /stick-runner/ 子路径，根路径下没有图）。这里从脚本自己的 URL 推
     目录，两种布局都不用手工配置，也不用改 HTML。 */
  var IMG_BASE = (function () {
    var s = document.currentScript;
    if (!s || !s.src) {                        // 动态注入等拿不到 currentScript 时按名字兜底
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        var src = all[i].getAttribute("src") || "";
        if (/(^|\/)(runner|skins)\.js(\?|#|$)/.test(src)) { s = all[i]; break; }
      }
    }
    var href = (s && s.src) || "";
    if (!href) return "img/";                  // 实在推不出：退化成相对页面的 img/
    return href.replace(/[?#][\s\S]*$/, "").replace(/[^/]*$/, "") + "img/";
  })();

  /* ── 立绘皮肤素材：按需 new Image 预加载，未就绪时回退经典火柴人 ── */
  var SPRITES = {};
  function spriteImg(key) {
    if (!(key in SPRITES)) {
      var im = null;
      try { im = new Image(); im.src = IMG_BASE + key + ".webp"; } catch (e) { im = null; }
      SPRITES[key] = im;
    }
    return SPRITES[key];
  }
  function imgOk(im) { return !!im && im.complete && im.naturalWidth > 0; }

  /* ── 立绘全量预加载 ──
     以前是「画到哪张才加载哪张」：跑动用 run 图，第一次下蹲才请求 duck 图，
     图片还没下载完的那几秒里 imgOk() 为 false，只能回退经典火柴人——
     表现为「一蹲下就变经典火柴人，起身又变回皮肤」。
     现在脚本加载时就把所有立绘皮肤（跑 + 蹲）一起请求，
     立绘总共只有几张小 webp，一次性预载没有负担。 */
  (function preloadAll() {
    for (var i = 0; i < PLAYERS.length; i++) {
      var sp = PLAYERS[i].sprite;
      if (!sp) continue;
      if (sp.run) spriteImg(typeof sp.run === "object" ? sp.run.sheet : sp.run);
      if (sp.duck) spriteImg(typeof sp.duck === "object" ? sp.duck.sheet : sp.duck);
    }
  })();

  /* ═══════════════ 金币皮肤 ═══════════════
     shape : coin 硬币 / gem 宝石 / star 星 / heart 心 / ring 甜甜圈
     dark  : 外圈（暗部）   face : 主体   hi : 高光
     halo  : 光晕颜色       rainbow : 色相随时间循环（覆盖上面三色）
  */
  var COINS = [
    {
      id: "gold", name: "经典金币", price: 0, tag: "默认", shape: "coin",
      desc: "会翻转的老式金币，一蹦一跳。",
      dark: "#d99a1c", face: "#f7c33d", hi: "#ffe9a8",
      halo: "rgba(255,209,102,0.22)", spark: "#ffd166"
    },
    {
      id: "silver", name: "白银币", price: 180, tag: "银", shape: "coin",
      desc: "冷色调的银币，低调但不便宜。",
      dark: "#8d99ac", face: "#dfe7f1", hi: "#ffffff",
      halo: "rgba(190,208,232,0.24)", spark: "#dbe6f5"
    },
    {
      id: "gem", name: "蓝宝石", price: 380, tag: "宝石", shape: "gem",
      desc: "切割成菱形的宝石，会微微摇晃。",
      dark: "#1f5fd0", face: "#4f9bff", hi: "#cfe6ff",
      halo: "rgba(90,155,255,0.24)", spark: "#8ec7ff"
    },
    {
      id: "star", name: "幸运星", price: 620, tag: "自转", shape: "star",
      desc: "五角星一直转，闪得人眼花。",
      dark: "#e0a017", face: "#ffd54a", hi: "#fff3c4",
      halo: "rgba(255,213,74,0.22)", spark: "#ffe082"
    },
    {
      id: "rainbow", name: "彩虹币", price: 880, tag: "变色", shape: "coin",
      desc: "颜色一刻不停地流转，永远不会看腻。",
      dark: "#d99a1c", face: "#f7c33d", hi: "#ffe9a8", rainbow: true,
      halo: "rgba(255,255,255,0.22)", spark: "#ffffff"
    },
    {
      id: "heart", name: "爱心币", price: 1150, tag: "心跳", shape: "heart",
      desc: "会跳动的心形币，红得明目张胆。",
      dark: "#c2185b", face: "#ff5f8f", hi: "#ffd0e0",
      halo: "rgba(255,95,143,0.22)", spark: "#ff9ec4"
    },
    {
      id: "donut", name: "甜甜圈", price: 1400, tag: "彩针", shape: "ring",
      desc: "撒了彩色糖针的甜甜圈，边跑边转。",
      dark: "#b5651d", face: "#e8a45c", hi: "#fff1de",
      halo: "rgba(255,220,180,0.24)", spark: "#ffd7b0"
    }
  ];

  /* ═══════════════ 旗子皮肤（扫雷插旗颜色，全部免费，2026-10-06） ═══════════════
     color : 旗面主色（扫雷格子里的旗与失败弹窗里的旗都用它渲染）
     用户在皮肤页选哪面旗，扫雷里的旗子就变成什么颜色 —— 这就是「可改颜色」的实现方式 */
  var FLAGS = [
    {
      id: "red", name: "经典红旗", price: 0, tag: "默认", color: "#ff4d4f",
      desc: "扫雷插旗的经典红色，一眼就认得。"
    },
    {
      id: "blue", name: "晴空蓝旗", price: 0, tag: "免费", color: "#3b82f6",
      desc: "像晴天一样的蓝色旗面。"
    },
    {
      id: "green", name: "草原绿旗", price: 0, tag: "免费", color: "#22c55e",
      desc: "清新的绿色，插在雷区里不扎眼。"
    },
    {
      id: "amber", name: "琥珀黄旗", price: 0, tag: "免费", color: "#f59e0b",
      desc: "醒目的琥珀黄，远处也能看见。"
    },
    {
      id: "purple", name: "葡萄紫旗", price: 0, tag: "免费", color: "#a855f7",
      desc: "稳重的紫色，适合低调的扫雷手。"
    },
    {
      id: "cyan", name: "薄荷青旗", price: 0, tag: "免费", color: "#06b6d4",
      desc: "清凉的薄荷青，夏天的颜色。"
    }
  ];

  /* ═══════════════ 雷皮肤（扫雷专属，2026-10-06，全部免费） ═══════════════
     踩雷时炸出来的地雷长相：body 主体 / spike 引线与尖刺 / shine 高光。
     扫雷页没有钱包，商店里按「装备」直接换。 */
  var MINES = [
    {
      id: "classic", name: "经典铁雷", price: 0, tag: "默认",
      desc: "黑铁色的老式地雷，八根引线一根不少。",
      body: "#3a3f4a", spike: "#3a3f4a", shine: "#8d95a5"
    },
    {
      id: "ink", name: "墨玉雷", price: 0, tag: "免费",
      desc: "深墨色的圆雷，哑光不反光，低调得很。",
      body: "#232733", spike: "#232733", shine: "#59637d"
    },
    {
      id: "cherry", name: "樱桃雷", price: 0, tag: "免费",
      desc: "红得像颗大樱桃，脾气却一点就炸。",
      body: "#c2334d", spike: "#9c2740", shine: "#ff96a8"
    },
    {
      id: "ocean", name: "深海雷", price: 0, tag: "免费",
      desc: "深蓝雷体配浅蓝高光，像沉在海底的水雷。",
      body: "#1e5f8a", spike: "#174a6e", shine: "#84c7ee"
    },
    {
      id: "toxic", name: "荧光雷", price: 0, tag: "发光",
      desc: "带一点荧光绿的辐射感，晚上特别显眼。",
      body: "#4c8a1f", spike: "#3d6e18", shine: "#c2f489"
    },
    {
      id: "gold", name: "黄金雷", price: 0, tag: "发光",
      desc: "纯金铸造的雷，炸之前先闪一道光。",
      body: "#c9992a", spike: "#a97f1c", shine: "#ffe08a"
    }
  ];

  /* ═══════════════ 蛇皮肤（贪吃蛇专属，2026-10-06，全部免费） ═══════════════
     head / body：蛇头与蛇身主色；headNight / bodyNight：夜间主题下的替代色
     （不填则沿用日间色）。贪吃蛇页没有钱包，商店里按「装备」直接换。 */
  var SNAKES = [
    {
      id: "classic", name: "经典青蛇", price: 0, tag: "默认",
      desc: "最初的绿色小蛇，头深身浅，明暗分明。",
      head: "#1d8a40", body: "#37a352", headNight: "#3ddc68", bodyNight: "#2fae54"
    },
    {
      id: "lime", name: "青柠", price: 0, tag: "免费",
      desc: "青柠配色的亮绿小蛇，看着就很酸爽。",
      head: "#5f9e1a", body: "#8ed13f", headNight: "#a8e05f", bodyNight: "#7cc32f"
    },
    {
      id: "ocean", name: "深海蓝", price: 0, tag: "免费",
      desc: "蓝色系小蛇，游起来像一串浪花。",
      head: "#1f5fd0", body: "#3b8ff0", headNight: "#5f9bff", bodyNight: "#3b82d8"
    },
    {
      id: "sakura", name: "樱花", price: 0, tag: "免费",
      desc: "粉嫩配色，吃苹果的样子都温柔了几分。",
      head: "#c2447e", body: "#ef86b6", headNight: "#ff9ec9", bodyNight: "#e072a5"
    },
    {
      id: "violet", name: "暗夜紫", price: 0, tag: "免费",
      desc: "深紫蛇身配亮紫蛇头，夜间格外精神。",
      head: "#6d3bd4", body: "#8f5cf0", headNight: "#a985ff", bodyNight: "#8a5cf0"
    },
    {
      id: "amber", name: "琥珀", price: 0, tag: "免费",
      desc: "琥珀金的小蛇，爬过的地方都在发光。",
      head: "#b06f10", body: "#dd9a2f", headNight: "#ffc257", bodyNight: "#e0a63c"
    },
    {
      id: "ghost", name: "幽灵", price: 0, tag: "免费",
      desc: "半透明的灰白小蛇，安安静静地飘。",
      head: "#7d8ea6", body: "#a8b8cc", headNight: "#b7c6da", bodyNight: "#93a5bd"
    }
  ];

  /* ═══════════════ 查询 / 钱包 / 拥有 / 装备 ═══════════════ */
  function list(kind) {
    if (kind === "coin") return COINS;
    if (kind === "flag") return FLAGS;
    if (kind === "mine") return MINES;
    if (kind === "snake") return SNAKES;
    return PLAYERS;
  }

  function get(kind, id) {
    var arr = list(kind);
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function getPlayer(id) { return get("player", id) || PLAYERS[0]; }
  function getCoin(id) { return get("coin", id) || COINS[0]; }
  function getFlag(id) { return get("flag", id) || FLAGS[0]; }
  function getMine(id) { return get("mine", id) || MINES[0]; }
  function getSnake(id) { return get("snake", id) || SNAKES[0]; }
  /* 旗子皮肤只贡献颜色：把当前装备的旗色取出来（没加载 skins.js 时回落红色） */
  function flagColor() {
    var f = getFlag(equipped("flag"));
    return (f && f.color) || "#ff4d4f";
  }
  /* 雷皮肤三色（扫雷页 mineSvg 用）；skins.js 未加载时回落经典铁雷 */
  function mineParts() {
    var m = getMine(equipped("mine"));
    return { body: m.body, spike: m.spike, shine: m.shine };
  }
  /* 蛇皮肤（贪吃蛇页 draw 用）；dark = 夜间主题 */
  function snakeColors(dark) {
    var s = getSnake(equipped("snake"));
    return {
      head: (dark && s.headNight) ? s.headNight : s.head,
      body: (dark && s.bodyNight) ? s.bodyNight : s.body
    };
  }

  function getWallet() {
    var n = parseInt(lsGet(KEY_WALLET), 10);
    return n > 0 ? n : 0;
  }
  function setWallet(n) {
    lsSet(KEY_WALLET, String(Math.max(0, Math.floor(n || 0))));
    notifyWallet();
    return getWallet();
  }
  function addWallet(n) {
    return setWallet(getWallet() + Math.floor(n || 0));
  }

  /* 钱包/装备变化时广播一次，供云存档（cloud.js）与界面刷新使用 */
  function notifyWallet() {
    try { document.dispatchEvent(new Event("wallet:change")); } catch (e) {}
  }

  function ownedKey(kind, id) {
    return (kind === "coin" ? "c:" : kind === "flag" ? "f:" : "p:") + id;
  }
  function getOwned() {
    var raw = lsGet(KEY_OWNED), arr = null;
    try { arr = JSON.parse(raw); } catch (e) { arr = null; }
    if (Object.prototype.toString.call(arr) !== "[object Array]") return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (typeof arr[i] === "string" && out.indexOf(arr[i]) < 0) out.push(arr[i]);
    }
    return out;
  }

  /* price === 0 的商品视为人人都有 */
  function isOwned(kind, id) {
    var def = get(kind, id);
    if (!def) return false;
    if (def.price === 0) return true;
    return getOwned().indexOf(ownedKey(kind, id)) >= 0;
  }

  function buy(kind, id) {
    var def = get(kind, id);
    if (!def) return { ok: false, reason: "unknown" };
    if (isOwned(kind, id)) return { ok: false, reason: "owned" };
    var w = getWallet();
    if (w < def.price) return { ok: false, reason: "poor", need: def.price - w };
    setWallet(w - def.price);
    var arr = getOwned();
    arr.push(ownedKey(kind, id));
    lsSet(KEY_OWNED, JSON.stringify(arr));
    equip(kind, id);                                   // 买到手直接换上
    return { ok: true, left: getWallet(), item: def };
  }

  function equip(kind, id) {
    if (!isOwned(kind, id)) return false;
    var key = kind === "coin" ? KEY_COIN
      : kind === "flag" ? KEY_FLAG
      : kind === "mine" ? KEY_MINE
      : kind === "snake" ? KEY_SNAKE
      : KEY_SKIN;
    lsSet(key, id);
    notifyWallet();
    return true;
  }

  /* 整体覆盖「已拥有」清单（云存档合并后用；只做去重，不校验商品是否存在） */
  function setOwned(arr) {
    var out = [];
    if (arr && arr.length) {
      for (var i = 0; i < arr.length; i++) {
        if (typeof arr[i] === "string" && out.indexOf(arr[i]) < 0) out.push(arr[i]);
      }
    }
    lsSet(KEY_OWNED, JSON.stringify(out));
    return out;
  }

  /* 当前装备（若存档里的 id 失效则回落到默认款） */
  function equipped(kind) {
    var id = lsGet(kind === "coin" ? KEY_COIN
      : kind === "flag" ? KEY_FLAG
      : kind === "mine" ? KEY_MINE
      : kind === "snake" ? KEY_SNAKE
      : KEY_SKIN);
    if (id && isOwned(kind, id)) return id;
    return list(kind)[0].id;
  }

  /* ═══════════════ 绘制工具 ═══════════════ */
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    return "hsl(" + h.toFixed(0) + "," + s + "%," + l + "%)";
  }

  /* ═══════════════ 火柴人：三种姿态的骨架 ═══════════════
     坐标系：脚底为 (0,0)，向上为负 y；head 为头部圆心。
     ⚠️ limbs 的顺序三种姿态必须一致：躯干 / 腿 / 腿 / 手臂 / 手臂 ——
     因为「站立 ⇄ 蹲下」的过渡是按序号逐条插值的，顺序错位会把腿插成手。 */
  function poseGeo(pose, run) {
    if (pose === "duck") {
      return {
        head: { x: 10, y: -24, r: 9 },
        limbs: [
          [-1, -17, 9, -15],        // 躯干（压得近乎水平）
          [-1, -17, -10, -1],       // 腿
          [-1, -17, 5, -1],
          [8, -16, 15, -8],         // 手前伸
          [8, -16, 2, -7]
        ]
      };
    }
    if (pose === "jump") {
      return {
        head: { x: 1, y: -52, r: 10 },
        limbs: [
          [1, -42, 0, -22],
          [0, -22, 13, -9],         // 收腿
          [0, -22, -11, -5],
          [0, -37, -9, -48],        // 举手
          [0, -37, 10, -46]
        ]
      };
    }
    var s = Math.sin(run), s2 = Math.sin(run + Math.PI);
    return {
      head: { x: 1, y: -52, r: 10 },
      limbs: [
        [1, -42, 0, -22],
        [0, -22, s * 13, -1],       // 腿（反相摆动）
        [0, -22, s2 * 13, -1],
        [0, -37, s2 * 11, -26],     // 手臂
        [0, -37, s * 11, -26]
      ]
    };
  }

  /* 两套骨架之间做线性插值 —— 「站立 → 蹲下」的过渡就靠它逐条骨骼变形。
     k = 0 取 a（站），k = 1 取 b（蹲）。 */
  function lerpGeo(a, b, k) {
    var head = {
      x: a.head.x + (b.head.x - a.head.x) * k,
      y: a.head.y + (b.head.y - a.head.y) * k,
      r: a.head.r + (b.head.r - a.head.r) * k
    };
    var limbs = [], n = Math.min(a.limbs.length, b.limbs.length), i;
    for (i = 0; i < n; i++) {
      var A = a.limbs[i], B = b.limbs[i];
      limbs.push([
        A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k,
        A[2] + (B[2] - A[2]) * k, A[3] + (B[3] - A[3]) * k
      ]);
    }
    return { head: head, limbs: limbs };
  }

  /* 头顶装饰 */
  function drawDeco(ctx, kind, c, r, color, t) {
    ctx.save();
    ctx.lineCap = "round";
    if (kind === "helmet") {                     // 骑士尖盔
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y - 1, r + 2.2, Math.PI * 1.04, Math.PI * 1.96);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();                           // 顶上小尖
      ctx.moveTo(c.x - 3, c.y - r - 0.5);
      ctx.lineTo(c.x, c.y - r - 9);
      ctx.lineTo(c.x + 3, c.y - r - 0.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(c.x - r * 0.55, c.y - r - 1.2, r * 0.62, 1.5);
    } else if (kind === "band") {                // 忍者头带 + 飘带
      ctx.fillStyle = color;
      rr(ctx, c.x - r - 1.2, c.y - r * 0.62, (r + 1.2) * 2, 3.6, 1.6); ctx.fill();
      var fl = Math.sin(t * 6) * 2.4;
      ctx.strokeStyle = color; ctx.lineWidth = 2.3;
      ctx.beginPath();
      ctx.moveTo(c.x - r, c.y - r * 0.42);
      ctx.quadraticCurveTo(c.x - r - 9, c.y - r * 0.1 + fl, c.x - r - 16, c.y - r * 0.95 + fl);
      ctx.stroke();
    } else if (kind === "petal") {               // 头顶小花
      var pc = { x: c.x - r * 0.5, y: c.y - r - 2.4 };
      for (var i = 0; i < 5; i++) {
        var a = i / 5 * 6.2832 + t * 0.7;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(pc.x + Math.cos(a) * 3.5, pc.y + Math.sin(a) * 3.5, 2.7, 1.8, a, 0, 6.2832);
        ctx.fill();
      }
      ctx.fillStyle = "#ffe6a8";
      ctx.beginPath(); ctx.arc(pc.x, pc.y, 1.8, 0, 6.2832); ctx.fill();
    } else if (kind === "horn") {                // 两簇火苗
      for (var k = 0; k < 2; k++) {
        var sx = c.x + (k === 0 ? -r * 0.45 : r * 0.5);
        var wob = Math.sin(t * 9 + k * 1.7) * 1.6;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(sx - 3.2, c.y - r * 0.8);
        ctx.quadraticCurveTo(sx - 4.6 + wob, c.y - r - 6, sx + 0.6, c.y - r - 11 + wob);
        ctx.quadraticCurveTo(sx + 1.2, c.y - r - 4, sx + 3.4, c.y - r * 0.78);
        ctx.closePath(); ctx.fill();
      }
    } else if (kind === "antenna") {             // 天线 + 闪灯
      ctx.strokeStyle = color; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(c.x + 1, c.y - r + 1);
      ctx.lineTo(c.x + 1, c.y - r - 8);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.x + 1, c.y - r - 9.6, 2 + Math.sin(t * 5) * 0.6, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  }

  /* 画一张立绘（或逐帧精灵图的当前帧）：脚底对齐原点、左右居中。
     sp 为 { sheet, n, fps } 时按 t 取帧循环；alpha 用于蹲⇄站过渡的交叉淡入淡出。 */
  function drawSpriteFrame(ctx, im, sp, dh, alpha, bob, tilt, t) {
    if (!im || alpha <= 0.002) return;
    var frames = (sp && typeof sp === "object") ? (sp.n || 1) : 1;
    var sx = 0, sw = im.naturalWidth, dw;
    if (frames > 1) {
      var fw = im.naturalWidth / frames;
      sx = (Math.floor(t * (sp.fps || 15)) % frames) * fw;
      sw = fw;
      dw = dh * fw / im.naturalHeight;
    } else {
      dw = dh * im.naturalWidth / im.naturalHeight;
    }
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (bob || tilt) {
      ctx.translate(0, bob);                        // 步伐起伏
      ctx.rotate(tilt);                             // 轻微前后倾
    }
    ctx.drawImage(im, sx, 0, sw, im.naturalHeight, -dw / 2, -dh, dw, dh);
    ctx.restore();
  }

  /* ═══════════════ 画一个火柴人 ═══════════════
     ctx 需已平移到「脚底」位置；opts:
       pose  run | jump | duck      t 秒   run 摆臂相位
       crouch 0..1 蹲下过渡进度（已缓动）：0 站立、1 蹲下；不传则按 pose 推断
              （老人调用方传 pose:"duck" 时视作 1，行为与以前完全一致）
       scale 缩放   night 是否夜间背景 */
  function drawStick(ctx, skin, opts) {
    if (!skin) skin = PLAYERS[0];
    opts = opts || {};
    var pose = opts.pose || "run";
    var t = opts.t || 0;
    var run = opts.run || 0;
    var scale = opts.scale || 1;
    var night = !!opts.night;
    var kd = opts.crouch === undefined ? (pose === "duck" ? 1 : 0)
                                       : Math.max(0, Math.min(1, opts.crouch));

    /* ── 立绘皮肤：直接贴图（跑动带轻微起伏 / 前后倾，蹲用专属立绘）──
       逐帧动画皮肤（史诗）：run/duck 可以是 { sheet: "文件名", n: 帧数, fps: 帧率 }，
       sheet 为横排精灵图，按 t 取当前帧循环播放；静图皮肤照旧。
       蹲⇄站过渡：立绘是两张成品图，没法骨骼变形，改成按进度**交叉淡入淡出**，
       观感就是「一边起立一边显形」，比当帧硬切自然得多。 */
    if (skin.sprite) {
      var spR = skin.sprite.run, spD = skin.sprite.duck;
      var imR = spriteImg(typeof spR === "object" ? spR.sheet : spR);
      var imD = spriteImg(typeof spD === "object" ? spD.sheet : spD);
      var okR = imgOk(imR), okD = imgOk(imD);
      /* 当前该显形的那张还没就绪 → 照老规矩退回经典火柴人（预加载下几乎不会发生） */
      if (kd > 0.5 ? okD : okR) {
        ctx.save();
        ctx.scale(scale, scale);
        var al = skin.alpha === undefined ? 1 : skin.alpha;
        var aRun = (1 - kd) * al, aDuck = kd * al;
        var bobK = 1 - kd;                             // 起伏/倾斜随蹲下进度收掉
        if (okR && aRun > 0.002) {
          drawSpriteFrame(ctx, imR, spR, skin.runH || 66, aRun,
            pose === "run" ? Math.sin(run) * 1.8 * bobK : 0,
            pose === "run" ? Math.sin(run) * 0.035 * bobK : 0, t);
        }
        /* duckH 必须等于 runner.js 的 CFG.DUCK_H：贴图脚底对齐、向上长 duckH 像素，
           高度与蹲下碰撞盒一致，「看着能钻过去」＝「真能钻过去」。
           兜底值同样取 34（老默认 36 比碰撞盒高 2px，会造成视觉欺骗）。 */
        if (okD && aDuck > 0.002) drawSpriteFrame(ctx, imD, spD, skin.duckH || 34, aDuck, 0, 0, t);
        ctx.restore();
        return;
      }
      skin = PLAYERS[0];                                  // 图没就绪 → 经典火柴人兜底
    }

    /* 站姿参照：蹲下是从「跑」压下去的（pose 为 duck 时按 run 取基准） */
    var standPose = pose === "duck" ? "run" : pose;
    var g = poseGeo(kd <= 0 ? standPose : "duck", run);
    if (kd > 0 && kd < 1) g = lerpGeo(poseGeo(standPose, run), g, kd);
    var headC = g.head, headR = g.head.r, limbs = g.limbs;

    var ink = night ? (skin.inkNight || skin.ink) : skin.ink;
    var edge = night ? "rgba(16,22,38,0.82)" : "rgba(255,255,255,0.92)";
    var scarf = night && skin.scarfNight ? skin.scarfNight : skin.scarf;
    var headFill = night && skin.headFillNight ? skin.headFillNight : (skin.headFill || "#ffdfc6");
    var eye = night && skin.eyeNight ? skin.eyeNight : (skin.eye || "#28324a");
    var lw = 6.8 - 0.8 * kd;                               // 线条随蹲下略变细（6.8 → 6）

    ctx.save();
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    if (skin.alpha) ctx.globalAlpha = skin.alpha;
    if (skin.glow) { ctx.shadowColor = skin.glow; ctx.shadowBlur = 9; }

    var flow = Math.sin(run * 0.8 + t * 3) * 3;            // 围巾飘动
    ctx.strokeStyle = scarf; ctx.lineWidth = 4.6;
    ctx.beginPath();
    ctx.moveTo(headC.x - 3, headC.y + 11);
    ctx.quadraticCurveTo(-14, headC.y + 8 + flow, -25, headC.y + 17 + flow);
    ctx.stroke();

    var i;
    ctx.strokeStyle = edge; ctx.lineWidth = lw;            // 打底描边（深浅背景都看得见）
    ctx.beginPath();
    for (i = 0; i < limbs.length; i++) {
      ctx.moveTo(limbs[i][0], limbs[i][1]); ctx.lineTo(limbs[i][2], limbs[i][3]);
    }
    ctx.stroke();

    ctx.strokeStyle = ink; ctx.lineWidth = lw - 2.6;       // 线条主体
    ctx.beginPath();
    for (i = 0; i < limbs.length; i++) {
      ctx.moveTo(limbs[i][0], limbs[i][1]); ctx.lineTo(limbs[i][2], limbs[i][3]);
    }
    ctx.stroke();

    if (skin.glow) ctx.shadowBlur = 0;                     // 头部不再叠发光，免得糊成一团

    ctx.fillStyle = headFill;                              // 头
    ctx.beginPath(); ctx.arc(headC.x, headC.y, headR, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(headC.x, headC.y, headR, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(headC.x, headC.y, headR, 0, 6.2832); ctx.stroke();

    ctx.fillStyle = eye;                                   // 眼睛（面朝右）
    ctx.beginPath(); ctx.arc(headC.x + 3.6, headC.y - 1.4, 1.7, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(headC.x + 0.2, headC.y - 1.4, 1.3, 0, 6.2832); ctx.fill();

    if (skin.deco) drawDeco(ctx, skin.deco, headC, headR, skin.decoColor || ink, t);

    ctx.restore();
  }

  /* ═══════════════ 画一枚金币 ═══════════════
     opts: x, y 中心；t 秒；ph 相位；scale 缩放 */
  function drawCoin(ctx, skin, opts) {
    if (!skin) skin = COINS[0];
    opts = opts || {};
    var x = opts.x || 0, y = opts.y || 0;
    var t = opts.t || 0, ph = opts.ph || 0;
    var sc = opts.scale || 1;
    var cy = y + Math.sin(t * 5 + ph) * 3 * sc;
    var spin = Math.sin(t * 3.2 + ph);
    var shape = skin.shape || "coin";

    var dark = skin.dark, face = skin.face, hi = skin.hi;
    if (skin.rainbow) {                                    // 彩虹币：色相随时间流转
      var hue = t * 90 + ph * 57;
      dark = hsl(hue, 68, 40); face = hsl(hue, 88, 58); hi = hsl(hue, 96, 84);
    }

    ctx.save();
    ctx.fillStyle = skin.halo || "rgba(255,209,102,0.22)";  // 光晕
    ctx.beginPath(); ctx.arc(x, cy, (shape === "star" ? 16 : 15) * sc, 0, 6.2832); ctx.fill();

    if (shape === "gem") {                                  // 蓝宝石：菱形 + 切面
      var s = 13 * sc;
      ctx.translate(x, cy);
      ctx.rotate(Math.sin(t * 2.6 + ph) * 0.13);
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.86, -s * 0.2);
      ctx.lineTo(0, s * 0.95);
      ctx.lineTo(-s * 0.86, -s * 0.2);
      ctx.closePath();
      ctx.fillStyle = face; ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.6 * sc; ctx.lineJoin = "round"; ctx.stroke();
      ctx.beginPath();                                      // 右上亮面
      ctx.moveTo(0, -s); ctx.lineTo(s * 0.86, -s * 0.2); ctx.lineTo(0, -s * 0.18); ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.42)"; ctx.fill();
      ctx.beginPath();                                      // 左下暗面
      ctx.moveTo(-s * 0.86, -s * 0.2); ctx.lineTo(0, s * 0.95); ctx.lineTo(0, -s * 0.18); ctx.closePath();
      ctx.fillStyle = "rgba(0,0,0,0.16)"; ctx.fill();
      ctx.strokeStyle = hi; ctx.lineWidth = 1.4 * sc;       // 内部高光条
      ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.1); ctx.lineTo(s * 0.12, s * 0.42); ctx.stroke();

    } else if (shape === "star") {                          // 幸运星：五角星自转
      var R = 13 * sc, r2 = R * 0.44;
      ctx.translate(x, cy);
      ctx.rotate(t * 1.4 + ph);
      ctx.beginPath();
      for (var i = 0; i < 10; i++) {
        var rr2 = i % 2 === 0 ? R : r2;
        var a = i * Math.PI / 5 - Math.PI / 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
        else ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
      }
      ctx.closePath();
      ctx.fillStyle = face; ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.6 * sc; ctx.lineJoin = "round"; ctx.stroke();
      ctx.fillStyle = hi;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.26, 0, 6.2832); ctx.fill();

    } else if (shape === "heart") {                         // 爱心币：带心跳
      var hs = 12 * sc;
      ctx.translate(x, cy);
      ctx.scale(1 + Math.sin(t * 6 + ph) * 0.06, 1 + Math.sin(t * 6 + ph) * 0.06);
      ctx.beginPath();
      ctx.moveTo(0, hs * 0.85);
      ctx.bezierCurveTo(-hs * 1.35, -hs * 0.1, -hs * 0.62, -hs * 1.05, 0, -hs * 0.34);
      ctx.bezierCurveTo(hs * 0.62, -hs * 1.05, hs * 1.35, -hs * 0.1, 0, hs * 0.85);
      ctx.closePath();
      ctx.fillStyle = face; ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.5 * sc; ctx.lineJoin = "round"; ctx.stroke();
      ctx.fillStyle = hi;
      ctx.beginPath(); ctx.ellipse(-hs * 0.42, -hs * 0.3, hs * 0.22, hs * 0.14, -0.5, 0, 6.2832); ctx.fill();

    } else if (shape === "ring") {                          // 甜甜圈：彩针 + 缓慢自转
      var Rr = 9.5 * sc;
      ctx.translate(x, cy);
      ctx.beginPath(); ctx.arc(0, 0, Rr, 0, 6.2832);
      ctx.lineWidth = 6.6 * sc; ctx.strokeStyle = dark; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, Rr, 0, 6.2832);
      ctx.lineWidth = 4.7 * sc; ctx.strokeStyle = face; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, Rr, -0.55, 1.15);      // 糖霜
      ctx.lineWidth = 4.7 * sc; ctx.strokeStyle = hi; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, Rr, 2.55, 3.95);
      ctx.stroke();
      var SPR = ["#ff5f6d", "#4f7cff", "#2fe0a0", "#ffd166", "#b14bff"];
      for (var k = 0; k < 7; k++) {
        var a2 = k / 7 * 6.2832 + t * 0.6 + ph;
        ctx.save();
        ctx.translate(Math.cos(a2) * Rr, Math.sin(a2) * Rr);
        ctx.rotate(a2 + 1.1);
        ctx.fillStyle = SPR[k % SPR.length];
        rr(ctx, -1.8 * sc, -0.55 * sc, 3.6 * sc, 1.1 * sc, 0.55 * sc);
        ctx.fill();
        ctx.restore();
      }

    } else {                                                // 硬币：绕竖轴翻转
      var rw = (5.5 + Math.abs(spin) * 5.5) * sc;
      var rh = 11 * sc;
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(x, cy, rw, rh, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = face;
      ctx.beginPath(); ctx.ellipse(x, cy, Math.max(1.5 * sc, rw - 2 * sc), rh * 0.8, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = hi;
      ctx.beginPath(); ctx.ellipse(x, cy, Math.max(0.7 * sc, rw * 0.44), rh * 0.44, 0, 0, 6.2832); ctx.fill();
      if (rw > 6 * sc) {                                    // 正面时一道竖棱
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillRect(x - 0.8 * sc, cy - 3.4 * sc, 1.6 * sc, 6.8 * sc);
      }
    }
    ctx.restore();
  }

  /* ═══════════════ 对外接口 ═══════════════ */
  /* 旗子预览（商店卡用）：旗杆 + 随风轻摆的三角旗，颜色取自皮肤定义 */
  function drawFlag(g, item, opts) {
    opts = opts || {};
    var t = opts.t || 0, sc = opts.scale || 3;
    var color = (item && item.color) || "#ff4d4f";
    g.save();
    var cx = opts.x || (g.canvas.width / 2);
    var baseY = opts.y || (g.canvas.height - 40);
    g.strokeStyle = "#8a6a45";
    g.lineWidth = Math.max(2, 1.15 * sc);
    g.lineCap = "round";
    g.beginPath(); g.moveTo(cx, baseY); g.lineTo(cx, baseY - 14.5 * sc); g.stroke();
    g.fillStyle = "rgba(0,0,0,0.16)";
    g.beginPath(); g.ellipse(cx, baseY + 1.2 * sc, 3.4 * sc, 1.1 * sc, 0, 0, 6.2832); g.fill();
    var sway = Math.sin(t * 2.4 + (opts.ph || 0)) * 0.9 * sc;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(cx, baseY - 14.5 * sc);
    g.quadraticCurveTo(cx + 4.5 * sc, baseY - 13.2 * sc + sway, cx + 9 * sc, baseY - 12.4 * sc + sway);
    g.lineTo(cx, baseY - 7.4 * sc);
    g.closePath(); g.fill();
    g.fillStyle = "rgba(255,255,255,0.28)";
    g.beginPath();
    g.moveTo(cx, baseY - 14.5 * sc);
    g.quadraticCurveTo(cx + 3.4 * sc, baseY - 13.6 * sc + sway * 0.6, cx + 6.2 * sc, baseY - 13 * sc + sway * 0.6);
    g.lineTo(cx, baseY - 10.4 * sc);
    g.closePath(); g.fill();
    g.restore();
  }

  /* 雷皮肤预览（商店卡用）：一颗圆雷 + 八根尖刺 + 高光，颜色取自皮肤定义 */
  function drawMine(g, item, opts) {
    opts = opts || {};
    var t = opts.t || 0, sc = opts.scale || 3;
    var cx = opts.x || (g.canvas.width / 2);
    var cy = opts.y || (g.canvas.height / 2);
    var body = (item && item.body) || "#3a3f4a";
    var spike = (item && item.spike) || "#3a3f4a";
    var shine = (item && item.shine) || "#8d95a5";
    var R = 11 * sc;
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.sin(t * 1.2) * 0.06);
    for (var i = 0; i < 8; i++) {                    // 八根尖刺
      var a = i / 8 * 6.2832;
      g.strokeStyle = spike;
      g.lineWidth = 2.1 * sc;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55);
      g.lineTo(Math.cos(a) * (R + 5.5 * sc), Math.sin(a) * (R + 5.5 * sc));
      g.stroke();
    }
    g.fillStyle = body;                              // 雷体
    g.beginPath(); g.arc(0, 0, R, 0, 6.2832); g.fill();
    g.strokeStyle = spike; g.lineWidth = 1.6 * sc; g.stroke();
    g.fillStyle = shine;                             // 高光
    g.beginPath(); g.arc(-R * 0.34, -R * 0.36, R * 0.2, 0, 6.2832); g.fill();
    g.beginPath(); g.arc(R * 0.18, -R * 0.1, R * 0.09, 0, 6.2832); g.fill();
    g.restore();
  }

  /* 蛇皮肤预览（商店卡用）：一段弯曲的蛇身 + 蛇头，颜色取自皮肤定义 */
  function drawSnake(g, item, opts) {
    opts = opts || {};
    var t = opts.t || 0, sc = opts.scale || 3;
    var cx = opts.x || (g.canvas.width / 2);
    var cy = opts.y || (g.canvas.height / 2);
    var head = (item && item.head) || "#1d8a40";
    var body = (item && item.body) || "#37a352";
    var w = 9 * sc;                                  // 蛇身宽度
    g.save();
    g.translate(cx, cy);
    /* 蛇身：沿正弦波摆 6 节，从尾到头一节比一节宽 */
    for (var i = 6; i >= 1; i--) {
      var px = (i - 3.5) * 7.2 * sc;
      var py = Math.sin(t * 3 + i * 0.9) * 5 * sc;
      var k = w * (0.5 + 0.5 * (7 - i) / 6);
      g.fillStyle = body;
      g.beginPath();
      g.arc(px, py, k / 2, 0, 6.2832);
      g.fill();
    }
    /* 蛇头（略大，靠前，随波轻摆） */
    var hx = 3.7 * 7.2 * sc * 0 + (2.5) * 7.2 * sc;  // 头在蛇身最前端
    var hy = Math.sin(t * 3 + 0.9) * 5 * sc;
    g.fillStyle = head;
    g.beginPath();
    if (g.ellipse) g.ellipse(hx + w * 0.2, hy, w * 0.72, w * 0.58, 0, 0, 6.2832);
    else g.arc(hx, hy, w * 0.62, 0, 6.2832);
    g.fill();
    g.fillStyle = "#ffffff";                         // 眼睛
    g.beginPath(); g.arc(hx + w * 0.34, hy - w * 0.2, w * 0.13, 0, 6.2832); g.fill();
    g.beginPath(); g.arc(hx + w * 0.1, hy - w * 0.26, w * 0.1, 0, 6.2832); g.fill();
    g.restore();
  }

  global.RunnerSkins = {
    KEYS: { wallet: KEY_WALLET, owned: KEY_OWNED, skin: KEY_SKIN, coin: KEY_COIN, flag: KEY_FLAG, mine: KEY_MINE, snake: KEY_SNAKE },
    imgBase: IMG_BASE,                     // 素材目录（runner.js 的障碍贴图也用它，见 runner.js OB_IMG）
    SCOPE: SCOPE,
    PLAYERS: PLAYERS,
    COINS: COINS,
    FLAGS: FLAGS,
    MINES: MINES,
    SNAKES: SNAKES,
    list: list,
    get: get,
    getPlayer: getPlayer,
    getCoin: getCoin,
    getFlag: getFlag,
    getMine: getMine,
    getSnake: getSnake,
    flagColor: flagColor,
    mineParts: mineParts,
    snakeColors: snakeColors,
    getWallet: getWallet,
    setWallet: setWallet,
    addWallet: addWallet,
    getOwned: getOwned,
    setOwned: setOwned,
    isOwned: isOwned,
    buy: buy,
    equip: equip,
    equipped: equipped,
    drawStick: drawStick,
    drawCoin: drawCoin,
    drawFlag: drawFlag,
    drawMine: drawMine,
    drawSnake: drawSnake
  };
})(window);
