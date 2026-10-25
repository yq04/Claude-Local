<!--
[INPUT]: Verified 0.3.1 workstation update, NSIS 13-probe privacy audit, GitHub v0.3.1 release publication, and full session optimization history.
[OUTPUT]: Context-free task/status/next-step/pitfalls guide with exact delivery evidence for a brand-new session.
[POS]: Repository root handoff; machine paths, PIDs, credentials and private probes stay in ignored .local/.
[PROTOCOL]: Archive this file and verify SHA256 before rewriting. Documentation-only updates never rebuild or move product tags.
-->
# Claude-Local 会话交接（v0.3.1）

更新日期：2026-10-25。本文件面向完全没有本会话上下文的新会话。先读本文、根目录 `AGENTS.md`、`CLAUDE.md`，修改具体模块前再读相应目录的 `CLAUDE.md` 和源码头部。

**当前事实：本会话已完成 `0.3.1` 版本的全部界面排版美化、Windows 隔离浏览器缓存目录 ACL 自愈修复、用量分析模型家族与推理档位（Effort）分布、切换前额度对比与隔离状态展示、会话接力清空草稿以及全应用实用化文案升级；已通过全量自动化测试、13 项隐私探针审计打包，无感热更新至本机 `D:\1_app\Claude-Local\claude-local.exe`（全程未中断任何正在运行的 `claude.exe`），并已同步提交推送 Git 标签 `v0.3.1` 及上传发布 GitHub Release `v0.3.1`（`Claude-Local_0.3.1_x64-setup.exe`）。当前没有任何技术或发布阻塞。**

---

## 1. 我们在做什么任务

Claude-Local 是本仓库独立维护的 Windows x64 桌面产品，React/TypeScript 提供界面，Tauri/Rust 管理本机能力，Python 采集并写入额度账本。主程序 `claude-local.exe`，标识 `ai.local.claude-local`；伴生浏览器为 Claude-Local Browser。数据按用户保存在 `%APPDATA%/ai.local.claude-local`，普通启动不启动浏览器，只有用户动作或 `--browser` 才启动。

在 `0.3.0` 基线之上，2026-10-25 先后完成了 **前四阶段底层视觉/防封/HUD 升级** 与 **本会话（v0.3.1）针对用户实机截图与使用习惯的 6 项细节打磨、功能增强及打包发布**：

### 1.1 本会话（v0.3.1）完成的 6 项核心任务
1. **图 1 优化（「浏览环境」按钮整合进顶部栏）**：
   - 修改 `src/browser.tsx`、`src/style.css`：移除原本带虚线分隔的独立底部按钮栏，将 **「打开浏览器并实测」**、**「正常退出浏览器」** 与 **「设为默认浏览器」** 直接整合进「启动内置浏览器与 CLI 授权联动」卡片的顶部标题行右侧，下方紧接说明文案与 CLI OAuth 授权提示，消除割裂感。
2. **图 1 优化（「浏览器数据」字体样式统一 + 根治「无法枚举缓存。」）**：
   - 前端排版（`src/browser.tsx`、`src/style.css`）：为清理范围说明（`.browser-scenario-desc`）、缓存异常提示（`.browser-cache-error`）与空状态（`.browser-cache-empty`）补充统一的 `11.5px–12px` 次级字号与 `var(--muted-foreground)` 颜色，消除原先未设类名导致的 `16px` 突兀黑字。
   - 后端 Windows ACL 自愈（`src-tauri/src/identities/private.rs`、`src-tauri/src/browser/profile.rs`）：定位到 Chromium AppContainer 沙箱创建 `Default\Cache` 子目录时会写入沙箱专属 ACL，若父目录 `Default` 缺失继承标记会导致主程序调用 `fs::read_dir` 报 `PermissionDenied`（界面显示「无法枚举缓存。」）。新增 `ensure_owner_dacl(path)`（通过 `GetNamedSecurityInfoW` + `SetEntriesInAclW` + `SetNamedSecurityInfoW` 将当前登录用户的 `SUB_CONTAINERS_AND_OBJECTS_INHERIT` 全权限合并进既有 DACL，保留 Chromium AppContainer SID），并在 `write_json`、`read_cache_dir`（`size`）与 `reset` 中遇到 `PermissionDenied` 时自动修复权限并重试。
