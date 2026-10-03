/*
 * mirror-server.js —— Wow 娱乐小站镜像域专用静态服务器
 *
 * 背景：WorkBuddy 镜像托管是纯静态服务，读不到 Cloudflare Pages 的 _headers，
 * 导致镜像域没有任何安全响应头（frame-ancestors / X-Frame-Options 在 meta 标签
 * 里按规范被忽略，无法兜底）。本文件随 Hugo 从 static/ 拷入 public/，镜像以
 * node server.js 方式启动，把 _headers 的安全头与缓存策略完整复刻到响应头。
 *
 * 注意：
 * 1. 纯 Node 内置模块，零依赖，installCmd 置空。
 * 2. 必须监听 process.env.PORT 并绑定 0.0.0.0。
 * 3. 安全策略必须与 static/_headers 保持一致（check_csp.js 会核对 meta 版本）。
 * 4. /.cloud 云网关由平台反向代理层处理，不会落到本服务器，无需处理。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT, 10) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4'
};

/* 与 static/_headers 完全一致的安全头（镜像域此前完全没有，属补课） */
var CSP_MAIN =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self' https://wow-blog.app.workbuddy.host; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; " +
  'upgrade-insecure-requests';
/* 第二条 CSP：仅 frame-ancestors。多条 CSP 按规范取交集（每条都必须放行），
 * 专防中间层改写第一条后防护失效。 */
var CSP_FRAME = "frame-ancestors 'none'";

const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': [CSP_MAIN, CSP_FRAME],
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

/* 与 static/_headers 一致的缓存策略 */
const IMMUTABLE_EXT = new Set(['.js', '.css', '.webp', '.png', '.svg', '.ico', '.woff2', '.gif', '.mp3']);
const HOUR_EXT = new Set(['.xml', '.txt', '.webmanifest']);

function cacheControlFor(safePath, ext) {
  if (ext === '.html' || safePath === '' || safePath.endsWith('/')) {
    return 'public, max-age=0, must-revalidate';
  }
  if (safePath.startsWith('images') && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].indexOf(ext) !== -1) {
    return 'public, max-age=2592000';
  }
  if (IMMUTABLE_EXT.has(ext)) {
    return 'public, max-age=31536000, immutable';
  }
  if (HOUR_EXT.has(ext)) {
    return 'public, max-age=3600';
  }
  return 'public, max-age=0, must-revalidate';
}

function send(res, status, fullPath, ext, extra) {
  const headers = Object.assign({}, SECURITY_HEADERS, extra || {});
  headers['Content-Type'] = MIME[ext] || 'application/octet-stream';
  if (fullPath) {
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      stat = null;
    }
    if (stat) {
      headers['Content-Length'] = stat.size;
      headers['Last-Modified'] = stat.mtime.toUTCString();
      delete headers.__safePath;
      /* If-Modified-Since 协商缓存：文件未变回 304 */
      const ims = headers.__ims;
      delete headers.__ims;
      if (ims && stat.mtime <= new Date(ims)) {
        delete headers['Content-Length'];
        res.writeHead(304, headers);
        res.end();
        return;
      }
      res.writeHead(status, headers);
      fs.createReadStream(fullPath).pipe(res);
      return;
    }
  }
  delete headers.__safePath;
  delete headers.__ims;
  res.writeHead(status, headers);
  res.end(status === 404 ? '404 Not Found' : '');
}

const server = http.createServer(function (req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  } catch (e) {
    send(res, 400, null, '', {});
    return;
  }
  if (urlPath.indexOf('\0') !== -1) {
    send(res, 400, null, '', {});
    return;
  }

  const ims = req.headers['if-modified-since'];
  const common = { __ims: ims };

  let safePath = path.normalize(urlPath).replace(/^([/\\])+/, '');
  let fullPath = path.join(ROOT, safePath);
  if (fullPath !== ROOT && fullPath.indexOf(ROOT + path.sep) !== 0) {
    send(res, 403, null, '', common);
    return;
  }

  let stat = null;
  try {
    stat = fs.statSync(fullPath);
  } catch (e) { /* fallthrough */ }

  if (stat && stat.isDirectory()) {
    if (!/[\\/]$/.test(urlPath) && urlPath !== '/') {
      res.writeHead(301, Object.assign({ Location: urlPath + '/' }, SECURITY_HEADERS));
      res.end();
      return;
    }
    fullPath = path.join(fullPath, 'index.html');
  }

  var ext = path.extname(fullPath).toLowerCase();
  try {
    stat = fs.statSync(fullPath);
  } catch (e) {
    stat = null;
  }

  if (!stat || stat.isDirectory()) {
    /* 扩展名缺失的干净 URL 兜底：/xxx → /xxx.html */
    if (!path.extname(urlPath)) {
      const alt = path.join(ROOT, safePath + '.html');
      if (fs.existsSync(alt)) {
        send(res, 200, alt, '.html', Object.assign({ 'Cache-Control': 'public, max-age=0, must-revalidate' }, common));
        return;
      }
    }
    const notFound = path.join(ROOT, '404.html');
    if (fs.existsSync(notFound)) {
      send(res, 404, notFound, '.html', Object.assign({ 'Cache-Control': 'public, max-age=0, must-revalidate' }, common));
    } else {
      send(res, 404, null, '', common);
    }
    return;
  }

  const extra = {
    'Cache-Control': cacheControlFor(safePath, ext),
    __safePath: safePath
  };
  if (ims) extra.__ims = ims;
  send(res, 200, fullPath, ext, extra);
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('mirror server listening on 0.0.0.0:' + PORT);
});
