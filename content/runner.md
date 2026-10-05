+++
date = '2026-10-01T09:20:00+08:00'
draft = false
title = '火柴人快跑'
# 商店已并入本页（页内「商店」面板），旧地址 /shop/ 自动跳转过来
aliases = ['/shop/']
# 站名下方那一行「返回」入口：小游戏都回游戏合集，不回首页
backHref = '/games/'
backLabel = '返回游戏合集'
# 顶部那行日期 / 阅读时长不显示（SEO 元信息保留）
hideMeta = true
# 页脚 © 行上方额外显示一行本游戏的开源仓库地址（用户 2026-10-05 要求）
footerRepo = 'https://github.com/JM508/stick-runner'
# 独立 layout 名：仅用于打破主题 baseof 里 partialCached footer 的缓存 key，
# 让页脚的 footerRepo 行能真正渲染（Hugo 找不到 runner.html 会回退 single.html）
layout = 'runner'
+++

{{< runner >}}
