<!--
[INPUT]: Final owner decisions, released v0.2.7 source/tag 70f5cc3, documentation HEAD 272715a, passing release-source CI, audited artifacts and verified local payload deployment.
[OUTPUT]: Context-free session handoff: project purpose, completed work, actual blockers, next actions and verified pitfalls; cancelled portability research and default-browser hijacking are not implementation tasks.
[POS]: Root maintenance handoff. Real identities, emails, IP/proxy credentials, process IDs, browser seeds, private probe values, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting. This handoff update is documentation-only: no build/deploy, account action, proxy reload, upload or release-tag movement.
-->
# Claude-Local 会话交接

更新时间：2026-11-03，America/New_York（EST）。

## 接手先读：当前结论

**`v0.2.7` 已完成研发、全套测试、中性 NSIS 打包、29 项外置隐私探针审计、本机无感热更新（零中断 `claude.exe`）以及 GitHub Release（Latest）正式发布；当前没有任何未完成的编码、打包或发布任务。**

- **用户核心红线**：
  1. **绝不将伴生浏览器 `Claude-Local-Browser` 设为 Windows 系统默认浏览器**（用户明确拒绝改变日常默认浏览器使用习惯，且多槽位隔离下设为默认浏览器会导致 CLI OAuth `state` Cookie 失配）。
  2. **绝不中断任何正在运行的 `claude.exe`（Claude Code CLI）进程**。
  3. **单身份跨机导入/导出（`.clpack` / `.bagapack` / `CLPACK01`）已在历史会话被用户明确取消**，不要按旧草案重开开发（既有整库 `.clbackup` 备份与人工复制交接说明保留）。
- **接手阅读顺序**：先读本文、根目录 `AGENTS.md` 和 `CLAUDE.md`，再读 `docs/RELEASE_VERIFICATION_0.2.7.md` 与 `docs/plans/2026-11-03-cli-isolation-and-anti-leak/README.md`。修改任何模块前先读对应目录的 `CLAUDE.md` 和源文件头。

---

## 1. 我们在做什么任务

### 1.1 项目定位
Claude-Local 是基于 CCBaga 二次开发、在本仓库独立维护的 Windows 10/11 x64 桌面工作台（产物 `claude-local.exe`，Bundle ID `ai.local.claude-local`，伴生浏览器注册名 `Claude-Local-Browser`）。技术栈为 Tauri 2 / Rust、React 19 / TypeScript、Python 额度采集与受控备份辅助程序。保留原 MIT 署名和第三方边界，不设上游自动同步或官方应用更新源。

核心能力包括：
- **多身份加密保险库与安全切换**：管理多个 Claude Code CLI 账号（`.baga` 加密归档 + SQLite `user_version=3`）与独立的浏览器 Free 养号卡（`warming_cards`），支持整库口令备份（`.clbackup`）。
- **伴生指纹浏览器与风控核验**：每身份独立 `--user-data-dir` 与 `--fingerprint` 种子、20 项防关联核验、按需启动的伴生浏览器 Kill-Switch（TUN 掉线或出口国家漂移自动断流）、桌面 Clash Verge / Mihomo 一键防漏覆写 YAML、手机 KYC 住宅桥接配置生成。
- **被动额度同步、在线查询与悬浮 HUD**：Python 单写者采集 Claude `statusLine` 额度账本，支持手动/前台定时在线查询与桌面透明额度悬浮窗（HUD）。
- **用量统计与智能接力**：本地 Token、缓存命中率与官方 API 单价折算的美元等效花费统计（非实际订阅扣费），以及默认关闭的本地多账号智能接力建议。

### 1.2 本会话解决的核心任务
用户提出核心疑虑：**日常在 Claude Code CLI 里使用 Claude，它是否会自行调用浏览器或外部软件（例如 X 上有人反映 Claude 调用 Codex 后出现封号）进而造成 IP 泄露？**

围绕该问题，本会话按「深度调研 → 开源方案对标 → 结合用户约束严格 Review → 落地高价值代码改造 → 深度查漏补缺 → `v0.2.7` 热更新与正式发布」完整闭环：
1. **厘清 Claude Code CLI 触发浏览器与外部进程的真实链路**：基于 `anthropics/claude-code`、`openai/codex-plugin-cc`、`anthropic-experimental/sandbox-runtime`、`jev-firewall` 等一手开源实现完成证据链分析。
2. **尊重用户「不改系统默认浏览器」约束，剔除伪优化，仅落地高价值防漏改造（O1–O4 + R1–R4）**：从网络分流规则层、代理协议等价识别层、CLI `settings.json` 全协议环境变量层、以及 Rust 原生身份归档层彻底堵住 CLI 遥测（`datadoghq.com`）与子进程/Codex 出口分裂漏洞。
3. **完成 `v0.2.7` 正式打包、29 项隐私探针审计、本机无感热更新与 GitHub Release Latest 发布**。

