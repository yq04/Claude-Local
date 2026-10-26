<!--
[INPUT]: Verified v0.1.0 private prerelease, matching local NSIS payload, passing Windows CI, owner requests and retained private evidence.
[OUTPUT]: Context-free project/task status, completed work, remaining gates, next steps and non-negotiable pitfalls.
[POS]: Repository-root handoff; credentials, account identifiers, machine paths and process receipts remain in ignored .local/.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only changes never rebuild binaries, replace released assets or move product tags.
-->
# Claude-Local 新会话交接（0.1.0）

更新：2026-10-26，America/New_York。本文是本会话结束时的统一状态，取代旧交接中相互叠加的历史描述。新会话先读本文、根 `AGENTS.md` / `CLAUDE.md`，改模块前再读对应目录 `CLAUDE.md` 和源码头部。

**当前结论：0.1.0 已完成源码修复、本机更新、Windows NSIS 打包、审计和 GitHub 上传。仓库仍私有，Release 是非草稿预发布。当前没有未解决的构建、CI 或上传阻塞；真实账号权限、真实安装/降级验收，以及对外公开准备仍有明确未完成项。**

## 1. 我们在做什么任务

Claude-Local 是基于 CCBaga 的 MIT 项目代码演进、独立维护的 Windows 10/11 x64 桌面工具。React/TypeScript 负责界面，Tauri/Rust 管理原生事务与浏览器，Python 负责额度账本采集/写入。主程序 `claude-local.exe`，应用标识 `ai.local.claude-local`，伴生浏览器注册名 `Claude-Local-Browser`。资料按用户保存在 `%APPDATA%/ai.local.claude-local`；这不是操作系统账号沙箱。

产品硬边界：默认被动额度同步，不能新增默认 OAuth usage 轮询、自动刷新共享授权或由额度助手写 `.claude.json`；Python 账本单写，跨进程锁、原子替换和新锚点优先保持。浏览器只由明确用户操作或 `--browser` 启动，普通启动不拉起。兼容 `BAGAID01`、`.baga`、身份库 `user_version=3`、账号 HMAC 和 legacy CCBaga/browser seed-domain，不能重生成身份/密钥/种子。迁移仅复制到新私有目标并验证，保留源资料。固定 iKuuu/Kookeey 推广链接获用户授权但仅复制，不提供收件人编辑器或自动外跳；不加 upstream、官方应用更新源或自动公开发行流程。

本会话依次完成了这些用户请求：

1. 阅读原 HANDOFF，核查已启用的自动续杯有没有实际效果。
2. 使用 `astra-plan` 调研现存功能问题，并参考 GitHub 项目形成优化方案；用户随后授权实施。
3. 将 Agent Reach 从 1.5.0 升级到 1.6.0，保留原配置和密钥，刷新技能；这是开发工具升级，不是产品依赖。
4. 比较 CCBaga，准备未来公开仓库；用户希望公开首版从 0.1.0 开始，已同步产品版本并准备精简副本/清理清单。
5. 修复“网页登录后仍要求授权、统一重试没解释、手动唤醒无反应”的问题，并实际更新本机程序。
6. 按用户“全权负责”的要求，补齐安装包审计、源码/标签推送和 GitHub Release 上传。
7. 最后重写本文，使完全没有上下文的新会话能够接手。

交接整理期间用户又补充：一个账号网页可进入，但 CLI 显示未登录，浏览器实测 18/20。只读诊断已确认当前默认 CLI 本地状态 `loggedIn=false`、`authMethod=none`；该账号的当前保存摘要缺少授权元数据。**这不证明加密归档一定为空，也不证明被封禁。** 此新增问题的下一步是账号持有人完成真正的 CLI 登录；没有自动发起授权或改账号。环境两项未知及展示误导另见第3节，尚未改源码。

下一会话不应从“还没更新本机/还没打包上传”重新开始，也不应把“准备公开”当作已授权立即改变仓库可见性或删除历史。

## 2. 已完成了什么

### 2.1 唯一有效的发布与本机回执

