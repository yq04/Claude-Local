<!--
[INPUT]: Read-only source inspection at 0.1.3 / 17779ea, existing synthetic-test sources and public official documentation accessed on 2026-10-21.
[OUTPUT]: Evidence-based findings, existing safeguards, practical recommendations and explicitly unverified risks.
[POS]: Review evidence for the pending plan; not a penetration test, live-account assessment or execution receipt.
[PROTOCOL]: Keep code facts separate from inferences and policy quotations; do not include credentials, identities, machine paths or raw session data.
-->
# 调研发现与优化建议

日期：2026-10-21。基线：0.1.3 / `17779ea`。本报告通过定向源码阅读、现有测试代码核查和官方资料调研形成，没有执行测试或验证真实账号。

## 范围与判断标准

保护对象包括登录状态、身份归档、原始会话、共享配置、浏览器资料和可识别的展示信息。重点防止误操作、无感改写、操作并发、失败后无法恢复，以及录屏截图时的隐私暴露。

同一 Windows 用户下的恶意程序、管理员控制和操作系统被攻破不属于本产品能完全隔离的边界。浏览器资料隔离、界面本地身份与服务端账号状态也是不同概念。

P0 表示先处理的行为正确性问题；P1 表示推荐的保护或体验改进；P2 表示条件性增强或独立试点。以下“已确认”指代码路径可以直接证明，并不代表真实数据已受影响；“待验证”不能写成已证实漏洞。

## 已有保护应当保留

- [身份归档认证](../../../src-tauri/src/identities/codec.rs)使用 `BAGAID01`、AES-256-GCM、随机数据密钥和分帧认证，拒绝篡改、截断与尾随数据。[归档读取](../../../src-tauri/src/identities/archive.rs)先在私有暂存区完整验收，再交给恢复流程。
- [身份文件事务](../../../src-tauri/src/identities/store.rs)协调 SQLite 恢复标记与文件操作；切换失败尝试回滚，恢复前另存当前状态，防止覆盖崩溃后产生的数据。它不是数据库与文件系统共同的单一原子事务。
- [私有文件层](../../../src-tauri/src/identities/private.rs)设置所有者和受限 ACL，检查链接、类型与所有者。[清理目标](../../../src-tauri/src/cleaner_targets.rs)有白名单、快照与路径限制，不能扩大成任意目录清理。
- [原生入口](../../../src-tauri/src/identities/mod.rs)共用进程内事务门；文件循环定期复查 Claude 进程。[数据库初始化](../../../src-tauri/src/identities/database.rs)的短锁和 `IMMEDIATE` 事务已有 Windows 并发回归，不应延长为数据库对象生命周期锁。
- [危险操作弹窗](../../../src/dialog.tsx)默认聚焦取消；身份删除和浏览器全清理已有不可撤销提示与勾选确认。
- [回环桥](../../../src-tauri/src/browser/server.rs)只监听 `127.0.0.1`，使用 24 随机字节令牌，限定并发、读取截止和正文大小；校验当前会话，限制资源路径，返回 `no-store`、`nosniff` 和 CSP。它不提供 Tauri 命令或任意文件接口。
- [额度与用量边界](../../../src-tauri/SECURITY.md)已区分 Python 额度账本和 Rust 用量统计；无 OAuth 用量轮询。浏览器显式启动、推广链接只复制、主程序无自动更新器等边界保持有效。

## 需要优先优化的行为

### S01 · P0 · 状态读取可能触发工作区修复

已确认：`identities/mod.rs:124` 的 `state()` 在记录缺账号键或额度摘要时尝试调用 `Store::open`；`store.rs:98` 在无恢复状态且 Claude 已停止时调用 `sanitize_cross_account_residue`。此路径来自 `identities_read`，并非仅存在于显式切换操作。

该函数不仅处理本应用索引，还会修改默认 Claude 工作区中的选定缓存和会话。因此不能把现有读取命令简单包装成“无副作用安全检查”。现有进程检查和恢复状态判断缩小了触发范围，但没有改变读路径包含维护的事实。

建议：把本应用私有索引初始化、摘要补齐与默认 Claude 工作区修改分开。页面读取不运行 sanitizer、会话修复或工作区清理；需要维护时返回有界提示，由明确的操作路径处理。初次创建本应用索引仍可按现有规则进行，不把“只读页面”误解释成整个应用目录零写入。

