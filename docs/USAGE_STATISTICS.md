<!--
[INPUT]: Native IANA-aware aggregate queries, stable account fallback rules and the actual All/saved-account UI.
[OUTPUT]: Usage accounting, DST intervals, scoped TSV export, coverage and refresh documentation.
[POS]: Product usage documentation; no credentials, private fallback selection or live ledger data.
[PROTOCOL]: Keep account-scope copy aligned with usage-statistics.tsx and both locale catalogs.
-->
# 用量分析

Claude-Local 的「用量分析」页读取本机 Claude Code 项目日志，展示已保存账号的用量、账号明细、时间趋势和模型分布。界面提供「全部」和单个已保存账号筛选，不提供独立的「未归属历史」选项。

- 今天：按当前系统 IANA 时区的真实区间显示，一般为24小时；夏令时切换可为23/25小时，半小时转换保留实际区间。重复本地小时用UTC偏移区分，未来留空。
- 近 7 天 / 近 30 天：包含今天，逐自然日补齐无记录日期。
- 全部：从所选账号范围最早的记录连续显示至今天，不截断为 30 天。

进入页面或手动刷新会读取数据；页面可见时，每次读取完成后等待 30 秒再读，隐藏时暂停，返回时重新读取，离开页面后清理定时器。读取失败保留相同筛选的已有结果并显示错误，切换筛选不冒用旧结果。这是本地日志写入后的近实时更新，不保证生成中的每个 Token 即时到账；身份卡的 5h/7d 配额仍保持每小时或手动刷新。

页面参考 CPAMP 的指标层次与分析布局，将时间和账号筛选集中在同一卡片，显示当前日期范围并支持重置筛选。四张统一指标卡下方保留响应数与缓存读写摘要。按实际内容宽度布局：宽屏将趋势与模型排行并排，较窄窗口纵向排列，适应经典或紧凑侧栏。

趋势区可在「图表 / 数据」之间切换。图表只展示总 Token，并提供键盘或指针精确值提示；趋势线与模型条形图使用相同的主题强调色。小时均值按真实区间总小时数计算，兼容半小时转换；日均值按自然日计算，均包含零用量时段并排除未来。当前未结束的时段沿用完整槽位计入的口径。峰值显示对应区间或日期，尚无用量时不虚构峰值。

数据视图列出相同的已发生时段，支持按时间、总 Token 和去重响应数排序，每页 10 行；未来小时不显示为零用量记录。切换视图、排序和翻页只使用当前快照，不新增原生读取。正常刷新保留表格排序和有效页码；切换时间或账号后重新显示相应范围。模型排行补充响应数与占总量比例，账号明细继续展示该时间范围内的所有绑定账号。表格宽度不足时在卡片内部横向滚动。

中英文均使用 K/M/B（千、百万、十亿）显示紧凑数值；悬停数字可查看不缩写的精确计数。推理计数不再单独展示。

统计以本地可读日志和已采集账本为范围，不是服务端账单，也不代表订阅的 5 小时或 7 天剩余额度。其他设备的用量、采集前已删除的日志以及仅保存在未恢复加密归档中的历史，不会凭空补齐。

## 计数口径

输入表示日志中的 `input_tokens`，即未缓存输入；输出使用 `output_tokens`。缓存写入和读取分别使用 `cache_creation_input_tokens` 和 `cache_read_input_tokens`。

总 Token = 未缓存输入 + 输出 + 缓存写入 + 缓存读取。缓存命中率 = 缓存读取 ÷（未缓存输入 + 缓存写入 + 缓存读取）；没有输入时显示空值，不把空样本显示为 100%。因此，缓存命中率反映输入 Token 的复用比例，不是请求次数的命中率。

输出直接采用日志的 `output_tokens`，不根据 thinking 文本长度或签名猜测用量，也不把已经包含在输出中的开销重复加入总量。

同一请求的流式更新、会话副本和重复扫描必须合并，不把各个累计快照相加。账号、小时/每日、模型明细都使用相同的请求级去重结果，未来时间记录不计入当前统计。

