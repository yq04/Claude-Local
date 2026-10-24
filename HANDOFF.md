<!--
[INPUT]: Verified 0.2.3 delivery receipts, current repository state and the owner's final session-handoff request.
[OUTPUT]: Context-free task/status/next-step guide with exact delivery evidence and operational pitfalls.
[POS]: Repository root handoff; machine paths, PIDs, credentials and private probes stay in ignored .local/.
[PROTOCOL]: Archive this file and verify SHA256 before rewriting. Documentation-only commits never rebuild or move product tags.
-->
# Claude-Local 会话交接

更新日期：2026-10-23。本文件面向完全没有本会话上下文的新会话。先读本文、根目录 `AGENTS.md`、`CLAUDE.md`，修改具体模块前再读相应目录的 `CLAUDE.md` 和源码头部。

**当前事实：0.2.3 已完成源码提交、远程构建、本机备份更新和私有预发布。没有发布阻塞，也没有需要继续运行的构建、上传或子代理任务。用户最后只要求整理交接，不要自动再次构建、安装或发布。**

## 1. 我们在做什么任务

Claude-Local 是本仓库独立维护的 Windows x64 桌面产品，React/TypeScript 提供界面，Tauri/Rust 管理本机能力，Python 采集并写入额度账本。主程序 `claude-local.exe`，标识 `ai.local.claude-local`；伴生浏览器为 Claude-Local Browser。数据按用户保存在产品 AppData 根目录，普通启动不启动浏览器，只有用户动作或 `--browser` 才启动。

本会话从额度与账号管理的功能调研、实施和0.2.0交付，继续到用户反馈后的连续修复。用户的最终优先级十分明确：**账号隔离安全、统一额度查询、多账号交接、本地共享会话历史**。功能和使用体验优先，几乎不需要继续美化排版。不要擅自增添功能、按钮、搜索、排序或大段解释性文案。

0.2.0默认在线额度刷新难用，并暴露了内部文案键。用户明确选择“保留0.2.0其他功能，恢复旧版本地额度同步为默认”，不是回退整个产品。随后要求清除顶部冗余说明，再明确要求移除身份页搜索和排序。最后授权“无误后完成更新、打包、上传”，这些工作已由0.2.3全部交付。

## 2. 已经完成了什么

### 2.1 当前用户可见行为

- 身份页主按钮是“同步本地额度”，统一读取当前及保存账号的本地摘要。CLI `/usage` 或既有采集器实际写入缓存/账本后，可见身份页约每两秒检查固定文件的元数据，变化时重新读取受账号绑定保护的摘要。
- 固定监测对象为产品 `quota_ledger.json`、`identity-vault/quota_web_metadata.json` 和CLI根目录 `.claude.json`。监测只看文件元数据、拒绝链接，不扫描凭据或项目；不会因为轮询而联网，也不向 `.claude.json` 写入。
- 0.2.3修复了“读取失败却提前确认文件版本”的缺陷。首次检测版本时补读摘要；只有摘要读取成功才确认revision。读取失败或旧响应被较新读取替代，下次检查会重试，不要求文件再变化一次。
- 身份页搜索、排序、附带隐私提示及空筛选状态整行已移除，失效样式与辅助代码一起清除。当前账号保持置顶，其余卡片按原生记录顺序显示，没有替代控件。卡片保持180×286。
- 顶部“默认同步本地额度”等长说明及内联“可选在线查询”区域已清除。在线工具通过标题右上角“⋯”菜单打开独立弹窗，打开不自动查询；关闭停止前台定时在线查询，运行中的原生批次仍可查看和取消，切换页面也不会取消任务。旧在线错误不装饰默认卡片。
- 用户偏好统一查询，不需要分账号查询按钮。可选在线统一批次仍按冻结账号指纹验证，保留去重、并发限制、截止时间、取消、重试队列和错误后保留旧观测的约束。不能借其他账号的数据填补失败。
- 保留账号切换确认、进程检查、失败回滚及默认项目/历史保留策略。共享历史的恢复和项目映射合并沿用原生路径；0.2.3未改动这些Rust/Python逻辑或保留策略。
- 修复手工交接Markdown导出再导入时标题前原有反斜杠丢失的问题，双语和既有legacy模板解析用例通过。手工交接是内存便笺/文件导入导出工具，和原生共享会话历史是两条不同功能，不会自动读取会话、项目或账号内容。

