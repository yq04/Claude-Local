<!--
[INPUT]: Fixed v0.4.4 source (9b8789c025fc467161e9025090729e081adf8ea9), neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and verified offline/UI/Rust regression results.
[OUTPUT]: Public release verification receipt without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and real installer execution/live account switching remains outside this check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.4.4 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权与 [MIT 许可](../LICENSE)。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.4.4)：`2026-11-25T08:08:16Z` 发布为 Latest，非草稿、非预发布。
- 标签 `v0.4.4` 固定到源码提交 [`9b8789c025fc467161e9025090729e081adf8ea9`](https://github.com/yq04/Claude-Local/commit/9b8789c025fc467161e9025090729e081adf8ea9)（`48` 项经审计与隐私扫描的变更与新增文件）。后续核验文档提交不移动该标签。

## 安装包与服务端摘要核对

- [Claude-Local_0.4.4_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.4.4/Claude-Local_0.4.4_x64-setup.exe)：`141,471,041` 字节，约 `134.92 MiB`。
- SHA-256：`6f93bc30fbc9c2af940a23e77495dd47e620738b436ef3b9627f54e84688f10e`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.4.4/SHA256SUMS.txt)：`99` 字节，SHA-256 `7c5931e9f92bd6689c44cc35388adc651c924a53847335e221bc5eb8eaf6b6d3`；两项资产在 GitHub 服务端的字节大小与 SHA-256 `digest` 均与本地产物 100% 一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎与 `custom-protocol`（`src-tauri/target/release/claude-local.exe`：`19,066,880` 字节，SHA-256 `59553b93cf191a3cec2945c040734ac25c87f96f8c4f214e38c1851e36194cab`）。NSIS 只读解包（`extracted-payload` 模式）后的精确资源白名单与隐私审计通过：`108` 个文件（`466,768,798` 字节）、`0` 项私有标记、`0` 项发现。实际 NSIS 安装向导执行与真实账号登录/切号动作仍在本次核验范围之外。

## 验证范围

1. **发版定稿（`0.4.4` 全部代码、元数据与发布文档定稿后）实测通过**：
   - 源码编码与隐私扫描：`47` 项待提交源码与文档（不含 `AGENTS.md`、`HANDOFF.md` 与 `.local/`）通过 UTF-8 无 BOM / LF 校验（`BAD_ENC=[]`）与工作站路径模式扫描（`PRIVACY_HITS=[]`）。
   - 前端构建、双语目录与单测：`bun test` **`230 pass`、`0 fail`**（`26` 个测试文件、`15,964` 次 `expect()` 断言，包含 `i18n.test.ts` 双语键与插槽一致性、`request-logs-model.test.ts`、`browser-network.test.ts` 与 `risk-model.test.ts`）；`bun run build`（`tsc --noEmit && vite build`，`669` 个模块，exit `0`）与 `python scripts/browser_ui.py dist`（exit `0`）通过。
   - Release Rust 编译与单元测试：`cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local` **`403 passed`、`0 failed`、`2 ignored`**（新增显式 HTTP/HTTPS 代理 `--host-resolver-rules` 锁、受限宿主机无 donor 默认关闭 `follow_machine`、禁用 `network_prediction_options=2` 与 `Local State` `dns_over_https.mode="off"`、`parse_trace_exit` 与 30s 显式代理周期/基线 IP 追踪及 `usage_logs` 回归）。

## 本机部署边界说明

- 发布全程未中断任何运行中的 `claude.exe` 与 `claude-local.exe` 桌面进程；待用户在空闲窗口自行退出桌面端 `Claude-Local` 后执行 `bun run deploy:local`（或直接运行 `Claude-Local_0.4.4_x64-setup.exe`）即可平滑升级 `%LOCALAPPDATA%\Programs\Claude-Local` 至 `v0.4.4`。

## 范围与兼容

本版交付详见 [发布说明](RELEASE_NOTES_0.4.4.md)。数据与安全边界 100% 向下兼容：`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、`native_graphics: true` 默认值、`BAGAID01` 魔数、`.baga` 归档、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串与 `%APPDATA%\ai.local.claude-local` 目录均保持不变。此前 `v0.4.3`、`v0.4.2`、`v0.4.1`、`v0.4.0`、`v0.3.7` 及更早标签、安装包与校验文件保持不可变。
