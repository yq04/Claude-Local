<!--
[INPUT]: Source-confirmed Windows x64 0.2.7 CLI/Codex co-routing domain rules, mixed-port HTTP vs SOCKS5 dual-protocol alignment, CLI settings.json anti-leak snippet and GRPC_PROXY vault key support.
[OUTPUT]: Bilingual public release notes; artifact hashes come only from the audited build's SHA256SUMS.txt.
[POS]: Public release notes linked from both READMEs and the v0.2.7 GitHub Release.
[PROTOCOL]: Retain attribution and persistent format compatibility; never require Companion Browser as the Windows default browser.
-->

# Claude-Local 0.2.7 发布说明 / Release Notes

Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。第三方组件遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包 / Download installer](https://github.com/yq04/Claude-Local/releases/download/v0.2.7/Claude-Local_0.2.7_x64-setup.exe) · [Release](https://github.com/yq04/Claude-Local/releases/tag/v0.2.7) · [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.7/SHA256SUMS.txt)

## 简体中文

0.2.7 聚焦 **Claude Code CLI 日常使用、子进程（如 Codex）协同调用及伴生浏览器同端口双协议代理对齐** 的防泄露加固，无需将 `Claude-Local-Browser` 设为系统默认浏览器即可在网卡与配置层闭环保护日常开发体验。

- **Mihomo 全量防漏覆写与 AI 提示词补齐（CLI 遥测 + Codex 协同同源路由）**：在桌面端一键 Mihomo 防漏覆写 YAML（`buildDesktopMihomoAntiLeakYaml`）、DNS 修复提示词与「网络环境」AI 配置提示词中，补齐 Claude Code 官方直连遥测域名 `datadoghq.com`，以及在 Claude Code 内调用 OpenAI Codex CLI 时的 `openai.com`、`chatgpt.com`、`oaistatic.com`、`oaiusercontent.com`、`auth0.com` 域名组，确保同一编码会话内 Claude 与 Codex 共享同一静态住宅出口，消除“同会话双出口”或切节点导致的跨国跳变风控。
- **同端口双协议（浏览器 `socks5://` vs CLI `http://`）智能对齐与防覆盖保护**：修复「浏览环境」页面将同一 Mihomo 混合监听端口（如 `127.0.0.1:7899`）下的浏览器 `socks5://127.0.0.1:7899`（锁定远程 DNS）与 CLI `http://127.0.0.1:7899`（规避 CLI 启动期代理竞态与 gRPC/httpx 报错）误判为“代理不一致”的问题；当端口确实不同需要点击「同步 CLI 代理到浏览器」时，自动规范化为 `socks5://host:port`，防止把浏览器的 `socks5://` 覆盖降级为 `http://`。
- **一键复制 Claude Code CLI 防漏配置（`settings.json`）与安全合入提示**：在「风控验证」页电脑端修复栏新增「查看 CLI 防漏配置 (settings.json)」预览与一键复制，按 Anthropic `sandbox-runtime` 规范生成成对大小写代理环境变量（`HTTP_PROXY`/`http_proxy`、`HTTPS_PROXY`/`https_proxy`、`ALL_PROXY`/`all_proxy`、`GRPC_PROXY`/`grpc_proxy`、`NO_PROXY`/`no_proxy`）及 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`、`DISABLE_TELEMETRY=1`、`DISABLE_ERROR_REPORTING=1`，并附带保留 `statusLine` 额度采集钩子的安全合入提示。
- **Rust 身份保险库 `GRPC_PROXY` 同步与跨机交接卡双协议标识**：在原生身份配置白名单 `SETTINGS_IDENTITY_KEYS` 与摘要解析中补入 `env.GRPC_PROXY` / `env.grpc_proxy`，确保多身份切换时完整归档与恢复；「复制跨机防关联交接卡」同时明确列出浏览器 `socks5://` 与 CLI `http://` 双协议地址。

`BAGAID01` / `.baga`、SQLite `user_version = 3`、已有主密钥、账号 HMAC 与浏览器种子 100% 向下兼容；升级保留已有身份库与浏览器资料，不主动终止运行中的 `claude.exe`。0.2.7 使用新标签与新资产，既有 0.2.6 标签和安装包保持不变。

## English

Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and maintained independently. Original copyright and the [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained; third-party terms are documented in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

0.2.7 hardens **daily Claude Code CLI usage, Codex subprocess co-routing, and same-port HTTP-vs-SOCKS5 proxy alignment** without requiring `Claude-Local-Browser` to be set as your Windows system default browser.

- **Mihomo Anti-Leak Override & AI Prompts Extended for CLI Telemetry & Codex Co-Routing**: Adds Claude Code's direct telemetry domain (`datadoghq.com`) and OpenAI Codex domains (`openai.com`, `chatgpt.com`, `oaistatic.com`, `oaiusercontent.com`, `auth0.com`) to the one-click desktop Mihomo override YAML (`buildDesktopMihomoAntiLeakYaml`), DNS remediation prompts, and Network page AI prompts so Claude Code and Codex share the same static residential exit during collaborative sessions.
- **Same-Port Dual-Protocol Proxy Alignment (`socks5://` Browser vs. `http://` CLI)**: Recognizes Companion Browser `socks5://127.0.0.1:7899` (remote DNS lock) and CLI `http://127.0.0.1:7899` on the same Mihomo mixed listener port as aligned instead of showing a false-positive mismatch warning, and preserves the `socks5://` scheme when syncing a different CLI proxy port to the browser.
- **One-Click Claude Code CLI Anti-Leak `settings.json` Snippet & Safe Merge Hint**: Adds a `View CLI Anti-Leak (settings.json)` preview and copy action in Risk Verification, generating uppercase and lowercase proxy environment variable pairs (`HTTP_PROXY`/`http_proxy`, `HTTPS_PROXY`/`https_proxy`, `ALL_PROXY`/`all_proxy`, `GRPC_PROXY`/`grpc_proxy`, `NO_PROXY`/`no_proxy`) plus `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`, and `DISABLE_ERROR_REPORTING=1`, with an explicit hint to merge `"env"` without overwriting existing `statusLine` hooks.
- **Native Vault `GRPC_PROXY` Archiving & Dual-Protocol Handoff Spec**: Adds `env.GRPC_PROXY` and `env.grpc_proxy` to `SETTINGS_IDENTITY_KEYS` and profile metadata extraction for per-identity `.baga` archiving, and updates Copy Handoff Spec to display both Browser `socks5://` and CLI `http://` endpoints.

`BAGAID01` / `.baga`, SQLite `user_version = 3`, existing master keys, account HMACs and browser seeds remain 100% compatible. Upgrades preserve vaults and browser profiles without terminating running `claude.exe` sessions. Version 0.2.7 uses a new tag and assets; existing 0.2.6 artifacts remain unchanged.

## 安装包校验 / Installer verification

请将以下结果与本版 Release 的 `SHA256SUMS.txt` 比对。 / Compare the result with `SHA256SUMS.txt` from this release.

```powershell
Get-FileHash .\Claude-Local_0.2.7_x64-setup.exe -Algorithm SHA256
```