**约两秒是本地变化的发现间隔，不是所有账号服务端额度的实时查询。** 没有新的CLI缓存或采集结果时只能保留旧观测；估算、预计重置恢复和真实观测不得混为一谈。Python仍是额度/网页元数据唯一写入者，跨进程锁、原子替换、新锚点优先和账号/组织绑定保持不变。

### 2.2 各版本的关系

0.2.0实现统一在线额度编排、运行环境/代理约束、全库备份与救援、系统修改记录和手工交接载入等功能。0.2.1恢复本地同步默认值，补充CLI配置元数据监测并修复双语文案。0.2.2清除顶部说明、将在线工具收进弹窗。0.2.3移除搜索/排序，修复本地同步重试、首次读取竞态和交接转义问题。0.2.4完成账号安全加固（内置浏览器启动页身份工牌隐私遮罩、回环摘要CLI代理不一致提醒、系统级 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` 环境变量残留扫描告警）、`reset_inferred` 额度窗口到期状态优化（清晰状态文案、到期后本地新消耗从0%基线叠加、展开详情一键打开在线校准弹窗）、软件设置页对齐 Cockpit Tools（胶囊 Tabs、置顶备份与资料目录卡片、90%–110% 界面缩放与启动默认页）及左侧菜单栏中英双语字号/内边距/分组/图标升级。早期“尚未改造额度卡片/尚未实现在线采集/仍为0.1.8”的报告仅代表历史时点，不能当成当前待办。

### 2.3 0.2.3交付基线与证据

- 产品源码提交和远端固定标签 `v0.2.3`：`85bbe6288597cc81b423737a3613596f0ffc6110`。
- [远程构建40011615441](https://github.com/yq04/Claude-Local/actions/runs/40011615441)与独立主分支检查40011614830均成功。正式构建启用 `custom-protocol`。
- [私有预发布v0.2.3](https://github.com/yq04/Claude-Local/releases/tag/v0.2.3)已发布，8项资产逐项重新下载并验SHA256，仓库保持私有。内部 `build-0.2.3-40011615441` 仅作传输，仍是草稿；旧版本和资产未覆盖。
- 安装器 `Claude-Local_0.2.3_x64-setup.exe` SHA256：`b7b0e41924380e48e236cfbae396830e2fe41c4bb705bfe056ebde885b104a24`。
- 宿主SHA256：`a8f838a0a65fa509f40b83217c43b77f36591df3eb63a1c3b5f722175a7ca806`。
- 独立前端10个文件与远程产物逐字节一致；独立资源审计109项、私密探针13项，零发现。本机102个安装文件核验通过，4个文件先备份后替换。
- 更新后版本、唯一主窗口、Rust额度核心和已安装Python后端检查通过。更新前后 `claude.exe` 均为0，未停止Claude或浏览器，不能宣称某个早期进程贯穿整个构建期存活。
- 产品交付后文档提交为 `e729b06cad66568511c681fa506d17023cab788b`。本次交接整理可继续前移HEAD；判断二进制看固定产品标签/回执，不要求HEAD等于产品提交。

私有回执集中在忽略目录 `.local/release-0.2.3/`：`final-source-receipt.json`、`ci-receipt.json`、`frontend-reproduction-receipt.json`、`prepared-selection.json`及对应`prepare-receipt.json`、`build-receipt.json`、`published-receipt.json`、`session-close-receipt.json`。实际安装路径和回滚备份从 `.local/last-local-update.json` 读取，不硬编码进文档或Git。原HANDOFF已完整备份并验证SHA256，备份回执为 `.local/release-0.2.3/handoff-close-backup.json`。

### 2.4 已执行的验证

本轮针对性检查：`--online-only` 10项真实组件/虚构IPC检查通过，含控件移除、卡片顺序、统一批次、首次revision竞态和一次失败后的重试；`--quota-reset-only` 6项通过；交接模板/观测年龄/双语目录19项Bun测试及TypeScript/Vite构建通过。修正了测试中遗留的旧刷新按钮名称，改用当前语言目录解析选择器。

同一产品提交的CI执行95项前端测试、216项原生测试通过，另1项忽略。日志确认以下关键用例实际通过：`passive_quota_revision_usage_cache_reaches_native_read_without_cross_account_merge`、`cross_account_session_resume_preserves_original_history_bytes`、`per_identity_proxy_and_repo_paths_and_oauth_lock_are_isolated_across_switches`。这些是合成账号证据，不代表真实账号登录、在线接口或NSIS系统升级已经验收。

## 3. 当前卡在哪、遗留什么、设计偏差

**没有交付阻塞。用户授权的0.2.3更新、打包、上传已完成；本次只收尾文档。** 没有需要继续等待的后台脚本或子代理，也不需要再次确认发布。

保留以下实际边界，不要为了“清零待办”冒险操作：

- 可选在线服务端接口和浏览器登录授权没有用真实账号重新验收，不能声称所有0.2.0在线报错都已修复。默认本地链路独立可用；若有新反馈，先从安全的元数据/脱敏错误定位，不为测试切换真实账号或轮换授权。
- 本机采用审计后的文件替换，没有运行NSIS安装器。安装、升级、卸载和系统设置的实际修改验收只在一次性Windows环境执行。
- Python3.10+与cryptography仍为外部依赖。额度代理仅支持当前明确实现的无认证HTTP CONNECT；不支持的HTTPS代理、SOCKS或代理认证应明确拒绝，禁止静默直连。
- 备份/救援恢复到新的私有副本，不自动激活或合并当前身份库；不包含未保存当前CLI内容或浏览器资料。不能把“可恢复副本”写成“跨机器一键接管已完成”。
- 订阅日期、手动重置余额、授权到期和5h/7d窗口是不同数据；无来源保持未知，不能补假日期、零余额或新的观测时间。

本轮未新增功能或按钮，未改动原生隔离、持久格式与历史策略，符合用户最终范围。有限源代码检查未发现可复现的原生隔离缺陷，不构成整个仓库无缺陷保证。没有需要追补的已知设计偏差；上述未验收边界必须如实保留。

工作分支为 `feature/functional-reliability-20261023`，同时已非强制推送到远端main。保留用户已有的 `AGENTS.md` 修改及未跟踪的 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/`、`docs/plans/2026-10-22-identity-quota.md`、`p6b-i18n.json`，不要顺手提交或删除。

