<!--
[INPUT]: Final owner decisions, released v0.2.7 source/tag 70f5cc3, passing release-source CI, audited artifacts and verified local payload deployment.
[OUTPUT]: Context-free session handoff: project purpose, completed work, actual blockers, next actions and verified pitfalls; cancelled portability research is not an implementation task.
[POS]: Root maintenance handoff. Real identities, emails, IP/proxy credentials, process IDs, browser seeds, private probe values, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting. This handoff update is documentation-only: no build/deploy, account action, proxy reload, upload or release-tag movement.
-->
# Claude-Local 会话交接

更新时间：2026-11-03，America/New_York（EST）。

## 接手先读：当前结论

**v0.2.7 已完成验证、打包、上传、Latest 发布及本机热更新；没有待完成的发布任务。用户明确要求不将 `Claude-Local-Browser` 设为系统默认浏览器（保留日常默认浏览器习惯），单身份跨机导入/导出也已在历史会话取消，不要按已取消方案继续开发。**

先读本文、根目录 `AGENTS.md` 和 `CLAUDE.md`，再读 `docs/RELEASE_VERIFICATION_0.2.7.md`。修改模块前读对应目录的 `CLAUDE.md` 和源文件头。已取消的 `docs/PORTABILITY_PLAN.md` 仅供追溯历史，不是必读实施规格。

## 1. 我们在做什么任务

Claude-Local 是基于 CCBaga 二次开发、在本仓库独立维护的 Windows 10/11 x64 桌面工作台。技术栈为 Tauri 2 / Rust、React 19 / TypeScript、Python 额度采集与受控备份辅助程序。保留原 MIT 署名和第三方边界，不新增上游同步或官方应用更新服务。

主要功能包括：

- 多身份加密保险库、安全切换、独立的浏览器养号卡和整库口令备份。
- 每身份绑定的伴生 Fingerprint Chromium、浏览器/网络环境核验与人工配置指导。
- 被动额度同步、用户触发的在线查询、显式开启的自动续杯和额度 HUD。
- 本地 Token、缓存和官方 API 单价折算的美元等效花费统计，支持 Markdown/TSV 导出。
- 默认关闭的智能接力：本地推荐与手动安全切换，不是 HTTP 反向代理网关，不后台自动偷换凭据。

本会话重点完成：

1. **Claude Code CLI 日常调用浏览器、子进程及 Codex 造成 IP 泄露的深度调研与源码求证**：结合官方 `anthropics/claude-code`、`openai/codex-plugin-cc`、`anthropic-experimental/sandbox-runtime`、`jev-firewall` 等开源实现，厘清 Claude Code CLI 触发浏览器/外部进程与遥测的真实链路（详见 `docs/plans/2026-11-03-cli-isolation-and-anti-leak/`）。
2. **基于「不修改系统默认浏览器」约束的严格 Review 与高价值防漏改造（O1–O4 + R1–R4）**：剔除侵入用户日常习惯或可能引发 OAuth CSRF `state` 失配的方案，落地网络规则层（`datadoghq.com` + OpenAI Codex 同源静态住宅出口锁死）、代理协议等价识别（同端口 `socks5://` vs `http://`）、CLI `settings.json` 防漏片段生成与安全合并提示，以及原生 `GRPC_PROXY` 身份归档闭环。
3. **v0.2.7 正式打包、29 项隐私探针审计、本机无感热更新（零中断 `claude.exe`）与 GitHub Release Latest 发布**。

## 2. 已经完成了什么

### 2.1 Claude Code CLI 防漏调研与 Review 结论

1. **CLI 何时调用系统浏览器**：
   - OAuth 登录/重授权、远程 MCP Server OAuth、`/upgrade`、`/bug` 等场景会调用系统默认浏览器；普通代码读写、Bash、Grep、WebSearch/WebFetch **不会**主动弹窗。
   - **关键约束**：绝不诱导用户将 `Claude-Local-Browser` 设为 Windows 默认浏览器（既干扰日常使用，又会因多槽位 `--user-data-dir` 隔离导致 CLI 本地 callback 端口 `state` Cookie 失配）。正确做法是：日常交互在 Claude-Local 内点击「打开 CLI 浏览器」；CLI 首次/重登 OAuth 使用 URL 复制粘贴到对应槽位伴生浏览器完成。
