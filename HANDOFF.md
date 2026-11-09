<!--
[INPUT]: Final owner decisions, released v0.3.0 source/tag c784588e206be85d7bcccda4eadec5cebab3e8dc, documentation commit 968c2e0, passing release-source CI (run 42357163813), audited NSIS installer (SHA256 8d2a56c93ebe7a2cf56a886bb00fcf78c4df2e7b46dbc934f7ee5a8b64f3e8d6), verified local payload deployment (host SHA256 cbe79fbde3cffa2544497d3cfc6a7cbfcc436c823094b787ce02edfce5dbb889, missingClaudeCount = 0), and 2026-11-07 root-cause resolution of Gemini 4 Argon subagent slowness (Magpie pace + 68% accountCaps + firstToken failover + native PowerShell 7 pwsh.exe pipeline).
[OUTPUT]: Context-free session handoff: what task we are doing, what is completed, where we are stuck (none), next steps, and verified pitfalls never to repeat.
[POS]: Root maintenance handoff. Real identities, emails, IP/proxy credentials, process IDs, browser seeds, private probe values, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting (backed up to .local/tasks/20261107-release-0.3.0/HANDOFF-pre-session-close-20261107-0431.md.bak, SHA256 98F6A104C6CF92F0591AC4BDA068D8371463E897E98E84D23CF1537C6F01E9FF). This handoff update is documentation-only: no build/deploy, account action, proxy reload, upload or release-tag movement.
-->
# Claude-Local 会话交接（HANDOFF.md）

更新时间：2026-11-07，America/New_York（EST）。

## 接手先读：当前结论（30 秒速览）

1. **`Claude-Local v0.3.0` 产品交付已 100% 完结**：源码补漏、6 大开源项目精髓融合、全量自动化测试、中性环境 NSIS 打包、29 项外置隐私探针审计、本机无感热更新（零中断运行中的 `claude.exe`）与 GitHub Release（Latest）发布均已完成。
2. **本机 `Gemini 4 Argon` 子代理慢速根因排查、Magpie 路由优化与全链路 PowerShell 7 (`pwsh.exe`) 默认化已 100% 完成并实测通过**：
   - 查明此前 `gemini-4-argon` 子代理耗时长达 61 分钟的两大真凶：① Magpie 原路由为空字符串 `""`（`Smart` 策略按最早重置时间钉死单号），导致单个 Google AI Ultra 账号从 `46.3%` 一路跑到 `94.9%`，跨过 Google CloudCode `~70%` 软限流阈值后单轮 TTFT 从 `6.5s~20s` 暴涨至 `163s~417.9s`，而其余满血 Ultra 账号全程闲置；② 子代理在内部连续发起 55 轮零散命令调用，且多次因命令行内联 `python -c "... \"...\" ..."` 引号转义报错重试。
   - 已将 Magpie 路由升级为 **`"routing": "pace"` + `"accountCaps": 68` + `"capCareful": true` + `"sink": true` + `firstToken` 超时熔断（`75s`/`60s`/`30s`）**，并将 Claude Code 子代理、`agy-safe.cmd` / `agy-safe.ps1` 与 Antigravity 权限配置全面切换至 **PowerShell 7 (`pwsh.exe` v7.6.8)** 原生执行。端到端实测含工具调用总耗时降至 **`21.7s`**（Turn 1 TTFT `13.4s`，Turn 2 TTFT `6.3s`）。
3. **接手阅读顺序**：
   - 先读本文、根目录 `AGENTS.md` 与 [`CLAUDE.md`](CLAUDE.md)；
   - 再读 [`docs/RELEASE_VERIFICATION_0.3.0.md`](docs/RELEASE_VERIFICATION_0.3.0.md)、[`docs/RELEASE_NOTES_0.3.0.md`](docs/RELEASE_NOTES_0.3.0.md) 与 `docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/`；
   - 修改任何模块前，先读对应目录的 `CLAUDE.md` 和目标源文件头部的 `[INPUT]/[OUTPUT]/[POS]` 注释。

---

## 1. 我们在做什么任务

