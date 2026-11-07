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
├── functions/          # Cloudflare Pages Functions（成绩 API；_lib/ 下划线目录不参与路由）
├── schema/             # D1 建表语句（001_ms_scores.sql …）
├── scripts/            # 构建与迁移工具：build.sh（规范构建入口）；export-ms-scores.mjs（旧云→D1）
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

## 动态数据（Cloudflare Pages Functions + D1）

站点仍然是 Hugo 静态站，但部分数据面改由 **Pages Functions 写 API、D1 存数据**，前端 `fetch` 调用。静态页面照旧预渲染，只有真正需要实时的数据才走接口——这样不必重写整站。

现状（渐进迁移，**不是**一次性替换）：

| 链路 | 数据来源 | 状态 |
|---|---|---|
| 扫雷排行榜 | `/api/scores/ms` → D1 `ms_scores` | 已接入（第一条） |
| 跑酷成绩 / 钱包 / 成就 | 旧云（WorkBuddy 云服务） | 未迁，接口回 501 |
| 井字棋 + 贪吃蛇榜 | 旧云 | 未迁 |
| 设置同步 / 头像 / 登录 | 旧云 | 保留（账号体系不迁） |

设计上的两条硬约定：

1. **账号不迁**。登录、头像、设置仍走原云服务；D1 只接管游戏数据。
2. **前端必须能回退**。`msrank.js` 先请求 `/api/scores/ms`，遇到 `503`（D1 未绑定）/ `501`（游戏未迁）/ `404`（路由未开）或网络异常，就无声退回原来的云链路。所以：**D1 没配好时线上表现和改造前一模一样**，不存在「半配置状态把站弄坏」。

### 一次性配置（Cloudflare 控制台）

Functions 代码在仓库 `functions/`，随 Pages 构建一起部署，不需要单独发布；但 D1 要先建库并绑定到 Pages 项目：

1. **Workers & Pages → D1 → Create database**，库名建议 `wow-db`（名字随意，记住即可）。
2. **Pages 项目 → Settings → Functions → D1 database bindings → Add binding**
   - Variable name 必须是 **`DB`**（代码里读 `env.DB`，写错就永远是 503）
   - D1 database 选刚建的那个
   - 环境选 **Production**（Preview 也建议加上，否则预览部署拿不到数据）
3. 建表（二选一）：
   - 控制台：D1 → 选中库 → Console，把 `schema/001_ms_scores.sql` 全文粘进去执行；
   - 或用 wrangler：`npx wrangler d1 execute wow-db --file=schema/001_ms_scores.sql --remote`
4. 重新部署一次（绑定变更需要新部署才生效）。

绑定成功后 `GET https://wow-d9s.pages.dev/api/scores/ms?mode=easy` 返回 `200` 与 `{ "rows": [] }`；未绑定时返回 `503 d1_unavailable`，属预期。

### 迁移历史成绩

```bash
node scripts/export-ms-scores.mjs            # 从旧云导出 → .migration/ms_scores.sql
npx wrangler d1 execute wow-db --file=.migration/ms_scores.sql --remote
```

导出脚本按 `mode + 昵称` 去重，只保留最快的一条（与前端去重口径一致）；旧云匿名只开放展示列，因此迁入行的 `device_id` 为空，不参与按设备限流，不影响榜单展示。表为空时脚本会明确提示并只写占位文件。

### 回滚

把 Pages 项目里的 `DB` 绑定删掉即可——所有 `/api/scores/*` 立刻回到 503，前端自动走旧云链路，页面功能不受影响。D1 里的数据不会丢，重新绑定后继续可用。

### 新增一条游戏链路

1. `schema/00N_<game>.sql` 建表（CHECK 兜底 + 榜单/限流索引）；
2. `functions/_lib/<game>.js` 写业务，`functions/api/scores/[game].js` 的 `MIGRATED` 里加上标识；
3. 前端在该游戏的榜模块加「API 优先、失败回退」（照 `msrank.js` 的 `apiJson` / `apiPost`）；
4. `_build_check` 补断言，`_dev/_api_<game>_test.js` 补真实 SQLite 用例。

### 跨域口径

镜像域 `wow-blog.app.workbuddy.host` 没有 Functions，因此**只读**：API 只对它的 `GET` 放行 CORS，写入必须回主域。这样两域都能看榜，数据源不会分叉。

## CI

`.github/workflows/build.yml`：每次 push/PR 自动执行

- `hugo --gc --cleanDestinationDir` 构建门禁（版本号由模板读取 GITHUB_SHA 自动注入，产物 assetVer 每次唯一，无需手动升号）
- 图片体积预算（static 下单张图 > 600KB 拒绝）
- 调试参数门禁（生产 JS 除 shop.js 的本地限定 `?grant=` 外不得出现调试入口）

##联系方式

wow-notice@qq.com

## 许可与版权

- 站点代码与本仓库结构：站点运营者所有
- 壁纸内容：版权归原作者所有，仅供个人设备背景展示，禁止商用；侵权投诉见站内「壁纸版权公告」
- 法务页面：`/privacy/` `/terms/` `/disclaimer/` `/dmca/` `/cookies/`
