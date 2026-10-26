<!--
[INPUT]: Pinned source CI, actual isolated engine observations, package audit, local update and server asset digest.
[OUTPUT]: Browser0.1.3 release facts and measurement/data preservation limits.
[POS]: Public-safe verification; no real screenshot, IP, identity, paths, tickets or secrets included.
-->
# 0.1.3 浏览器核验候选历史

> 本候选生产CSP存在遗漏，不能作为补充分类已完成的最终验收；0.1.4已修正，旧标签及资产保留追溯。

日期2026-10-26。本次为公开候选重置后的0.1.3，不使用早期内部同版本回执。

- 固定源码/标签：`50bf4120aacb175804b35db037a4226546080330` / `v0.1.3`。
- [私有预发布](https://github.com/yq04/Claude-Local/releases/tag/v0.1.3)：draft=false、prerelease=true；仅安装器附件。
- `Claude-Local_0.1.3_x64-setup.exe`，140,555,118字节，SHA256`e5f64ac534798f40be64c6657f4b68e8fd8f45a4dac3311cbbf79bfc3e96d37e`，GitHub服务端digest和size匹配。
- custom-protocol/新中性Cargo构建，解包审计109文件、13隐私探针、0发现；无真实资料/截图/探针/工作站备份进入附件。
- 本机已运行0.1.3，102项文件校验一致，8项变化先备份/hash、宿主最后更新。启动及quota-core纯JSON冒烟通过，missingClaudeCount=0，未终止用户浏览器。
- NSS载荷/本机宿主SHA256`07db1150702b36c97cc38ba3d209ec39e918e3bd39f07d3e06f47cd0c43b99ba`；原始UNK宿主`6bc15436d2365e36cf47b13c7de0f03331f48a105d35cfa6e21efbfd07a6cc5c`，仅经审计3字节Tauri包标记差异。

更新前后元数据一致：3身份及归档引用/大小/mtime、3浏览器绑定、活动指针与SQLite v3保持。交付工具没有解密或改写真实归档，没有直接读取密钥或会话正文；没有切号、改代理、Cookie清理或重设浏览器种子。

定向Bun36、Rust3、GUI10及类型检查通过。固定引擎148.0.7778.215的三个独立临时资料对照均完成真实本地候选测量（约3.6–3.7秒），没有STUN或真实账号。分类API能力核对只用公共DNS样例，后续回归全部合成HTTP，并测试同IP成功、429、错配与无效响应不放行。完整[CI40300936001](https://github.com/yq04/Claude-Local/actions/runs/40300936001) success。

使用与历史原因见[BROWSER_VERIFICATION_0.1.3.md](BROWSER_VERIFICATION_0.1.3.md)。更新后从主软件重新打开实测页以加载新脚本及新本地会话；原浏览器标签/Claude Code会话保留。未通过用户真实资料验证20/20，外部分类或测量失败仍保持未知，分类不等于住宅或账号安全保证。

本机采用文件式更新，NSIS实装/卸载/降级及公开分发许可核验仍单独进行。本次无设计偏差。
