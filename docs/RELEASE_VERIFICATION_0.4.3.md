<!--
[INPUT]: Fixed v0.4.3 source (e1950343ef3199127f78a45957c8fbc636b03251), neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and verified offline/UI/Rust/Python regression results.
[OUTPUT]: Public release verification receipt without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and real installer execution/live account switching remains outside this check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.4.3 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权与 [MIT 许可](../LICENSE)。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.4.3)：`2026-11-23T16:20:26Z` 发布为 Latest，非草稿、非预发布。
- 标签 `v0.4.3` 固定到源码提交 [`e1950343ef3199127f78a45957c8fbc636b03251`](https://github.com/yq04/Claude-Local/commit/e1950343ef3199127f78a45957c8fbc636b03251)（`24` 项经审计与隐私扫描的变更与新增文件）。后续核验文档提交不移动该标签。

## 安装包与服务端摘要核对

- [Claude-Local_0.4.3_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.4.3/Claude-Local_0.4.3_x64-setup.exe)：`141,473,871` 字节，约 `134.92 MiB`。
- SHA-256：`7d9154a1bdf7e3f77cb18137ddcb1fcd6720aedd1c91430311c64298063339cc`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.4.3/SHA256SUMS.txt)：`99` 字节，SHA-256 `dbef390cb72f5c95e599b2492d876852e5d68454751ee0822d14c49c9683ccb6`；两项资产在 GitHub 服务端的字节大小与 SHA-256 `digest` 均与本地产物 100% 一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎与 `custom-protocol`（`src-tauri/target/release/claude-local.exe`：`18,834,432` 字节，SHA-256 `dfccfeb91ed6a82d8fe0ce8ae3c4c596607f7bcab60b4e952faf532d06242e86`）。NSIS 只读解包（`extracted-payload` 模式）后的精确资源白名单与隐私审计通过：`109` 个文件（`466,651,498` 字节）、`6` 项外部隐私探针、`0` 项发现。实际 NSIS 安装向导执行与真实账号登录/切号动作仍在本次核验范围之外。

## 验证范围

1. **发版定稿（`0.4.3` 全部代码、元数据与发布文档定稿后）实测通过**：
   - 源码编码与隐私扫描：`24` 项变更/新增源码与文档通过 UTF-8/行尾校验（`BAD_ENC=[]`，全量保持 UTF-8 无 BOM + LF，排除 `AGENTS.md` 与 `.local/`）与工作站路径/凭据模式扫描（`PRIVACY_HITS=[]`）。
   - 前端构建与单测：`bun test` **`224 pass`、`0 fail`**（`25` 个测试文件、`15,115` 次 `expect()` 断言，含五源地理 schema、单请求 `api.ipquery.io`、同源 429 分类去重与受控网络错误归一回归）；`bun run build`（`tsc --noEmit && vite build`，`666` 个模块，exit `0`）与 `python scripts/browser_ui.py dist`（exit `0`）通过。
   - 双语词库严格校验：[`src/locales/zh.yaml`](../src/locales/zh.yaml) 与 [`src/locales/en.yaml`](../src/locales/en.yaml) 保持 **`2,422`** 条键精确 `1:1` 对齐，`en.yaml` 值包含 `0` 个 CJK 字符。
   - Release Rust 编译与单元测试：`cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local` **`398 passed`、`0 failed`、`2 ignored`**，`0` Rust 编译器/`dead_code` 警告（新增多源解析/错误对象拒绝/IDC 黑名单覆盖、同源 `api.ipquery.io` 去重、生产 `connect-src` 全源覆盖断言与 `probe_country` 轻量 trace/回退回归）。
   - Python 离线、PowerShell AST 与 MV3 桥接回归：`test-cli-orchestrator-scripts.py` `31/31`、`test-claude-quota-local.py` `50/50`、`test-claude-quota-online.py` `43/43`、`test-quota-archive.py` `7/7`、`test-migrate-local-data.py` `11/11`、`test-audit-windows-package.py` `9/9`、`test-fetch-browser.py` `4/4`、`test-quota-runtime.py` `3/3`、`test-runtime-resources.py` `2/2`（共 **`160/160` OK**，严守未运行会改动系统环境的 `scripts/test-windows.py`）、`node scripts/test-quota-browser-bridge.mjs` 通过，且 `claude-relay.ps1` / `claude-subagent.ps1` 通过 Windows PowerShell 5.1 与 PowerShell 7 语法 AST 零错误校验。
   - Playwright 串行合成 UI 测试：`test-identities-ui.ts` `--verification-only` **`12`**（含生产 `server.rs` `connect-src` 下的 `api.ipquery.io` 直出与 `429 -> ipinfo.io` 备援路径）+ 全量 **`75`** + `--online-only` **`10`**、`test-usage-statistics.mjs` **`38`** 项全量回归以及 `test-local-shell.mjs` + `--monitor-only`（`errors: []`、`12` 项浮窗布局零裁切/零溢出）全部通过。

## 本机部署边界说明

- 发布全程未中断任何运行中的 `claude.exe` 与 `claude-local.exe` 桌面进程；仓库侧 `src-tauri/target/release/claude-local.exe` 与 `dist/` 已由本次中性构建刷新至 `0.4.3`，待用户在空闲窗口自行退出桌面端 `Claude-Local` 后执行 `bun run deploy:local`（或直接运行 `Claude-Local_0.4.3_x64-setup.exe`）即可平滑升级 `%LOCALAPPDATA%\Programs\Claude-Local` 至 `v0.4.3`。

## 范围与兼容

本版交付详见 [发布说明](RELEASE_NOTES_0.4.3.md)。数据与安全边界 100% 向下兼容：`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、`native_graphics: true` 默认值、`BAGAID01` 魔数、`.baga` 归档、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串与 `%APPDATA%\ai.local.claude-local` 目录均保持不变。此前 `v0.4.2`、`v0.4.1`、`v0.4.0`、`v0.3.7` 及更早标签、安装包与校验文件保持不可变。
