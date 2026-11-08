#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 data/wallpapers.yaml 导出成 D1 种子 SQL（2026-11-08）

背景：壁纸元数据从构建脚本搬到 D1 之后，yaml 不再是「唯一源」，
而是「静态快照」——Hugo 用它生成列表页与 89 张详情页，D1 用它在运行时
回答 /api/wallpapers。两边靠同一个版本号 rev 对齐：
  rev = "<条数>.<最后更新时间>"，与 API 返回的 version 同一算法，
  一致时前端不重绘，不一致才用 D1 数据重画。

用法：
  python scripts/seed_wallpapers.py                # 只生成 SQL
  python scripts/seed_wallpapers.py --apply-rev    # 顺手把 rev 写回 yaml
  python scripts/seed_wallpapers.py --ts 2026-11-08T00:00:00.000Z

产出的 SQL 是**一条**多行 INSERT，可直接粘进 D1 网页 Console
（那边一次只吃一条语句，所以不能按行拆）。
"""
import argparse
import datetime
import io
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
YAML = os.path.join(REPO, "data", "wallpapers.yaml")
OUT = os.path.join(REPO, "schema", "seed", "002_wallpapers_seed.sql")

ITEM_RE = re.compile(r"^  - slug:\s*(\S+)\s*$")
KV_RE = re.compile(r"^    ([A-Za-z_]+):\s*(.*)$")


def parse_items(text):
    """按行解析（不引入 PyYAML：这份 yaml 是脚本生成的固定形态，
    引第三方依赖会让「构建前先装包」成为新的笨重来源）。"""
    items = []
    cur = None
    for line in text.splitlines():
        m = ITEM_RE.match(line)
        if m:
            cur = {"slug": m.group(1), "tags": []}
            items.append(cur)
            continue
        if cur is None:
            continue
        m = KV_RE.match(line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if k == "tags":
            inner = v.strip("[]")
            cur["tags"] = [t.strip() for t in re.split(r"[,，]", inner) if t.strip()]
        else:
            cur[k] = v.strip().strip('"').strip("'")
    return items


def sql_str(v):
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def build_sql(items, ts):
    rows = []
    for i, it in enumerate(items):
        tags = json.dumps(it.get("tags") or [], ensure_ascii=False)
        rows.append(
            "  ("
            + ", ".join([
                sql_str(it["slug"]),
                sql_str(it.get("added")),
                str(int(float(it.get("w") or 0))),
                str(int(float(it.get("h") or 0))),
                "%.3f" % float(it.get("ratio") or 0),
                sql_str(it.get("color")),
                str(int(float(it.get("kb") or 0))),
                str(int(float(it.get("kb_thumb") or 0))),
                sql_str(it.get("thumb")),
                sql_str(it.get("full")),
                sql_str(it.get("orig")),
                sql_str(tags),
                str(i),
                "'live'",
                sql_str(ts),
            ])
            + ")"
        )
    head = (
        "-- 由 scripts/seed_wallpapers.py 生成，别手改。\n"
        "-- 一条多行 INSERT，可直接粘进 D1 网页 Console（那边一次只吃一条语句）。\n"
        "INSERT OR REPLACE INTO wallpapers\n"
        "  (slug, added, w, h, ratio, color, kb, kb_thumb, thumb, full, orig, tags, sort_order, status, updated_at)\n"
        "VALUES\n"
    )
    return head + ",\n".join(rows) + ";\n"


def apply_rev(text, rev):
    """把 rev 写回 yaml（没有就在 count 行后面插一行）"""
    if re.search(r"^rev:\s*.*$", text, flags=re.M):
        return re.sub(r"^rev:\s*.*$", "rev: \"%s\"" % rev, text, count=1, flags=re.M)
    return re.sub(r"^(count:\s*\d+)$", r'\1\nrev: "%s"' % rev, text, count=1, flags=re.M)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ts", default=None, help="统一写入的 updated_at（默认当前 UTC）")
    ap.add_argument("--apply-rev", action="store_true", help="把算出的 rev 写回 data/wallpapers.yaml")
    args = ap.parse_args()

    raw = io.open(YAML, encoding="utf-8").read()
    items = parse_items(raw)
    if not items:
        raise SystemExit("没从 yaml 里解析出任何条目：" + YAML)

    ts = args.ts or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    sql = build_sql(items, ts)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(sql)

    rev = "%d.%s" % (len(items), ts)
    print("条目：%d" % len(items))
    print("updated_at：%s" % ts)
    print("rev：%s" % rev)
    print("SQL：%s（%d 字节）" % (OUT, len(sql.encode("utf-8"))))

    if args.apply_rev:
        io.open(YAML, "w", encoding="utf-8", newline="\n").write(apply_rev(raw, rev))
        print("已把 rev 写回 %s" % YAML)


if __name__ == "__main__":
    main()
