/* ══════════════════════════════════════════════════════════════
   云服务接入层（Wow 娱乐小站 · 全站共用）
   ──────────────────────────────────────────────────────────────
   · 客户端只在这里初始化一次，其他脚本一律通过 window.WowCloud 调用
     （初始化参数 endpoint / publishableKey 来自开通云服务时返回的
      publicConfig，只有这两个值可以出现在前端代码里）
   · SDK 走站点同源文件 /vendor/workbuddy-cloud-sdk.global.js
     （全站 CSP 是 script-src 'self' 白名单，不用公共 CDN）
   · 所有错误都翻译成中文可读提示：网络失败 / 未登录 / 无权限 /
     域名未绑定 / 表不存在 …… 任何一条都不会静默失败
   · 双域名：云服务端只认「发布域 + 本地回环」，其他域名（Cloudflare
     主站 wow-d9s.pages.dev）自动改走本站同源代理 /.cloud/*，
     由仓库根目录 functions/_middleware.js 改写 Origin 后转发
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  /* ── publicConfig：开通云服务时返回，前端可安全携带 ── */
  var PUBLIC_CONFIG = {
    endpoint: "https://wow-blog.app.workbuddy.host",
    publishableKey: "wbpk_dGlKhLDrZRLF6YuQQJWWWV_kdS84808B2F9Y1Wq6jVQpWQPvEASGH4c"
  };

  /* ═══════════ 数据面地址选择 ═══════════
     云服务端对 Origin 做精确匹配，白名单 = 发布域 + 本地回环：
       · 发布域 / 本地预览 → 直连（原样使用 publicConfig.endpoint）
       · 其他域名        → 改用 location.origin，让请求变成同源 /.cloud/*
                           再交给 Pages Function 转发（见 functions/_middleware.js）
     这样两个域名都能用云功能，且不需要把任何密钥放到前端。 */
  var API = PUBLIC_CONFIG.endpoint;
  var VIA_PROXY = false;
  (function pickEndpoint() {
    try {
      if (!/^https?:$/.test(location.protocol)) return;         // file:// 等：保持直连
      if (location.origin === PUBLIC_CONFIG.endpoint) return;    // 发布域：直连
      var host = location.hostname;
      var loopback = host === "localhost" || host === "127.0.0.1" ||
                     host === "::1" || host === "[::1]";
      if (loopback) return;                                     // 本地预览：直连
      API = location.origin;                                    // 其余域名：同源代理
      VIA_PROXY = true;
    } catch (e) { /* 拿不到 location 时按直连处理 */ }
  })();
  function publishHost() { return PUBLIC_CONFIG.endpoint.replace(/^https?:\/\//, ""); }

  var TABLE_WALLETS = "runner_wallets";   // 钱包云存档（仅本人可读写）
  var TABLE_SCORES  = "runner_scores";    // 排行榜成绩（所有人可看，仅本人可提交）
  var NICK_KEY      = "runner-nick";      // 昵称本地缓存（提交成绩用）
  var NICK_MAX      = 16;
  var LEADER_LIMIT  = 20;

  /* ═══════════ 客户端（只建一次） ═══════════ */
  var client = null;
  var initError = null;

  function build() {
    if (client || initError) return client;
    var sdk = global.WorkBuddyCloud;
    if (!sdk || typeof sdk.createWorkBuddyCloud !== "function") {
      initError = { kind: "sdk-missing", message: "云服务组件未加载", status: 0 };
      return null;
    }
    try {
      client = sdk.createWorkBuddyCloud({
        endpoint: API,
        publishableKey: PUBLIC_CONFIG.publishableKey
      });
    } catch (e) {
      initError = { kind: "init-failed", message: (e && e.message) || "云服务初始化失败", status: 0 };
      client = null;
    }
    return client;
  }

  function auth() { var c = build(); return c ? c.auth : null; }
  function db()   { var c = build(); return c ? c.database : null; }

  /* ═══════════ 错误 → 中文提示 ═══════════ */
  function describe(err) {
    if (!err) return "";
    if (initError) return "云服务组件未加载，请刷新页面重试";
    var kind = err.kind || "", code = err.code || "", status = err.status || 0;

    /* 网关层会直接把错误体回给我们，形如 { error, error_description }——
       既没有 kind 也没有 code，落到最后只会显示「云服务出错了」，
       用户点多少次都没用。这类错误必须单独认出来。
       最常见的两种：域名没绑定到本应用（403 access_denied）、登录态失效。 */
    var gate = err.error || "";
    var gateDesc = err.error_description || "";
    if (gate === "access_denied" || /origin is not allowed/i.test(gateDesc)) {
      return VIA_PROXY
        ? "本站到云服务的转发未通过校验，请刷新重试；若一直失败可改用 " + publishHost() + " 访问"
        : "当前域名（" + location.host + "）未绑定云服务，请改用 " + publishHost() + " 访问";
    }
    if (gate === "unauthorized" || gate === "invalid_token" || gate === "invalid_grant") {
      return "登录状态已失效，请重新登录";
    }
    /* 代理层的来源校验拒绝：非本站页面发起，或浏览器过旧没带来源信息 */
    if (gate === "forbidden_origin") {
      return "本站的云服务转发拒绝了这次请求，请刷新重试；若一直失败可改用 " + publishHost() + " 访问";
    }
    if (gate === "upstream_unreachable") {
      return "云服务暂时连不上，请稍后重试";
    }
    /* 代理模式下的典型故障：转发函数没生效，请求被静态站点当成不存在的页面，
       拿回来的是 HTML，SDK 解析 JSON 失败。这条要排在通用分支前面，
       否则会被 invalid-request 吃掉、只丢回一句英文原文。 */
    if (VIA_PROXY && /json|parse|unexpected|<!doctype|html/i.test(String(err.message || "") + " " + kind)) {
      return "本站的云服务转发未生效，请刷新重试；若一直失败可改用 " + publishHost() + " 访问";
    }
    if (gateDesc) return String(gateDesc);
    if (gate) return "云服务拒绝了这次请求（" + gate + "）";

    if (kind === "network" || status === 0 && kind === "network") {
      return "网络连接失败，请检查网络后重试";
    }
    if (code === "42P01") return "云端数据表尚未就绪，请稍后再试";
    if (code === "23505") return "已经存在同名记录，换一个昵称试试";
    if (code === "42501") return "没有权限执行该操作，请重新登录";
    if (kind === "unauthenticated") return "登录状态已过期，请重新登录";
    if (kind === "permission-denied") {
      /* 网关层的 403 多半是「当前域名没绑定到这个应用」 */
      return VIA_PROXY
        ? "云服务拒绝了本站的转发请求，请刷新重试；若一直失败可改用 " + publishHost() + " 访问"
        : "当前域名未绑定云服务（" + location.host + "），请在 " + publishHost() + " 下使用云存档与排行榜";
    }
    if (kind === "rate-limited") return "操作太频繁，请稍后再试";
    if (kind === "backend-unavailable") return "云服务暂时不可用，请稍后重试";
    if (kind === "invalid-request") return err.message || "请求参数有误";
    if (kind === "not-found") return "没有找到对应数据";
    return err.message || "云服务出错了，请稍后重试";
  }

  function envUnavailable() {
    if (build()) return null;
    return { kind: initError ? initError.kind : "sdk-missing", message: describe(null), status: 0 };
  }

  /* ═══════════ 会话 ═══════════ */
  var sessionCache = null;      // undefined = 未查过，null = 未登录，对象 = 已登录
  function currentSession(force) {
    var a = auth();
    if (!a) return Promise.resolve({ data: null, error: envUnavailable() });
    if (!force && sessionCache !== undefined) return Promise.resolve({ data: sessionCache, error: null });
    return a.getSession().then(function (r) {
      sessionCache = (r && r.error) ? null : ((r && r.data) || null);
      return r;
    });
  }
  function clearSessionCache() { sessionCache = undefined; }
  function user() { return sessionCache ? sessionCache.user : null; }
  function userId() { var u = user(); return u ? u.id : null; }

  function onAuthChange(cb) {
    var a = auth();
    if (!a || typeof a.onAuthStateChange !== "function") return function () {};
    return a.onAuthStateChange(function (event, session) {
      sessionCache = session || null;
      try { cb(event, session); } catch (e) {}
    });
  }

  function signOut() {
    var a = auth();
    if (!a) return Promise.resolve({ data: null, error: envUnavailable() });
    clearSessionCache();
    return a.signOut();
  }

  /* ═══════════ 昵称（提交成绩用） ═══════════ */
  function nick() {
    try { return (localStorage.getItem(NICK_KEY) || "").trim(); } catch (e) { return ""; }
  }
  function setNick(v) {
    var n = String(v == null ? "" : v).trim().slice(0, NICK_MAX);
    try { if (n) localStorage.setItem(NICK_KEY, n); else localStorage.removeItem(NICK_KEY); } catch (e) {}
    return n;
  }
  /* 昵称默认值：本地没设过就用邮箱前缀，再兜底「无名火柴人」 */
  function nickOrDefault() {
    var n = nick();
    if (n) return n;
    var u = user();
    if (u && u.email) return String(u.email).split("@")[0].slice(0, NICK_MAX);
    return "无名火柴人";
  }

  /* ═══════════ 钱包云存档 ═══════════ */
  function walletPull() {
    var d = db();
    if (!d) return Promise.resolve({ data: null, error: envUnavailable() });
    return d.from(TABLE_WALLETS).select("coins, owned, skin, coin_skin, owner_name, updated_at").maybeSingle();
  }

  function walletPush(payload) {
    var d = db();
    if (!d) return Promise.resolve({ data: null, error: envUnavailable() });
    var row = {
      coins: Math.max(0, Math.floor(Number(payload.coins) || 0)),
      owned: payload.owned || [],
      skin: payload.skin || null,
      coin_skin: payload.coinSkin || null,
      owner_name: (payload.ownerName || "").slice(0, NICK_MAX) || null,
      updated_at: new Date().toISOString()
    };
    /* owner_id 交给数据库的 DEFAULT auth.uid() 填，前端永远不发送 */
    return d.from(TABLE_WALLETS).upsert(row, { onConflict: "owner_id" })
      .select("coins, owned, skin, coin_skin, owner_name, updated_at");
  }

  /* ═══════════ 排行榜 ═══════════ */
  function scoreTop(limit) {
    var d = db();
    if (!d) return Promise.resolve({ data: null, error: envUnavailable() });
    /* 只取展示需要的字段：owner_id 这类身份标识不下发给所有访客 */
    return d.from(TABLE_SCORES)
      .select("nickname, score, coins, distance, created_at")
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(limit || LEADER_LIMIT);
  }

  function scoreMine(limit) {
    var d = db();
    if (!d) return Promise.resolve({ data: null, error: envUnavailable() });
    var u = user();
    if (!u) return Promise.resolve({ data: [], error: null });
    /* 按本人身份过滤；RLS 保证也读不到别人的行 */
    return d.from(TABLE_SCORES)
      .select("nickname, score, coins, distance, created_at")
      .eq("owner_id", u.id)
      .order("score", { ascending: false })
      .limit(limit || 5);
  }

  /* 比我分高的人头数 → 名次 = 该数 + 1 */
  function scoreRankAbove(score) {
    var d = db();
    if (!d) return Promise.resolve({ data: null, error: envUnavailable() });
    return d.from(TABLE_SCORES).select("id", { count: "exact", head: true }).gt("score", score);
  }

  function scoreSubmit(entry) {
    var d = db();
    if (!d) return Promise.resolve({ data: null, error: envUnavailable() });
    if (!user()) {
      return Promise.resolve({
        data: null,
        error: { kind: "unauthenticated", message: "请先登录再提交成绩", status: 0 }
      });
    }
    var row = {
      nickname: String(entry.nickname || nickOrDefault()).trim().slice(0, NICK_MAX) || "无名火柴人",
      score: Math.max(0, Math.floor(Number(entry.score) || 0)),
      coins: Math.max(0, Math.floor(Number(entry.coins) || 0)),
      distance: Math.max(0, Math.floor(Number(entry.distance) || 0))
    };
    setNick(row.nickname);
    return d.from(TABLE_SCORES).insert(row)
      .select("nickname, score, coins, distance, created_at");
  }

  /* ═══════════ 本地钱包 ⇄ 云存档 合并 ═══════════
     规则（都是「只增不减」，避免任何一端的数据被另一端吃掉）：
       coins  取两边最大值；owned 取并集；装备优先保留本地这件（前提是合并后确实拥有）。
     未登录时完全不碰本地存档，游戏照旧离线可玩。 */
  function mergeWallet(local, cloud) {
    var c = cloud || {};
    local = local || { coins: 0, owned: [], skin: null, coinSkin: null };
    var owned = [], i;
    var push = function (list) {
      if (!list || !list.length) return;
      for (var k = 0; k < list.length; k++) {
        if (typeof list[k] === "string" && owned.indexOf(list[k]) < 0) owned.push(list[k]);
      }
    };
    push(local.owned);
    push(c.owned);

    var coins = Math.max(Math.floor(Number(local.coins) || 0), Math.floor(Number(c.coins) || 0));
    var pickEquip = function (mine, theirs) {
      if (mine && owned.indexOf(mine) >= 0) return mine;
      if (theirs && owned.indexOf(theirs) >= 0) return theirs;
      return null;
    };
    return {
      coins: coins,
      owned: owned,
      skin: pickEquip(local.skin, c.skin),
      coinSkin: pickEquip(local.coinSkin, c.coin_skin),
      ownerName: nick() || c.owner_name || ""
    };
  }

  function localWallet() {
    var s = global.RunnerSkins;
    if (!s) return null;
    return {
      coins: s.getWallet(),
      owned: s.getOwned(),
      skin: s.equipped("player"),
      coinSkin: s.equipped("coin")
    };
  }

  function applyWallet(merged, cloud) {
    var s = global.RunnerSkins;
    if (!s) return;
    /* 应用云端结果时会触发 wallet:change；这里屏蔽掉自动回传，避免自己触发自己 */
    suppressAutoPush = true;
    try {
      if (typeof s.setOwned === "function") s.setOwned(merged.owned);
      s.setWallet(merged.coins);
      if (merged.skin) s.equip("player", merged.skin);
      if (merged.coinSkin) s.equip("coin", merged.coinSkin);
      var name = merged.ownerName || (cloud && cloud.owner_name) || "";
      if (name && !nick()) setNick(name);
    } finally {
      suppressAutoPush = false;
    }
  }

  /* 登录后的双向同步：先拉云档，与本地合并，再写回云端，最后应用到本地 */
  function walletSync() {
    return currentSession().then(function (r) {
      if (r.error) return { ok: false, error: r.error };
      if (!r.data) return { ok: false, needLogin: true, error: { kind: "unauthenticated", message: "登录后即可开启云存档", status: 0 } };
      return walletPull().then(function (pull) {
        if (pull.error) return { ok: false, error: pull.error };
        var cloud = pull.data || null;
        var merged = mergeWallet(localWallet(), cloud);
        return walletPush(merged).then(function (push) {
          if (push.error) return { ok: false, error: push.error };
          applyWallet(merged, cloud);
          return {
            ok: true,
            first: !cloud,
            coins: merged.coins,
            owned: merged.owned.length,
            savedAt: (push.data && push.data[0] && push.data[0].updated_at) || null
          };
        });
      });
    });
  }

  /* 钱包变化（买卖皮肤、结算入账）后自动回传云端，防抖 1.4 秒 */
  var pushTimer = null;
  var suppressAutoPush = false;
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      if (!user()) return;
      walletSync().then(function (r) {
        try { global.document.dispatchEvent(new CustomEvent("cloud:wallet", { detail: r })); } catch (e) {}
      });
    }, 1400);
  }

  function bindWalletAutoPush() {
    if (!global.document || bindWalletAutoPush.bound) return;
    bindWalletAutoPush.bound = true;
    global.document.addEventListener("wallet:change", function () {
      if (suppressAutoPush) return;
      if (user()) schedulePush();
    });
  }

  /* ═══════════ 对外接口 ═══════════ */
  global.WowCloud = {
    PUBLIC_CONFIG: PUBLIC_CONFIG,
    /* 实际使用的数据面地址 / 是否走的同源代理（调试与测试用） */
    endpoint: function () { return API; },
    viaProxy: function () { return VIA_PROXY; },
    TABLES: { wallets: TABLE_WALLETS, scores: TABLE_SCORES },
    LEADER_LIMIT: LEADER_LIMIT,
    NICK_MAX: NICK_MAX,

    available: function () { return !!build(); },
    initError: function () { return initError; },
    describe: describe,

    auth: auth,
    database: db,
    session: currentSession,
    user: user,
    userId: userId,
    onAuthChange: onAuthChange,
    signOut: signOut,
    clearSessionCache: clearSessionCache,

    nick: nick,
    setNick: setNick,
    nickOrDefault: nickOrDefault,

    wallet: {
      pull: walletPull,
      push: walletPush,
      sync: walletSync,
      local: localWallet,
      merge: mergeWallet,
      bindAutoPush: bindWalletAutoPush
    },
    scores: {
      top: scoreTop,
      mine: scoreMine,
      rankAbove: scoreRankAbove,
      submit: scoreSubmit
    }
  };
})(window);
