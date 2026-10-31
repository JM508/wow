#!/usr/bin/env bash
# 【可选/兼容保留】构建前把 hugo.toml 的 assetVer 占位符替换为当前 commit SHA。
# 当前首选机制是模板 partial（layouts/_partials/assetVer.html）在构建期直接读
# CF_PAGES_COMMIT_SHA / GITHUB_SHA / WOW_ASSET_SHA 环境变量，用默认 hugo 命令即可注入，
# 本脚本仅为兼容已配置「set-version.sh && hugo」构建命令的环境而保留，二者可叠加（值一致）。
#
# 版本载体优先级：
#   1. Cloudflare Pages 注入的环境变量 CF_PAGES_COMMIT_SHA（原生构建环境）
#   2. 本地 git rev-parse HEAD（GitHub Actions / 本地）
#   3. 回退 "dev"（极端无 git 场景下仍产出可用构建）
# 若当前提交恰好打了 tag，优先用 tag（去掉前导 v，避免 ?v=v1.2.3 双 v）。
set -euo pipefail

cd "$(dirname "$0")/.."   # 切到仓库根（repo/）

# 1) 版本载体
if [ -n "${CF_PAGES_COMMIT_SHA:-}" ]; then
  VER="${CF_PAGES_COMMIT_SHA}"
else
  VER="$(git rev-parse HEAD 2>/dev/null || echo dev)"
fi

# 2) 优先用 tag（更易读）
TAG="$(git describe --tags --exact-match 2>/dev/null || true)"
if [ -n "$TAG" ]; then
  VER="${TAG#v}"
fi

# 3) 安全兜底：tag/SHA 里若含 sed 分隔符或路径符，统一替换为短横，避免破坏正则
VER="${VER//\//-}"

# 4) 替换占位符：仅改写 assetVer = "..." 这一行（保留缩进与行尾引号）
#    用 -i 就地改写（GNU sed，Git Bash / Linux 通用）；不依赖 .bak，还原由 build.sh 显式完成。
sed -i -E "s/^([[:space:]]*assetVer[[:space:]]*=[[:space:]]*\").*(\"[[:space:]]*)$/\1${VER}\2/" hugo.toml

echo "assetVer -> ${VER}"