证据：[命令入口](../../../src-tauri/src/identities/mod.rs)，[Store::open](../../../src-tauri/src/identities/store.rs)，[sanitizer](../../../src-tauri/src/cleaner_identity.rs)。置信度高，未做真实运行复现。

### S02 · P0 · 历史保留与原始内容保留需要区分

已确认：`archive.rs:209` 的 `save_inner(reuse=true)` 在采集快照之前调用 sanitizer；`store.rs:628` 和 `:796` 在切换/恢复后再次调用。`cleaner_identity.rs:758`、`:898` 会按识别结果改写组织和邮箱提示，移除部分 thinking、回放/桥接记录，并处理未配对工具块。写入是原子替换，但原子替换不等于保留原件。

默认 `Policy` 的 `history/projects/settings` 等为 true，表示有关资料留在共享工作区；这不是每个账号拥有独立项目和会话的安全沙箱。`merge_kept_history` 还会保留已存在文件而只补缺失内容。单凭“文件仍在”不能证明内容逐字无损。

建议按入口文件的推荐 A 实施：读取和备份不改源会话；停止无感的跨账号会话内容转换，保留原始资料和原账号归档。旧会话跨账号续接不兼容时，提示新建会话。共享与隔离是用户明确的资料策略，不用“自动脱敏”代替对具体改动的说明。

既有归档不能被批量重写或宣称能恢复早已移除的内容。若未来确需兼容修复，只能单独设计为可选、保留原件的流程；不新增或强化以改写组织、签名、遥测规避检测的功能。

证据：[策略定义](../../../src-tauri/src/identities/mod.rs)，[保存入口](../../../src-tauri/src/identities/archive.rs)，[恢复和合并](../../../src-tauri/src/identities/store.rs)，[会话改写](../../../src-tauri/src/cleaner_identity.rs)。置信度高；源码注释中的服务端效果没有独立证据。

### S03 · P1 · 隐私打码在短邮箱、弹窗和伴生页存在缺口

已确认三个位置：

- `settings-model.ts:137` 的 `maskEmailAddress` 对 `@` 位于第 1 个索引的邮箱直接返回原文，故合成邮箱 `a@example.test` 在隐私模式仍完整显示。
- `identities.tsx:691` 在切换确认框直接拼接 `targetSummary.email`，没有调用主卡片使用的打码函数。
- `browser-start.tsx:80` 直接渲染邮箱；`BrowserContext` 没有隐私偏好。主程序 WebView 和独立 Chromium 的 `localStorage` 不共享，不能只在伴生页读取同一个键名解决。

建议修正现有 helper，审查正文、title、aria 与邮箱作为名称回退的路径。新增一个仅承载布尔隐私偏好的原生桥，使独立起始页使用已确认的隐私状态；状态未知或加载失败时先打码，防止闪现。原生返回伴生显示 DTO 时就按偏好裁剪邮箱，不能只靠 CSS 隐藏。

这是展示隐私改进，不是凭据隔离，也不承诺掩盖所有姓名、域名或用户自填别名。

证据：[helper](../../../src/settings-model.ts)，[身份弹窗](../../../src/identities.tsx)，[伴生入口](../../../src/browser-start.tsx)，[前端契约](../../../src/browser-model.ts)，[原生 Context](../../../src-tauri/src/browser/mod.rs)。置信度高。

### S04 · P1 · 删除前的进程明细与恢复目标应更明确

已确认：`identities.tsx` 的保存和切换弹窗展示 `state.sessions`；直接删除当前身份的确认框没有相同明细，而执行路径会先调用停止动作。应复用已有进程列表，显示 PID、入口和工作区，并在确认执行前重新检查状态。

恢复弹窗仅在 `review` 是对象时展示目标栏；`review === 'recovery'` 时没有显示将恢复的原身份。这里应展示 `state.recovery` 对应的原身份，而不是 SQLite 中上次尝试切换到的 `target`。原身份为空或已无法解析时应如实说明，不能猜成当前账号。

直接删除无新增备份、可能部分完成，这是明确的产品取舍，不是一个带回滚承诺的操作。建议补准确结果和检查入口，不暗中改为强制备份，也不把失败后的“刷新”当作自动重试删除。

证据：[弹窗和 remove](../../../src/identities.tsx)约 352、664、683、767 行，[delete/recover](../../../src-tauri/src/identities/store.rs)约 408、708 行。置信度高；不需要以真实 Claude 进程验证。

### S05 · P1 · 离线额度推算需要就地说明

