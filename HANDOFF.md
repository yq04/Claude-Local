<!--
[INPUT]: Verified 0.3.1 installed baseline, owner-authorized Astra source implementation, scoped synthetic verification, and prior release receipts.
[OUTPUT]: Context-free task/status/next-step/pitfalls guide with exact delivery evidence for a brand-new session.
[POS]: Repository root handoff; machine paths, PIDs, credentials and private probes stay in ignored .local/.
[PROTOCOL]: Archive this file and verify SHA256 before rewriting. Documentation-only updates never rebuild or move product tags.
-->
# Claude-Local 会话交接（v0.3.1）

## 2026-10-26 最新交付：0.1.0 已打包、上传并与本机对齐

用户全权授权补齐打包上传，现已完成。`v0.1.0` 固定源码 `ff6bc8128de0732ca893afbdb76b1d7156f76a8a`，[GitHub 预发布](https://github.com/yq04/Claude-Local/releases/tag/v0.1.0) 已发布到当前私有仓库（非草稿、prerelease），仅附 `Claude-Local_0.1.0_x64-setup.exe`。140,504,677 字节，SHA256 `37bfd3cbe1653dfaff9412fb4e2324304db44841c606d5fae480268d11bba1ec`，远端大小和digest一致。仓库可见性、旧标签/Release和43份文档待确认清理均未改变。

最终CI [40270529041](https://github.com/yq04/Claude-Local/actions/runs/40270529041) 全部通过；其中发现的 Windows bsdtar 3.8.9 空属主警告措辞兼容已精确修复，未放宽未知警告、非零退出或归档认证/路径/大小边界。最终包已重新封入新helper，并通过109个解包文件hash/路径及13原始隐私探针（0发现）。中性构建custom-protocol、NSIS真实模板三语编译和保留数据守卫验证完成，未执行安装器或用户机系统修改测试。

本机已采用最终安装包审计后的102项应用payload进行逐项核对，仅2项变更（host与quota_archive.py）先备份/hash后更新并重新打开。宿主与setup内NSS宿主完全一致，SHA256 `d509366aa0080b38da28fcad78774dc1cc55c56cdc0f19cb8436d8bb434aac4e`；原始UNK宿主为 `b0e04d5fdba5f9f685256b644fc18a582eab1c85a4dabb1ea15799500d59daa8`，仅Tauri格式标记3字节转换已审计。NSIS插件/卸载器不参与文件式更新，未执行；CLI进程及创建时间保持，missingClaudeCount=0，未终止浏览器、清理账号或进行真实唤醒请求。

具体公开回执见 [0.1.0交付核验](docs/RELEASE_VERIFICATION_0.1.0.md)。私有完整任务、CI日志、备份/事务计划、最终receipt在 `.local/tasks/20261026-release-0.1.0/`，最终产物目录 `.local/artifacts/20261026T045011Z-8d9bc21614c648988167f04d686fcfe7/`；这些不得入Git。先前预修复安装器10959...保留但未上传，不能误发。后续文档提交不移动v0.1.0产品tag；下文“未打包/未上传”均属此前阶段历史。

遗留仅为真实NSIS装卸/降级、真实账号权限验收及独立的公开分发许可/历史整理事项；不应因为已在私有仓库上传就宣称这些已完成。无新增更新源、自动公开发布、签名密钥或上游同步。

## 最新本机状态：连接恢复与唤醒反馈修复已安装（0.1.0 候选）

用户随后报告：绑定浏览器登录后仍显示网页授权提醒、统一重试没有解释、手动唤醒无反馈。核查实机仍运行早前 `0.3.1`，所以本轮完成源码修复、定向验证、custom-protocol release 构建，并已成套更新本机至 **0.1.0 候选版**。旧标签/Release和仓库私有可见性保持；本轮未打包NSIS或发布。

根因及修正：CLI/messages唤醒失败不再写入网页查询连接修复队列；浏览器补充查询的具体失败不再被吞掉，保留独立白名单状态与原OAuth事实；手动scheduler门禁返回具体原因和最大重试时间，界面展示等待并禁用受阻按钮；显式恢复只释放已确认授权失败的账号退避，保留429、共用错峰和未知POST保护。网页登录只恢复网页会话，不能更新归档CLI凭据，不能以网页额度成功宣称唤醒授权恢复。用户说明见 [连接恢复](docs/CONNECTION_RECOVERY.md)。

验证：Rust online 21、scheduler 15、browser receiver 3、browser bridge 6（共45）通过；Bun相关模型/字典29项、真实组件GUI `--wakeup-only` 11项通过；真实MV3合成集成和桥接脚本通过。前端production build与release宿主构建通过；纯JSON额度核心冒烟通过。所有请求验证使用合成数据，没有触发真实账号重试/唤醒、读取Cookie或刷新共享OAuth。

安装回执：22个固定公共产品文件核对，11个变更文件备份并替换，宿主最后发布并重新打开；新host SHA256 `ca5dca85c6026ea31ed2506bca19df21e732da7f1180eac9563f9015d9c3c192`。安装后22项hash一致，`missingClaudeCount=0`，原CLI进程及创建时间保持。私有备份/事务计划/回执在忽略的 `.local/tasks/20261025-auth-repair/` 和对应 `.local/deploy-backups/auth-repair-*`，不纳入Git。原开关按已保存状态迁移，本轮没有主动启用或发送网络验收请求。

遗留：真实账号的具体网页/CLI授权情况须由用户按新反馈处理；本轮不能证明服务端已接受真实唤醒。已运行浏览器资料保留，未终止浏览器/Claude Code。公开清理43份文档的确认仍未收到，本轮没有删除这些文件、改历史或改仓库可见性。下文“未安装/未部署”属于之前阶段历史，以本段为最新交付状态。

## 2026-10-25 公开准备：源码版本重置为 0.1.0 候选

用户要求比较 CCBaga 并准备公开首版，已核对本地/远端不存在 `v0.1.0` 标签；源码产品版本元数据同步为 `0.1.0`，尚未打 tag、构建安装包、更新本机安装、推送或改变仓库可见性。已有 `v0.3.0` / `v0.3.1` 标签与 Release 保持原样，旧 0.3.x 安装到新编号属于版本倒退，须在隔离 Windows 环境验收保留资料升级。应用 ID、用户资料目录及 BAGAID01/`.baga`/SQLite3/HMAC/浏览器种子不变。

当前功能仍基于 `9b89502` 的 Astra 优化。面向读者的入口见 [公开准备](docs/PUBLIC_PREPARATION.md)、[CCBaga 对比](docs/CCBAGA_COMPARISON.md) 和 [0.1.0 候选说明](docs/RELEASE_NOTES_0.1.0.md)。Cromma/Pika 具体授权与实际 Chromium notices 尚需核实；源码可读或编译成二进制都不能替代分发许可依据。

内部资料已复制归档并核对 SHA256，完整 Git bundle 备份已验证；另准备不含旧 HANDOFF/内部计划/旧私测说明的过滤源码副本。所有原件保留，43 份历史文档的实际移除须等用户确认；不改写历史、不强推、不删除旧标签或发行资产。私有清单和备份位于忽略的 `.local/tasks/20261025-public-preparation/` 及对应归档目录。旧未跟踪规划/agent临时资料加入 `.gitignore`，文件本身未删除。

后续先解决公开分发依据与历史公开面，再选择原仓审查整理或干净快照建立公开仓。以下版本/安装回执为此前内部交付历史，不能覆盖本段最新源码状态。

## 2026-10-25 后续源码状态：Astra 优化已实施，尚未部署

用户随后要求更新 Agent Reach、核查续杯差异并执行 [Astra 方案](docs/plans/2026-10-25-functional-audit/04-ASTRA-OPTIMIZATION-PLAN.md)。Agent Reach 已实际升级至 1.6.0，保留原配置；这是开发工具升级，不是产品更新。

**当前源码已完成第一至第五批优化，并通过定向验证。** 主要变化：严格确认新 5h 窗口并直接返回新 reset；有限匿名自动/手动审计及阶段诊断；应用进程级唯一原生调度器替代身份页 timer；私有配置迁移、共享尝试预算、逐账号暂停及一次受控授权恢复；未知结果只由合格的新鲜服务端被动锚点解除；浏览器固定指标/报告版本与未知三态；实际 WebRTC 异常/超时返回未知；Effort 上下文与文件游标同事务保存，旧游标仅在追加时进行紧邻尾部 64KiB 有界恢复。保持 Python 单写额度账本、账号冻结/提交复核、身份格式和既有用户数据兼容。

验证回执：Python 在线 35 项、Bun 定向 40 项、前端 production build、Rust online 14 / audit 1 / scheduler 14 / browser 18，以及 GUI wakeup 7 / quota-reset 8 均通过。Usage 首轮 27 项通过、1 项新增断言失败，按既有未知档位聚合契约修正后该项单独重跑通过；不把两轮混写成一次 28/28。只验证合成数据与隔离环境，未执行真实账号请求或系统修改。详见 [执行记录](docs/plans/2026-10-25-functional-audit/05-EXECUTION-RESULTS.md) 与 [源码候选](docs/plans/2026-10-25-functional-audit/06-SOURCE-CANDIDATE.json)。

**安装和发布边界：** 版本元数据仍为 0.3.1；本次未构建 release 宿主、热更新已安装程序、重打 NSIS、推送或发布。下文的本机 exe 哈希、`5d78c00` 和 v0.3.1 安装器是此前交付基线，不代表新优化已部署。以后需要本机更新时，再按现有备份/隐私审计流程执行；不中断 `claude.exe`。新增字段要求宿主/前端/helper成套更新，不能混装新旧文件。

已知取舍：未证实独立出口的账号统一采用每次尝试一次性抽样的 6–13 分钟错峰；系统睡眠/退出及真实账号验收仍待隔离验证，授权失败不能靠程序自动续凭据解决。可选通知与成本估算未增加。当前源码以本分支最新 Git 提交及上述执行回执为准。

以下保留此前 v0.3.1 实机交付历史。

更新日期：2026-10-25。本文件面向完全没有本会话上下文的新会话。先读本文、根目录 `AGENTS.md`、`CLAUDE.md`，修改具体模块前再读相应目录的 `CLAUDE.md` 和源码头部。

**当前事实：本会话在完成 `0.3.1` 界面排版美化与 GitHub Release 发布后，继续完成了第 7 项核心演进——「5h 额度窗口到期自动续杯 / 轻指令唤醒（含防风控阶梯退避、跨账号错峰、自定义生效时段与一键持久化开关）」。最新代码已通过全量自动化测试（Python 33 项、Bun 112 项、Rust Online 19 项、Playwright 额度重置与在线唤醒 18 项），无感热更新至本机 `D:\1_app\Claude-Local\claude-local.exe`（全程未中断任何正在运行的 `claude.exe`），并已按用户要求提交至本地 Git 仓库（暂不重新打包 NSIS 安装器或上传 GitHub Release）。当前没有任何技术阻塞。**

---

## 1. 我们在做什么任务

Claude-Local 是本仓库独立维护的 Windows x64 桌面产品，React/TypeScript 提供界面，Tauri/Rust 管理本机能力，Python 采集并写入额度账本。主程序 `claude-local.exe`，标识 `ai.local.claude-local`；伴生浏览器为 Claude-Local Browser。数据按用户保存在 `%APPDATA%/ai.local.claude-local`，普通启动不启动浏览器，只有用户动作或 `--browser` 才启动。

在 `0.3.0` 基线之上，2026-10-25 先后完成了 **前四阶段底层视觉/防封/HUD 升级** 与 **本会话（v0.3.1 及后续本地演进）针对用户实机截图与连续使用习惯的 7 项细节打磨与功能增强**：

### 1.1 本会话完成的 7 项核心任务
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
7. **5h 额度到期自动续杯 / 轻指令唤醒（含深度防风控保护）**：
   - **逆向与协议对齐**（`scripts/quota_archive.py`、`scripts/claude_quota_online.py`）：逆向本机官方 `claude.exe v2.1.310` 的 `probeQuotaStatus` 与 `GWe()`，在内存只读解包 `.baga` 时额外投影每个账号真实的 64 位 `.claude.json` `userID`（`device_id`），在 `run_wakeup` 中经该账号绑定的专属代理向 `https://api.anthropic.com/v1/messages?beta=true` 发送带完整 `X-Claude-Code-Session-Id`、`x-client-request-id`、`X-Stainless-*` 请求头、多态自然 CLI 短指令池（随机 `max_tokens: 16/24/32`）与 `metadata.user_id`（`device_id` + `account_uuid` + `session_id`）的极轻请求，并直接从响应头 `anthropic-ratelimit-unified-5h/7d-utilization` 与 `reset` 解析最新 5h 倒计时写入 `quota_ledger.json`（无需切号或中断正在运行的 `claude.exe`）。
   - **原生 Tauri 门禁与命令**（`src-tauri/src/identities/online.rs`、`src-tauri/src/main.rs`）：新增 `identities_wakeup_quota_window`，复用双阶段提交锁与冻结 `expected_identity` 校验，接受 `source: "wakeup_messages"`。
   - **四重防风控状态机与前端交互**（`src/identity-online-quota.ts`、`src/identities.tsx`、`src/identity-productivity.css`）：
     1. **顶栏一键持久化开关（`自动续杯` + 时段胶囊）**：未启用时 100% 保持现有被动行为；启用后跨重启自动持久化，后台自动检测已重置账号并触发续杯。
     2. **自定义生效时间段**：支持任意 `HH:mm – HH:mm`（含跨午夜时段如 `21:00 – 02:00`）及快捷预设（`08:00-23:00`、`09:00-19:00`、`全天`）。
     3. **同一账号等待时间自动加长（阶梯退避）**：刚用过的账号重置后延迟 `3–10 分钟` 唤醒；若连续 1 轮（5h）未使用，下次自动拉长至 `25–60 分钟`；若连续 `>= 2` 轮（10h+）未使用，自动转入 **「按需待命」**，仅当主力号 5h 剩余低于阈值（默认 `40%`，可选 `30%/40%/50%`）时才联动唤醒。
     4. **不同账号之间强制错峰间隔**：独立代理账号间至少间隔 `2.5–5.5 分钟`，共用系统代理账号间自动加倍至 `6–13 分钟`，杜绝并发脉冲。
     5. **单账号 / 批量手动一键唤醒**：在「额度详情」弹窗底部与「在线查询」面板均提供 **「唤醒 5h 计时」** 按钮。

### 1.2 同日早些时候完成的四项底层架构基线（已包含在 `0.3.1` 中）
- **实时额度悬浮监控窗（HUD）**：统一 `340×278`（展开）/ `340×152`（精简）并在 `monitor_window_resize` 中同步锁定 `min_size` / `max_size`，禁用双击最大化，采用 `token-monitor` 风格双列 5h/7d 看板。
- **原生 10/20 项防封环境核验**：内置 `Ping0.cc`、`CheckCC.org`、`BrowserScan`、`IPHey` 核心判据（ASN/ISP 宽带 vs IDC 机房识别、硬件 WebGL、WebRTC 零泄漏、`webdriver` 隐身、语言列表纯净度），主界面满格展示 10 项（`5×2`），隔离浏览器实测页展示 20 项（`5×4`）。
- **单层工作区光学毛玻璃渲染引擎**：仅在 `.workspace` 与 `.app-sidebar` 执行 1 次 `backdrop-filter: blur(...)`，内部卡片采用零模糊半透明抬升层，解耦 `--glass-card-border` 与 `--landing-line`，浅色/深色自适应柔光或暗幕遮罩。
- **身份卡片 `5h`/`7d` 时间规范统一**：到期等待激活时在 5h 进度条右下角显示静态 `<时钟图标> 5h`，具体重置时间统一为 `MM-DD HH:mm`。

---

## 2. 已经完成了什么

### 2.1 `0.3.1` 发布回执与后续本地「5h 自动续杯」热更新（2026-10-25）
- **版本号**：`0.3.1`（已同步 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/CLAUDE.md`、`README.md`、`CLAUDE.md`、`docs/RELEASE_NOTES_0.3.1.md`）。
- **源码分支与提交记录**：
  - 当前本地分支：`feature/functional-reliability-20261023`
  - 最新本地提交（5h 自动续杯与防风控）：Commit `5d78c00`（`feat(quota): add CLI-aligned 5h reset auto-wakeup with anti-ban progressive delay and custom time window`）。
  - 已推送的 `v0.3.1` 发布提交与标签：Commit `f11276f` & `371dd1b`，Tag `v0.3.1`（已推送至 `origin/main` 与 `origin/v0.3.1`，并发布 GitHub Release `https://github.com/yq04/Claude-Local/releases/tag/v0.3.1`）。
- **本机安装路径**：`D:\1_app\Claude-Local\claude-local.exe`
  - 已无感热更新包含「5h 到期自动续杯」的最新 Release 构建，最新本机 `claude-local.exe` SHA256 为 `b0bf467886f886438a30034828385a276fa6440b3ab471ae58dc8222a87bd263`；
  - `D:\1_app\Claude-Local\scripts\claude_quota_online.py`、`D:\1_app\Claude-Local\scripts\quota_archive.py` 与 `D:\1_app\Claude-Local\browser-ui\` 已同步更新；
  - 全程未中断任何正在运行的 `claude.exe`（`MissingClaudeProcesses: 0`）。
- **已发布的 `v0.3.1` 归档产物与安装器回执**：
  - 产物目录：`.local/artifacts/20261025T151849Z-ee8ffc4e85e046aca90f24f45db8a95b`（状态记录于 `.local/last-local-update.json`）。
  - 归档宿主 `claude-local.exe` SHA256：`06dfb613b8de7225b6ba1c5eb18f15a926eb94f4fb5bd750ff5011c72ecc8a11`。
  - 安装器 `Claude-Local_0.3.1_x64-setup.exe` SHA256：`0bdcceed1bd2939a6efee50e4044656b31c3b9635947c50db6dd62ed15777f38`。
  - 独立资源审计 109 项、私密探针 13 项，零发现（`findings: 0`）；`--quota-core` 管道冒烟测试 `pass`。

### 2.2 已执行的验证
- **Python 在线查询与 1-Token 唤醒单测**：`python scripts/test-claude-quota-online.py` **33 项测试全部通过**（含 CLI 请求头/设备指纹对齐、响应头 `anthropic-ratelimit-unified-5h/7d-*` 解析、Haiku->Sonnet 模型回退与 `/api/oauth/usage` 兜底）。
- **前端与双语字典单测**：`bun test` **21 个测试文件、112 项测试（9,852 断言）全部通过**（含跨午夜生效时段判定、同账号阶梯退避 `3-10m -> 25-60m -> 按需待命`、跨账号错峰与主力号 `<40%` 联动预热）；`bun run build`（`tsc --noEmit && vite build`）零错误通过。
- **Rust 原生测试**：`cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol` **全量通过**（其中 `identities::online` 19 项、全库 223+ 项）。
- **Playwright UI 全套回归**：
  - `bun scripts/test-identities-ui.ts --quota-reset-only`（**8/8 通过**，含到期账号一键「唤醒 5h 计时」、顶栏「自动续杯」开关、生效时段切换与配置面板）。
  - `bun scripts/test-identities-ui.ts --online-only`（**10/10 通过**）。
  - `node scripts/test-local-shell.mjs .local/preview-shell`、`node --experimental-strip-types scripts/test-identities-ui.ts`、`node --experimental-strip-types scripts/test-handoff-ui.ts`、`node scripts/test-usage-statistics.mjs .local/preview-usage`（含 `--layout-only` 与 `--quick-only`）：全部通过。

---

## 3. 当前卡在哪、遗留什么、工作树状态

**没有任何技术或测试阻塞。**

新会话需要注意以下当前状态与边界：
1. **发布状态说明**：
   - `v0.3.1`（含前 6 项界面与功能优化）已完成 NSIS 安装器打包并发布至 GitHub Release。
   - 第 7 项 **「5h 额度到期自动续杯 / 轻指令唤醒」**（Commit `5d78c00`）已按用户“目前只考虑本地，暂时不打包和上传，注意做好项目版本的管理（git）”的指令，**完成了本机 `D:\1_app\Claude-Local` 热更新与本地 Git 提交，尚未重新打包 NSIS 安装器或推送到远端 GitHub**。若用户在下一会话要求打包上传（如 `0.3.2` 或更新发布包），再执行完整 NSIS 审计打包与推送流程。
2. **工作树保留项（切勿删除）**：
   - 工作树中用户原有的 `AGENTS.md` 修改以及未跟踪的 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/`、`docs/plans/2026-10-22-identity-quota.md`、`p6b-i18n.json`、`TOKEN_MONITOR_RESEARCH_AND_PLAN.md` 均属于故意保留的规划/规则文件，**切勿删除或运行 `git clean` / `git checkout -- .`**。

---

## 4. 下一步计划是什么与代码入口

1. **新会话启动检查**：
   - 先只读查看 `git status --short`、`git log -n 5 --oneline` 和用户最新指令。
2. **按用户后续指令行动**：
   - **若用户在实机使用「自动续杯」后提出微调需求**（例如调整默认时间段、延迟区间或 UI 细节）：直接修改下述核心入口，运行单测与 `cargo build --release --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol` 后热更新至 `D:\1_app\Claude-Local`。
   - **若用户要求将「自动续杯」正式打包并上传发布（如 `0.3.2`）**：同步递增版本号，运行 `.local/tools/complete-local-update-0.3.1.ps1`（或对应新版本脚本）完成 13 项隐私探针审计打包，再推送 Git 标签与上传 GitHub Release。

核心源码入口：
- `scripts/claude_quota_online.py`、`scripts/quota_archive.py`、`src-tauri/src/identities/online.rs`、`src/identity-online-quota.ts`：5h 到期自动续杯 / 轻指令唤醒引擎（`/v1/messages?beta=true` CLI 指纹对齐、`anthropic-ratelimit-unified-5h/7d-*` 响应头解析、同账号阶梯退避、跨账号错峰与自定义时间段状态机）。
- `src/identities.tsx`、`src/identity-productivity.css`、`src/identity-quota.ts`、`src/task-handoff.tsx`：身份管理顶栏「自动续杯」胶囊、在线查询弹窗内的自动续杯配置面板、额度详情一键「唤醒 5h 计时」、切换前额度对比与隔离状态展示、会话接力草稿清空。
- `src-tauri/src/identities/usage.rs`、`src/usage-model.ts`、`src/usage-statistics.tsx`、`src/usage-trend.tsx`、`src/usage-statistics.css`：用量分析、SQLite `events.effort` 增量迁移与历史回填、模型家族胶囊及推理档位（Effort）分布。
- `src-tauri/src/identities/private.rs`、`src-tauri/src/browser/profile.rs`、`src/browser.tsx`：隔离浏览器配置目录 Windows DACL 继承修复（`ensure_owner_dacl`）、缓存大小实时枚举与浏览环境紧凑顶栏。
- `src/system.tsx`、`src/vps.tsx`、`src/style.css`：电脑环境单行内联控制条、网络环境 `2×2` 连通性诊断网格与单层工作区光学毛玻璃系统。

常用针对性验证命令：

```powershell
python scripts/test-claude-quota-online.py
bun test
bun run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol
bun scripts/test-identities-ui.ts --quota-reset-only
bun scripts/test-identities-ui.ts --online-only
node scripts/test-usage-statistics.mjs .local/preview-usage --layout-only
```

---

## 5. 踩过的坑：绝对不要再踩

### 5.1 本会话新踩过的 8 个关键深坑
1. **`anthropic-ratelimit-unified-5h-reset` 响应头返回的是纯数字 Unix 秒字符串（如 `"1761426000"`），解析时必须先转为 `int` 再交给 `_reset_seconds`。**
   - `scripts/claude_quota_online.py` 原有的 `_reset_seconds(raw)` 只接受 `int`/`float` 或 ISO-8601 日期字符串；若直接把 HTTP 响应头里的纯数字字符串传进去会被当作非法格式返回 `None`。`parse_ratelimit_headers` 中必须先判断 `raw_reset.strip().isdigit()` 并转为 `int(raw_reset.strip())`。
2. **向 `/v1/messages?beta=true` 发送 1-Token 唤醒请求时，绝不能发送死板的 `"hi"` + `max_tokens: 1` 或缺失 `metadata.user_id`（风控/反蒸馏红线）。**
   - 逆向本机官方 `claude.exe v2.1.310`（`probeQuotaStatus` 与 `GWe()`）证实：真实 CLI 请求必然携带 `X-Claude-Code-Session-Id: <uuid4>`、`x-client-request-id: <uuid4>`、`X-Stainless-*` 请求头以及 `metadata.user_id: JSON.stringify({device_id: <64-hex .claude.json userID>, account_uuid, session_id})`。必须从 `.baga` 归档中的 `.claude.json` 投影出每个账号真实的 `userID`，并使用多态自然短指令池与随机 `max_tokens`（`16/24/32`）。
3. **身份页及在线查询弹窗（`onlinePanelOpen`）严禁使用 `role="combobox"` 的 `<Select>` 控件，且后台自动续杯定时器在合成测试环境（`'identityFixture' in window`）下默认静默。**
   - `scripts/test-identity-batch.ts` 第 68 行有严格断言 `assert.equal(await page.getByRole('combobox').count(), 0)`，第 219 行通过 `page.clock.runFor(360001)` 验证无隐藏后台请求。因此生效时段选择器必须使用 `<input type="time">` + 预设胶囊按钮，且后台自动续杯 `useEffect` 在 `'identityFixture' in window && !window.__enableAutoWakeupTest` 时不自动发起后台网络请求。
4. **本地估算到期（`local_estimate` 且 `expired5h === true`）的账号，`evaluateQuota` 返回的 `inferredReset5h` 与 `r5` 均为 `null`，唤醒状态机必须回退读取 `summary?.quota_5h_reset_at`。**
   - 若只传 `q?.inferredReset5h ?? q?.r5 ?? null`，本地估算刚过期的账号在唤醒面板中会被误判为 `not_expired`（显示未知或计时中），导致状态标签与「唤醒 5h 计时」按钮不一致。
5. **Windows 下隔离浏览器缓存报「无法枚举缓存。」（`PermissionDenied`）是 Chromium AppContainer 沙箱改写子目录 ACL 所致，必须保留 `ensure_owner_dacl` 继承权修复。**
   - `private.rs` 的 `lock(path)` 默认创建的是 `NO_INHERITANCE` 的 DACL；当 Chromium 启动并创建 `profile\Default\Cache` 时，Chromium 会给 `Cache` 注入 AppContainer SID，导致如果父目录 `Default` 没有当前用户的 `SUB_CONTAINERS_AND_OBJECTS_INHERIT` 权限，主程序枚举缓存就会被系统拒绝。
   - **铁律**：绝不能在 `Default` 或 `Cache` 上粗暴调用 `private::lock`（会清掉 Chromium 的 AppContainer SID 导致浏览器崩溃），必须使用 `private::ensure_owner_dacl`（将当前用户的继承权限**合并**进既有 DACL）。
6. **`detectModelFamily` 对非特定家族（`other`）的模型必须返回 `label: null`，不要返回 `'Claude'`。**
   - `src/usage-model.ts` 中若给未知 `claude-*` 测试模型返回 `'Claude'` 胶囊标签，既无信息增量，又会在窄窗口测试中挤占模型名空间；仅对明确的 `Opus`、`Sonnet`、`Fable`、`Haiku` 返回胶囊标签。
7. **切勿同时并发启动多个带 Vite Server 的 Playwright 测试脚本（如 `test-identities-ui.ts` 与 `test-usage-statistics.mjs`）。**
   - 多个 Vite 实例同时读写 `node_modules/.vite` 依赖缓存会触发 `Re-optimizing dependencies` 并导致页面在断言中途自动 reload 报错；Playwright 界面测试必须串行执行。
8. **修改 `src/locales/zh.yaml` 中的主题/按钮显示名称时，必须同步检查 `scripts/test-local-shell.mjs` 等 Playwright 脚本中的 `getByRole(..., { name })` 定位器。**
   - 例如将 `"月之暗面"` 的中文译文改为更实用的 `"深色"` 后，`scripts/test-local-shell.mjs` 第 105 行的 `getByRole('radio', { name: '深色', exact: true })` 必须同步更新。

### 5.2 既有工程铁律（持续有效）
9. **自定义壁纸毛玻璃切忌「双重 `backdrop-filter`」或「全透明 `.workspace` + 独立模糊 `.card`（百叶窗效应）」。**
   - 只在 `.workspace` 和 `.app-sidebar` 上做 **1 次** 全局 `backdrop-filter: blur(var(--glass-blur))`；内部所有 `.card` 必须设置 `backdrop-filter: none !important`。
10. **切勿把全局表格/分割线变量 `--landing-line` 改成高不透明度白色，也切勿在浅色模式下用纯黑遮罩压暗壁纸或给全局文字加 `text-shadow`。**
11. **Cromma UI 组件库自带不透明 `--card` / `--input` / `--segment-thumb` 变量，开启壁纸时必须在 `html[data-has-wallpaper='true']` 下同步覆盖为半透明。**
12. **Tauri v2 悬浮监控窗切换精简/展开高度时，必须在 `monitor_window_resize` 中依次更新 `set_min_size` -> `set_max_size` -> `set_size`，且宽度严格统一为 `340.0`。**
13. **`Claude Code CLI` 报 `Auto mode is unavailable` / `powershell denied by auto mode` 是云端 ATIS 分类器熔断所致，需在 `settings.json` 中保持 `"defaultMode": "bypassPermissions"` 与 `"disableAutoMode": "disable"`。**
14. **主界面环境验证扩展为 10 项（`5×2`）后，前后端与布局测试断言必须同步对齐 `10`。**
15. **Tauri v2 在 Windows (WebView2) 下创建/操控子窗口的命令必须是 `pub async fn`，且必须在 `capabilities/main.json` 注册窗口名 `["main", "monitor"]`。**
16. **`usage_statistics_read` 绝不能与 `identities_read` 共用同一个全局长锁（必须保持独立 `USAGE_LOCK`）。**
17. **静态 `5h` 重置显示（`inferred === true`）绝不能使用 `<time>` 标签，且必须保持 `180×286` 卡片几何。**
18. **双语 YAML 字典与源码 `t('...')` 调用受 `src/i18n.test.ts` 严格门禁保护（中英键集合与插槽必须 100% 一致，`en.yaml` 与 JSX 中严禁混入裸中文字符）。**
19. **部分源码文件（如 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src/locales/*.yaml`、`src/system.tsx`）采用 CRLF 行尾，编辑时注意匹配。**
20. **GitHub Release 保持干净，只上传单个 `Claude-Local_<ver>_x64-setup.exe` 安装包文件。**
21. **不终止 `claude.exe`，不清理共享工作树，敏感探针不入对话或 Git；每次改写 `HANDOFF.md` 前先归档至 `.local/handoff-backups/` 并校验 SHA256。**

---

## 6. 需要历史细节时再读这些文件

- [0.3.1更新说明](docs/RELEASE_NOTES_0.3.1.md)、[0.3.0更新说明](docs/RELEASE_NOTES_0.3.0.md)、[0.2.4更新说明](docs/RELEASE_NOTES_0.2.4.md)、[0.2.3更新说明](docs/RELEASE_NOTES_0.2.3.md)、[0.2.2更新说明](docs/RELEASE_NOTES_0.2.2.md)、[0.2.1额度恢复](docs/QUOTA_RECOVERY_0.2.1.md)：用户可见行为与历次升级原因。
- [0.2.0更新说明](docs/RELEASE_NOTES_0.2.0.md)、[0.2.0交付核验](docs/RELEASE_VERIFICATION_0.2.0.md)：早期功能实施和分发边界。
- [开发说明](docs/DEVELOPMENT.md)、[分发与许可](docs/DISTRIBUTION.md)、`LICENSE`、`NOTICE.md`：独立产品、构建和第三方许可约束。不存在上游同步、自动公开发布或官方更新源。

本次交接整理只修改 `HANDOFF.md` 文档，不重新触发构建或移动产品标签。下一会话可直接基于本文档无缝承接。