---

## 2. 已经完成了什么

### 2.1 Claude Code CLI 泄露面调研与 Review 核心结论
完整报告位于 `docs/plans/2026-11-03-cli-isolation-and-anti-leak/`（含 `README.md`、`01-CLI-LEAK-ANALYSIS.md`、`02-OPEN-SOURCE-REFERENCE.md`、`03-OPTIMIZATION-PLAN.md`）：

1. **CLI 何时调用浏览器（以及为什么绝不能把伴生浏览器设为系统默认）**：
   - 仅在 OAuth 登录/重登、远程 MCP OAuth、`/upgrade`、`/bug` 等显式动作时调用系统默认浏览器；日常代码读写、Bash、Grep、服务端 WebSearch/WebFetch **不会**弹窗。
   - **Review 结论**：不把 `Claude-Local-Browser` 设为系统默认浏览器。一是因为会破坏用户日常办公浏览体验；二是因为 `Claude-Local-Browser` 每个账号槽位使用独立 `--user-data-dir`，Windows 默认浏览器注册表无法感知当前槽位，且 CLI OAuth 回调依赖发起授权的同一浏览器 Profile 中的 `state` Cookie，盲目拦截反而导致 OAuth 失败。日常打开网页直接在 Claude-Local 内点「打开 CLI 浏览器」；CLI 登录时复制终端输出的 URL 粘贴进对应槽位伴生浏览器即可。
2. **CLI 直连遥测泄露点（`datadoghq.com`）**：
   - 官方 `anthropics/claude-code` 的 `devcontainer/init-firewall.sh` 证实，CLI 除连接 `api.anthropic.com` / `claude.ai` 外，还会向 `http-intake.logs.datadoghq.com` 发送遥测日志。若代理规则漏配 `datadoghq.com` 导致直连，服务端日志即可关联真实本地 IP。
3. **X 上「Claude 调用 Codex 后封号」的真实技术原因**：
   - 并非 Anthropic 扫描本地进程名封杀竞品，而是当 Claude Code 通过 Bash 或 `openai/codex-plugin-cc` MCP 调用 `codex` 时：
     - 若代理分流规则只把 `anthropic.com` 指向静态住宅节点，而 `openai.com` / `chatgpt.com` / `auth0.com` 走了直连或机场机房节点，双端风控/日志时间轴与子进程网络行为出现严重割裂；
     - Node.js / undici / Go / Rust / Python / curl / git / gRPC 子进程对环境变量大小写及协议支持不统一（Claude Code 官方明确不支持 `socks5://` 作为 `HTTP_PROXY`，而浏览器推荐 `socks5://`）；
     - 此外 `anthropics/claude-code` Issue #71177 证实 CLI 启动首包存在早于 `~/.claude/settings.json` 读取的代理抢跑窗口，因此代理软件层（Mihomo/Clash 域名强绑 + 严格路由）是必不可少的兜底防线。

### 2.2 已交付在 `v0.2.7` 的代码改动（O1–O4 + R1–R4）

1. **Mihomo/Clash 防漏覆写 YAML 与 AI 修复 Prompt 增补 CLI 遥测与 Codex 同源规则（`src/risk-model.ts`、`src/vps.tsx`）**：
   - 在一键防漏覆写 YAML、单跳/双跳规则模板及 AI 代理修复 Prompt 中新增：
     - `DOMAIN-SUFFIX,datadoghq.com,🏠 静态住宅_出口`（锁死 Claude Code CLI 遥测日志出口）
     - `DOMAIN-SUFFIX,openai.com,🏠 静态住宅_出口`、`chatgpt.com`、`oaistatic.com`、`oaiusercontent.com`、`auth0.com`（锁死 Codex CLI / 插件与 Claude Code 共用同一静态住宅 IP）
