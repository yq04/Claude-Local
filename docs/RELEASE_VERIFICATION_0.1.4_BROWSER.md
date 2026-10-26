<!--
[INPUT]: Pinned source CI, actual isolated engine observations, package audit, local update and server asset digest.
[OUTPUT]: Browser0.1.4 release facts and measurement/data preservation limits.
[POS]: Public-safe verification; no real screenshot, IP, identity, paths, tickets or secrets included.
-->
# 0.1.4 浏览器核验修复交付

日期2026-10-26。本次为公开候选重置后的0.1.4，不使用早期内部同版本回执。

- 固定源码/标签：`4c97bef00c1a9b2fa6407eeaae63ee73a66dde5d` / `v0.1.4`。
- [私有预发布](https://github.com/yq04/Claude-Local/releases/tag/v0.1.4)：draft=false、prerelease=true；仅安装器附件。
- `Claude-Local_0.1.4_x64-setup.exe`，140,563,164字节，SHA256`64af650e065c45a34e2d10403ab567cda940b92dacc5b130d447781ba387a6ed`，GitHub服务端digest和size匹配。
- custom-protocol/新中性Cargo构建，解包审计109文件、13隐私探针、0发现；无真实资料/截图/探针/工作站备份进入附件。
- 本机已运行0.1.4，102项文件校验一致，1项变化先备份/hash、宿主最后更新。启动及quota-core纯JSON冒烟通过，missingClaudeCount=0，未终止用户浏览器。
- NSS载荷/本机宿主SHA256`5efed3ff1a6374412574e19ada2d1431ec9364876a08b38f5dc72d96d4deb224`；原始UNK宿主`a0322649f8ec34133764a458903096cd6b379c329059d25d98856925c4967711`，仅经审计3字节Tauri包标记差异。

更新前后元数据一致：3身份及归档引用/大小/mtime、3浏览器绑定、活动指针与SQLite v3保持。交付工具没有解密或改写真实归档，没有直接读取密钥或会话正文；没有切号、改代理、Cookie清理或重设浏览器种子。

定向Bun36、Rust3、GUI10及类型检查通过。固定引擎148.0.7778.215的三个独立临时资料对照均完成真实本地候选测量（约3.6–3.7秒），没有STUN或真实账号。分类API能力核对只用公共DNS样例，后续回归全部合成HTTP，并测试同IP成功、429、错配与无效响应不放行。完整[CI40304595882](https://github.com/yq04/Claude-Local/actions/runs/40304595882) success：前端141通过，原生主套件260通过1忽略、另1项定向检查通过，离线运行资源/迁移/CLI套件通过。

使用与历史原因见[BROWSER_CSP_0.1.4.md](BROWSER_CSP_0.1.4.md)。更新后从主软件重新打开实测页以加载新脚本及新本地会话；原浏览器标签/Claude Code会话保留。未通过用户真实资料验证20/20，外部分类或测量失败仍保持未知，分类不等于住宅或账号安全保证。

本机采用文件式更新，NSIS实装/卸载/降级及公开分发许可核验仍单独进行。本次无设计偏差。

本次另通过实际HTTP响应头1项检查和生产connect-src下GUI10项回归（修正前复现失败）。WebRTC真实引擎观测沿用同一未改动的JavaScript实现；0.1.4只补精确CSP和交付，未改RTC/分类算法。
