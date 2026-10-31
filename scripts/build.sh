#!/usr/bin/env bash
# 规范构建入口：注入版本号 -> hugo 重建 -> 还原 hugo.toml（保持工作树干净）。
# 本地与 CI 都走这个入口；Cloudflare Pages 原生构建用 set-version.sh && hugo 即可。
set -euo pipefail

cd "$(dirname "$0")/.."   # 仓库根目录（repo/）

./scripts/set-version.sh
hugo --gc --cleanDestinationDir

# 还原占位符，避免版本号污染工作树 / 误提交。
# 显式写回 devbuild（幂等，不依赖任何备份文件完整性）。
sed -i -E "s/^([[:space:]]*assetVer[[:space:]]*=[[:space:]]*\").*(\"[[:space:]]*)$/\1devbuild\2/" hugo.toml
rm -f hugo.toml.bak

echo "构建完成：public/ 已生成（assetVer 已还原为占位符）"