2. **同端口 `socks5://`（浏览器）与 `http://`（CLI）双协议等价识别与自动转换（`src/risk-model.ts`、`src/browser.tsx`、`src/identities.tsx`）**：
   - 新增纯函数：`normalizeProxyEndpoint()`、`areCliAndBrowserProxiesAligned()`、`toBrowserSocks5ProxyFromCli()`、`toCliHttpProxy()`。
   - 当浏览器使用 `socks5://127.0.0.1:7899`、CLI 使用 `http://127.0.0.1:7899`（同一 Clash Mixed Port）时，界面准确识别为**已对齐（同端口双协议）**，不再误报警告；点击「同步 CLI 代理」时自动将 CLI 的 `http://` 转换为浏览器所需的 `socks5://`。
   - 身份卡片「复制交接说明」同时输出伴生浏览器 `socks5://` 与 Claude Code CLI `http://` 双协议地址。
3. **CLI `~/.claude/settings.json` 防漏代理片段生成与安全合并提示（`src/risk-model.ts`、`src/risk-verification.tsx`、`src/locales/zh.yaml`、`src/locales/en.yaml`）**：
   - 在「风控与核验 → 环境审计」卡片底部新增 Claude Code CLI `settings.json` 防漏代理配置预览与「复制 CLI 防漏配置」按钮。
   - 自动根据当前代理端口生成涵盖大小写的全套环境变量：`HTTP_PROXY`/`http_proxy`、`HTTPS_PROXY`/`https_proxy`、`ALL_PROXY`/`all_proxy`、`GRPC_PROXY`/`grpc_proxy`、`NO_PROXY`/`no_proxy`（含 `localhost,127.0.0.1,::1,169.254.0.0/16,.local`）。
   - 附带醒目的安全合并提示（`risk.audit.cliSettingsMergeHint`），提醒用户仅将 `"env"` 字段合并进现有 `~/.claude/settings.json`，避免覆盖已有的 `permissions`、`mcpServers` 或 `hooks`。
4. **Rust 原生身份归档与清理白名单补齐 `GRPC_PROXY`（`src-tauri/src/cleaner_identity.rs`、`src-tauri/src/identities/profile.rs`）**：
   - `SETTINGS_IDENTITY_KEYS` 与 `extract_settings_meta()` 纳入 `env.GRPC_PROXY` 与 `env.grpc_proxy`，确保多身份切换与 `.baga` 归档完整保存并恢复 gRPC 代理配置。

### 2.3 `v0.2.7` 验证、打包、审计、热更新与发布回执

- **源码与标签**：
  - 发布源码提交：`70f5cc3cd7173c29cc8f38e7a64281a3e1eebb0f`（标签 `v0.2.7` 固定指向该提交）。
  - 发布核验文档提交：`272715a7d8a63f4a54216e863095a81702cc0904`。
  - 历史标签 `v0.2.6` 仍指向 `8c1935a27ed0512010ebd6d48b005728d412ca7f`，旧资产保持不可变。
