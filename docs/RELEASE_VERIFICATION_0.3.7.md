<!--
[INPUT]: Fixed v0.3.7 source (edfda1f), neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and local atomic hot-update receipt.
[OUTPUT]: Public release and local-update verification without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and installer execution remains outside this workstation check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.3.7 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权与 [MIT 许可](../LICENSE)。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.7)：`2026-11-21T06:00:52Z` 发布为 Latest，非草稿、非预发布。
- 标签 `v0.3.7` 固定到源码提交 [`edfda1ffbd5267f5096ebd11af010245319bbc49`](https://github.com/yq04/Claude-Local/commit/edfda1ffbd5267f5096ebd11af010245319bbc49)（`127` 个经审计与隐私扫描的源码、脚本与文档文件）。后续核验文档提交不移动该标签。

## 安装包与本机同步

- [Claude-Local_0.3.7_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.3.7/Claude-Local_0.3.7_x64-setup.exe)：`141,410,380` 字节，约 `134.86 MiB`。
- SHA-256：`de85f1ccbf10a4ae839b206c7884c4fcfc5fdc8b34072b1345f2c39e701e8460`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.7/SHA256SUMS.txt)：`99` 字节，SHA-256 `442373363b0bfdbbf15130506160a862b035e077bb9d4f9f7d9ecb4e857a5810`；安装包与校验文件的 GitHub 服务端 digest 及字节大小均与本地对应文件 100% 一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎、单作业原生构建与 `custom-protocol`。NSIS 只读解包（`extracted-payload` 模式）后的精确资源白名单/哈希审计通过：`109` 个文件（`466,590,235` 字节）、`7` 项外置工作站路径隐私探针、`0` 项发现。同批次桌面主程序已通过本机原子热更新验证（`hostSha256` `01c4527374155f7a0090b661fa0a7307b426211fff51b6bb1557d6d14b5ee2c4`，`ProductVersion == 0.3.7`，`27` 个安装与采集脚本文件 SHA-256 对账一致，其中 `8` 项变更文件已原子替换，交互桌面 Session 1 存活，`missingClaudeCount == 0`），并经 Python `subprocess.run` 向已安装的 `claude-local.exe --orchestrate` 同步部署 `6` 项 CLI 包装文件（`install_wrappers` `ok: true`）并通过只读 `status` 冒烟校验（exit `0` 有效 JSON）。实际 NSIS 安装器向导运行与真实账号登录、切号操作仍在本次核验范围之外。

## 验证范围

以下验证均在 `0.3.7` 最终 UI 精修与源码定稿后独立运行并通过：

