<!--
[INPUT]: Claude Code 官方网络文档、openai/codex-plugin-cc、anthropic-experimental/sandbox-runtime、Koushik890/jev-firewall、disler/claude-code-hooks-mastery 克隆源码，以及 Claude-Local v0.2.6 源码二次校准审阅。
[OUTPUT]: CLI 浏览器调用、Codex 协同与子进程 IP 泄露调研结论（二次校准版）及已落地的核心优化（O1/O2/O4）。
[POS]: 调研与方案入口文件。
[PROTOCOL]: 保持非侵入式与零后续阻断原则，绝不终止运行中的 claude.exe，绝不要求将 Claude-Local-Browser 设为系统默认浏览器。
-->
# Claude Code CLI 日常调用浏览器/软件（含 Codex）的 IP 泄露调研与优化方案（二次校准执行版）

核查与执行日期：2026-11-03。基线版本：`v0.2.6`（`main` 分支）。

## 一、 二次 Review 核心结论（区分“真实高优风险”与“无需折腾的伪需求”）

经过对 `Claude-Local v0.2.6` 源码、Claude Code 官方网络文档及 4 个克隆开源仓库的二次严格交叉核验（Review），结论如下：

### 1. 为什么您**完全不需要**把 `Claude-Local-Browser` 设为 Windows 默认浏览器？
- **日常体验优先**：将指纹浏览器设为 Windows 全局默认浏览器会严重干扰日常微信、邮件、文档链接的打开体验，且完全没有必要。
- **OS 网络层兜底已能保护日常浏览器**：
  - 我们在二次核查 [`src/risk-model.ts`](../../src/risk-model.ts) 时确认：`Claude-Local` 生成的电脑端 Mihomo 一键防漏覆写配置（`buildDesktopMihomoAntiLeakYaml`）已经在系统底层开启了 `tun.strict-route: true`，并通过 `prepend-rules` 在网卡层全局阻断了 `UDP 443`（QUIC）和 **`UDP 3478 / 19302 / 5349` 及 `DOMAIN-KEYWORD,stun`（WebRTC STUN/TURN 穿透）**。
  - 这意味着：**只要 Mihomo 覆写规则启用，哪怕 `claude.exe` 或 `codex` 偶尔弹出了您日常使用的 Chrome/Edge 默认浏览器，日常浏览器的 WebRTC 穿透同样在网卡层被 Mihomo 物理拦截，且所有发往 `claude.ai` / `claude.com` / `anthropic.com` / `openai.com` / `chatgpt.com` 的请求都会强制走同一个静态住宅出口，不会因为“没把 `Claude-Local-Browser` 设为默认浏览器”而漏出本地真实 IP！**
- **平时网页端与 CLI 的分工原则**：
  - **日常浏览器（Chrome/Edge）**：保持为系统默认浏览器，供日常办公查资料使用；不要在日常浏览器里长期登录或混登多个 Claude 账号。
  - **`Claude-Local-Browser`（伴侣浏览器）**：仅在您需要为某个特定 Claude 身份做网页登录、查看账单、过 KYC 或进行 Free 养号卡日常对话时，从 `Claude-Local` 面板内点击打开即可。

### 2. 二次校准后真正存在且有价值的 3 个问题（已全部修复落地）