- **自动化测试与 CI**：
  - [Windows source checks CI (#41602038305)](https://github.com/yq04/Claude-Local/actions/runs/41602038305)：针对 `70f5cc3cd7173c29cc8f38e7a64281a3e1eebb0f` 执行，全部步骤通过（`conclusion: success`）。
  - 本机测试：`bun test` **174 项单测全部通过**（26 个文件）；`bun run build`（`tsc --noEmit && vite build`）通过；Rust 针对性单测 **19 项通过**（身份 11、HUD 6、本地版 2）；Python 合成测试 **101 项通过**（包审计 9、资源 2、本地额度 34、在线额度 35、浏览器抓取 4、迁移 11、归档 6）。
- **中性 NSIS 构建与 29 项外置隐私探针审计**：
  - 产物目录：`.local/artifacts/20261103T081706Z-d14bce0dd3cd4545938cc39923759302/`
  - 安装包：[Claude-Local_0.2.7_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.2.7/Claude-Local_0.2.7_x64-setup.exe)（`140,856,655` 字节，约 `134.33 MiB`）
  - 安装包 SHA-256：`1ff6e2539e25f7b5095db4d1b9e062fdbfa7738f0fb00e0748c3e45f06fbec27`
  - [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.7/SHA256SUMS.txt) SHA-256：`f84bf4799937c62b9f27aa50746768f54eefe3c3c6693e32284c2a4d04ca1221`
  - 未打包宿主 SHA-256：`73ed31862bebcb36258ad1aa70721ca78d7634c780ea9de06042bfa1e7ba6c00`
  - NSIS 包内宿主 SHA-256：`a2a8a01541df1973ebc01a78b7b0b3d49d0e1b494ac16ff12d8939434cefe86d`（仅差偏移 `13521682` 处 Tauri 唯一 `UNK` → `NSS` 三字节 sentinel 转换）
  - 审计结果：`extracted-payload` 模式只读解包审计 **109 个文件、29 项外置隐私探针、0 项发现（`"result": "pass"`）**。
- **本机无感热更新**：
  - 核对本机安装目录 102 个应用文件，备份并替换 8 个变动文件。
  - 本机安装宿主 SHA-256 为 `a2a8a01541df1973ebc01a78b7b0b3d49d0e1b494ac16ff12d8939434cefe86d`（与 NSIS 包内宿主完全一致，版本 `0.2.7`）。
  - `claude-local.exe` 已在交互式桌面启动并验证 `MainWindowHandle != 0`；更新前后即时快照确认所有运行中的 `claude.exe` 进程 100% 保持原样运行（`missingClaudeCount = 0`）。
- **GitHub Release 发布**：
  - [GitHub Release `v0.2.7` (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.2.7) 于 `2026-11-03T08:37:55Z` 正式发布（`draft: false`, `prerelease: false`），服务端 `digest` 与本地 SHA-256 完全一致。

---

## 3. 当前卡在哪

**当前没有任何阻塞或未完成任务。**

- 源码、测试、中性安装包、本机热更新宿主与 GitHub Release Latest（`v0.2.7`）已完全对齐。
- 本次收尾仅更新 `HANDOFF.md`；新会话开始时可运行 `git status --short` 查看工作区状态。注意工作区中用户本地修改的 `AGENTS.md` 属于用户规则文件，**绝不能暂存、提交、还原或覆盖 `AGENTS.md`**。

---

## 4. 下一步计划是什么

1. **先等待用户的新需求，不要重复打包或重开已取消/已否决的方案**（不要重开单身份 `.bagapack` 跨机导入导出，也不要尝试把 `Claude-Local-Browser` 设为系统默认浏览器）。
2. **若用户询问如何在日常使用中生效本次 `v0.2.7` 防漏能力**：
   - 引导用户在 Claude-Local「风控与核验」页点击「复制防漏覆写配置」，更新到 Clash Verge / Mihomo 全局扩展覆写中（即刻生效 `datadoghq.com` 与 OpenAI Codex 域名族同源静态住宅路由）；
   - 如需加固 Claude Code CLI 子进程环境变量，可在同一页面点击「复制 CLI 防漏配置」，将其中的 `"env"` 键值合并至 `~/.claude/settings.json`。
3. **若后续有新功能或新修复需要发版**：
   - 递增版本号至 `0.2.8`（同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`、`.github/ISSUE_TEMPLATE/bug_report.yml`、`README.md`、`README_EN.md`、`docs/RELEASE_POLICY.md`）；
   - 执行全套测试与 29 项外置隐私探针审计构建，保持 `v0.2.7` 及更早标签/资产不可变。

---

## 5. 有哪些踩过的坑，绝对不要再踩

### 5.1 产品红线与进程/数据安全
- **绝不中断运行中的 `claude.exe`**：热更新或测试只针对精确核实过路径的 `claude-local.exe`，严禁停止或重启用户的 Claude Code CLI 会话。
- **绝不将 `Claude-Local-Browser` 设为系统默认浏览器**：既影响用户日常使用，又会因多槽位 `--user-data-dir` 隔离导致 CLI OAuth `state` Cookie 失配。
- **严守持久格式兼容**：保留 `BAGAID01`、`.baga`、SQLite `user_version=3`、账号 HMAC、历史 `CCBaga/browser` 种子派生域字符串；严禁重新生成已有账号 ID、密钥或浏览器指纹种子。
- **Python 是额度账本唯一写入者**：被动额度采集不写 `.claude.json`、不轮询 OAuth。
- **严禁触碰 `AGENTS.md` 与私有目录**：`AGENTS.md` 不暂存、不提交、不还原；`.local/`、运行时资料、凭据、安装包、数据库和私人回执绝不进 Git。严禁使用 `git add .`、`git add -A`、`git clean`、`git reset --hard` 或全库还原。

### 5.2 工具链、构建、审计与 Windows 桌面会话坑
- **后台工具进程读取交互式 GUI `MainWindowHandle` 的 Window Station 隔离坑**：
  - 在非交互后台工具会话中直接调用 `Get-Process` 检查桌面进程的 `MainWindowHandle` 会始终看到 `0`（因为 Win32 `EnumWindows` 仅枚举调用方所在桌面，无法跨 Window Station 读取 `WinSta0\Default` 的窗口句柄）。
  - **正确做法**：通过临时 `/IT` 交互式计划任务启动 `claude-local.exe` 时，必须在计划任务脚本内部（位于 `WinSta0\Default` 会话中）完成 `MainWindowHandle -ne 0` 轮询校验并把结果写入 JSON 回执文件（参见 `.local/tasks/20261103-release-0.2.7/deploy-audited.ps1` 中的 `Start-InteractiveReleaseHost`）。
- **构建脚本必须显式传入 `-SevenZipPath` 与 `-PrivateMarkerFile`**：
  - 本机便携版 7-Zip 位于 `.local/build-tools/7zip-26.04-f4a03f7e/portable/7z.exe`。
  - 外置 29 项隐私探针文件位于系统临时目录（路径记录在 `.local/tasks/20261103-release-0.2.7/` 脚本中，**绝不可输出或打印探针内容**）。构建后必须核实审计报告中的 `private_marker_count == 29` 且 `findings == []`。
- **注意 `scan-source.py` 的数据结构与白名单检查**：
  - 外置探针 JSON 是包含 29 个键值对的 `dict`（不是 `list`），且 `.local/tasks/20261103-release-0.2.7/scan-source.py` 会比对 `reviewed-files.json` 与 `git diff`/`git ls-files`；新增或修改跟踪文件时需同步更新 `reviewed-files.json` 再执行扫描。
- **Tauri 打包宿主的 `UNK` → `NSS` 三字节差异**：
  - 未打包宿主（`target/release/claude-local.exe`）与 NSIS 包内宿主存在 3 字节 Tauri bundle sentinel 差异（`UNK` → `NSS`）。本机热更新部署必须使用审计解包后的 NSIS 内宿主，以保证本机安装宿主与正式安装包内宿主 SHA-256 100% 一致。
- **测试命令注意事项**：
  - `scripts/test-quota-ledger-integration.py` 需要传入 CLI 参数，不能无参裸跑；日常验证包审计与运行时资源请运行 `python scripts/test-audit-windows-package.py` 与 `python scripts/test-runtime-resources.py`。
  - Cargo 测试或构建务必加 `-j 1`（或设置 `CARGO_BUILD_JOBS=1`）。会修改注册表或系统状态的 Windows 测试只能在临时 CI runner 上跑，严禁在用户机器上执行。

---

## 6. 关键文件与本地证据索引

### 公开文档与核心代码入口
- **发布与核验文档**：`docs/RELEASE_NOTES_0.2.7.md`、`docs/RELEASE_VERIFICATION_0.2.7.md`、`docs/RELEASE_POLICY.md`、`docs/DISTRIBUTION.md`。
- **CLI 防漏调研与优化方案**：`docs/plans/2026-11-03-cli-isolation-and-anti-leak/`（`README.md`、`01-CLI-LEAK-ANALYSIS.md`、`02-OPEN-SOURCE-REFERENCE.md`、`03-OPTIMIZATION-PLAN.md`）。
- **防漏规则、双协议代理对齐与 CLI 配置生成**：`src/risk-model.ts`、`src/risk-verification.tsx`、`src/vps.tsx`、`src/browser.tsx`、`src/identities.tsx`、`src/tests/risk-model.test.ts`。
- **原生身份归档与清理白名单**：`src-tauri/src/cleaner_identity.rs`、`src-tauri/src/identities/profile.rs`、`src-tauri/src/identities/tests.rs`。
- **打包与审计脚本**：`scripts/build-windows-share.ps1`、`scripts/audit-windows-package.py`。

### 本机忽略目录证据（位于 `.local/`，严禁提交或上传）
- `.local/artifacts/20261103T081706Z-d14bce0dd3cd4545938cc39923759302/`：`v0.2.7` 安装包 `Claude-Local_0.2.7_x64-setup.exe`、`SHA256SUMS.txt`、`audit-report.json`、`file-manifest.json`。
- `.local/tasks/20261103-release-0.2.7/`：
  - `artifact.json`：构建与宿主哈希回执；
  - `source-privacy-scan.json` / `scan-source.py` / `reviewed-files.json`：源码 29 项探针扫描记录；
  - `github-release-receipt.json`：GitHub Release `v0.2.7` 与 `v0.2.6` 服务端资产 digest 核验回执；
  - `deploy-audited.ps1` / `deploy-receipt.json` / `deploy-plan.json` / `backup-*`：本机 102 文件核验、8 文件备份替换、交互式桌面启动及 `claude.exe` 零中断快照回执；
  - `HANDOFF.md.bak` / `HANDOFF-pre-closeout.md.bak`：`HANDOFF.md` 重写前备份与 SHA-256 校验记录。
