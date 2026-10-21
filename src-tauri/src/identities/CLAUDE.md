# identities/
> L2 | 父级: ../CLAUDE.md
mod.rs: 当前/空/已保存身份（读取时经 Store::open 完成旧版索引、孤儿摘要清理、摘要离线额度惰性回填、只读 quota_ledger.json 跨账号同步、过期窗口实时清零与死锁垃圾清理）、原地加密备份、无需目录扫描的进程停止与切换/恢复/重命名/直接删除 Tauri 命令，复用 Cleaner 全局事务锁；进程停止通道可选且报告开始/真实完成/失败，兼容旧调用；UI 只接收目录和允许的账号显示字段及离线额度百分比。
usage.rs / usage_tests.rs: 独立私有 SQLite Token 账本；JSONL完整行增量游标、超长半行重试、最多8KiB头部/边界采样哈希检测改写、旧游标兼容、时间/回放索引；哈希去重与累计值合并，保留既有HMAC归属。小时/每日/完整历史聚合排除未来，固定UTC偏移尚未校正历史夏令时；采样不保证任意中段改写均被发现，损坏文件保持重试。只返回脱敏计数，不写 Claude 配置或 Python 配额账本，测试仅用临时虚构会话。
database.rs: 默认开启联动且保留显式关闭，SQLite v3 管理稳定账号槽位、不可变归档代次、HMAC 索引、脱敏身份摘要（含离线额度与孤儿摘要自动回收）、空身份临时记录回收、切换时间戳（active_since）与持久恢复状态；旧 v1/v2 事务迁移，覆盖指针与恢复标记同事务提交，IMMEDIATE 初始化事务串行化并发首次打开/迁移，凭据正文不入库。
database_tests.rs: 临时规范目录与合成 SQLite 验证并发首次建库、缺失保险库目录创建和旧 v1 迁移至 v3；不读取真实身份资料或调用原生/浏览器命令。
store.rs: 先验收归档再切换工作区、原地保存快照、恢复后即时跨账号残留消毒与旧归档历史会话/项目路径无损合并、切换前采集 Token 用量和成功绑定/切换/恢复后的账号统计边界、失败回滚、独立恢复检查点与无新增备份删除；清除/恢复按完成源数量报告局部进度，凭据/提交/回滚显式阶段；关键阶段强制核验进程，文件循环每 250ms 复查。
profile.rs: 只读默认 .claude.json 的用户名/邮箱/组织/套餐显示白名单与 cachedUsageUtilization 离线 5h/7d 额度，结合 projects 会话 jsonl 跨文件全局 (message.id, requestId) 去重、active_since 跨账号会话计费隔离、Claude Code 2.1.302 qHr 模型计费表、单账号自适应窗口标定与 quota_ledger.json 最新同账号 server_anchor 在内存合并校准实时消耗（账本由 Python 独占写入，UI 不覆盖）；保留向后兼容的可选 subscription_expires_at，当前没有可信来源时省略，绝不将 OAuth expiresAt 当作订阅到期。API Key 仅记存在性、桌面仅检查身份路径元数据；不可读不冒充空身份，不读取钥匙串或 Cookie 正文，零网络请求。
credentials.rs: 默认 Code 凭据按用户策略合并身份与共享 MCP/插件秘密；正文只在原生内存流动。
archive.rs: 新身份复用空浏览器预留编号；tar/Zstd 与旧 gzip 兼容验收，代次与卡片编号分离；源文件写完后才递增完成数，压缩/认证落盘和完整解包验收分阶段报告；完整认证后才交目录事务，解包区可丢弃，归档本体保持 fsync。
catalog.rs: 有界读取账号 UUID/组织（缺失时邮箱/组织），以本机 HMAC 匹配稳定槽位并同步脱敏身份摘要与离线额度；旧副本验收后索引，提交后去重/回收；未知账号与恢复检查点不猜测合并，Desktop-only 暂存保守保留。
compression.rs: Zstandard 级别 3 流式压缩与校验和，读取侧限制窗口并按魔数兼容旧 gzip；外层认证协议不变。
optimization_tests.rs: 虚构 A/B 连续切换、原地保存与离线额度摘要回填、空身份往返无泄漏、独立代理与仓库路径隔离、跨账号 plugins/model-catalog/groveConfigCache 与共享会话风控脱敏（含 api-request-blob/bridge-session 剥离、中断 tool_use/tool_result 成对自愈、tengu_exit 拆弹）、旧归档历史会话与项目映射无损合并、凭据刷新、跨组织隔离、覆盖崩溃恢复、压缩兼容与认证尾部拒绝；手动 500 会话性能样本不设不稳定的 CI 时间阈值。
codec.rs: 压缩流与 ring AES-256-GCM 帧，独立归档密钥和认证结尾；拒绝篡改、截断与非法归档成员。
private.rs: POSIX 0700/0600 与 Windows 创建时指定当前用户所有者/独占 DACL、原子写入；已有目录仅校验不改写父级 DACL，拒绝所有者变化、链接和特殊文件。
tests.rs: 临时账号/会话样本的空身份、恢复、配置保留、损坏/链接拒绝、选择删除、跨策略恢复和缺失主密钥拒绝；验证完成源计数、压缩/归档/提交先后与显式回滚，覆盖标准库默认写入（含 Windows 管理员默认所有者）与私有创建层，不接触真实账号。
browser_link.rs: 回环页有界身份摘要、绑定不匹配/未知状态且无凭据输出；SQLite 身份到独占浏览器资料的绑定、身份 ID 派生非零种子与碰撞登记；选择指针随切换/回滚同事务提交，旧卡合并保留当前资料。
browser_link_tests.rs: 默认勾选/显式关闭保留与身份摘要无令牌/不冒充网站账号；临时目录验证 A/B 复用、空资料轮换、迁移、种子碰撞与数据库拒绝不提交；无真实账号。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

usage.rs: Stable fallback account IDs in usage-ledger meta attribute otherwise unresolved rows consistently across totals, trends, models and filters; raw event evidence stays unchanged.