3. **图 2 优化（「电脑环境」目标时区与目标语言单行紧凑布局）**：
   - 修改 `src/system.tsx`、`src/style.css`：重构 `.system-inline-controls` 与 `.system-inline-field`，将 **小标题（`目标时区` / `目标语言`）+ `<Select>` 下拉框 + 两个操作按钮（`系统设置`、`应用时区` / `应用语言`）** 放置在单行水平布局内，大幅压缩纵向空间占用。
4. **图 3 优化（「用量分析」模型家族胶囊与推理档位 Effort 分布）**：
   - 针对用户主力使用 `Opus`、少量使用 `Fable` 与 `Sonnet` 且关注不同推理强度（Effort）消耗的真实场景，打通前后端 Effort 统计链路：
     - Rust 后端（`src-tauri/src/identities/usage.rs`、`usage_tests.rs`）：新增 `UsageEffort { effort, totals }` 与 `UsageModel.efforts`；在 `clean_effort(obj, msg)` 中解析 Claude Code JSONL 会话中的 `perTurnEffort` / `effort` 字段；在 `usage.sqlite` 的 `events` 表新增 `effort TEXT NOT NULL DEFAULT ''` 列，并在检测到旧表升级时自动将 `files.guard` 置空以触发历史 JSONL 会话一次性重新扫描回填 `effort`（保留 `files.offset` 与已归属的 `account_key`）。
     - 前端展示（`src/usage-model.ts`、`src/usage-statistics.tsx`、`src/usage-trend.tsx`、`src/usage-statistics.css`）：新增 `detectModelFamily` 识别 `Opus`、`Sonnet`、`Fable`、`Haiku` 家族胶囊标签；在每个模型条目下方渲染 **推理档位（Effort：`max`、`xhigh`、`high`、`medium`、`low`）请求次数、占比进度条与 Token 明细**；在「模型分布」卡片底部新增与左侧「用量趋势」底部对齐的效率汇总栏（**单次请求均值** + **缓存命中率**），彻底解决只有 1–2 个模型时卡片下半部分空旷的问题；「用量趋势」同步增加活跃小时/活跃天数统计，并在柱状图悬停 Tooltip 中显示请求数与输出 Token。
5. **额度显示、账号隔离与会话接力功能增强（参考 `cc-switch`、`claude-swap`、`ccusage`）**：
   - `src/identities.tsx`：在「额度详情」弹窗与「确认切换账号」弹窗中新增 **「账号隔离状态」**（直接展示当前账号独立浏览器配置目录绑定状态与专属代理状态），并在「确认切换账号」弹窗中并排展示 **「当前剩余额度 vs 目标账号额度」**，切换前即可直观对比。
   - `src/task-handoff.tsx`：在「会话接力」面板顶部操作栏新增 **「清空草稿」** 按钮及状态反馈。
6. **全应用文案去浮夸化、实用化**：
   - `src/locales/zh.yaml`、`src/locales/en.yaml`、`scripts/test-local-shell.mjs`：遵循用户“不要用太过高级或啰嗦的话语，尽可能实用”的要求，将侧栏副标题从「本地身份座舱」改为「多账号与环境管理」，将主题/风格名称从「月之亮面 / 月之暗面 / 座舱蓝 / 座舱卡片 / 浅色羊皮纸」改为直观的「浅色 / 深色 / 经典蓝 / 简洁卡片」，并精简防封核验、悬浮监控窗与外观设置说明。

