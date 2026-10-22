<!--
[INPUT]: Verified 0.1.8 source/CI/private release, independent package audit, safe local overwrite and actual window-size/maximization restart receipts.
[OUTPUT]: Context-free project handoff covering the current product baseline, completed delivery, pending quota proposals and operational constraints.
[POS]: Repository root handoff; private installation details, probes, PIDs and receipts stay in ignored .local/.
[PROTOCOL]: Copy this file into .local/handoff-archive/ and verify SHA256 before any rewrite. Documentation-only changes do not rebuild or move product tags.
-->
# Claude-Local 会话交接

更新日期：2026-10-22。新会话先完整阅读本文与根目录 `CLAUDE.md`、`AGENTS.md`。当前产品版本为 **0.1.8**，已完成安全覆盖更新、打包及 GitHub 私有预发布。

## 项目定位与架构

Claude-Local 是独立维护的 Windows x64 桌面产品，主程序为 `claude-local.exe`，标识为 `ai.local.claude-local`。React/TypeScript 管理界面，Tauri/Rust 管理本机能力，Python 被动采集额度。用户数据位于每用户的产品 AppData 根目录。

核心能力包括加密身份暂存/恢复、身份切换、5h/7d 额度观察、独立 Token 用量分析、环境配置与按需启动的隔离伴生浏览器。默认身份页，仅记忆白名单页面枚举。普通启动不拉起浏览器；只有明确用户动作或 `--browser` 启动浏览器。

额度账本由 Python 唯一写入，具备跨进程锁、原子替换和新锚点优先。Rust/界面只读合并；Token 统计账本独立。没有后台 OAuth 用量轮询，也不修改用户 `.claude.json`。BAGAID01、`.baga`、SQLite user_version=3、账号 HMAC 与旧浏览器种子域名必须保持兼容。

## 本轮完成的 0.1.8

经典侧栏从 232px 缩为 192px，给主内容释放 40px；紧凑模式保留 72px。品牌与折叠按钮、英文菜单、命令入口及语言/版本区域同步收紧。窗口缩放不会改写经典/紧凑偏好。

身份库内容窄于 600px 时，添加账号的三个引导步骤完整换行，浏览器按钮保持可达。身份卡继续为 180×286；卡片和统计表保留局部滚动，页面不出现横向溢出。

Rust 新增主窗口尺寸记忆：保存正常客户区的逻辑宽高与最大化标志；最小化不覆盖正常尺寸。独立私有 `window-state.json` 有 512 字节读取上限、非法值回退和原子写入。拖动先更新内存，再经 350ms 防抖保存；关闭到托盘及真正退出会保存。

启动按当前主屏工作区、DPI 和窗口外框约束后居中，恢复完成再显示。基础/Windows/Linux 窗口配置均显式设置初始隐藏，避免平台配置数组覆盖基础属性。设计取舍是记忆尺寸与最大化，不记忆旧显示器绝对坐标。

首个内部候选在真实最大化验收中暴露 Tao 缓存时序问题，未发布产品版本。修复版 Windows 直接读取 `WINDOWPLACEMENT` 正常外框与显示状态，按正常样式计算非客户区并换算 DPI，不混用旧最大化缓存和新实时客户区，也不在移动事件采集大小。API 失败时保留已有值。

## 当前交付基线与证据