## 4. 下一步计划与代码入口

1. 新会话先只读查看 `git status`、最近提交、版本清单、最终回执和用户最新反馈。远端tag可用 `git ls-remote --tags origin refs/tags/v0.2.3` 核对；本地未fetch到标签不表示未发布，更不要据此创建或覆盖标签。
2. 当前无新增需求，停止在已交付状态。若用户继续反馈，优先修复额度同步、账号交接和共享历史的具体问题，不重做美化，不恢复搜索/排序，不加解释条或新按钮。保留“账号安全优先、统一查询”的决定。
3. 若额度未更新，先区分CLI根本没有落盘、revision没有变化、摘要读取失败、账号指纹拒绝和仅有旧观测；用虚构IPC/临时目录复现。默认本地通路不依赖在线授权成功，不能为提高新鲜度越过账号绑定。
4. 按改动比例运行相关现有检查，通过即止。文档修改无需重跑产品全套测试或重新打包；新产品修复需要交付时使用新版本，不移动旧标签，不覆盖旧资产。

核心源码入口：`src/identities.tsx`（主按钮、卡片、revision检查、在线弹窗）；`src/identity-model.ts`（默认保留策略）；`src/identity-online-quota.ts`（统一批次/前台调度模型）；`src-tauri/src/identities/online.rs`（元数据监测及在线编排）；`profile.rs`与`src-tauri/src/quota_core.rs`（账号绑定与逐窗口额度）；`store.rs`及`optimization_tests.rs`（切换、回滚、共享历史）；`scripts/claude_quota.py`（额度唯一写入者）；`src/task-handoff.tsx`和`src/handoff-model.ts`（手工交接，非自动历史）；`src-tauri/src/window_state.rs`与`window_state_model.rs`（窗口记忆）。路径均相对仓库根。

