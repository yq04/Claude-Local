<!-- [INPUT]: Verified v0.4.5 Request Logs full-stack overhaul (layout/pagination/DST/TZ switcher & parser v5/v6 outlier+synthetic fixes) and mid-response stream-drop resilience across handoff.rs, usage.rs, CLI relay/subagent wrappers, and Mihomo keep-alive/chain guidance atop v0.4.4. -->
<!-- [OUTPUT]: Bilingual public GitHub Release notes for Claude-Local v0.4.5 (no automatic updater; non-disruptive Windows x64 upgrade). -->
<!-- [POS]: Tracked documentation artifact paired with git tag v0.4.5 and SHA256SUMS.txt. -->

# Claude-Local v0.4.5

> **独立 Windows x64 发行说明 / Standalone Windows x64 Release Notes**
> 发布日期 Date: `2026-11-26` · 应用标识 Bundle ID: `ai.local.claude-local` · 主程序 Executable: `claude-local.exe` · 伴侣浏览器 Companion Browser: `Claude-Local-Browser`

---

## 中文说明

### 核心更新摘要

`v0.4.5` 围绕 **「请求日志」全栈体验与数据精度精修** 以及 **应对 `Connection lost mid-response` 流式断流的全栈韧性加固** 推出两大升级：

1. **「请求日志」工作台全栈精修与解析器 v5/v6 校准（[`src/request-logs.tsx`](../src/request-logs.tsx) / [`src/request-logs.css`](../src/request-logs.css) / [`src-tauri/src/identities/usage.rs`](../src-tauri/src/identities/usage.rs) / [`usage_logs.rs`](../src-tauri/src/identities/usage_logs.rs)）**
   - **页面布局与分页交互重构**：补回 `.system-page` 外层滚动与边距容器及 `--usage-secondary`/Token 色令牌，重新平衡 8 列宽（时间列 `20%` 保障跨年完整不裁剪）、右对齐数值列与多标签自适应换行，请求详情弹窗升级为 `@container logs-detail` 响应式布局防止按钮挤出；新增顶部快捷翻页、`↓ 最新优先` / `↑ 最早优先` 排序切换、底部完整页码条 + 页码直跳 + 翻页/改每页条数自动回表顶，并保留上一帧画面彻底消除翻页闪屏。
   - **历史夏令时对齐、零改 OS 时区切换与未归属透明说明**：逐条按原始历史时间戳精确计算 `EDT UTC-4` / `EST UTC-5` 夏令时徽章，修复 `h23` 午夜 `24:xx` 渲染，新增不改动任何 Windows 系统设置的「北京时间 (UTC+8) / 美东 / UTC」日志展示时区切换器与早期归档标识；新增未归属请求计数筛选胶囊与不可变原因说明横幅。
   - **Rust 用量解析器升级至 `USAGE_PARSER_VERSION = 6`**：新增多跳祖先防环回溯（`has_same_event_ancestor`）、端到端耗时上限放宽至 `20min`（`MAX_DURATION_MS = 1_200_000`）、`duration_outlier_repaired_v5` 历史异常修复迁移与 `MAX_SANE_TPS = 2000.0` 全范围清洗，彻底消除虚假超高 `tok/s` 峰值；同步在 `parse_file_core` 与 `recover_prefix_context` 中将 `<synthetic>` 节点纳入 `uuid_nodes` 桥接，并引入有界防环 `chain_needs_prefix_context`（最多 32 跳），防止中途流式中断产生的合成节点截断后续请求耗时与父子链路。

