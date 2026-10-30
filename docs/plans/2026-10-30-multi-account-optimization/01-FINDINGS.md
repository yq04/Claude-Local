<!--
[INPUT]: Current source, reported UI behavior and existing synthetic verification entry points.
[OUTPUT]: Source-anchored findings, confidence levels, existing protections and reusable APIs.
[POS]: Evidence record for a future implementation; no live account or network diagnosis is claimed.
[PROTOCOL]: Quote actual signatures, mark proposed APIs as new, and do not infer service authorization from local isolation.
-->
# 问题证据与能力边界

## 1. 核查范围

本轮直接核对身份页、共享操作记录、浏览器选择/启动/核验、订阅桥、额度导入、归档与备份的相关函数，并复核公开参考。没有读取真实凭据、Cookie或账本正文，没有请求真实账号，也没有重跑产品测试。下列源码行号对应当前工作区，实施前需重新定位函数。

证据分为三类：**已证问题**由代码和用户反馈直接支持；**设计约束**表示当前能力边界；**待复现风险**有可疑路径，但不能写成已经发生的串号或数据污染。

## 2. 已证问题

### F01 操作记录没有关闭能力

优先级P1，置信度高。`useCleanupActivity()` 只返回 `state/start/channel/log/finish`；`finish()` 保留活动对象，组件只要对象存在就渲染。现有“展开/收起日志”只改变正文展示，不能关闭整块记录。切页卸载组件才丢失这份本地状态。

