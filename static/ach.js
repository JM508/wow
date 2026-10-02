/* ══════════════════════════════════════════════════════════════
   火柴人快跑 · 成就系统
   ──────────────────────────────────────────────────────────────
   · 18 个成就，分「入门 / 进阶 / 大师」三档
   · 数据只存本机浏览器（localStorage: runner-ach），不联网、不上传
   · 两种判定时机：
       局内实时 —— 跳跃数 / 满速 / 距离 / 分数这类「当场达成」的，
                   满足的那一刻就解锁并弹提示（不等这一局结束）
       局末结算 —— 跑完一局时结算，同时累计「总局数 / 累计里程 / 累计金币」
   · 与游戏本体的唯一接口：runner.js 调 live(快照) / finish(快照)，
     快照里的字段名见 snapshotCtx 的注释；ach.js 不认识游戏内部结构
   · 纯外链脚本、无内联代码（全站 CSP 同源白名单，禁 unsafe-inline）
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var PX_PER_M = 100;      // 世界坐标换算：100px = 1 米（与 gameOver 里 dist/100 一致）
  var MAX_SPEED = 880;     // 与 runner.js 的 CFG.SPEED_MAX 一致（音速冲刺用）
  var KEY = "runner-ach";

  /* ═══════════════ 档位 ═══════════════ */
  var TIERS = [
    { id: "novice",      name: "入门", icon: "🌱" },
    { id: "progressive", name: "进阶", icon: "🚀" },
    { id: "master",      name: "大师", icon: "👑" }
  ];

  /* ═══════════════ 成就定义 ═══════════════
     test(s) 判定是否达成；prog(s) 给出未解锁时的进度 [当前, 目标, 单位]。
     s 的字段：
       本局：score 分 / meters 米 / coins 枚 / jumps 次 / shields 护盾数
             / smashes 无敌撞碎障碍数 / speed 当前速度 / noHit 本局零碰撞
       历史最好（单局维度）：bestScore / bestMeters / bestCoins / bestJumps
       累计：runs 总局数 / totalMeters 总里程 / totalCoins 总金币
       皮肤：skins 已拥有火柴人皮肤数 / skinsTotal 皮肤总数 */
  var ACHS = [
    /* ─────────── 入门 ─────────── */
    { id: "first_run", tier: "novice", icon: "👟", name: "初次起跑",
      desc: "完成第一局奔跑",
      live: false,
      test: function (s) { return s.runs >= 1; },
      prog: function (s) { return [Math.min(s.runs, 1), 1, "局"]; } },

    { id: "score1000", tier: "novice", icon: "🎯", name: "初见成效",
      desc: "单局拿到 1000 分",
      live: true,
      test: function (s) { return s.score >= 1000; },
      prog: function (s) { return [Math.min(best(s.score, s.bestScore), 1000), 1000, "分"]; } },

    { id: "dist1000", tier: "novice", icon: "🏃", name: "千里之行",
      desc: "单局跑满 1000 米",
      live: true,
      test: function (s) { return s.meters >= 1000; },
      prog: function (s) { return [Math.min(best(s.meters, s.bestMeters), 1000), 1000, "米"]; } },

    { id: "coins20", tier: "novice", icon: "🪙", name: "金币新手",
      desc: "单局收集 20 枚金币",
      live: true,
      test: function (s) { return s.coins >= 20; },
      prog: function (s) { return [Math.min(best(s.coins, s.bestCoins), 20), 20, "枚"]; } },

    { id: "total5000", tier: "novice", icon: "🛤️", name: "小有积累",
      desc: "累计跑满 5000 米",
      live: false,
      test: function (s) { return s.totalMeters >= 5000; },
      prog: function (s) { return [Math.min(s.totalMeters, 5000), 5000, "米"]; } },

    /* ─────────── 进阶 ─────────── */
    { id: "score3000", tier: "progressive", icon: "📈", name: "渐入佳境",
      desc: "单局拿到 3000 分",
      live: true,
      test: function (s) { return s.score >= 3000; },
      prog: function (s) { return [Math.min(best(s.score, s.bestScore), 3000), 3000, "分"]; } },

    { id: "score5000", tier: "progressive", icon: "🏅", name: "五千俱乐部",
      desc: "单局拿到 5000 分",
      live: true,
      test: function (s) { return s.score >= 5000; },
      prog: function (s) { return [Math.min(best(s.score, s.bestScore), 5000), 5000, "分"]; } },

    { id: "jump100", tier: "progressive", icon: "🦘", name: "弹跳如飞",
      desc: "单局起跳 100 次",
      live: true,
      test: function (s) { return s.jumps >= 100; },
      prog: function (s) { return [Math.min(best(s.jumps, s.bestJumps), 100), 100, "次"]; } },

    { id: "coins50", tier: "progressive", icon: "💰", name: "金币猎人",
      desc: "单局收集 50 枚金币",
      live: true,
      test: function (s) { return s.coins >= 50; },
      prog: function (s) { return [Math.min(best(s.coins, s.bestCoins), 50), 50, "枚"]; } },

    { id: "shield3", tier: "progressive", icon: "🛡️", name: "护盾三连",
      desc: "单局吃到 3 个护盾",
      live: true,
      test: function (s) { return s.shields >= 3; },
      prog: function (s) { return [Math.min(s.shields, 3), 3, "个"]; } },

    { id: "nohit1000", tier: "progressive", icon: "✨", name: "完美一圈",
      desc: "整局一次都没碰到障碍，跑满 1000 米",
      live: true,
      test: function (s) { return s.noHit && s.meters >= 1000; },
      prog: function (s) { return [Math.min(s.noHit ? s.meters : 0, 1000), 1000, "米"]; } },

    { id: "shop3", tier: "progressive", icon: "🎨", name: "皮肤收藏家",
      desc: "拥有 3 款火柴人皮肤",
      live: false,
      test: function (s) { return s.skins >= 3; },
      prog: function (s) { return [Math.min(s.skins, 3), 3, "款"]; } },

    /* ─────────── 大师 ─────────── */
    { id: "score8000", tier: "master", icon: "🔥", name: "一气呵成",
      desc: "单局拿到 8000 分",
      live: true,
      test: function (s) { return s.score >= 8000; },
      prog: function (s) { return [Math.min(best(s.score, s.bestScore), 8000), 8000, "分"]; } },

    { id: "nohit2000", tier: "master", icon: "💎", name: "毫发无伤",
      desc: "整局一次都没碰到障碍，跑满 2000 米",
      live: true,
      test: function (s) { return s.noHit && s.meters >= 2000; },
      prog: function (s) { return [Math.min(s.noHit ? s.meters : 0, 2000), 2000, "米"]; } },

    { id: "jump200", tier: "master", icon: "🪽", name: "永不落地",
      desc: "单局起跳 200 次",
      live: true,
      test: function (s) { return s.jumps >= 200; },
      prog: function (s) { return [Math.min(best(s.jumps, s.bestJumps), 200), 200, "次"]; } },

    { id: "maxspeed", tier: "master", icon: "⚡", name: "音速冲刺",
      desc: "单局速度跑到上限",
      live: true,
      test: function (s) { return s.speed >= MAX_SPEED; },
      prog: function (s) { return [Math.min(Math.round(s.speed), MAX_SPEED), MAX_SPEED, "px/s"]; } },

    { id: "total20000", tier: "master", icon: "🌏", name: "万里长征",
      desc: "累计跑满 20000 米",
      live: false,
      test: function (s) { return s.totalMeters >= 20000; },
      prog: function (s) { return [Math.min(s.totalMeters, 20000), 20000, "米"]; } },

    { id: "allskins", tier: "master", icon: "👑", name: "皮肤大亨",
      desc: "集齐全部火柴人皮肤",
      live: false,
      test: function (s) { return s.skinsTotal > 0 && s.skins >= s.skinsTotal; },
      prog: function (s) { return [Math.min(s.skins, s.skinsTotal), s.skinsTotal, "款"]; } }
  ];

  function best() {
    var m = 0;
    for (var i = 0; i < arguments.length; i++) if (arguments[i] > m) m = arguments[i];
    return m;
  }

  /* ═══════════════ 存档 ═══════════════
     { v: 1, got: { 成就id: 解锁时间戳 }, stat: { 累计统计 } } */
  var EMPTY_STAT = { runs: 0, totalDist: 0, totalCoins: 0,
                     bestScore: 0, bestMeters: 0, bestCoins: 0, bestJumps: 0 };
  var data = load();

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function load() {
    var out = { v: 1, got: {}, stat: {} };
    var raw = null;
    try { raw = JSON.parse(lsGet(KEY) || "null"); } catch (e) { raw = null; }
    if (raw && typeof raw === "object") {
      if (raw.got && typeof raw.got === "object") {
        for (var k in raw.got) {
          if (!Object.prototype.hasOwnProperty.call(raw.got, k)) continue;
          var ts = Number(raw.got[k]);
          if (isKnown(k)) out.got[k] = ts > 0 ? ts : 1;      // 兼容老版本只存 true 的情况
        }
      }
      if (raw.stat && typeof raw.stat === "object") {
        for (var f in EMPTY_STAT) {
          var v = Number(raw.stat[f]);
          if (isFinite(v) && v >= 0) out.stat[f] = Math.floor(v);
        }
      }
    }
    for (var f2 in EMPTY_STAT) if (out.stat[f2] === undefined) out.stat[f2] = EMPTY_STAT[f2];
    return out;
  }
  function save() { lsSet(KEY, JSON.stringify(data)); }

  function isKnown(id) {
    for (var i = 0; i < ACHS.length; i++) if (ACHS[i].id === id) return true;
    return false;
  }
  function def(id) {
    for (var i = 0; i < ACHS.length; i++) if (ACHS[i].id === id) return ACHS[i];
    return null;
  }

  /* ═══════════════ 皮肤统计（成就用；商店不存在时按 0 处理） ═══════════════
     live() 每帧都会走 ctx()，而数皮肤要读 10 次 localStorage，
     所以这里缓存一份，只在「买到/换上皮肤」时失效。 */
  var skinCache = null;
  function skinStats() {
    if (skinCache) return skinCache;
    var Skins = global.RunnerSkins;
    var players = Skins && Skins.PLAYERS;
    if (!players || !players.length) return { owned: 0, total: 0 };
    var n = 0;
    for (var i = 0; i < players.length; i++) {
      if (Skins.isOwned && Skins.isOwned("player", players[i].id)) n++;
    }
    skinCache = { owned: n, total: players.length };
    return skinCache;
  }
  function refreshSkins() { skinCache = null; }

  /* ═══════════════ 快照 → 判定上下文 ═══════════════ */
  function ctx(snap) {
    snap = snap || {};
    var sk = skinStats();
    var dist = Number(snap.dist) || 0;
    var smashes = Number(snap.smashes) || 0;
    return {
      /* 本局 */
      score: Math.floor(Number(snap.score) || 0),
      meters: Math.floor(dist / PX_PER_M),
      coins: Number(snap.coins) || 0,
      jumps: Number(snap.jumps) || 0,
      shields: Number(snap.shields) || 0,
      smashes: smashes,
      speed: Number(snap.speed) || 0,
      noHit: smashes === 0 && !snap.crashed,
      /* 历史最好 / 累计 */
      bestScore: data.stat.bestScore,
      bestMeters: data.stat.bestMeters,
      bestCoins: data.stat.bestCoins,
      bestJumps: data.stat.bestJumps,
      runs: data.stat.runs,
      totalMeters: Math.floor(data.stat.totalDist / PX_PER_M),
      totalCoins: data.stat.totalCoins,
      /* 皮肤 */
      skins: sk.owned,
      skinsTotal: sk.total
    };
  }

  /* ═══════════════ 解锁 ═══════════════ */
  function unlock(id, quiet) {
    if (data.got[id]) return false;
    data.got[id] = Date.now();
    save();
    var d = def(id);
    refreshBadge();
    flashBadge();
    try { document.dispatchEvent(new CustomEvent("ach:unlock", { detail: d })); } catch (e) {}
    if (!quiet && d) say("🏅 成就解锁：「" + d.name + "」");
    return true;
  }

  /* 工具条按钮闪两下：不弹面板也知道「刚解锁了东西」 */
  function flashBadge() {
    if (!btnOpen || !btnOpen.classList) return;
    btnOpen.classList.remove("is-new");
    void btnOpen.offsetWidth;                        // 强制重排，让动画能重播
    btnOpen.classList.add("is-new");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { btnOpen.classList.remove("is-new"); }, 1300);
  }
  var flashTimer = null;

  function say(msg) {
    try { document.dispatchEvent(new CustomEvent("run:toast", { detail: msg })); } catch (e) {}
  }

  /* 一轮判定：live 阶段只判「本局型」，局末全量判（含累计型与皮肤型） */
  function evaluate(c, all) {
    var out = [], i;
    for (i = 0; i < ACHS.length; i++) {
      var a = ACHS[i];
      if (data.got[a.id]) continue;
      if (!all && !a.live) continue;
      var ok = false;
      try { ok = !!a.test(c); } catch (e) { ok = false; }
      if (ok) out.push(a.id);
    }
    for (i = 0; i < out.length; i++) unlock(out[i], true);
    if (out.length) {
      if (out.length === 1) {
        var d = def(out[0]);
        say("🏅 成就解锁：「" + d.name + "」");
      } else {
        say("🏅 一次解锁 " + out.length + " 个成就：" + out.slice(0, 3).map(function (id) {
          return def(id).name;
        }).join("、") + (out.length > 3 ? " 等" : ""));
      }
    }
    return out;
  }

  /* ═══════════════ 对外：局内 / 局末 ═══════════════ */
  var lastKey = "";

  function live(snap) {
    cur = snap;                                    // 供面板显示实时进度
    var c = ctx(snap);
    /* 每帧都会被调用：数值没动就直接早退，避免无谓的 18 次条件判断 */
    var k = c.score + "|" + c.meters + "|" + c.coins + "|" + c.jumps + "|" +
            c.shields + "|" + c.smashes + "|" + (c.noHit ? 1 : 0) + "|" + (c.speed >= MAX_SPEED ? 1 : 0);
    if (k === lastKey) return [];
    lastKey = k;
    return evaluate(c, false);
  }

  function finish(snap) {
    var c = ctx(snap);
    /* 结算累计值：注意先用这一局的数据更新 stat，再全量判定 */
    data.stat.runs += 1;
    data.stat.totalDist += Math.floor(Number(snap.dist) || 0);
    data.stat.totalCoins += Number(snap.coins) || 0;
    data.stat.bestScore = Math.max(data.stat.bestScore, c.score);
    data.stat.bestMeters = Math.max(data.stat.bestMeters, c.meters);
    data.stat.bestCoins = Math.max(data.stat.bestCoins, c.coins);
    data.stat.bestJumps = Math.max(data.stat.bestJumps, c.jumps);
    save();
    lastKey = "";                                   // 下一局重新开始比对
    return evaluate(ctx(snap), true);
  }

  function reset() {
    data = { v: 1, got: {}, stat: {} };
    for (var f in EMPTY_STAT) data.stat[f] = EMPTY_STAT[f];
    save();
    lastKey = "";
    render();
    refreshBadge();
  }

  /* ═══════════════ 面板 ═══════════════ */
  var panel = document.getElementById("run-ach");
  var elList = document.getElementById("ach-list");
  var elProg = document.getElementById("ach-progress");
  var btnOpen = document.getElementById("run-ach-btn");
  var btnClose = document.getElementById("run-ach-close");

  function unlockedCount() {
    var n = 0;
    for (var i = 0; i < ACHS.length; i++) if (data.got[ACHS[i].id]) n++;
    return n;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDay(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime()) || !ts) return "";
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  /* ═══════════════ 徽章（工具条按钮上的 n/18） ═══════════════ */
  function refreshBadge() {
    if (!btnOpen) return;
    var n = unlockedCount();
    var span = btnOpen.querySelector ? btnOpen.querySelector(".ach-count") : null;
    if (span) span.textContent = n + "/" + ACHS.length;
    btnOpen.setAttribute("title", "成就：" + n + " / " + ACHS.length + " 已解锁");
  }

  /* ═══════════════ 渲染面板 ═══════════════ */
  function render() {
    var c = ctx(cur);                                // cur = 最近一次局内快照（没有就用历史最好）
    var n = unlockedCount(), i, j;

    if (elProg) {
      var pct = Math.round(n / ACHS.length * 100);
      elProg.innerHTML =
        "<div class='ach-bar-outer'><i style='width:" + pct + "%'></i></div>" +
        "<p class='ach-bar-text'>已解锁 <b>" + n + "</b> / " + ACHS.length + " 个成就（" + pct + "%）" +
        "　累计跑 <b>" + c.totalMeters + "</b> 米 · <b>" + c.runs + "</b> 局</p>";
    }

    if (!elList) return;
    var html = "";
    for (i = 0; i < TIERS.length; i++) {
      var t = TIERS[i], got = 0, rows = "";
      for (j = 0; j < ACHS.length; j++) if (ACHS[j].tier === t.id) {
        if (data.got[ACHS[j].id]) got++;
        rows += rowHtml(ACHS[j], c);
      }
      html += "<section class='ach-group ach-" + t.id + "'>" +
        "<h4><span class='ach-tier-ico'>" + t.icon + "</span>" + t.name +
        "<em>" + got + " / " + countTier(t.id) + "</em></h4>" +
        "<ul class='ach-rows'>" + rows + "</ul></section>";
    }
    elList.innerHTML = html;
  }

  function countTier(tier) {
    var n = 0;
    for (var i = 0; i < ACHS.length; i++) if (ACHS[i].tier === tier) n++;
    return n;
  }

  function rowHtml(a, c) {
    var ts = data.got[a.id];
    var on = !!ts;
    var body = on
      ? "<span class='ach-got'>已解锁 · " + fmtDay(ts) + "</span>"
      : (function () {
          var p = null;
          try { p = a.prog ? a.prog(c) : null; } catch (e) { p = null; }
          if (!p) return "<span class='ach-todo'>未解锁</span>";
          var pct = p[1] > 0 ? Math.min(100, Math.round(p[0] / p[1] * 100)) : 0;
          return "<span class='ach-todo'>" +
            "<i class='ach-mini'><b style='width:" + pct + "%'></b></i>" +
            "<em class='ach-nums'>" + p[0] + " / " + p[1] + " " + p[2] + "</em></span>";
        })();
    return "<li class='ach-row" + (on ? " is-on" : "") + "'>" +
      "<span class='ach-ico' aria-hidden='true'>" + (on ? a.icon : "🔒") + "</span>" +
      "<span class='ach-txt'><b>" + esc(a.name) + "</b><em>" + esc(a.desc) + "</em></span>" +
      body + "</li>";
  }

  /* 面板打开时用最近的局内快照渲染进度（在游戏里玩到一半打开面板，看到的也是实时进度） */
  var cur = null;

  function isOpen() { return !!panel && !panel.classList.contains("hidden"); }
  function open() {
    if (!panel || isOpen()) return;
    panel.classList.remove("hidden");
    render();
    document.dispatchEvent(new CustomEvent("ach:open"));      // runner.js 借此把局面定格
  }
  function close() {
    if (!panel || !isOpen()) return;
    panel.classList.add("hidden");
    document.dispatchEvent(new CustomEvent("ach:close"));
  }

  if (panel) {
    if (btnOpen) btnOpen.addEventListener("click", open);
    if (btnClose) btnClose.addEventListener("click", close);
    /* 正文里的「🏅 成就」链接式入口（长得像链接，其实是开面板的按钮） */
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("[data-open-ach]")) { e.preventDefault(); open(); }
    });
    /* 点遮罩空白处关闭（点面板本体不关） */
    panel.addEventListener("click", function (e) { if (e.target === panel) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) { e.preventDefault(); close(); }
    });
    /* 钱包 / 皮肤变化（买皮肤、云存档恢复、局末金币入账都会触发）：
       清掉皮肤缓存并补判一次皮肤类成就 —— 刚集齐就当场解锁，不用等下一局 */
    document.addEventListener("wallet:change", function () {
      refreshSkins();
      if (!data.got.allskins || !data.got.shop3) evaluate(ctx(cur), true);
      if (isOpen()) render();
    });
    render();
    refreshBadge();
  }

  /* ═══════════════ 对外接口 ═══════════════ */
  global.RunnerAch = {
    KEYS: { ach: KEY },
    TIERS: TIERS,
    TOTAL: ACHS.length,
    MAX_SPEED: MAX_SPEED,
    live: live,
    finish: finish,
    reset: reset,
    open: open,
    close: close,
    isOpen: isOpen,
    render: render,
    unlocked: function () {
      var out = [];
      for (var i = 0; i < ACHS.length; i++) if (data.got[ACHS[i].id]) out.push(ACHS[i].id);
      return out;
    },
    /* 只读快照：面板与自动化测试用 */
    snapshot: function () {
      return {
        unlocked: unlockedCount(),
        total: ACHS.length,
        got: (function () { var o = {}; for (var k in data.got) if (data.got[k]) o[k] = data.got[k]; return o; })(),
        stat: (function () { var o = {}; for (var f in data.stat) o[f] = data.stat[f]; return o; })(),
        rows: ACHS.map(function (a) { return { id: a.id, tier: a.tier, name: a.name, got: !!data.got[a.id] }; })
      };
    },
    /* 测试用：直接塞一份假存档（不校验 id），或塞一份局内快照 */
    __setData: function (obj) {
      if (!obj) return;
      data = obj;
      if (!data.got) data.got = {};
      if (!data.stat) data.stat = {};
      for (var f in EMPTY_STAT) if (data.stat[f] === undefined) data.stat[f] = EMPTY_STAT[f];
      save(); render(); refreshBadge();
    },
    __setCur: function (snap) { cur = snap; }
  };
})(window);
