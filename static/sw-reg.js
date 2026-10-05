/* Service Worker 注册：把引用本脚本时带的 ?v= 原样传给 /sw.js，
   发新版（assetVer 变了）= 新注册 URL = SW 自动换缓存，无需手工清。 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  var v = '';
  try {
    v = (document.currentScript && document.currentScript.src || '').split('v=')[1];
    v = v ? v.split('&')[0] : '';
  } catch (e) { v = ''; }
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js' + (v ? '?v=' + v : '')).catch(function () {
      /* 注册失败（隐私模式 / 不支持）不影响任何功能，只是没有离线缓存 */
    });
  });
})();
