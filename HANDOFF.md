<!--
[INPUT]: 0.1.4 delivery receipts, the merged account-safety/quota/navigation implementation in 037518b, verified CI Run 39647325270, and release assets at v0.1.4.
[OUTPUT]: Standalone session handoff for a context-free new session: mission, delivered 0.1.4 release, verified results, next steps and non-repeatable pitfalls.
[POS]: Repository handoff; machine paths, local test receipts and private tokens stay under ignored .local/.
[PROTOCOL]: Back up to .local/handoff-archive/ before rewriting. Do not clean or rebuild merely to refresh this document.
-->
# Claude-Local 会话交接

更新日期：2026-10-21 约 13:55（本机时区 America/New_York；回执用 UTC）。写给完全没有上文的新会话。

## 0. 三十秒现状

- 产品版本 **0.1.4**，已彻底完成**全链路交付闭环**：
  - 本机已安装软件已平滑无感热替换至 0.1.4（目录 `D:\1_app\Claude-Local`，新进程 PID 79856 正常运行并暴露窗口，3 个运行中的 Claude Code 命令行会话全程未受任何干扰）。
  - 新安装包 `Claude-Local_0.1.4_x64-setup.exe`（133.40 MiB）已生成，并通过 102 个文件的完整解包与隐私白名单审计。
  - GitHub 仓库源码已推送到 `origin/main`（最新提交为 `54c9d40`（功能交付 `50a1157`、TCP连接加固 `037518b`、交接文档 `54c9d40`））。
  - GitHub Actions CI（`checks.yml`，Run `39647325270`）全步骤通过（含 139 个原生测试与所有前端/Python 离线 fixture）。
  - GitHub Release：私有预发布 `https://github.com/yq04/Claude-Local/releases/tag/v0.1.4` 已正式发布（非草稿、预发布，8 个附件校验一致）。
  - **当前没有任何卡点或未完成的交付阻塞。**

## 1. 我们在做什么

Claude-Local 是本仓库独立维护的 Windows x64 桌面产品（Tauri/Rust + React/TypeScript + Python）：本地加密身份备份与切换、额度观察、Token 用量分析、快速配置、电脑环境管理与可选隔离伴生浏览器。主程序 `claude-local.exe`，标识 `ai.local.claude-local`，资料在 `%APPDATA%/ai.local.claude-local`。

本阶段的任务（根据用户原话与授权方案）：
1. **解决切号后已耗尽额度回跳的问题（Q01）**：排查并修复归档创建时间被误当成额度观测时间、导致旧估计覆盖较新真实服务端耗尽状态的根本原因。
2. **优化菜单栏导航顺序（Q03）**：按用户诉求调整左侧导航为“先环境配置后身份管理”流向：快速配置 → 浏览环境 → 电脑环境 → 网络环境 → 身份管理 → 用量分析 → 使用说明 → 软件设置。默认启动首页依然保持身份管理不变。
3. **账号身份卡片与重置权益展示（Q02）**：调研 Claude/OpenAI 重置机制。官方对 Claude 订阅账号未提供常态化的“主动重置次数”，杜绝虚假按钮与本地账本模拟篡改；在卡片中新增“额度详情”弹窗，如实呈现来源、观测时间与“官方未提供主动重置次数”，并提供在当前身份伴生浏览器中打开官方用量页（`https://claude.ai/settings/usage`）的安全直达入口。
4. **设备标识与诊断状态保护（S13）**：收缩账号清理白名单至 8 个核心凭据与必要缓存键，停止重置 `machineID`、`userID`、`anonymousId` 等设备与客户端标识，排除桌面 sentry 与 ant-did 诊断目标；兼容投影层确保旧版 68 键归档仍可完整读取，但不回灌设备标识。
5. **额度采集自检（S14）**：新增 `quota_setup_status` 只读自检命令，可安全探测本机 `.claude/settings.json` 的 statusLine 状态，并在额度详情中给出透明说明与配置指引；不含自动覆写或未验证 Python 执行。
6. **历史会话原样保留与单字符邮箱脱敏修复（S01-S03, S08）**：读路径与备份路径彻底停止自动调用会话 sanitizer；修复短邮箱打码漏洞；伴生浏览器同步原生隐私偏好桥（`ui_privacy_read/write`）；回环服务加强端口 Host、同源 Origin 校验与安全响应头；提供纯本地手写的任务交接模板（`task-handoff.tsx`）。
7. **完整版本交付**：版本号升级为 0.1.4，完成编译构建、隐私审计、本地软件无感替换、提交推送、CI 检验与 GitHub Release 发布。