新界面将系统 IANA 时区随查询传入，原生按每个事件的实际本地日期与日历边界归组；跨历史夏令时不再套用查询时的单一偏移。回拨时两个同名小时保留不同起止时间和UTC偏移，Token与响应总量不丢失或重复。周/月跨度按当地日历推进，非法时区返回固定错误。旧调用方未提供命名时区时，保留固定UTC偏移兼容路径，不能把该路径描述成具有完整历史时区信息。

## 复制与导出

「复制 TSV」和「下载 TSV」只使用当前有效筛选快照，不重新读取原生日志。导出包含统计生成时间、时区、覆盖范围、当前汇总及已发生的时段；不额外导出隐藏未归属桶、独立推理字段、未来零值、请求正文或身份路径。

隐私打码打开时，所选账号范围使用通用名称，不输出隐藏邮箱或原始账号索引。文本单元格进行TSV转义及电子表格公式前缀防护；复制失败有明确提示。下载仅由用户点击触发，浏览器处理保存位置，不提供任意原生文件写入。统计仍是本地观测口径，不是官方账单。

## 账号归属与历史缺口

账号归属复用现有本机 HMAC 索引，不以显示名称或可变的邮箱作为统计主键。已绑定账号即使尚无可归属记录也会出现在列表中。

过去的跨账号会话清理曾改写组织和邮箱标记，而旧版本仅保存最近一次激活时间，无法完整恢复所有切号边界。没有可靠归属的旧记录保留原始证据，不因当前登录账号变化而自动分摊。「全部」表示已保存账号的可归属记录之和，不等于本机所有历史日志的总量。

用户明确配置稳定的本地兜底账号后，未确定归属的历史和后续记录会在聚合时计入该账号，原始事件归属保持不变。未配置、目标不存在或目标不明确时，不猜测替代账号；内部仍保留未归属计数，界面不单列该历史筛选入口。个人兜底选择不随安装包或源码分发。

新的原生切号流程会在修改工作区前采集现有用量，并在成功提交后记录新账号边界；首次成功备份绑定和恢复也会建立经核验的新窗口。已记录的请求归属不会因为切换当前登录而重写。应用之外的登录变化、缺失的身份索引或采集失败会降低可确认范围，应按页面提示理解统计覆盖情况。

## 数据与安全边界

数字计数、时间、模型、哈希后的请求标识和本机账号索引保存在独立的私有 `identity-vault/usage.sqlite` 中。数据库不保存提示词、回答、完整会话正文、凭据、原始账号 UUID 或原始会话路径；前端只接收聚合结果和原有允许的账号显示信息，并沿用邮箱隐私设置。

读取只访问默认 Claude 工作区下的项目 JSONL，包括子代理日志；逐行读取限制内存，并拒绝目录链接。正常追加从持久化的完整行游标继续，未完成尾行下次重试，超长半行也不提前跨过。游标附带最多 8 KiB 的头部/边界采样哈希，缩短、同大小改写或采样变化会重读；旧游标首次使用会重新校验。采样不能证明整个已读前缀从未发生任意改写，头部与边界都不变的中段改写仍可能漏检。

损坏或不可访问的记录会导致部分覆盖提示，不把其余正常记录全部丢弃；含损坏行的文件保留重试，不能声称所有异常文件都只做增量读取。账本查询使用时间索引筛选请求范围，并为请求回放查询建立索引。独立账本保留已采集计数，因此删除或截短源日志不会清零已记录历史；重新扫描也不覆盖既有账号归属。

本模块不请求 OAuth 用量接口，不修改 `.claude.json`，不写 Python 独占的 `quota_ledger.json`，不更改身份数据库 `user_version=3`，也不启动或结束 Claude 进程。

## 开源参考

调研日期：2026-10-20。以下项目作为字段语义和请求级去重的参考，未加入新的统计运行时、外部价格下载或上游更新依赖。

