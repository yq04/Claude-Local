<!--
[INPUT]: Fixed v0.4.1 source (ea7aa18a453ac2312f99a4284035a5f710031a0e), neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and verified offline/UI/Rust/Python regression results.
[OUTPUT]: Public release verification receipt without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and real installer execution/live account switching remains outside this check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.4.1 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权与 [MIT 许可](../LICENSE)。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.4.1)：`2026-11-22T11:25:43Z` 发布为 Latest，非草稿、非预发布。
- 标签 `v0.4.1` 固定到源码提交 [`ea7aa18a453ac2312f99a4284035a5f710031a0e`](https://github.com/yq04/Claude-Local/commit/ea7aa18a453ac2312f99a4284035a5f710031a0e)（`59` 个经审计与隐私扫描的新增/变更源码、脚本与文档文件）。后续核验文档提交不移动该标签。

## 安装包与服务端摘要核对

- [Claude-Local_0.4.1_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.4.1/Claude-Local_0.4.1_x64-setup.exe)：`141,461,942` 字节，约 `134.91 MiB`。
- SHA-256：`d43e818e96dc38996d0322a2ab6e9ab6fd9ec8c18cfa018cd2c90c7aa8f9cb5b`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.4.1/SHA256SUMS.txt)：`99` 字节，SHA-256 `eaf4deab0bf5d0179c127d44af8c42b099dffa32aa929303a5029990dc449040`；两项资产在 GitHub 服务端的字节大小与 SHA-256 `digest` 均与本地产物 100% 一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎与 `custom-protocol`（`src-tauri/target/release/claude-local.exe`：`18,848,256` 字节，SHA-256 `d4848b8dae1742e7d0b4dd2579e9b90a85d57e5f58bfa5e6b085a376f87e84eb`）。NSIS 只读解包（`extracted-payload` 模式）后的精确资源白名单与隐私审计通过：`109` 个文件（`466,802,840` 字节）、`6` 项外部隐私探针、`0` 项发现。实际 NSIS 安装向导执行与真实账号登录/切号动作仍在本次核验范围之外。

## 验证范围

以下验证均在 `0.4.1` 版本元数据与源码定稿后独立运行并通过：

- 源码隐私、词库与行尾校验：`59` 项待提交源码与文档保持纯 LF（[`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) 与 [`scripts/claude-subagent.ps1`](../scripts/claude-subagent.ps1) 保持 UTF-8 WITH BOM + LF，其余 `57` 项保持 UTF-8 无 BOM + LF）；相对 `v0.4.0` 新增行（`3,416` 行）工作站路径/真实凭据模式扫描零命中（排除 `AGENTS.md` 与 `.local/`）；[`src/locales/zh.yaml`](../src/locales/zh.yaml) 与 [`src/locales/en.yaml`](../src/locales/en.yaml) 共 `3,165` 条键 1:1 对齐且 `en.yaml` 值为 0 中文。
- 类型检查与前端构建：`bun run build`（`tsc --noEmit && vite build`，`663` 个模块，exit `0`）与 `python scripts/browser_ui.py dist`（exit `0`）通过；
- 前端单元测试：`bun test` `236 pass`、`0 fail`（`26` 个测试文件、`17,441` 次 `expect()` 断言，含冷却清晰清除、`cli_default_proxy` 缺省归一、多端口 Clash YAML 生成、风控 Rule-Section/Sift+Telemetry 与双语目录校验）；
- Release Rust 单元测试：`cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local`：`395 passed`、`0 failed`、`2 ignored`（覆盖 `identities_orchestrator_clear_cooldown`、`identities_sync_browser_proxy`、未绑定槽位代理继承顺序、跨段 Mihomo YAML、`wakeup` 被动 429 同步与 `handoff.rs` 限流过滤）；
- Python 离线、PowerShell AST 与 MV3 桥接回归：`test-claude-quota-local.py` `50/50`、`test-claude-quota-online.py` `43/43`、`test-cli-orchestrator-scripts.py` `31/31`、`test-migrate-local-data.py` `11/11`、`test-audit-windows-package.py` `9/9`、`test-quota-archive.py` `7/7`、`test-fetch-browser.py` `4/4`、`test-quota-runtime.py` `3/3`、`test-runtime-resources.py` `2/2`（共 `160/160` OK，严守未运行会改动系统环境的 `scripts/test-windows.py`）、`node scripts/test-quota-browser-bridge.mjs` 通过，且 `claude-relay.ps1` / `claude-subagent.ps1` 通过 Windows PowerShell 5.1 与 PowerShell 7 语法 AST 零错误校验；
- Playwright 串行合成 UI 测试：`test-identities-ui.ts` 全量 `73` + `--verification-only` `10` + `--online-only` `10`、`test-usage-statistics.mjs --quick-only` `16` 以及 `test-local-shell.mjs --monitor-only` `12` 全部通过（定稿前亦完成 `1040×820` Smart Relay `108px` 单轴对齐、Network 多端口生成弹窗与 Risk 告警态零溢出实测）。测试仅使用合成账号与隔离上下文，不触碰真实凭据、账号或运行中的 CLI 会话。

## 本机无感同步验证

- 在用户主动退出桌面端 `claude-local.exe` 后，经 [`scripts/deploy-local.ps1`](../scripts/deploy-local.ps1) 完成本机安装目录 `%LOCALAPPDATA%\Programs\Claude-Local` 升级至 `0.4.1`（二进制 SHA-256 `d4848b8dae1742e7d0b4dd2579e9b90a85d57e5f58bfa5e6b085a376f87e84eb` 100% 匹配），并通过 `claude-local.exe --orchestrate install_wrappers`（`ok: true`，`6` 文件）及 `~/.local/bin/{claude_quota.py,quota_archive.py}` 原子同步与 `claude-relay.ps1 -Status` 只读冒烟核验（全程未中断在线 `claude.exe` 会话）。

## 范围与兼容

本版交付详见 [发布说明](RELEASE_NOTES_0.4.1.md)。数据与安全边界 100% 向下兼容：`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、`native_graphics: true` 默认值、`BAGAID01` 魔数、`.baga` 归档、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串与 `%APPDATA%\ai.local.claude-local` 目录均保持不变。此前 `v0.4.0`、`v0.3.7` 及更早标签、安装包与校验文件保持不可变。