- 源码隐私与行尾校验：`127` 项暂存源码与文档保持纯 LF（`0` CRLF；[`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) 与 [`scripts/claude-subagent.ps1`](../scripts/claude-subagent.ps1) 保持 UTF-8 WITH BOM + LF，其余 `125` 项保持 UTF-8 无 BOM + LF），`8` 项工作站路径/凭据隐私探针零命中（排除本地 `AGENTS.md` 与 `.local/`）；
- 类型检查与前端构建：`bun run build`（`tsc --noEmit && vite build`，`663` 个模块，exit `0`）与 `python scripts/browser_ui.py dist`（exit `0`）通过；
- 前端单元测试：`bun test` `225 pass`、`0 fail`（`26` 个测试文件、`17,022` 次 `expect()` 断言，含双语目录校验）；
- Release Rust 编译与单元测试：`cargo build --manifest-path src-tauri/Cargo.toml --bin claude-local`（exit `0`）与 `cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local`：`381 passed`、`0 failed`、`2 ignored`（`synthetic_switch_and_compression_benchmark` 与 `usage_perf_heavy_workstation`）；
- Python 离线合成测试：`9` 套共 `155 / 155` 项通过（`test-claude-quota-local.py` `48`、`test-claude-quota-online.py` `42`、`test-migrate-local-data.py` `11`、`test-audit-windows-package.py` `9`、`test-quota-archive.py` `7`、`test-fetch-browser.py` `4`、`test-quota-runtime.py` `3`、`test-runtime-resources.py` `2`、`test-cli-orchestrator-scripts.py` `29`；严格未运行会改动系统环境的 `scripts/test-windows.py`）；
- Playwright 串行合成 UI 测试与视觉审计：`test-identities-ui.ts` 全量 `73` + `--verification-only` `10` + `--warming-only` `29`、`test-usage-statistics.mjs` 全量 `38` + `--quick-only` `16` + `--layout-only` `108` + `--usage-reliability-only` `11`（含 `8` 组响应式布局）、`test-local-shell.mjs --monitor-only`（`12` 种双语/明暗/收折悬浮小窗模态）以及 `1040×820` 中文浅色与英文深色 `9` 张实拍截图视觉审计全部通过。测试仅使用合成账号与隔离上下文，不触碰真实凭据、账号或运行中的 CLI 会话。

## 范围与兼容

本版交付详见 [发布说明](RELEASE_NOTES_0.3.7.md)，涵盖重置卡 Strategy A1 与 `reset_harvest`、模块化 `--orchestrate` 与 `clean_handoff` / `Opus 5.5 + max` / `daemon stop --any` / `api-request-blob` 防误切加固、Supported Countries Policy 全链路防封与 Scenario G 账本守卫、后台静默资源优化，以及今天完成的五项工作台 UI 精修：

- **左侧边栏与命令面板（[`src/main.tsx`](../src/main.tsx) / [`src/productivity-shell.css`](../src/productivity-shell.css) / [`src/style.css`](../src/style.css)）**：移除侧栏顶部搜索触发条并清理死选择器，完整保留全局 `Ctrl+K` / `Cmd+K` 监听与 `<CommandPalette />` 键盘面板；
- **CLI 卡片与身份库顶栏去噪（[`src/claude-cli-panel.tsx`](../src/claude-cli-panel.tsx) / [`src/identities.tsx`](../src/identities.tsx) / [`src/identity-productivity.css`](../src/identity-productivity.css)）**：移除 `Claude Code CLI` 内后台任务与交接检查点提示框（保留 `status?.running`、`isAnyCliLive` 与 `launchRelayFromPanel`），并移除身份库上方独立的 `data-smart-relay-banner` 横幅（保留顶栏胶囊与 Smart Relay 弹窗及切换弹窗内 `activeAdoptJobs`）；
- **用量分析 5 列零溢出账号表与紧致筛选器（[`src/usage-statistics.tsx`](../src/usage-statistics.tsx) / [`src/usage-statistics.css`](../src/usage-statistics.css) / [`src/style.css`](../src/style.css)）**：将 `.usage-table` 精简为 `账号 / 总 Token / 输出 / API 等效花费 / 缓存命中率` 5 列（单行省略双行账号单元格 + `privacyMask` 脱敏提示 + `定位卡片`，`1040×820` 中英明暗态零水平裁剪），并将 `.usage-account-filter` 与作用域 `[role="listbox"]:not(.command-palette-list)` 弹层收紧贴合选项宽度。

数据与安全边界 100% 向下兼容：`166×286` `.identity-card`、`.browser-verification-page` / `.browser-start` / `.verification-*` 几何、`BAGAID01` 魔数、`.baga` 归档、SQLite `user_version = 3`、账号 HMAC 规则、浏览器种子字符串与 `%APPDATA%\ai.local.claude-local` 目录均保持不变。`v0.3.6`（`1b4cfcd` / 核验提交 `61be76a`）、`v0.3.5`（`966a2e6` / 核验提交 `fa8342f`）、`v0.3.3`（`01f7085` / 核验提交 `c443015`）与 `v0.3.2`（`260f80e` / 核验提交 `a72a145`）此前所有标签、安装包和校验文件保持不变。隐私探针与静态审计仅覆盖明确检查范围，不构成任意秘密绝对不存在或账号免风控的保证。