现有针对性命令（按修改选择，不要全部无条件运行）：

```powershell
node --experimental-strip-types scripts/test-identities-ui.ts --passive-only
node --experimental-strip-types scripts/test-identities-ui.ts --online-only
node --experimental-strip-types scripts/test-identities-ui.ts --quota-reset-only
bun test src/handoff-model.test.ts src/identity-list.test.ts src/i18n.test.ts
bun run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol passive_quota_revision
```

交付工具位于忽略目录 `.local/release-0.2.3/`，按下载→独立前端比对→审计准备→备份更新→收集回执→私有发布使用，仅供未来新版本参考；旧输出均为已完成证据，不要再次执行覆盖。正式release编译走远程Runner，避免占用本机资源。

## 5. 踩过的坑：绝对不要再踩

1. **不要再擅自扩展界面。** 用户已连续反对顶部冗长解释、搜索和排序。保留现有功能并修明确问题，不能以“优化”为由继续添按钮、提示条或分账号查询。
2. **不要误读旧历史为待办。** 旧计划中的“未实施”“0.1.8”“需发布0.2.0”和旧失败日志已被后续交付取代。0.2.3已交付；文档HEAD前移不需要重新编译，更不移动产品标签。
3. **本地额度revision必须在摘要读取成功后确认。** 失败/旧请求返回false时保留待同步状态；首次基线也要补读以关闭打开页面时的竞态。不可恢复提前确认逻辑，不能用空结果覆盖旧观测。
4. **账号安全优先于新鲜度。** 不用其他账号数据兜底、不自动切CLI身份、不轮换共享refresh授权、不拷Cookie、不写 `.claude.json`。Python独占额度/网页元数据写入；账号/组织、独立观测时间和新锚点优先不能破坏。
5. **不终止 `claude.exe`，不碰真实身份与浏览器资料做测试。** 本机更新只允许对精确路径及启动时间匹配的 `claude-local.exe` 备份后重启，失败回滚。更新进程保护是对精确产品主程序的约束，不是禁止所有产品重启，也不是允许停止Claude。
6. **不清理共享工作树。** 禁止用stash/reset/restore/checkout/clean掩盖测试问题；不递归删工作树、不强推、不覆盖其他会话的改动。用户AGENTS.md和未跟踪文件保留。敏感文件、完整凭据和13项探针值不读取到模型或写入对话/Git。
7. **工具调用保持1:1。** exec脚本内绝不 `notify()` 或 `yield_control()`；结果一次输出，进展在普通commentary发送。Windows用PowerShell7（`pwsh`），不使用5.1；有后台任务就保持工具等待闭环，未完成不能提前final。
8. **正式构建与验收边界分清。** 构建必须 `--features custom-protocol`，采用中性独立Cargo目录、资源白名单和审计。私有仓库不等于解决第三方分发许可；真实NSIS/系统修改只在一次性Windows环境测试。
9. **每次版本同时检查字符串和数字版本门。** 0.2.3复制旧脚本时，字符串替换未覆盖两处 `FileBuildPart -ne 2`，已改为3；`FileMinorPart`仍为2。版本清单、可执行文件、commit、run及脚本门槛必须一致。只改数字检查，不移除检查。
10. **前端独立复现必须有自己的Git边界。** 从精确Git提交导出LF源码，解压后先 `git init --quiet`，避免Tailwind向上扫描父仓库导致CSS字节差异。预构建成功不等于远端比对通过，收到包后逐文件验hash才写匹配回执。
11. **私有草稿与正式预发布分开。** Actions存储曾满，使用 `delivery_transport=private-draft`。`build-<version>-<run>`始终草稿，不发布或删除；正式产品另建版本。标签检查遇网络/非404失败时先核实，不能把请求失败当标签不存在而覆盖。
12. **失败产物和回执保留，别覆盖造成功。** 每次准备使用新目录，保留原审计、回滚和路径门。PowerShell StrictMode可选属性先判断；组合Test-Path用括号；数值`findings=0`不能用`@($value).Count`当发现数，0会被计为一个元素。
13. **测试选择器和API契约同样要维护。** 旧“刷新本地记录”已变为“同步本地额度”，使用当前语言目录取标签。Radix弹窗会aria-hide主内容，断言卡片可访问性前先关闭弹窗。观察测试失败根因，不放宽业务断言或加长等待来冒充修复。
14. **窗口恢复旧坑仍有效。** Windows/Linux配置数组可能覆盖基础visible；恢复后显式show。Tao最大化缓存可能滞后，应读Windows正常外框/状态/DPI，不在move事件把最大化客户区存成正常尺寸。截图等待入场动画结束。`rustfmt main.rs`可能递归改子模块，只格式化明确文件。
15. **保持存储与迁移兼容。** BAGAID01、`.baga`、SQLite user_version=3、HMAC规则和旧浏览器种子域名不可变。迁移复制到新的私有目标并验证，不删除源；授权到期、订阅日期、手动重置余额与自然重置窗口不能混用。
16. **说明耗时要用实际阶段。** 本次优化原生编译约11分29秒，另有Runner排队、安装包组装/审计和传输；不要把等待都说成测试或上传慢，也不要虚构实时编译进度。
17. **更新交接先备份并验SHA256。** 本次原文完整归档在忽略目录，当前文件已去掉互相冲突的历史状态。文档收尾只提交HANDOFF等明确文档，使用独立`[skip ci]`提交，不重建、不改发布资产、不动产品标签。