2. **`Connection lost mid-response` 流式断流韧性与防误判加固（[`src-tauri/src/identities/handoff.rs`](../src-tauri/src/identities/handoff.rs) / [`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) / [`scripts/claude-subagent.ps1`](../scripts/claude-subagent.ps1) / [`src/risk-model.ts`](../src/risk-model.ts) / [`src/vps.tsx`](../src/vps.tsx)）**
   - **原生交接误判修复（`handoff.rs`）**：将通用 `isApiErrorMessage` 与 429 限流检测彻底解耦，过滤良性 `error: false/{}` 与 `apiErrorStatus: 0`，新增 HTTP `529` 过载与带 `●`/`•`/`⏺` 前缀横幅识别；未恢复的非 429 中途断流子代理现在准确归类为 `incomplete`，不再误标 `interrupted_429`（已在后续回合恢复的保持 `output_ready`）。
   - **CLI 接力与子代理断流保护（`claude-relay.ps1` / `claude-subagent.ps1`）**：
     - `claude-relay.ps1` 在 `Stop` 钩子遇到短非 429 API 错误横幅时抑制 `turn_end.json` 误记，收紧 `(?<!\d)429(?!\d)` 与 `529` 词边界避免匹配普通数字串，正确忽略 `error: false`，并在分叉转录与交接摘要中剔除 `<synthetic>` 与 `isApiErrorMessage` 噪声。
     - `claude-subagent.ps1` 新增严格 TUI 横幅边界匹配的 `TransientStreamError` 检测（避免误伤普通 Markdown 正文），为 `-ReadOnly` 只读任务提供 1 次同槽 2.5–5 秒抖动重试且不触发账号冷却；对 `-ReadOnly -Resume` 叠加 `.jsonl` 体积与修改时间变更守卫，同时在清洗与摘要阶段剥离断流合成错误消息。
   - **长连接保活与链式代理稳定性指引**：桌面端 Mihomo 防漏覆写 YAML 模板默认启用 TCP Keep-Alive（`disable-keep-alive: false`、`keep-alive-idle: 30`、`keep-alive-interval: 15`），并在「网络环境」双语 AI 链式代理配置提示词中建议第一跳优先稳定 `fallback` 或保守 `url-test`（`lazy: true`、`interval >= 300s`），在不改变住宅出口 IP 与既有防封边界的前提下降低长响应中途被重置的概率。

### 兼容性与无损升级说明

- **数据与界面契约 100% 向下兼容**：完整保留 `BAGAID01` 魔数、`.baga` 归档编码、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串、`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、`native_graphics: true` 默认值以及 `%APPDATA%\ai.local.claude-local` 目录结构。
- **平滑无中断升级**：支持从 `0.1.x`、`0.2.x`、`0.3.x` 与 `0.4.0`–`0.4.4` 直接升级至 `v0.4.5`，不破坏已有身份、密钥与浏览器登录状态，不强制中断在线 `claude.exe` 会话。
- **校验与核验**：安装前可用 PowerShell 校验并对比随附 `SHA256SUMS.txt`：
  ```powershell
  Get-FileHash .\Claude-Local_0.4.5_x64-setup.exe -Algorithm SHA256
  ```

---

## English Release Notes

### Highlights

**`v0.4.5`** delivers a full-stack polish of the **Request Logs** workspace alongside end-to-end resilience hardening for **`Connection lost mid-response`** streaming drops:

1. **Request Logs Full-Stack Polish & Parser v5/v6 Accuracy ([`src/request-logs.tsx`](../src/request-logs.tsx) / [`src/request-logs.css`](../src/request-logs.css) / [`src-tauri/src/identities/usage.rs`](../src-tauri/src/identities/usage.rs) / [`usage_logs.rs`](../src-tauri/src/identities/usage_logs.rs))**
   - **Layout, Responsive Inspector & Flicker-Free Pagination**: Restores the `.system-page` scroll/padding container and `--usage-secondary`/token color tokens, rebalances all 8 table columns (keeping `20%` timestamp width for zero cross-year clipping), right-aligns numeric columns with wrapping badges, and upgrades the detail modal to `@container logs-detail` responsive sizing. Adds a top quick-pager, `↓ Latest` / `↑ Earliest` sort toggle, full bottom page bar with direct page jump, auto scroll-to-top on page/size changes, and previous-frame retention to eliminate pagination flicker.
   - **Historical DST Badges, Zero-OS-Mutation Timezone Switcher & Unattributed Clarity**: Computes `EDT UTC-4` / `EST UTC-5` badges from each row's historical timestamp, fixes `h23` midnight `24:xx` formatting, adds an in-app Beijing (UTC+8) / US Eastern / UTC display switcher (zero Windows OS mutations) plus archived-row badges, and introduces an unattributed-count filter pill with an immutable cause explanation banner.
   - **Usage Parser Upgraded to `USAGE_PARSER_VERSION = 6`**: Adds cycle-safe multi-hop ancestor resolution (`has_same_event_ancestor`), raises `MAX_DURATION_MS` to `20min` (`1_200_000`), runs `duration_outlier_repaired_v5` migration with `MAX_SANE_TPS = 2000.0` sanitization to eliminate false TPS spikes, and inserts `<synthetic>` nodes into `uuid_nodes` (both `parse_file_core` and `recover_prefix_context`) with bounded `chain_needs_prefix_context` (max 32 hops) so mid-stream synthetic error markers never sever subsequent duration chains.

2. **`Connection lost mid-response` Stream-Drop Resilience ([`src-tauri/src/identities/handoff.rs`](../src-tauri/src/identities/handoff.rs) / [`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) / [`scripts/claude-subagent.ps1`](../scripts/claude-subagent.ps1) / [`src/risk-model.ts`](../src/risk-model.ts) / [`src/vps.tsx`](../src/vps.tsx))**
   - **Decoupled Handoff Error Classification (`handoff.rs`)**: Separates generic `isApiErrorMessage` from HTTP 429 rate-limit detection, ignores benign `error: false/{}` and `apiErrorStatus: 0`, recognizes HTTP `529` overload and bullet-prefixed (`●`/`•`/`⏺`) banners, and classifies unrecovered non-429 mid-stream subagent drops as `incomplete` instead of false `interrupted_429` (while preserving `output_ready` when recovered).
   - **Hardened CLI Relay & Subagent Wrappers (`claude-relay.ps1` / `claude-subagent.ps1`)**:
     - `claude-relay.ps1` suppresses false `turn_end.json` markers on `Stop` when `last_assistant_message` is a short non-429 API error banner, tightens `(?<!\d)429(?!\d)` & `529` token boundaries, handles boolean `error: false`, and strips `<synthetic>` / `isApiErrorMessage` noise from scrubbed forks and handoff digests.
     - `claude-subagent.ps1` adds strict TUI-banner `TransientStreamError` detection (avoiding Markdown false positives), retries `-ReadOnly` jobs once on the same slot after a 2.5–5s jitter without triggering account cooldown (guarded against transcript mutations when `-ReadOnly -Resume` is set), and strips synthetic error artifacts from sanitized digests.
   - **TCP Keep-Alive & Hop-1 Stability Guidance**: Enables TCP keep-alive defaults (`disable-keep-alive: false`, `keep-alive-idle: 30`, `keep-alive-interval: 15`) in the desktop Mihomo anti-leak YAML template and updates bilingual AI proxy chain prompts to prefer stable `fallback` or conservative `url-test` (`lazy: true`, `interval >= 300s`) on Hop-1 without altering residential exits or anti-ban boundaries.

### Compatibility & Non-Disruptive Upgrade

- **Full Backward Compatibility**: `BAGAID01` vault headers, `.baga` archives, SQLite `user_version = 3`, account HMAC rules, legacy browser seed strings, `166×286` identity cards, 20 `REQUIRED_CHECK_IDS`, `native_graphics: true`, and `%APPDATA%\ai.local.claude-local` paths remain unchanged.
- **Seamless In-Place Upgrade**: Upgrades directly from `0.1.x`–`0.4.4` to `v0.4.5` without re-creating identities or interrupting active `claude.exe` sessions.
- **Checksums**: Compare `Claude-Local_0.4.5_x64-setup.exe` against the published `SHA256SUMS.txt` asset via:
  ```powershell
  Get-FileHash .\Claude-Local_0.4.5_x64-setup.exe -Algorithm SHA256
  ```

---

## Attribution & License

- Maintained in this repository as an independent Windows x64 project under the [MIT License](../LICENSE) with preserved third-party copyright notices in [NOTICE](../NOTICE.md).