### 1.2 同日早些时候完成的四项底层架构基线（已包含在 `0.3.1` 中）
- **实时额度悬浮监控窗（HUD）**：统一 `340×278`（展开）/ `340×152`（精简）并在 `monitor_window_resize` 中同步锁定 `min_size` / `max_size`，禁用双击最大化，采用 `token-monitor` 风格双列 5h/7d 看板。
- **原生 10/20 项防封环境核验**：内置 `Ping0.cc`、`CheckCC.org`、`BrowserScan`、`IPHey` 核心判据（ASN/ISP 宽带 vs IDC 机房识别、硬件 WebGL、WebRTC 零泄漏、`webdriver` 隐身、语言列表纯净度），主界面满格展示 10 项（`5×2`），隔离浏览器实测页展示 20 项（`5×4`）。
- **单层工作区光学毛玻璃渲染引擎**：仅在 `.workspace` 与 `.app-sidebar` 执行 1 次 `backdrop-filter: blur(...)`，内部卡片采用零模糊半透明抬升层，解耦 `--glass-card-border` 与 `--landing-line`，浅色/深色自适应柔光或暗幕遮罩。
- **身份卡片 `5h`/`7d` 时间规范统一**：到期等待激活时在 5h 进度条右下角显示静态 `<时钟图标> 5h`，具体重置时间统一为 `MM-DD HH:mm`。

---

## 2. 已经完成了什么

### 2.1 `0.3.1` 打包、审计、本机热更新与 GitHub Release 回执（2026-10-25）
- **版本号**：`0.3.1`（已同步 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/CLAUDE.md`、`README.md`、`CLAUDE.md`、`docs/RELEASE_NOTES_0.3.1.md`）。
- **源码提交与标签**：Commit `f11276f`，Tag `v0.3.1`（已推送至 `origin/main` 与 `origin/v0.3.1`，并发布 GitHub Release `https://github.com/yq04/Claude-Local/releases/tag/v0.3.1`）。
- **产物目录**：`.local/artifacts/20261025T151849Z-ee8ffc4e85e046aca90f24f45db8a95b`（状态记录于 `.local/last-local-update.json`）。
- **本机安装路径**：`D:\1_app\Claude-Local\claude-local.exe`（已热更新并验证窗口正常启动，版本号 `0.3.1`）。
- **宿主 `claude-local.exe` SHA256**：`06dfb613b8de7225b6ba1c5eb18f15a926eb94f4fb5bd750ff5011c72ecc8a11`。
- **安装器 `Claude-Local_0.3.1_x64-setup.exe` SHA256**：`0bdcceed1bd2939a6efee50e4044656b31c3b9635947c50db6dd62ed15777f38`。
- **隐私与安全审计**：独立资源审计 109 项、私密探针 13 项，零发现（`findings: 0`）；`--quota-core` 管道冒烟测试 `pass`；更新前后未中断任何正在运行的 `claude.exe`（`missingClaudeCount: 0`）。

### 2.2 已执行的验证
- **前端与双语字典单测**：`bun test` **21 个测试文件、110 项测试（9,630 断言）全部通过**；`bun run build`（`tsc --noEmit && vite build`）零错误通过。
- **Rust 原生测试**：`cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol` **223 项测试全部通过**（含 `model_effort_tiers_are_parsed_and_aggregated_per_model` 与 18 项 `browser::tests`）。
- **Playwright UI 全套回归**：
  - `node scripts/test-local-shell.mjs .local/preview-shell`：通过（含 `180×286` 卡片几何、浅色/深色主题切换、中英切换与交接复制）。
  - `node --experimental-strip-types scripts/test-identities-ui.ts`：**68/68 项断言全部通过**（含额度详情与切换确认弹窗）。
  - `node --experimental-strip-types scripts/test-handoff-ui.ts`：通过。
  - `node scripts/test-usage-statistics.mjs .local/preview-usage`（38/38）、`--layout-only`（96/96）、`--quick-only`（16/16）：全部通过。

---

## 3. 当前卡在哪、遗留什么、工作树状态

**没有任何技术、测试或发布阻塞。`0.3.1` 已完成本机热更新、Git 推送与 GitHub Release 上传。**

