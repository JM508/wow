/* Service Worker 注册：把引用本脚本时带的 ?v= 原样传给 /sw.js，
   发新版（assetVer 变了）= 新注册 URL = SW 自动换缓存，无需手工清。
   2026-10-21 起加「新版本就绪」提示条：SW 已 skipWaiting + clients.claim，
   等 activate 完成后刷新一次即可用上新版（注册 ?v= 变了浏览器会重新拉 sw.js）。 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  var v = '';
  try {
    v = (document.currentScript && document.currentScript.src || '').split('v=')[1];
    v = v ? v.split('&')[0] : '';
  } catch (e) { v = ''; }
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js' + (v ? '?v=' + v : '')).then(function (reg) {
      /* 新 SW 安装完成且页面本来就被旧 SW 接管（controller 存在）→ 说明是升级，
         提示用户刷新；首次安装（无 controller）不打扰。 */
      if (!navigator.serviceWorker.controller) return;
      var notify = function () {
        try { showUpdateBar(); } catch (e) {}
      };
      if (reg.waiting && reg.waiting.state === 'installed') { notify(); return; }
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) notify();
        });
      });
    }).catch(function () {
      /* 注册失败（隐私模式 / 不支持）不影响任何功能，只是没有离线缓存 */
    });
  });

  function showUpdateBar() {
    if (document.getElementById('sw-update-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'sw-update-bar';
    bar.className = 'sw-update-bar';
    bar.setAttribute('role', 'status');
    var txt = document.createElement('span');
    txt.textContent = '站点已更新到新版本';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sw-update-btn';
    btn.textContent = '刷新';
    btn.addEventListener('click', function () { location.reload(); });
    bar.appendChild(txt);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }
})();
