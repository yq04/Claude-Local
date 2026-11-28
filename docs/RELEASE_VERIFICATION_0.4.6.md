<!--
[INPUT]: Fixed v0.4.6 source (62aec19912d920802a3b9865024a96d411eef6db), neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests, backed-up local desktop update + CLI wrapper sync, and verified 143-case black-box E2E + offline/UI/CLI/Rust regression results.
[OUTPUT]: Public release verification receipt without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and real installer execution/live account switching remains outside this check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.4.6 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权与 [MIT 许可](../LICENSE)。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.4.6)：`2026-11-28T15:06:06Z` 发布为 Latest，非草稿、非预发布。
- 标签 `v0.4.6` 固定到源码提交 [`62aec19912d920802a3b9865024a96d411eef6db`](https://github.com/yq04/Claude-Local/commit/62aec19912d920802a3b9865024a96d411eef6db)（`108` 项经审计与隐私扫描的变更与新增文件）。后续核验文档提交不移动该标签。

## 安装包与服务端摘要核对

- [Claude-Local_0.4.6_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.4.6/Claude-Local_0.4.6_x64-setup.exe)：`141,620,136` 字节，约 `135.06 MiB`。
- SHA-256：`41a88ba78d032d196e901e2b7c9e335611c84e1f52e60dcea31638407588e1b9`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.4.6/SHA256SUMS.txt)：`99` 字节，SHA-256 `9fb63786d0e2a103db50ae69e9158214c40e5b37a7deb1edc4f08497aa024eff`；两项资产在 GitHub 服务端的字节大小与 SHA-256 `digest` 均与本地产物 100% 一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎与 `custom-protocol`（`src-tauri/target/release/claude-local.exe`：`19,437,568` 字节，SHA-256 `b7e4b55f4db6e46d49026dd79e30a6727ae5a235f5b93a8d81d42591c40cd303`）。NSIS 只读解包（`extracted-payload` 模式）后的精确资源白名单与隐私审计通过：`111` 个文件（`467,369,235` 字节）、`7` 项外置私有路径标记、`0` 项发现。实际 NSIS 安装向导执行与真实账号登录/切号动作仍在本次核验范围之外。

## 验证范围

1. **发版定稿（`0.4.6` 全部代码、元数据与发布文档定稿后）实测通过**：
   - 源码编码与隐私扫描：`108` 项已提交源码与文档通过编码校验（`scripts/claude-relay.ps1` 与 `scripts/claude-subagent.ps1` 保持 UTF-8 BOM + 纯 LF，全部已提交文件保持 UTF-8 无 BOM + 纯 LF，`BAD_ENC=[]`）与工作站路径/凭据模式扫描（零真实路径或凭据命中）。
   - 前端构建、双语目录与单测：`bun test` **`238 pass`、`0 fail`**（`26` 个测试文件、`16,395` 次 `expect()` 断言，包含 `i18n.test.ts` `2,547` 键 1:1 双语对齐与 `browser-verification.test.ts` 跨上下文防篡改覆盖）；`bun run build`（`tsc --noEmit && vite build`，`671` 个模块，exit `0`）与 `python scripts/browser_ui.py dist`（exit `0`）通过。
   - 4+1 层独立沙盒黑盒端到端与合成 UI 回归：`bun run scripts/e2e/run.ts --mode target --json` **`143/143 pass`、`0 fail`、`0 baseline_gap`**（`coverageOk: true`、`hostSafety.ok: true`）；`bun run test:identities` **`76/76 passed`**；`node scripts/test-usage-statistics.mjs`（全 `4` 模式）、`node scripts/test-local-shell.mjs`（`.identity-card` `166×286`）、`node scripts/test-quota-browser-bridge.mjs` 与 `node scripts/test-quota-integration.mjs` 全部通过；`9` 套离线合成 Python 测试 **`161/161 OK`**（含全平台夹具 `169/169`）。
   - Release Rust 编译与单元测试：`RUSTFLAGS="-D warnings" cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local -- --test-threads=1` **`442 passed`、`0 failed`、`2 ignored`**，零源码编译警告。

## 本机部署与 CLI 包装同步

- 用户主动退出桌面端 `claude-local.exe` 后，执行 `bun run deploy:local` 完成带备份升级：`%LOCALAPPDATA%\Programs\Claude-Local\claude-local.exe` 版本为 `0.4.6`，SHA-256（`b7e4b55f4db6e46d49026dd79e30a6727ae5a235f5b93a8d81d42591c40cd303`）与中性 Release 宿主 100% 一致，内置 `scripts/claude_quota.py` 哈希 100% 一致。
- 通过 `claude-local.exe --orchestrate`（`install_wrappers`）同步 `~/.local/bin` 全部 `6` 项 CLI 包装脚本与子代理模板：`claude-relay.ps1`（SHA-256 `69f28f3715debce926950a2510548b483c719d0d4d3393eaffc7e3cdf1a000ee`）与 `claude-subagent.ps1`（SHA-256 `c520ccfaa1e8fc5c75582790d538725c029eb00018d0c9578591a138fa2e0490`）与仓库源码 100% 一致；只读 `--orchestrate status` 冒烟返回 exit `0`。
- 全程未中断任何运行中的 `claude.exe` 进程（`missingClaudeCount == 0`），未修改 `~/.claude/settings.json` 或任何系统/代理规则。

## 范围与兼容

本版交付详见 [发布说明](RELEASE_NOTES_0.4.6.md)。数据与安全边界 100% 向下兼容：`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、既有已保存浏览器 `config.json` 配置（仅新建未初始化槽位默认 `native_graphics: false`）、`BAGAID01` 魔数、`.baga` 归档、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串与 `%APPDATA%\ai.local.claude-local` 目录均保持不变。此前 `v0.4.5`、`v0.4.4`、`v0.4.3`、`v0.4.2`、`v0.4.1`、`v0.4.0`、`v0.3.7` 及更早标签、安装包与校验文件保持不可变。
