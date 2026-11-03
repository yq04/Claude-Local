<!--
[INPUT]: 01-FINDINGS.md 调研结论、二次严格 Review 筛选结果（保留高价值 O1/O2/O4，剔除过度设计 O3/O5/O6）。
[OUTPUT]: 已落地的代码改动清单、核心函数实现与自动化测试验证记录。
[POS]: 实施方案与落地验证文档。
[PROTOCOL]: 严守 AGENTS.md 红线：绝不中断运行中的 claude.exe、绝不要求修改系统默认浏览器、保持零后续阻断。
-->
# 优化实施方案与执行记录（二次 Review 精简版）

## 一、 Review 筛选结论：只做真正高价值、100% 经过源码与官方文档验证的改进

经过二次源码级 Review，我们遵循**“不把 `Claude-Local-Browser` 设为默认浏览器、不干扰日常使用、只修真实漏点与真实 Bug”**的原则，执行了以下 3 项高价值改动，并砍掉了 3 项不必要或有副作用的提议：

### 已执行的 3 项核心改进
1. **O1（补齐 Mihomo 防漏规则与 AI 提示词缺失域名）**：
   - **发现校准**：既存の `DOMAIN-SUFFIX,anthropic.com`、`DOMAIN-SUFFIX,claude.com`、`DOMAIN-SUFFIX,claudeusercontent.com` 已经自动覆盖了 `mcp-proxy.anthropic.com`、`assets-proxy.anthropic.com`、`sso.claude.com` 和 `bridge.claudeusercontent.com`。真正遗漏的是 Claude Code 官方文档中唯一直连的第三方遥测域名 **`datadoghq.com`**（`http-intake.logs.us5.datadoghq.com`、`browser-intake-us5-datadoghq.com`），以及在 Claude Code 中协同调用 Codex 时的 OpenAI 域名组（**`openai.com`、`chatgpt.com`、`oaistatic.com`、`oaiusercontent.com`、`auth0.com`**）。
   - **改动文件**：
     - [`src/risk-model.ts`](../../src/risk-model.ts)：在 `buildDesktopDnsFixPrompt()`（中英文）与 `buildDesktopMihomoAntiLeakYaml()` 中补齐 `datadoghq.com` 及 `openai.com`、`chatgpt.com`、`oaistatic.com`、`oaiusercontent.com`、`auth0.com`。
     - [`src/vps.tsx`](../../src/vps.tsx)：在 `buildAiProxyPrompt()`（中英文）中同步补齐上述域名。

2. **O2（修复 `src/browser.tsx` 中 CLI 与伴侣浏览器同端口双协议误报及覆盖 Bug）**：
   - **问题根因**：Mihomo 独立家宽监听端口 `127.0.0.1:7899` 是 `type: mixed`（同时支持 HTTP 与 SOCKS5）。伴侣浏览器必须使用 `socks5://127.0.0.1:7899` 以激活远程 DNS 锁（`MAP * ~NOTFOUND`），而 Claude Code CLI 必须使用 `http://127.0.0.1:7899`（防止 gRPC/httpx 子进程因 `socks5` 报错或回退直连 DNS）。但原 `src/browser.tsx:213` 使用纯字符串比对 `(draft?.proxy || '').trim() !== state.identity.cli_proxy.trim()`，不仅将 `socks5://127.0.0.1:7899` 与 `http://127.0.0.1:7899` 误判为不一致，且用户点击“同步 CLI 代理到浏览器”还会把浏览器的 `socks5://` 错误覆盖为 `http://`。
   - **改动文件**：
     - [`src/risk-model.ts`](../../src/risk-model.ts)：新增 `normalizeProxyEndpoint()`、`areCliAndBrowserProxiesAligned()`（识别同一 `host:port` 下浏览器 `socks5://` 与 CLI `http://` 为已对齐）与 `toBrowserSocks5ProxyFromCli()`（当端口确实不同需要同步时，自动转换为 `socks5://host:port` 保护浏览器的 SOCKS5 协议头）。
     - [`src/browser.tsx`](../../src/browser.tsx)：接入 `areCliAndBrowserProxiesAligned()` 与 `toBrowserSocks5ProxyFromCli()`。

