<!--
[INPUT]: Verified 0.1.6 quota reset recovery, compact controls/system layout, audited local update and exact-commit private prerelease receipts.
[OUTPUT]: Context-free product handoff with current behavior, validation, installed/publication state, remaining limits and safe next steps.
[POS]: Repository handoff; installation paths, process IDs, private probes and machine-specific receipts remain in ignored .local/.
[PROTOCOL]: Back up to .local/handoff-archive/ and verify the copy before rewriting. Never rebuild or clean merely to refresh this document.
-->
# Claude-Local 会话交接

更新日期：2026-10-22，时区 America/New_York。以本文件的 **0.1.6** 状态为准；先前 0.1.5 的安装包和回执不能替代本轮证据。

## 0. 三十秒现状

- 产品版本 **0.1.6**，已完成正式 `custom-protocol` 中立构建、解包审计、本机安全更新和运行窗口核验。
- 本轮包含两组改动：可信额度窗口到期后的「预计已恢复」，以及紧凑中性按钮、账号筛选框和电脑环境双列卡片。
- 功能提交 `26f60efeb11913e866d9e431363f596d7b071e03` 已推送 `main`；同提交 Windows CI **39756404149** 全步骤成功。
- 私有预发布 **v0.1.6** 已发布，`isDraft=false`、`isPrerelease=true`；八个附件已独立下载，SHA-256 全部一致，标签指向上述功能提交。
- 本机主程序版本 0.1.6、窗口存在、文件哈希与回执一致；随包 Python `--quota-backend` 为 `rust`。更新验证 96 个程序文件，替换其中 10 个；记录中的 Claude Code 进程均仍在运行。
- **更新、源码上传、CI、发布均已完成，没有交付阻塞。** 最终交接回填另作仅文档提交；产品、标签、安装包与成功 CI 仍固定对应功能提交，不把文档 HEAD 当成另一次构建。

## 1. 项目与本轮任务

Claude-Local 是独立维护的 Windows x64 桌面产品，主程序 `claude-local.exe`，标识 `ai.local.claude-local`，用户数据按用户存放在 `%APPDATA%/ai.local.claude-local`。功能为加密身份备份/切换、被动额度观察、独立 Token 用量统计、环境配置与可选的伴生浏览器。

技术栈是 Tauri/Rust 原生层、React/TypeScript 界面，以及 Python 被动采集/额度账本写入。5h/7d 额度和 Token 用量统计是独立数据链。浏览器只由明确用户操作或 `--browser` 启动；普通启动不打开浏览器，默认身份管理页，只记忆白名单页面。不添加上游同步或官方应用更新源。

用户本轮先要求阅读交接；随后反馈保存账号 5h 到重置时间后变成未知，要求调研修复；再要求按钮/账号下拉框缩小、颜色统一及电脑环境双列卡片；最后明确授权「完成更新、上传等操作」。上述工作已一起交付为 0.1.6。

## 2. 已交付行为与代码定位

### 2.1 到期后明确预计恢复

原 0.1.5 保守逻辑会在到期时清空 usage/reset 并标 unknown，前端也拒绝过期值，导致可信旧重置依据一并丢失。0.1.6 新增逐窗 `reset_inferred` 来源：

- 只有可信 `server_anchor`、存在真实观测、观测严格早于 reset、且 reset 已到期时，才显示 0% 已用 / 100% 剩余，标注「预计已恢复」。
- 保存原始过去的 reset 边界和观测时间；UI 不把它当成下一重置时间，不把当前计算/归档保存时间当成新观测。纯 `local_estimate` 或无依据窗口到期仍未知。
- 新的实际窗口优先；旧耗尽锚点、另一窗口时间或旧推定不得覆盖新的实际消耗。5h/7d 各自判断来源与时间。推定值不参与自动账号推荐。
- 从账号/组织严格匹配的原始缓存/账本恢复旧版已清空的证据。额度摘要版本升至 **6** 触发现有惰性回填；没有重生成身份 ID、密钥或浏览器种子。
- 身份页增加可见时的本地显示时钟，静置跨过 reset 即变化；原生读取仍为每小时或手动，没有新增 OAuth 查询。

规则核心为 `src-tauri/src/quota_core.rs`，原生读取/兼容在 `src-tauri/src/identities/profile.rs`；Python 契约和兼容路径在 `scripts/claude_quota.py`；前端模型与呈现在 `src/identity-quota.ts`、`identity-model.ts`、`identities.tsx` 和双语目录。

离线无法确认其他设备是否继续使用账号，因此 100% 是有明确标注的本地预计值。官方现行说明确认五小时会话额度重置，但本实现不依赖未证实的新窗口起算规则，也不自行滚动出未来倒计时。

