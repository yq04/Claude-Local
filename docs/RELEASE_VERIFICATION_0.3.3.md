<!--
[INPUT]: Fixed v0.3.3 source, neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and local atomic hot-update receipt.
[OUTPUT]: Public release and local-update verification without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and installer execution remains outside this workstation check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.3.3 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权和 MIT 声明。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.3)：2026-11-14T05:24:26Z 发布为 Latest，非草稿、非预发布。
- 标签 `v0.3.3` 固定到源码提交 [`01f7085481e4e7f8a5b60e95a38eea68957b430f`](https://github.com/yq04/Claude-Local/commit/01f7085481e4e7f8a5b60e95a38eea68957b430f)。后续文档提交不移动该标签。

## 安装包与本机同步

- [Claude-Local_0.3.3_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.3.3/Claude-Local_0.3.3_x64-setup.exe)：`140,980,435` 字节，约 `134.45 MiB`。
- SHA-256：`4af97dc04a099f41b27ca4821af246bbfca1424838aeb54465bd2fa3e7f184d4`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.3/SHA256SUMS.txt)：`99` 字节，SHA-256 `0956ff8693c0669404ad186e526b6b2036a838b879aaab5154ed8e50e8b1463e`；安装包与校验文件的 GitHub 服务端 digest 均与本地对应文件一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎、单作业原生构建与 `custom-protocol`。NSIS 只读解包后的精确资源白名单/哈希审计通过：109 个文件（`464,849,003` 字节）、7 项外置工作站路径隐私探针、0 项发现。同批次桌面主程序已通过本机原子热更新验证（`hostSha256` `1f65697954a866f088f440451e8a288885ccc68500e54a1b578930d3cc83ae7b`，27 个安装与采集脚本文件 SHA-256 对账一致，`missingClaudeCount == 0`）。实际 NSIS 安装器向导运行与真实账号登录、切号操作仍在本次核验范围之外。

## 验证范围

以下验证均在 `0.3.3` 版本号同步后运行并通过：

- 类型检查与前端构建：`bun run build`（`tsc --noEmit && vite build`，662 个模块）与 `python scripts/browser_ui.py dist` 通过；
- 前端单元测试：`bun test` 195 项全部通过（26 个测试文件、14,728 次 `expect()` 断言）；
- Release Rust 单元测试：`cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local` 332 passed、0 failed、2 ignored（2 项合成重负载基准 `usage_perf`）；
- Python 离线合成测试：8 套共 114 项通过（本地 38、在线 40、迁移 11、包审计 9、归档 7、浏览器预备 4、运行时 3、资源清单 2）；
- Playwright 合成 UI 测试：身份卡片 28、养号 29、在线配额 10、额度重置 8、Usage 完整 38 + 可靠性 11（含 8 组响应式布局）、快速配置 16、悬浮小窗 12 模态全部通过。测试仅使用合成账号与隔离上下文，不触碰真实凭据、账号或运行中的 CLI 会话。

## 范围与兼容

本版交付四项稳定性和界面改进，详见 [发布说明](RELEASE_NOTES_0.3.3.md)：

- **内核句柄级 CLI 存活核验与分级状态徽章**：过滤父终端未释放句柄导致的 Toolhelp 残留 PID 误报，优先 `NtQueryInformationProcess(60)` 排查 `node.exe` / `bun.exe`（对原生 `claude.exe` 与伴生浏览器零 `PROCESS_VM_READ`），新增 `identities_live_sessions` 实时同步与 `CLI 运行中` / `桌面端运行` / `当前使用` 分级徽章；
- **瞬态文件锁自愈、切号零残留回滚与一键干净恢复**：幂等 `kill_process` 退出等待、切前写锁排空与有界指数退避重试，跳过 `.claude/debug/latest` 及瞬态锁文件且不哈希易变目录 `mtime`，`Store::switch` 单故障自动回滚并清理临时未保存身份卡，新增 `Store::recover_clean` 一键恢复；
- **CLI 安全边界统一判定与防断流提示增强**：风控验证与 CLI 残留审计共用 `isCliSecurityShieldOk` / `isCliMcpBoundarySafe`，对缺显式 HTTP 代理或误配 `socks5://` 给出显式告警胶囊；
- **用量分析 `单会话均耗` KPI 升级与对齐精修**：以 `单会话均耗` / `单次均耗` 替换“缓存节省”指标（保留 TSV `cache_savings_usd` 列），统一 `.usage-summary` / `.usage-metric` 上缘基准线与原子防折行副文案，将 `.usage-model-caption` 重构为 `2×2` 等高微指标网格与右对齐等宽占比列，并同步校准 2× Retina 长图海报。

`v0.3.2` 仍指向 `260f80ec78729fbd1f01dbd8d268e873f8ff2209`（核验提交 `a72a1455096bfb9e2bf5d954a3f297f4aa874f2c`），`v0.3.1` 及更早标签、安装包和校验文件保持不变。隐私探针与静态审计仅覆盖明确检查范围，不构成任意秘密绝对不存在或账号免风控的保证。