- 产品版本：0.1.8。
- 产品代码提交：`23edaf1dd9bf532663ec8b8cfccb730be82486e6`；产品标签 `v0.1.8` 固定指向该提交。
- 同提交工作流：[39833568061](https://github.com/yq04/Claude-Local/actions/runs/39833568061)，全部成功。
- 私有预发布：[v0.1.8](https://github.com/yq04/Claude-Local/releases/tag/v0.1.8)，8 项资产已独立下载并逐项验证 SHA256。
- 安装包：`Claude-Local_0.1.8_x64-setup.exe`，133.53 MiB。
- 安装包 SHA256：`7a91db9c18fa666f72fdefcdcd4fd861bba950586e58684649e508fa42cf98d6`。
- 本机主程序 SHA256：`797ecb76f4317f92cea7a8165eb0f86958973b882096c1a32448a20f3609b527`。

源码阶段 96 组隔离布局场景通过；纯窗口模型 6 项通过；修复版 CI 执行完整原生、前端及 Python 合成测试。前端从该提交的纯 LF 源码独立复现，10 个文件逐字节吻合远程输入。

本机独立审计使用原有 13 项私密探针，零发现，核对 103 个解包资源及唯一 Tauri 三字节 Sentinel 变换。部署核对 96 个文件，精准替换 1 个；替换前备份，未替换浏览器引擎，未停止 Claude 或浏览器进程。

真实窗口验收通过：设置区别于默认值的正常窗口大小、最大化、只重启精确产品主程序，验证新进程恢复正确正常尺寸和最大化标志，再恢复验收前的窗口状态。更新与验收均没有丢失原有 Claude 会话。

私有证据目录为 `.local/release-0.1.8-window-fix/`，包括 `ci-receipt.json`、`draft-download-receipt.json`、`frontend-reproduction-receipt.json`、`prepared-*/prepare-receipt.json`、`window-memory-receipt.json`、`build-receipt.json`、`published-receipt.json`。最新更新回执为 `.local/last-local-update.json`。早期失败候选留在 `.local/release-0.1.8/`，不要将其作为最终版本。

## 额度卡片调研与尚未实施事项

用户希望把 Pro 放名称附近，移除常驻“凭证有效/待自动续期/推荐切换”，展示真实订阅日期与平台手动重置余额，并能免去每次切换 CLI 后执行 `/usage` 的步骤。详细证据见 `docs/QUOTA_CARD_RESEARCH_2026-10-22.md`。**这些仍是调研方案，没有在 0.1.8 中实现。**

常规额度有 OAuth usage 只读通路先例；订阅日期和部分手动重置权益需要网页认证通路。`next_charge_date` 表示下次续费，不能一律写成订阅到期；OAuth `expiresAt` 只是登录凭证到期。手动余额与 5h/7d 自动重置倒计时、extra usage 金额不同；网页 `cedar_ember.grants` 需核实生效/失效/暂停与次数。OAuth 的 null 或 surface 不可见不能当作余额为零。

Claude Swap 可参考请求治理；Cockpit 有 OAuth/网页双通路；Clawmeter 有网页重置权益解析先例。Antigravity 的 Google 托管配额不能套用为 Claude 订阅。Antigravity/Cockpit 的非商业与相同方式共享许可不等于可直接并入本项目 MIT 代码；本轮独立实现，没有复制第三方产品代码。

## 遗留边界

0.1.8 交付已闭环，没有悬挂的打包或本机替换任务。新需求等待用户提出。

本机使用审计后的文件替换，不等于已执行 NSIS 安装/卸载。注册表、快捷方式与系统级升级/卸载验收只允许在一次性 Windows 环境执行。窗口恢复已在当前机器实测；其他显示器布局和 DPI 有合成覆盖，不能宣称穷尽所有硬件环境。

公开分发前仍须依据 `docs/DISTRIBUTION.md`、LICENSE 和 NOTICE 审核第三方边界。保持仓库私有；没有自动公开发布或更新源。

## 新会话的只读起手核对

查看 `git status`、最近提交与 `v0.1.8` 指向。产品之后允许有独立文档提交，HEAD 前移不表示需要重编译。检查最新更新回执、最终证据目录、实际安装版本及正在运行的产品窗口；没有新增需求时不构建、不更新、不清理。

目录入口：`src/main.tsx` 和 `src/style.css` 为产品壳/布局；`src/identities.tsx` 为卡片；`src-tauri/src/window_state.rs` 与 `window_state_model.rs` 为尺寸记忆；`src-tauri/src/identities/` 为身份与用量；`scripts/claude_quota.py` 为额度唯一写入者。编辑前读相应目录 CLAUDE.md，更新源头 INPUT/OUTPUT/POS 和目录映射。

## 必须保留的操作经验

1. Gemini/CPA 工具调用必须 1:1 配对。exec 内绝不调用 `notify()` 或 `yield_control()`；进度在工具外发 commentary，结果在脚本完成后一次输出。
2. 正式 release 编译走远程 Runner，保护用户 MATLAB 和已有会话；不结束无关进程，不改分页文件，不在本机硬跑大型 release 构建。
3. Actions artifact 配额曾满，使用 `delivery_transport=private-draft`。内部构建草稿只传输，严格保持草稿，不直接发布或删除；旧失败候选草稿也保留。
4. 精确复现前端时从 Git 树导出 LF 源码，并先 `git init --quiet` 建立独立扫描边界，避免 Tailwind 向上扫描父仓库导致 CSS 字节差异。
5. Windows 平台配置数组会覆盖基础窗口项；只改基础 `visible` 不足。Tao 的最大化缓存可能滞后，不能在移动事件把当前全屏客户区当正常尺寸。
6. 不用 stash/reset/restore/checkout/clean 清场。保留用户 AGENTS.md 修改与 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/` 等未跟踪工作。
7. 更新仅针对精确路径和启动时间匹配的 `claude-local.exe`；绝不停止 `claude.exe`，不碰身份库和浏览器资料。先备份、验 hash，失败回滚。
8. 新旧观测时间、账号/组织绑定和 Python 唯一账本写入者不可破坏；不能伪造新的服务端观测或将预计恢复标成实时查询。
9. PowerShell 7 中组合 Test-Path 使用括号；StrictMode 下访问可选回执字段先检查属性。私密探针值与凭据不进入对话或 Git，机器路径及私有回执不进入 Git。
10. 修改 HANDOFF 先完整备份并验 SHA256。产品标签不因文档更新移动；交接收尾用单独 `[skip ci]` 文档提交，不重做构建。
