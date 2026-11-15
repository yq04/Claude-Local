<!--
[INPUT]: Fixed v0.3.5 source (966a2e6), neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and local atomic hot-update receipt.
[OUTPUT]: Public release and local-update verification without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and installer execution remains outside this workstation check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.3.5 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权和 MIT 声明。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.5)：`2026-11-15T06:14:56Z` 发布为 Latest，非草稿、非预发布。
- 标签 `v0.3.5` 固定到源码提交 [`966a2e624bbe26ce9190abee17a59dc9e1e712cd`](https://github.com/yq04/Claude-Local/commit/966a2e624bbe26ce9190abee17a59dc9e1e712cd)（跳过未发布的 `v0.3.4`）。后续文档提交不移动该标签。

## 安装包与本机同步

- [Claude-Local_0.3.5_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.3.5/Claude-Local_0.3.5_x64-setup.exe)：`140,993,630` 字节，约 `134.46 MiB`。
- SHA-256：`af059a43597a8977fd9ab71d7289b59774908053b86eb2b2030e49f894b0acd1`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.5/SHA256SUMS.txt)：`99` 字节，SHA-256 `66ace3f8400ca709896febb43c3dface4f9c6dd7823c276e57f77ddefcc42580`；安装包与校验文件的 GitHub 服务端 digest 均与本地对应文件一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎、单作业原生构建与 `custom-protocol`。NSIS 只读解包（`extracted-payload` 模式）后的精确资源白名单/哈希审计通过：`109` 个文件（`464,853,740` 字节）、`7` 项外置工作站路径隐私探针、`0` 项发现。同批次桌面主程序已通过本机原子热更新验证（`hostSha256` `ccc02c5c2e6c543c36ccebbff40c1b922de78001ac9550f8f6cfcadb4d725d2a`，`27` 个安装与采集脚本文件 SHA-256 对账一致，其中 `9` 项变更文件已原子替换，交互桌面 Session 1 存活，`missingClaudeCount == 0`）。实际 NSIS 安装器向导运行与真实账号登录、切号操作仍在本次核验范围之外。

## 验证范围

以下验证均在 `0.3.5` 版本号与源码定稿后运行并通过：

- 类型检查与前端构建：`bun run build`（`tsc --noEmit && vite build`，`663` 个模块）与 `python scripts/browser_ui.py dist` 通过；
- 前端单元测试：`bun test` `195` 项全部通过（`26` 个测试文件、`14,774` 次 `expect()` 断言）；
- Release Rust 单元测试：`cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local` `332 passed`、`0 failed`、`2 ignored`（`2` 项合成重负载基准 `usage_perf`）；
- Python 离线合成测试：`8` 套共 `114` 项通过（本地 `38`、在线 `40`、迁移 `11`、包审计 `9`、归档 `7`、浏览器预备 `4`、运行时 `3`、资源清单 `2`）；
- Playwright 串行合成 UI 测试与视觉审计：`test-identities-ui.ts` 全量 `73` + `--verification-only` `10` + `--warming-only` `29`、`test-usage-statistics.mjs` 全量 `38` + `--quick-only` `16` + `--layout-only` `108` + `--usage-reliability-only` `11`（含 `8` 组响应式布局）、`test-local-shell.mjs` 及 `--monitor-only`（`12` 种双语/明暗/收折悬浮小窗模态）与 `0.3.5` `26` 张界面截图审计（零页面/控制台错误）全部通过。测试仅使用合成账号与隔离上下文，不触碰真实凭据、账号或运行中的 CLI 会话。

## 范围与兼容

本版交付桌面端全 9 页去 AI 紧凑排版重构、双语微文案压缩与 6 项细节精修，详见 [发布说明](RELEASE_NOTES_0.3.5.md)：

- **统一外壳与全 9 页去 AI 高密度布局**：全工作区统一 `44px` 页头与 `18px` 中性 `H1`、`12px` 圆角、`28×28` 中性图标与紧凑 `.settings-row`，新增共享 [`src/env-pages.css`](../src/env-pages.css)，重构快速配置 4 栏状态条 + 2 列 8 入口网格、浏览环境双列核验矩阵、电脑环境美区基线摘要条 + 分组三行设置卡、网络环境三联代理卡、风控验证 3 列 `.risk-grid-3`、使用说明双列 `.help-topics` 网格与并排 `.backup-forms-grid`；完整保留 `.identity-card`（`166×286`）与 `.browser-verification-page` / `.browser-start` / `.verification-*` 几何；
- **6 项细节精修与 286 键双语微文案压缩**：`.identity-onboarding-bar` 轻量药丸与面包屑引导并对齐 `166×286` 注释；[`src/claude-residue-panel.tsx`](../src/claude-residue-panel.tsx) 补齐 `SOCKS5`/不完整 CLI 代理边界明细与 `shieldWarnHint` 悬浮提示、中性 `secondary` 异常登录按钮与紧凑行距；[`src/claude-cli-panel.tsx`](../src/claude-cli-panel.tsx) 改用中性 `>_` 终端图标徽章（`.cli-terminal-badge`）；[`src/settings.tsx`](../src/settings.tsx) / [`src/backup-panel.css`](../src/backup-panel.css) 将「恢复默认界面设置」归位外观与关于页、`.backup-location` 路径与操作按钮单行水平对齐及 `12px` `.backup-rescue-toggle`；[`src/smart-relay-model.ts`](../src/smart-relay-model.ts) 简化候选推荐判定。

数据与安全边界 100% 向下兼容：`BAGAID01` 魔数、`.baga` 归档、SQLite `user_version = 3`、账号 HMAC 规则、浏览器种子字符串与 `%APPDATA%\ai.local.claude-local` 目录均保持不变。`v0.3.3` 仍指向 `01f7085481e4e7f8a5b60e95a38eea68957b430f`（核验提交 `c443015dc607295e2db37be7e0e11ddb06be5086`），`v0.3.2` 仍指向 `260f80ec78729fbd1f01dbd8d268e873f8ff2209`（核验提交 `a72a1455096bfb9e2bf5d954a3f297f4aa874f2c`），此前所有标签、安装包和校验文件保持不变。隐私探针与静态审计仅覆盖明确检查范围，不构成任意秘密绝对不存在或账号免风控的保证。
