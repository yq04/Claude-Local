<!--
[INPUT]: Owner's two reference screenshots and report that an exhausted account regains displayed quota after switching; source-only tracing of native and Python quota paths.
[OUTPUT]: Authorized v2 scope for quota correctness, reset-entitlement discovery and environment-first navigation, with targeted verification.
[POS]: Plan amendment preceding implementation; screenshots are not account-data or reset-API evidence.
[PROTOCOL]: Keep reset actions separate from passive refresh, never invent entitlements, and record actual test results only after execution.
-->
# 额度、重置权益与导航补充方案

日期：2026-10-21。用户已授权补充调研后按推荐内容实施。此补案与原计划共同生效；不含真实账号操作、本机安装卸载、部署、提交推送或发布。

## Q01 · 先修切号后额度回跳

用户观察：某账号 5h 耗尽后切换，已保存卡片却再次显示可用，切回 CLI `/usage` 仍无额度。源码已经发现可解释该现象的路径，尚待合成测试复现：

- `store.rs` 切出时用 `summarize_stage(outgoing)` 更新摘要；归档创建时间晚于额度耗尽观测时间。
- `profile.rs::apply_ledger_to_summary` 把归档 `saved_at` 用作账本新旧门槛，因而可能拒绝更早写入、但比归档内旧快照更可靠的服务端耗尽证据。
- `claude_quota.py` 有相同归档时间门槛；缺锚点估计又可能以本次计算时间参与竞争，覆盖同窗口真实观测并留下矛盾的 `server_anchor`。
- 多次 A→B→A 激活只靠最新 `active_since` 不足以证明历史消费归属；共享会话不得无条件计入所有账号。

推荐实现：统一同账号、同窗口的证据优先级，以真实观测时间和窗口标识比较，不以归档/计算时间冒充新观测。旧估计不能降低已确认的同窗口耗尽值；可信新窗口和新服务端观测仍可正常降低使用率。无法证明归属或时效时显示未知/旧快照，不虚构已恢复额度。

修改范围：Rust `profile.rs` 及必要摘要整合位置、Python `claude_quota.py` 和对应合成测试。保持 Python 独占外部额度账本写入、HMAC 与数据库 v3、归档格式不变，不写 `.claude.json`，不调用 OAuth 用量接口。

先写失败回归，再修代码：旧缓存 10% + 已观测 100% + 更新的归档时间；Python 在锚点之后重算旧估计；A→B→A；不同账号/组织；新窗口；部分窗口缺值。测试全使用虚构目录和身份。

## Q02 · 重置次数与使用入口按证据实现

图示中的次数和三次时间属于参考产品的数据呈现，不能证明当前账号拥有该权益，也不能直接确定它来自官方还是第三方服务。

先查官方套餐/额度说明、CLI/statusLine 公开字段及本地采集契约，分别确认：是否有可用次数、可使用时间、可信来源，以及是否有公开受支持的操作入口。

推荐分级：

1. 能从现有被动输入取得且可核验的权益，按账号显示来源、次数与时间，并允许手动刷新本地快照。
2. 没有可信字段时明确显示“重置权益未提供”，不把未知当 0，不按订阅时间推算次数。可提供“查看重置说明”的只读面板，解释当前可获取范围。
3. 只有核实公开受支持的使用方式后，才增加明确确认的入口。否则不提供会虚报成功的“重置额度”按钮，不调用私有接口，也不通过改账本模拟重置。

若官方资料表明图示实际是第三方权益，本批不把它冒充 Claude 官方能力；可在说明中给出边界，后续只有用户指定提供方与受支持协议后才另行集成。不要索取或记录账号密码、Cookie、订单或兑换密钥。

## Q03 · 先环境配置，再身份与分析

侧栏采用：快速配置 → 浏览环境 → 电脑环境 → 网络环境 → 身份管理 → 用量分析 → 使用说明 → 软件设置。

快速配置保留为总览；环境区和账号区用现有分隔结构区分。只调整排列与相关帮助，不改变页面 enum、记忆键、默认身份首页或原生调用。快速配置的入口顺序同步以环境准备在前，实际目标映射不变。

无需为单纯排序新增重复单元测试；使用既有导航枚举与 GUI 夹具直接核对双语、两种侧栏、任务锁和已记忆页面。

## 执行顺序与交付

1. 记录用户授权、原工作区状态和隔离工作区；先形成此补案。
2. 并行处理互不冲突的额度原生/Python修复、原计划历史保护、浏览器隐私与请求边界；主会话整合身份卡片、导航和文案。
3. 外部权益调研一有明确结论就补入本文件和发现报告，按 Q02 的分级实现，不猜接口。
4. 运行针对性 Bun、Python、Rust 合成测试与隔离 GUI，记录通过项和仍缺环境的安装器实测。
5. 将验证后的修改安全合回原工作区，保留用户与其他会话改动；不自动提交、部署或发布。

已有计划中的独立目录隔离试点、密钥体系调整仍不在默认范围。所有结果需区分源码完成、合成验证和真实环境验证。