| 编号 | 经二次校准确认的真实问题 | 证据来源与可靠性 | 处理状态 |
|---|---|---|---|
| **O1** | **Mihomo 防漏规则遗漏了 Claude Code 官方遥测域名 `datadoghq.com` 以及调用 Codex 时的 OpenAI 域名组** | **100% 可靠（官方文档实锤）**：Claude Code 官方网络文档明确列出直连 API 时会向 `http-intake.logs.us5.datadoghq.com` 与 `browser-intake-us5-datadoghq.com` 发送遥测（注：`mcp-proxy.anthropic.com`、`sso.claude.com`、`bridge.claudeusercontent.com` 已被现有的 `DOMAIN-SUFFIX,anthropic.com/claude.com/claudeusercontent.com` 自动覆盖，唯独第三方域名 `datadoghq.com` 未被覆盖）。同时，在 Claude Code 内调用 Codex 时，若 `openai.com` / `chatgpt.com` / `oaistatic.com` / `oaiusercontent.com` / `auth0.com` 未锁入同一静态家宽组，会导致同会话双出口或被迫切节点。 | **已执行落地**（已更新 `src/risk-model.ts` 与 `src/vps.tsx`） |
| **O2** | **`src/browser.tsx:213` 存在“同端口 HTTP vs SOCKS5 误报不一致”且点击同步会破坏浏览器 `socks5://` 的 Bug** | **100% 可靠（源码实锤 Bug）**：Mihomo 的 `127.0.0.1:7899` 是 `mixed` 混合端口，伴侣浏览器必须用 `socks5://127.0.0.1:7899`（锁远程 DNS），而 CLI 必须用 `http://127.0.0.1:7899`（防 gRPC/httpx 报错）。原代码使用纯字符串比较 `(draft?.proxy || '').trim() !== state.identity.cli_proxy.trim()`，导致按标准配置后反而报错，且点击“同步 CLI 代理到浏览器”会把浏览器的 `socks5://` 覆盖成 `http://`！ | **已执行落地**（已新增 `areCliAndBrowserProxiesAligned` 与 `toBrowserSocks5ProxyFromCli` 并更新 `src/browser.tsx`） |
| **O4** | **缺少一键复制的 Claude Code CLI 防漏环境变量与关闭非必要遥测的 `settings.json` 片段（含大小写成对变量、Rust 身份保险库 `GRPC_PROXY` 同步及安全合入提示）** | **100% 可靠（Anthropic 官方 `sandbox-runtime` 源码 + 官方文档实锤）**：在 `~/.claude/settings.json` 中统一将 `HTTP_PROXY`/`http_proxy`、`HTTPS_PROXY`/`https_proxy`、`ALL_PROXY`/`all_proxy`、`GRPC_PROXY`/`grpc_proxy` 设为 `http://127.0.0.1:7899`（防 `socks5h` 导致 gRPC 回退直连 DNS，兼顾大小写敏感的 `curl`/`libcurl`/Python/Rust 工具链），开启 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`、`DISABLE_TELEMETRY=1`、`DISABLE_ERROR_REPORTING=1`，并在 Rust 侧 `SETTINGS_IDENTITY_KEYS` 与 `extract_settings_meta` 中同步纳入 `GRPC_PROXY`/`grpc_proxy` 保证多身份切换时完整归档与恢复。 | **已执行落地**（已在风控核验页新增 `查看 CLI 防漏配置 (settings.json)` 预览、合入提示与一键复制，并同步加固 Rust 身份保险库与跨机交接卡） |

### 3. 二次 Review 后主动剔除的低价值/过度设计项（不执行）

| 原编号 | 原拟议内容 | 为什么经 Review 后决定**剔除不执行**？ |
|---|---|---|
| ~~O3~~ | ~~修改 `oauth_route.rs` 扩大拦截 `/login`、`/upgrade`~~ | 1. 您不将 `Claude-Local-Browser` 设为系统默认浏览器，Windows 不会把外部链接路由给 `oauth_route.rs`；<br>2. 二次审计 `src-tauri/src/browser/oauth_route.rs:40-42` 及单测第 232–245 行发现，该模块**故意**只拦截带 PKCE 参数的 `/oauth/authorize` 并显式放行 `/login` 与 `/settings/billing`，以便 Free 养号卡能正常登录和绑卡。修改它会破坏现有养号卡安全边界。 |
| ~~O5~~ | ~~注入 `PreToolUse` Hook 脚本拦截命令~~ | 有了 Mihomo 系统级 `tun.strict-route: true` + STUN UDP 拦截 + 全域名覆写后，子进程网络已在底层收敛，加 Hook 弹窗反而干扰日常编码体验。 |
| ~~O6~~ | ~~在 HUD 浮窗新增额外告警横幅~~ | 伴侣浏览器已有托盘变红与主面板横幅，不增加多余 UI 噪音。 |

## 二、 阅读导航

- [01-FINDINGS.md](01-FINDINGS.md)：Claude Code CLI 调用浏览器与子进程（含 Codex）的完整源码路径、X 社区“Claude 调 Codex 封号”三层真相、4 个开源项目剖析。
- [02-OPTIMIZATION-PLAN.md](02-OPTIMIZATION-PLAN.md)：二次校准后的精简执行记录（O1/O2/O4）与单测验证结果。