## 2. 已经完成了什么

### 2.1 0.1.4 源码交付（已提交并推送远程 main）

- **最新提交**：`037518b2611a2430ca04273c5286591054dfdbcb`（父提交 `50a1157` 为全功能交付，`037518b` 为 HTTP/1.1 测试加固），均带 Co-Authored-By。远程 `main` 已同步至 `037518b`。
- **额度时序与模型修复（Rust & Python）**：
  - 核心根因：此前切号保存时以归档时间 `saved_at` 作为账本比较门槛，且 Python 估计计算时间被当成新鲜度来源，导致刚保存的归档（时间晚于 statusLine 耗尽观测）覆盖了最新的 100% 耗尽账本。
  - 修复：Rust `src-tauri/src/identities/profile.rs` 与 Python `scripts/claude_quota.py` 统一对比真实观测时间戳与窗口标识。同窗口旧估计不可覆盖最新服务端锚点。引入 `QuotaEvidence`（`quota_source`: `server_anchor` / `local_estimate` / `unknown`，`quota_observed_at_ms`）；过期或来源未知的窗口保守标为未知且排除推荐，不再虚构满额。
  - 新增包装 `profile::summarize_stage_with_ledger`，Store 与 Catalog 的摘要回填均接入同账号最新账本合并。
- **界面导航流向重排**：
  - `src/main.tsx` 侧栏导航按“快速配置 → 浏览环境 → 电脑环境 → 网络环境 → 身份管理 → 用量分析 → 使用说明 → 软件设置”顺序排布，分割线对应移动至环境区与说明区。
  - `src/navigation.ts` 保持原有 Page 枚举与记忆逻辑，默认首页依然安全回退到身份管理。
- **原生隐私偏好桥与伴生页保护**：
  - 新增 `src-tauri/src/ui_privacy.rs`，以受限私有文件存储布尔偏好，提供 `ui_privacy_read` 与 `ui_privacy_write` 命令。
  - `src/settings-model.ts`：导出 `initializePrivacyPreference` 与 `synchronizePrivacyPreference`，启动时安全默认打码，未配置时平滑迁移旧 local 偏好；修复单字符邮箱（如 `a@example.com` 打码为 `*@example.com`）及显示名称脱敏函数 `maskDisplayName`。
  - `src-tauri/src/browser/server.rs`：加强回环桥校验，强制匹配监听端口的 `Host` 与同源 `Origin`，拦截歧义标头；响应头注入 `no-store`、`no-referrer` 与 `frame-ancestors 'none'`。伴生起始页同步继承主程序隐私打码状态。
- **额度详情与官方用量直达入口**：
  - 身份工牌卡片上的额度堆叠区（`.identity-quota-stack`）支持无缝点击与键盘触发，弹出“额度与重置权益”对话框。
  - 弹窗内如实展示额度来源、观测时间、以及“官方未提供主动重置次数”的权威澄清；杜绝虚假按钮，不改写本地账本。
  - 新增 `browser_open_usage` 命令，复用已运行伴生浏览器的资料目录与安全启动链路，直达 `https://claude.ai/settings/usage`；仅允许当前身份触发，不接收前端任意 URL。
- **设备标识与诊断保护（S13）**：
  - `src-tauri/src/cleaner_config.rs`：`ACCOUNT_KEYS` 严格收缩至 8 个核心账号凭据与必要缓存键；停止重置 `machineID`、`userID`、`anonymousId` 等设备标识；`cleaner_targets.rs` 排除 sentry 与 ant-did 诊断目录。
  - 投影机制 `identity::writable_source`：确保旧版 68 键归档仍可正常读取，但写入工作区时过滤设备和实验态键，防止回灌。
- **额度采集自检（S14）**：
  - 新增 `src-tauri/src/quota_setup.rs`，提供只读命令 `quota_setup_status`，安全探测 `.claude/settings.json` 的 statusLine 配置状态（`not_configured` / `custom_statusline` / `invalid_settings_*`）；不暴露路径或命令，不含未验证的自动覆写。
