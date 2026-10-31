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
├── scripts/            # 构建工具：build.sh（规范构建入口）；set-version.sh（可选兼容，见下）
└── hugo.toml           # 站点配置（assetVer 仅作兜底值 devbuild，实际版本号由构建期环境变量注入）
```

## 本地开发与构建

```bash
bash scripts/build.sh   # 导出 commit SHA 环境变量 -> hugo 重建，产物输出到 public/，工作树保持干净
```

要求 Hugo ≥ 0.146（模板用到新布局系统与 content adapter）。本地验证端口直开 `public/` 即可。

> 版本号自动化：所有静态资源按 `?v=<assetVer>` 引用。版本号由模板 partial
> `layouts/_partials/assetVer.html` 在构建期按优先级读取：`CF_PAGES_COMMIT_SHA`（Cloudflare
> Pages 构建自动导出）→ `GITHUB_SHA`（GitHub Actions 自动导出）→ `WOW_ASSET_SHA`（本地
> build.sh 导出）→ hugo.toml 的 assetVer 兜底。每次部署天然唯一，无需手动维护，从根本上
> 杜绝「改了资源却忘升版本号」导致的缓存不更新。

## 发布约定（重要）

1. **静态资源按 `?v=<assetVer>` 引用并配一年强缓存**，版本号由模板 partial 在构建期自动读取平台注入的 commit SHA（CF Pages / Actions 自动导出，本地 build.sh 导出）——无需手动升号，每次部署天然唯一，杜绝「改了资源却忘升版本号」的缓存失效问题。
2. 规范构建入口是 `bash scripts/build.sh`。改了 JS/CSS 不需要任何手动升号操作，正常重建即可。
3. CSP 为纯同源白名单（`script-src 'self'`，无 unsafe-inline / 无哈希）：**禁止内联 `<script>` 与 `style=""` 属性**，动态样式一律走 CSSOM（`el.style.x = ...`）。改 `static/_headers` 的 CSP 时必须同步 `layouts/_partials/head.html` 里的 meta 兜底。
4. 主题初始化在 `static/theme.js`（head 同步加载），默认跟随系统 `prefers-color-scheme`，手动切换仅记住当前会话。
5. **Cloudflare Pages 用默认 `hugo` 构建命令即可**：版本号注入靠模板读取构建期环境变量 `CF_PAGES_COMMIT_SHA`（CF 自动导出），**不依赖自定义构建命令**。仍建议在 **Pages 项目 → Settings → Environment variables → Production 作用域** 设 `HUGO_VERSION = 0.167.0`，锁定 Hugo 版本，避免 CF 默认版本漂移造成与本地构建不一致（Free/Pro 默认不一定带该版本）。
6. 镜像域（WorkBuddy）用 `workbuddy_sites_deploy` 发布本地 `repo/public` 构建产物（Windows/CRLF），与 CF Pages（Linux/LF）产物经归一化后逐字节一致。
7. **Service Worker 自研、不引入 Workbox**：`static/sw.js` 已覆盖 App Shell（首页 / 各游戏页 / 法务页预缓存）与核心游戏资源（各游戏 JS/CSS、云 SDK、vendor），策略为「导航网络优先 + 版本化资源缓存优先 + 其余 SWR + 云请求直连」，并跟随 `assetVer` 自动换缓存。现有覆盖已满足离线可玩，故不引入 Workbox。

## 资源容量与 R2 迁移

Cloudflare Pages 单部署上限（Free 计划）：**20,000 个文件 / 单文件 25 MiB / 构建 20 分钟**（超限直接报 `Pages only supports up to 20,000 files`）。
超过任一阈值开始把资源迁到 R2 对象存储，触发条件如下：

- **文件数**：`public/` 文件数 ≥ **18,000**（约 10% 余量）即启动迁移。主要增长源是壁纸（`static/wp/`，每张含 640 webp+avif、1920 webp 多份）与 `static/img/` 图集；新增壁纸前先估算增量。
- **单文件体积**：任何资产逼近 **25 MiB** 必须切片或移 R2（Hugo 资源不可超过此上限）。
- **总包体积**：单次部署包逼近平台上限、或本地 `public/` 超数百 MB 时，把静态媒体整体走 R2。
- **迁移做法**：R2 桶存原图 / 大媒体，页面与 `sw.js` 改为 R2 域名直链（仍带 `?v=` 缓存穿透）；`sw.js` 的 PRECACHE 清单同步移除已外迁资源，避免离线缓存指向失效地址。
- **付费扩容**：Pro 计划可设 `PAGES_WRANGLER_MAJOR_VERSION=4` 把文件上限提到 100,000，但**单文件 25 MiB 限制不变**，仍以上面阈值为准。

## CI

`.github/workflows/build.yml`：每次 push/PR 自动执行

- `hugo --gc --cleanDestinationDir` 构建门禁（版本号由模板读取 GITHUB_SHA 自动注入，产物 assetVer 每次唯一，无需手动升号）
- 图片体积预算（static 下单张图 > 600KB 拒绝）
- 调试参数门禁（生产 JS 除 shop.js 的本地限定 `?grant=` 外不得出现调试入口）

## 许可与版权

- 站点代码与本仓库结构：站点运营者所有
- 壁纸内容：版权归原作者所有，仅供个人设备背景展示，禁止商用；侵权投诉见站内「壁纸版权公告」
- 法务页面：`/privacy/` `/terms/` `/disclaimer/` `/dmca/` `/cookies/`
