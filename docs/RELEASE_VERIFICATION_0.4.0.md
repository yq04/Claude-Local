<!--
[INPUT]: Fixed v0.4.0 source (0d9fc2b0e874a4193d02f647631c5bfb49693f65), neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and verified offline/UI/Rust/Python regression results.
[OUTPUT]: Public release verification receipt without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and real installer execution/live account switching remains outside this check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.4.0 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权与 [MIT 许可](../LICENSE)。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.4.0)：`2026-11-22T08:43:37Z` 发布为 Latest，非草稿、非预发布。
- 标签 `v0.4.0` 固定到源码提交 [`0d9fc2b0e874a4193d02f647631c5bfb49693f65`](https://github.com/yq04/Claude-Local/commit/0d9fc2b0e874a4193d02f647631c5bfb49693f65)（`49` 个经审计与隐私扫描的新增/变更源码、脚本与文档文件）。后续核验文档提交不移动该标签。

## 安装包与服务端摘要核对

- [Claude-Local_0.4.0_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.4.0/Claude-Local_0.4.0_x64-setup.exe)：`141,508,938` 字节，约 `134.95 MiB`。
- SHA-256：`bf6560b9e68f576356d699f12fac775397effb2b18694a1409dca9e31466f122`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.4.0/SHA256SUMS.txt)：`99` 字节，SHA-256 `03d2f58754762cf0d0a22a7d7d567f4a74e90f7995a0199322db5947d2514172`；两项资产在 GitHub 服务端的字节大小与 SHA-256 `digest` 均与本地产物 100% 一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎与 `custom-protocol`（`src-tauri/target/release/claude-local.exe`：`18,714,112` 字节，SHA-256 `ae4ad9fbaa790ce0bd33952e1dac1c16ed6346fe0b322e2083461277ba101767`）。NSIS 只读解包（`extracted-payload` 模式）后的精确资源白名单与隐私审计通过：`108` 个文件（`466,481,313` 字节）、`0` 项发现。实际 NSIS 安装向导执行与真实账号登录/切号动作仍在本次核验范围之外。

## 验证范围

以下验证均在 `0.4.0` 版本元数据与源码定稿后独立运行并通过：

- 源码隐私、词库与行尾校验：`49` 项待提交源码与文档保持纯 LF（[`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) 保持 UTF-8 WITH BOM + LF，其余 `48` 项保持 UTF-8 无 BOM + LF），工作站路径/真实凭据模式扫描零命中（排除 `AGENTS.md` 与 `.local/`）；[`src/locales/zh.yaml`](../src/locales/zh.yaml) 与 [`src/locales/en.yaml`](../src/locales/en.yaml) 共 `3,127` 条键 1:1 对齐且 `en.yaml` 值为 0 中文。
- 类型检查与前端构建：`bun run build`（`tsc --noEmit && vite build`，`663` 个模块，exit `0`）与 `python scripts/browser_ui.py dist`（exit `0`）通过；
- 前端单元测试：`bun test` `228 pass`、`0 fail`（`26` 个测试文件、`17,150` 次 `expect()` 断言，含 Sift 审计 UI、`findSameExitClusterWarning` 与双语目录校验）；
- Release Rust 单元测试：`cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local`：`387 passed`、`0 failed`、`2 ignored`（含 `has_sift_rules`、Persona+Yoti 同组校验、`kyc_status` 网页桥与 `WebMetadata` 单调校验）；
- Python 离线与 MV3 桥接回归：`test-claude-quota-local.py` `49/49`、`test-claude-quota-online.py` `43/43`、`test-cli-orchestrator-scripts.py` `31/31`（含 300s 外部子代理超时落入阈切与中途 5h 重置清理）、`test-migrate-local-data.py` `11/11`、`test-audit-windows-package.py` `9/9`、`test-quota-archive.py` `7/7`、`test-fetch-browser.py` `4/4`、`test-quota-runtime.py` `3/3`、`test-runtime-resources.py` `2/2` 及 `node scripts/test-quota-browser-bridge.mjs` 全部通过（严格未运行会改动系统环境的 `scripts/test-windows.py`）；
- Playwright 串行合成 UI 测试：`test-identities-ui.ts` 全量 `73` + `--verification-only` `10` + `--online-only` `10` 以及 `test-usage-statistics.mjs --quick-only` `16` 全部通过；在 `v0.4.0` 定稿前亦通过 `1040×820` 中文浅色 Smart Relay 弹窗视觉及 DOM 对齐校验（10 行 `0px` 横向漂移、零横向溢出）。测试仅使用合成账号与隔离上下文，不触碰真实凭据、账号或运行中的 CLI 会话。

## 范围与兼容

本版交付详见 [发布说明](RELEASE_NOTES_0.4.0.md)，涵盖两阶段主动阈值自动换号接力（`80%–100%` 与默认值收敛）、智能接力弹窗单轴排版对齐与 `≥3` 号同出口聚集提醒，以及 Sift v122 / Yoti 分流审计、同源只读 `/kyc_status` 观测与 `native_graphics` 多号指纹指引。

数据与安全边界 100% 向下兼容：`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、`native_graphics: true` 默认值、`BAGAID01` 魔数、`.baga` 归档、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串与 `%APPDATA%\ai.local.claude-local` 目录均保持不变。此前 `v0.3.7` 及更早标签、安装包与校验文件保持不可变。隐私探针与静态审计仅覆盖明确检查范围，不构成任意秘密绝对不存在或账号免风控的保证。