- **会话历史保护与任务交接模板**：
  - `Store::open` 与单纯保存彻底移除会话 sanitizer，工作区历史 JSONL 不再被静默改写；切换和恢复仅维护受控账号缓存。
  - 新增 `src/task-handoff.tsx`，在使用说明页提供纯本地手写的任务交接骨架（目标、进展、下一步、约束），供换号时复制到新会话，不读取会话文件或凭据。
- **版本元数据与双语字典**：
  - 0.1.4 同步更新于 `package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`。
  - `src/locales/zh.yaml` 与 `en.yaml` 补充全部 35+ 个新增键值对，测试断言双语一致。
  - 新增 `docs/RELEASE_NOTES_0.1.4.md`，文档计划与采纳记录归档至 `docs/plans/2026-10-21-usage-account-safety/`。

### 2.2 本机软件替换与安装包构建（已完成并独立复核）

- **本机已安装软件替换**：
  - 目录：`D:_app\Claude-Local`。
  - 回执：`.local/last-local-update.json`（UTC `2026-10-21T17:34:26Z`，`status=updated`）。
  - 更新并校验 8 个差异文件，新主程序 SHA-256：`4220a596cc8cc615d54a948d49ce1b71fdd5c371b5eed11a9568387a2a03e857`。
  - 启动验证通过：新进程 PID 79856 成功暴露窗口并运行。
  - 3 个运行中的 Claude Code 命令行会话 PID `[21220, 34004, 59976]` 前后完全一致，`missingClaudePids` 为空。
- **正式安装包**：
  - 安装包：`Claude-Local_0.1.4_x64-setup.exe`（133.40 MiB）。
  - 路径：`.local/artifacts/20261021T173426Z-0e7091b6e53c40b9829166f860fb260c/`。
  - 安装包 SHA-256：`cdb24681aadf2859ca35e0aff764abe84970c8cbbe3792aed679da16cafe040b`。
  - 隐私审计报告：`privacy-audit.json`（extracted-payload 模式，13 项私密标记，0 发现，102 个文件）。

### 2.3 验证结果（全绿）

- **前端测试**：`bun test` 38 项全部 pass（新增 identity-quota 测试 2 项、privacy-sync 测试 3 项、settings-model 测试 2 项等）。
- **前端生产构建**：`bun run build` 成功（零错误，生产资源正确输出至 `dist/`）。
- **Python 测试**：`python scripts/test-claude-quota-local.py` 18 项全部 pass（覆盖保存时间门槛、后算旧估计覆盖、回切消费、账号与组织隔离）。
- **静态资源与迁移审计**：`browser_ui.py`、`test-migrate-local-data.py`、`test-fetch-browser.py`、`test-audit-windows-package.py` 全部 pass。
- **GUI 模拟测试**：
  - `node scripts/test-usage-statistics.mjs` 全部 38 项 checks 通过，卡片 180×286 几何与排版无横向溢出。
  - `node scripts/test-local-shell.mjs` 完整壳预览与任务交接复制测试全部通过。
  - `node --experimental-strip-types scripts/test-identities-ui.ts` 62 项身份与网络 UI 模拟测试全部通过。
- **GitHub Actions CI**：
  - Run ID: `39647325270`（commit `037518b`），全部 14 个 steps `success` 绿灯通过（含 139 个原生 Rust 单元测试与端到端 fixture）。
- **GitHub Release**：
  - URL: `https://github.com/yq04/Claude-Local/releases/tag/v0.1.4`。
  - 标签 `v0.1.4` → `037518b`，非草稿、预发布，8 个附件（安装包、校验和、隐私审计、资源清单、更新说明、源码zip、LICENSE、NOTICE）全部下载验证 SHA-256 一致。
  - 回执：`.local/release-0.1.4/published-receipt.json`（`status=updated-and-published`）。

## 3. 当前卡在哪

**没有任何卡点，0.1.4 版本已完整交付闭环。**

- 本机软件、安装包、GitHub 提交推送、Actions CI 与 GitHub Release 已全部完成。
- 工作区内仅保留了未跟踪的产品外设计文档与临时工具数据（`--help/`、`.planning/`、`.rivet/`、`docs/superpowers/`），符合既定规则。

## 4. 下一步计划