已确认：`identities.tsx:59` 在重置时间过去后把 used 视作 0，进度条可显示剩余 100%。帮助中已有“本地记录、可能延迟、以服务为准”的说明，但用户在卡片看到的重置结果缺少就地推算提示。

建议在重置状态旁注明“按周期推算，待本地新快照校准”。优先复用已有重置时间和文案；如果当前摘要没有可信采集时间，就显示未知，不把归档保存时间当作服务端采集时间。保持每小时或手动刷新，不增加联网请求。

证据：[额度呈现](../../../src/identities.tsx)，[现有帮助](../../../src/help.tsx)，[额度契约](../../../src/identity-model.ts)。置信度高；不据此推断实际服务端额度错误。

### S06 · P1 · 浏览器检测结果需要时效和身份边界

已确认：原生快照在浏览器仍运行时保留既有 `report` 和 `report_received_at`；起始页每 10 秒刷新的是 `context`，不是重新测出口。界面虽显示回报时间，但没有测量时效分类。浏览器长时间不退出、网络由外部改变时，旧测量仍可能呈现为通过。

建议显示“上次测量通过”及时间；超过产品约定的提示阈值后标为“结果较旧，请重新实测”。建议首版阈值为 10 分钟，仅表示时效提示，不是服务端有效期或已发现异常。用户手动实测才进行新的出口请求，旧状态不自动触发轮询。

同时区分“本地资料已绑定”和“网站实际登录身份”。起始页可以显示本地别名，不能凭这个别名声称网页账号已一致；浏览环境主页面如需显示归属，要扩展原生 `Snapshot` 的有界摘要，不能引用一个目前不存在的 `state.identity` 字段。

证据：[快照](../../../src-tauri/src/browser/mod.rs)约 446 行，[起始页](../../../src/browser-start.tsx)约 61 行，[浏览环境](../../../src/browser.tsx)约 142、172 行，[核验模型](../../../src/browser-verification.ts)。置信度高；时效阈值是拟议产品规则。

### S07 · P1 · 帮助、宣传和统计文档需要与行为一致

已确认：帮助仍称快速配置能选择地区、直接执行指纹等操作，当前页面实际是状态概览与导航；帮助还描述了没有前端入口的一键换指纹。部分文案使用“防关联指纹”“全部验证通过后自动 Login”“零上游遥测”，容易被理解为对网站身份、授权完成或其他程序网络行为的保证。

建议使用“独立浏览器资料”“环境观测符合目标”“继续由 CLI 完成授权”等准确表述。核验仅覆盖已列项目，不证明匿名、账号可用或服务端接受。已有帮助中的“检测成功不代表账号可用”应保留，并在操作附近用短文案承接。

另外，`docs/USAGE_STATISTICS.md` 前半段和 `SECURITY.md` 仍描述未归属历史独立展示；后续 fallback 段落与当前 UI 已不同。统一说明显式 fallback 的本地聚合效果和原始事件归属保留，避免把所有记录都说成已核实归属。

证据：[帮助](../../../src/help.tsx)约 25、53 行，[浏览文案](../../../src/browser.tsx)约 148、183 行，[设置](../../../src/settings.tsx)约 128、258 行，[统计说明](../../../docs/USAGE_STATISTICS.md)，[安全说明](../../../src-tauri/SECURITY.md)。置信度高。

## 防御增强与验证缺口

### S08 · P1 · 回环桥可以加强请求约束

已确认现有 `handle` 检查随机路径令牌、方法、正文长度和当前会话；未见 Host/Origin 的显式限制，响应未设置 `Referrer-Policy` 或 `frame-ancestors`。

建议只接受实际监听地址和端口的 Host；存在 Origin 时必须匹配同源，报告 POST 按实际浏览器请求规范校验；增加 `Referrer-Policy: no-referrer`、`frame-ancestors 'none'`，拒绝歧义请求头。伴生地址文件的创建复用私有写入层，并保持会话失效与退出清理。

随机令牌、同源策略、CSP 和回环绑定已经提供重要保护。这是加固项，不是“无认证接口对公网开放”，也没有证明可跨账号读取或执行任意命令。来源字段不能代替令牌认证，手工 HTTP 客户端也能伪造 Origin。

证据：[server.rs](../../../src-tauri/src/browser/server.rs)约 58、92、166 行，[start.url 写入](../../../src-tauri/src/browser/mod.rs)约 205 行。置信度高，攻击可利用性未测试。