### 1.1 项目定位与 `Claude-Local v0.3.0` 研发发布（已圆满收官）
`Claude-Local` 是独立拥有并维护的 Windows 10/11 x64 桌面工作台（主程序 `claude-local.exe`，Bundle ID `ai.local.claude-local`，伴生指纹浏览器注册名 `Claude-Local-Browser`），技术栈为 **Tauri 2 (Rust) + React 19 (TypeScript) + Python 单写者额度账本采集器**。前期已完成 `v0.3.0` 全量功能升级、6 大开源项目源码级机制融合、打包审计、本机无感热更新与 GitHub Release 正式发布。

### 1.2 本次会话核心任务：排查解决 `gemini-4-argon` 子代理慢速问题、完善 Magpie 设置并默认启用 PowerShell 7
1. **只读诊断 `gemini-4-argon` 子代理为什么慢/被什么卡住**：对标 Magpie 路由日志（`routing/2026-11-07.jsonl`）、子代理运行日志与 Antigravity CLI 会话轨迹（`transcript.jsonl`），定位耗时瓶颈。
2. **完善 Magpie 配置**：消除单号钉死与 `>70%` Google 软限流排队，确保多台 Google AI Ultra 账号均衡轮转、Google AI Pro 账号保底兜底，并维持 Claude Code / Codex 账号 100% 零触碰隔离。
3. **默认启用 PowerShell 7 (`pwsh.exe`) 并补齐子代理管线**：让 Claude Code CLI 子代理默认使用原生 `PowerShell` 工具（`pwsh.exe` v7.6.8），消除 Git Bash 引号/反斜杠吞噬、PowerShell 5.1 语法限制及权限拦截，并通过提示词护栏减少子代理无效工具往返。

---

## 2. 已经完成了什么

### 2.1 `Gemini 4 Argon` 子代理慢速根因定位与 Magpie + PowerShell 7 全链路升级（2026-11-07 完成）

1. **查明慢速的两大根本原因（有完整日志证据支撑）**：
   - **根因 A（占耗时 ~70%）：Magpie 默认 `Smart` 路由钉死单号 + Google CloudCode `>70%` 软限流**：
     - Magpie 的 `providers.json` 中 `antigravity`、`argon-high`、`argon-medium` 原 `"routing"` 为空字符串 `""`（即 `Smart` 策略）。`Smart` 策略将所有已用额度 `<90%` 的账号视为同一优先级，严格按**最早重置时间（earliest reset deadline）**排序，导致长达 61 分钟、55 轮工具调用的任务 100% 钉死在同一个 Ultra 账号（从 `46.3%` 耗尽至 `94.9%`），而另外两个满血 Ultra 账号（`3.4%`、`12.0%`）全程 0 请求闲置。
     - 当该账号消耗跨过 **`~70%`** 后，Google CloudCode 上游对 `gemini-4-argon:high` 触发软限流（服务端排队）：前 18 轮（`<70%`）TTFT 仅 `6.5s ~ 20s`，一旦跨过 `70%`，单轮 TTFT 暴涨至 `163s ~ 417.9s`（单轮干等近 7 分钟），甚至触发 `context deadline exceeded` 502 超时。
   - **根因 B（占耗时 ~30%）：55 轮细碎工具往返 + 内联引号转义失败重试**：
     - 子代理未将检查逻辑合并为单次脚本，而是串行发起 55 轮 `run_command` / `read_file`；且多次在命令行内直接拼接 `python -c "... \"...\" ..."`，被外层 Shell 吞掉引号导致 `SyntaxError` 报错重试。

