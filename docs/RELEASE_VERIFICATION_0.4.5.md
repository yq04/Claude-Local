<!--
[INPUT]: Fixed v0.4.5 source (ca73cd2f6bdc0bcb58a98df7b6bd96810e78b8db), neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests, backed-up local desktop update + CLI wrapper sync, and verified offline/UI/CLI/Rust regression results.
[OUTPUT]: Public release verification receipt without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and real installer execution/live account switching remains outside this check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.4.5 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权与 [MIT 许可](../LICENSE)。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.4.5)：`2026-11-26T10:04:23Z` 发布为 Latest，非草稿、非预发布。
- 标签 `v0.4.5` 固定到源码提交 [`ca73cd2f6bdc0bcb58a98df7b6bd96810e78b8db`](https://github.com/yq04/Claude-Local/commit/ca73cd2f6bdc0bcb58a98df7b6bd96810e78b8db)（`31` 项经审计与隐私扫描的变更与新增文件）。后续核验文档提交不移动该标签。

## 安装包与服务端摘要核对

- [Claude-Local_0.4.5_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.4.5/Claude-Local_0.4.5_x64-setup.exe)：`141,493,489` 字节，约 `134.94 MiB`。
- SHA-256：`ef29b4f61979ab3510bab9594ac171adf2c9315e3595c717d236ec002c6da332`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.4.5/SHA256SUMS.txt)：`99` 字节，SHA-256 `bcbc695efab60812dc07fac3a0ae10ea64c89c8169e554e3c821e6ccbf8a5128`；两项资产在 GitHub 服务端的字节大小与 SHA-256 `digest` 均与本地产物 100% 一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎与 `custom-protocol`（`src-tauri/target/release/claude-local.exe`：`19,088,384` 字节，SHA-256 `07b3370de8781a4857bbd00eb2978d31e21ce5c0f5d60f088dd8778fbb2bd8c5`）。NSIS 只读解包（`extracted-payload` 模式）后的精确资源白名单与隐私审计通过：`109` 个文件（`466,975,368` 字节）、`0` 项私有标记、`0` 项发现。实际 NSIS 安装向导执行与真实账号登录/切号动作仍在本次核验范围之外。

## 验证范围

1. **发版定稿（`0.4.5` 全部代码、元数据与发布文档定稿后）实测通过**：
   - 源码编码与隐私扫描：`31` 项待提交源码与文档（不含 `AGENTS.md`、`HANDOFF.md` 与 `.local/`）通过编码校验（`scripts/claude-relay.ps1` 与 `scripts/claude-subagent.ps1` 保持 UTF-8 BOM + 纯 LF，其余 `29` 文件保持 UTF-8 无 BOM + 纯 LF，`BAD_ENC=[]`）与工作站路径/凭据模式扫描（零真实路径或凭据命中）。
   - 前端构建、双语目录与单测：`bun test` **`230 pass`、`0 fail`**（`26` 个测试文件、`16,182` 次 `expect()` 断言，包含 `i18n.test.ts` 双语键与插槽一致性、`request-logs-model.test.ts`、`risk-model.test.ts` 与 `browser-network.test.ts`）；`bun run build`（`tsc --noEmit && vite build`，`669` 个模块，exit `0`）与 `python scripts/browser_ui.py dist`（exit `0`）通过。
   - 合成 UI 与 CLI 编排离线回归：`node --experimental-strip-types scripts/test-identities-ui.ts` **`75/75 passed`**；`node scripts/test-usage-statistics.mjs` **exit `0`**（涵盖明暗双语、请求日志分页/时区/DST/Portal 弹窗与响应布局）；`python scripts/test-cli-orchestrator-scripts.py -v` **`32/32 OK`**（涵盖短非 429 错误抑制、`429`/`529` 边界、`-ReadOnly` 抖动重试与 `-Resume` 变更守卫及 `<synthetic>` 净化）。
   - Release Rust 编译与单元测试：`RUSTFLAGS="-D warnings" cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local` **`407 passed`、`0 failed`、`2 ignored`**，零编译警告（覆盖 `USAGE_PARSER_VERSION = 6` 祖先耗时修复与 `<synthetic>` `uuid_nodes` 桥接、`handoff.rs` 非 429 错误解耦与 `incomplete` 归类，以及既有安全/隔离/浏览器全部回归）。

## 本机部署与 CLI 包装同步

- 用户主动退出桌面端 `claude-local.exe` 后，执行 `bun run deploy:local` 完成带备份升级：`%LOCALAPPDATA%\Programs\Claude-Local\claude-local.exe` 版本为 `0.4.5`，SHA-256（`07b3370de8781a4857bbd00eb2978d31e21ce5c0f5d60f088dd8778fbb2bd8c5`）与中性 Release 宿主 100% 一致，内置 `scripts/claude_quota.py` 哈希 100% 一致。
- 通过 `claude-local.exe --orchestrate`（`install_wrappers`）同步 `~/.local/bin` 全部 `6` 项 CLI 包装脚本与子代理模板：`claude-relay.ps1`（SHA-256 `69f28f3715debce926950a2510548b483c719d0d4d3393eaffc7e3cdf1a000ee`）与 `claude-subagent.ps1`（SHA-256 `c520ccfaa1e8fc5c75582790d538725c029eb00018d0c9578591a138fa2e0490`）与仓库源码 100% 一致；只读 `--orchestrate status` 冒烟返回 exit `0`。
- 全程未中断任何运行中的 `claude.exe` 进程（`missingClaudeCount == 0`），未修改 `~/.claude/settings.json` 或任何系统/代理规则。

## 范围与兼容

本版交付详见 [发布说明](RELEASE_NOTES_0.4.5.md)。数据与安全边界 100% 向下兼容：`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、`native_graphics: true` 默认值、`BAGAID01` 魔数、`.baga` 归档、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串与 `%APPDATA%\ai.local.claude-local` 目录均保持不变。此前 `v0.4.4`、`v0.4.3`、`v0.4.2`、`v0.4.1`、`v0.4.0`、`v0.3.7` 及更早标签、安装包与校验文件保持不可变。
