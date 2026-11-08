+++
# ══════════════════════════════════════════════════════════════
# 壁纸详情页「外壳」——不是给访客看的页面
# ──────────────────────────────────────────────────────────────
# 用途：functions/wallpapers/[slug].js 在「D1 里有这条、但静态产物还没构建」
# 时，取这一页当模板，把 __WP_*__ 占位串替换成真实数据后返回。
#
# 为什么用一整页而不是在 Function 里拼 HTML：页头页脚、CSP、脚本引用、
# 无障碍结构都长在 wpdetail.html 布局里，重新实现一份必然和真页面漂移。
# 这里走同一个布局，只把数据换成占位符，Function 只做整串替换。
#
# 本页 robotsNoIndex = true：不进 sitemap、自己输出 noindex；
# Function 渲染真实详情页时会把 noindex 改回 index。
# ══════════════════════════════════════════════════════════════
date = '2026-10-31T09:00:00+08:00'
draft = false
title = '壁纸 __WP_SLUG__'
description = '__WP_DESC__'
layout = 'wpdetail'
url = '/wpshell/'
robotsNoIndex = true
hideDescription = true
hideMeta = true

[params]
  wpShell = true
  wpSlug = '__WP_SLUG__'
  wpFull = '__WP_FULL__'
  wpThumb = '__WP_THUMB__'
  wpOrig = '__WP_ORIG__'
  wpKb = '__WP_KB__'
  wpW = '__WP_W__'
  wpH = '__WP_H__'
  wpColor = '__WP_COLOR__'
  wpAdded = '__WP_ADDED__'
  wpTags = ['__WP_TAGS__']
+++