1. **安装器真实 Windows 环境验收**：在一次性 Windows 环境（虚拟机、临时机器或托管 runner）实测 0.1.3 → 0.1.4 的 NSIS 升级向导、确认卸载旧版、保留 `%APPDATA%/ai.local.claude-local` 资料及进程占用拦截。
2. **额度采集器打包与受控分发（未来演进）**：若后续决定支持更自动化的一键接入 statusLine，需先解决受控 Python runtime 与 cryptography 依赖在当前用户目录下的安全分发与签名审计，再扩展 `quota_setup` 命令。
3. **开源合规清点**：若后续用户决定将仓库转公开，需按 `docs/plans/2026-10-21-usage-account-safety/REVIEW_AND_ADDENDUM.md` 第七节完成 NOTICE 补充、声明不提供风控/地区规避，并确保 `.local/` 与临时抓取完全不入库。

## 5. 工作区与归属

- `AGENTS.md` 为用户本地规则，**不随版本提交**。
- `HANDOFF.md` 为交接文档，已更新至 0.1.4 状态。
- 未跟踪 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/` 不属于产品，不移动、不删除、不暂存。
- `.local/`、凭据、安装包、回执与机器路径永远不进 Git。

## 6. 踩过的坑，绝对不要再踩

### 6.1 0.1.4 时期新增经验与教训

1. **卡片几何严格约束（180×286）**：工牌卡片宽度为固定的 180px，padding 左右各 10px，内部宽度只有 160px。在卡片内增加交互元素时（如额度详情），**绝对不要在 `.identity-card-head` 挤入任何带边距的 Button**，否则 `scrollWidth` 会超出 180px 导致测试断言失败。直接利用已有 `.identity-quota-stack` 增加点击与键盘响应是最好的方案。
2. **HTTP/1.1 测试中的连接复用（WinError 10054）**：在 Windows 本地写 TCP mock HTTP 服务测试时，如果不输出 `Connection: close
`，客户端（如 reqwest / hyper）会尝试连接复用，而服务端循环结束后关闭 socket 会向客户端发送 RST，在快速并发测试中引发 `ConnectionReset (WinError 10054)`。**所有 mock HTTP 响应必须明确带上 `Connection: close
` 并 `flush()`**。
3. **便携版 7z 工具路径**：本项目打包脚本需要 `7z.exe`。仓库内便携版路径位于 `.local/build-tools/7zip-26.04-f4a03f7e/portable/7z.exe`，打包时直接指定 `-SevenZipPath` 即可，不需要要求宿主系统预装 7-Zip。
4. **Tauri 命令参数反序列化限制**：`#[tauri::command]` 宏对参数有严格的 `Deserialize` / `CommandArg` 约束。不能直接将 `Option<tauri::ipc::Channel<T>>` 作为命令入参（会报 E0277）。必须仿照 `identities_stop` 模式：接收 `webview: tauri::Webview` 与 `on_progress: Option<tauri::ipc::JavaScriptChannelId>`，在函数内部通过 `on_progress.map(|id| id.channel_on(webview))` 转换。
5. **本地隐私默认打码与 GUI 测试模式**：为了安全，新版本在原生未持久化偏好时默认打码（`privacyMask: true`）。已有的针对明文账号/邮箱的 GUI 模拟测试（如 `test-usage-statistics.mjs` 与 `test-identities-ui.ts`）在初始化时，mockIPC 必须显式处理 `ui_privacy_read` 返回 `false` 或注入 `privacyMask: false` 偏好，否则界面因默认打码而无法匹配预期明文。
6. **归档时间与额度观测时间分离**：切号创建新归档的时间是“此时此刻”，绝对不代表账号额度的“观测时间”。必须持久化并传递真实的 `quota_observed_at_ms`，比较额度时只看真实观测时间，不能用 `saved_at` 阻挡较新的服务端状态。

### 6.2 往期长期有效的纪律

7. **不要中断运行中的 `claude.exe`**：本机替换更新只重启 Claude-Local 主程序自身。测试只用虚构 IPC 与隔离环境。Windows 上使用 pwsh 7，严禁使用 5.1。
8. **Vite 预打包缓存过期**：`node_modules/cromma-ui` 是 `file:` 依赖的硬链接副本，增删 vendor 文件后必须 `bun install` 并用 `--force` 启动一次，否则页面空白。
9. **不要自造 Cromma/Radix 已有的组件或行为**：分段用 SegmentedControl，换视图用 Tabs，开关用 Switch，折叠用 Disclosure，动效只取 `MOTION.*`。
10. **格式兼容边界**：`BAGAID01`、`.baga`、SQLite `user_version=3`、账号 HMAC 与旧浏览器种子域保持兼容，绝不破坏。