2. **Magpie (`127.0.0.1:3425`) 路由与防软限流配置完善（已备份并热重载验证）**：
   - **`"routing": "pace"`（速率路由）**：在 `antigravity` provider 及 `group/argon-high`、`group/argon-medium`、`group/gemini-3.1-flash-lite-preview` 上统一启用 `"pace"`。Magpie 按「每小时可支配剩余百分比（Remaining % / Hour）」动态排序：3 个 Google AI Ultra 账号（5h 窗口，速率 `~20%/hr ~ 22.2%/hr`）永远排在最前并自动均衡轮转，而 Google AI Pro 账号（7d 窗口，速率 `~0.6%/hr`）自动排在第 4 顺位作为保底（解决了纯 `"usage"` 路由会把 `0.16%` 的 7d Pro 号排在 `3.4%` 的 5h Ultra 号前面的缺陷）。
   - **`"accountCaps": 68` + `"capCareful": true` + `"sink": true`（68% 硬水位切号与无损接力）**：单号消耗达到 **`68%`**（赶在 Google `70%` 软限流前）立即置为 `capped=['antigravity:capped=68%']` 换下休息；即使在多轮长会话中途达到 `68%`，下一轮也会以 `why: "gone"` 自动切到空闲 Ultra 号，配合 `"sink": true` 自动剥离异号 `thoughtSignature` 杜绝 400 签名错误。
   - **`firstToken` 首字超时熔断（`failSlow`）**：为 `argon-high` 设置 `"firstToken": 75`（75 秒未出首字自动切号重试）、`argon-medium` 设置 `"firstToken": 60`、`gemini-3.1-flash-lite-preview` 设置 `"firstToken": 30`，并为 `argon-high` / `argon-medium` 显式声明 `"context": 1048576`。
   - **100% 零触碰隔离**：`providers.json` 顶层开启 `"noAutoGroups": true`；`claude`、`codex`、`zcode` 锁定 `"off": true, "noModels": true, "keepLogin": true`；`logins.json` 仅保留 4 个 `antigravity` 账号 `on: true`。

3. **Claude Code CLI 与 Antigravity 全链路默认启用 PowerShell 7 (`pwsh.exe` v7.6.8)**：
   - **解锁 Claude Code 原生 `PowerShell` 工具**：经逆向核实 `claude.exe` 特性开关，在 `~/.claude/settings.json` 与 `<local-env>/.claude/settings.json` 的 `"env"` 中启用 `"CLAUDE_CODE_USE_POWERSHELL_TOOL": "1"`、`"CLAUDE_CODE_DISABLE_POWERSHELL_CMD_RM_DENY": "1"`、`"CLAUDE_CODE_DISABLE_INLINE_SHELL_RM_PROMPT": "1"`、`"CLAUDE_CODE_PWSH_PARSE_TIMEOUT_MS": "15000"`、`"PYTHONIOENCODING": "utf-8"`、`"PYTHONUTF8": "1"`，并在 `permissions.allow` 中放行 `PowerShell`、`Bash`、`Read`、`Edit`、`Write`、`Glob`、`Grep`、`WebFetch`、`WebSearch`、`NotebookEdit`、`mcp__*`（`defaultMode: "bypassPermissions"`）。
   - **升级 `~/.claude/agents/*.md` 全部 5 个 Argon 子代理定义**（`gemini-4-argon`、`gemini-4-argon-medium`、`gemini-4-argon-high`、`argon-scout`、`argon-reviewer`）：`tools` 声明升级为 `PowerShell, Bash, Read, Grep, Glob`，默认优先使用 `PowerShell` 工具（`pwsh.exe`）配合单引号 Here-String（`@' ... '@`）调用 `agy-safe.cmd`（同时兼容旧会话 `Bash` 回退）。
   - **补齐 Antigravity CLI (`~/.gemini/config/config.json` 与 `<local-env>/.gemini/config/config.json`) 免审白名单**：保持 `CASCADE_COMMANDS_AUTO_EXECUTION_EAGER` + `AGENT_PERMISSION_PRESET_TURBO` + `enableTerminalSandbox: false`，并在 `globalPermissionGrants.allow` 中登记 `command(pwsh)`、`command(python)`、`command(Get-ChildItem)`、`command(Get-Content)`、`command(Select-String)` 等 45 项授权。