## 6. 需要历史细节时再读这些文件

- [0.2.4更新说明](docs/RELEASE_NOTES_0.2.4.md)、[0.2.3更新说明](docs/RELEASE_NOTES_0.2.3.md)、[0.2.2更新说明](docs/RELEASE_NOTES_0.2.2.md)、[0.2.1额度恢复](docs/QUOTA_RECOVERY_0.2.1.md)：用户最终行为与修复原因。
- [0.2.0更新说明](docs/RELEASE_NOTES_0.2.0.md)、[0.2.0交付核验](docs/RELEASE_VERIFICATION_0.2.0.md)：较大功能实施和分发边界。
- [功能审查实施计划](docs/plans/2026-10-23-functional-review/04-IMPLEMENTATION-PLAN.md)、[执行记录](docs/plans/2026-10-23-functional-review/05-EXECUTION-RESULTS.md)：早期调研/实现证据，历史pending必须结合当前交付解读，不能照单重做。
- [额度卡片调研](docs/QUOTA_CARD_RESEARCH_2026-10-22.md)、[窗口与布局记录](docs/WINDOW_LAYOUT_2026-10-22.md)：来源、字段语义、许可证及窗口历史问题。
- [开发说明](docs/DEVELOPMENT.md)、[分发与许可](docs/DISTRIBUTION.md)、`LICENSE`、`NOTICE.md`：独立产品、构建和第三方许可约束。不存在上游同步、自动公开发布或官方更新源。

本次交接整理只修改文档，不修改程序、用户数据或发布内容。下一会话首先承接用户的新需求，而不是继续已经完成的发布。