2. **CLI 自身遥测与子进程 / Codex 协同泄露面**：
   - Claude Code CLI 除连接 `anthropic.com` / `claude.ai` 外，还会直接向 `http-intake.logs.datadoghq.com`（`datadoghq.com`）发送遥测日志；若漏配规则直连，服务端即可关联真实 IP。
   - X 上“Claude 调用 Codex 后封号”的真实技术机理并非 Anthropic 检测競品 CLI 名字，而是 Claude Code 通过 Bash/MCP 调用 `codex` 时，两者分流到了不同出口（例如一方走 TUN/代理、另一方直连或走机房节点），或触发了 `anthropics/claude-code` Issue #71177（启动早期连接抢跑在读取 `~/.claude/settings.json` 代理配置之前）。

### 2.2 已包含在 v0.2.7 的功能（O1–O4 + R1–R4）

- **Mihomo/Clash 防漏覆写 YAML 与 AI 修复 Prompt 增强（`src/risk-model.ts`、`src/vps.tsx`）**：
  - 将 `DOMAIN-SUFFIX,datadoghq.com,🏠 静态住宅_出口`（CLI 直连遥测）与 OpenAI Codex 域名族（`openai.com`、`chatgpt.com`、`oaistatic.com`、`oaiusercontent.com`、`auth0.com`）加入一键防漏覆写 YAML、单跳/双跳规则集及 AI 修复 Prompt，确保 CLI 与子进程共用同一静态住宅出口。
- **双栈代理协议等价识别与自动转换（`src/risk-model.ts`、`src/browser.tsx`、`src/identities.tsx`）**：
  - 新增 `normalizeProxyEndpoint()`、`areCliAndBrowserProxiesAligned()`、`toBrowserSocks5ProxyFromCli()`、`toCliHttpProxy()`。
  - 当伴生浏览器配置 `socks5://127.0.0.1:7899` 而 CLI 配置 `http://127.0.0.1:7899`（同一本地 Clash Mixed Port）时，界面准确识别为「已对齐（同端口双协议）」而非误报不一致；点击「同步 CLI 代理」时自动转换为浏览器所需的 `socks5://127.0.0.1:<port>`。
  - 身份卡片「复制交接说明」同时展示伴生浏览器 `socks5://` 与 Claude Code CLI `http://` 代理端点。
- **CLI `settings.json` 防漏代理片段与安全合并提示（`src/risk-model.ts`、`src/risk-verification.tsx`）**：
  - 在「风控与核验 → 环境审计」卡片新增 Claude Code CLI `~/.claude/settings.json` 防漏代理配置预览与一键复制按钮。
  - 同时生成大写与小写代理环境变量（`HTTP_PROXY`/`http_proxy`、`HTTPS_PROXY`/`https_proxy`、`ALL_PROXY`/`all_proxy`、`GRPC_PROXY`/`grpc_proxy`、`NO_PROXY`/`no_proxy`），覆盖 Node/undici、Python/curl/git/Rust/Go/gRPC 子进程；`NO_PROXY` 包含 `169.254.0.0/16` 与 `.local`。
  - 醒目展示安全合并提示（`risk.audit.cliSettingsMergeHint`），提醒用户仅将 `"env"` 键合并进现有 `~/.claude/settings.json`，切勿直接覆盖已有 `permissions`、`mcpServers` 或 `hooks`。
- **原生身份归档补齐 `GRPC_PROXY`（`src-tauri/src/cleaner_identity.rs`、`src-tauri/src/identities/profile.rs`）**：
  - `SETTINGS_IDENTITY_KEYS` 与 `extract_settings_meta()` 纳入 `env.GRPC_PROXY` 与 `env.grpc_proxy`，确保多身份切换与 `.baga` 归档完整保存并恢复 gRPC 代理环境。

### 2.3 发布、校验与本机更新的确切证据

