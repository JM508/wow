/* ══════════════════════════════════════════════════════════════
   Wow 娱乐小站 · Service Worker（离线可玩）
   ──────────────────────────────────────────────────────────────
   策略：
     · 页面导航（HTML）：网络优先，断网/超时回退缓存 → 离线也能打开游戏页
     · 版本化静态资源（带 ?v=）：缓存优先（URL 变 = 版本变，天然失效）
     · 其余同源 GET：先回缓存、后台更新（stale-while-revalidate）
     · 云请求（/.cloud/）一律直连，绝不缓存（排行榜 / 云存档要实时）
   版本：跟随 hugo.toml 的 assetVer —— 注册时以 ?v= 传入，
         SW 里从自己的 URL 读出来拼缓存名；发新版 = 新 URL = 自动换缓存。
   注意：本文件按 /*.js 规则被强缓存，因此**必须**带 ?v= 引用（见 head.html）。
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* 从注册 URL（/sw.js?v=xxx）里取版本号，取不到就用时间戳兜底 */
var SW_VERSION = 'sw-' + (self.location.search.split('v=')[1] || 'dev').split('&')[0];
var CACHE = 'wow-' + SW_VERSION;

/* 预缓存核心清单：两个小游戏离线可玩所需的最小集合（≈1MB） */
var PRECACHE = [
  '/', '/games/', '/minesweeper/', '/runner/', '/account/',
  '/site.css', '/theme.js', '/minesweeper.js', '/minesweeper.css',
  '/runner.js', '/runner.css', '/skins.js', '/shop.js', '/shop.css',
  '/ach.js', '/ach.css', '/rank.js', '/rank.css', '/cloud.js',
  '/account.js', '/account.css', '/age-gate.js', '/age-gate.css',
  '/vendor/workbuddy-cloud-sdk.global.js',
  '/img/hoshino-duck3.webp', '/img/hoshino-runner3.webp',
  '/img/pixelrun-duck.webp', '/img/pixelrun-sheet.webp',
  '/img/qiaolezi-alt.webp', '/img/qiaolezi.webp',
  '/img/seia-duck.webp', '/img/seia-runner.webp',
  '/img/sprite-bottle.webp',
  '/img/zhang-duck.webp', '/img/zhang-runner.webp',
  '/favicon.ico'
];

/* 版本化资源（带 ?v= 引用的）走缓存优先；判断依据：URL 带 v= 参数 */
function isVersioned(url) {
  return /[?&]v=/.test(url.search);
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 逐个加缓存，单个 404 不拖垮整体（比如某页暂时改名） */
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k !== CACHE ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // 只管同源
  if (url.pathname.indexOf('/.cloud') === 0) return;    // 云网关直连，绝不缓存
  if (url.pathname === '/.ip') return;                  // IP 属地端点直连（按访客实时判定，不缓存）
  if (url.pathname === '/server.js') return;            // 镜像自用文件，无意义

  /* ① 页面导航：网络优先，失败回退缓存（离线可玩的关键） */
  if (req.mode === 'navigate' ||
      (req.headers.get('accept') || '').indexOf('text/html') !== -1) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (r) {
          return r || caches.match('/');
        });
      })
    );
    return;
  }

  /* ② 版本化静态资源：缓存优先（URL 带 ?v=，内容不可变） */
  if (isVersioned(url)) {
    e.respondWith(
      caches.match(req).then(function (r) {
        return r || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }

  /* ③ 其余同源 GET：先回缓存、后台更新 */
  e.respondWith(
    caches.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});
