<!--
[INPUT]: Confirmed findings, reusable current APIs, pinned public patterns and the owner's explicit research-only scope.
[OUTPUT]: Phased, reviewable implementation tasks, dependencies, bounded checks and delivery criteria.
[POS]: Future work plan; proposed types and APIs do not exist unless explicitly identified as current.
[PROTOCOL]: Read current module rules before execution; preserve compatibility, confirmation, scoped tests and live-session protection.
-->
# 后续实施方案

## 0. 目标、依赖和执行边界

目标是让用户知道“正在操作哪个账号、用了哪份浏览器资料、结果来自哪一次操作”，并能关闭反馈、同步正确账号的官网权益，再逐步增加浏览器并行。

本轮只形成方案。所有阶段均未实施，下面的检查是未来验收清单，不是本轮测试结果。阶段A与B可在文件责任划分后并行；阶段C复用B梳理的目标解析；阶段E在C合同稳定后做。D的范围说明可先做，完整备份不应阻塞A/B，D的新增格式另行评审。

实施前复读根 `AGENTS.md/HANDOFF.md`、模块 `CLAUDE.md` 和[事实/API清单](01-FINDINGS.md#5-已有api与复用限制)。先检查未跟踪文件与并发变更，保留当前工作区，不用stash/reset/restore/clean隔离已有成果。

约束贯穿各阶段：

- BAGAID01、.baga、SQLite v3、账号HMAC及旧browser seed域不变，不重建既有ID/slot/seed。
- 测试只用虚构账号、临时home/vault/profile和隔离浏览器，不停止真实CLI、不自动注册/KYC/充值/转正。
- Python继续唯一写额度/网页元数据账本，复用提交许可、跨进程锁、原子替换和较新观测优先。
- 不新增OAuth轮询；网页权益查询保持用户显式触发。关闭UI不表示取消请求或事务。
- 保留用户选定的卡片布局、顺序、短四步、两栏计数样式及隐私遮罩；不加回已移除的筛选/排序、Free标题、说明胶囊和按钮加号，不随意用装饰性中点。
- 真实网络出口、网页登录和服务授权各自说明证据范围；403及strict-route维护不由本方案假定解决。

### 阶段0：实施前合同复核

复用[01-FINDINGS](01-FINDINGS.md)中真实签名，尤其核对 `import_browser_snapshot` 的名称、`query_existing_profile` 的usage-only成功条件和当前内部可见性。记录所改文件范围，不把旧审计中已经完成的功能重新列为缺失。

先确定新增返回类型、scope和关闭语义，再拆前后端任务；不同时发两个代理修改同一大文件。无需再次进行全库架构审查。

## A. 优先修复反馈生命周期

对应F01、F02和R01/R02。主要文件：`src/cleaner-activity.tsx`、`identities.tsx`、相关局部CSS、双语目录；按实际调用面修改 `browser.tsx/system.tsx/claude-cli-panel.tsx`。可拟新增小型纯反馈模型及其定向测试，不先建通知中心。

### A1 共享操作记录可关闭、可恢复查看

从当前start/channel/finish序号机制扩展，而非各页面分别加一套状态。**拟新增**可见性控制和 `dismiss/reopen` 合同：

- 新操作自动显示简要进度，原始日志仍默认收起。
- 已完成、失败或带警告的记录可手动关闭；保留当前/最近结果的恢复查看入口，不因关闭删除诊断证据。
- 运行中允许收起到简短任务入口，原任务、锁和进度继续。重新展开不重新执行IPC。
- 取消仍使用该业务已有的明确接口；不提供虚构的通用cancel。身份事务不得因关闭按钮被中断。
- 首批先保证手动关闭。自动隐藏短成功提示可后续作为偏好，不能默认让错误或已展开日志突然消失。

复用位置：`cleaner-activity.tsx:34–66`；已有关闭在线弹窗不取消任务的行为参考 `scripts/test-identity-batch.ts:81–121`。

### A2 简短反馈带来源和归属

把单字符串逐步替换为**拟新增**的窄结构：操作id、来源、目标账号/浏览器scope、级别、消息key及参数、产生时间、是否已关闭。存储翻译key和参数，在呈现时翻译；原生受控消息保留现有翻译兼容。

关闭作用于该消息id，不能被 `batchSummary.completed` 的旧摘要立刻顶回来。异步成功、catch和await后的提交均校验操作id与目标；若增加timer，也必须只影响创建它的消息。

成功回到Pro浏览器后，原浏览器上下文下已失效的“无法同步”反馈不继续当当前结果。仍有效的授权/额度错误应保留其账号和观测时间，不能用“浏览器返回成功”把真实授权错误清空或伪装为订阅同步成功。

优先复用 `ConnectionHistory.matching/merge` 的按指纹匹配思路，以及 `manualSyncLocalQuota` 的timer清理方式。不要把metadata-only订阅结果强装成现有要求额度窗口的查询结果。

### A验收

扩展现有 `test-identity-operation.ts`、`test-browser-cleanup.ts` 和fixture能力，覆盖：

1. 完成/失败记录可关闭并恢复查看；展开日志与关闭记录是不同动作。
2. 收起运行任务不取消、不释放锁；重新展开没有新增IPC，已有明确取消路径仍可用。
3. 旧同步错误后返回浏览器成功，不再把旧错误冒充本次反馈；旧响应不能覆盖新提示。
4. 在线弹窗关闭、页内、额度详情三个位置的关闭状态一致，不被旧批次摘要重新显示。
5. 双语、键盘操作、窄布局与隐私遮罩；普通状态用status，重要错误按实际需要使用alert，日志按顺序呈现。

通过这组定向检查即止。A不需要修改原生身份切换或运行真实账号。

## B. 按账号同步官网权益并如实显示结果

对应F03、F04、F05。主要文件：`browser/quota_bridge.rs`、`quota_existing.rs`、`quota_connection.rs`、`identities/online.rs`，必要的Python结果投影，以及 `identities.tsx/identity-online-quota.ts` 和双语目录。

### B1 独立资料操作合同

当前Pro按钮保留为当前CLI配置账号的操作，先不扩成任意保存账号的后台查询。使用已有 `BoundProfileTarget` 和当前账号证明，冻结账号指纹、slot、config/seed修订及从点击开始的epoch。

在Cleaner→Browser短门内复核并按需要打开已有profile；缺少可靠绑定、资料或配置时给具体原因，不创建替代资料，不回退养号。启动后有界确认可用，不能把spawn成功视为扩展已就绪。等待网络/扩展期间释放不必要的门，提交时再次检查原目标、原epoch、取消及deadline。

全局 `browser.active`、养号窗口/session、CLI配置和CLI进程不随订阅同步改变。禁止临时切到Pro同步再切回养号。

### B2 订阅与额度使用不同成功条件

已有独立回环接收器可以参考，但 `query_existing_profile` 只接受含usage的结果。**拟新增**明确的读取用途策略或订阅专用接收入口，保留统一额度fallback“确有额度窗口才算更新”的原合同。

订阅用途可以接受经验证的billing/reset元数据单独成功；官网未提供字段时回报缺项，而不是伪造零、到期日或整体成功。不得删掉现有Origin、Host、nonce、正文大小、身份/组织、TTL和提交前复核。

使用现有 `online::import_browser_snapshot` 与Python单写者底座，但不能在回调到达后才重新冻结epoch并忽略点击时的代次。现有batch内部编排并非现成公共订阅API，需要小范围提炼或新增包装，明确标为新实现。

### B3 结构化结果与字段真实性

至少透传现有 `metadata_updated/updated_windows/observed_at_ms`。若需要分别说明续期和重置字段更新，再**拟扩展**字段级返回信息，由实际提交层生成，不由前端猜测。

产品结果区分：取得新权益、只取得额度、沿用旧观测、官网未提供、未登录/账号不匹配、超时或提交被拒绝。保留旧证据，但显示其时间和来源。

日期明确区分下次续费、已证明的有效截止、手动记录；不把next_renewal自动叫到期。重置次数消费已有 `stale/usable/validUntil`：过期的正数或零都不继续标为当前可用，保留历史值供查看。当前eligible/grants解析策略需有fixture，接口缺项不能臆测权益。

错误按受控阶段分类：目标资料、启动/就绪、网页登录/组织、HTTP401/403、接收超时、Python运行能力、取消/epoch/提交、无可用字段。用户消息不包含原始URL、代理、路径、凭据或完整身份标识。

### B验收

复用 `quota_existing` 接收器测试、`quota_connection` 目标fixture、`online_native_chain_tests.rs`、Python浏览器元数据测试及 `identity-online-quota.test.ts`：

1. 养号被选中且Pro为当前CLI配置时，订阅请求只进入Pro既有profile；养号slot/session/资料、CLI指针与种子保持。
2. profile未运行、未登录、账号/组织不符、HTTP401/403、超时分别产生可识别原因。
3. metadata-only在订阅用途可成功，在额度用途仍拒绝；缺项、cached和只更新quota不称订阅已更新。
4. 点击后账号、组织、epoch或绑定变化，以及提交许可前取消，均零写入；旧快照不覆盖新字段。
5. 续期徽章不叫有效截止；过期重置余额不显示“可用”。

只运行对应Rust过滤、相关Bun模型和扩展/原生链的合成场景；不以真实账号请求代替测试。

## C. 统一账号卡的浏览器动作和状态

对应F07。第一步统一操作目标，仍可保留单核验会话。

卡片菜单提供明确的“打开此账号网页”“核验此环境”“关闭此账号浏览器资料的全部窗口”。不新增冗长常驻说明；必要影响放入确认和提示，CLI切换仍独立列示。

固定网页打开和精确关闭可在不改变全局选择的条件下实现。核验/配置在E完成之前仍按单对象选择，必须说明可能关闭当前所选窗口，不能伪称已经同时核验。现有 `browser_open_identity_profile` 只有固定用量URL，不是任意URL入口；泛化时应使用固定用途枚举与受控映射，不能开放任意路径/URL。

状态分别表达当前CLI配置、已选资料、该profile窗口/进程、核验结果时间和网页登录证明。对未采样的卡片保持未知，不能从当前slot状态给所有卡片下结论。HMAC证明不升级为每个运行CLI进程身份已确认。

多卡运行状态应按已展示/运行中的受管资料聚合采样，复用一次进程观察；不要每3秒为128张卡分别做完整快照、缓存扫描或账号请求。Windows继续避免对原生Claude读取进程VM。

验收：A/B两个合成账号互不串profile；关闭A不关B、不清选择/种子；不支持的用途在原生拒绝；缺少绑定不创建替代；promotion/recovery仍走原保护。保留当前CLI切换的跟随策略，是否进一步解耦应在E明确设计，不能顺手改变。

## D. 备份范围与可逆恢复

D1优先改产品说明：区分保存当前身份、保险库导出、未来浏览器环境备份。保留当前确认与活跃会话清单，顶层统一说明保存可能先结束CLI；不宣称不中断在线快照。明确当前导出不含养号、手动订阅及浏览器资料。

D2另行设计版本化加密环境包：现有归档、绑定、养号元数据、手动订阅、受管profile/config/seed.owner有一致性清单和hash。仅包含应用拥有的资料，不扩大到个人浏览器、系统密码库或任意目录；浏览器登录数据如纳入须明确选择和加密，缓存/可再生日志采用明确清单处理。

目标profile正常退出后再取得一致性副本，不能拷贝运行中的SQLite/Cookie后宣称完整备份。恢复到全新私有目录，校验ID/slot/seed/counts/hash，不覆盖活动资料、不删除源。跨机器Chromium数据能否解密或继续登录，须单独验证，不能承诺。

可选单身份便携包参考CCBaga“认证后导入新记录”的模式，保持CLI归档与浏览器完整环境的范围分别可见。不要改写旧BAGA格式或转交整库主密钥来实现便携。

验收仅用合成资料：范围预览真实、漏项被识别、损坏/重复绑定/链接/超限拒绝、恢复目标冲突拒绝、原目录不变。完整环境包尚需独立格式设计，不能靠修改现有collect_files白名单就完成。

## E. 完整双浏览器核验升级

**拟新增内存ScopeRegistry，当前不存在。** 每个稳定slot与随机会话代次绑定自己的owner、配置修订、有效路由、token/port、report时间与票据。全局browser.active保留为默认选择，不再决定其他已打开scope的身份。

贯穿修改 `open_session`、server context/report、事件、snapshot、quota ticket与前端结果归属。旧页的context必须由其冻结绑定解算，不能动态读取全局选中账号；关闭A只撤销A的token/票据，不影响B。`start.url/launch.args`作为历史默认启动入口可保留，但新显式入口必须精确带到目标scope。

配置变更使对应scope结果失效；进程仍在用旧参数时如实标记需重开，不假装已应用。恢复/promotion仍可按既有安全事务关闭受影响资料，不能为维持窗口绕过保护。

验收：两个profile、两个核验页长期同时存在；各自选择/刷新/关闭互不影响；反向乱序回报、旧token、配置变更、关闭后的callback均不串入另一账号；CLI持续运行、Cookie及seed未复制重建。全部通过后才将完整并行能力写入产品说明。

多CLI各用不同账号同时运行不并入E。当前共享Claude home、进程识别、恢复和统计归属不足以支持此承诺，需要单独核实启动配置、process ownership及恢复模型后另立方案。

## F. 按阶段验证与后续交付

修改对应模块才运行对应检查，通过即止；文档阶段不运行应用构建或账号验收。未来Rust检查前设置 `CARGO_INCREMENTAL=0`、`CARGO_BUILD_JOBS=1`，命令使用 `-j 1`。Bun只跑所改模型、双语及对应合成UI；不得用全库回归代替目标场景。

每阶段验收记录做了什么、还缺什么、设计偏差及未验证的真实边界。只有未来明确进入本地交付时才做前端与custom-protocol宿主构建、当前安装备份、精确GUI更新及独立资源/进程复核；更新前后的CLI基线以实际用户运行情况为准，不因用户主动退出而伪造连续存活。

实施、真实账号验收、代理重载、打包和发布是不同动作。本轮未授权执行本方案；当前交付只有这些研究文件。旧403与strict-route维护继续独立处理，已有v0.2.2标签/资产不改写。
