/* ══════════════════════════════════════════════════════════════
   火柴人快跑 —— 横版无尽跑酷小游戏（外链版）
   ──────────────────────────────────────────────────────────────
   · 全部画面用 canvas 2D 程序化绘制，不依赖任何图片 / 字体文件
   · 音效用 WebAudio 实时合成，不依赖任何音频文件
     （本站 CSP 为纯同源白名单、无 unsafe-inline，禁止内联脚本）
   · 设置面板（⚙ 设置）：音效 / 音量、无障碍（色盲模式、减少闪烁、大字模式）、
     自定义按键，全部只存本机 localStorage（键名 runner-set）
   · 逻辑世界宽 960，高随画布实际形状而定（见 resize()）
   · 画面由 CSS 决定画布盒子大小（宽铺满正文、高自适应视口），
     渲染时按画布「实际宽高」反推缩放，所以画面永远是等比、不变形
   · 末尾暴露 window.Runner 供控制台调试与自动化测试驱动
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var root = document.getElementById("run-root");
  if (!root) return;
  var canvas = document.getElementById("run-canvas");
  var stage = document.getElementById("run-stage");
  var ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return;

  /* ═══════════ 可调参数 ═══════════ */
  var CFG = {
    W: 960, H: 360,
    GROUND: 300,            // 地面线（逻辑坐标 y）—— 会随画布高度自适应，见 resize()
    GROUND_STRIP: 60,       // 地面线以下固定留出的土层高度（世界单位）

    /* ── 画布形状变化的两个闸门（详见 resize()）──
       画布高度改成按视口自适应之后，画面就在「前方视野」和「放大倍数」之间取舍：
       VIEW_MIN_W 是横向最少要能看到的世界宽度，再窄前方障碍就来不及反应；
       VIEW_MAX_H 是纵向最多显示的世界高度，再多就是一大片空天空、反而更难看。
       竖屏/窄屏用 VIEW_MIN_W_NARROW：手机上 880 的视野把人物压得只有指甲盖大
       （实测反馈「看不清」），收窄到 720 换来约 1/3 的放大，前方仍有 ~0.7 秒反应时间。 */
    VIEW_MIN_W: 880,
    VIEW_MIN_W_NARROW: 720,
    VIEW_MAX_H: 500,
    PX: 148,                // 角色固定 x

    BODY_W: 30,             // 站立碰撞盒宽
    STAND_H: 62,            // 站立碰撞盒高
    DUCK_H: 34,             // 下蹲碰撞盒高
    CROUCH_IN: 0.20,        // 站立 → 蹲下 的过渡时长（秒）
    CROUCH_OUT: 0.14,       // 蹲下 → 站立 的过渡时长（秒）：起立快一点，少一点「还蹲着」的时间
    HIT_PAD: 5,             // 碰撞盒内缩（手感宽容度）

    GRAVITY: 2900,          // 重力加速度 px/s²
    JUMP_V: -950,           // 起跳初速度
    JUMP_CUT: 1500,         // 松开跳跃键后的额外下坠加速度（可变跳跃高度）
    JUMP_CUT_MIN: -420,     // 速度比此值更慢时不再施加 JUMP_CUT
    FAST_FALL: 2100,        // 空中按下蹲键的额外下坠加速度
    COYOTE: 0.10,           // 离地宽限起跳时间（秒）

    SPEED0: 330,            // 初始速度 px/s
    SPEED_MAX: 880,         // 速度上限
    SPEED_ACC: 7,           // 每秒速度增量

    SCORE_PER_PX: 1 / 12,   // 每前进 12px 得 1 分
    COIN_SCORE: 10,         // 每枚金币分值

    SHIELD_TIME: 3.6,       // 护盾无敌时长（秒）
    SHIELD_CHANCE: 0.08,    // 每次道具生成时「出护盾」的概率（其余出金币串）
    SHIELD_COOLDOWN: 6500,  // 两次护盾之间的最小距离（px）：防止运气好时连着刷，
                            // 中速约 11 秒，高速约 7 秒；概率已很低，这个只是削掉尾部
    /* 护盾 = 纯无敌（2026-10-05 起）：不提速、不进金币雨。
       保留收尾与归零兜底逻辑，防止「无敌一过就撞墙」：
       无敌最后 BOOST_TAIL 秒不再生成新障碍，把前方跑空。 */
    BOOST_MULT: 1.0,        // 已停用提速（保留常量与回落逻辑，倍率为 1 = 不加速）
    BOOST_TAIL: 1.10,       // 冲刺收尾期（秒）：这 1.1 秒不再生成新障碍，把前方跑空
    BOOST_CLEAR: 40,        // 归零兜底：只清「几乎已经贴到身上」的障碍（真正的应急，正常不触发）
    END_GRACE: 0.30,        // 归零宽限（秒）：前方还有 <0.3s 就撞上的障碍时，无敌再续这么一小段

    AIR_GAP: 44,            // 飞行物底边离地高度（站着会撞、下蹲能钻过）
    AIR_H: 93,              // 飞行物瓶身高 = 站立身高 × 1.5：顶在离地 ≈137，比满跳脚底
                            // 最高点（≈155）低 18px → 提前起跳能整个越过去（可跳可蹲）；
                            // 判定盒 = 画出的瓶身，宽高完全一致，不再有隐形竖井
    AIR_LEAD: 0.25,         // 飞行物这一波额外后推的时间（秒）：玩家可能正处在上一跳
                            // 的半空中，多留这点距离让它落地后再从容选择跳或蹲
    GAP_MIN: 0.80,          // 障碍间距系数下限（× 当前速度）
    GAP_MAX: 1.55,          // 障碍间距系数上限

    /* 金币「跑道」：金币出生点前方留出的无障碍距离
       = 最高速下一次完整跳跃的飞行距离 + 余量（保证玩家能落地、再从容起跳，
         而不是刚跳过障碍还悬在半空，眼看着金币从脚下飞过去） */
    RUNWAY_MIN: 360,        // 低速段的下限
    RUNWAY_PAD: 150,        // 在「一次完整跳跃」之外再留的余量
    GAP_AFTER_RATIO: 0.6,   // 金币串之后给障碍留的空档（占一次完整跳跃的比例）
    GAP_AFTER_MIN: 280,     // 该空档的下限
    COIN_MAGNET: 90,        // 金币磁吸半径：进到这个范围内金币会主动飞向玩家
    MAGNET_SPEED: 1000,     // 磁吸飞行速度 px/s
    COIN_PICK: 30,          // 金币拾取半径 = r + 30（比道具宽松一点）

    PHASE_DIST: 9000,       // 昼夜每阶段推进距离（px）
    DPR_MAX: 3,             // 渲染像素密度上限（大屏放宽后要更高，否则画面被放大糊掉）
    DPR_MAX_PX: 4200000     // 画布渲染总像素上限：画布又宽又高时别把低端机拖垮
  };

  var AIR_TIME = 2 * Math.abs(CFG.JUMP_V) / CFG.GRAVITY;   // 一次完整跳跃的滞空时间 ≈ 0.655s
  /* 金币出生点前方要留的跑道：够玩家「落地 → 再起跳」 */
  function itemRunway() { return Math.max(CFG.RUNWAY_MIN, S.speed * AIR_TIME + CFG.RUNWAY_PAD); }
  /* 金币串之后给障碍留的空档：够玩家落地并看清下一个障碍（不用整跳那么长，
     否则每一串金币都会挤掉一波障碍，节奏会变松） */
  function waveRunway() {
    return Math.max(CFG.GAP_AFTER_MIN, S.speed * AIR_TIME * CFG.GAP_AFTER_RATIO + 120);
  }

  /* ── 冲刺归零的「安全落地窗口」──
     无敌期间障碍一直在生成。如果恰好在障碍面前归零，
     玩家一帧之内根本来不及起跳 —— 这就是「无敌时间一过直接撞死」的原因。
     解法分两层：
       ① 收尾期 BOOST_TAIL 秒内不再生成新障碍，前方自然跑空（主要手段，
          实测关掉 ② 之后 26/26 次归零前方都是空的，它自己就够）；
       ② 归零那一帧再做一次极窄的兜底清扫（只碰几乎贴到身上的障碍），
          并把下一波障碍的生成点推远，让玩家平稳接回正常节奏。
     ② 的窗口必须很小：以前是 220px，一旦触发就是「前方障碍凭空消失」，
     比它要防的问题还显眼。 */
  function endBoost() {
    /* 归零宽限：判定盒跟着画面收窄之后，个别障碍会比以前晚一帧才被撞碎，
       归零瞬间它可能还悬在脸前（实测最差只剩 0.08s 反应）。
       与其把远处障碍清掉（那就是「凭空消失」），不如让无敌再续一小段，
       玩家会把它自然撞碎 —— 对玩家隐形，也不欠公平。 */
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.x + o.w <= CFG.PX) continue;
      if (o.kind === "air" && P.duck) continue;          // 蹲着能钻过去的就不用续
      var gap = o.x - (CFG.PX + CFG.BODY_W / 2);
      if (gap / Math.max(1, S.speed) < CFG.END_GRACE) {
        S.boost = CFG.END_GRACE;
        return;
      }
    }

    var cleared = 0;
    for (var i = obstacles.length - 1; i >= 0; i--) {
      var o = obstacles[i];
      if (o.x + o.w > CFG.PX - 24 && o.x < CFG.PX + CFG.BOOST_CLEAR) {
        var bb = obBody(o);
        addDebris(o);
        sparkle(bb.x + bb.w / 2, bb.y + bb.h / 2, 10, "#8ab4ff");
        obstacles.splice(i, 1);
        cleared++;
      }
    }
    S.spawnGap = Math.max(S.spawnGap, S.speed * CFG.GAP_MIN);   // 下一波至少隔一个正常最小间距
    if (cleared) shake = Math.max(shake, 5);
  }

  /* ═══════════ DOM 引用 ═══════════ */
  var elScore   = document.getElementById("run-score");
  var elBest    = document.getElementById("run-best");
  var elCoins   = document.getElementById("run-coins");
  var elWallet  = document.getElementById("run-wallet");
  var elOverlay = document.getElementById("run-overlay");
  var elOvTitle = document.getElementById("run-ov-title");
  var elOvText  = document.getElementById("run-ov-text");
  var elOvBtn   = document.getElementById("run-ov-btn");
  var elRecords = document.getElementById("run-records");
  var elToast   = document.getElementById("run-toast");
  var btnJumpIn = document.getElementById("run-jump");
  var btnDuckIn = document.getElementById("run-duck");
  var btnMute   = document.getElementById("run-mute");
  var btnHelp   = document.getElementById("run-help");
  var elShop    = document.getElementById("run-shop");        // 商店弹层（骨架在页面里，内容由 shop.js 填）
  var btnShopX  = document.getElementById("run-shop-close");
  var elRank    = document.getElementById("run-rank");        // 云端排行榜弹层（内容由 rank.js 填）
  var elSet     = document.getElementById("run-set");          // 设置弹层（音效 / 无障碍 / 自定义按键）
  var btnSetOpen = document.getElementById("run-set-btn");     // 工具条里的「⚙ 设置」
  var btnSetX   = document.getElementById("run-set-close");
  var btnSetBack = document.getElementById("run-set-back");
  var elSetTitle = document.getElementById("run-set-title");
  /* 个人中心「个人」页（头像 + 成就进度） */
  var elMe      = document.getElementById("run-me");
  var btnMeX    = document.getElementById("run-me-close");
  var elMeAvaImg = document.getElementById("me-ava-img");
  var elMeAvaPh  = document.getElementById("me-ava-ph");
  var elMeNick   = document.getElementById("me-nick");
  var elMeSub    = document.getElementById("me-sub");
  var btnMePick  = document.getElementById("me-ava-pick");
  var btnMeClear = document.getElementById("me-ava-clear");
  var elMeFile   = document.getElementById("me-ava-file");
  var elMeHint   = document.getElementById("me-ava-hint");
  var elMeGot    = document.getElementById("me-ach-got");
  var elMeTotal  = document.getElementById("me-ach-total");
  var elMeBar    = document.getElementById("me-bar");
  var elMeBarFill = document.getElementById("me-bar-fill");
  var elMeTiers  = null;    /* 旧「三档细分」容器已按需求移除，保留变量兼容旧缓存页面 */

  var KEY_BEST = "runner-best";
  var KEY_SCORES = "runner-scores";
  var KEY_MUTE = "runner-mute";
  var KEY_SET = "runner-set";        // 设置（JSON：sfx / vol / cb / calm / big / keys）
  var KEY_HELP = "runner-help-seen"; // 玩法说明「已读」标记：首次进入自动弹一次，之后不再打扰

  /* ═══════════ 设置（⚙ 设置面板：音效、无障碍、自定义按键） ═══════════
     和钱包、成就一样只写本机 localStorage，不联网。面板里所有控件都读写同一个
     SET 对象（setOpt / setKeys 是唯一入口），改完立刻生效并存盘。
     · sfx  音效开关（0/1）—— 老版本存的 "runner-mute" 会被读进来，升级不丢设置
     · vol  音效音量（0~1）—— 「独立音量」，只影响本游戏合成的音效，不动系统音量
     · cb   色盲模式：障碍加深色描边+斜纹（靠形状认危险）、金币加深色外圈、
            地线/轮廓拉到极限对比、危险色换成安全的琥珀黄，界面不再依赖红绿区分
     · calm 减少闪烁：去掉撞击的画面抖动、星星闪烁、24Hz 护盾光环闪烁、
            面板动效，并削减粒子数量
     · big  大字模式：HUD / 遮罩 / 各弹层 / 页脚字号放大一档（html.run-bigtext）
     · keys 自定义按键：跳跃 / 下蹲 / 暂停 / 音效开关各自的键位（按 KeyboardEvent.code 存） */
  var KEY_ACTIONS = ["jump", "duck", "pause", "mute"];
  var KEY_ACT_CN = { jump: "跳跃", duck: "下蹲", pause: "暂停", mute: "音效开关" };
  var KEY_DESC = {
    jump: "长按跳更高，可绑多个键",
    duck: "下蹲钻过飞行障碍，空中按下蹲加速下落",
    pause: "暂停 / 继续（Esc 也默认在这里）",
    mute: "音效开关"
  };
  var KEY_MAX = 4;                                  // 每个动作最多绑几个键
  var KEY_UNIQUE = { jump: false, duck: false, pause: true, mute: true };
  var KEY_ALIAS = { " ": "Space", "Spacebar": "Space", "Up": "ArrowUp", "Down": "ArrowDown",
                    "Left": "ArrowLeft", "Right": "ArrowRight", "Esc": "Escape" };
  var KEY_NAMES = {
    Space: "空格", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Escape: "Esc", Enter: "回车", Backspace: "退格", Delete: "Delete", Tab: "Tab",
    ShiftLeft: "左 Shift", ShiftRight: "右 Shift", ControlLeft: "左 Ctrl", ControlRight: "右 Ctrl",
    AltLeft: "左 Alt", AltRight: "右 Alt", CapsLock: "大写锁定", Insert: "Insert",
    Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn", Semicolon: ";",
    Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", BracketLeft: "[",
    BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`"
  };
  var SET_DEF = {
    sfx: 1, vol: 0.7, cb: 0, calm: 0, big: 0,
    keys: {
      jump: ["Space", "ArrowUp", "KeyW"],
      duck: ["ArrowDown", "KeyS"],
      pause: ["KeyP", "Escape"],
      mute: ["KeyM"]
    }
  };

  function keyName(code) {
    if (!code) return "?";
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return "小键盘 " + code.slice(6);
    if (/^F\d{1,2}$/.test(code)) return code;
    return code.length === 1 ? code.toUpperCase() : code;
  }
  function keyNorm(code) {
    if (!code) return "";
    if (KEY_ALIAS[code]) return KEY_ALIAS[code];
    /* 只给 key 不给 code 的旧环境：把 "w" / "3" 归一成 code 写法，匹配得上默认键位 */
    if (/^[a-z]$/.test(code)) return "Key" + code.toUpperCase();
    if (/^[A-Z]$/.test(code)) return "Key" + code;
    if (/^\d$/.test(code)) return "Digit" + code;
    return code;
  }

  function loadSet() {
    var raw = null;
    try { raw = JSON.parse(store(KEY_SET) || "null"); } catch (e) { raw = null; }
    var o = { sfx: SET_DEF.sfx, vol: SET_DEF.vol, cb: 0, calm: 0, big: 0, keys: {} };
    var a;
    if (raw && typeof raw === "object") {
      o.sfx = (raw.sfx === 0 || raw.sfx === false) ? 0 : 1;
      var v = Number(raw.vol);
      o.vol = isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : SET_DEF.vol;
      o.cb = raw.cb ? 1 : 0;
      o.calm = raw.calm ? 1 : 0;
      o.big = raw.big ? 1 : 0;
      for (a = 0; a < KEY_ACTIONS.length; a++) {
        var act = KEY_ACTIONS[a], src = raw.keys && raw.keys[act], out = [];
        if (Object.prototype.toString.call(src) === "[object Array]") {
          for (var i = 0; i < src.length && out.length < KEY_MAX; i++) {
            if (typeof src[i] !== "string") continue;      // 脏数据（null / 数字）直接丢掉
            var c = keyNorm(src[i]);
            if (c && out.indexOf(c) < 0) out.push(c);
          }
        }
        if (!out.length) out = SET_DEF.keys[act].slice();      // 至少留一个键，别把动作绑空
        o.keys[act] = out;
      }
    } else {
      /* 从没存过设置：沿用老版本「runner-mute」的静音状态，其余用默认值 */
      o.sfx = store(KEY_MUTE) === "1" ? 0 : 1;
      for (a = 0; a < KEY_ACTIONS.length; a++) o.keys[KEY_ACTIONS[a]] = SET_DEF.keys[KEY_ACTIONS[a]].slice();
    }
    /* 同一个键不能同时绑两个动作：后出现的动作优先，前一个动作里删掉；删空了补默认 */
    var seen = {};
    for (var m = 0; m < KEY_ACTIONS.length; m++) {
      var ac = KEY_ACTIONS[m], keep = [];
      for (var n = 0; n < o.keys[ac].length; n++) {
        var kc = o.keys[ac][n];
        if (seen[kc]) continue;
        seen[kc] = 1; keep.push(kc);
      }
      o.keys[ac] = keep.length ? keep : SET_DEF.keys[ac].slice();
    }
    return o;
  }

  var SET = loadSet();

  function saveSet() {
    store(KEY_SET, JSON.stringify(SET));
    store(KEY_MUTE, SET.sfx ? "0" : "1");     // 老版本代码 / 旧缓存只认这个键，保持同步
  }
  function opt(name) { return !!SET[name]; }
  function cbOn() { return !!SET.cb; }
  function calmOn() { return !!SET.calm; }

  /* 无障碍的三项开关落在 <html> 的类名上，CSS 负责字号放大与关掉动效 */
  function applyA11y() {
    var de = document.documentElement;
    if (!de || !de.classList || !de.classList.toggle) return;
    de.classList.toggle("run-cb", !!SET.cb);
    de.classList.toggle("run-calm", !!SET.calm);
    de.classList.toggle("run-bigtext", !!SET.big);
  }

  function setOpt(name, val) {
    if (name === "vol") {
      var v = Number(val);
      SET.vol = isFinite(v) ? clamp(v, 0, 1) : SET.vol;
    } else if (name === "sfx" || name === "cb" || name === "calm" || name === "big") {
      SET[name] = val ? 1 : 0;
    } else {
      return null;                            // 未知选项：不改、不存
    }
    saveSet();
    applyA11y();
    syncSetUi();
    return SET[name];
  }

  function keyList(action) { return SET.keys[action] || []; }
  /* 命中判定：优先比 KeyboardEvent.code，再比归一化后的 key
     （老浏览器 / 合成事件可能只给其中一个） */
  function keyHit(action, e) {
    var list = keyList(action), k = keyNorm(e.key);
    for (var i = 0; i < list.length; i++) {
      if (list[i] === e.code || list[i] === k) return true;
    }
    return false;
  }
  function keyHint(action) {
    var list = keyList(action), out = [];
    for (var i = 0; i < list.length; i++) out.push(keyName(list[i]));
    return out.join(" / ") || "未设置";
  }
  function setKeys(next) {
    if (!next || typeof next !== "object") return null;
    var seen = {}, a, i;
    for (a = 0; a < KEY_ACTIONS.length; a++) {
      var act = KEY_ACTIONS[a], out = [];
      if (Object.prototype.toString.call(next[act]) === "[object Array]") {
        for (i = 0; i < next[act].length && out.length < KEY_MAX; i++) {
          if (typeof next[act][i] !== "string") continue;
          var c = keyNorm(next[act][i]);
          if (c && out.indexOf(c) < 0) out.push(c);
        }
      }
      if (out.length) SET.keys[act] = out;
    }
    /* 再去一次重复：同一个键只归最后一个动作 */
    for (a = KEY_ACTIONS.length - 1; a >= 0; a--) {
      var ac = KEY_ACTIONS[a], keep = [];
      for (i = 0; i < SET.keys[ac].length; i++) {
        var kc = SET.keys[ac][i];
        if (seen[kc]) continue;
        seen[kc] = 1; keep.push(kc);
      }
      SET.keys[ac] = keep.length ? keep : SET_DEF.keys[ac].slice();
    }
    saveSet();
    syncSetUi();
    return SET.keys;
  }
  function resetKeys() {
    for (var a = 0; a < KEY_ACTIONS.length; a++) SET.keys[KEY_ACTIONS[a]] = SET_DEF.keys[KEY_ACTIONS[a]].slice();
    saveSet();
    syncSetUi();
    return SET.keys;
  }
  function keyTaken(action, code) {            // 返回别的动作里占着这个键的名字（没有则 null）
    for (var a = 0; a < KEY_ACTIONS.length; a++) {
      if (KEY_ACTIONS[a] === action) continue;
      if (keyList(KEY_ACTIONS[a]).indexOf(code) >= 0) return KEY_ACTIONS[a];
    }
    return null;
  }
  function addKey(action, code) {
    code = keyNorm(code);
    if (!code) return null;
    var other = keyTaken(action, code);
    if (other) {                               // 一个键只能干一件事：从别的动作里摘掉
      var l = keyList(other);
      l.splice(l.indexOf(code), 1);
      toast("「" + keyName(code) + "」已从「" + KEY_ACT_CN[other] + "」移过来");
    }
    var cur = keyList(action);
    if (cur.indexOf(code) >= 0) return code;   // 已经绑过，幂等
    if (cur.length >= KEY_MAX) toast("每个动作最多绑 " + KEY_MAX + " 个键");
    else if (KEY_UNIQUE[action]) cur.length = 0;
    if (cur.indexOf(code) < 0) cur.push(code);
    saveSet();
    syncSetUi();
    return code;
  }
  function removeKey(action, code) {
    var cur = keyList(action), i = cur.indexOf(code);
    if (i < 0) return null;
    if (cur.length <= 1) { toast("「" + KEY_ACT_CN[action] + "」至少要留一个键"); return null; }
    cur.splice(i, 1);
    saveSet();
    syncSetUi();
    return code;
  }

  /* ═══════════ 皮肤仓库（static/skins.js，与商店页共用同一份） ═══════════
     正常情况下 skins.js 与本文件同目录同源、由页面先加载；万一没加载到，
     退回到内置的最小实现，至少不会白屏。 */
  var Skins = window.RunnerSkins;

  /* 成就系统（/ach.js，先于本脚本加载）：
     页面没引入时三个调用自动跳过，游戏本体不受影响。
     本局快照就直接用 S —— 成就模块只读 jumps/shields/smashes/dist/score/coins/speed/crashed。 */
  var Ach = window.RunnerAch || null;
  /* 云服务（/cloud.js）：头像走它的 avatar.*，未接入时头像功能整体降级为本地 */
  var CLOUD = window.WowCloud || null;
  function achLive() { if (Ach && Ach.live) Ach.live(S); }
  function achFinish() { if (Ach && Ach.finish) Ach.finish(S); }
  if (!Skins) {
    var DEF_P = { id: "classic", name: "经典火柴人", ink: "#28324a", inkNight: "#f2f5fa", scarf: "#ff5f6d", eye: "#28324a" };
    var DEF_C = { id: "gold", name: "经典金币", shape: "coin", dark: "#d99a1c", face: "#f7c33d", hi: "#ffe9a8", halo: "rgba(255,209,102,0.22)" };
    Skins = {
      getPlayer: function () { return DEF_P; },
      getCoin: function () { return DEF_C; },
      getWallet: function () { return 0; },
      addWallet: function () { return 0; },
      setWallet: function () { return 0; },
      equipped: function () { return null; },
      drawStick: function (c, sk, o) {                    // 简化火柴人
        o = o || {};
        var ink = (o.night ? sk.inkNight : sk.ink) || sk.ink;
        c.save(); c.scale(o.scale || 1, o.scale || 1);
        c.strokeStyle = sk.scarf; c.lineWidth = 4.6; c.lineCap = "round";
        c.beginPath(); c.moveTo(-2, -41);
        c.quadraticCurveTo(-14, -33, -25, -35); c.stroke();
        c.strokeStyle = ink; c.lineWidth = 4;
        c.beginPath();
        c.moveTo(1, -42); c.lineTo(0, -22);
        c.moveTo(0, -22); c.lineTo(-11, -1); c.moveTo(0, -22); c.lineTo(12, -1);
        c.moveTo(0, -37); c.lineTo(-10, -26); c.moveTo(0, -37); c.lineTo(11, -26);
        c.stroke();
        c.fillStyle = "#ffdfc6";
        c.beginPath(); c.arc(1, -52, 10, 0, 6.2832); c.fill();
        c.strokeStyle = ink; c.lineWidth = 1.5;
        c.beginPath(); c.arc(1, -52, 10, 0, 6.2832); c.stroke();
        c.fillStyle = "#28324a";
        c.beginPath(); c.arc(4.6, -53.4, 1.7, 0, 6.2832); c.fill();
        c.restore();
      },
      drawCoin: function (c, sk, o) {                     // 简化金币
        o = o || {};
        var cy = o.y + Math.sin((o.t || 0) * 5 + (o.ph || 0)) * 3;
        var rw = 5.5 + Math.abs(Math.sin((o.t || 0) * 3.2 + (o.ph || 0))) * 5.5;
        c.fillStyle = sk.dark;
        c.beginPath(); c.ellipse(o.x, cy, rw, 11, 0, 0, 6.2832); c.fill();
        c.fillStyle = sk.face;
        c.beginPath(); c.ellipse(o.x, cy, Math.max(1.5, rw - 2), 8.8, 0, 0, 6.2832); c.fill();
        c.fillStyle = sk.hi;
        c.beginPath(); c.ellipse(o.x, cy, Math.max(0.7, rw * 0.44), 4.8, 0, 0, 6.2832); c.fill();
      }
    };
  }

  /* 当前装备的皮肤（存档里的 id 失效时由 skins.js 回落到默认款） */
  var skinPlayer = Skins.getPlayer(Skins.equipped ? Skins.equipped("player") : null);
  var skinCoin = Skins.getCoin(Skins.equipped ? Skins.equipped("coin") : null);

  /* ═══════════ 基础工具 ═══════════ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  var random = Math.random;                       // 测试可替换
  function rnd(a, b) { return a + random() * (b - a); }
  function pick(arr) { return arr[Math.floor(random() * arr.length) % arr.length]; }

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) {}
    return null;
  }

  function hex2rgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function mix(a, b, t) {
    var A = hex2rgb(a), B = hex2rgb(b), o = "#";
    for (var i = 0; i < 3; i++) {
      var v = Math.round(A[i] + (B[i] - A[i]) * t);
      o += (v < 16 ? "0" : "") + v.toString(16);
    }
    return o;
  }
  function rgba(hex, a) { var c = hex2rgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  /* 圆角矩形路径（不依赖 ctx.roundRect，兼容老浏览器） */
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

  function pad5(n) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < 5) s = "0" + s;
    return s;
  }

  /* ═══════════ 音效（WebAudio 实时合成） ═══════════
     开关与音量都读设置（SET.sfx / SET.vol，见上面的「设置」块）：
     静音 = 不发声；音量为 0 也等于听不见，但两个开关互不覆盖，
     所以从静音切回来时音量还是原来的值。 */
  var Sfx = (function () {
    var ac = null;
    function ctxAudio() {
      if (ac) return ac;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (e) { ac = null; }
      return ac;
    }
    function live() { return !!SET.sfx && SET.vol > 0.001; }
    function tone(freq, dur, type, gain, slideTo) {
      var amp = (gain || 0.06) * SET.vol;
      if (!live() || amp <= 0.0002) return;
      var a = ctxAudio(); if (!a) return;
      if (a.state === "suspended" && a.resume) a.resume();
      var o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime;
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(dur, gain) {
      var amp = (gain || 0.15) * SET.vol;
      if (!live() || amp <= 0.0002) return;
      var a = ctxAudio(); if (!a) return;
      var len = Math.floor(a.sampleRate * dur);
      var buf = a.createBuffer(1, len, a.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var s = a.createBufferSource(), g = a.createGain();
      s.buffer = buf; g.gain.value = amp;
      s.connect(g); g.connect(a.destination); s.start();
    }
    function seq(freqs, gap, dur, type, gain) {
      freqs.forEach(function (f, i) {
        setTimeout(function () { tone(f, dur, type, gain); }, i * gap);
      });
    }
    return {
      jump:  function () { tone(430, 0.13, "square", 0.05, 780); },
      land:  function () { tone(150, 0.06, "sine", 0.035); },
      coin:  function () { tone(880, 0.07, "triangle", 0.05); setTimeout(function () { tone(1320, 0.09, "triangle", 0.045); }, 55); },
      boost: function () { seq([523, 659, 784, 1046], 70, 0.12, "triangle", 0.05); },
      crash: function () { noise(0.28, 0.16); tone(320, 0.42, "sawtooth", 0.07, 70); },
      best:  function () { seq([659, 784, 988, 1318], 110, 0.16, "square", 0.045); },
      isMuted: function () { return !SET.sfx; },
      setMuted: function (v) { SET.sfx = v ? 0 : 1; saveSet(); },
      volume: function () { return SET.vol; },
      setVolume: function (v) { setOpt("vol", v); },
      wake: function () { var a = ctxAudio(); if (a && a.state === "suspended" && a.resume) a.resume(); }
    };
  })();

  /* ═══════════ 昼夜调色板 ═══════════ */
  var PALETTES = [
    { name: "清晨", dark: false, top: "#9ed7ff", bottom: "#eaf6ff", far: "#c7dcef", mid: "#dbe9f6",
      ground: "#eef2f7", line: "#c3d2e0", ink: "#26313f", orb: "#ffd166", star: 0,   cloud: "#ffffff" },
    { name: "黄昏", dark: false, top: "#ffb187", bottom: "#ffe7c9", far: "#e0a98c", mid: "#f3cdae",
      ground: "#f6e6d6", line: "#d9bda4", ink: "#3b2a24", orb: "#ff8f5e", star: 0.15, cloud: "#fff0e2" },
    { name: "深夜", dark: true,  top: "#0b1723", bottom: "#1d3350", far: "#16324d", mid: "#0f2438",
      ground: "#16283a", line: "#0b1a28", ink: "#e8f1ff", orb: "#f3f0d8", star: 1,   cloud: "#20364c" },
    { name: "破晓", dark: true,  top: "#2a3b66", bottom: "#7d7fb0", far: "#3d4a75", mid: "#4b5686",
      ground: "#4b5470", line: "#333a52", ink: "#f2f5ff", orb: "#ffe9b0", star: 0.6, cloud: "#6a6f9c" }
  ];

  /* 按行进距离取当前配色；每两个阶段之间留出过渡带，避免生硬跳变 */
  function paletteAt(dist) {
    var n = PALETTES.length;
    var f = (dist / CFG.PHASE_DIST) % n;
    if (f < 0) f += n;
    var i = Math.floor(f), t = f - i;
    var a = PALETTES[i], b = PALETTES[(i + 1) % n];
    var tt = t < 0.65 ? 0 : (t - 0.65) / 0.35;      // 前 65% 保持，后 35% 平滑过渡
    return {
      name: tt < 0.5 ? a.name : b.name,
      dark: tt < 0.5 ? a.dark : b.dark,
      top: mix(a.top, b.top, tt), bottom: mix(a.bottom, b.bottom, tt),
      far: mix(a.far, b.far, tt), mid: mix(a.mid, b.mid, tt),
      ground: mix(a.ground, b.ground, tt), line: mix(a.line, b.line, tt),
      ink: mix(a.ink, b.ink, tt), orb: mix(a.orb, b.orb, tt),
      cloud: mix(a.cloud, b.cloud, tt),
      star: a.star + (b.star - a.star) * tt,
      nightK: (a.dark ? 1 : 0) + ((b.dark ? 1 : 0) - (a.dark ? 1 : 0)) * tt
    };
  }

  /* ── 色盲模式的配色修正（受「设置 → 无障碍 → 色盲模式」控制）──
     红绿色觉异常的人分不清红/绿、也很难分辨相近明度的暖色，所以：
       · 地线 / 轮廓 / 土层拉到极限对比（白天近黑、夜晚近白），前后景一眼分开
       · 日月与所有「危险色」统一成琥珀黄（红绿色盲最容易辨认的色相）
       · 黄昏那一档的红橙天空压成蓝青，避免整屏暖色糊成一片
     障碍与金币的形状线索在 drawObstacle / drawItem 里另外加（描边 + 斜纹 + 外圈）。 */
  function cbPalette(p) {
    if (!SET.cb) return p;
    var q = {};
    for (var k in p) if (p.hasOwnProperty(k)) q[k] = p[k];
    q.dark = p.dark;
    q.line = p.dark ? "#ffffff" : "#0b1420";
    q.ground = p.dark ? "#0a1622" : "#f4f8fc";
    q.ink = p.dark ? "#ffffff" : "#0b1420";
    q.orb = "#ffb020";
    q.far = p.dark ? "#0e2130" : "#c9dcee";
    q.mid = p.dark ? "#16293c" : "#e6eff8";
    q.top = p.dark ? "#0b1a2a" : "#9fd3f5";
    q.bottom = p.dark ? "#1b3250" : "#eaf6ff";
    q.cloud = p.dark ? "#20364c" : "#ffffff";
    return q;
  }

  /* ═══════════ 场景装饰（程序化生成，只算一次） ═══════════ */
  var SKYLINE = (function () {
    var arr = [], x = 0, seed = 20261001;
    function nx() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; }
    while (x < 2600) {
      var w = 46 + Math.floor(nx() * 66);
      var h = 60 + Math.floor(nx() * 150);
      arr.push({ x: x, w: w, h: h, light: nx() });
      x += w + 12 + Math.floor(nx() * 30);
    }
    return arr;
  })();

  var CLOUDS = (function () {
    var arr = [];
    for (var i = 0; i < 6; i++) arr.push({ x: i * 210 + 40 * i % 90, y: 34 + (i * 53 % 76), s: 0.6 + (i % 3) * 0.28 });
    return arr;
  })();

  /* ═══════════ 运行状态 ═══════════ */
  var state = "ready";        // ready | playing | paused | over
  var S = null;               // 局面数据
  var P = null;               // 角色
  var obstacles = [], items = [], parts = [];
  var debris = [];                             // 被无敌撞碎的障碍：短暂存活、被打飞、淡出
  var input = { jumpHeld: false, duckHeld: false };
  var shake = 0, overAt = 0, lastBest = 0;
  var prevState = "ready";    // 玩法说明打开前的界面状态：关掉说明后原样回到这个界面
  var bgDist = 0;             // 背景滚动距离（非游戏中也缓慢流动）

  function newState() {
    return {
      speed: CFG.SPEED0, dist: 0, score: 0, coins: 0, earned: 0,
      spawnGap: 520, itemGap: 900, boost: 0, banked: false,
      itemHold: 0, waveHold: 0,                 // 障碍/道具互相避让的距离闸门
      shieldHold: 0,                            // 下一个护盾最早出现的距离（护盾冷却）
      itemPending: false,                       // 金币到点待生成：障碍先让路
      waves: 0, groups: 0,                      // 本局生成的障碍波数 / 道具串数（调试用）
      time: 0, best: lastBest, isBest: false,
      /* ── 成就统计（本局，ach.js 只读） ── */
      jumps: 0,                                 // 本局起跳次数
      shields: 0,                               // 本局吃到的护盾数
      smashes: 0,                               // 本局在无敌状态下撞碎的障碍数（= 碰到过障碍）
      crashed: false                            // 本局是否以撞死收场（「无伤」成就要排除）
    };
  }

  function resetGame() {
    S = newState();
    P = { y: CFG.GROUND, vy: 0, onGround: true, duck: false, crouch: 0, coyote: 0, run: 0 };
    obstacles.length = 0; items.length = 0; parts.length = 0; debris.length = 0;
    itemLog.length = 0;                            // 道具出生记录也一起清
    input.jumpHeld = false; input.duckHeld = false;
    shake = 0;
    state = "ready";
    showOverlay("ready");
    updateHud();
  }

  /* ═══════════ 障碍 / 道具 ═══════════ */
  var GROUND_KINDS = [
    { id: "cup",   w: 32, h: 46 },
    { id: "box",   w: 46, h: 52 },
    { id: "cone",  w: 36, h: 50 },
    { id: "stack", w: 44, h: 72 }
  ];
  var AIR_KINDS = [                            // 飞行物统一宽度 = 图片固有比例（高 93 → 宽 28），id 仅作记录
    { id: "paper", w: 28 },
    { id: "drone", w: 28 }
  ];

  function addObstacle(kind, x, hOverride) {
    var def = kind === "air" ? pick(AIR_KINDS) : pick(GROUND_KINDS);
    var h = kind === "air" ? CFG.AIR_H : (hOverride || def.h);
    var o = {
      kind: kind, id: def.id, x: x, w: def.w, h: h,
      phase: random() * 6.28
    };
    if (kind === "air") {
      /* 飞行障碍 = 无绳悬浮的雪碧瓶：瓶身贴图就画在碰撞盒上（所见即所撞）。
         顶在离地 ≈137（比满跳脚底 ≈155 低 18px）→ 提前起跳可以从上面整个
         越过去；底在离地 44 → 蹲着能钻、站着跑会撞。跳或蹲都行，但必须二选一。 */
      o.y = CFG.GROUND - CFG.AIR_GAP - CFG.AIR_H;
    } else {
      o.y = CFG.GROUND - h;
    }
    obstacles.push(o);
    return o;
  }

  /* ── 道具出生记录（调试/测试用：核对每颗金币是不是真的吃得到） ── */
  var itemSeq = 0;                             // 道具自增 id：外部（测试）可精确追踪同一颗金币
  var itemLog = [];
  function logItem(it) {
    if (itemLog.length >= 800) return;
    itemLog.push({
      id: it.id, kind: it.kind, x0: it.x, y: it.y, r: it.r,
      h: CFG.GROUND - it.y,                       // 出生时中心离地高度
      dist: S ? S.dist : 0, speed: S ? S.speed : 0
    });
  }

  function addFishArc(x, count) {
    /* 拱顶 ≤ 148px 可达（满跳脚底 155px、判定半径 33 → 玩家中心最高够到 ~157px），
       旧参数 78+rnd(0,46) 时拱顶最高 158px，最高处几颗永远吃不到 */
    var baseY = CFG.GROUND - (76 + rnd(0, 30));
    var ph = rnd(0, 6.28);                        // 整串同相位浮动，排列整齐不东倒西歪
    var span = Math.max(1, count - 1);
    for (var i = 0; i < count; i++) {
      var it = {
        id: ++itemSeq, kind: "coin", x: x + i * 42, r: 11, ph: ph,
        y: baseY - Math.sin(i / span * Math.PI) * 34
      };
      items.push(it);
      logItem(it);
    }
    return span * 42 + 22;                        // 整串宽度（给「后方空档」用）
  }
  function addCoffee(x) {
    var it = { id: ++itemSeq, kind: "coffee", x: x, y: CFG.GROUND - 74 - rnd(0, 40), r: 14, ph: 0 };
    items.push(it);
    logItem(it);
  }
  /* [x0, x1] 区间是否没有障碍（生成道具用） */
  function areaClear(x0, x1) {
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.x < x1 && o.x + o.w > x0) return false;
    }
    return true;
  }
  /* [x0, x1] 区间是否没有道具（生成障碍用，防止金币卡进障碍里） */
  function itemsClear(x0, x1) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.x > x0 - 30 && it.x < x1 + 30) return false;
    }
    return true;
  }

  /* ═══════════ 粒子 ═══════════ */
  function puff(x, y, n, color, spread) {
    if (calmOn()) n = Math.max(1, Math.round(n * 0.35));    // 减少闪烁：粒子也减量
    for (var i = 0; i < n; i++) {
      parts.push({
        x: x, y: y, vx: -rnd(20, 120), vy: -rnd(10, 90) * (spread || 1),
        life: rnd(0.28, 0.6), max: 0.6, r: rnd(1.6, 3.6), c: color || "#c9d3de", g: 260
      });
    }
  }
  function sparkle(x, y, n, color) {
    if (calmOn()) n = Math.max(1, Math.round(n * 0.35));
    for (var i = 0; i < n; i++) {
      var a = rnd(0, 6.28), sp = rnd(60, 220);
      parts.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: rnd(0.3, 0.65), max: 0.65, r: rnd(1.6, 3.4), c: color || "#ffd166", g: 300
      });
    }
  }
  /* 色盲模式：危险相关的高亮统一换成琥珀黄（红绿色觉异常最容易辨认的色相） */
  function dangerColor() { return cbOn() ? "#ffb020" : "#ff7a86"; }

  /* ═══════════ 操作 ═══════════ */

  /* ── 蹲下 / 起立 的过渡 ──
     以前 P.duck 一翻，姿态当帧就在「站立」和「蹲下」两套骨架之间硬切，能看出跳变。
     现在用进度量 P.crouch（0 站立 → 1 蹲下）描述这次转换：
       · 按键只改**目标值**，进度按各自时长匀速推进（CROUCH_IN 蹲下 / CROUCH_OUT 起立）；
       · 画出来、算高度时再套 smoothstep（= ease-in-out，两头慢中间快），
         所以起步和收尾都不突兀，中途也不拖沓。
     反向打断（按一下就松开）时进度只是掉头往回走，数值本身连续，不会闪。 */
  function easeCrouch(t) {                         // smoothstep：ease-in-out 曲线
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function crouchK() {                             // 已缓动的过渡进度
    return easeCrouch(P.crouch);
  }

  function crouchVisH() {                          // 画面上的身高：站立 62 → 蹲下 34
    return CFG.STAND_H + (CFG.DUCK_H - CFG.STAND_H) * crouchK();
  }

  function updateCrouch(dt) {
    var target = P.duck ? 1 : 0;
    if (P.crouch === target) return;
    var stepT = dt / (target > P.crouch ? CFG.CROUCH_IN : CFG.CROUCH_OUT);
    P.crouch = clamp(P.crouch + (target > P.crouch ? stepT : -stepT), 0, 1);
    if (Math.abs(P.crouch - target) < 1e-4) P.crouch = target;   // 收尾对齐，避免永远差一点点
  }

  /* 命中盒高度：
     · 下蹲键一按就**立刻**收到最低（保持原本「按下即安全」的手感，不让玩家吃过渡的亏）；
     · 起立时则跟着动画一起长高 —— 「画面上还蹲着、却被判定成站着撞死」是最不能接受的。
     等价于「取即时高度和画面高度的较小者」。 */
  function curH() {
    if (P.duck) return CFG.DUCK_H;
    return Math.min(CFG.STAND_H, crouchVisH());
  }

  function doJump() {
    if (state !== "playing") return;
    if (P.onGround || P.coyote > 0) {
      P.vy = CFG.JUMP_V;
      P.onGround = false;
      P.coyote = 0;
      P.duck = false;
      S.jumps++;                                   // 成就：单局起跳次数
      puff(CFG.PX, CFG.GROUND, 6, "#ffffff", 0.6);
      Sfx.jump();
    }
  }

  function applyDuck(on) {
    if (state !== "playing") return;
    P.duck = on;
  }

  function togglePause() {
    if (state === "playing") { state = "paused"; showOverlay("paused"); }
    else if (state === "paused") { state = "playing"; hideOverlay(); Sfx.wake(); }
  }

  function startGame() {
    var prevBest = lastBest;
    resetGame();
    lastBest = prevBest;
    S.best = prevBest;
    state = "playing";
    hideOverlay();
    updateHud();
    Sfx.wake();
  }

  function gameOver() {
    state = "over";
    overAt = Date.now();
    S.crashed = true;                            // 成就：「无伤」类要排除撞死收场的局
    shake = calmOn() ? 0 : 16;
    puff(CFG.PX, P.y - 20, 18, "#8d98a6", 1.4);
    sparkle(CFG.PX, P.y - 34, 12, dangerColor());
    Sfx.crash();

    var score = Math.floor(S.score);
    S.isBest = score > S.best;
    if (S.isBest) {
      S.best = score;
      lastBest = score;
      store(KEY_BEST, String(score));
      Sfx.best();
      toast("🎉 新纪录！");
    }
    saveRecord(score);
    S.earned = bankCoins();                      // 本局金币进钱包（S.banked 保证只入账一次）
    showOverlay("over");
    updateHud();
    /* 交给云端排行榜：未登录时 rank.js 不会发任何请求。
       durationMs 是本局的**游戏内用时**（S.time 只在 playing 时累加，暂停不算），
       服务端靠它校验成绩的物理可行性：位置推进 = Σ 速度×dt、用时 = Σ dt，
       有效速度恒在 [330, 1038] px/s，所以「距离 ↔ 用时」会互相锁死。 */
    try {
      document.dispatchEvent(new CustomEvent("run:over", {
        detail: {
          score: score,
          coins: S.coins,
          distance: Math.floor(S.dist / 100),
          durationMs: Math.round(S.time * 1000)
        }
      }));
    } catch (e) {}
    /* 成就结算：这一局没实时解锁的（分数 / 里程 / 无伤 / 累计类）在这里统一补判 */
    achFinish();
  }

  /* ═══════════ 本机记录（localStorage，最多 5 条） ═══════════ */
  function loadRecords() {
    try {
      var raw = store(KEY_SCORES);
      var arr = raw ? JSON.parse(raw) : [];
      return Object.prototype.toString.call(arr) === "[object Array]" ? arr : [];
    } catch (e) { return []; }
  }
  function saveRecord(score) {
    if (score <= 0) return;
    var arr = loadRecords();
    arr.push({ s: score, t: Date.now() });
    arr.sort(function (a, b) { return b.s - a.s; });
    arr = arr.slice(0, 5);
    try { store(KEY_SCORES, JSON.stringify(arr)); } catch (e) {}
  }
  function renderRecords() {
    if (!elRecords) return;
    var arr = loadRecords();
    if (!arr.length) { elRecords.innerHTML = ""; return; }
    var html = "";
    for (var i = 0; i < arr.length; i++) {
      var d = new Date(arr[i].t);
      html += "<li><b>#" + (i + 1) + "</b><span>" + arr[i].s + " 分</span><span>" +
        (d.getMonth() + 1) + "/" + d.getDate() + "</span></li>";
    }
    elRecords.innerHTML = html;
  }

  /* ═══════════ 遮罩层 ═══════════ */
  var SHOP_LINK = "<button type='button' class='run-shop-link' data-open-me>皮肤商店</button>";

  /* ── 玩法说明 ──
     第一次打开游戏时自动弹一次，本机记下「已读」（runner-help-seen），之后再来就不打扰；
     工具条上的「玩法」按钮已经拿掉，设置面板里随时可以重新打开。
     弹窗打开期间是一道硬门：键盘（空格 / Enter / Esc）、点画面、屏幕上的「跳跃 / 下蹲」
     全部不生效，只有卡片最底下的「我知道了」能把它关掉。 */
  var helpVisible = false;

  function helpOpen() { return helpVisible; }

  function helpSeen() {
    /* 存储被禁用（隐私模式 / 拒绝 Cookie）时当作「已读」，不然每次进来都被拦一道 */
    try { return localStorage.getItem(KEY_HELP) === "1"; } catch (e) { return true; }
  }
  function markHelpSeen() {
    try { localStorage.setItem(KEY_HELP, "1"); } catch (e) {}
  }

  /* 帮助文本里的键位跟着自定义按键走，改完键这里立刻同步 */
  function helpHtml() {
    return "地面的障碍要 <b>跳过</b>；天上的悬浮雪碧瓶 <b>跳过去</b> 或 <b>蹲下去</b> 都行" +
      "（瓶子只有 1.5 倍身高，提前起跳能整个越过去；蹲着能从下面钻过，站着跑会撞上）；<br>" +
      "金币 +10 分并存入钱包，<em>护盾</em> 让你 3.6 秒无敌：无敌期间可以直接撞碎障碍，额外加分。<br>" +
      "钱包里的金币可以到商店兑换火柴人皮肤和金币皮肤。<br>" +
      "速度会越来越快，坚持越久分数越高。";
  }

  function showOverlay(kind) {
    if (!elOverlay) return;
    elOvBtn.dataset.mode = "";
    elOverlay.classList.remove("hidden");
    /* 玩法说明铺满整屏（见 .run-overlay.is-help），把工具条一起挡在下面 */
    elOverlay.classList.toggle("is-help", kind === "help");
    if (kind === "ready") {
      elOvTitle.textContent = "火柴人快跑";
      elOvText.innerHTML = "按 <b>" + keyHint("jump") + "</b> 起跳，长按跳更高；<b>" +
        keyHint("duck") + "</b> 下蹲钻过天上的悬浮雪碧瓶。";
      elOvBtn.textContent = "开始游戏";
      renderRecords();
    } else if (kind === "paused") {
      elOvTitle.textContent = "已暂停";
      elOvText.innerHTML = "按 <b>" + keyHint("pause") + "</b> 或点下面的按钮继续。";
      elOvBtn.textContent = "继续";
      elRecords.innerHTML = "";
    } else if (kind === "over") {
      elOvTitle.textContent = S.isBest ? "🎉 新纪录！" : "本轮结束";
      elOvText.innerHTML = "<span class='run-big'>" + Math.floor(S.score) + "</span>" +
        "最高分 <b>" + Math.floor(S.best) + "</b> ｜ 跑了 <b>" + Math.floor(S.dist / 100) + "</b> 米<br>" +
        "本局金币 <b>" + S.coins + "</b> 枚 ｜ 钱包余额 <b>" + Skins.getWallet() + "</b> 💰<br>" + SHOP_LINK;
      elOvBtn.textContent = "再来一局";
      renderRecords();
    } else if (kind === "help") {
      elOvTitle.textContent = "玩法说明";
      elOvText.innerHTML = helpHtml();
      elOvBtn.textContent = "我知道了";
      elOvBtn.dataset.mode = "help";        // 只有这个按钮能把说明关掉
      elRecords.innerHTML = "";
    }
  }
  function hideOverlay() {
    if (!elOverlay) return;
    elOverlay.classList.add("hidden");
    elOverlay.classList.remove("is-help");
  }

  /* ═══════════ 皮肤商店（就在本页弹层里，不跳页） ═══════════
     shop.js 负责商品与购买，这里只管「逛店时把局面定格、关掉后原样恢复」。 */
  var shopPrev = null;                       // 进商店前的游戏状态

  function shopOpen() { return !!elShop && !elShop.classList.contains("hidden"); }
  function rankOpen() { return !!elRank && !elRank.classList.contains("hidden"); }
  function achOpen() { return !!(Ach && Ach.isOpen && Ach.isOpen()); }

  function refreshSkin() {                   // 换上的皮肤立刻生效
    skinPlayer = Skins.getPlayer(Skins.equipped ? Skins.equipped("player") : null);
    skinCoin = Skins.getCoin(Skins.equipped ? Skins.equipped("coin") : null);
    updateHud();
  }

  /* 个人中心在「商店 / 成就」两个页面之间切换时，面板只是换了个内容：
     先关旧面板、再开新面板会各触发一次「定格 / 恢复」，中途还会闪一下遮罩。
     用 meSwitching 把这两次都跳过，游戏状态与 shopPrev 保持不动。 */
  var meSwitching = false;

  function afterShopOpen() {
    if (meSwitching) return;
    shopPrev = state;
    if (state === "playing") state = "paused";   // 逛商店时先定格，回来再接着跑
    hideOverlay();
  }

  function afterShopClose() {
    if (meSwitching) return;
    if (shopPrev === "playing") { state = "playing"; hideOverlay(); }
    else if (shopPrev === "over") showOverlay("over");
    else if (shopPrev === "paused") showOverlay("paused");
    else showOverlay("ready");
    shopPrev = null;
    refreshSkin();
  }

  /* 个人中心：商店 / 成就 / 个人 三个页面共用一个入口（工具条「个人中心」按钮 / 页脚链接 / 面板页签）。
     已经在该页面时什么都不做；从另一个页面切过来时不走定格/恢复（见 meSwitching）。 */
  var ME_TABS = ["shop", "ach", "me"];

  function meTabOpen(t) {
    if (t === "shop") return shopOpen();
    if (t === "ach") return achOpen();
    return meOpen();
  }
  function openMeTab(t) {
    if (t === "shop") openShop();
    else if (t === "ach") { if (Ach && Ach.open) Ach.open(); }
    else openMePanel();
  }
  function closeMeTab(t) {
    if (t === "shop") closeShop();
    else if (t === "ach") { if (Ach && Ach.close) Ach.close(); }
    else closeMePanel();
  }
  function anyMeTabOpen() {
    for (var i = 0; i < ME_TABS.length; i++) if (meTabOpen(ME_TABS[i])) return ME_TABS[i];
    return null;
  }

  function openMe(tab) {
    if (helpVisible) return;                          // 玩法说明开着时先看说明
    var want = (tab === "ach" || tab === "me") ? tab : "shop";
    if (meTabOpen(want)) return;                      // 已经停在这个页面
    var cur = anyMeTabOpen();
    if (cur) {                                        // 另一个页面正开着 → 是页签切换
      meSwitching = true;
      try { closeMeTab(cur); openMeTab(want); } finally { meSwitching = false; }
      return;
    }
    openMeTab(want);                                  // 首次打开
  }

  function openShop() {
    if (!elShop || shopOpen() || helpVisible) return;
    if (window.Shop && window.Shop.open) window.Shop.open();   // open() 会派发 shop:open
    else { elShop.classList.remove("hidden"); afterShopOpen(); }
  }
  function closeShop() {
    if (!shopOpen()) return;
    if (window.Shop && window.Shop.close) window.Shop.close(); // close() 会派发 shop:close
    else { elShop.classList.add("hidden"); afterShopClose(); }
  }

  /* ═══════════ 个人中心「个人」页：头像 + 成就进度 ═══════════ */
  function meOpen() { return !!elMe && !elMe.classList.contains("hidden"); }

  function openMePanel() {
    if (!elMe || meOpen() || helpVisible) return;
    elMe.classList.remove("hidden");
    renderMe();
    document.dispatchEvent(new CustomEvent("me:open"));   // 借这条让局面定格
    avatarAlign();                                        // 顺手和云端对齐一次头像
  }
  function closeMePanel() {
    if (!meOpen()) return;
    elMe.classList.add("hidden");
    document.dispatchEvent(new CustomEvent("me:close"));
  }

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ── 头像 ──
     本地一份（runner-avatar）+ 云端一份（runner_scores.avatar，公开列，排行榜读它）。
     选图 → canvas 居中裁正方形 → 压到 96×96 webp（不支持 webp 就退 jpeg），一张约 2~6KB。
     云存储那条路走不通：它只发短时效签名链接、且只给登录用户，而排行榜对所有访客开放。 */
  var AVATAR_SIDE = 96;
  var AVATAR_MAX_BYTES = 8 * 1024 * 1024;   // 原图上限：再大就先劝退，别把浏览器拖死

  function avatarLocal() { return (CLOUD && CLOUD.avatar) ? CLOUD.avatar.get() : ""; }

  function renderAvatar() {
    var av = avatarLocal();
    if (elMeAvaImg) {
      if (av) {
        if (elMeAvaImg.getAttribute("src") !== av) elMeAvaImg.src = av;
        elMeAvaImg.classList.remove("hidden");
      } else {
        elMeAvaImg.removeAttribute("src");
        elMeAvaImg.classList.add("hidden");
      }
    }
    if (elMeAvaPh) elMeAvaPh.classList.toggle("hidden", !!av);
    if (btnMeClear) btnMeClear.classList.toggle("hidden", !av);
  }

  function compressAvatar(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || "")) { reject(new Error("请选择图片文件")); return; }
      if (file.size > AVATAR_MAX_BYTES) { reject(new Error("图片太大了（超过 8MB），换一张小一点的")); return; }
      if (!window.FileReader || !document.createElement) {
        reject(new Error("这个浏览器不支持图片处理")); return;
      }
      /* ⚠️ 必须用 FileReader 读成 data URL 再喂给 <img>，不能用 URL.createObjectURL：
         本站 CSP 是 img-src 'self' data:，blob: 会被拦下（表现为 img.onerror），选图就永远失败。 */
      var fr = new FileReader();
      var done = false;
      var once = function (fn) {
        return function (v) {
          if (done) return;
          done = true;
          fn(v);
        };
      };
      fr.onerror = once(function () { reject(new Error("这张图读不出来，换一张试试")); });
      fr.onload = once(function () {
        var src = String(fr.result || "");
        if (src.indexOf("data:image/") !== 0) { reject(new Error("这张图读不出来，换一张试试")); return; }
        var img = new Image();
        img.onerror = function () { reject(new Error("这张图读不出来，换一张试试")); };
        img.onload = function () {
          try {
            var side = AVATAR_SIDE;
            var cv = document.createElement("canvas");
            cv.width = side; cv.height = side;
            var ctx = cv.getContext && cv.getContext("2d");
            if (!ctx) { reject(new Error("这个浏览器不支持图片处理")); return; }
            var w = img.naturalWidth || img.width || side;
            var h = img.naturalHeight || img.height || side;
            var s = Math.min(w, h) || side;                    // 居中取正方形
            ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, side, side);
            var out = "";
            try { out = cv.toDataURL("image/webp", 0.72); } catch (e) {}
            if (!out || out.indexOf("data:image/webp") !== 0) out = cv.toDataURL("image/jpeg", 0.8);
            if (!out || out.indexOf("data:image/") !== 0) { reject(new Error("图片转换失败，换一张试试")); return; }
            resolve(out);
          } catch (e) { reject(e); }
        };
        img.src = src;
      });
      try { fr.readAsDataURL(file); } catch (e) { reject(new Error("这张图读不出来，换一张试试")); }
    });
  }

  function saveAvatar(dataUrl) {
    if (!CLOUD || !CLOUD.avatar) { toast("头像功能暂时不可用，请刷新页面重试"); return Promise.resolve(); }
    return CLOUD.avatar.set(dataUrl).then(function (r) {
      renderAvatar();
      if (r && r.error) toast(CLOUD.describe ? CLOUD.describe(r.error) : "头像保存失败");
      else if (r && r.localOnly) toast(dataUrl ? "头像已保存（登录后会同步到排行榜）" : "头像已移除");
      else toast(dataUrl ? "头像已更新，排行榜上也会一起换" : "头像已移除");
    });
  }

  function pickAvatar() {
    if (!CLOUD || !CLOUD.avatar) { toast("头像功能暂时不可用，请刷新页面重试"); return; }
    if (!elMeFile) return;
    try { elMeFile.value = ""; } catch (e) {}
    elMeFile.click();
  }

  function onAvatarFile() {
    var f = elMeFile && elMeFile.files && elMeFile.files[0];
    if (!f) return;
    compressAvatar(f).then(function (dataUrl) { return saveAvatar(dataUrl); })
      .catch(function (e) { toast((e && e.message) || "图片处理失败，换一张试试"); });
  }

  /* 打开个人页时与云端对齐：本机没存过脸而云端有 → 捡回来；本地有但没推上去 → 补推 */
  function avatarAlign() {
    var C = CLOUD && CLOUD.avatar;
    if (!C || !C.sync) { renderAvatar(); return; }
    C.restore().then(function (r) {
      if (r && r.ok) renderAvatar();
      return C.sync();
    }).then(function () { renderAvatar(); })["catch"](function () {});
  }

  /* ── 成就进度（只有一条总进度：成就已不分档，用户 2026-10-05 要求） ── */
  function renderMeAch() {
    var snap = (Ach && Ach.snapshot) ? Ach.snapshot() : null;
    if (!snap) return;
    var got = snap.unlocked || 0, total = snap.total || 0;
    if (elMeGot) elMeGot.textContent = got;
    if (elMeTotal) elMeTotal.textContent = total;
    if (elMeBarFill) elMeBarFill.style.width = (total ? Math.round(got * 100 / total) : 0) + "%";
    if (elMeBar) {
      elMeBar.setAttribute("aria-valuemax", String(total));
      elMeBar.setAttribute("aria-valuenow", String(got));
    }
  }

  function renderMe() {
    if (elMeNick) elMeNick.textContent = CLOUD ? CLOUD.nickOrDefault() : "无名火柴人";
    var logged = !!(CLOUD && CLOUD.user && CLOUD.user());
    if (elMeSub) {
      elMeSub.textContent = logged
        ? "已登录 · 头像与成就跟账号走，换设备也在"
        : "未登录 · 头像只存在本机，登录后才会出现在排行榜";
    }
    if (elMeHint) {
      elMeHint.textContent = logged
        ? "头像会公开显示在云端排行榜上。建议用正方形图片，会自动裁成圆形并压缩。"
        : "头像公开显示在云端排行榜上，需要先登录；未登录时只在本机可见。";
    }
    renderAvatar();
    renderMeAch();
  }

  document.addEventListener("shop:open", afterShopOpen);
  document.addEventListener("shop:close", afterShopClose);
  document.addEventListener("shop:change", refreshSkin);       // 买完立即换装
  /* 云端排行榜弹层用的是同一套「开面板先定格、关掉原样恢复」逻辑 */
  document.addEventListener("rank:open", afterShopOpen);
  document.addEventListener("rank:close", afterShopClose);
  /* 成就面板同理（ach.js 负责开关与渲染，这里只管局面定格/恢复） */
  document.addEventListener("ach:open", afterShopOpen);
  document.addEventListener("ach:close", afterShopClose);
  /* 设置面板同理：打开时定格（改键 / 试听音效都不该让角色在背后跑） */
  document.addEventListener("set:open", afterShopOpen);
  document.addEventListener("set:close", afterShopClose);
  /* 个人中心「个人」页同理（开关在 runner.js 自己手里） */
  document.addEventListener("me:open", afterShopOpen);
  document.addEventListener("me:close", afterShopClose);
  /* 成就解锁 / 云端同步后，个人页的进度条跟着动（页面开着时才重画） */
  document.addEventListener("ach:sync", function () { if (meOpen()) renderMeAch(); });
  document.addEventListener("cloud:avatar", function () { renderAvatar(); if (meOpen()) renderMe(); });
  /* rank.js 借这里弹提示（成绩上传结果、云存档同步结果） */
  document.addEventListener("run:toast", function (e) { if (e.detail) toast(e.detail); });

  var toastTimer = null;
  function toast(msg) {
    if (!elToast) return;
    elToast.textContent = msg;
    elToast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.classList.remove("show"); }, 1800);
  }

  function updateHud() {
    if (elScore) elScore.textContent = "得分：" + pad5(S ? S.score : 0);
    if (elBest) elBest.textContent = "最高：" + pad5(lastBest);
    if (elCoins) elCoins.textContent = "金币 " + (S ? S.coins : 0);
    if (elWallet) elWallet.textContent = "钱包 " + Skins.getWallet();
  }

  /* 局末把本局收集的金币存进钱包；S.banked 保证同一局只入账一次 */
  function bankCoins() {
    if (!S || S.banked || S.coins <= 0) return 0;
    S.banked = true;
    Skins.addWallet(S.coins);
    return S.coins;
  }

  /* ═══════════ 主逻辑步进 ═══════════ */
  function step(dt) {
    /* 蹲下 / 起立的过渡：暂停时定格，其它状态照常推进（免得死在半蹲上定住不动） */
    if (state !== "paused") updateCrouch(dt);

    if (state !== "playing") {
      bgDist += 40 * dt;
      updateParticles(dt);
      updateDebris(dt);
      if (shake > 0) shake = Math.max(0, shake - 60 * dt);
      return;
    }

    var boosting = S.boost > 0;
    S.time += dt;
    S.speed = Math.min(CFG.SPEED_MAX, CFG.SPEED0 + CFG.SPEED_ACC * S.time);
    var move = S.speed * dt;

    S.dist += move;
    S.score += move * CFG.SCORE_PER_PX;
    if (boosting) {
      S.boost = Math.max(0, S.boost - dt);
      if (S.boost <= 0) endBoost();                // 归零：清掉贴脸障碍、重置出障碍节奏
    }

    /* ── 角色物理 ── */
    if (P.onGround) P.y = CFG.GROUND;
    P.coyote = P.onGround ? CFG.COYOTE : Math.max(0, P.coyote - dt);
    P.vy += CFG.GRAVITY * dt;
    if (!P.onGround && input.duckHeld) P.vy += CFG.FAST_FALL * dt;
    if (!input.jumpHeld && P.vy < CFG.JUMP_CUT_MIN) P.vy += CFG.JUMP_CUT * dt;
    P.y += P.vy * dt;

    if (P.y >= CFG.GROUND) {
      if (!P.onGround) { puff(CFG.PX, CFG.GROUND, 5, "#ffffff", 0.5); Sfx.land(); }
      P.y = CFG.GROUND; P.vy = 0; P.onGround = true;
    } else {
      P.onGround = false;
    }
    P.run += (P.onGround ? S.speed : 0) * dt * 0.055;
    if (P.onGround && !P.duck && random() < 0.16) puff(CFG.PX - 12, CFG.GROUND, 1, "#ffffff", 0.35);

    /* ── 生成障碍 ──
       · waveHold：金币串刚过去没多久就不放障碍，免得玩家刚吃完金币、人还在空中就撞上；
       · itemPending：金币已经「到点该生成」但跑道还没空出来时，障碍先让路，
         否则障碍比跑道还密的话，金币会被无限期挤掉（永远等不到空档）；
       · itemsClear：出生点附近有道具时先避让，防止道具卡进障碍里。 */
    var boostTail = boosting && S.boost <= CFG.BOOST_TAIL;   // 无敌收尾：只收尾、不出新障碍
    S.spawnGap -= move;
    if (S.spawnGap <= 0) {
      if (!boostTail && !S.itemPending && S.dist >= S.waveHold && itemsClear(CFG.W + 40, CFG.W + 140)) {
        spawnWave();
        S.spawnGap = S.speed * rnd(CFG.GAP_MIN, CFG.GAP_MAX);
      } else {
        S.spawnGap = 140;                        // 被挡：往前挪一点再试，不整波吞掉
      }
    }

    /* ── 生成道具 ──
       护盾已改为纯无敌：不再有「无敌冲刺金币雨」，无敌期间照常出
       金币串与护盾（itemHold + areaClear 跑道闸门）。 */
    S.itemGap -= move;
    if (S.itemGap <= 0) {
      /* 金币落点的两个前提：
           ① 距上一波障碍已过去 itemRunway()（够玩家落地、再从容起跳）；
           ② 出生点前方 itemRunway() 内没有障碍 —— 否则玩家会「刚跳过障碍、还在半空」
              眼看着金币从脚下溜走，这就是之前「有些金币根本吃不到」的原因。 */
      var runway = itemRunway();
      S.itemPending = true;                    // 先占位：让障碍暂停生成，把跑道空出来
      if (S.dist >= S.itemHold && areaClear(CFG.W + 60 - runway, CFG.W + 380)) {
        var w;
        /* 护盾比金币「贵」：概率低（SHIELD_CHANCE）且带冷却（SHIELD_COOLDOWN）。
           原来 18% 且无冷却，实测每分钟能吃到 4 个，一局大半个时间都在无敌冲刺里，
           难度和乐趣都被削平；现在压到约每分钟 1.5 个。
           roll 先取出来，保证每次生成消耗的随机数个数与旧版一致。 */
        var roll = random();
        if (S.dist >= S.shieldHold && roll < CFG.SHIELD_CHANCE) {
          addCoffee(CFG.W + 60); w = 28;
          S.shieldHold = S.dist + CFG.SHIELD_COOLDOWN;
        } else {
          w = addFishArc(CFG.W + 60, 3 + Math.floor(random() * 3));
        }
        S.itemGap = rnd(900, 1700) + S.speed;
        S.waveHold = S.dist + w + waveRunway();
        S.groups++;
        S.itemPending = false;
      } else {
        S.itemGap = 120;
      }
    }

    /* ── 障碍推进 + 碰撞 ── */
    for (var i = obstacles.length - 1; i >= 0; i--) {
      var o = obstacles[i];
      o.x -= move;
      if (o.x + o.w < -40) { obstacles.splice(i, 1); continue; }
      if (hit(o)) {
        if (boosting) {
          var bb = obBody(o);
          addDebris(o);                            // 击飞表现：障碍本体翻滚着飞出去
          sparkle(bb.x + bb.w / 2, bb.y + bb.h / 2, 14, "#ffd166");
          S.score += 8;
          S.smashes++;                             // 成就：无敌撞碎也算「碰到过障碍」
          shake = Math.max(shake, 6);
          obstacles.splice(i, 1);
          continue;
        }
        gameOver();
        return;
      }
    }

    /* ── 道具推进 + 拾取 ──
       金币带「磁吸」：只要玩家跳到金币附近（默认 76px 内），金币就会主动飞过来。
       跑步类游戏里金币是奖励不是惩罚，宁可让手感松一点，也不要「差一点吃不到」。 */
    for (var j = items.length - 1; j >= 0; j--) {
      var it = items[j];
      it.x -= move;
      if (it.x + it.r < -30) { items.splice(j, 1); continue; }

      var pcx = CFG.PX, pcy = P.y - curH() * 0.5;      // 玩家碰撞盒中心
      var dx = pcx - it.x, dy = pcy - it.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var pick = it.r + (it.kind === "coin" ? CFG.COIN_PICK : 22);

      if (it.kind === "coin" && dist < CFG.COIN_MAGNET && dist > 0.001) {
        var pullStep = Math.min(CFG.MAGNET_SPEED * dt, dist);
        it.x += (dx / dist) * pullStep;
        it.y += (dy / dist) * pullStep;
        dx = pcx - it.x; dy = pcy - it.y;
        dist = Math.sqrt(dx * dx + dy * dy);
      }

      if (dist < pick) {
        if (it.kind === "coin") {
          S.coins++; S.score += CFG.COIN_SCORE;
          sparkle(it.x, it.y, 6, "#ffd166"); Sfx.coin();
        } else {
          S.boost = CFG.SHIELD_TIME;
          S.shields++;                             // 成就：单局吃到的护盾数
          sparkle(it.x, it.y, 18, "#8ab4ff"); Sfx.boost();
          toast("🛡 护盾开启！无敌 " + CFG.SHIELD_TIME + " 秒");
        }
        items.splice(j, 1);
      }
    }

    updateParticles(dt);
    updateDebris(dt);
    if (shake > 0) shake = Math.max(0, shake - 60 * dt);
    updateHud();
    achLive();                                   // 成就实时判定（数值没变时 ach.js 内部秒早退）
  }

  /* 生成一波障碍。
     间距由 step() 按当前速度换算，保证「任意速度下都能落地再起跳」；
     另外连排障碍的高度和数量都做了限制——
     跳跃滞空时间 ≈ 0.655s，若一组障碍太宽／太高，低速时会出现理论无解。
     实测约束：双连高度 ≤ 44、三连只在速度 ≥ 520 出现且高度 ≤ 40。 */
  var CLUSTER_H2 = 44;
  var CLUSTER_H3 = 40;
  var TRIPLE_MIN_SPEED = 520;

  function spawnWave() {
    var speed = S.speed;
    var from = CFG.W + 60;
    var isAir = speed > 600 && random() < 0.32;
    /* 飞行物这一波整体往后推一点时间：
       它只能下蹲通过（跳起来会撞上去），万一玩家正为上一个地面障碍起跳、人还在半空，
       落地前就会被它撞死。正常最小间距 0.80s 减掉一次完整跳跃的 0.655s 只剩 0.145s 反应，
       对玩家太苛刻；多给 AIR_LEAD 秒，就有 0.4s 稳稳落地再蹲。 */
    if (isAir) from += Math.round(speed * CFG.AIR_LEAD);
    var end = from;                                // 这一波最右侧（决定后方要留多少空档）
    function push(kind, x, h) {
      var o = addObstacle(kind, x, h);
      if (x + o.w > end) end = x + o.w;
      return o;
    }

    if (isAir) {
      push("air", from);                           // 飞行物：可跳可蹲（站着会撞）
    } else {
      var r = random();
      if (r < 0.5) {
        push("ground", from);
      } else if (r < 0.82 || speed < TRIPLE_MIN_SPEED) {
        var o1 = push("ground", from);
        push("ground", from + o1.w + 6, Math.min(o1.h, CLUSTER_H2));
      } else {
        var o2 = push("ground", from);
        push("ground", from + o2.w + 6, CLUSTER_H3);
        push("ground", from + o2.w * 2 + 12, Math.min(o2.h, CLUSTER_H3 - 6));
      }
    }

    /* 这一波之后必须留够「落地 + 再起跳」的距离，才允许生成金币 */
    S.itemHold = S.dist + (end - from) + itemRunway();
    S.waves++;
  }

  /* 障碍「本体」矩形 = 碰撞盒本身：地面障碍与悬浮瓶都是所见即所撞，
     碎块/撞碎粒子从这里出发。 */
  function obBody(o) {
    return { x: o.x, y: o.y, w: o.w, h: o.h };
  }

  function hit(o) {
    var pw = CFG.BODY_W - CFG.HIT_PAD * 2;
    var ph = curH() - CFG.HIT_PAD * 2;
    var px = CFG.PX - pw / 2, py = P.y - CFG.HIT_PAD - ph;
    /* 横向判定宽度必须跟**画面**一致：
       地面障碍换成贴图后，图片是按高度定比例的细长条（巧乐兹宽高比 0.42），
       画出来比碰撞盒窄 18px 左右；若还按碰撞盒算，玩家会在离障碍还有十几像素
       时就看到它碎掉（无敌冲刺撞碎时特别刺眼）。
       空中悬浮瓶的画面就画在碰撞盒上，两边天然一致。 */
    var vis = obVisual(o);
    var ow = vis ? Math.min(o.w, vis.w) : o.w;
    var ox = o.x + (o.w - ow) / 2;                // 图片以碰撞盒中心为轴，左右对称
    var oy = o.y + 3, oh = o.h - 6;
    return px < ox + ow && px + pw > ox && py < oy + oh && py + ph > oy;
  }

  function updateParticles(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (state === "playing") p.x -= S.speed * dt * 0.55;
    }
  }

  /* ── 无敌撞碎的「击飞」表现 ──
     以前障碍被撞就是当帧整个消失，只留几个小光点 —— 玩家看到的是
     「障碍还在眼前，下一帧凭空没了」，尤其冲刺速度快，观感是「没碰到就碎」。
     现在把障碍本体变成碎块：往后上方翻滚飞出、重力下坠、淡出，
     眼睛能看到「它被撞飞了」，而不是「它没了」。 */
  function addDebris(o) {
    var vis = obVisual(o);
    var bb = obBody(o);
    var im = vis ? vis.im : null;
    var w = vis ? vis.w : bb.w, h = vis ? vis.h : bb.h;
    /* 空中障碍的贴图底边在碰撞盒底再抬 10px（贴地下边就是瓶子底），碎块从那儿飞出去 */
    var cy = o.kind === "ground" ? CFG.GROUND - h / 2 : o.y + o.h - 10 - h / 2;
    debris.push({
      im: im, w: w, h: h, kind: o.kind,
      x: o.x + o.w / 2,
      y: cy,
      /* 撞击点就在角色脸上，碎块必须立刻离开角色：先向上抛起，
         再随世界后掠（约 0.75 倍世界速度）从角色**身后**扫过去 ——
         碎块画在角色图层之下，看起来就是「撞碎了、残骸从身后飞走」 */
      vx: rnd(-60, 140), vy: -rnd(200, 400),
      rot: 0, vr: rnd(3.5, 9) * (random() < 0.5 ? -1 : 1),
      life: rnd(0.35, 0.5), max: 0.5
    });
    if (debris.length > 20) debris.shift();    // 兜底，防止极端情况堆积
  }

  function updateDebris(dt) {
    for (var i = debris.length - 1; i >= 0; i--) {
      var b = debris[i];
      b.life -= dt;
      if (b.life <= 0) { debris.splice(i, 1); continue; }
      b.x += (b.vx - (state === "playing" ? S.speed * 0.75 : 0)) * dt;
      b.y += b.vy * dt;
      b.vy += 1100 * dt;
      b.rot += b.vr * dt;
    }
  }

  function drawDebris() {
    for (var i = 0; i < debris.length; i++) {
      var b = debris[i];
      var a = clamp(b.life / b.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      if (b.im) ctx.drawImage(b.im, -b.w / 2, -b.h / 2, b.w, b.h);
      else { ctx.fillStyle = "#b9c4cf"; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); }
      ctx.restore();
    }
  }

  /* ═══════════ 渲染 ═══════════ */
  var dpr = 1;                     // 每个 CSS 像素用几个渲染像素
  var zoom = 1;                    // 每个世界单位占几个 CSS 像素
  function resize() {
    /* 画布的宽高由 CSS 决定（宽度铺满正文；宽屏下高度按视口高度自适应，
       见 runner.css）。这里反推「世界单位 → CSS 像素」的缩放 zoom：
         fit  = 画布宽 / 960           —— 再小世界就铺不满画布，右边会留白
         上限 = 画布宽 / VIEW_MIN_W    —— 横向至少留出 VIEW_MIN_W 个世界单位，
                                          再窄前方可视距离变短，高速下来不及反应
         目标 = 尽量填满画布高度，但纵向最多显示 VIEW_MAX_H（再多就是空天空）
       纵向可见高度 = 画布高 / zoom，所以画布不管什么形状，画面都等比、不变形。 */
    var cssW = canvas.clientWidth || 0;
    var cssH = canvas.clientHeight || 0;
    if ((!cssW || !cssH) && canvas.getBoundingClientRect) {
      var rect = canvas.getBoundingClientRect();
      cssW = cssW || rect.width || 0;
      cssH = cssH || rect.height || 0;
    }

    var prevGround = CFG.GROUND;
    if (cssW > 0 && cssH > 0) {
      /* 视野下限按视口形状二选一：宽屏（与 runner.css 的 75vh 媒体查询同条件）
         保持 880 的远视野；竖屏/窄屏收窄到 720，把人物放大约 1/3。
         用 matchMedia 而不是画布宽度判断，才能和 CSS 的媒体查询保持同一把尺子
         （jsdom 没有 matchMedia 时退回按画布宽粗判，仅影响测试环境）。 */
      var wideVp = window.matchMedia
        ? window.matchMedia("(min-width: 700px) and (min-aspect-ratio: 4 / 3)").matches
        : cssW >= 900;
      var minW = wideVp ? CFG.VIEW_MIN_W : CFG.VIEW_MIN_W_NARROW;
      CFG.VIEW_MIN_W_EFF = minW;   // 探针/测试读取实际生效值
      var fit = cssW / CFG.W;
      zoom = Math.max(fit, Math.min(Math.max(fit, cssH / CFG.VIEW_MAX_H),
                                    cssW / minW));
      /* 像素密度按设备像素比给足（画面被放大 zoom 倍，密度不够就糊），
         再夹在 [1, DPR_MAX]，最后兜一道总像素上限。 */
      dpr = Math.max(1, Math.min(CFG.DPR_MAX, window.devicePixelRatio || 1));
      var pxCap = Math.sqrt(CFG.DPR_MAX_PX / (cssW * cssH));
      if (pxCap < dpr) dpr = Math.max(1, pxCap);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);      // 画布盒子的等比像素版
      /* 后备像素是整数、画布盒子不是，取整会让世界差半个像素盖不满宽度
         （右边缘漏一条白），所以按实际后备宽度把缩放抬回来一点点。 */
      zoom = Math.max(zoom, canvas.width / (dpr * CFG.W));
      CFG.H = canvas.height / (dpr * zoom);        // 画布内可见的世界高度
      CFG.GROUND = Math.max(CFG.VIEW_MAX_H / 2, CFG.H - CFG.GROUND_STRIP);
    } else {
      /* 量不到尺寸（jsdom 等无布局环境）：退回原来的 960×360 逻辑尺寸 */
      zoom = 1;
      dpr = 1;
      canvas.width = CFG.W;
      canvas.height = CFG.H;
    }
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);

    /* 地面线会随画布高度上下移动：把已经在场上的东西一起平移，
       免得它们相对地面「悬空」（窗口尺寸变化时会走到这里）。 */
    var dg = CFG.GROUND - prevGround;
    if (dg) {
      if (P) P.y += dg;
      for (var i = 0; i < obstacles.length; i++) obstacles[i].y += dg;
      for (var j = 0; j < items.length; j++) items[j].y += dg;
      for (var k = 0; k < debris.length; k++) debris[k].y += dg;
      for (var m = 0; m < parts.length; m++) parts[m].y += dg;
    }
  }

  function worldDist() { return bgDist + (S ? S.dist : 0); }

  function render() {
    var pal = cbPalette(paletteAt(worldDist() * 0.4));
    ctx.save();
    /* 撞击 / 撞碎时的画面抖动：开了「减少闪烁」就完全不做（前庭敏感的人会不适） */
    if (shake > 0 && !calmOn()) ctx.translate(rnd(-shake, shake) * 0.4, rnd(-shake, shake) * 0.4);
    drawSky(pal);
    drawSkyline(pal);
    drawGround(pal);
    for (var k = 0; k < items.length; k++) drawItem(items[k]);
    for (var m = 0; m < obstacles.length; m++) drawObstacle(obstacles[m], pal);
    drawDebris();
    drawPlayer(pal);
    drawParticles();
    ctx.restore();
  }

  function drawSky(pal) {
    var g = ctx.createLinearGradient(0, 0, 0, CFG.GROUND);
    g.addColorStop(0, pal.top);
    g.addColorStop(1, pal.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CFG.W, CFG.GROUND);

    /* 天空高度随画布变（GROUND 从 300 起），星星/云/日月的位置按同一个系数
       纵向铺开，否则画布一高，它们全挤在天空下半截、上面空一大片。 */
    var skyK = clamp(CFG.GROUND / 300, 1, 2);

    if (pal.star > 0.05) {                       // 星空
      ctx.fillStyle = "rgba(255,255,255," + (0.85 * pal.star) + ")";
      for (var i = 0; i < 46; i++) {
        /* 星星的明暗闪烁正是「减少闪烁」要压掉的东西：开了就固定亮度 */
        var tw = calmOn() ? 1 : 0.7 + 0.5 * Math.sin((S ? S.time : 0) * 2 + i);
        ctx.fillRect((i * 137.5) % CFG.W, (i * 61.7) % (190 * skyK), 1.7 * tw, 1.7 * tw);
      }
    }

    var orbX = CFG.W - 150, orbY = 74 * skyK;    // 太阳 / 月亮
    ctx.fillStyle = rgba(pal.orb, 0.26);
    ctx.beginPath(); ctx.arc(orbX, orbY, 40, 0, 6.2832); ctx.fill();
    ctx.fillStyle = pal.orb;
    ctx.beginPath(); ctx.arc(orbX, orbY, 25, 0, 6.2832); ctx.fill();
    if (pal.nightK > 0.5) {                      // 夜里补成月牙
      ctx.fillStyle = pal.top;
      ctx.beginPath(); ctx.arc(orbX - 12, orbY - 7, 22, 0, 6.2832); ctx.fill();
    }

    ctx.fillStyle = rgba(pal.cloud, pal.nightK > 0.5 ? 0.24 : 0.9);
    var off = (worldDist() * 0.05) % 1500;
    for (var c = 0; c < CLOUDS.length; c++) {
      var cl = CLOUDS[c];
      cloud(((cl.x - off) % 1500 + 1500) % 1500 - 150, cl.y * skyK, cl.s);
    }
  }

  function cloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 16 * s, 0, 6.2832);
    ctx.arc(x + 20 * s, y - 9 * s, 20 * s, 0, 6.2832);
    ctx.arc(x + 44 * s, y, 15 * s, 0, 6.2832);
    ctx.rect(x, y, 44 * s, 14 * s);
    ctx.fill();
  }

  function drawSkyline(pal) {
    var base = CFG.GROUND;
    var offF = (worldDist() * 0.22) % 2600;
    ctx.fillStyle = pal.far;
    for (var i = 0; i < SKYLINE.length; i++) {
      var b = SKYLINE[i], bx = b.x - offF;
      if (bx > CFG.W + 60 || bx + b.w < -60) continue;
      ctx.fillRect(bx, base - b.h - 26, b.w, b.h + 26);
    }
    var offM = (worldDist() * 0.42) % 2600;
    for (var j = 0; j < SKYLINE.length; j++) {
      var b2 = SKYLINE[j], bx2 = b2.x * 1.14 - offM;
      if (bx2 > CFG.W + 60 || bx2 + b2.w < -60) continue;
      var h2 = b2.h * 0.62;
      ctx.fillStyle = pal.mid;
      ctx.fillRect(bx2, base - h2 - 8, b2.w * 0.8, h2 + 8);
      if (b2.light > 0.45) {                     // 窗户灯光
        ctx.fillStyle = rgba(pal.orb, pal.nightK > 0.5 ? 0.5 : 0.22);
        for (var wy = 0; wy < 3; wy++) {
          for (var wx = 0; wx < 2; wx++) ctx.fillRect(bx2 + 8 + wx * 18, base - h2 + 10 + wy * 22, 9, 12);
        }
      }
    }
  }

  function drawGround(pal) {
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, CFG.GROUND, CFG.W, CFG.H - CFG.GROUND);
    ctx.fillStyle = pal.line;
    ctx.fillRect(0, CFG.GROUND, CFG.W, 3);

    var off = worldDist() % 90;                  // 地砖纹理，强化速度感
    ctx.strokeStyle = rgba(pal.line, 0.85);
    ctx.lineWidth = 2;
    for (var x = -off; x < CFG.W + 90; x += 90) {
      ctx.beginPath(); ctx.moveTo(x, CFG.GROUND + 6); ctx.lineTo(x - 26, CFG.H); ctx.stroke();
    }
    ctx.strokeStyle = rgba(pal.line, 0.5);
    for (var y = CFG.GROUND + 20; y < CFG.H; y += 18) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CFG.W, y); ctx.stroke();
    }
  }

  /* ── 障碍外观素材（致谢 seia-runner：地面=巧乐兹、空中=雪碧瓶）──
     图片未加载完 / 加载失败（含无图测试环境）时自动回退到下面的矢量画法 */
  /* 素材目录：优先用 skins.js 推好的基址（同目录布局），
     拿不到时自己按脚本 URL 推一遍——写死 "/img/" 会让独立站全部 404。 */
  var IMG_BASE = (function () {
    if (window.RunnerSkins && window.RunnerSkins.imgBase) return window.RunnerSkins.imgBase;
    var s = document.currentScript;
    if (!s || !s.src) {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        var src = all[i].getAttribute("src") || "";
        if (/(^|\/)(runner|skins)\.js(\?|#|$)/.test(src)) { s = all[i]; break; }
      }
    }
    var href = (s && s.src) || "";
    if (!href) return "img/";
    return href.replace(/[?#][\s\S]*$/, "").replace(/[^/]*$/, "") + "img/";
  })();

  var OB_IMG = {};
  (function () {
    var srcs = {
      qiaolezi: "qiaolezi.webp", qiaoleziAlt: "qiaolezi-alt.webp",
      sprite: "sprite-bottle.webp"
    };
    for (var k in srcs) {
      var im = null;
      try { im = new Image(); im.src = IMG_BASE + srcs[k]; } catch (e) { im = null; }
      OB_IMG[k] = im;
    }
  })();
  function obImgOk(im) { return !!im && im.complete && im.naturalWidth > 0; }

  /* 障碍「看起来多大」的参数。地面障碍按碰撞盒高定画面高（略大一点点）；
     空中悬浮瓶的画面 = 碰撞盒原样，不需要参数。 */
  var OB_VIS = {
    ghScale: 1.12, ghPad: 8, ghMin: 48, ghMax: 82     // 地面：画面高 = clamp(h × 1.12 + 8, 48, 82)
  };

  /* ⚠️ 绘制与判定**共用同一份几何**（hit() 也调它）。
     曾经两边各算各的：画面按高度定比例画出 27px 宽，判定还按 46px 的碰撞盒算，
     结果「人还没碰到障碍它就碎了」——无敌冲刺撞碎时最明显。
     图片没加载出来（含无图测试环境）时返回 null，两边一起退回矢量画法 / 碰撞盒。 */
  function obVisual(o) {
    var im, w, h;
    if (o.kind === "ground") {
      im = (o.id === "box" || o.id === "stack") ? OB_IMG.qiaoleziAlt : OB_IMG.qiaolezi;
      if (!obImgOk(im)) return null;
      h = clamp(o.h * OB_VIS.ghScale + OB_VIS.ghPad, OB_VIS.ghMin, OB_VIS.ghMax);
      w = h * im.naturalWidth / im.naturalHeight;
    } else {
      im = OB_IMG.sprite;
      if (!obImgOk(im)) return null;
      w = o.w; h = o.h;            // 悬浮瓶：贴图直接画进碰撞盒，所见即所撞
    }
    return { im: im, w: w, h: h };
  }

  /* ── 飞行障碍 = 一只「无绳悬浮的雪碧瓶」──
     瓶身高 = 1.5 × 站立身高，顶在离地 ≈137（比满跳最高点低 18px），
     跳或蹲都能过、站着会撞 —— 看到的就是撞到的。
     这是图片没加载出来（含无图测试环境）时的矢量兜底画法。 */
  function drawTallBottle(cx, top, bottom, w) {
    if (!(bottom > top)) return;
    var x = cx - w / 2;
    var full = bottom - top;
    /* 瓶盖（底端，与贴图一致：盖朝下） */
    ctx.fillStyle = "#7fd4e8";
    rr(ctx, x + w * 0.28, bottom - 6, w * 0.44, 10, 2); ctx.fill();
    /* 瓶颈：从瓶盖上面收窄，往上渐宽过渡到瓶身 */
    ctx.fillStyle = "rgba(94,196,166,0.92)";
    ctx.beginPath();
    ctx.moveTo(x + w * 0.34, bottom - 5);
    ctx.lineTo(x + w * 0.66, bottom - 5);
    ctx.lineTo(x + w * 0.82, bottom - Math.min(46, full * 0.28));
    ctx.lineTo(x + w * 0.18, bottom - Math.min(46, full * 0.28));
    ctx.closePath(); ctx.fill();
    /* 瓶身：一条拉长的圆角矩形，从顶部瓶底一直到瓶颈 */
    var bodyBtm = bottom - Math.min(46, full * 0.28) + 2;
    var bodyH = bodyBtm - top;
    var g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "rgba(74,168,140,0.94)");
    g.addColorStop(0.45, "rgba(133,214,183,0.96)");
    g.addColorStop(1, "rgba(58,142,118,0.94)");
    ctx.fillStyle = g;
    rr(ctx, x, top, w, bodyH, Math.min(9, w / 2)); ctx.fill();
    /* 高光竖线 + 标签横带，一眼认出是「瓶子」 */
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x + w * 0.24, top + 8); ctx.lineTo(x + w * 0.24, bodyBtm - 8); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(x + 2, top + full * 0.37, w - 4, Math.max(6, full * 0.05));
  }

  /* ── 色盲模式的形状标记 ──
     障碍贴图/矢量画法的颜色五花八门，色觉异常时很难一眼分清「能吃的/要躲的」，
     所以在障碍外面套一圈「深色描边 + 内侧白线」，左上角再贴一块琥珀色斜纹警示条：
     颜色认不出来也能靠形状和纹理判断。金币同理，加一圈深色外圈。 */
  function cbMarkObstacle(x, y, w, h) {
    if (!SET.cb || !(w > 0) || !(h > 0)) return;
    ctx.save();
    rr(ctx, x - 3, y - 3, w + 6, h + 6, 8);
    ctx.strokeStyle = "#0b1020"; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineWidth = 1.6; ctx.stroke();
    var bw = Math.min(26, w), bh = Math.min(14, h);
    rr(ctx, x, y, bw, bh, 3);
    ctx.clip();
    ctx.fillStyle = "#ffb020";
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = "#0b1020"; ctx.lineWidth = 2.5;
    for (var i = -20; i < 40; i += 7) {
      ctx.beginPath(); ctx.moveTo(x + i, y + bh); ctx.lineTo(x + i + bh, y); ctx.stroke();
    }
    ctx.restore();
  }
  function cbMarkCoin(x, y, ph, t) {
    if (!SET.cb) return;
    /* 光环/币身的浮动偏移与 skins.js drawCoin 保持一致，圈才不会错位 */
    var cy = y + Math.sin(t * 5 + (ph || 0)) * 3;
    ctx.save();
    ctx.strokeStyle = "#0b1020"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, cy, 17, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x, cy, 15.2, 0, 6.2832); ctx.stroke();
    ctx.restore();
  }

  /* ── 障碍绘制 ── */
  function drawObstacle(o, pal) {
    ctx.save();

    /* 图片外观：跟着碰撞盒走（以前按「碰撞盒宽 ×2」定比例，画出来 90~112px 高，
       比角色还高一倍，看着太唬人） */
    var vis = obVisual(o);
    if (vis) {
      if (o.kind === "ground") {
        /* 影子跟着画面宽度走 */
        ctx.fillStyle = "rgba(0,0,0,0.16)";
        ctx.beginPath();
        ctx.ellipse(o.x + o.w / 2, CFG.GROUND + 3, vis.w * 0.55, 5, 0, 0, 6.2832);
        ctx.fill();
        cbMarkObstacle(o.x + o.w / 2 - vis.w / 2, CFG.GROUND - vis.h, vis.w, vis.h);
        ctx.drawImage(vis.im, o.x + o.w / 2 - vis.w / 2, CFG.GROUND - vis.h, vis.w, vis.h);
      } else {
        /* 空中障碍 = 无绳悬浮的雪碧瓶：贴图原样画进碰撞盒（不拉伸、无竖井），
           带一点上下浮动；判定盒不跟着浮，±3px 的浮动落在 hit() 的宽容边里。 */
        var bob = Math.sin(o.phase + (S ? S.time : 0) * 5.5) * 3;
        cbMarkObstacle(o.x, o.y + bob, vis.w, vis.h);
        ctx.drawImage(vis.im, o.x, o.y + bob, vis.w, vis.h);
      }
      ctx.restore();
      return;
    }

    var bb = obBody(o);
    var x = bb.x, y = bb.y, w = bb.w, h = bb.h;
    if (o.kind === "air") {
      /* 无图兜底：悬浮瓶身（矢量画法），不再叠画纸/无人机 */
      cbMarkObstacle(o.x, o.y, o.w, o.h);
      drawTallBottle(o.x + o.w / 2, o.y, o.y + o.h, o.w);
      ctx.restore();
      return;
    }
    cbMarkObstacle(x, y, w, h);

    if (o.id === "cup") {                        // 咖啡杯
      ctx.fillStyle = "#ffffff"; rr(ctx, x, y + 8, w, h - 8, 7); ctx.fill();
      ctx.fillStyle = "#c9613f"; rr(ctx, x - 2, y, w + 4, 12, 5); ctx.fill();
      ctx.fillStyle = "#e8edf3"; rr(ctx, x + 5, y + 20, w - 10, 12, 4); ctx.fill();
      ctx.strokeStyle = "#b9c4cf"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 7, y + 12); ctx.lineTo(x + 7, y + h - 8); ctx.stroke();
    } else if (o.id === "box") {                 // 快递箱
      ctx.fillStyle = "#c48b52"; rr(ctx, x, y, w, h, 6); ctx.fill();
      ctx.fillStyle = "#a9723e"; rr(ctx, x, y, w, 12, 6); ctx.fill();
      ctx.fillStyle = "#e3c39b"; ctx.fillRect(x + w / 2 - 5, y, 10, h);
      ctx.strokeStyle = "#8a5c2e"; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 6); ctx.stroke();
    } else if (o.id === "cone") {                // 路障
      ctx.fillStyle = "#f5842b";
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.fillRect(x + 6, y + h * 0.45, w - 12, 9);
      ctx.fillStyle = "#d96d1c"; rr(ctx, x - 4, y + h - 8, w + 8, 8, 3); ctx.fill();
    } else if (o.id === "stack") {               // 文件堆
      ctx.fillStyle = "#6f7f96"; rr(ctx, x, y + h * 0.5, w, h * 0.5, 6); ctx.fill();
      ctx.fillStyle = "#8b9bb2"; rr(ctx, x + 6, y + h * 0.22, w - 12, h * 0.3, 5); ctx.fill();
      ctx.fillStyle = "#eef2f7"; rr(ctx, x + 14, y, w - 28, h * 0.24, 4); ctx.fill();
      ctx.strokeStyle = "#5b6a80"; ctx.lineWidth = 2; rr(ctx, x, y + h * 0.5, w, h * 0.5, 6); ctx.stroke();
    } else if (o.id === "paper") {               // 飞舞的 A4 纸
      ctx.translate(0, Math.sin(o.phase + (S ? S.time : 0) * 6) * 3);
      ctx.fillStyle = "#ffffff"; rr(ctx, x, y, w, h, 3); ctx.fill();
      ctx.strokeStyle = "#c9d3de"; ctx.lineWidth = 1.5;
      for (var i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.moveTo(x + 5, y + i * 6); ctx.lineTo(x + w - 5, y + i * 6); ctx.stroke();
      }
      ctx.strokeStyle = "#aab6c4"; rr(ctx, x, y, w, h, 3); ctx.stroke();
    } else if (o.id === "drone") {               // 无人机
      ctx.translate(0, Math.sin(o.phase + (S ? S.time : 0) * 5) * 4);
      ctx.strokeStyle = "#4a5568"; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 5); ctx.lineTo(x + w - 8, y + 5);
      ctx.moveTo(x + 8, y + 5); ctx.lineTo(x + 5, y + 13);
      ctx.moveTo(x + w - 8, y + 5); ctx.lineTo(x + w - 5, y + 13);
      ctx.stroke();
      ctx.fillStyle = "#5b6a80"; rr(ctx, x + 12, y + 13, w - 24, h - 17, 7); ctx.fill();
      ctx.fillStyle = dangerColor();                 // 无人机指示灯（色盲模式换成琥珀黄）
      ctx.beginPath(); ctx.arc(x + w - 18, y + 23, 3.2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#8b9bb2";
      ctx.beginPath();
      ctx.arc(x + 8, y + 4, 6, 0, 6.2832);
      ctx.arc(x + w - 8, y + 4, 6, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ── 道具绘制 ── */
  function drawItem(it) {
    var t = S ? S.time : 0;
    if (it.kind === "coin") {                    // 金币：外观由商店里装备的皮肤决定
      Skins.drawCoin(ctx, skinCoin, { x: it.x, y: it.y, t: t, ph: it.ph || 0 });
      cbMarkCoin(it.x, it.y, it.ph, t);          // 色盲模式：金币加一圈深色外圈，和障碍区分开
    } else {                                     // 护盾（无敌道具）
      var y2 = it.y + Math.sin(t * 4) * 2;
      var pulse = calmOn() ? 1 : 0.5 + 0.5 * Math.sin(t * 6);   // 减少闪烁：光晕不再一张一缩
      ctx.fillStyle = "rgba(138,180,255," + (0.16 + 0.16 * pulse) + ")";
      ctx.beginPath(); ctx.arc(it.x, y2, 24, 0, 6.2832); ctx.fill();
      var sw = 14, sh = 16;                              // 盾牌：上平下尖
      ctx.beginPath();
      ctx.moveTo(it.x, y2 - sh);
      ctx.lineTo(it.x + sw, y2 - sh + 6);
      ctx.lineTo(it.x + sw * 0.8, y2 + 7);
      ctx.quadraticCurveTo(it.x + sw * 0.5, y2 + 15, it.x, y2 + sh + 4);
      ctx.quadraticCurveTo(it.x - sw * 0.5, y2 + 15, it.x - sw * 0.8, y2 + 7);
      ctx.lineTo(it.x - sw, y2 - sh + 6);
      ctx.closePath();
      ctx.fillStyle = "#5b8def"; ctx.fill();
      ctx.strokeStyle = "#2f57ab"; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.62)"; ctx.lineWidth = 1.6;
      ctx.beginPath();                                   // 盾面十字
      ctx.moveTo(it.x, y2 - sh + 4); ctx.lineTo(it.x, y2 + sh - 3);
      ctx.moveTo(it.x - 7, y2 - 2); ctx.lineTo(it.x + 7, y2 - 2);
      ctx.stroke();
      ctx.fillStyle = "#eaf1ff";                          // 两颗能量小星
      var sp = t * 2;
      for (var k = 0; k < 2; k++) {
        var a = sp + k * Math.PI, rx = it.x + Math.cos(a) * 20, ry = y2 + Math.sin(a) * 15;
        ctx.beginPath(); ctx.arc(rx, ry, 1.7, 0, 6.2832); ctx.fill();
      }
    }
  }

  /* ── 角色：火柴人（外观由 skins.js 的装备皮肤决定） ── */
  function drawPlayer(pal) {
    var x = CFG.PX, gy = P.y;
    /* 过渡进度只在**落地**时作用于姿态：空中按下蹲只管加速下落，动作保持跳跃姿
       （蹲着往下掉的样子很怪），所以空中直接给 0，落地后接着从当前进度长回来。 */
    var k = P.onGround ? crouchK() : 0;
    var h = CFG.STAND_H + (CFG.DUCK_H - CFG.STAND_H) * k;   // 护盾光环跟着身形走
    var t = S ? S.time : 0;

    ctx.fillStyle = "rgba(0,0,0,0.18)";           // 地面影子
    var shrink = clamp(1 - (CFG.GROUND - gy) / 260, 0.35, 1);
    ctx.beginPath();
    ctx.ellipse(x, CFG.GROUND + 3, 18 * shrink, 5 * shrink, 0, 0, 6.2832);
    ctx.fill();

    ctx.save();
    ctx.translate(x, gy);
    Skins.drawStick(ctx, skinPlayer, {
      pose: P.onGround ? "run" : "jump",
      t: t, run: P.run, night: pal.nightK > 0.5, crouch: k
    });

    if (S && S.boost > 0) {                       // 护盾光环（收尾期转暗、闪烁加快 = 无敌要没了）
      var tailK = S.boost < CFG.BOOST_TAIL ? (S.boost / CFG.BOOST_TAIL) : 1;
      /* 收尾提示原本靠 24Hz 高频闪烁，对闪烁敏感的人很不友好；
         开了「减少闪烁」改成「稳定变暗」——照样能看出快结束了。 */
      var flick = calmOn() ? 1 : (tailK < 1 ? 0.5 + 0.5 * Math.sin(t * 24) : (0.5 + 0.5 * Math.sin(t * 12)));
      ctx.strokeStyle = "rgba(91,141,239," + ((0.4 + 0.45 * flick) * (0.4 + 0.6 * tailK)).toFixed(3) + ")";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, -h / 2, 28, h * 0.72, 0, 0, 6.2832); ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var a = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = rgba(p.c, a * 0.85);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * a, 0, 6.2832); ctx.fill();
    }
  }

  /* ═══════════ 主循环驱动 ═══════════ */
  var last = 0, rafId = 0;
  function frame(ts) {
    if (window.__RUNNER_MANUAL__) return;         // 测试模式：由 Runner.tick() 手动驱动
    var dt = last ? (ts - last) / 1000 : 0.016;
    last = ts;
    step(clamp(dt, 0, 0.05));
    render();
    rafId = window.requestAnimationFrame(frame);
  }

  /* ═══════════ 事件 ═══════════ */
  /* 键位全部走设置里的自定义按键（默认 空格/↑/W 跳、↓/S 蹲、P 暂停、M 静音） */
  function isJumpKey(k, code) { return keyHit("jump", { key: k, code: code }); }
  function isDuckKey(k, code) { return keyHit("duck", { key: k, code: code }); }

  function mayRestart() { return state !== "over" || Date.now() - overAt > 400; }

  function onKeyDown(e) {
    var k = e.key, code = e.code;

    /* 正在等待新键（改键捕获）：吃掉这次按键，别让它同时触发游戏动作。
       先于面板开关判断——改键状态一旦进入，不管面板是不是还开着都有效 */
    if (captureAct) {
      e.preventDefault();
      if (k === "Escape" || code === "Escape") cancelCapture();   // Esc 取消捕获、不改键
      else commitCapture(e);
      return;
    }

    /* 玩法说明开着：只认卡片底下的「我知道了」——
       空格 / Enter 不许开局，Esc / P 不许关掉它，键盘一律不穿透 */
    if (helpVisible) return;

    /* 设置面板开着的时候，键盘只服务面板，其余键不穿透到游戏
       （否则空格会在面板后面把游戏跑起来，玩家看不见角色、直接撞死） */
    if (setOpen()) {
      if (k === "Escape" || code === "Escape") { e.preventDefault(); closeSet(); return; }
      if (isMuteKey(k, code)) toggleMute();
      return;
    }
    /* 商店开着的时候，键盘只用来关商店，不打扰人物 */
    if (shopOpen()) {
      if (k === "Escape" || keyHit("pause", e)) { e.preventDefault(); closeShop(); }
      else if (isMuteKey(k, code)) toggleMute();
      return;
    }
    /* 排行榜弹层同理：开着时按键不穿透到游戏，否则空格会在面板后面把游戏跑起来，
       玩家看不见角色、直接撞死。Escape 由 rank.js 自己处理（关面板），这里不再触发暂停。 */
    if (rankOpen()) {
      if (isMuteKey(k, code)) toggleMute();
      return;
    }
    /* 成就面板：同样不让按键穿透（Escape 由 ach.js 处理关闭） */
    if (achOpen()) {
      if (isMuteKey(k, code)) toggleMute();
      return;
    }
    /* 个人中心「个人」页：按键不穿透，Escape 关掉它 */
    if (meOpen()) {
      if (k === "Escape" || code === "Escape") { e.preventDefault(); closeMePanel(); }
      else if (isMuteKey(k, code)) toggleMute();
      return;
    }

    if (isJumpKey(k, code)) {
      e.preventDefault();
      if (state === "paused") { togglePause(); return; }
      if (state === "ready" || state === "over") { if (mayRestart()) startGame(); return; }
      if (!input.jumpHeld) { input.jumpHeld = true; doJump(); }
      return;
    }
    if (isDuckKey(k, code)) {
      if (state === "playing" || state === "ready") e.preventDefault();
      input.duckHeld = true;
      applyDuck(true);
      return;
    }
    if (keyHit("pause", e)) { togglePause(); return; }
    if (isMuteKey(k, code)) { toggleMute(); return; }
    if (k === "Enter" && (state === "ready" || state === "over") && mayRestart()) startGame();
  }

  function isMuteKey(k, code) { return keyHit("mute", { key: k, code: code }); }

  function onKeyUp(e) {
    var k = e.key, code = e.code;
    if (isJumpKey(k, code)) input.jumpHeld = false;
    if (isDuckKey(k, code)) { input.duckHeld = false; applyDuck(false); }
  }

  function pressJump() { if (helpVisible) return; input.jumpHeld = true; doJump(); }
  function releaseJump() { input.jumpHeld = false; }
  function pressDuck() { if (helpVisible) return; input.duckHeld = true; applyDuck(true); }
  function releaseDuck() { input.duckHeld = false; applyDuck(false); }

  function bindHold(el, down, up) {
    if (!el) return;
    el.addEventListener("mousedown", function (e) { e.preventDefault(); down(); });
    el.addEventListener("mouseup", function () { up(); });
    el.addEventListener("mouseleave", function () { up(); });
    el.addEventListener("touchstart", function (e) { e.preventDefault(); down(); }, { passive: false });
    el.addEventListener("touchend", function (e) { e.preventDefault(); up(); }, { passive: false });
    el.addEventListener("touchcancel", function () { up(); }, { passive: true });
  }

  function toggleMute() {
    Sfx.setMuted(!Sfx.isMuted());
    syncSetUi();
  }

  /* ═══════════ 设置弹层（⚙ 设置：音效 / 无障碍 / 自定义按键） ═══════════
     和商店、成就同一套「开面板先定格、关掉原样恢复」逻辑（shopPrev 共用），
     面板里有三个视图：总览 / 无障碍 / 自定义按键，来回切换不重新开弹层。
     所有控件状态由 syncSetUi() 单点同步：任何设置变化（含键盘改键）都调它一次。 */
  var setPrev = null;
  var captureAct = null, captureAdd = false;      // 正在等待新键的动作
  var elSetViews = {}, elSetCb = {}, elSetCalm = {}, elSetBig = {};
  var elSetVol = [], elSetVolVal = [];
  var elKeysList = null, elKeysSum = null, elA11ySum = null;
  var elSetHint = null;

  function setOpen() { return !!elSet && !elSet.classList.contains("hidden"); }

  function initSetRefs() {
    elSetViews = {
      main: document.getElementById("set-view-main"),
      a11y: document.getElementById("set-view-a11y"),
      keys: document.getElementById("set-view-keys")
    };
    elSetCb = {
      el: document.getElementById("set-cb"),
      set: function (on) { setOpt("cb", on); }
    };
    elSetCalm = {
      el: document.getElementById("set-calm"),
      set: function (on) { setOpt("calm", on); }
    };
    elSetBig = {
      el: document.getElementById("set-big"),
      set: function (on) { setOpt("big", on); }
    };
    elSetVol = [document.getElementById("run-vol"), document.getElementById("run-vol-a11y")];
    elSetVolVal = [document.getElementById("run-vol-val"), document.getElementById("run-vol-a11y-val")];
    elKeysList = document.getElementById("set-keys-list");
    elKeysSum = document.getElementById("set-keys-sum");
    elA11ySum = document.getElementById("set-a11y-sum");
    elSetHint = document.getElementById("set-hint");
    elClearBtn = document.getElementById("set-clear");
    elClearWrap = document.getElementById("set-clear-confirm");
    elClearTip = document.getElementById("set-clear-tip");
  }

  function showSetView(name) {
    var names = ["main", "a11y", "keys"];
    for (var i = 0; i < names.length; i++) {
      var v = elSetViews[names[i]];
      if (v) v.classList.toggle("hidden", names[i] !== name);
    }
    if (btnSetBack) btnSetBack.classList.toggle("hidden", name === "main");
    if (elSetTitle) {
      elSetTitle.textContent = name === "a11y" ? "♿ 无障碍选项"
        : (name === "keys" ? "⌨ 自定义按键" : "⚙ 设置");
    }
    cancelCapture();
  }

  function openSet() {
    if (!elSet || setOpen() || helpVisible) return;   // 玩法说明开着时不开设置（它本来就盖在上面）
    showSetView("main");
    elSet.classList.remove("hidden");
    document.dispatchEvent(new CustomEvent("set:open"));   // runner 自己监听：把局面定格
  }
  function closeSet() {
    if (!setOpen()) return;
    cancelCapture();
    elSet.classList.add("hidden");
    document.dispatchEvent(new CustomEvent("set:close"));
  }
  function toggleSet() { setOpen() ? closeSet() : openSet(); }

  function beginCapture(action, add) {
    captureAct = action;
    captureAdd = !!add;
    syncSetUi();
  }
  function cancelCapture() {
    if (!captureAct) return;
    captureAct = null; captureAdd = false;
    syncSetUi();
  }
  function commitCapture(e) {
    var code = keyNorm(e.code || e.key);
    var act = captureAct;
    captureAct = null; captureAdd = false;
    if (act && code) addKey(act, code);        // addKey 里会 syncSetUi
    else syncSetUi();
  }

  /* 一个开关按钮的样式与朗读状态 */
  function paintSwitch(el, on, onText, offText) {
    if (!el) return;
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.classList.toggle("is-on", !!on);
    el.textContent = on ? (onText || "已开启") : (offText || "已关闭");
  }

  function renderKeys() {
    if (!elKeysList) return;
    var html = "";
    for (var a = 0; a < KEY_ACTIONS.length; a++) {
      var act = KEY_ACTIONS[a], list = keyList(act);
      html += "<div class='set-key-row' data-act='" + act + "'>" +
        "<div class='set-key-lab'><b>" + KEY_ACT_CN[act] + "</b><small>" + KEY_DESC[act] + "</small></div>" +
        "<div class='set-key-keys'>";
      for (var i = 0; i < list.length; i++) {
        html += "<span class='set-key-chip'><b>" + keyName(list[i]) + "</b>" +
          (list.length > 1 ? "<button type='button' class='set-key-x' data-del-act='" + act +
            "' data-del-code='" + list[i] + "' aria-label='移除 " + keyName(list[i]) + "'>✕</button>" : "") +
          "</span>";
      }
      if (captureAct === act) {
        html += "<span class='set-key-wait'>按下新键…（Esc 取消）</span>";
      } else if (KEY_UNIQUE[act]) {
        html += "<button type='button' class='set-key-add' data-cap-act='" + act + "' data-cap-add='1'>改键</button>";
      } else if (list.length < KEY_MAX) {
        html += "<button type='button' class='set-key-add' data-cap-act='" + act + "' data-cap-add='1'>+ 添加</button>";
      }
      html += "</div><div class='set-key-hint'>" + keyHint(act) + "</div></div>";
    }
    elKeysList.innerHTML = html;
    var btns = elKeysList.querySelectorAll("[data-cap-act]");
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener("click", function () {
        beginCapture(this.getAttribute("data-cap-act"), this.getAttribute("data-cap-add") === "1");
      });
    }
    var dels = elKeysList.querySelectorAll("[data-del-code]");
    for (var d = 0; d < dels.length; d++) {
      dels[d].addEventListener("click", function () {
        removeKey(this.getAttribute("data-del-act"), this.getAttribute("data-del-code"));
      });
    }
  }

  /* 所有设置控件的状态同步（唯一入口，多处共用同一份设置时不会走样） */
  function syncSetUi() {
    var i;
    /* 音效开关（#run-mute 仍在 DOM 里，只是搬到了设置面板中） */
    if (btnMute) {
      var muted = Sfx.isMuted();
      btnMute.setAttribute("aria-pressed", muted ? "true" : "false");
      btnMute.classList.toggle("is-on", !muted);
      btnMute.textContent = muted ? "🔇 已静音" : "🔊 音效开";
    }
    /* 工具条上的「⚙ 设置」显示一个静音小标记 */
    if (btnSetOpen) {
      btnSetOpen.classList.toggle("is-muted", Sfx.isMuted());
      btnSetOpen.title = (Sfx.isMuted() ? "设置（当前静音）" : "设置") + "：音效、无障碍、自定义按键";
    }
    paintSwitch(elSetCb.el, SET.cb, "已开启 · 色盲友好", "已关闭");
    paintSwitch(elSetCalm.el, SET.calm, "已开启 · 少抖动", "已关闭");
    paintSwitch(elSetBig.el, SET.big, "已开启 · 大字", "已关闭");
    var pct = Math.round(SET.vol * 100) + "%";
    for (i = 0; i < elSetVol.length; i++) {
      if (elSetVol[i]) elSetVol[i].value = String(Math.round(SET.vol * 100));
      if (elSetVolVal[i]) elSetVolVal[i].textContent = pct;
    }
    if (elA11ySum) {
      var on = [];
      if (SET.cb) on.push("色盲模式");
      if (SET.calm) on.push("减少闪烁");
      if (SET.big) on.push("大字模式");
      on.push("独立音量 " + pct);
      elA11ySum.textContent = on.join(" · ");
    }
    if (elKeysSum) {
      elKeysSum.textContent = "跳跃 " + keyHint("jump") + " · 下蹲 " + keyHint("duck");
    }
    var keysTag = document.getElementById("set-keys-tip");
    if (keysTag) {
      keysTag.innerHTML = "跳跃：<b>" + keyHint("jump") + "</b> ｜ 下蹲：<b>" + keyHint("duck") +
        "</b> ｜ 暂停：<b>" + keyHint("pause") + "</b> ｜ 音效开关：<b>" + keyHint("mute") + "</b>";
    }
    if (elSetHint) {
      elSetHint.textContent = captureAct
        ? "请按下新键…（Esc 取消）"
        : "设置只保存在本机浏览器，换设备需要重设（成就与钱包登录后会同步到云端）。";
    }
    renderKeys();
  }

  /* 打开玩法说明：入口有两个 —— 首次进入自动弹（初始化里那一次）、设置面板里的「玩法说明」。
     打开前记住当时的界面（准备中 / 跑着 / 暂停 / 结算），关掉后原样回去。 */
  function openHelp() {
    if (!elOverlay || helpVisible) return;
    helpVisible = true;
    prevState = state;
    if (state === "playing") state = "paused";    // 定格：别让角色在说明背后继续跑
    showOverlay("help");
  }

  /* 关掉玩法说明：只有卡片最底下的「我知道了」会走到这里（键盘 / Esc / 点空白都进不来）。
     顺手写下「已读」标记，下次打开游戏就不再自动弹了。 */
  function closeHelp() {
    if (!helpVisible) return;
    helpVisible = false;
    markHelpSeen();
    if (prevState === "playing") { state = "playing"; hideOverlay(); Sfx.wake(); }
    else if (prevState === "over") { state = "over"; showOverlay("over"); }
    else if (prevState === "paused") { state = "paused"; showOverlay("paused"); }
    else { state = "ready"; showOverlay("ready"); }
    prevState = "ready";
  }

  function bind() {
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    bindHold(btnJumpIn, pressJump, releaseJump);
    bindHold(btnDuckIn, pressDuck, releaseDuck);
    /* 音效开关：新版在设置面板里（点一下切换）；旧页面（按钮还在工具条）仍用长按式绑定 */
    if (btnMute) {
      if (elSet && elSet.contains(btnMute)) {
        btnMute.addEventListener("click", function (e) { e.preventDefault(); toggleMute(); });
      } else {
        bindHold(btnMute, toggleMute, function () {});
      }
    }
    if (btnHelp) btnHelp.addEventListener("click", openHelp);   // 老页面（工具条还有「玩法」）兼容
    bindSet();

    /* 工具条 / 页脚里的「个人中心」「⚙ 设置」入口共用一套点击委托 */
    root.addEventListener("click", function (e) {
      var n = e.target;
      while (n && n !== root) {
        if (n.hasAttribute) {
          if (n.hasAttribute("data-open-me")) { e.preventDefault(); openMe("shop"); return; }
          if (n.hasAttribute("data-open-shop")) { e.preventDefault(); openMe("shop"); return; }
          if (n.hasAttribute("data-open-set")) { e.preventDefault(); openSet(); return; }
        }
        n = n.parentNode;
      }
    });
    /* 个人中心面板里的「商店 / 成就」页签：面板在 #run-root 之外，单独在 document 上监听 */
    document.addEventListener("click", function (e) {
      var t = e.target;
      var tab = t && t.closest && t.closest("[data-me-tab]");
      if (tab) { e.preventDefault(); openMe(tab.getAttribute("data-me-tab")); }
      var achLink = t && t.closest && t.closest("[data-open-ach]");   // 正文里的成就入口（若有）
      if (achLink) { e.preventDefault(); openMe("ach"); }
    });
    if (btnShopX) btnShopX.addEventListener("click", closeShop);
    if (elShop) elShop.addEventListener("click", function (e) {   // 点遮罩空白处也关掉
      if (e.target === elShop) closeShop();
    });
    /* 个人页：✕ / 点空白关闭；选图、移除头像 */
    if (btnMeX) btnMeX.addEventListener("click", closeMePanel);
    if (elMe) elMe.addEventListener("click", function (e) {
      if (e.target === elMe) closeMePanel();
    });
    if (btnMePick) btnMePick.addEventListener("click", pickAvatar);
    if (btnMeClear) btnMeClear.addEventListener("click", function () { saveAvatar(""); });
    if (elMeFile) elMeFile.addEventListener("change", onAvatarFile);

    if (elOvBtn) elOvBtn.addEventListener("click", function () {
      if (elOvBtn.dataset.mode === "help") { closeHelp(); return; }
      if (state === "paused") togglePause();
      else startGame();
    });

    if (stage) {
      /* 触屏设备在 touchend 之后还会再合成一整套鼠标事件（mousedown / mouseup / click）。
         用时间戳把这类合成事件挡在鼠标路径之外，否则「手指点画面」会从 mousedown 分支再开局一次，
         手机端就绕过「必须点开始按钮」的规则了。真实鼠标点击（离上次触摸 > 700ms）不受影响。 */
      var lastTouchAt = 0;
      stage.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        if (helpVisible) return;                       // 玩法说明开着：点画面不开局、也不解除暂停
        if (Date.now() - lastTouchAt < 700) return;
        if (e.target && e.target.closest && e.target.closest("[data-open-shop],[data-open-set],[data-open-me]")) return;  // 点商店入口别顺手开局
        if (state === "paused") { togglePause(); return; }
        if (state === "ready" || state === "over") { if (mayRestart()) startGame(); return; }
        pressJump();
      });
      stage.addEventListener("mouseup", releaseJump);
      stage.addEventListener("mouseleave", releaseJump);

      var touchY = null;
      stage.addEventListener("touchstart", function (e) {
        lastTouchAt = Date.now();
        if (helpVisible) return;                       // 玩法说明开着：触摸也不穿透
        if (e.target && e.target.closest && e.target.closest("[data-open-shop],[data-open-set],[data-open-me]")) return;  // 同上
        if (state === "paused") { e.preventDefault(); togglePause(); return; }
        /* 手机端：开始 / 重开只能点「开始游戏 / 再来一局」按钮（或按键盘）。
           这里直接放行——不 preventDefault、也不 startGame，让触摸照常派发到按钮的 click；
           点画面空白则完全没反应，避免误触直接开局 / 跳过结算界面。
           （鼠标端仍保留「点画面开局」的便利，见上面的 mousedown） */
        if (state === "ready" || state === "over") return;
        e.preventDefault();
        touchY = e.touches[0].clientY;
        pressJump();
      }, { passive: false });
      stage.addEventListener("touchmove", function (e) {
        if (touchY == null) return;
        e.preventDefault();
        if (e.touches[0].clientY - touchY > 28) { releaseJump(); pressDuck(); }
      }, { passive: false });
      stage.addEventListener("touchend", function (e) {
        /* ready / over 下的这一次触摸是「点按钮开始」，别在这里 preventDefault，
           否则浏览器不会补发 click，按钮就按下没反应了 */
        if (state === "ready" || state === "over") return;
        e.preventDefault();
        touchY = null;
        releaseJump(); releaseDuck();
      }, { passive: false });
    }

    window.addEventListener("blur", function () { if (state === "playing") togglePause(); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state === "playing") togglePause();
    });
    window.addEventListener("resize", resize);
  }

  /* ═══════════ 清理本地缓存（设置 → 缓存与数据） ═══════════
     清掉本机这一份跑酷存档：按 "runner-" 前缀扫 localStorage。
     ⚠️ **保留设置类键**（runner-set 音效/无障碍/自定义按键、runner-mute 旧的静音键）——
     那些是偏好不是存档，清个缓存顺手把人家的键位和无障碍设置也抹掉最气人。

     云端账号数据一律不碰。已登录时清完立刻从云端恢复（成就走 ach.js 的云同步、
     钱包与皮肤走 WowCloud.wallet.sync），再刷新页面：比只改内存干净 ——
     最高分（lastBest）这类启动时才读一次的变量也能跟着归位。 */
  var CACHE_PREFIX = "runner-";
  var CACHE_KEEP = { "runner-set": 1, "runner-mute": 1 };
  var elClearBtn = null, elClearWrap = null, elClearTip = null;
  var clearLogged = false;      // 上一次确认框问出来的登录状态（点了确认就用它）

  function clearLocalCache() {
    var removed = [], kept = [], keys = [], i, k;
    if (Ach && Ach.cloud && Ach.cloud.cancel) Ach.cloud.cancel();   // 先撤掉待发的上传，别把清空后的空档推到云端
    try {
      for (i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    } catch (e) { keys = []; }
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (!k || k.indexOf(CACHE_PREFIX) !== 0) continue;            // 只碰本游戏的键
      if (CACHE_KEEP[k]) { kept.push(k); continue; }
      try { localStorage.removeItem(k); removed.push(k); } catch (e) {}
    }
    if (Ach && Ach.clearLocal) Ach.clearLocal();                    // 内存里的成就也跟着归零
    return { removed: removed, kept: kept };
  }

  function clearTip(text, kind) {
    if (!elClearTip) return;
    elClearTip.className = "set-clear-tip" + (kind ? " is-" + kind : "");
    elClearTip.textContent = text || "";
  }

  /* 点「清理缓存」先问一句：登录与未登录的后果完全不一样，必须说清楚再动手 */
  function showClearConfirm() {
    if (elClearWrap) elClearWrap.classList.remove("hidden");
    if (elClearBtn) elClearBtn.disabled = true;
    clearTip("正在确认登录状态…");
    var C = window.WowCloud;
    if (!C || !C.session) { paintClearTip(false); return; }
    C.session().then(function (r) { paintClearTip(!!(r && r.data)); },
                     function () { paintClearTip(false); });
  }
  function hideClearConfirm() {
    if (elClearWrap) elClearWrap.classList.add("hidden");
    if (elClearBtn) elClearBtn.disabled = false;
    clearTip("");
  }
  function paintClearTip(logged) {
    clearLogged = !!logged;
    if (logged) {
      clearTip("已登录云账号：清理后会立刻从云端把成就与钱包恢复回来，本机不会真的丢东西。", "ok");
    } else {
      clearTip((window.WowCloud ? "当前未登录：" : "本站未接入云存档：") +
               "本机存档删掉就找不回来了。确定要清理吗？", "warn");
    }
  }

  var clearDone = false;
  function applyClearCache(logged) {
    if (clearDone) return;
    clearDone = true;
    var res = clearLocalCache();
    hideClearConfirm();
    toast("🧹 已清理本机缓存" + (res.removed.length ? "（" + res.removed.length + " 项）" : "") +
          (res.kept.length ? "，音效与按键设置已保留" : ""));
    reloadSoon(logged);
  }

  /* 已登录：先把云端那份（成就 + 钱包）拉回来，成功或超时都刷新页面 */
  function reloadSoon(logged) {
    /* 自动化测试（__RUNNER_MANUAL__）里不真跳转：jsdom 不支持导航，会把测试环境搅乱 */
    var reload = function () {
      if (window.__RUNNER_MANUAL__) return;
      try { location.reload(); } catch (e) {}
    };
    var jobs = [];
    if (logged) {
      if (Ach && Ach.cloud && Ach.cloud.sync) jobs.push(Ach.cloud.sync({ quiet: true }));
      var C = window.WowCloud;
      if (C && C.wallet && C.wallet.sync) jobs.push(C.wallet.sync());
    }
    var go = function (msg) {
      if (msg) toast(msg);
      setTimeout(reload, 800);
    };
    if (!jobs.length) { setTimeout(reload, 900); return; }
    var settled = false;
    var finish = function (msg) { if (settled) return; settled = true; go(msg); };
    var timer = setTimeout(function () { finish(""); }, 4000);       // 网络慢也不能把用户卡在这儿
    Promise.all(jobs).then(function (rs) {
      clearTimeout(timer);
      var a = rs[0], wal = rs[1];
      if (a && a.ok) finish("☁️ 已从云端恢复成就 " + a.unlocked + "/" + a.total);
      else if (wal && wal.ok) finish("☁️ 已从云端恢复钱包（" + wal.coins + " 金币）");
      else finish("✅ 已清理，正在刷新…");
    }, function () { clearTimeout(timer); finish("✅ 已清理，正在刷新…"); });
  }

  /* 设置面板的控件绑定（标记在页面里，这里只挂行为，缺元素自动跳过） */
  function bindSet() {
    if (!elSet) return;
    if (btnSetOpen) btnSetOpen.addEventListener("click", openSet);
    if (btnSetX) btnSetX.addEventListener("click", closeSet);
    if (btnSetBack) btnSetBack.addEventListener("click", function () { showSetView("main"); });
    elSet.addEventListener("click", function (e) {          // 点遮罩空白处关掉
      if (e.target === elSet) closeSet();
    });

    var entries = [["set-open-a11y", "a11y"], ["set-open-keys", "keys"]];
    for (var i = 0; i < entries.length; i++) {
      var b = document.getElementById(entries[i][0]);
      if (b) bindViewEntry(b, entries[i][1]);
    }

    /* 设置 → 玩法说明：先把设置收起来（set:close 会把局面恢复原样，不再定格），
       再弹说明；关掉说明后回到的还是进设置之前那个界面。 */
    var btnSetHelp = document.getElementById("set-open-help");
    if (btnSetHelp) btnSetHelp.addEventListener("click", function (e) {
      e.preventDefault();
      if (setOpen()) closeSet();
      openHelp();
    });

    var toggles = [elSetCb, elSetCalm, elSetBig];
    for (var t = 0; t < toggles.length; t++) {
      (function (entry, name) {
        if (!entry.el) return;
        entry.el.addEventListener("click", function () {
          entry.set(entry.el.getAttribute("aria-pressed") !== "true");   // 取反
          if (name === "cb" || name === "calm") refreshCanvasStyle();
        });
      })(toggles[t], ["cb", "calm", "big"][t]);
    }

    var vols = [elSetVol[0], elSetVol[1]];
    for (var v = 0; v < vols.length; v++) {
      if (!vols[v]) continue;
      (function (el) {
        var handler = function () {
          setOpt("vol", Number(el.value) / 100);
          Sfx.wake();
          if (!Sfx.isMuted() && SET.vol > 0) Sfx.coin();      // 拖动时试听一下音量
        };
        el.addEventListener("input", handler);
        el.addEventListener("change", handler);
      })(vols[v]);
    }

    var rk = document.getElementById("set-keys-reset");
    if (rk) rk.addEventListener("click", function () {
      resetKeys();
      toast("已恢复默认按键");
    });
    var va = document.getElementById("set-open-vol");
    if (va) va.addEventListener("click", function () { showSetView("a11y"); });

    /* 清理缓存：按钮 → 二段确认（问清登录状态）→ 清理 → 已登录则从云端恢复并刷新 */
    if (elClearBtn) elClearBtn.addEventListener("click", function (e) {
      e.preventDefault();
      showClearConfirm();
    });
    var cy = document.getElementById("set-clear-yes");
    if (cy) cy.addEventListener("click", function (e) { e.preventDefault(); applyClearCache(clearLogged); });
    var cn = document.getElementById("set-clear-no");
    if (cn) cn.addEventListener("click", function (e) { e.preventDefault(); hideClearConfirm(); });
  }

  function bindViewEntry(btn, view) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      showSetView(view);
    });
  }

  /* 色盲模式 / 减少闪烁 改了之后立刻重画一帧，不用等下一次 tick */
  function refreshCanvasStyle() { render(); updateHud(); }

  /* ═══════════ 初始化 ═══════════ */
  lastBest = parseInt(store(KEY_BEST) || "0", 10) || 0;
  applyA11y();                    // 先落无障碍类名（字号 / 关动效由 CSS 接管）
  initSetRefs();                  // 再抓设置面板的元素引用，之后 syncSetUi 才能同步
  resize();
  resetGame();
  bind();
  syncSetUi();                    // 把设置里的值刷到面板控件上（音效开关 / 音量 / 各开关 / 键位）
  render();
  /* 头像：先把本机缓存的那张画到个人页上；登录 / 换设备时由 cloud.js 自动对齐云端那份 */
  renderAvatar();
  if (CLOUD && CLOUD.avatar && CLOUD.avatar.bind) CLOUD.avatar.bind();
  /* 首次打开自动弹玩法说明（本机没记过「已读」才弹）。
     __RUNNER_MANUAL__ 是自动化测试的「手动驱动」标记：跑测试时跳过自动弹窗，
     免得每个用例都先要伸手点掉它；自动弹出的行为由 _help_test / _help_probe 专门覆盖。 */
  if (!window.__RUNNER_MANUAL__ && !helpSeen()) openHelp();
  if (!window.__RUNNER_MANUAL__ && window.requestAnimationFrame) rafId = window.requestAnimationFrame(frame);

  /* ═══════════ 对外接口（控制台调试 / 自动化测试） ═══════════ */
  window.Runner = {
    CFG: CFG,
    state: function () { return state; },
    start: startGame,
    reset: resetGame,
    pause: function () { if (state === "playing") togglePause(); },
    resume: function () { if (state === "paused") togglePause(); },
    tick: function (ms) { step(clamp((ms === undefined ? 16.7 : ms) / 1000, 0, 0.05)); render(); },
    jump: pressJump,
    release: function () { releaseJump(); releaseDuck(); },
    duck: function (on) { on ? pressDuck() : releaseDuck(); },
    spawnObstacle: function (kind, x, h) { return addObstacle(kind || "ground", x, h); },
    spawnItem: function (kind, x, y) {
      if (kind === "coffee") addCoffee(x === undefined ? CFG.W + 60 : x);
      else addFishArc(x === undefined ? CFG.W + 60 : x, 1);
      var it = items[items.length - 1];
      if (it && typeof y === "number") it.y = y;
      return it || null;
    },
    records: loadRecords,
    /* 商店弹层（供控制台与测试使用） */
    openShop: openShop,
    closeShop: closeShop,
    shopOpen: shopOpen,
    /* 设置弹层（音效 / 无障碍 / 自定义按键）：供控制台与测试使用 */
    openSet: openSet,
    closeSet: closeSet,
    setOpen: setOpen,
    setView: showSetView,
    /* 玩法说明（首访自动弹 / 设置里手动开）：供控制台与测试使用 */
    openHelp: openHelp,
    closeHelp: closeHelp,
    helpOpen: helpOpen,
    helpSeen: helpSeen,
    /* 蹲下 / 起立 过渡（0 站立 → 1 蹲下）：供控制台与自动化测试查看 */
    crouch: function () { return P.crouch; },
    crouchEased: easeCrouch,
    visHeight: crouchVisH,
    settings: function () {
      var keys = {};
      for (var a = 0; a < KEY_ACTIONS.length; a++) keys[KEY_ACTIONS[a]] = keyList(KEY_ACTIONS[a]).slice();
      return { sfx: !!SET.sfx, vol: SET.vol, cb: !!SET.cb, calm: !!SET.calm, big: !!SET.big, keys: keys };
    },
    setOption: function (name, val) { return setOpt(name, val); },
    /* 清理本地缓存：纯清理（不刷新页面，供测试用）
       + 面板那条完整流程（确认框在页面里，见 showClearConfirm / applyClearCache） */
    clearCache: clearLocalCache,
    clearCacheConfirm: showClearConfirm,
    clearCacheApply: applyClearCache,
    keys: function () { return SET.keys; },
    setKeys: function (next) { return setKeys(next); },
    resetKeys: function () { return resetKeys(); },
    keyLabel: keyName,
    keyHint: keyHint,
    /* 当前配色（色盲模式会改写它），给取证探针看 */
    palette: function () { return cbPalette(paletteAt(worldDist() * 0.4)); },
    /* 成就（/ach.js）：面板开关 + 只读快照，供控制台与测试使用 */
    openAch: function () { if (Ach && Ach.open) Ach.open(); },
    closeAch: function () { if (Ach && Ach.close) Ach.close(); },
    achOpen: function () { return achOpen(); },
    achState: function () { return Ach && Ach.snapshot ? Ach.snapshot() : null; },
    achReset: function () { if (Ach && Ach.reset) Ach.reset(); },
    /* 个人中心「个人」页（头像 + 成就进度）：供控制台与测试使用 */
    openMe: openMe,
    closeMe: closeMePanel,
    meOpen: meOpen,
    meState: function () {
      var snap = (Ach && Ach.snapshot) ? Ach.snapshot() : null;
      return {
        open: meOpen(),
        avatar: avatarLocal(),
        nick: elMeNick ? elMeNick.textContent : "",
        got: snap ? snap.unlocked : null,
        total: snap ? snap.total : null,
        tiers: elMeTiers ? elMeTiers.querySelectorAll(".me-tier").length : 0,
        bar: elMeBarFill ? elMeBarFill.style.width : ""
      };
    },
    setAvatar: saveAvatar,
    compressAvatar: compressAvatar,
    avatar: avatarLocal,
    /* 钱包 / 皮肤（供控制台与测试使用） */
    wallet: function () { return Skins.getWallet(); },
    setWallet: function (n) { var v = Skins.setWallet(n); updateHud(); return v; },
    skins: function () { return { player: skinPlayer, coin: skinCoin }; },
    clearObstacles: function () { obstacles.length = 0; },
    /* 测试钩子：把速度（近似）拉到 v —— 速度由 S.time 推导，这里直接改时间轴，
       下一帧起 S.speed = SPEED0 + SPEED_ACC × S.time 生效 */
    setSpeed: function (v) {
      S.time = Math.max(0, (Math.max(CFG.SPEED0, Math.min(CFG.SPEED_MAX, v)) - CFG.SPEED0) / CFG.SPEED_ACC);
      return CFG.SPEED0 + CFG.SPEED_ACC * S.time;
    },
    /* 只读快照：供调试与「自动试跑」测试读取当前障碍分布 */
    obstacles: function () {
      return obstacles.map(function (o) {
        /* y/h 是碰撞盒（空中障碍=悬浮瓶身，所见即所撞）；
           by/bh 是本体矩形的顶边与高度，测试与工具看这个更直观 */
        var bb = obBody(o);
        return { kind: o.kind, id: o.id, x: o.x, y: o.y, w: o.w, h: o.h,
                 by: bb.y, bh: bb.h };
      });
    },
    items: function () {
      return items.map(function (it) {
        return { id: it.id, kind: it.kind, x: it.x, y: it.y, r: it.r, ph: it.ph, dash: !!it.dash };
      });
    },
    /* 本局所有道具的出生信息（含离地高度），用于核对金币可达性 */
    spawned: function () { return itemLog.slice(); },
    clearRecords: function () {
      try { localStorage.removeItem(KEY_SCORES); localStorage.removeItem(KEY_BEST); } catch (e) {}
      lastBest = 0;                                 // 同步清掉内存里的最高分
      if (S) S.best = 0;
      updateHud();
    },
    setRandom: function (fn) { random = typeof fn === "function" ? fn : Math.random; },
    snapshot: function () {
      return {
        state: state, speed: S.speed, dist: S.dist, score: S.score, coins: S.coins,
        boost: S.boost, best: lastBest, isBest: S.isBest,
        wallet: Skins.getWallet(), banked: S.banked,
        player: { y: P.y, vy: P.vy, onGround: P.onGround, duck: P.duck, h: curH(),
                  crouch: P.crouch, crouchK: crouchK(), visH: crouchVisH() },
        obstacles: obstacles.length, items: items.length,
        waves: S.waves, groups: S.groups,
        /* 成就统计（本局） */
        jumps: S.jumps, shields: S.shields, smashes: S.smashes, crashed: S.crashed
      };
    }
  };
})();