3. **O4（风控核验页新增一键复制的 Claude Code CLI 防漏与关闭遥测配置片段，及三次查漏补缺加固 R1–R4）**：
   - **设计要点**：借鉴 Anthropic 官方 `sandbox-runtime` 的 `generateProxyEnvVars()` 规范，在 [`src/risk-model.ts`](../../src/risk-model.ts) 中新增 `buildClaudeCliAntiLeakSettingsJson(port)`，生成可直接合入 `~/.claude/settings.json` 的 `env` 配置：
     - **R1（大小写成对变量 + 环回白名单补齐 + 安全合入提示）**：同时写入大写与小写代理变量（`HTTP_PROXY`/`http_proxy`、`HTTPS_PROXY`/`https_proxy`、`ALL_PROXY`/`all_proxy`、`GRPC_PROXY`/`grpc_proxy`、`NO_PROXY`/`no_proxy`，其中 `NO_PROXY` 补齐 `.local` 与 `169.254.0.0/16`），防止 `curl`/`libcurl`/Python/Go/Rust 子进程因只读小写环境变量而漏出；同时在预览框顶部增加双语提示（`risk.audit.cliSettingsMergeHint`），提醒用户将 `env` 块合入 `~/.claude/settings.json` 并保留原有的 `statusLine`（被动额度采集钩子）与 `permissions`。
     - **R2（Rust 身份保险库 `SETTINGS_IDENTITY_KEYS` 与 `extract_settings_meta` 补齐 `GRPC_PROXY`）**：在 [`src-tauri/src/cleaner_identity.rs`](../../src-tauri/src/cleaner_identity.rs) 的 `SETTINGS_IDENTITY_KEYS` 中补入 `"env.GRPC_PROXY"` 与 `"env.grpc_proxy"`，并在 [`src-tauri/src/identities/profile.rs`](../../src-tauri/src/identities/profile.rs) 的 `extract_settings_meta()` 中同步识别 `GRPC_PROXY`/`grpc_proxy`，确保多身份切换归档（`.baga`）时 `GRPC_PROXY` 不会脱离 `HTTP_PROXY` 成为孤儿残留（100% 向后兼容已有 `.baga` 归档）。
     - **R3（跨机防关联环境交接卡双协议明确标识）**：在 [`src/identities.tsx`](../../src/identities.tsx) 的 `copyIdentityHandoffSpec()` 中使用 `toBrowserSocks5ProxyFromCli()` 与 `toCliHttpProxy()`，同时输出 `浏览器 socks5://127.0.0.1:7899 · CLI http://127.0.0.1:7899`，防止跨机迁移时把 `socks5://` 误填进 CLI 或把 `http://` 误填进伴侣浏览器。
     - 显式设置 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1"`、`DISABLE_TELEMETRY: "1"`、`DISABLE_ERROR_REPORTING: "1"`，从源头关闭 CLI 非必要后台遥测外发。
   - **改动文件**：
     - [`src/risk-verification.tsx`](../../src/risk-verification.tsx)：在电脑端防漏工具栏新增【查看 CLI 防漏配置 (settings.json)】预览、合入安全提示与【复制 CLI 配置 (.json)】按钮。
     - [`src/identities.tsx`](../../src/identities.tsx)：跨机防关联环境交接卡双协议分轨显示。
     - [`src-tauri/src/cleaner_identity.rs`](../../src-tauri/src/cleaner_identity.rs)、[`src-tauri/src/identities/profile.rs`](../../src-tauri/src/identities/profile.rs)：补齐 `env.GRPC_PROXY` / `env.grpc_proxy` 身份级归档与解析支持。
     - [`src/locales/zh.yaml`](../../src/locales/zh.yaml) / [`src/locales/en.yaml`](../../src/locales/en.yaml)：新增双语词条。

---

## 二、 自动化测试验证结果

1. **`bun test` 全量测试通过**：
   - 26 个测试文件、**174 项测试用例全部通过（0 失败，13,799 次断言）**。
   - 新增单测 `CLI and Companion Browser dual-protocol proxy alignment recognizes same mixed port and preserves socks5:// on sync` 验证了双协议同端口对等判定、`socks5://` 同步保护、Mihomo 覆写 YAML 新域名覆盖以及 CLI `settings.json` 片段生成。
   - `src/i18n.test.ts` 验证了中英文 YAML 词条键值、插槽与纯英文字符约束 100% 匹配。
2. **`bun run build` 生产构建通过**：
   - `tsc --noEmit` 与 `vite build` 零错误完成。