### 2.2 紧凑控件与电脑环境布局

- 普通操作使用现有 `secondary` 中性皮肤、共享 28px 高和 10px 水平内距，按文字占宽。移除网络按钮 128px 最小宽度；实测「复制链接」68×28px、「复制提示词」80×28px。
- 账号筛选随选中文字占宽，短选项不预留大空白；长名最多 220px，选项弹层保持可读宽度。实测「全部」72×28px。
- 电脑环境的时区/语言为等宽圆角卡片，标题与状态徽章、当前观测、目标选择和紧凑按钮分层；定位为下方全宽小横条。内容宽度不足 572px 时改为单列，保留草稿/实际状态、授权、禁用和任务锁。
- 深色、英文及经典/紧凑侧栏均已验证。危险确认保留红色；图标、导航和 180×286 身份工牌内的专用几何保留。

主要文件为 `src/style.css`、`system.tsx`、`usage-statistics.tsx/css`、`vps.tsx`、`browser.tsx`、`browser-start.tsx`、`claude-residue-panel.tsx`、`identities.tsx`。未修改 vendor 原语或依赖，不需要通过重装依赖刷新组件副本。

## 3. 架构与格式边界

Python 仍是 `quota_ledger` 唯一写入者，保留跨进程锁、锁内重读和 atomic replace；Rust UI 只读账本并在内存合并。GUI 与随包脚本复用 schema 1 的 `--quota-core` / `merge_windows` 有界 JSON 协议，最多 1MiB / 256 窗口，不接账号正文/路径、不读文件或联网；入口早于 Tauri 与单实例初始化。安装布局的 Rust 核心失败时中止写入，不静默回退；独立旧脚本缺固定 sibling 程序时明确报告 `legacy_python`。

SQLite `user_version=3`、BAGAID01、`.baga` 编码、账号 HMAC、归档密钥和 legacy 浏览器种子域保持不变。Token 用量使用独立原生账本，不能与额度链混用。0.1.4/0.1.5 的隐私桥、设备标识保护、历史会话不自动改写和逐窗证据兼容继续保留。

安装包只包含公开采集脚本，不包含 Python/cryptography 运行时；没有自动修改已有 statusLine。随包脚本存在、后端为 Rust，不表示旧外部 hook 已迁移。固定 iKuuu/Kookeey 分发链接仍是 copy-only，不提供安装者编辑或自动跳转。

## 4. 验证与本机更新证据

- Rust core 7 项、profile quota regression 12 项；Python 31 项（真实 debug Rust 子进程、legacy 对照、推定持久化往返、失败不写入等）；Bun 额度/双语 12 项通过。
- 固定时钟额度 GUI 6 组通过：`node --experimental-strip-types scripts/test-identities-ui.ts --quota-reset-only`。另有中英文网络/浏览/电脑/用量及 720px 深色两种侧栏共 10 个隔离视图通过。
- TypeScript/Vite 生产构建、普通 debug Rust 构建、正式 Windows `custom-protocol` 中立构建通过。CI 在临时 Windows runner 中完成前端、原生、浏览器准备、额度/迁移和 Windows CLI 全部步骤。
- 包审计合成 9 项、更新器合成 8 组通过。正式包解包 103 文件，原有 13 项私密标记零发现。
- 安装包 `Claude-Local_0.1.6_x64-setup.exe`，133.43 MiB；SHA-256：`05af14d19e56a5cfd8782ed8f45dc140b6726134f627c3e9adf5e004a6a5ba28`。
- 本机主程序 SHA-256：`3bfb0e087ade2ab0c089756f9b4654f65d9a01daffa81537aa4942c32b140142`。文件版本 0.1.6，运行窗口已核验。
- 更新器先在旧 GUI 运行期间核验正式版核心管道，再备份/哈希、替换 10 个变更文件、重启自己的主程序；回执 `updated`、`quotaCoreSmoke=pass`、`missingClaudePids=[]`，安装版采集脚本后端 `rust`。未切换真实身份或清理保险库/浏览器资料。

本轮实机验证是程序文件/版本/窗口和只读后端报告；额度边界验证使用合成数据与隔离 GUI，没有通过真实账号切换做测试。文件式更新与 NSIS 解包审计不等于实际安装/升级/卸载验收；系统相关验收只在一次性 Windows 环境做。

本地证据均在 ignored 目录：