### S09 · P1/P2 · 恢复与并发保护需要补针对性证据

已有线程级初始化竞争、损坏归档、切换失败回滚、恢复前检查点和浏览器绑定测试。未在本次已读片段中看到按文件阶段退出子进程、重新打开 Store 后恢复的完整矩阵；这是覆盖待核验项，不能据此认定恢复失效。

`Cleaner::enter` 是进程内原子门，SQLite 写事务不覆盖完整文件切换。正常应用还有单实例插件，因此跨进程风险需要额外调用者能绕过正常入口的前提。建议先做临时目录双进程实验；若可以交错，增加覆盖完整修改操作的合作式 OS 锁。锁不能约束不配合的旧程序，更不能代替进程检查或恢复日志。

私有文件读取检查所有者和链接，但未见既有归档 DACL 每次重核验；创建时受限 ACL 和主密钥 `protect` 已存在。可先提供只读权限检查，再决定是否需要受控修复；不自动递归改父目录 ACL。

证据：[Cleaner](../../../src-tauri/src/cleaner.rs)约 143 行，[数据库](../../../src-tauri/src/identities/database.rs)约 31 行，[private::safe/protect](../../../src-tauri/src/identities/private.rs)约 57、91 行；测试来源见下文。并发与 ACL 属条件性风险，置信度中。

### S10 · P1 · 安装器真实执行验证尚未完成

HANDOFF 和发行说明都明确：0.1.3 升级钩子通过合成 NSIS 编译，但未真实执行安装、升级和卸载。本机文件替换不验证旧卸载器 `/UPDATE` 行为，也不验证取消、占用和浏览器注册。

建议仅在一次性 Windows runner/VM 使用固定版本安装包和虚构资料，验证首次安装、0.1.2 升级、拒绝/取消、占用和失败退出、资料哈希与身份数量、浏览器注册。0.1.2 的旧卸载器可能移除浏览器注册，不能把它写成新版自动保留。

证据：[交接](../../../HANDOFF.md)第 4.3 节，[发行说明](../../../docs/RELEASE_NOTES_0.1.3.md)，[安装钩子](../../../src-tauri/windows/installer-hooks.nsh)。属于明确遗留，不是新发现的执行故障。

### S11 · P2 · 清点原生命令暴露面，保持后端校验

`main.rs` 注册了包括当前无前端入口的 `browser_rotate` 在内的命令；`build.rs` 使用常规 `tauri_build::build()`。Tauri 官方说明，应用默认注册命令可由其窗口调用，细粒度控制需要显式应用命令清单。现有 `core:default` 不是应用自定义命令的逐项权限表。

建议建立“UI 调用者—原生命令—参数校验—副作用—确认”清单。只在证实没有产品消费者、协议或兼容依赖后，撤下无用注册；需要保留的命令继续在 Rust 校验目标、策略、进程和事务状态。即使给主窗口授予更细命令权限，也不能把它当作已受攻击主窗口的独立鉴权边界。

证据：[主入口](../../../src-tauri/src/main.rs)，[构建入口](../../../src-tauri/build.rs)，[能力配置](../../../src-tauri/capabilities/main.json)，官方来源 [O3]。这是减少可达面，不是声称现有 CSP/权限配置已被绕过。

### S12 · P2 · 官方配置目录隔离值得独立试点

官方认证文档提供 `CLAUDE_CONFIG_DIR`，可让工作与个人账号分别使用配置目录；文档同时注明，未使用 API Key 的某类 Console 登录信息保存在配置目录之外，不能简单用此变量隔开。[O1]

它可能减少将来 CLI 模式切换共享目录的需要，但不自动隔离 Desktop、浏览器、OS 用户、项目源码或目录外的登录状态。现有项目按默认工作区处理路径、进程、统计与归档，不能只给子进程加环境变量就宣称迁移完成。

建议后续单独做临时目录试点和兼容设计，不改用户现有终端、账号或默认工作区。不同用户的强隔离需求应考虑独立 Windows 用户或 VM，而不是把本应用目录称为 OS 沙箱。

## 可复用模式与测试证据

已有 API/模式包括 `Store::save_checkpoint`、`Store::switch/recover/delete`、`Database::pending/complete`、`private::safe/create/write`、`Reporter::channel/log`、`server::nonce/current_session/resource`，以及 `AppDialog`、`maskEmailAddress`、`usePreferences` 和 Cromma 的 `Button/Checkbox/Disclosure/Tabs`。具体使用范围及新接口与旧接口的区分见实施计划。