- [ccusage/ccusage](https://github.com/ccusage/ccusage)，调研时约 1.9 万星，MIT。核对版本 [`c4fd02581085055c3946e33732297397911e1fcb`](https://github.com/ccusage/ccusage/tree/c4fd02581085055c3946e33732297397911e1fcb)，重点阅读 [Claude 原生日统计与去重](https://github.com/ccusage/ccusage/blob/c4fd02581085055c3946e33732297397911e1fcb/rust/adapters/claude/src/daily.rs)。其重复请求保留完整计数、优先原始记录和识别 sidechain 回放的处理，提示不能直接累加 JSONL 每一行。
- [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)，调研时约 8700 星，MIT。核对版本 [`c59a83bf943f329f0e61f1a29c760353ee1860a5`](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/tree/c59a83bf943f329f0e61f1a29c760353ee1860a5)，参考 [数据读取与请求标识](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/c59a83bf943f329f0e61f1a29c760353ee1860a5/src/claude_monitor/data/reader.py) 和 [Token 字段提取及总量口径](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/c59a83bf943f329f0e61f1a29c760353ee1860a5/src/claude_monitor/core/data_processors.py)。
- [CPAMP / CPA-Manager-Plus](https://github.com/seakee/CPA-Manager-Plus)，MIT，核对版本 [`64ce94e6aa1af691555429a3211e67c59c0480ad`](https://github.com/seakee/CPA-Manager-Plus/tree/64ce94e6aa1af691555429a3211e67c59c0480ad)。参考 `apps/web/src/features/usage-analytics/components/UsageSummaryCards.tsx`、`usageAnalyticsPresentation.ts` 与项目用量分析截图中的大数字卡片、精确值提示、K/M/B 单位和宽幅趋势布局。界面使用现有 React/SVG 独立适配，没有加入该项目的服务端、账户接口或图表运行时。

Claude-Local 在这些口径上适配现有 Rust 原生边界、独立账号索引、切换事务、私有持久化和双语主题界面。多账号历史归属仍以本地证据为准，开源解析器本身不能补回已消失的身份信息。

## 验证

前端运行 `bun test src/usage-model.test.ts src/navigation.test.ts src/i18n.test.ts` 和 `bun run build`；原生运行 `cargo test --manifest-path src-tauri/Cargo.toml usage_tests`，覆盖小时/完整历史、去重、归属保留、旧游标和改写检测。`node scripts/test-usage-statistics.mjs` 在隔离假 IPC 页面上验证 24 小时、81 天历史、7/30 天范围、未来留空、刷新串行/隐藏暂停/卸载清理、错误保留，以及数据视图的无额外读取、10+1 小时分页、排序顺序与无障碍状态、三模型占比、1440 宽屏及 720 窄窗双侧栏、英文暗色长模型名。保留快速配置只读状态、六卡导航和其他页面合成回归。输出目录由参数指定，默认在被忽略的 `.local/preview/ui-refinements`；不进行真实身份切换或系统设置修改。

## Explicit fallback attribution

A private workstation setup can configure `fallback_account_id` in the usage ledger (`usage.sqlite`'s `meta` table) using explicit native commands: `usage_attribution_read`, `usage_attribution_set`, and `usage_attribution_clear`.

- Setting a fallback account requires a verified, stable account ID that exists in catalog identities (`empty = 0`). Invalid or non-existent IDs are rejected with an error and never write to the ledger.
- Operations use the shared identity/usage Cleaner lock to serialize concurrent access.
- Statistics reads (`usage_statistics_read`) are strictly read-only and never silently seed or mutate attribution configuration into `meta`. The optional legacy `fallback_account_name` argument remains supported in memory for backwards compatibility without persisting changes.
- Renaming an account in the catalog preserves the binding because attribution is keyed to the immutable account ID, not a mutable display name.
- Totals, daily trend series, model rankings, and account filters absorb unassigned rows into the designated fallback account.
- The raw event records in the `events` table are never rewritten or mutated, preserving immutable evidence for auditing.
- Clearing the configuration via `usage_attribution_clear` is fully reversible, immediately restoring unassigned usage to separate unattributed totals without data loss.
- The UI presents candidate accounts with privacy-masked labels when privacy mode is enabled, displays a preview of the unassigned requests and token scope before confirmation, and displays active IANA timezone and real 23/25-hour DST context badges.
