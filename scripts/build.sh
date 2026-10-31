#!/usr/bin/env bash
# 规范构建入口：导出 commit SHA -> hugo 重建。
# 版本号由模板 partial（layouts/_partials/assetVer.html）在构建期读取环境变量，
# 不再改写 hugo.toml，工作树永远干净。
# 本地与 CI 都走这个入口；Cloudflare Pages 用默认 hugo 命令即可（自动读 CF_PAGES_COMMIT_SHA）。
set -euo pipefail

cd "$(dirname "$0")/.."   # 仓库根目录（repo/）

export WOW_ASSET_SHA="$(git rev-parse HEAD 2>/dev/null || echo dev)"
hugo --gc --cleanDestinationDir

echo "构建完成：public/ 已生成（assetVer = ${WOW_ASSET_SHA}）"