依据：[cleaner-activity.tsx:32](../../../src/cleaner-activity.tsx#L32)、[finish与返回值:64](../../../src/cleaner-activity.tsx#L64)、[条件渲染:100](../../../src/cleaner-activity.tsx#L100)、[唯一展开按钮:112](../../../src/cleaner-activity.tsx#L112)。同一组件用于身份、浏览器、电脑设置及CLI管理，应该统一修复，而非只给截图中的位置加按钮。

现有序号机制已经拒绝旧通道事件，日志也限制为2000条，应保留。关闭面板不应调用停止、取消或释放任务门。

### F02 顶部提示缺少来源、账号和生命周期

优先级P1，置信度高。`quotaFeedback` 是一个字符串，没有级别、操作编号、目标账号、产生时间或关闭状态。它在在线弹窗、页内和额度详情三个位置按条件呈现；不能笼统说三个位置一定同时重复。

返回浏览器成功只更新槽位和活动记录，没有清理或标记旧 `quotaFeedback`。这可以直接解释截图中的“新成功记录＋旧错误”。旧错误究竟来自前一次订阅同步、用量页还是其他操作，截图无法唯一判定。

依据：[字符串状态:198](../../../src/identities.tsx#L198)、[返回浏览器:1044](../../../src/identities.tsx#L1044)、[弹窗与页内呈现:1586](../../../src/identities.tsx#L1586)、[详情呈现:1982](../../../src/identities.tsx#L1982)。`openUsagePage()` 同时写活动和简短反馈，见[1026](../../../src/identities.tsx#L1026)。

另外，在线弹窗还会在字符串为空时回退显示已完成批次摘要。仅执行 `setQuotaFeedback('')` 不能构成完整的关闭合同。消息还混用原始翻译key和已翻译文字，切换语言后的处理不一致。

### F03 订阅同步仍依赖全局浏览器槽位

优先级P1，置信度高。`identities_sync_subscription(app, expected_identity)` 解析当前CLI配置对应账号，但后续要求该账号绑定slot等于全局 `browser.active`。选中养号资料或其他账号资料时，会在打开网页之前返回通用 `quotaOnline.unavailable`。

依据：[quota_bridge.rs:198](../../../src-tauri/src/browser/quota_bridge.rs#L198)、[槽位比较:223](../../../src-tauri/src/browser/quota_bridge.rs#L223)。已经修正的[打开官方用量页:970](../../../src-tauri/src/browser/mod.rs#L970) 使用独立账号launcher，不会改变全局选择；它不能解除旧订阅桥的限制，也不会自动同步订阅。

这是调用路径不一致，不是官网不支持查询的证据。用户执行回切后是否再次同步、是否有同账号网页登录态及实际响应，本轮没有验证。

### F04 “同步完成”没有保留实际更新字段

优先级P1，置信度高。旧回调允许账单、重置或额度窗口任一存在；Python已有 `metadata_updated/updated_windows/observed_at_ms`，但原生将 `updated/cached` 简化为成功，前端收到 `void` 后统一提示订阅已同步。

依据：[server.rs:365](../../../src-tauri/src/browser/server.rs#L365)、[成功判断:381](../../../src-tauri/src/browser/server.rs#L381)、[前端成功提示:887](../../../src/identities.tsx#L887)、[Python返回结果:962](../../../scripts/claude_quota_online.py#L962)。因此“只更新额度”“沿用缓存”“有新订阅字段”目前缺少明确区分。

### F05 续期与到期、可用次数与历史次数存在表达偏差

优先级P1，置信度高。网页桥自动读取的是 `next_charge_date`，类型明确为 `next_renewal`，不是订阅开始日或服务有效截止日。详情模型保留这一语义，但日期徽章统一使用“订阅到期”提示。

依据：[日期来源:69](../../../src-tauri/src/browser/quota_bridge.rs#L69)、[格式模型:187](../../../src/identity-online-quota.ts#L187)、[徽章模型:311](../../../src/identity-online-quota.ts#L311)、[身份日期提示:137](../../../src/identities.tsx#L137)。展示应保留日期类型与来源，不需要为此改变历史持久格式。

重置模型已经计算 `observedAtMs/validUntil/stale/usable`，但卡片和详情仍直接展示原始次数，旧值可能看起来仍可使用。依据：[已有新鲜度模型:209](../../../src/identity-online-quota.ts#L209)、[卡片次数:123](../../../src/identities.tsx#L123)、[详情次数:1941](../../../src/identities.tsx#L1941)。

重置数据不是所有Pro都有的通用权益。现有解析仅累计 `eligible=true`、已开始、未结束、未暂停的grant。字段异常保持未知；当前规则还把eligible明确为true而grants缺失/无活动grant视为零，并给有限有效期。见[quota_bridge.rs:76](../../../src-tauri/src/browser/quota_bridge.rs#L76)。这是一项现有解析策略，不能宣称已由官网稳定公共协议保证；未来应保留可复核的解析fixture。

### F06 备份范围与完整浏览器环境不同

优先级P1用于范围说明，扩展功能单列后续阶段。当前全库导出只收SQLite快照、主密钥和引用的归档，未收 `warming_cards.json`、`manual_subscriptions.json`、浏览器profile/config/seed.owner。SQLite含浏览器绑定，不等于资料内容也已备份。

依据：[backup.rs:414](../../../src-tauri/src/identities/backup.rs#L414)。这是明确的范围缺口，没有证据表明现有资料已经丢失。

另须区分“当前身份保存”与“导出整库”：当前 `saveSnapshot()` 先调用 `identities_stop` 再保存，见[identities.tsx:1085](../../../src/identities.tsx#L1085)。确认框在存在会话时已列出“保存时将自动结束”的清单，见[2026](../../../src/identities.tsx#L2026)，不能说完全没有告知，也不能建议用户在运行任务时把该按钮当作无中断在线快照。顶层描述与完成文案可更一致地说明操作影响。

## 3. 多账号隔离的现状

### 已有保护，应保留

- CLI事务指针、浏览器选择和每账号绑定分别保存；真实养号成员的普通CLI事务采用 `PreserveWarming`，保留其窗口和资料。[browser_link.rs:123](../../../src-tauri/src/identities/browser_link.rs#L123)、[transition_mode:364](../../../src-tauri/src/browser/workspaces.rs#L364)。
- 浏览器动作复用当前配置的HMAC/额度指纹与既有slot/seed/config证明，不凭 `db.active` 猜账号。[catalog.rs:62](../../../src-tauri/src/identities/catalog.rs#L62)、[lifecycle.rs:43](../../../src-tauri/src/browser/lifecycle.rs#L43)。
- 配置变更、切换和失败恢复已有事务、检查点和补偿；回滚选择不谎称网页自动恢复。[store.rs:527](../../../src-tauri/src/identities/store.rs#L527)、[返回补偿:239](../../../src-tauri/src/browser/lifecycle.rs#L239)。
- 固定形状的外部OAuth授权有独立资料分流；网页登录桥仍验证账号、组织、nonce、Origin和提交目标。[oauth_route.rs:43](../../../src-tauri/src/browser/oauth_route.rs#L43)、[background.js:50](../../../browser-runtime/quota-bridge/background.js#L50)。
- 额度文件由Python通过提交许可、跨进程锁和原子替换写入；不需要新增Rust写者。[Python提交复核:873](../../../scripts/claude_quota_online.py#L873)。

### F07 并行浏览器控制和核验仍不完整

这是设计约束，优先级P2升级。底层可独立打开某账号的固定用量页，但普通养号选槽会关闭旧所选profile；只有养号共存分支有特定保护，不能说所有CLI资料已完全与切号解耦。

运行状态只采样当前选中的slot。`browser_quit(app)` 也只关闭所选profile，没有目标账号参数。其他卡片不能因此标为“已关闭”，只能是未采样或未知。

核验只有一个全局 `Session/report/quota_sync/start.url`；旧token会失效，GET context还动态读取全局身份。依据：[Browser:76](../../../src-tauri/src/browser/mod.rs#L76)、[open_session:365](../../../src-tauri/src/browser/mod.rs#L365)、[GET context:410](../../../src-tauri/src/browser/server.rs#L410)、[关闭命令:708](../../../src-tauri/src/browser/mod.rs#L708)。只把Session换成Map或再开Chrome窗口不足以实现双核验。

### 必须清楚表达的边界

- HMAC只证明当前CLI配置元数据对应归档，不证明每个运行进程内存中使用哪个账号，也不证明服务器授权。
- 卡片的浏览器归属不等于该网页Cookie实际登录账号已被验证；养号名称/邮箱本来就是用户维护的元数据。
- 独立profile不保证独立出口；代理留空时可能共用系统代理/TUN。20项环境检查和六项配置/HTTP样本都不能保证服务端不限制账号。
- 当前CLI仍是共享home和单active事务模型。完整多CLI独立账号并行，不属于现有浏览器并行能力。

## 4. 待复现风险

R01：额度批次已有请求编号和冻结指纹守卫，但部分catch以及 `await read(false)` 之后的提示提交没有再次核对操作代次，见[identities.tsx:827](../../../src/identities.tsx#L827)。需要一个合成晚响应场景确认，不能据此宣称账本串写。

R02：活动Channel有序号隔离，但 `finish/log` 没有显式操作token。现有忙碌门禁降低触发机会；若将来允许重叠操作，应先补终结事件归属测试，见[cleaner-activity.tsx:34](../../../src/cleaner-activity.tsx#L34)。

R03：现有订阅票据不带从点击开始冻结的epoch，导入时才进入新的collect流程。实施独立同步时应把原始目标和代次贯穿至提交。不能把此项设计不足直接写成已发生错误导入。

## 5. 已有API与复用限制

- `useCleanupActivity()`、`ActivityController`：已有start/channel/log/finish，**没有dismiss/reopen/cancel**；新接口必须作为拟新增标注。
- `ConnectionHistory.matching/merge`：[identity-connections.tsx:82](../../../src/identity-connections.tsx#L82)，可借用按冻结账号保留结果的模式，但现有类型和过滤条件服务于额度，不能直接装入订阅metadata-only结果。
- `resolve_bound_profile_target(app, account_id, expected_identity) -> Result<BoundProfileTarget, String>`：[quota_connection.rs:93](../../../src-tauri/src/browser/quota_connection.rs#L93)，已有账号、slot、scope、profile，不允许前端传任意路径。
- `launch_identity_profile_locked(app, account_id, expected_identity) -> Result<(), String>`：[141](../../../src-tauri/src/browser/quota_connection.rs#L141)，只打开固定用量页，没有任意URL/callback参数，也不证明浏览器已经就绪。
- `query_existing_profile(app, account_id, expected_identity, deadline, cancelled) -> Result<Value, String>`：[quota_existing.rs:280](../../../src-tauri/src/browser/quota_existing.rs#L280)，已有独立回环、时间预算和取消，但要求profile已运行；接收器只在有usage时成功，metadata-only会失败，见[241](../../../src-tauri/src/browser/quota_existing.rs#L241)。不能原样替代订阅同步。
- Rust提交入口实际名为 `online::import_browser_snapshot(app, account_id, expected_identity, snapshot) -> Result<Value, String>`：[online.rs:1403](../../../src-tauri/src/identities/online.rs#L1403)，目前只接当前账号。不存在名为 `apply_browser_snapshot` 的现成API。
- `freeze_binding/grant_door/QuotaTask` 位于[online.rs:473](../../../src-tauri/src/identities/online.rs#L473)、[968](../../../src-tauri/src/identities/online.rs#L968)，是已有受控编排内部实现，不是订阅按钮可直接调用的公开通用接口。
- `profile::running/quit`：[profile.rs:26](../../../src-tauri/src/browser/profile.rs#L26)，只在原生解析可靠绑定后使用；quit语义是该profile的窗口正常退出，不是精确关一个标签页。

下一步实现应以这些真实合同为依据。没有执行的测试、真实网页登录、原403恢复、严格路由内存加载和跨机器浏览器资料恢复，都继续保持未知。