新会话需要注意以下工作树保留项：
- 工作树中用户原有的 `AGENTS.md` 修改以及未跟踪的 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/`、`docs/plans/2026-10-22-identity-quota.md`、`p6b-i18n.json`、`TOKEN_MONITOR_RESEARCH_AND_PLAN.md` 均属于故意保留的规划/规则文件，**切勿删除或运行 `git clean` / `git checkout -- .`**。

---

## 4. 下一步计划是什么与代码入口

1. **新会话启动检查**：
   - 先只读查看 `git status --short`、`.local/last-local-update.json` 和用户最新指令。
2. **按用户后续指令行动**：
   - 若用户提出新的界面或功能迭代需求，在当前 `0.3.1` 基线上开发，并通过 `.local/tools/complete-local-update-0.3.1.ps1 -InstallDirectory 'D:\1_app\Claude-Local'`（或创建下一版本脚本）执行审计打包与本机热更新。

核心源码入口：
- `src-tauri/src/identities/usage.rs`、`src/usage-model.ts`、`src/usage-statistics.tsx`、`src/usage-trend.tsx`、`src/usage-statistics.css`：用量分析、SQLite `events.effort` 增量迁移与历史回填、模型家族胶囊及推理档位（Effort）分布。
- `src-tauri/src/identities/private.rs`、`src-tauri/src/browser/profile.rs`、`src/browser.tsx`：隔离浏览器配置目录 Windows DACL 继承修复（`ensure_owner_dacl`）、缓存大小实时枚举与浏览环境紧凑顶栏。
- `src/system.tsx`、`src/vps.tsx`、`src/style.css`：电脑环境单行内联控制条、网络环境 `2×2` 连通性诊断网格与单层工作区光学毛玻璃系统。
- `src/identities.tsx`、`src/identity-quota.ts`、`src/task-handoff.tsx`：身份卡片、切换前额度对比与隔离状态展示、会话接力模板与草稿清空。

常用针对性验证命令：

```powershell
bun test
bun run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol
node scripts/test-local-shell.mjs .local/preview-shell
node --experimental-strip-types scripts/test-identities-ui.ts
node scripts/test-usage-statistics.mjs .local/preview-usage --layout-only
```

---

## 5. 踩过的坑：绝对不要再踩

### 5.1 本会话（v0.3.1）新踩过的关键深坑
1. **Windows 下隔离浏览器缓存报「无法枚举缓存。」（`PermissionDenied`）是 Chromium AppContainer 沙箱改写子目录 ACL 所致，必须保留 `ensure_owner_dacl` 继承权修复。**
   - `private.rs` 的 `lock(path)` 默认创建的是 `NO_INHERITANCE` 的 DACL；当 Chromium 启动并创建 `profile\Default\Cache` 时，Chromium 会给 `Cache` 注入 AppContainer SID，导致如果父目录 `Default` 没有当前用户的 `SUB_CONTAINERS_AND_OBJECTS_INHERIT` 权限，主程序枚举缓存就会被系统拒绝。
   - **铁律**：绝不能在 `Default` 或 `Cache` 上粗暴调用 `private::lock`（会清掉 Chromium 的 AppContainer SID 导致浏览器崩溃），必须使用 `private::ensure_owner_dacl`（将当前用户的继承权限**合并**进既有 DACL）。
2. **`detectModelFamily` 对非特定家族（`other`）的模型必须返回 `label: null`，不要返回 `'Claude'`。**
   - `src/usage-model.ts` 中若给未知 `claude-*` 测试模型返回 `'Claude'` 胶囊标签，既无信息增量，又会在窄窗口测试中挤占模型名空间；仅对明确的 `Opus`、`Sonnet`、`Fable`、`Haiku` 返回胶囊标签。
3. **切勿同时并发启动多个带 Vite Server 的 Playwright 测试脚本（如 `test-identities-ui.ts` 与 `test-usage-statistics.mjs`）。**
   - 多个 Vite 实例同时读写 `node_modules/.vite` 依赖缓存会触发 `Re-optimizing dependencies` 并导致页面在断言中途自动 reload 报错；Playwright 界面测试必须串行执行。
4. **修改 `src/locales/zh.yaml` 中的主题/按钮显示名称时，必须同步检查 `scripts/test-local-shell.mjs` 等 Playwright 脚本中的 `getByRole(..., { name })` 定位器。**
   - 例如将 `"月之暗面"` 的中文译文改为更实用的 `"深色"` 后，`scripts/test-local-shell.mjs` 第 105 行的 `getByRole('radio', { name: '深色', exact: true })` 必须同步更新。

### 5.2 既有工程铁律（持续有效）
5. **自定义壁纸毛玻璃切忌「双重 `backdrop-filter`」或「全透明 `.workspace` + 独立模糊 `.card`（百叶窗效应）」。**
   - 只在 `.workspace` 和 `.app-sidebar` 上做 **1 次** 全局 `backdrop-filter: blur(var(--glass-blur))`；内部所有 `.card` 必须设置 `backdrop-filter: none !important`。
6. **切勿把全局表格/分割线变量 `--landing-line` 改成高不透明度白色，也切勿在浅色模式下用纯黑遮罩压暗壁纸或给全局文字加 `text-shadow`。**
7. **Cromma UI 组件库自带不透明 `--card` / `--input` / `--segment-thumb` 变量，开启壁纸时必须在 `html[data-has-wallpaper='true']` 下同步覆盖为半透明。**
8. **Tauri v2 悬浮监控窗切换精简/展开高度时，必须在 `monitor_window_resize` 中依次更新 `set_min_size` -> `set_max_size` -> `set_size`，且宽度严格统一为 `340.0`。**
9. **`Claude Code CLI` 报 `Auto mode is unavailable` / `powershell denied by auto mode` 是云端 ATIS 分类器熔断所致，需在 `settings.json` 中保持 `"defaultMode": "bypassPermissions"` 与 `"disableAutoMode": "disable"`。**
10. **主界面环境验证扩展为 10 项（`5×2`）后，前后端与布局测试断言必须同步对齐 `10`。**
11. **Tauri v2 在 Windows (WebView2) 下创建/操控子窗口的命令必须是 `pub async fn`，且必须在 `capabilities/main.json` 注册窗口名 `["main", "monitor"]`。**
12. **`usage_statistics_read` 绝不能与 `identities_read` 共用同一个全局长锁（必须保持独立 `USAGE_LOCK`）。**
13. **静态 `5h` 重置显示（`inferred === true`）绝不能使用 `<time>` 标签，且必须保持 `180×286` 卡片几何。**
14. **双语 YAML 字典与源码 `t('...')` 调用受 `src/i18n.test.ts` 严格门禁保护（中英键集合与插槽必须 100% 一致，`en.yaml` 与 JSX 中严禁混入裸中文字符）。**
15. **部分源码文件（如 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src/locales/*.yaml`、`src/system.tsx`）采用 CRLF 行尾，编辑时注意匹配。**
16. **GitHub Release 保持干净，只上传单个 `Claude-Local_<ver>_x64-setup.exe` 安装包文件。**
17. **不终止 `claude.exe`，不清理共享工作树，敏感探针不入对话或 Git；每次改写 `HANDOFF.md` 前先归档至 `.local/handoff-backups/` 并校验 SHA256。**

---

## 6. 需要历史细节时再读这些文件

- [0.3.1更新说明](docs/RELEASE_NOTES_0.3.1.md)、[0.3.0更新说明](docs/RELEASE_NOTES_0.3.0.md)、[0.2.4更新说明](docs/RELEASE_NOTES_0.2.4.md)、[0.2.3更新说明](docs/RELEASE_NOTES_0.2.3.md)、[0.2.2更新说明](docs/RELEASE_NOTES_0.2.2.md)、[0.2.1额度恢复](docs/QUOTA_RECOVERY_0.2.1.md)：用户可见行为与历次升级原因。
- [0.2.0更新说明](docs/RELEASE_NOTES_0.2.0.md)、[0.2.0交付核验](docs/RELEASE_VERIFICATION_0.2.0.md)：早期功能实施和分发边界。
- [开发说明](docs/DEVELOPMENT.md)、[分发与许可](docs/DISTRIBUTION.md)、`LICENSE`、`NOTICE.md`：独立产品、构建和第三方许可约束。不存在上游同步、自动公开发布或官方更新源。

本次交接整理只修改 `HANDOFF.md` 文档，不重新触发构建或移动产品标签。下一会话可直接基于本文档无缝承接。
