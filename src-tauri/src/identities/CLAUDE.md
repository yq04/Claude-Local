# identities/
> L2 | 父级: ../CLAUDE.md
wakeup.rs / wakeup_tests.rs: Windows进程唯一owner；私有schema=1配置/计划/派发前unknown日志，固定冻结指纹集、每分钟本地摘要（跳过active_sessions扫描），15秒判断已存计划。切页/托盘隐藏不停止，真正Exit停止。人工/自动共用audited collect、6–13分钟单次抽样错峰和周额度/CLI/排除/401门禁；3–10分钟→25–60分钟→主力阈值按需待命。未知POST不重启重发，仅同指纹新鲜可信5h被动锚点解除unknown；不解除messages授权阻断，显式恢复仅许可一次尝试。开启先无账号Python导入探针和HTTP CONNECT类型投影，不代表联网可达、不返回原值/凭据。白名单IPC迁移旧localStorage只保留守门时间/失败，不继承旧空转轮数。Python独占quota账本，合成测试无真实账号/网络/系统修改。
人工唤醒未派发时返回stage=scheduler、固定reason和仍生效的账号/全局最大retry_at_ms；不消耗恢复许可、不伪造POST未知/成功、不绕过429或unknown。统一查询的browser_fallback_status独立保留浏览器未运行/身份/页面授权/超时/响应/无窗口失败，OAuth原状态与阶段保持；只有实际browser 5h/7d更新才能替换查询失败，不能解除messages授权阻断。online_native_chain_tests.rs将真实installed Python auth cooldown接入同一fallback编排、loopback接收、授权提交与账本/摘要读取，所有账号/文件均临时合成。
本地readiness独立于automatic开关，禁用时仍每分钟及显式读取/配置时同步account能力和decision但绝不派发；读取/恢复的本地摘要工作在blocking线程。恢复先核对当前绑定目标并初始化缺失状态，仅释放last_status=auth_required且auth_blocked的账号授权退避，授予一次受控验证/唤醒链；profile401消耗许可，明确本地probe/启动/不支持代理失败保留许可与尝试间隔。全局错峰、429和未知POST门禁保持；execute超时/协议异常仍按未知保护。新归档代次或网页额度成功不自动释放messages授权阻断。
identities_quota_revision: 只检查固定两项产品账本和CLI根目录下 .claude.json 的修改时间/长度，拒绝链接，不读取正文、凭据或项目目录，不联网；可见身份页每约2秒检查，变化时才读取受账号绑定保护的完整本地摘要。
online_passive_revision_tests.rs: 合成临时根验证固定三文件元数据边界，以及CLI /usage缓存更新→revision变化→本地额度摘要同步；其他账号的较新同邮箱锚点不混入，账本不改写，未知窗口及重置推定保持真实来源。
online.rs runtime probe: 每候选最多10秒，真实 cryptography/AES-GCM 冷启动、所有解释器候选和网络准备共享一次30秒总预算，并受批次截止时间/取消约束；不重置准备时钟，已授权提交仍保留45秒宽限。
wakeup_audit.rs: 原生唤醒结果的私有本地审计，仅保留随机request ID、trigger、独立域匿名slot、阶段/状态/时间与旧新reset；30天/200条上限、原子私有写入与并发锁，不存账号标识/路由/请求内容，也不接触额度账本。
online.rs: 用户触发的固定端点额度读取、5h重置窗口唤醒（identities_wakeup_quota_window）与网页摘要导入；唤醒结果区分普通updated_windows与严格新5h确认/请求未知，传入trigger和过期reset，出口错误受限国家代码契约。批量命令最多256个冻结指纹目标、共享Cleaner事务锁、双worker、按quota_identity去重（current优先）、逐账号quota-batch-progress事件与独立结果，重入固定busy；冻结State预校验一次，Python按expected指纹重新解析并提交校验。隐藏Python子进程、每子进程30s、有界stdin/stdout和固定错误状态，不输出凭据、不轮换授权、不切换身份。结果source接受oauth/browser，透传当前/旧真实观测时间。显式allow_browser_fallback=true时仅AuthRequired/Unavailable/NetworkError尝试已运行绑定资料，Python确认browser成功才覆盖OAuth结果；默认关闭。只读按quota_identity重建网页订阅/手动重置及逐字段观测时间，不继承未验证的旧缓存字段；Python保持所有额度/网页元数据文件唯一写入者。
mod.rs: 当前/空/已保存身份（读取时经 Store::open 完成旧版索引、孤儿摘要清理、摘要离线额度惰性回填、只读 quota_ledger.json 跨账号同步、逐窗更新与可信服务端重置后的明确推定、死锁垃圾清理）、无需目录扫描的进程停止与切换/恢复/重命名/直接删除 Tauri 命令，复用 Cleaner 全局事务锁；进程停止通道可选且报告开始/真实完成/失败，兼容旧调用；UI 只接收目录和允许的账号显示字段及离线额度百分比。
backup.rs / backup_tests.rs: PBKDF2-HMAC-SHA256 派生口令密钥并用现有 AES-GCM 帧格式加密限额流；常规副本通过 SQLite online backup 快照索引且仅打包主密钥与被索引引用的归档。救援模式只打包白名单直系证据文件并标记未验证，检查后恢复到新的私有隔离目录，不替换活动身份库；synthetic tests 覆盖认证/损坏拒绝、WAL 快照、目标冲突与新副本隔离，不访问真实身份。
备份验证/快照暂存由独占创建的ScratchGuard持有：普通失败和unwind清理当前操作目录，后续恢复失败也收尾，不扫描历史目录；成功副本保留验证状态，清理失败以可选staging_cleanup_failed诊断提示，失败链追加无路径提示。Drop兜底不输出资料或路径。
usage.rs / usage_tests.rs: 独立私有 SQLite Token 账本；JSONL完整行游标与同事务保存的推理档位上下文/解析器版本、紧邻游标尾部64KiB有界前缀回溯、8KiB头部/边界采样哈希、旧游标兼容和时间/回放索引；跨文件去重与累计值合并，保留HMAC归属与每模型推理档位（effort/perTurnEffort）增量继承与分布统计。命名IANA时区按事件本地日历归组，真实小时含start_at/end_at和偏移标签，保留23/25小时及半小时转换；未来槽无虚构用量，旧offset调用继续兼容。只返回脱敏聚合，不写Claude配置或Python额度账本；采样仍不能证明任意中段从未改写，损坏文件保持重试。测试只用合成目录/日志。
database.rs: 默认开启联动且保留显式关闭，SQLite v3 管理稳定账号槽位、不可变归档代次、HMAC 索引、脱敏身份摘要（含离线额度与孤儿摘要自动回收）、空身份临时记录回收、切换时间戳（active_since）与持久恢复状态；旧 v1/v2 事务迁移，覆盖指针与恢复标记同事务提交；短期进程内 Mutex 串行化文件创建到初始化提交，避免 Windows 创建句柄令并发 SQLite 打开降级只读，IMMEDIATE 事务继续保护并发迁移，返回后释放锁；凭据正文不入库。
database_tests.rs: 临时规范目录与合成 SQLite 验证 24 轮 Barrier 并发首次建库、缺失保险库目录创建和旧 v1 迁移至 v3；连接显式释放后清理临时目录，不读取真实身份资料或调用原生/浏览器命令。
store.rs: 先验收归档再切换工作区、原地保存快照、恢复后即时跨账号残留消毒与旧归档历史会话/项目路径无损合并、切换前采集 Token 用量和成功绑定/切换/恢复后的账号统计边界、失败回滚、独立恢复检查点与无新增备份删除；清除/恢复按完成源数量报告局部进度，凭据/提交/回滚显式阶段；关键阶段强制核验进程，文件循环每 250ms 复查。
Store::open主密钥最多读取33字节并严格要求32，不截断/重生成/重写已有材料；合成测试覆盖31/32/33边界及原字节保留。
profile.rs: 只读默认 .claude.json 的用户名/邮箱/组织/套餐显示白名单与 cachedUsageUtilization 离线 5h/7d 额度；按窗口保存来源和真实server/本地最新会话切片观测时间，逐窗合并/到期/聚合规则复用 ../quota_core.rs，旧聚合source/time字段保留兼容；可信服务端边界到期显示 reset_inferred，缺证据仍未知，不滚动reset或制造新观测，live估算须由active_since绑定的实际会话切片支撑，saved不重用共享sessions；旧账本仅在live账号UUID和组织名严格匹配且无组织UUID冲突时合并，身份不匹配的账本不污染摘要；结合 projects 会话 jsonl 跨文件全局 (message.id, requestId) 去重、active_since 跨账号会话计费隔离、Claude Code 2.1.302 qHr 模型计费表、单账号自适应窗口标定与 quota_ledger.json 最新同账号 server_anchor 在内存合并校准实时消耗（账本由 Python 独占写入，UI 不覆盖）；保留向后兼容的可选 subscription_expires_at，当前没有可信来源时省略，绝不将 OAuth expiresAt 当作订阅到期。API Key 仅记存在性、桌面仅检查身份路径元数据；不可读不冒充空身份，不读取钥匙串或 Cookie 正文，零网络请求。
Current与Summary保留同一白名单OAuth expiresAt/refresh存在性；当前摘要写回不再清空已保存身份的授权元数据。本地valid仅表示本地授权材料状态，不代表messages服务端授权恢复。
credentials.rs: 默认 Code 凭据按用户策略合并身份与共享 MCP/插件秘密；正文只在原生内存流动。
archive.rs: 新身份复用空浏览器预留编号；tar/Zstd 与旧 gzip 兼容验收，代次与卡片编号分离；源文件写完后才递增完成数，压缩/认证落盘和完整解包验收分阶段报告；完整认证后才交目录事务，解包区可丢弃，归档本体保持 fsync。
catalog.rs: 有界读取账号 UUID/组织（缺失时邮箱/组织），以本机 HMAC 匹配稳定槽位并同步脱敏身份摘要与离线额度；旧副本验收后索引，提交后去重/回收；未知账号与恢复检查点不猜测合并，Desktop-only 暂存保守保留。
compression.rs: Zstandard 级别 3 流式压缩与校验和，读取侧限制窗口并按魔数兼容旧 gzip；外层认证协议不变。
optimization_tests.rs: 虚构 A/B 连续切换、原地保存与离线额度摘要回填、空身份往返无泄漏、独立代理与仓库路径隔离、跨账号 plugins/model-catalog/groveConfigCache 与共享会话风控脱敏（含 api-request-blob/bridge-session 剥离、中断 tool_use/tool_result 成对自愈、tengu_exit 拆弹）、旧归档历史会话与项目映射无损合并、凭据刷新、跨组织隔离、覆盖崩溃恢复、压缩兼容与认证尾部拒绝；手动 500 会话性能样本不设不稳定的 CI 时间阈值。
codec.rs: 压缩流与 ring AES-256-GCM 帧，独立归档密钥和认证结尾；封装密钥/帧的明文缓冲预留标签空间避免重分配并使用Zeroizing；保持BAGAID01格式，拒绝篡改、截断与非法归档成员。
archive_limits.rs / archive_limits_tests.rs: 普通加载的有界tar读取，先于GNU/PAX元数据分配检查成员/路径/声明大小，兼容GNU长路径和PAX size；成员内容8GiB与有tar开销余量的实际展开流独立限额，清单1MiB/键控配置64MiB；末尾排空仍验证完整认证，不将超限视为EOF。所有回归仅使用合成归档与注入小预算。
private.rs: POSIX 0700/0600 与 Windows 创建时指定当前用户所有者/独占 DACL、原子写入；提供原子独占私有目录创建与子目录可继承所有者访问控制自愈（ensure_owner_dacl，保留 Chromium AppContainer SID），拒绝所有者变化、链接和特殊文件。
tests.rs: 临时账号/会话样本的空身份、恢复、配置保留、损坏/链接拒绝、选择删除、跨策略恢复和缺失主密钥拒绝；验证完成源计数、压缩/归档/提交先后与显式回滚，覆盖标准库默认写入（含 Windows 管理员默认所有者）与私有创建层，不接触真实账号。
browser_link.rs: 回环页有界身份摘要（含当前本地 CLI 代理回传供不一致比对）、绑定不匹配/未知状态且无凭据输出；SQLite 身份到独占浏览器资料的绑定、身份 ID 派生非零种子与碰撞登记；选择指针随切换/回滚同事务提交，旧卡合并保留当前资料。
browser_link_tests.rs: 默认勾选/显式关闭保留与身份摘要无令牌/不冒充网站账号；临时目录验证 A/B 复用、空资料轮换、迁移、种子碰撞与数据库拒绝不提交；无真实账号。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

Quota reset recovery: 已到期的可信服务端窗口以 reset_inferred 保留过去边界与真实观测，允许界面明确显示预计恢复；无证据或纯本地估算到期仍未知。profile 从严格匹配账号/组织的原始锚点恢复旧版已清空的摘要，不推进 reset，不覆盖有效新窗口。quota_regression_tests.rs 覆盖到期、旧账本恢复、隔离和新观测优先；Python 仍为额度账本唯一写入者。

Observed percentage validation: 原始缓存/账本锚点在使用前验证有限性和范围，异常大数/负值不再截成可信的0或100；100–101的轻微超出兼容为100。一窗无有效观测且无实际本地消耗时保持未知，不影响另一合法窗。额度摘要版本7触发旧摘要惰性回填，SQLite仍为3。

usage.rs: Stable fallback account IDs in usage-ledger meta attribute otherwise unresolved rows consistently across totals, trends, models and filters; raw event evidence stays unchanged.