- 正式版：[v0.2.7 Release](https://github.com/yq04/Claude-Local/releases/tag/v0.2.7)，2026-11-03T08:37:55Z 发布，Latest、非草稿、非预发布。
- 源码标签：`v0.2.7` → `70f5cc3cd7173c29cc8f38e7a64281a3e1eebb0f`。
- [安装包](https://github.com/yq04/Claude-Local/releases/download/v0.2.7/Claude-Local_0.2.7_x64-setup.exe)：`140,856,655` 字节（约 `134.33 MiB`）。
- 安装包 SHA-256：`1ff6e2539e25f7b5095db4d1b9e062fdbfa7738f0fb00e0748c3e45f06fbec27`；[SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.7/SHA256SUMS.txt)（服务端 digest `sha256:f84bf4799937c62b9f27aa50746768f54eefe3c3c6693e32284c2a4d04ca1221`）。两项资产的 GitHub 服务端 digest 均已核对一致。
- [发布源码 Windows CI](https://github.com/yq04/Claude-Local/actions/runs/41602038305)：精确匹配 `70f5cc3cd7173c29cc8f38e7a64281a3e1eebb0f`，全部步骤通过。
- 本机验证：TypeScript + Vite 构建；174 项 Bun 单测（26 文件）；19 项针对性 Rust（身份 11、HUD 6、本地版 2）；101 项合成 Python（包审计 9、资源 2、本地额度 34、在线额度 35、浏览器抓取 4、迁移 11、归档 6），均通过。
- 中性 Cargo home/target、固定引擎、单作业构建、`custom-protocol`；NSIS 只读解包审计 109 个文件，明确启用 29 项外置隐私探针，0 项发现。
- 本机部署核对 102 个应用文件、8 个变动项；已有目标在替换前备份并核对哈希。
- **安装宿主与包内宿主完全一致**：`a2a8a01541df1973ebc01a78b7b0b3d49d0e1b494ac16ff12d8939434cefe86d`。0.2.7 已在交互式桌面启动并验证主窗口句柄非零。
- 工作区未打包宿主：`73ed31862bebcb36258ad1aa70721ca78d7634c780ea9de06042bfa1e7ba6c00`。审计确认与包内宿主仅差偏移 `13521682` 处 Tauri 唯一 bundle sentinel 的 `UNK` → `NSS` 三字节变换。
- 本机更新前后的即时快照确认当时运行的 CLI 进程身份一致（`missingClaudeCount = 0`），没有向 `claude.exe` 发出停止操作。
- `v0.2.6` 仍指向 `8c1935a27ed0512010ebd6d48b005728d412ca7f`，旧资产不变；旧安装包 SHA-256 仍为 `75ff03b772919c0968b6d466d484dc3e3020e7ce1f43f63d3462fedcebfb78ae`。

公开记录：`docs/RELEASE_NOTES_0.2.7.md`、`docs/RELEASE_VERIFICATION_0.2.7.md`。完整本机回执见第 6 节。真实 NSIS 安装/卸载生命周期没有在用户机器执行，文件更新不能冒充安装器生命周期验收。

## 3. 当前卡在哪

**当前没有发布、构建、上传或本机更新阻塞。** 本机与线上安装包已对齐至 `v0.2.7`，不需要再次完成相同任务。

未提交工作区仅保留用户本地的 `AGENTS.md`（切勿暂存、还原或覆盖 `AGENTS.md`）。

## 4. 下一步计划是什么

1. **先等用户的新任务，不重开已取消的迁移工程或默认浏览器劫持方案，也不重复打包。**
2. 如用户希望将防漏规则应用到当前运行的 Clash Verge / Mihomo：用户可在 Claude-Local「风控与核验」页一键复制更新后的防漏覆写 YAML（已含 `datadoghq.com` 与 OpenAI Codex 域名族），并在需要时将 CLI `settings.json` 防漏片段中的 `"env"` 合并至 `~/.claude/settings.json`。
3. 若后续产生新代码版本，使用新补丁号（如 `0.2.8`）和新资产，执行适当验证及 29 项外置隐私探针审计；保留既有发布标签与资产不可变。

## 5. 踩过的坑，绝对不要再踩

### 5.1 权限、进程、数据与工具

- 绝不中断运行中的 `claude.exe`。更新主程序只针对核实过路径、名称和启动时间的 `claude-local.exe`；不能把 GUI 更新授权扩大为真实账号删除/切换授权。
- 绝不引导或自动将 `Claude-Local-Browser` 设为系统默认浏览器。
- 保留既有保险库、浏览器资料和持久格式：`BAGAID01`、`.baga`、SQLite `user_version=3`、账号 HMAC、历史种子派生域字符串。不得重生已有密钥、ID 或种子。
- Python 是额度账本唯一写入者；被动额度采集不写 `.claude.json`、不轮询 OAuth、不擅自刷新授权。
- `AGENTS.md` 不提交、不还原；`.local/`、运行时资料、凭据、安装包、数据库和私人回执不进 Git。不要使用 `git add .` / `git add -A`、stash/reset/clean/全库还原来清场。
- Cargo 用 `-j 1` 或进程级 `CARGO_BUILD_JOBS=1`。会修改系统的 Windows 测试只在临时 CI runner 执行，不能在用户机器运行。

### 5.2 发布和回执

- 必须分别核对未打包宿主、NSIS 包内宿主、本机安装宿主及 GitHub 服务端安装包 digest。
- Tauri 打包会进行 `UNK` → `NSS` 三字节 sentinel 变换，原始宿主与打包宿主哈希不同有明确限定；本机热更新应部署审计解包后的 NSIS 内宿主以保持三方一致。
- 构建脚本的隐私探针是可选参数，必须传入外置探针文件并核验实际 `private_marker_count == 29`。探针值必须外置且不能输出或上传。
- 在后台非交互工具进程中调用 `Get-Process` 读取交互桌面进程的 `MainWindowHandle` 会因跨 Window Station（`EnumWindows` 桌面隔离）看到 `0`；必须在交互式计划任务脚本内部（`WinSta0\Default`）完成启动与 `MainWindowHandle -ne 0` 校验并写回回执文件。

## 6. 关键文件与本地证据索引

公开文档与实现入口：

- `docs/RELEASE_NOTES_0.2.7.md`、`docs/RELEASE_VERIFICATION_0.2.7.md`、`docs/RELEASE_NOTES_0.2.6.md`、`docs/RELEASE_VERIFICATION_0.2.6.md`、`docs/RELEASE_POLICY.md`、`docs/DISTRIBUTION.md`。
- `docs/plans/2026-11-03-cli-isolation-and-anti-leak/`：CLI 防漏与子进程/Codex 同源路由调研、开源项目对比与优化方案（`README.md`、`01-CLI-LEAK-ANALYSIS.md`、`02-OPEN-SOURCE-REFERENCE.md`、`03-OPTIMIZATION-PLAN.md`）。
- `src/risk-model.ts`、`src/risk-verification.tsx`、`src/vps.tsx`、`src/browser.tsx`、`src/identities.tsx`：防漏覆写 YAML、双协议代理对齐、CLI `settings.json` 防漏片段与交接说明。
- `src-tauri/src/cleaner_identity.rs`、`src-tauri/src/identities/profile.rs`：原生身份归档与清理白名单（含 `GRPC_PROXY`）。
- `scripts/build-windows-share.ps1`、`scripts/audit-windows-package.py`：正式打包与资源/隐私边界。

本机证据全部位于忽略目录，**不要提交、上传或把其中个人绝对路径抄入文档**：

- `.local/artifacts/20261103T081706Z-d14bce0dd3cd4545938cc39923759302/`：本次 `v0.2.7` 安装包、校验文件及两个审计清单。
- `.local/tasks/20261103-release-0.2.7/`：`artifact.json`、源码隐私扫描脚本、GitHub Release 服务端回执（`github-release-receipt.json`）、本地热更新脚本（`deploy-audited.ps1`）、备份与部署回执（`deploy-receipt.json`）及 `HANDOFF.md.bak` 校验记录。
