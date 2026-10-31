# Wow 娱乐小站

基于 Hugo（PaperMod 主题定制）的纯静态小游戏站，部署在 Cloudflare Pages（主域）与 WorkBuddy 镜像域，同一构建产物双端发布。

## 站点内容

- **游戏**：火柴人快跑（跑酷）、扫雷、贪吃蛇、井字棋、2048
- **排行榜**：云榜单（登录后上榜）+ 本机离线成绩队列（断网先存本机、联网补传）
- **壁纸**：89 张壁纸（列表 + 每张独立详情页），支持收藏、下载计数、本机转 JPG 下载
- **成就 / 商店 / 皮肤**：本地成就、金币商店、按游戏分域的皮肤系统
- **PWA**：可安装、离线可玩（Service Worker 预缓存 + 分层 fetch 策略）
- **年龄门 / 人机验证**：首次访问的年龄确认 + 滑块验证，通过后本机缓存 1 小时

## 目录结构

```
repo/
├── content/            # 页面 Markdown（游戏页 / 壁纸页 / 法务页等）
│   └── _content.gotmpl # 内容适配器：从 data/wallpapers.yaml 生成壁纸详情页
├── data/wallpapers.yaml# 壁纸清单（脚本生成，勿手改图片条目）
├── layouts/            # PaperMod 覆盖模板（head / baseof / 壁纸详情页等）
├── static/             # 全站脚本与样式（游戏 JS/CSS、site.css、sw.js、_headers）
│   ├── wp/             # 壁纸资源（640 缩略 webp+avif / 1920 大图 webp）
│   └── img/ images/    # 游戏与站点图片资源
└── hugo.toml           # 站点配置（assetVer 版本号在这里）
```

## 本地开发与构建

```bash
hugo --gc --cleanDestinationDir   # 产物输出到 public/
```

要求 Hugo ≥ 0.146（模板用到新布局系统与 content adapter）。本地验证端口直开 `public/` 即可。

## 发布约定（重要）

1. **改任何 JS/CSS 必须升 `hugo.toml` 里的 `assetVer`** —— 所有静态资源按 `?v=<assetVer>` 引用并配一年强缓存，版本号不变浏览器不会更新。
2. 所有引用带版本号、改版先升号，再 `hugo` 重建。
3. CSP 为纯同源白名单（`script-src 'self'`，无 unsafe-inline / 无哈希）：**禁止内联 `<script>` 与 `style=""` 属性**，动态样式一律走 CSSOM（`el.style.x = ...`）。改 `static/_headers` 的 CSP 时必须同步 `layouts/_partials/head.html` 里的 meta 兜底。
4. 主题初始化在 `static/theme.js`（head 同步加载），默认跟随系统 `prefers-color-scheme`，手动切换仅记住当前会话。

## CI

`.github/workflows/build.yml`：每次 push/PR 自动执行

- `hugo --gc --cleanDestinationDir` 构建门禁
- 图片体积预算（static 下单张图 > 600KB 拒绝）
- 调试参数门禁（生产 JS 除 shop.js 的本地限定 `?grant=` 外不得出现调试入口）

## 相关说明

- 火柴人快跑的核心脚本（runner.js / shop.js / skins.js / ach.js 等）历史上曾在独立仓库维护并通过 Action 同步；该仓库已于 2026-10 下旬删除，`static/` 下这些文件即唯一源，直接在本仓库修改即可。

## 许可与版权

- 站点代码与本仓库结构：站点运营者所有
- 壁纸内容：版权归原作者所有，仅供个人设备背景展示，禁止商用；侵权投诉见站内「壁纸版权公告」
- 法务页面：`/privacy/` `/terms/` `/disclaimer/` `/dmca/` `/cookies/`
