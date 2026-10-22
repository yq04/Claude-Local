<!--
[INPUT]: Verified 0.1.8 source/CI/private release, independent package audit, safe local overwrite and actual window-size/maximization restart receipts.
[OUTPUT]: Context-free end-of-session handoff covering the original tasks, verified delivery, unresolved quota requirements, concrete next steps and operational pitfalls.
[POS]: Repository root handoff; private installation details, probes, PIDs and receipts stay in ignored .local/.
[PROTOCOL]: Copy this file into .local/handoff-archive/ and verify SHA256 before any rewrite. Documentation-only changes do not rebuild or move product tags.
-->
# Claude-Local 会话交接与下一步指南

更新日期：2026-10-22。新会话先完整阅读本文与根目录 `CLAUDE.md`、`AGENTS.md`。当前产品版本为 **0.1.8**，已完成安全覆盖更新、打包及 GitHub 私有预发布。

## 1. 我们在做什么任务

本会话从读取上一版交接、核对已交付的 0.1.7 开始，随后承接了两条不同的工作线，必须区分进度。

第一条是额度卡片调研。用户不满意“凭证有效”“待自动续期”“推荐切换”等常驻标签，希望 Pro 靠近账号名、显示真实订阅日期和平台提供的手动重置次数余额，并改善每次必须切换登录后执行 `/usage` 才得到真实额度的体验。用户允许使用子代理、clone/fork，并要求优先参考 Antigravity Tools、Cockpit Tools、Claude Swap、Claude Switcher，也可参考 `REA_Study`。这条线完成了源码调研、证据报告与卡片提案，**尚未改造产品卡片或接入在线采集**。

第二条是侧栏与窗口体验改进。用户要求适当缩窄左侧菜单、再次打开时恢复上次窗口大小，并考虑内容对不同窗口大小的适应。源码实施后，用户明确授权“完成覆盖更新、打包上传等操作，全权负责”。这条线已完成 0.1.8 的实现、远程构建、审计、本机更新、真实窗口验收与私有预发布。

本次最后一条指令仅要求完善交接。新会话没有需要继续收尾的发布任务，不要因为看到调研提案或旧失败日志就自动构建、重装或重复发布。

### 产品定位与架构

Claude-Local 是独立维护的 Windows x64 桌面产品，主程序为 `claude-local.exe`，标识为 `ai.local.claude-local`。React/TypeScript 管理界面，Tauri/Rust 管理本机能力，Python 被动采集额度。用户数据位于每用户的产品 AppData 根目录。

核心能力包括加密身份暂存/恢复、身份切换、5h/7d 额度观察、独立 Token 用量分析、环境配置与按需启动的隔离伴生浏览器。默认身份页，仅记忆白名单页面枚举。普通启动不拉起浏览器；只有明确用户动作或 `--browser` 启动浏览器。

额度账本由 Python 唯一写入，具备跨进程锁、原子替换和新锚点优先。Rust/界面只读合并；Token 统计账本独立。没有后台 OAuth 用量轮询，也不修改用户 `.claude.json`。BAGAID01、`.baga`、SQLite user_version=3、账号 HMAC 与旧浏览器种子域名必须保持兼容。

## 2. 已经完成了什么

### 2.1 额度卡片调研

主要成果为 `docs/QUOTA_CARD_RESEARCH_2026-10-22.md`，包含固定公开源码提交、字段来源、许可证边界、当前产品缺口及实施建议。四个指定项目均已定位并检查，另补充 Clawmeter 与 claude-meter，找到了常规额度、订阅日期与手动重置权益应分别取数的证据。调研采用公开源码静态分析及 `REA_Study` 的“观测/推断/未知”纪律，没有对运行中的 Claude 做逆向、抓包或插桩。

### 2.2 侧栏与内容适配

经典侧栏从 232px 缩为 192px，给主内容释放 40px；紧凑模式保留 72px。品牌与折叠按钮、英文菜单、命令入口及语言/版本区域同步收紧。窗口缩放不会改写经典/紧凑偏好。

身份库内容窄于 600px 时，添加账号的三个引导步骤完整换行，浏览器按钮保持可达。身份卡继续为 180×286；卡片和统计表保留局部滚动，页面不出现横向溢出。

### 2.3 原生窗口尺寸记忆与实机缺陷修复

Rust 新增主窗口尺寸记忆：保存正常客户区的逻辑宽高与最大化标志；最小化不覆盖正常尺寸。独立私有 `window-state.json` 有 512 字节读取上限、非法值回退和原子写入。拖动先更新内存，再经 350ms 防抖保存；关闭到托盘及真正退出会保存。

