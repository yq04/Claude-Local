<!--
[INPUT]: Fixed v0.4.2 source (54e14640b75bcb2ae3e4c9ce6a99999cfae7a07c), neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and verified offline/UI/Rust/Python regression results.
[OUTPUT]: Public release verification receipt without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and real installer execution/live account switching remains outside this check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.4.2 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权与 [MIT 许可](../LICENSE)。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.4.2)：`2026-11-22T14:06:10Z` 发布为 Latest，非草稿、非预发布。
- 标签 `v0.4.2` 固定到源码提交 [`54e14640b75bcb2ae3e4c9ce6a99999cfae7a07c`](https://github.com/yq04/Claude-Local/commit/54e14640b75bcb2ae3e4c9ce6a99999cfae7a07c)（`72` 项经审计与隐私扫描的新增、删除与重构文件）。后续核验文档提交不移动该标签。

## 安装包与服务端摘要核对

- [Claude-Local_0.4.2_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.4.2/Claude-Local_0.4.2_x64-setup.exe)：`141,444,508` 字节，约 `134.89 MiB`。
- SHA-256：`b467dfc6a07c5f3875b208a38ec8bbf3686a579abdb1838f1ee0cbde26641f8a`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.4.2/SHA256SUMS.txt)：`99` 字节，SHA-256 `e00c7bb9ef0b6f6e86ddcf5b416844e8991198bf1f6d3fd87034d709ade29c7e`；两项资产在 GitHub 服务端的字节大小与 SHA-256 `digest` 均与本地产物 100% 一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎与 `custom-protocol`（`src-tauri/target/release/claude-local.exe`：`18,821,120` 字节，SHA-256 `0a0b4d858d6815fd0cdf0fc7f5587f06ade3bc05d8373e30de0a09b548e15cc9`）。NSIS 只读解包（`extracted-payload` 模式）后的精确资源白名单与隐私审计通过：`109` 个文件（`466,635,327` 字节）、`6` 项外部隐私探针、`0` 项发现。实际 NSIS 安装向导执行与真实账号登录/切号动作仍在本次核验范围之外。

## 验证范围

1. **发版定稿（`0.4.2` 元数据与发布文档完成后）实测通过**：
   - 源码编码与隐私扫描：`64` 项变更/新增源码与文档（不含已追踪忽略项之外的工作区本地文件）通过 UTF-8/行尾校验（`BAD=[]`，[`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) 与 [`scripts/claude-subagent.ps1`](../scripts/claude-subagent.ps1) 保持 UTF-8 WITH BOM + LF，其余保持 UTF-8 无 BOM + LF）；相对 `v0.4.1` 新增行（`9,757` 行，含模块拆分迁入代码）工作站路径/真实凭据模式扫描 `0` 命中（排除 `AGENTS.md` 与 `.local/`）。
   - 前端构建与单测：`bun test` `222 pass`、`0 fail`（`25` 个测试文件、`15,086` 次 `expect()` 断言）；`bun run build`（`tsc --noEmit && vite build`，`666` 个模块，exit `0`）与 `python scripts/browser_ui.py dist`（exit `0`）通过。
   - Release Rust 编译与单元测试：`cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local` **`395 passed`、`0 failed`、`2 ignored`**，`0` 编译器/`dead_code` 警告（以及中性 Release 打包构建 `0` Rust 编译器警告）。
2. **代码重构完成态 5 门独立验收（版本号 `0.4.1 -> 0.4.2` 文档调整前同源源码）**：
   - 双语词库严格校验：[`src/locales/zh.yaml`](../src/locales/zh.yaml) 与 [`src/locales/en.yaml`](../src/locales/en.yaml) 共 **`2,422`** 条键精确 `1:1` 对齐（较 `0.4.1` 剪除 `743` 条零引用/已淘汰键），`en.yaml` 值包含 `0` 个 CJK 字符；[`src/i18n.test.ts`](../src/i18n.test.ts) 已升级递归扫描 `src/` 与 `src-tauri/src/` 子目录。
   - Python 离线、PowerShell AST 与 MV3 桥接回归：`test-cli-orchestrator-scripts.py` `31/31`、`test-claude-quota-local.py` `50/50`、`test-claude-quota-online.py` `43/43`、`test-quota-archive.py` `7/7`、`test-migrate-local-data.py` `11/11`、`test-audit-windows-package.py` `9/9`、`test-fetch-browser.py` `4/4`、`test-quota-runtime.py` `3/3`、`test-runtime-resources.py` `2/2`（共 **`160/160` OK**，严守未运行会改动系统环境的 `scripts/test-windows.py`）、`node scripts/test-quota-browser-bridge.mjs` 通过，且 `claude-relay.ps1` / `claude-subagent.ps1` 通过 Windows PowerShell 5.1 与 PowerShell 7 语法 AST 零错误校验。
   - Playwright 串行合成 UI 测试：`test-identities-ui.ts` 全量 `73` + `--verification-only` `10` + `--online-only` `10`、`test-usage-statistics.mjs` `38` 项全量回归以及 `test-local-shell.mjs` + `--monitor-only`（`errors: []`、`使用说明` 页 `任务交接模板` 计数 `=== 0`、`12` 项浮窗布局零裁切/零溢出）全部通过。

## 本机无感同步情况

- 在用户主动退出桌面端 `claude-local.exe` 后，经 [`scripts/deploy-local.ps1`](../scripts/deploy-local.ps1) 完成本机安装目录 `%LOCALAPPDATA%\Programs\Claude-Local` 升级至 `0.4.2`（二进制 SHA-256 `0a0b4d858d6815fd0cdf0fc7f5587f06ade3bc05d8373e30de0a09b548e15cc9` 100% 匹配），配合 `--orchestrate install_wrappers`（`ok: true`，`6` 文件 SHA-256 精确对齐）、`~/.local/bin/{claude_quota.py,quota_archive.py}` 原子同步以及只读 `claude-relay.ps1 -Status` 冒烟核验（全程未中断在线 `claude.exe` 会话）。

## 范围与兼容

本版交付详见 [发布说明](RELEASE_NOTES_0.4.2.md)。数据与安全边界 100% 向下兼容：`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、`native_graphics: true` 默认值、`BAGAID01` 魔数、`.baga` 归档、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串与 `%APPDATA%\ai.local.claude-local` 目录均保持不变。此前 `v0.4.1`、`v0.4.0`、`v0.3.7` 及更早标签、安装包与校验文件保持不可变。