- `.local/last-local-update.json`：当前安装、备份与进程回执；上轮回执另保存于本轮 release 目录。
- `.local/release-0.1.6/`：source/build/CI/prepared-assets/published/verification 回执、精确提交源码 ZIP、独立下载目录和私有日志。最终状态 `updated-and-published`。
- `.local/tasks/20261022-quota-reset/`：额度合成测试、GUI 报告和裁剪/合成截图。
- `.local/tasks/20261022-ui-controls/`：10 视图测量记录及页面预览。
- `.local/tasks/20261022-release-0.1.6/`：本次交付计划和进度。
- `.local/tools/complete-local-update-0.1.6.ps1`：保留原 helper 的版本副本；同样的审计/备份/精确进程/回滚边界，核心探针已匹配新推定规则。无需为了结束会话再次构建或更新。

## 5. 提交、CI 与发布状态

仓库 `yq04/Claude-Local` 保持私有，默认分支 `main`。功能提交为 `26f60efeb11913e866d9e431363f596d7b071e03`；`v0.1.5` 及其附件原样保留。

- 发布：https://github.com/yq04/Claude-Local/releases/tag/v0.1.6，非草稿、预发布，八附件下载哈希全部匹配。
- CI：https://github.com/yq04/Claude-Local/actions/runs/39756404149，headSha 为上述功能提交，结论 success。
- 八附件：安装包、SHA256SUMS、隐私审计、资源清单、0.1.6 更新说明、功能提交源码 ZIP、LICENSE、NOTICE。
- 实际流程：35 个明确产品/说明文件非强制推送 → 同提交 CI 成功 → 八附件草稿上传 → 独立下载/逐项 SHA-256 → 发布并核对标签、附件和仓库隐私。

最终交接仅文档回填另作提交，不重跑全量源码 CI。标签/安装包/源码 ZIP 固定对应已验证功能提交；会话关闭后的最新说明以 main 的 HANDOFF.md 为准。

## 6. 后续可选工作

本轮没有遗留交付阻塞。无用户新任务时不要重复构建、部署、覆盖附件或清理工作区；后续产品改动走新版本。

后续可在一次性 Windows VM/临时 runner 验收 0.1.5 → 0.1.6 的 NSIS 实际升级、占用拦截、卸载与数据保留。继续 Rust 化时先迁移纯计算并配跨语言 fixture，保持唯一账本写入者；自动接入采集前需要受控 Python/cryptography 分发与旧 hook 兼容，不可自动覆盖配置。

若转公开，仍需按 NOTICE.md、docs/DISTRIBUTION.md 清点 Cromma UI 和 Chromium 等第三方许可；私有仓库不消除分发义务，保留原 MIT 版权和全部第三方声明。

## 7. 必须保留的执行纪律

1. 可信 reset 到期可以明确推定恢复，但不能冒充新服务端观测/未来 reset。纯本地估算的窗口边界不够证明恢复；预计值不参与推荐，另一个窗口仍独立。
2. 归档/计算时间不是观测时间，不能借另一窗的新时间证明当前窗。旧证据回填必须严格账号与组织隔离，新的实际消耗优先。
3. writer 先锁、重读、调用核心再 atomic replace；Rust UI 不写额度账本。新增资源须同步白名单/部署映射，不打包 scripts 整目录或用户资料。
4. 正式版必须 custom-protocol、中立 Cargo root 与完整隐私审计，Windows release 管道须实测；debug 成功不足以证明 release 管道可用。
5. 不中断 claude.exe。更新只核验并重启自己的精确主程序，先备份/哈希、失败回滚；不做真实切号/资料清理，不用 stash/reset/restore/clean 清场。
6. 复用 Cromma UI 原语；修改 vendor 时才需依赖重装/预构建刷新。电脑网格不能通过自身容器查询改变自身列数，查询容器在页面层；普通动作缩窄不得挤坏工牌、图标和警告确认。
7. GUI 验证使用实际 DOM、固定时钟和 fake IPC；测试截图不等于实机账号额度已确认。验证与改动对齐，通过后推进交付，不扩做无关多轮审查。
8. Windows 只用 pwsh7；functions.exec 禁止 notify/yield_control，不输出账号、凭据、原始 statusLine 或私密探针/个人安装路径。

## 8. 工作区归属与新会话起步

`AGENTS.md` 既有本地修改不是产品提交，不暂存。未跟踪 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/` 原样保留，不删除、不移动、不提交。`.local/`、真实归档、数据库、账本、凭据、安装包和机器笔记不进 Git。

新会话先读本文件和根/相关目录 CLAUDE.md，再只读核对 git status、main、v0.1.6、成功 CI 与本轮回执；不能把既有本地规则/临时目录当作未完成产品工作，也不要再执行更新来刷新交接。