已有测试可从这些位置选取夹具，不需要重建一套框架：

- [identities/tests.rs](../../../src-tauri/src/identities/tests.rs)：`interrupted_switch_can_recover_and_preserves_pre_recovery_state`、`damaged_saved_archive_never_changes_live_identity`、`direct_delete_respects_kept_data_and_removes_only_selected_archive`。
- [optimization_tests.rs](../../../src-tauri/src/identities/optimization_tests.rs)：归档代次提交、旧格式兼容、历史合并、会话转换夹具。若批准 A，旧测试应按新的行为断言重写，不能简单删除失败测试。
- [database_tests.rs](../../../src-tauri/src/identities/database_tests.rs)：临时 SQLite 首次建库和迁移竞争。
- [browser/tests.rs](../../../src-tauri/src/browser/tests.rs)、[workspace_tests.rs](../../../src-tauri/src/browser/workspace_tests.rs)：资料隔离、恢复状态阻断、局部失败和代理不直连回退。
- [server.rs 内嵌测试](../../../src-tauri/src/browser/server.rs)：请求预算、令牌失效、静态资源真实 HTTP 返回。
- [GUI 夹具说明](../../../tests/CLAUDE.md)与 [scripts/CLAUDE.md](../../../scripts/CLAUDE.md)：虚构 IPC、隔离浏览器、本地资源、双语与响应式验证。

以上只说明已有测试源码覆盖的意图，不构成本轮测试通过的回执。

## 官方资料与适用限制

以下来源访问日期均为 2026-10-21。公开检索/提取使用 agent-reach 的 Exa/Jina 后端；未提交本项目源码、账号或机器信息。根会话复核了关键原文，未把搜索摘要扩大为已验证事实。

### O1 · Claude Code Authentication

来源：https://docs.anthropic.com/en/docs/claude-code/authentication ，章节 `Log in with multiple accounts`。

原文短引：“give each account its own configuration directory”及“set the CLAUDE_CONFIG_DIR environment variable”。同节明确列出 Console 无 API Key 登录的例外。

结论：官方支持一种目录隔离方式，不等于这是唯一许可的方式，也不等于它涵盖本产品所有子系统。

### O2 · Anthropic 账号条款与使用政策

来源：https://www.anthropic.com/legal/consumer-terms ，`Account creation and access`；https://www.anthropic.com/legal/aup ，`Do Not Abuse Our Platform`。

条款短引：“You may not share your Account login information ... or Account credentials with anyone else.” 使用政策列明禁止多账号恶意活动协同、逃避检测、绕过限制、自动化注册及换号绕过封禁等行为。

结论：界面应帮助用户保护本人账号与资料，不承诺防关联或不封号。不把普通多账号使用一概写成违规，也不把政策中没有给出的 IP、并发或设备阈值自行编成规则。

### O3 · Tauri Capabilities

来源：https://v2.tauri.app/security/capabilities/ ，章节 `App Commands` 与 `Security Boundaries`。

原文短引：“By default, all commands that you registered in your app ... are allowed to be used by all the windows and webviews of the app.” 文档给出 `AppManifest::commands` 用于改变该行为，同时注明 capability 不能保护错误的 Rust 实现或错误的 scope 检查。

结论：细化权限与后端参数校验需共同考虑；独立 Chromium 回环页不因此自动获得 Tauri IPC。官方 localhost 插件的警告也不能直接当作本项目回环桥已存在可利用漏洞的证据。

### O4 · Microsoft CryptProtectData

来源：https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata ，说明与参数章节。

原文短引：“only a user with the same logon credential ... can decrypt the data”，通常还要求同一计算机；`CRYPTPROTECT_LOCAL_MACHINE` 会扩大为该机器上的用户可解密。

结论：DPAPI 不提供同用户恶意程序之间的绝对保密。公开盐、同机可读的额外熵不能自动解决此问题。本次不更换密钥体系，不改变现有归档/HMAC，也不以“改用 DPAPI”替代兼容设计。

## 仍然未知的事项

服务端风控算法、正常多账号切换的关联阈值、用户当前数据是否曾被历史转换影响、完整崩溃点矩阵和安装器真实执行结果均未由本轮验证。本报告不做账号封控预测，也不声称已证明所有模块安全。后续按阶段只补与改动直接相关的验证。