4. **`agy-safe.cmd` / `agy-safe.ps1` 包装层升级**：
   - `agy-safe.cmd` 直接以 `pwsh.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass` 启动；
   - `agy-safe.ps1` 新增 `-PromptFile <path>` 文件传参支持，将 PowerShell 7 置于 `$env:PATH` 首位并注入 `$env:SHELL` / `$env:PYTHONUTF8 = "1"`；修复 `agy.exe v1.5.2` 的 `Created conversation <UUID>` 脑目录提取正则（稳定输出 `<!-- AGY-RUN-BRAIN: BRAIN=<UUID> | CLILOG=... -->`）；在 `$QualityGuardrail` 中新增 Rule #6（强制使用 `@' ... '@ | python -` 单引号 Here-String 管道执行脚本，并将探测逻辑合并为 1~3 次综合运行）。

### 2.2 `Claude-Local v0.3.0` 核心功能与正式发布回执（前期已完成）
1. **净室切号与跨号防染色（[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)、[`src-tauri/src/cleaner_identity.rs`](src-tauri/src/cleaner_identity.rs)、[`src-tauri/src/browser/oauth_route.rs`](src-tauri/src/browser/oauth_route.rs)）**：支持 `claude.com/cai/oauth/authorize` 与 `claude.ai/oauth/authorize` 并排除 `platform.claude.com`；`CREDENTIAL_KEYS` 扩至 7 项、`ACCOUNT_KEYS` 扩至 25 项（严格保留 `userID`、`cachedGrowthBookFeatures`、`metricsStatusCacheByPrincipal` 等设备键）；分锁类型僵尸锁回收（60s / 15s）与共享会话 JSONL 跨号染色剥离/孤儿 `tool_use` 自愈。
2. **CLI 遥测护盾、全栈防漏域名锁与 MCP 供应链安全审计（[`src/risk-model.ts`](src/risk-model.ts)、[`src-tauri/src/risk_check.rs`](src-tauri/src/risk_check.rs)、[`src/vps.tsx`](src/vps.tsx)）**：锁定 `datadoghq`、`claude.com`、`growthbook.io`、`claudemcpcontent.com`、`storage.googleapis.com` 等域名；实现 CLI 遥测护盾与 MCP 供应链只读体检。
3. **智能接力 2.0（[`src/smart-relay-model.ts`](src/smart-relay-model.ts)）与实时额度悬浮小窗 2.0（[`src/floating-monitor.tsx`](src/floating-monitor.tsx)）**：融合 `magpie` `WeekLow` 临期周配额抢救与 `claude-swap` 7d 重置前 24h 步速静默窗口；新增动态换号裕度、5h 饥饿态紧急放行、双口径极值防虚标（`4%`~`96%`）、小窗接力胶囊与跨页审计时间线。
4. **测试、打包审计、本机无感热更新与 GitHub Release `v0.3.0`**：
   - `bun test`（183 pass）、`cargo test --manifest-path src-tauri/Cargo.toml --bin claude-local`（315 pass）、Python 合成测试与 GitHub Actions CI（run `#42357163813`）全绿；
   - 安装包 `Claude-Local_0.3.0_x64-setup.exe`（SHA-256 `8d2a56c93ebe7a2cf56a886bb00fcf78c4df2e7b46dbc934f7ee5a8b64f3e8d6`）通过 109 文件白名单与 29 项外置隐私探针审计（0 发现）；
   - 本机 `%LOCALAPPDATA%\Programs\Claude-Local` 已无感热更新至 `0.3.0`（宿主 SHA-256 `cbe79fbde3cffa2544497d3cfc6a7cbfcc436c823094b787ce02edfce5dbb889`，`missingClaudeCount = 0`），[GitHub Release v0.3.0 (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.3.0) 已正式发布。

---

## 3. 当前卡在哪

**当前没有任何技术阻塞、遗留缺陷或未完成任务。**

- `Claude-Local v0.3.0` 代码库、本机桌面端与远端 GitHub Release 完全对齐；
- 本机 Magpie (`127.0.0.1:3425`)、`agy-safe.cmd` / `agy-safe.ps1`、PowerShell 7 (`pwsh.exe` v7.6.8) 子代理链路均已实测验证通过（`AGY_PWSH7_MAGPIE_OK (7.6.8, PYTHONUTF8=1)`，21.7s 完成）；
- 工作区仅保留用户规则要求的 `AGENTS.md`、`HANDOFF.md` 及 Git 忽略的 `.local/` 私有目录。

---

## 4. 下一步计划是什么

新会话接手时无需执行任何收尾动作，直接响应用户的新需求即可：

1. **若用户在重启后的 Claude Code CLI 会话中调用 `gemini-4-argon` / `gemini-4-argon-high` / `gemini-4-argon-medium` 子代理**：
   - 新启动的 Claude Code CLI 会话将自动加载 `"CLAUDE_CODE_USE_POWERSHELL_TOOL": "1"`，子代理可直接调用原生 `PowerShell` 工具运行 `agy-safe.cmd`；
   - 若是在尚未重启的旧 Claude Code CLI 会话中，子代理会自动平滑回退使用 `Bash` 工具调用 `agy-safe.cmd`（而 `agy-safe.cmd` 内部依然强制走 `pwsh.exe` 7.6.8）。
2. **若用户提出 `Claude-Local v0.3.1` / 新功能开发或日常维护**：
   - 先阅读目标模块目录下的 `CLAUDE.md` 与源文件头注释；
   - 遵循增量测试与“绝不中断运行中的 `claude.exe`”原则；
   - 打包与无感热更新可复用 `scripts/build-windows-share.ps1` 与 `.local/tasks/20261107-release-0.3.0/deploy-audited.ps1`。

---

## 5. 有哪些踩过的坑，绝对不要再踩

### 5.1 本机 `Gemini 4 Argon` 子代理、Magpie 路由与 PowerShell 7 协同铁律（必读）
1. **Magpie 路由切勿改回空字符串 `""` (`Smart`) 或纯 `"usage"` (`LeastUsed`)**：
   - `""` (`Smart`) 会按最早重置时间把所有请求钉死在同一个 Ultra 账号直至 90%，一旦跨过 `~70%` 就会触发 Google CloudCode 严重软限流（单轮 TTFT 暴涨至 160s~417s+）；
   - 纯 `"usage"` (`LeastUsed`) 不区分窗口时长，会把已用 `0.16%` 的 7 天窗口 Pro 账号排在已用 `3.4%` 的 5 小时窗口 Ultra 账号前面；
   - **必须保持 `"routing": "pace"` + `"accountCaps": 68` + `"capCareful": true` + `"sink": true` + `firstToken` 超时熔断（`75`/`60`/`30`）**。
2. **Magpie `logins.json` 顶层结构是 JSON 数组 `[...]` 而非字典 `{"accounts": [...]}`**：
   - 用脚本读取或巡检 `logins.json` 时直接遍历顶层数组，且绝不要把 `claude`、`codex`、`plugin:zcode` 账号设为 `on: true`（保持 `antigravity` 专用隔离）。
3. **子代理内部执行 Python 脚本严禁在命令行拼接多层转义双引号**：
   - 在 `agy-highcap.exe` 的 `run_command`（`pwsh`）中，切勿编写单行包含复杂双引号的 `python -c "... \"...\" ..."`；**必须使用 PowerShell 单引号 Here-String 管道（`@' ... '@ | python -`）**，并将零散检查合并为 1~3 次综合脚本运行，避免产生几十轮工具往返。
4. **子代理轮询 `.output` 时不要传 `"timeout": 180000`**：
   - 统一使用不带自定义 `timeout` 参数的 `agy-safe.cmd -WaitOutput "<.output路径>"`（内部单次轮询限时 90s < 默认 120s 工具超时），且跨进程读取热文件必须使用 `FileShare.ReadWrite | FileShare.Delete` 共享流锁。
5. **保持 `~/.claude/settings.json` 的 `"env"` 代理、遥测锁定与 `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` 非空**：
   - 确保 `claude.exe` 派生的所有子进程共享 `http://127.0.0.1:7899` 静态家宽出口，并原生开启 `PowerShell` (`pwsh.exe`) 工具。

### 5.2 `Claude-Local` 研发、测试与打包部署铁律（必读）
1. **严禁中断任何正在运行的 `claude.exe`（Claude Code CLI）进程**：开发、测试与本机桌面端热更新期间，绝不能停止任何 `claude.exe`。
2. **严守 `s13` 设备指纹连续性红线（[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)）**：切勿将 `userID`、`cachedGrowthBookFeatures`、`metricsStatusCacheByPrincipal`、`anonymousId`、`groveConfigCache` 加入 `ACCOUNT_KEYS` 的无条件删除列表。
3. **Rust 单元测试目标为 `--bin claude-local` 而非 `--lib`**：必须使用 `cargo test --manifest-path src-tauri/Cargo.toml --bin claude-local`（共 315 项测试）。
4. **在线唤醒结果契约（[`scripts/claude_quota_online.py`](scripts/claude_quota_online.py)）**：`run_wakeup` 的 `confirmed_5h` 必须要求 `expired_reset_at is not None and reset_5h > expired_reset_at`。
5. **伴生浏览器与持久化格式红线**：绝不将 `Claude-Local-Browser` 设为系统默认浏览器；保持 `BAGAID01`、`.baga`、SQLite `user_version=3`、账号 HMAC 与 `CCBaga` 种子域字符串不变；单账号跨机导入/导出（`.clpack` / `.bagapack`）已永久取消。
6. **Git 与隐私红线**：严禁暂存或提交 `AGENTS.md` 与 `.local/`；严禁在跟踪文件中写入真实账号、邮箱、代理凭据、进程 PID、29 项探针明文或本机个人绝对路径；严禁使用 `git add .`、`git add -A`、`git clean`、`git reset --hard`。

---

## 6. 关键文件与本地证据索引

### 公开文档与核心代码入口
- **发布与核验文档**：[`docs/RELEASE_NOTES_0.3.0.md`](docs/RELEASE_NOTES_0.3.0.md)、[`docs/RELEASE_VERIFICATION_0.3.0.md`](docs/RELEASE_VERIFICATION_0.3.0.md)、[`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md)、[`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md)。
- **`v0.3.0` 完整方案与复审报告**：`docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/`（[`00-README.md`](docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/00-README.md)、[`01-FINDINGS.md`](docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/01-FINDINGS.md)、[`02-IMPLEMENTATION-PLAN.md`](docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/02-IMPLEMENTATION-PLAN.md)、[`03-REVIEW-AND-ROADMAP.md`](docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/03-REVIEW-AND-ROADMAP.md)）。
- **前后端核心模块**：[`src-tauri/src/browser/oauth_route.rs`](src-tauri/src/browser/oauth_route.rs)、[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)、[`src-tauri/src/cleaner_identity.rs`](src-tauri/src/cleaner_identity.rs)、[`src-tauri/src/risk_check.rs`](src-tauri/src/risk_check.rs)、[`src/smart-relay-model.ts`](src/smart-relay-model.ts)、[`src/floating-monitor-model.ts`](src/floating-monitor-model.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)、[`src/identities.tsx`](src/identities.tsx)、[`src/risk-model.ts`](src/risk-model.ts)。

### 本机忽略目录与外部环境配置索引（严禁提交至 Git）
- `.local/artifacts/20261107T085036Z-52584c0173a844248cbdd998aa03cd43/`：`v0.3.0` 安装包 `Claude-Local_0.3.0_x64-setup.exe`、`SHA256SUMS.txt`、`privacy-audit.json`。
- `.local/tasks/20261107-release-0.3.0/`：构建/部署回执（`artifact.json`、`github-release-receipt.json`、`deployment-receipt.json`）及 `HANDOFF.md` 历次 SHA-256 备份（最新备份 `HANDOFF-pre-session-close-20261107-0431.md.bak`）。
- 本机子代理与网关环境（均带有 `*.bak-20261107-0415` 备份）：
  - Magpie 配置目录：`providers.json`（`pace` + `accountCaps: 68` + `firstToken` + `sink`）、`logins.json`、`routing/2026-11-07.jsonl`；
  - 子代理包装器与高容量 CLI：`<local-env>/bin/agy-safe.cmd`、`<local-env>/bin/agy-safe.ps1`、`<local-env>/bin/agy-highcap.exe`（840k 上下文阈值）；
  - Claude Code 与 Antigravity 配置：`~/.claude/settings.json`、`~/.claude/agents/*.md`、`~/.gemini/config/config.json`。
