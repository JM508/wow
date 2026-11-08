#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""新增壁纸：一条命令做完「出图 + 记元数据 + 生成 D1 SQL」（2026-11-08）

此前新增一张壁纸要跑两个 Python 脚本、手改 yaml、再全量构建。现在：

  python scripts/wp_add.py 图1.jpg 图2.png --tags 游戏,横屏

它会
  1. 生成三种产物到 static/wp：<slug>-1920.webp / -640.webp / -640.avif
     （小图不放大：尺寸取 min(1920, 原宽)，与既有 89 张口径一致）
  2. 算出 w/h/ratio/kb/kb_thumb/color，追加到 data/wallpapers.yaml
     （静态快照，Hugo 据此生成详情页）
  3. 更新 yaml 的 count 与 rev（rev 与 /api/wallpapers 的 version 同算法）
  4. 把 INSERT OR REPLACE 语句写到 schema/seed/add-<slug>.sql，
     粘进 D1 网页 Console 即完成上架

依赖：Pillow（pip install pillow）。缺了会直接提示，不会静默降级。
"""
import argparse
import datetime
import io
import json
import os
import re
import sys

try:
    from PIL import Image, ImageStat
except ImportError:
    sys.exit("缺少 Pillow：pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
YAML = os.path.join(REPO, "data", "wallpapers.yaml")
OUT_IMG = os.path.join(REPO, "static", "wp")
SEED_DIR = os.path.join(REPO, "schema", "seed")

FULL_W = 1920
THUMB_W = 640
WEBP_FULL_Q = 82
WEBP_THUMB_Q = 80
AVIF_THUMB_Q = 50

# 必须带 re.M：不带的话 ^ 只匹配整份文本开头，会把已有 89 条当成 0 条
ITEM_RE = re.compile(r"^  - slug:\s*(\S+)\s*$", re.M)


def slug_number(slug):
    m = re.match(r"^wp-(\d+)$", slug)
    return int(m.group(1)) if m else 0


def next_slug(text):
    nums = [slug_number(m.group(1)) for m in ITEM_RE.finditer(text)]
    n = (max(nums) if nums else 0) + 1
    return "wp-%02d" % n


def dominant_hex(im):
    """主色：缩到 16x16 取均值。既有 89 张就是这个口径（灰调、低饱和）"""
    small = im.convert("RGB").resize((16, 16), Image.LANCZOS)
    mean = ImageStat.Stat(small).mean
    return "#%02x%02x%02x" % (int(mean[0]), int(mean[1]), int(mean[2]))


def make_assets(src, slug, overwrite=False):
    im = Image.open(src)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    ow, oh = im.size
    if ow < 320:
        raise SystemExit("%s 宽度只有 %dpx，太小，不做壁纸" % (src, ow))

    full_path = os.path.join(OUT_IMG, "%s-1920.webp" % slug)
    thumb_path = os.path.join(OUT_IMG, "%s-640.webp" % slug)
    avif_path = os.path.join(OUT_IMG, "%s-640.avif" % slug)
    if not overwrite:
        for p in (full_path, thumb_path, avif_path):
            if os.path.exists(p):
                raise SystemExit("目标文件已存在，换 slug 或加 --overwrite：" + p)

    full = im.copy()
    if ow > FULL_W:
        full = full.resize((FULL_W, round(oh * FULL_W / ow)), Image.LANCZOS)
    full.convert("RGB").save(full_path, "WEBP", quality=WEBP_FULL_Q, method=4)

    thumb = im.copy()
    if ow > THUMB_W:
        thumb = thumb.resize((THUMB_W, round(oh * THUMB_W / ow)), Image.LANCZOS)
    thumb.convert("RGB").save(thumb_path, "WEBP", quality=WEBP_THUMB_Q, method=4)
    thumb.convert("RGB").save(avif_path, "AVIF", quality=AVIF_THUMB_Q)

    return {
        "slug": slug,
        "w": ow,
        "h": oh,
        "ratio": round(ow / oh, 3),
        "color": dominant_hex(im),
        "kb": max(1, os.path.getsize(full_path) // 1024),
        "kb_thumb": max(1, os.path.getsize(thumb_path) // 1024),
        "thumb": "/wp/%s-640.webp" % slug,
        "full": "/wp/%s-1920.webp" % slug,
    }


def yaml_block(it, added, tags):
    return (
        "  - slug: %s\n"
        "    added: %s\n"
        "    kb: %d\n"
        "    kb_thumb: %d\n"
        "    w: %d\n"
        "    h: %d\n"
        "    ratio: %s\n"
        "    color: \"%s\"\n"
        "    thumb: %s\n"
        "    full: %s\n"
        "    tags: [%s]\n"
        % (
            it["slug"], added, it["kb"], it["kb_thumb"], it["w"], it["h"],
            ("%.3f" % it["ratio"]), it["color"], it["thumb"], it["full"],
            ", ".join(tags),
        )
    )


def sql_rows(rows, ts):
    out = []
    for i, it in enumerate(rows):
        tags = json.dumps(it["tags"], ensure_ascii=False).replace("'", "''")
        out.append(
            "  ('%s', '%s', %d, %d, %.3f, '%s', %d, %d, '%s', '%s', NULL, '%s', %d, 'live', '%s')"
            % (
                it["slug"], it["added"], it["w"], it["h"], it["ratio"], it["color"],
                it["kb"], it["kb_thumb"], it["thumb"], it["full"], tags,
                it["sort_order"], ts,
            )
        )
    # 第一行必须是 INSERT：D1 Console 里若整段都被 -- 注释包住，会报「未检测到 SQL 语句」
    return (
        "INSERT OR REPLACE INTO wallpapers\n"
        "  (slug, added, w, h, ratio, color, kb, kb_thumb, thumb, full, orig, tags, sort_order, status, updated_at)\n"
        "VALUES\n" + ",\n".join(out) + ";\n"
    )


def main():
    ap = argparse.ArgumentParser(description="新增壁纸：出图 + 写快照 + 出 D1 SQL")
    ap.add_argument("images", nargs="+", help="图片路径（可多张）")
    ap.add_argument("--tags", required=True, help="逗号分隔，如 游戏,横屏")
    ap.add_argument("--added", default=None, help="上线日期 YYYY-MM-DD，默认今天")
    ap.add_argument("--slug", default=None, help="指定起始 slug，默认接最大编号")
    ap.add_argument("--overwrite", action="store_true", help="允许覆盖同名图片")
    ap.add_argument("--no-yaml", action="store_true", help="只出图与 SQL，不改 yaml")
    args = ap.parse_args()

    tags = [t.strip() for t in re.split(r"[,，]", args.tags) if t.strip()]
    if not tags:
        raise SystemExit("--tags 不能为空")

    added = args.added or datetime.date.today().isoformat()
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    raw = io.open(YAML, encoding="utf-8").read()
    base = slug_number(args.slug) if args.slug else None
    cur = args.slug or next_slug(raw)

    rows = []
    for i, src in enumerate(args.images):
        if not os.path.isfile(src):
            raise SystemExit("找不到图片：" + src)
        if i and base is not None:
            cur = "wp-%02d" % (base + i)
        elif i:
            cur = "wp-%02d" % (slug_number(cur) + 1)
        it = make_assets(src, cur, args.overwrite)
        it["added"] = added
        it["tags"] = tags
        rows.append(it)
        print("出图：%s  %dx%d  %dKB / 缩略 %dKB  %s"
              % (it["slug"], it["w"], it["h"], it["kb"], it["kb_thumb"], it["color"]))

    if not args.no_yaml:
        count_now = len(ITEM_RE.findall(raw)) + len(rows)
        order_base = len(ITEM_RE.findall(raw))
        for i, it in enumerate(rows):
            it["sort_order"] = order_base + i

        body = raw if raw.endswith("\n") else raw + "\n"
        body += "".join(yaml_block(it, added, tags) for it in rows)
        body = re.sub(r"^(count:\s*)\d+$", lambda m: m.group(1) + str(count_now), body, count=1, flags=re.M)
        rev = "%d.%s" % (count_now, ts)
        if re.search(r"^rev:\s*.*$", body, flags=re.M):
            body = re.sub(r"^rev:\s*.*$", 'rev: "%s"' % rev, body, count=1, flags=re.M)
        else:
            body = re.sub(r"^(count:\s*\d+)$", r'\1\nrev: "%s"' % rev, body, count=1, flags=re.M)

        io.open(YAML, "w", encoding="utf-8", newline="\n").write(body)
        print("yaml：追加 %d 条，count=%d，rev=%s" % (len(rows), count_now, rev))
    else:
        for i, it in enumerate(rows):
            it["sort_order"] = 1000 + i

    os.makedirs(SEED_DIR, exist_ok=True)
    out = os.path.join(SEED_DIR, "add-%s.sql" % rows[0]["slug"])
    io.open(out, "w", encoding="utf-8", newline="\n").write(sql_rows(rows, ts))
    print("SQL：%s" % out)
    print("")
    print("下一步：把上面这份 SQL 粘进 D1 网页 Console 执行；")
    print("      图片与 yaml 改动随下次构建上线（镜像与 pages.dev 都要发一次）。")


if __name__ == "__main__":
    main()
