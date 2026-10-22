/* ══════════════════════════════════════════════════════════════
   离线成绩队列（2026-10-22）
   ──────────────────────────────────────────────────────────────
   以前 grank / msrank / rank 提交成绩都要求云可用，断网或云不可用时
   这一局就直接丢了。现在落进 localStorage 的待发队列，联网后自动
   补榜，并提示「已补回 N 条成绩」。
   · 各榜单模块用 ScoreQueue.register 注册自己的重发函数
   · 条目：{ kind, dedupe, best, at, data }
       best 统一「越大越好」（扫雷用负秒数），去重时留最好的一条
   · 同一 dedupe 键只留最好的一条；队列上限 MAX 条，超出留 best 最高的；
     七天前的陈条自动淘汰
   · flush 串行补发：成功 / skipped / 永久失败（参数不合法等）出队，
     其余留在队里等下一轮
   · 触发时机：online 事件 / 榜单模块初始化后 / 定时（页面可见时 3 分钟一轮）
   · 纯外链脚本、无内联代码（CSP 同源白名单）；页面没引也能玩，属渐进增强
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var KEY = "score-queue-v1";
  var MAX = 12;                            // 队列上限（防 localStorage 被塞爆）
  var MAX_AGE = 7 * 24 * 3600 * 1000;      // 七天补不出去就当没这局
  var handlers = {};
  var flushing = false;

  function load() {
    try {
      var a = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function save(q) {
    try { localStorage.setItem(KEY, JSON.stringify(q)); } catch (e) {}
  }
  function count() { return load().length; }

  function register(kind, fn) { handlers[kind] = fn; }

  function enqueue(entry) {
    if (!entry || !entry.kind) return false;
    var q = load();
    var now = Date.now();
    var key = entry.kind + ":" + (entry.dedupe || "");
    var best = Number(entry.best) || 0;
    var kept = [];
    for (var i = 0; i < q.length; i++) {
      var it = q[i];
      if (now - (Number(it.at) || now) > MAX_AGE) continue;   // 陈条淘汰
      if (it.kind + ":" + (it.dedupe || "") === key) {
        if ((Number(it.best) || 0) >= best) return false;     // 队里已有更好的
        continue;                                             // 较差的旧条被新条顶掉
      }
      kept.push(it);
    }
    entry.at = now;
    kept.push(entry);
    if (kept.length > MAX) {
      kept.sort(function (a, b) { return (Number(b.best) || 0) - (Number(a.best) || 0); });
      kept = kept.slice(0, MAX);
    }
    save(kept);
    return true;
  }

  function removeOne(entry) {
    /* 按内容匹配，不能按对象引用 —— 每次 load() 都是重新 JSON.parse 出的新对象 */
    var q = load();
    var out = [];
    for (var i = 0; i < q.length; i++) {
      var it = q[i];
      if (it.kind === entry.kind && (it.dedupe || "") === (entry.dedupe || "") &&
          it.at === entry.at && (Number(it.best) || 0) === (Number(entry.best) || 0)) continue;
      out.push(it);
    }
    save(out);
  }

  /* 判定一次补发结果：
     ok    = 已入榜或被 skipped（榜上已有更好的，等同成功）
     dead  = 永久失败（参数不合法 / 没权限），重试没有意义，出队丢弃
     retry = 暂时失败（断网 / 限流 / 会话过期），留在队里等下一轮 */
  function judge(r) {
    if (r && r.skipped) return "ok";
    if (r && r.error) {
      var k = r.error.kind || "";
      if (k === "invalid-request" || k === "permission-denied" || k === "not-found") return "dead";
      return "retry";
    }
    return "ok";
  }

  function flush() {
    if (flushing) return Promise.resolve(0);
    var q = load();
    if (!q.length) return Promise.resolve(0);
    var c = global.WowCloud;
    if (!c || !c.available || !c.available()) return Promise.resolve(0);
    flushing = true;
    var snapshot = q.slice();
    var sent = 0;
    var chain = Promise.resolve();
    snapshot.forEach(function (entry) {
      chain = chain.then(function () {
        var fn = handlers[entry.kind];
        if (!fn) return;
        return Promise.resolve()
          .then(function () { return fn(entry); })
          .then(function (r) {
            var v = judge(r);
            if (v === "ok") { removeOne(entry); sent += 1; }
            else if (v === "dead") { removeOne(entry); }
            /* retry：留在队里，下一轮再试 */
          })
          .catch(function () {});        // 重发函数抛异常 = 这条留着
      });
    });
    return chain.then(function () {
      flushing = false;
      if (sent > 0) announce(sent);
      return sent;
    });
  }

  function announce(n) {
    try {
      document.dispatchEvent(new CustomEvent("score-queue:flushed", { detail: { sent: n } }));
    } catch (e) {}
    var el = document.getElementById("sq-toast");
    if (!el && document.body) {
      el = document.createElement("div");
      el.id = "sq-toast";
      el.className = "sq-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    if (!el) return;
    el.textContent = "已补回 " + n + " 条成绩";
    el.classList.add("is-on");
    clearTimeout(announce._t);
    announce._t = setTimeout(function () { el.classList.remove("is-on"); }, 4200);
  }

  /* 上线事件：稍等 1.2 秒再补（给网络栈一点恢复时间，别一收到事件就白跑一轮） */
  global.addEventListener("online", function () {
    setTimeout(function () { flush(); }, 1200);
  });
  /* 定时兜底：页面可见时每 3 分钟试一轮（手机切回前台 online 事件可能不触发） */
  setInterval(function () {
    if (!document.hidden) flush();
  }, 3 * 60 * 1000);

  global.ScoreQueue = {
    register: register,
    enqueue: enqueue,
    flush: flush,
    count: count
  };
})(window);