启动按当前主屏工作区、DPI 和窗口外框约束后居中，恢复完成再显示。基础/Windows/Linux 窗口配置均显式设置初始隐藏，避免平台配置数组覆盖基础属性。设计取舍是记忆尺寸与最大化，不记忆旧显示器绝对坐标。

首个内部候选在真实最大化验收中暴露 Tao 缓存时序问题，未发布产品版本。修复版 Windows 直接读取 `WINDOWPLACEMENT` 正常外框与显示状态，按正常样式计算非客户区并换算 DPI，不混用旧最大化缓存和新实时客户区，也不在移动事件采集大小。API 失败时保留已有值。

### 2.4 当前交付基线与证据

- 产品版本：0.1.8。
- 产品代码提交：`23edaf1dd9bf532663ec8b8cfccb730be82486e6`；产品标签 `v0.1.8` 固定指向该提交。
- 同提交工作流：[39833568061](https://github.com/yq04/Claude-Local/actions/runs/39833568061)，全部成功。
- 私有预发布：[v0.1.8](https://github.com/yq04/Claude-Local/releases/tag/v0.1.8)，8 项资产已独立下载并逐项验证 SHA256。
- 安装包：`Claude-Local_0.1.8_x64-setup.exe`，133.53 MiB。
- 安装包 SHA256：`7a91db9c18fa666f72fdefcdcd4fd861bba950586e58684649e508fa42cf98d6`。
- 本机主程序 SHA256：`797ecb76f4317f92cea7a8165eb0f86958973b882096c1a32448a20f3609b527`。

源码阶段 96 组隔离布局场景通过（8 页 × 3 种视口 × 2 种语言 × 2 种侧栏）；纯窗口模型 6 项通过。最终 CI 原生测试为 171 passed、0 failed、1 ignored，JSON 边界和最大化竞态回归均实际执行通过；前端及 Python 合成测试也通过。前端从该提交的纯 LF 源码独立复现，10 个文件逐字节吻合远程输入。

本机独立审计使用原有 13 项私密探针，零发现，核对 103 个解包资源及唯一 Tauri 三字节 Sentinel 变换。首次候选从 0.1.7 更新时替换 8 个文件；随后修复候选再次核对 96 个文件，仅替换主程序 1 个。因此最终回执的 `changedFiles=1` 是第二次事务的数量，不表示侧栏或前端遗漏。两次均先备份，均未替换浏览器引擎，也未停止 Claude 或浏览器进程。

真实窗口验收通过：设置区别于默认值的正常窗口大小、最大化、只重启精确产品主程序，验证新进程恢复正确正常尺寸和最大化标志，再恢复验收前的窗口状态。更新与验收均没有丢失原有 Claude 会话。

最终私有证据目录为 `.local/release-0.1.8-window-fix/`，包括 `ci-receipt.json`、`draft-download-receipt.json`、`frontend-reproduction-receipt.json`、`prepared-*/prepare-receipt.json`、`window-memory-receipt.json`、`build-receipt.json`、`published-receipt.json` 和 `session-close-receipt.json`。最新更新回执为 `.local/last-local-update.json`；可从其中读取实际安装位置和备份路径，不把机器路径写入 Git。

早期失败候选留在 `.local/release-0.1.8/`，其源码为 `b7c86fb`、工作流为 `39828113978`，只供追溯，不可作为最终版本。最终版本是 `23edaf1` / `39833568061`。两个内部传输草稿 `build-0.1.8-39828113978` 与 `build-0.1.8-39833568061` 都必须继续保持 draft；正式产品预发布是 `v0.1.8`。

产品发布后已完成一次文档提交 `21628af`，本次交接增强也采用独立文档提交。不要把 HEAD 硬绑定到某个旧文档哈希：判断二进制基线看产品标签与交付回执，判断最新说明看当前 HANDOFF。

## 3. 当前卡在哪

**交付没有阻塞。** 0.1.8 已安装并发布，真实窗口缺陷已修复，旧失败候选没有对外作为产品发布。当前未完成的是用户原先关注的额度卡片与数据来源改造，不能把“已调研”写成“已实现”。

### 3.1 额度卡片与数据仍未改造

用户希望把 Pro 放名称附近，移除常驻“凭证有效/待自动续期/推荐切换”，展示真实订阅日期与平台手动重置余额，并能免去每次切换 CLI 后执行 `/usage` 的步骤。详细证据见 `docs/QUOTA_CARD_RESEARCH_2026-10-22.md`。**这些仍是调研方案，没有在 0.1.8 中实现。**

当前刷新仍经 `src/identities.tsx` 的 `read(false)` / `identities_read` 读取本地数据。`src-tauri/src/identities/profile.rs` 没有可信订阅日期赋值来源，`subscription_expires_at` 保持未知；重置次数在前端详情中仍是“未提供”占位。上述常驻标签与 Pro 原位置也没有随 0.1.8 发布改掉。

常规额度有 OAuth usage 只读通路先例；订阅日期和部分手动重置权益需要网页认证通路。`next_charge_date` 表示下次续费，不能一律写成订阅到期；OAuth `expiresAt` 只是登录凭证到期。手动余额与 5h/7d 自动重置倒计时、extra usage 金额不同；网页 `cedar_ember.grants` 需核实生效/失效/暂停与次数。OAuth 的 null 或 surface 不可见不能当作余额为零。

用户已明确，“剩余重置次数”是平台赠送的手动 limit reset 余额。候选字段为网页响应 `cedar_ember.grants[]` 的 `resets_left`、`starts_at`、`ends_at`、`paused`；需合计当前有效、未暂停的剩余次数，而不是计算 grants 数量。当前没有用真实账号响应验证全部字段和权限，不能承诺每个账号都可读取。

现有本地浏览器起始页不能直接跨源读取 claude.ai。未来需要在该身份已登录的 claude.ai 同源上下文中做只读桥接，回传白名单摘要，并匹配账号与组织；不能只凭 Team 组织 ID 就认定是同一个账号。不要读取日常浏览器 Cookie，也不要导出 session cookie。有效授权可复用，但首次授权或失效后的重新授权无法凭空消除。

Claude Swap 可参考请求治理；Cockpit 有 OAuth/网页双通路；Clawmeter 有网页重置权益解析先例。Antigravity 的 Google 托管配额不能套用为 Claude 订阅；本轮定位的 Claude Switcher 主要处理环境和客户端快照隔离。详细仓库、固定提交与证据均在调研报告。Antigravity/Cockpit 的非商业与相同方式共享许可不等于可直接并入本项目 MIT 代码；本轮独立实现，没有复制第三方产品代码。

### 3.2 仍需如实保留的验收与分发边界

本机使用审计后的文件替换，不等于已执行 NSIS 安装/卸载。注册表、快捷方式与系统级升级/卸载验收只允许在一次性 Windows 环境执行。窗口恢复已在当前机器实测；其他显示器布局和 DPI 有合成覆盖，不能宣称穷尽所有硬件环境。

公开分发前仍须依据 `docs/DISTRIBUTION.md`、LICENSE 和 NOTICE 审核第三方边界。保持仓库私有；没有自动公开发布或更新源。

## 4. 下一步计划

### 4.1 新会话先只读核对，不重复交付

查看 `git status`、最近提交与 `v0.1.8` 指向。产品之后允许有独立文档提交，HEAD 前移不表示需要重编译。检查最新更新回执、最终证据目录、实际安装版本及正在运行的产品窗口；没有新增需求时不构建、不更新、不清理。

目录入口：`src/main.tsx` 和 `src/style.css` 为产品壳/布局；`src/identities.tsx` 为卡片；`src-tauri/src/window_state.rs` 与 `window_state_model.rs` 为尺寸记忆；`src-tauri/src/identities/` 为身份与用量；`scripts/claude_quota.py` 为额度唯一写入者。编辑前读相应目录 CLAUDE.md，更新源头 INPUT/OUTPUT/POS 和目录映射。

主要参考文件为 `docs/RELEASE_NOTES_0.1.8.md`、`docs/WINDOW_LAYOUT_2026-10-22.md` 和 `docs/QUOTA_CARD_RESEARCH_2026-10-22.md`。旧产品调研报告有保留的历史时点描述，实际安装与发布状态以最新 HANDOFF 和最终回执为准。

### 4.2 若用户继续额度卡片改造

1. 先调整卡片信息层级：Pro/Max 靠近名称，移除冗余常驻标签，保留明确的错误入口；继续保持 180×286、双语与隐私遮罩。未知字段保持未知，不先填假日期或零余额。
2. 实现用户触发的按账号常规额度读取，区分“刷新本地状态”和“读取在线额度”；处理授权失效、账号隔离、同请求合并、冷却与 429 退避。不要自动切换 CLI 身份，不向 `.claude.json` 写数据，不擅自轮换可能与正在运行的 CLI 共享的 refresh credential。
3. 单独推进订阅/手动权益的浏览器同源只读桥接。保留日期语义、每种资料各自的真实观测时间及账号/组织绑定；任何额度账本写入仍由 Python 在锁内原子完成。普通启动不拉起浏览器，不新增后台 OAuth 轮询，不添加消耗手动重置的动作。
4. 用合成响应和隔离上下文覆盖未知/零余额/过旧/无权限、日期类型、旧观测保留、公式和布局边界。针对性验证通过即止；有正式交付需求时复用远程构建、独立前端复现、13 探针审计、备份覆盖和私有发布流程。

以上是可继续的需求线，不是待收尾的发布步骤。新会话先理解用户当时的新指令，不自动实施整套提案。

## 5. 哪些坑绝对不要再踩

1. Gemini/CPA 工具调用必须 1:1 配对。exec 内绝不调用 `notify()` 或 `yield_control()`；进度在工具外发 commentary，结果在脚本完成后一次输出。
2. 正式 release 编译走远程 Runner，保护用户 MATLAB 和已有会话；不结束无关进程，不改分页文件，不在本机硬跑大型 release 构建。
3. Actions artifact 配额曾满，使用 `delivery_transport=private-draft`。内部构建草稿只传输，严格保持草稿，不直接发布或删除；旧失败候选草稿也保留。
4. 精确复现前端时从 Git 树导出 LF 源码，并先 `git init --quiet` 建立独立扫描边界，避免 Tailwind 向上扫描父仓库导致 CSS 字节差异。
5. Windows/Linux 平台配置数组会覆盖基础窗口项；只改基础 `visible` 不足。恢复尺寸后必须显式 show，既避免闪烁，也避免窗口永久隐藏。
6. Tao 的最大化缓存可能滞后，不能在移动事件把当前全屏客户区当正常尺寸。Windows 使用系统正常外框、正常样式非客户区和 DPI；不能用最大化时的当前外框差替代正常边框。模型/编译通过不代表实机事件顺序已验证，必须做区别于默认值的尺寸、最大化、重启及还原验收。
7. `rustfmt main.rs` 会递归格式化子模块。本轮曾牵连无关额度/隐私文件，已备份后逐块纠正。仅格式化明确修改的文件，必要时使用 `--config skip_children=true`；不能用 Git 还原清场，更不能覆盖并发会话的改动。
8. 不用 stash/reset/restore/checkout/clean 清场。保留用户 AGENTS.md 修改与 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/` 等未跟踪工作。
9. 更新仅针对精确路径和启动时间匹配的 `claude-local.exe`；绝不停止 `claude.exe`，不碰身份库和浏览器资料。先备份、验 hash，失败回滚。
10. 新旧观测时间、账号/组织绑定和 Python 唯一账本写入者不可破坏；不能伪造新的服务端观测或将预计恢复标成实时查询。登录凭证到期、订阅续费/权益结束、自然额度窗口、手动重置余额分别表达。
11. PowerShell 7 中组合 Test-Path 使用括号；StrictMode 下访问可选回执字段先检查属性。数字 `0` 与空数组不同：`@($numericZero).Count` 为 1。本轮收尾回执曾把数值型 findings=0 误计成 1；已根据原始审计数组零发现修正并保留备份。读报告先辨字段类型，不把汇总误计当成真实隐私发现。
12. 首次启动在没有尺寸变化时，偏好文件可以尚未生成；验收应先产生真实窗口变化再验证写入。截图须等待入场动画稳定，否则会截到半透明画面。两者都不能草率当成产品不可用。
13. 每次候选使用独立准备目录、精确 commit/run 和新输出。不要将 `.local/release-0.1.8/` 的旧候选包当最终包，不覆盖/删除失败产物来伪造成功；脚本版本、FileBuildPart、提交和工作流编号必须一致。未来脚本必须保留原有审计、回滚及范围闸门。
14. 私密探针值与凭据不进入对话或 Git，机器路径及私有回执不进入 Git。NSIS 系统级验收只在一次性 Windows 环境执行；私有仓库不自动解决第三方许可证问题。
15. 修改 HANDOFF 先完整备份并验 SHA256。产品标签不因文档更新移动；交接收尾用单独 `[skip ci]` 文档提交，不重做构建、覆盖发布资产或移动已验证标签。