- 开发分支：`feature/functional-reliability-20261023`。
- 产品标签：`v0.1.0`，固定源码提交 `ff6bc8128de0732ca893afbdb76b1d7156f76a8a`。
- 本次交接重写前，最新已推送的交付文档提交为 `5ffeb33`；之后纯文档提交使 HEAD 前进属于正常情况，不能移动产品标签。
- `origin/main` 和远端工作分支已快进更新；本地 `main` 不一定同步，不要为了接手随便切分支、reset 或 restore。
- [0.1.0 预发布页面](https://github.com/yq04/Claude-Local/releases/tag/v0.1.0)。Release 已发布，`draft=false`、`prerelease=true`；仓库 `yq04/Claude-Local` 仍是 private。
- [下载 Windows x64 安装器](https://github.com/yq04/Claude-Local/releases/download/v0.1.0/Claude-Local_0.1.0_x64-setup.exe)，需要仓库访问权限。附件只有一个安装器，未上传私有探针、用户资料或工作站备份。
- 文件 `Claude-Local_0.1.0_x64-setup.exe`，**140,504,677 字节**，SHA256：`37bfd3cbe1653dfaff9412fb4e2324304db44841c606d5fae480268d11bba1ec`。GitHub 资产大小和服务端 digest 已精确核对。
- 最终中性构建启用 `custom-protocol`，只读解包审计 **109 文件、13 项原始外部隐私探针、0 发现**。NSIS 真实生成模板的英/简/繁三语编译和保留资料守卫验证通过。
- 本机已与安装器内的 **102 项应用文件**核对一致；最终只需替换宿主和归档脚本两项，先备份/hash，再将宿主最后替换并重新打开。其余 7 项是 NSIS 自用插件/卸载器，不用于文件式应用更新。
- 本机版本 **0.1.0**，宿主与安装器内 NSS 宿主字节一致，SHA256：`d509366aa0080b38da28fcad78774dc1cc55c56cdc0f19cb8436d8bb434aac4e`。
- 中性构建原始 UNK 宿主 SHA256：`b0e04d5fdba5f9f685256b644fc18a582eab1c85a4dabb1ea15799500d59daa8`。Tauri 包格式标记有经审计的 **3 字节 UNK→NSS 转换**，不能把两个 hash 的正常差异当成代码不一致，也不要自行改造二进制。
- 本机更新前后的 Claude Code 进程及创建时间保持，`missingClaudeCount=0`。未终止浏览器、未清理登录资料、未真实切号；包内宿主的 `--quota-core` 纯 JSON 离线冒烟通过。

完整回执：[RELEASE_VERIFICATION_0.1.0.md](docs/RELEASE_VERIFICATION_0.1.0.md)。本机实际安装路径、PID、备份目录和完整机器日志只在私有回执中保存，不再写入本交接。

### 2.2 Astra 优化已实施，不是待执行方案

方案在 [04-ASTRA-OPTIMIZATION-PLAN.md](docs/plans/2026-10-25-functional-audit/04-ASTRA-OPTIMIZATION-PLAN.md)，实际实施见 [05-EXECUTION-RESULTS.md](docs/plans/2026-10-25-functional-audit/05-EXECUTION-RESULTS.md)。04 中的 pending 是规划时历史；早期 06 源码候选 hash 也不是当前发行 hash。

已完成：

- **应用进程内唯一原生调度器**：移除身份页 React 自动唤醒 timer。切页或隐藏到托盘继续工作，真正退出应用后停止；不添加 Windows 服务或计划任务。前端只迁移配置、订阅快照和提交显式设置。
- **严格成功语义**：只有冻结账号下已提交的新鲜未来 5h reset，且晚于目标过期 reset，才确认 `new_5h_confirmed`。直接使用返回的新 reset，避免 `setState` 后立即读旧 ref；普通 updated、cached、7d-only 不算新 5h 成功。
- **失败和未知保护**：所有真实尝试纳入共享节奏；派发前持久化未知状态，崩溃后不立即重放 POST。只有同账号、独立 5h 观测时钟足够新且 reset 有效的服务端被动锚点可以解除未知；本地估算/旧观测不能解除。
- **明确 opt-in 和持久化反馈**：旧 localStorage 白名单迁移到原生私有设置，原键保留；保存失败不假装启用。生效时段支持跨午夜，保留逐账号暂停、周额度门禁、运行中 CLI 保护和主力号预热阈值。
- **退避取舍**：同账号保留 3–10 分钟、25–60 分钟、连续空转后按需待命；未证实独立出口的账号统一按共用路由 **6–13 分钟**错峰，每次尝试只抽样一次并保存。旧状态无法恢复原随机值时保守迁移，不能把“填了代理字符串”当作独立出口证明。
- **有限匿名审计**：原生 `wakeup-audit.json` 记录触发类型、阶段、结果、时间、匿名槽及 reset；最多 200 项/30 天，白名单且读取前限长。审计失败与网络结果分开，不抹掉已确认成功；Python 仍是额度账本唯一写入者。
- **浏览器核验真实性**：报告 schema=1、固定必需指标 ID，旧报告/缺项/未知不整体通过。ISP 未识别不推定住宅。真实入口调用的 WebRTC 采集器不使用 STUN，仅短时本地候选观察，异常/超时为未知；音频项只说明接口能力。
- **Effort 增量一致性**：usage ledger 的 `files.effort/parser_version` 与 offset/guard 同事务保存。截断、改写、跨文件时重置；静止旧文件不全量重扫，旧游标追加时仅恢复紧邻 cursor 的尾部 64KiB，缺证据保持未知。
- 已有用量分析、模型胶囊、HUD、Windows 浏览器缓存 DACL 继承自愈、单层工作区毛玻璃、系统修改恢复、加密全库备份/救援、手工会话交接和双语界面继续保留。

### 2.3 用户截图中的连接/唤醒问题已修复并交付

用户曾报告：打开账号绑定浏览器完成网站登录后仍提示授权，统一重试无用，手动唤醒没有反应。调查确认当时实际运行的是旧 0.3.1，后续源码尚未安装；本轮已完成成套更新。

根因与修正：

1. **网页登录不是 CLI 授权。** 网站会话可用于网页额度读取，不能更新归档中的 Claude Code OAuth/messages 凭据。
2. **队列污染。** 手动唤醒失败曾写入网页查询的 `connectionHistory`，网页查询成功后又被 CLI 错误推回“去网站登录”。现在两条结果链分开。
3. **浏览器错误被吞。** 原生补充查询失败曾只返回原 OAuth 错误；现在 `browser_fallback_status` 保留受限的具体网页失败，OAuth 事实仍独立保存。只有有效 5h/7d 更新成功提交才清查询失败。
4. **手动门禁反馈模糊。** `stage=scheduler` 配合受控 `reason/retry_at_ms` 展示具体阻断及最大等待时间；冷却/未知/授权受阻按钮不会假忙或无解释。
5. **恢复仍被旧退避挡住。** “允许一次恢复尝试”仅释放已确认 auth_required 的账号授权退避；不清全局错峰、429 或未知 POST 保护，也不自动更新凭据。

真实 MV3→worker→回环以及 native→实际 Python 单写账本的合成链已验证。**没有代用户重新登录，没有发送真实账号查询/唤醒来验收，所以不能宣称真实账号授权已恢复。** 新反馈需由账号持有人操作后确认。用户说明：[CONNECTION_RECOVERY.md](docs/CONNECTION_RECOVERY.md)。

### 2.4 发布 CI 兼容问题也已修复

Windows CI 使用 bsdtar/libarchive 3.8.9，成功转换（exit=0）时的空 uname/gname 警告从 `to UTF-8` 改成 `to current locale`，被旧严格白名单误拒绝。先用 test-only 诊断拿到实际工具版本/exit/有限 stderr，再精确兼容这两种措辞；真实属主、未知警告、非零退出、认证尾帧、路径和大小限制仍拒绝。

最终 [CI 40270529041](https://github.com/yq04/Claude-Local/actions/runs/40270529041) 对 `ff6bc81` 全部成功：Bun 122 项、Rust 主测试 243 项及一项子进程检查，所有离线 Python/运行资源/迁移/Windows CLI 套件通过。此前连接修复的定向 Rust 45、Bun 29、GUI `--wakeup-only` 11 项及真实 MV3 合成检查也通过；不要把局部测试记录当成新的真实账号或安装验收。

### 2.5 版本、CCBaga 对比与公开准备

- 用户希望公开首版重新从 **0.1.0** 开始，四处产品版本已同步；现已发布此新标签。旧 `v0.3.0/v0.3.1` 保留，不因版本编号重置改变应用 ID、资料路径、归档/数据库格式或已有身份。
- [CCBaga 对比](docs/CCBAGA_COMPARISON.md) 基于外部固定提交 `bdfb90c` / v0.2.49。Claude-Local 主要优势在额度/用量与 Windows 工作流；CCBaga 优势在多平台发行、单账号密码便携包。最值得后续借鉴的是 Windows→Windows 单身份 `.bagapack` 导入导出和安装排障体验；**尚未实现，不要写成现有功能**。不加 upstream、不自动同步、不套用对方更新源或发布链。
- Agent Reach 已升级到 **1.6.0（uv 隔离安装）**，原配置保留。它不成为产品运行依赖，不因新会话开始而重新安装。
- 已准备旧资料归档和精确清理清单，但**43 份历史文档的实际移除尚未获确认**。用户后续“全权完成打包上传”没有被扩大成删除历史或转公开授权。
- 精简源码预览曾生成 322 个文件、排除 69 个内部资料/目录图文件，原件保留。**该副本产生于后续连接修复/归档修复之前，已不是当前发行源，也未获公开分发放行。**

## 3. 当前卡在哪、遗留什么

**没有构建、测试或上传阻塞。** 以下是明确未完成/未授权事项，不是悄悄跳过的技术失败：

1. **当前新增的 CLI 未登录问题**：已执行官方本地只读 `claude auth status --json`，退出码1，白名单投影为 `loggedIn=false`、`authMethod=none`、`apiProvider=firstParty`；未输出邮箱/组织/凭据。当前绑定身份的摘要没有 CLI 授权元数据；文件存在性不代表内容有效，也没有检查真实凭据正文或加密归档。CLI 登录尚需本人执行，不能凭网页登录推定已恢复，也不能仅凭此判断封禁。已验证安装版本支持 `claude auth login --claudeai`；用户在正确账号的授权页完成登录、用 `claude auth status` 确认后，还应通过应用现有保存身份流程更新快照，避免默认CLI目录已更新、归档仍旧。禁止后台代登录、读Cookie或轮换共享授权。
2. **18/20 环境结果是两项未知，不是登录检查**：截图未确认出口属性和 WebRTC 本地候选。分类器要求明确 `hosting=false` 才给非机房结果；ASN/运营商名称存在本身不够。RTC 当前无STUN、300ms，接口失败或未完成统一未知，不能从截图分清具体哪条路径。总体阶段把未知也归入 failed 并显示红叉，有误导空间；可考虑单列“检测未完成”和完善采集完成事件/期限，但必须先合成验证，不能把未知改绿、白名单真实ASN，或臆称已发现泄漏。它们与 CLI `Not logged in` 是独立问题。本轮只读诊断，未改浏览器源码、重新打包或发真实探测。
3. **真实 Windows 运行验收**：没有在个人机器执行 NSIS 安装、卸载、0.3.x→0.1.0 降级、系统修改或睡眠/恢复实验。三语编译、解包及文件式更新不替代这些验收；只能在一次性 Windows 环境做。
4. **对外公开许可依据**：Cromma UI 复制子集的适用授权未充分确认，15 个 Pika 图标的 Free/Paid/取得范围未逐个核实，完整 Chromium 二进制 notices/credits 仍需专门核对。顶层 MIT、压缩 JS、移除图标 export 名称或“对方仓库已公开”都不能替代实际依据；也不要把未核实直接写成已证明违法。见 [NOTICE](NOTICE.md)、[分发说明](docs/DISTRIBUTION.md)。
5. **公开历史与清理审批**：仓库仍私有；删除当前文件不会删除历史 blob、其他分支/标签和 Release 附件。此前受控普通 Markdown 历史检查发现旧 HANDOFF 中有机器路径，不是完整秘密审计。需要单独选择“审查整理现有仓库”还是“保留私有开发档案，另建审核后公开快照”。不得擅自强推、改史、移标签或删 Release。
6. **43 文件清单已发生时间漂移**：HANDOFF、版本说明和交付文档之后又有更新，旧清单/备份 hash 不能不复核就用于删除。即使以后获得具体确认，执行前也要重新核对范围与备份，保留当前必要交接。旧 Git Bundle 只覆盖创建时的历史，不包含后来全部修复/发布提交；改史前必须补齐最新备份。

工作树本次重写前仅有用户原 `AGENTS.md` 未提交修改（固定授权推广链接政策等）。这是用户资料，不要还原、删除、顺带提交或用 stash 暂藏。先前的 `.planning/`、`.rivet/`、`--help/`、`docs/superpowers/`、早期 quota 计划与编码辅助资料已忽略/私下保留，并未被当垃圾清空。

## 4. 下一步计划与代码入口

### 新会话第一步

只读执行 `git status --short`、`git log -n 5 --oneline`，核对用户新指令及本机/远端当前状态。产品 `v0.1.0` 已交付，不要因旧计划或文档提交在 tag 之后而重新打包。实际安装路径从私有 deployment receipt 获取，不能硬编码个人路径到 tracked 文件。

### 按用户后续需求推进

- **若用户仍反馈授权/唤醒问题**：先看 `browser_fallback_status`、`stage/reason/retry_at_ms` 和 native snapshot，确认是否新 0.1.0、是否绑定正确账号/组织、是否全局冷却/未知保护，再用合成场景复现。需要用户官方登录时说明是哪套授权，不无限引导网页登录。
- **新增问题优先顺序**：先由持有人完成当前账号的 CLI 登录并确认本地状态，再更新应用身份快照；若登录后发送消息仍失败，依据新错误判断权限/网络，而不是把网页登录等同可用。环境18/20的未知展示与RTC采集可独立排期，先验证再改，不能以“账号可能有问题”为理由自动切号或清理。
- **若继续公开准备**：先处理许可依据/替换方案和历史公开面，更新当前精简副本；对已备份文件的实际移除仍按具体清单确认。不把“全权负责发布”解释成“可以公开所有历史/覆盖已有文件/删除用户规划”。
- **若补安装验收**：在一次性 Windows runner/虚拟机验证新装、取消/失败、保留资料升级和版本倒退，不在用户机运行 CI-only 系统测试。
- **若做功能增强**：优先考虑单身份便携包与首次接入/排障体验。可选通知、成本估算、多平台正式支持尚未做，先按需求定范围，不一次重写整个 UI。
- **若发布后续修复**：按新版本递增，成套宿主/前端/helper/扩展交付；新包重新审计。不得覆盖现有 v0.1.0 标签/资产，不给文档更新重建安装包。

核心入口：

- `src-tauri/src/identities/wakeup.rs` / `wakeup_tests.rs`：唯一原生调度、私有持久计划、手动/自动共享预算、未知对账和一次恢复。
- `src-tauri/src/identities/online.rs` / `online_native_chain_tests.rs`：冻结目标、Python 探针/子进程、提交复核、批次、scheduler 受限回执和 browser fallback 编排。
- `scripts/claude_quota_online.py`、`quota_archive.py`：实际请求、最小认证归档投影、额度提交与新版 tar 兼容；`quota_runtime.py` 为无账号能力探针。
- `src/identities.tsx`、`identity-connections.tsx`、`identity-online-quota.ts`：网页查询队列与唤醒反馈分开、门禁倒计时、native 配置/快照桥、双语契约。
- `browser-runtime/quota-bridge/{content,background}.js`、`src-tauri/src/browser/quota_existing.rs` / `quota_bridge.rs`：已有绑定网页资料、一次性票据/回环、受限失败和有效额度导入。
- `src-tauri/src/identities/usage.rs` / `usage_tests.rs`：独立用量账本、增量游标/Effort、去重/归属/IANA 时区。
- `src/browser-verification.ts`、`browser-webrtc.ts`、`src-tauri/src/browser/network.rs`：版本化指标、实际采集器与前后端未知语义。
- `src-tauri/src/identities/private.rs`、`src-tauri/src/browser/profile.rs`：私有路径/ACL 和保留 AppContainer SID 的继承自愈。
- `scripts/build-windows-share.ps1` / `audit-windows-package.py`、`src-tauri/windows/installer-hooks.nsh`：中性构建、只读包审计与保留资料的安装守卫。

按改动选最小验证，不把下面全部当成每次固定大回归：

```powershell
bun test src/identity-connections.test.ts src/identity-online-quota.test.ts src/i18n.test.ts
bun scripts/test-identities-ui.ts --wakeup-only
python scripts/test-quota-archive.py
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol identities::online::
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol identities::wakeup::
bun run build
```

UI/Vite 脚本必须串行；真实宿主 release 要 `--features custom-protocol`。已有绿色测试不因接手、改文档或换模型而重跑。CI 若需完整系统相关测试，只用隔离 hosted runner。

## 5. 绝对不要再踩的坑

### 授权、额度与调度

- 网页 Cookie/session 与 CLI OAuth/messages 凭据独立；浏览器更新额度不证明 CLI 唤醒授权已恢复。
- 唤醒失败不能重新塞入网页查询恢复队列；失败细节不能被吞成一条泛“重新授权”。保持 `browser_fallback_status` 与 OAuth 状态分开。
- `updated`/cached/7d-only 不等于确认新 5h。`source` 目前仍是 **oauth/browser**；不要照旧文档捏造 `source=wakeup_messages`，唤醒效果看 `wakeup_effect` 和新 reset。
- `await read()` / `setState(next)` 后立即读取旧 React ref 不是新数据，会破坏空转轮数。使用已提交结果/直接返回值，不加固定 sleep 或 `flushSync` 掩盖。
- 不把 scheduler 交回页面 timer；不在每个 tick 重抽随机延迟；失败也计共享尝试预算。进程存在不代表用户实际用了额度。
- 不清 429、全局冷却或未知 POST 来“让按钮生效”。一次恢复只清已证授权退避，未知结果不自动重发。跨崩溃不承诺网络 exactly-once。
- 用户原开关状态要保存；不得为验收擅自启用、真实查询、唤醒、切号或结束 CLI。本次迁移最后可见开关为 false，只是当时状态，新会话需只读核对，不能永久假设。
- HTTP header 的 reset 可能是 Unix 秒的数字字符串，先按数字解析；缺少新鲜独立 5h 证据不能借 7d/global observed 时间冒充。

### 统计、浏览器和界面

- Effort 上下文与游标同事务，失效/跨文件清空；64KiB 尾部没有声明就未知，不能读文件头跨空隙猜档位，不能为了修上下文删账本/改原归属。
- 未知 Effort 事件仍计模型总量，当前模型档位列表省略空桶。测试直接断言 SQLite 事实/总量，不强行 `find(empty).unwrap()` 或改变 UI 造空桶。
- 固定必需指标/报告版本缺失为未知，不能对现有数组 `every(true)` 就通过。无 STUN 本地候选观察不证明 DNS/公网零泄漏；默认采样率不证明音频真实性。
- Chromium 缓存 PermissionDenied 需合并继承权限，保留 AppContainer SID；不要对 Default/Cache 粗暴调用独占 `private::lock`。
- 壁纸模糊只在 workspace/sidebar 一层，内部卡片不重复 blur；保留 HUD 固定宽度和原生 min/max/size 更新顺序。
- 双语 YAML 同键同插槽，JSX 不夹裸中文；改译文同步无障碍定位器。身份页不新增 combobox，普通 fixture 不得偷偷启用真实/native 后台请求。
- 多个 Vite GUI 脚本并发会争用依赖缓存引发 reload，测试必须串行；冷启动等待与产品逻辑失败分开诊断。

### 构建、交付与协作

- 新 Windows bsdtar 的 `current locale` 空属主警告属于已知精确兼容；未知警告或非零退出仍拒绝，不能一概忽略 stderr。
- 测试遇环境差异先抓有限、只含合成数据的工具版本/exit/stderr；不要输出归档明文/真实凭据，连续同方向失败要换调查方法。
- 中性构建只能准备公共 Cargo index/archive cache，不能带用户 Cargo 根配置/凭据/src 或 live 安装/浏览器资料作为包输入。原13隐私探针只通过私有路径传入审计，原文不入对话/Git。
- NSIS 解包 109 文件不等于本机要复制 109 文件；7 项安装器自身组件排除。采用既有 `Get-DeploymentPlan` 白名单，不把插件/卸载器复制到应用目录。Windows 相对路径先规范为 `/`，不要放宽路径边界去绕错误。
- 采用审计后的 NSS 宿主可精确匹配 setup；不能把 raw UNK 的正常三字节差异当损坏，也不能发送旧预修复安装器。最终安装器只认上述 `37bfd...` hash。
- 备份/阶段文件先验 hash，宿主最后替换，进程终止只允许复核 PID/路径/创建时间后的本产品；**维护不得停止 `claude.exe` 或浏览器，不清用户资料**。最好复用已有已验证事务工具，不在临时脚本上反复扩白名单。
- `.local/tools/` 是机器级私有工具，不是可随意复用的通用发布入口；旧“完整更新”脚本可能默认构建/探针/安装路径不同，先读参数。需要旧函数时只用 `-FunctionsOnly`，不直接执行旧版本整套流程。
- 简单/常规子任务默认 `gemini-3.8-flash high`，复杂跨模块升级 `gpt-6.1-sol high`，极难规划才按需 ultra；均 `fork_turns=none`。**不要再派 gpt-6-luna、gpt-6-astra、gpt-6-sol、gemini-4-argon 或任何 claude-* 子代理**。全局最新用户规则优先，不能从旧计划恢复被禁模型。
- `functions.exec` 禁止 `notify()` / `yield_control()`，进展用工具外 commentary；不可在子代理未结束时纯文本结束任务。按比例验证，通过即止，不发起无请求的多轮深审。
- 禁止 stash/reset/restore/clean 或强推清场；删除已有文档/改历史等先给具体范围并等待明确确认。原用户修改/未跟踪规划保留。
- **每次重写 HANDOFF 必须先归档到 `.local/handoff-backups/` 并校验 SHA256**。文档提交不重建产物、不移动标签；新版本发行不能覆盖已发布安装器。

## 6. 接手时按需读取的文件

- 产品与当前交付：[README](README.md)、[0.1.0说明](docs/RELEASE_NOTES_0.1.0.md)、[0.1.0核验](docs/RELEASE_VERIFICATION_0.1.0.md)、[连接恢复](docs/CONNECTION_RECOVERY.md)。
- 公开/借鉴：[PUBLIC_PREPARATION](docs/PUBLIC_PREPARATION.md)、[CCBAGA_COMPARISON](docs/CCBAGA_COMPARISON.md)、[NOTICE](NOTICE.md)、[DISTRIBUTION](docs/DISTRIBUTION.md)。
- 工程：[DEVELOPMENT](docs/DEVELOPMENT.md)、[USAGE_STATISTICS](docs/USAGE_STATISTICS.md)、相关目录 `CLAUDE.md`。
- Astra 本轮历史：[方案](docs/plans/2026-10-25-functional-audit/04-ASTRA-OPTIMIZATION-PLAN.md)、[实施](docs/plans/2026-10-25-functional-audit/05-EXECUTION-RESULTS.md)。旧记录只能作历史证据，不覆盖当前发布事实。

私有定位索引（文件可能含工作站路径或匿名运行数据，只投影必要字段）：

- `.local/tasks/20261026-release-0.1.0/`：`receipt-final.json`、`release-published.json`、`remote-draft-verified.json`、`deployment-receipt.json`、`ci-final.json`、`documentation-commit.json`；完整最新打包/发布/本机证据。
- 最终产物 `.local/artifacts/20261026T045011Z-8d9bc21614c648988167f04d686fcfe7/`；此前 `20261026T042807Z-a7a5349827f446eb94756bbdd3f76789` 是预修复包，未上传，勿误发。
- `.local/tasks/20261025-auth-repair/`：用户截图问题定位、原始0.1.0本机更新、定向测试与部署备份回执；其旧 ca5d... host hash 已被最终 d509... 取代。
- `.local/tasks/20261025-astra-execution/`：Astra 分批实现/验证、Agent Reach 原样安装报告及升级回执。
- `.local/tasks/20261025-public-preparation/`：`CLEANUP_APPROVAL.md`、`cleanup-removal-scope.json`、`cleanup-manifest.json`、旧 Git bundle 和候选 manifest。**43 文件没有删除确认，旧副本/hash/bundle需更新后再用。**
- `.local/tasks/20261025-functional-audit/` 与 `.local/research/`：早期只读调查/合成复现历史。
- `.local/tasks/` 下本次 CLI 登录诊断记录：只读状态白名单投影与浏览器源码诊断；子代理报告中的浏览器具体时序推测仍需实验验证，不能当真实网络证据，实际账号关联仅留私有目录。
- `.local/handoff-backups/`：每次交接改写前的完整备份；本次旧长文已校验归档，不再在 tracked 当前文档中堆叠相反的历史状态。

本次交接整理及其间新增问题诊断仅更新说明、读取受限摘要与官方CLI本地状态；不改变产品设计、凭据、用户资料、开关或发布包，不重启/替换应用及已有会话。
