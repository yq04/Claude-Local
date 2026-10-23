<!--
[INPUT]: 当前未发布工作区、0.1.8 历史交付、Q/P/X 复核证据与本规划者独立核对的关键调用。
[OUTPUT]: 按依赖排序、可逐项实施和验收的可靠性修复及功能提升计划。
[POS]: 本轮唯一实施规划产物；不是已执行修复、真实账号验收、安装或发布记录。
[PROTOCOL]: 实施前核对工作树与各目录 CLAUDE.md；保持凭据、格式、单写者和用户会话边界。
-->
# Claude-Local 功能可靠性与后续优化 Implementation Plan

日期：2026-10-23。规划者：GPT-6.1 Sol（Astra, astra-plan/software）。

**本轮只做分析与计划。所有 Phase 的 Status 均为 pending；本文件不授权自动实施、安装或发布。**

**Goal:** 在保留统一查询入口和严格账号绑定的前提下，使额度查询可安装、可诊断、可取消、可恢复，并补齐首次接入、用量归属、数据救援等实际使用闭环。

**Architecture:** React 负责统一操作与结果呈现；Rust 负责资源、任务生命周期、受限本机能力及身份事务协调；Python 继续独占额度账本、在线请求状态与网页元数据写入。OAuth 与 managed browser 是分别受验证和退避约束的取数通路；账号指纹、授权生命周期、网络路由、字段新鲜度必须分别建模。

## 1. Hard constraints 与明确不做

以下是本仓 `AGENTS.md` 的原文约束，不是本计划新增的产品承诺：

- “Never interrupt a running claude.exe during development or deployment.”
- “Preserve existing vaults and browser profiles.”
- “Migration copies into a fresh private destination and verifies integrity, hashes and identity counts; never deletes the source.”
- “Python is the sole quota-ledger writer, with a cross-process lock, atomic replace and newer-anchor precedence.”
- “Keep BAGAID01, .baga archive encoding, SQLite user_version=3, account HMAC rules, and the legacy CCBaga/browser seed-domain string intact.”
- “The browser is a subsystem, launched only by an explicit user action or --browser. The main application does not launch it at ordinary startup.”
- “Destructive operations require the existing explicit confirmation, process/snapshot checks, and rollback behavior.”
- “Release builds require --features custom-protocol.”
- “Actions currently run checks and optional private build artifacts; no automatic public releases or updater feed.”

额度规则还规定不写 `.claude.json`、不后台 OAuth 轮询及小时/手动 UI 刷新。用户在后续需求中已明确授权“前台、默认关闭、约三分钟、完整目标集”的查询例外，当前实施依据是 [额度计划最后一节](../2026-10-22-identity-quota.md)。此例外不能扩展为启动即联网、托盘轮询、隐藏窗口继续开新自动任务或自动轮换共享 CLI 授权。

本轮不做排版、美化、换组件、重做图表，也不把窗口/卡片几何作为优化主线。不自动修改系统、安装依赖、操作真实身份、调用真实额度、导出 Cookie、迁移现有资料、构建发布或覆盖安装。不添加上游同步、自动更新源、公有发布、外部密钥托管和消耗手动重置权益的动作。

不清理并发工作区，不运行 stash/reset/restore/clean，不覆盖历史计划或 HANDOFF。后续若确需更新 HANDOFF，先按其头部要求备份并验证 SHA256。

## 2. 当前方案的独立结论

**方向可行，但尚不满足“已交付且无明显问题”的条件。** 统一入口确实减少了逐卡查询与切换 CLI 的操作，严格校验账号/组织、只读获取、Python 单写者及失败保留旧证据均应保留。当前已发现资源部署遗漏、归档读取完整性问题、批次状态/取消不足和授权恢复断层，须先修复，再验收实际可用性。

尤其不能把“已运行浏览器 fallback”当成长期全账号查询的完整解法。归档 access credential 会真正失效；`src-tauri/src/browser/workspaces.rs:144–165` 的联动切换会退出旧资料并启动新绑定资料，而 `quota_existing.rs:157–161` 只允许已经运行的对应资料。因此，它能改善部分手动查询，却通常不能覆盖已关闭的保存账号资料。扩大指纹门限、借用当前账号或轮换共享 refresh credential 都不能解决这一架构缺口。后续必须提供集中连接修复队列，并先验证服务商实际允许的授权能力；仍只保留一个查询入口。

### 已确认事实

- 基线安装/发布为 0.1.8；本次额度源码位于未提交工作区，复核时 HEAD 为 `92751ab`。旧版本的安装和窗口验收不能证明新链路可用。
- UI 构造完整目标，Rust 按指纹去重、最多两个 worker；OAuth 使用同一 access credential 先验证 profile 再读 usage，提交前重读本地目标和凭据。
- 浏览器桥使用短期一次性回环票据、固定扩展 Origin 与唯一账号/邮箱/组织指纹匹配。仅订阅更新不能冒充本次额度成功。
- Python/React/MV3 分层合成检查已有通过记录，见 [Q 报告](01-QUOTA-REVIEW.md)。尚没有贯穿安装资源、真实 Tauri 编排、Python 子进程、真实 content script 导航和提交的合成闭环。
- 本规划者另用内存合成帧复现：Python `decrypt_baga` 接受缺少认证结束帧的输入。复现见附录；没有使用真实归档或凭据。

### 推断与未知

全批网络等待、重复归档解包会放大大量账号或大归档的耗时；超时强杀 Python 后明文临时目录/子进程可能遗留，这是源码导出的风险，未证明用户机器已经发生泄漏。真实账号 profile 字段、网页 API 权限、挑战页面、授权失效周期、限流及跨账号网络出口均未实测。

公开实现支持工程可行性，不能升级为官方稳定 API、永远免登录或固定刷新频率的保证，见 [X-01 至 X-07](03-EXTERNAL-EVIDENCE.md)。完成本计划后的结论也应是“满足约定交付门槛”，不是零缺陷保证。

## 3. 证据索引与修复优先级

[01-QUOTA-REVIEW.md](01-QUOTA-REVIEW.md) 的 Q 编号记录额度链路；[02-PRODUCT-REVIEW.md](02-PRODUCT-REVIEW.md) 的 P 编号记录全项目功能；[03-EXTERNAL-EVIDENCE.md](03-EXTERNAL-EVIDENCE.md) 的 X 编号记录外部资料。下列 A 编号为本规划者独立核对的补充，编号不是证据等级。

### P1：进入新版额度交付前处理

**Q-01 / X-07：两条交付路径资源不一致。** `scripts/deploy-local.ps1:37–41` 仅复制被动采集器，缺少 online helper 和三份扩展资源；Tauri bundle 清单已经包含它们。修复必须覆盖实际 resource_dir 布局、备份和逐文件哈希，不只是让源码清单看起来正确。

**A-01：UI 与原生批次生命周期不一致。** `src/identities.tsx:178–181` 的 locked/actionLocked 及 `452–454` 的 onBusy 不含 batchBusy；`467–468` 临时写入 busyRef 后，后续 render 又会按 busy=false 覆写。`484` 开始的批次没有 setBusy(true)，所以某些身份动作或导航仍可发起，最终才被原生 Cleaner 拒绝。这不是已证实的数据串写，但会产生“按钮可点却全部报忙”、离页后失去任务状态等问题。

同组还须统一 recovery 门控：单账号 `online.rs:165` 拒绝 recovery 状态；批次 `485–495` 冻结 State 后只验证指纹，未做同等检查。目标集改变时 UI 撤销 request ID，但需同时把旧批次置为明确终态，不能留下永久“进行中”。

**A-02：在线查询复用过重且不完整的归档读取器。** `scripts/claude_quota_online.py:182–215` 调用 `claude_quota.py:598–660`，后者完整解密并将配置、凭据和 projects 槽解包到 TEMP，还扫描会话。在线额度只需要最小账号/授权/路由投影，不需要项目正文。`decrypt_baga:416–439` 未强制结束帧，EOF 即成功；同类 Rust `src-tauri/src/identities/codec.rs:127–157` 则验证结束及多余尾部。此完整性差异已通过内存样例确认。必须修复，不更换 BAGAID01 或重生成密钥。

**A-03：授权冷却阻断后来可用的浏览器恢复。** `_claim:374–389` 将历史失败统一返回 cooldown，没有失败原因；`online.rs:536–544` 仅在 AuthRequired/Unavailable/NetworkError 时尝试网页。首次 401 后，即使用户随后打开正确资料，五分钟 OAuth 冷却内再次统一刷新仍无法进入该备用通路。应区分 OAuth 暂不可重试和网页通路是否可尝试，保留有效 429，不能通过重登清退避。

**A-04 / X-07：运行能力未形成可操作的诊断。** `online.rs:236–311` 选择首个能 spawn 的 python；其缺依赖、版本不兼容或应用执行别名失败后，不继续探测其他解释器。`claude_quota.py:30` 无条件需要 cryptography，`quota_setup.rs:203–219` 只检查脚本/statusLine，不验证在线运行能力。开发终端 Python 可用不等于 Explorer 启动的产品可用。先探针选择一个合格 runtime，再执行一次业务请求；业务失败不能触发换解释器重复联网。

**A-07：账号绑定与网络路由尚未对齐。** `claude_quota_online.py:265–284` 使用 urllib 默认 opener，未读取保存账号的代理设置；`online.rs:236–260` 也未注入账号路由。相对地，`profile.rs:1418–1454、1673–1678` 读取每账号设置中的代理摘要，`browser/config.rs:183–199` 使用浏览器独立代理。因此 OAuth 查询可能共用宿主出口，与账号配置不同。实现差异已确认；实际出口及关联后果未知。账号有显式独立路由时，这是 P1 能力缺口；未配置时可明确使用宿主路由。不能声称指纹验证提供了网络隔离。

**Q-02：整批 Cleaner 占用与无取消。** 原报告列 P2；本计划结合 A-01 和完整目标集需求，将交付优先级提高为 P1。`online.rs:476–594` 整批持锁，单个 OAuth helper 上限 30 秒、网页等待 20 秒，随后导入还可能执行 helper；两个 worker 并不构成整批时限。先补可取消和总预算，再以经过验证的两阶段提交缩短锁。不能直接删除锁。

### P2：结果可信度与功能闭环

**A-05：本地过期元数据与实测授权矛盾。** online 已允许过期 expiresAt 的 credential 实际探测，但 `profile.rs:1391–1405` 仍据此判 expired/refresh_needed，`identities.tsx:231、972、1027` 仍排除推荐或显示需重授。应分开“本地到期提示”“最近服务端验证”“当前连接能力”；成功探测不需要改 CLI 文件或伪造新的凭据期限。

**A-06：结果和权益缺少完整语义。** `identity-online-quota.ts` 的 isSuccessfulOnlineResult/aggregateBatchProgress 将 cooldown 统一计入 error；已有近期成功缓存时，这会误导为整批失败。批次应分别统计本次更新、保留缓存/冷却、需连接、失败、未核验、未执行/取消；5h、7d 部分更新单独表达。

`quota_bridge.rs:74–97` 只输出当前 grant 总和，持久层丢弃有效期，卡片可能长期显示旧余额。依据 X-04，过期权益不能无限期当作可用。X-05 的“零余额省略部分字段”是兼容性待验证项，不是已复现服务端故障；正余额仍需完整有效期和暂停状态。

**Q-03 / X-02：保存账号长期连接能力不足。** 这是当前有意保守的边界，不是放松校验即可修复的 bug。把“刷新失败后怎么办”收敛为一个集中恢复流程，避免恢复成逐卡查询按钮或长期只有旧值。

**P-01、P-03 至 P-07、P-09：产品闭环。** 按第 5 节收益顺序实施；P-05 已合并原 P-10 的目录定位；P-02 按启动偏好优化处理。P-08 只能作为待验证的网页登录能力建议：当前没有可信的 current.web.login_status 字段，现有 web 对象是订阅/权益元数据，不能把拟新增字段写成现有接口，也不能清除 CLI 授权或历史额度。

## 4. 目标接口与任务约定

统一入口继续使用完整目标集，不受搜索/排序影响。增加受限的批次状态和取消命令，例如 `identities_quota_batch_state(request_id)`、`identities_cancel_quota_batch(request_id)`；不暴露任意命令、路径或 URL。

任务状态建议包含 `queued/running/cancelling/completed/cancelled/deadline_exceeded`，每个目标保留终态及精确 observed/retry 时间。结果可增加白名单 `reason`、`stage`、`route_mode`、`retry_scope`、`updated_windows`，区分 runtime_missing、dependency_missing、identity_unverified、route_unavailable 等；禁止透传 stderr、授权、代理 URL 或个人路径到诊断复制。

取消只停止本产品创建的额度 helper 及其受控子孙、停止启动后续目标、撤销未提交票据；不结束 CLI、不退出用户浏览器、不删除任何资料。已经原子提交的观测保留，不做“取消回滚额度”。

路由选择必须在请求前冻结：有账号显式配置时使用该配置；无配置时明确使用宿主路由。两个固定 OAuth 请求走同一选择。对暂不支持的 SOCKS/认证代理不能静默直连，应给 route_unavailable 或在手动模式使用已验证的对应浏览器。原始代理秘密留在 Python/原生内部，不能使用 UI 已脱敏的 summary.proxy 还原代理，也不能把浏览器配置自动复制进 CLI。路由策略在提交前复核；网络出口是否相同另行观测，不能靠配置文本推断。

## 5. 产品功能收益排序

投入 S/M/L 是相对改动范围，不是工期承诺；风险指引入改动的风险。下列条目不要求重排页面。

1. **统一查询可恢复、可取消、结果诚实。** 收益最高；风险中；投入 M/L；对应 Q-01/Q-02/A-01 至 A-07。先处理实际不可用与错误反馈，后续连接队列仍共用这一入口。
2. **首次接入与 CLI 缺失引导。** 收益高；风险低；投入 S；对应 P-01。提供已核实的安装说明/命令复制、安装后重查、授权后保存检查点；不代用户执行远端脚本。
3. **稳定用量归属设置与覆盖说明。** 收益高；风险中；投入 M；对应 P-03/P-09。显式选择稳定 account ID、预览影响、允许撤销，原事件不变；展示当前 IANA 时区与本地采集覆盖，不新增被用户取消的“未归属历史”筛选页。
4. **浏览器绑定与启动行为解耦。** 收益中高；风险低至中；投入 S/M；对应 P-02/Q-03。默认保留切换前运行状态：原来关闭则只更新绑定/启动参数，原来运行则按现有确认重开；订阅同步/打开浏览器仍是明确动作。此项改善专注流程，不代表首次普通启动存在越界。
5. **安全的全库备份、恢复预检与救援。** 收益高；风险高；投入 L；对应 P-05/P-07（含原 P-10）。分开“打开产品数据目录”“校验副本”“受口令保护的完整备份”“在新目标恢复”。含主密钥的普通压缩包不算安全加密备份。
6. **电脑环境修改前快照与有冲突检测的恢复。** 收益中高；风险高；投入 M/L；对应 P-04。记录每次明确修改前后的受限字段，不以“首次运行快照”覆盖用户后来自行修改的系统配置。
7. **按错误导流的排障与诊断。** 收益中；风险低；投入 S/M；对应 P-06/A-04。快速配置按 runtime、路由、授权、浏览器和恢复状态给下一步；深链只导航/聚焦，不顺便扫描清理或改变系统。
8. **手工交接的显式保存/载入与重复任务便利。** 收益中；风险中；投入 M；属于新增建议。可选导出/载入用户选定的 Markdown，不自动读取聊天、项目或身份；继续保留内存草稿默认。不优先于前七项。

不建议此时增加自动切最优账号、自动结束会话、后台网页登录、自动消耗重置、云同步凭据或大型插件市场。它们增加高风险状态，不能解决本轮的核心缺口。

## 6. 分阶段实施

所有文件均为后续拟修改/新建；新测试命令只有实施后才可运行。每阶段均更新实际涉及源文件的 INPUT/OUTPUT/POS 和目录 CLAUDE.md；涉及文案时同步 `src/locales/zh.yaml`、`en.yaml`，不为文档或纯复制动作增写镜像实现的测试。

### Phase 0: 交付资源与无账号运行能力

**Status:** pending

**Files:**

- Create: `scripts/runtime-resources.json`、`scripts/test-runtime-resources.py`、`scripts/test-quota-runtime.py`。
- Modify: `scripts/deploy-local.ps1`、`scripts/audit-windows-package.py`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.windows.conf.json`、`src-tauri/src/identities/online.rs`、`scripts/claude_quota_online.py`、`src-tauri/src/quota_setup.rs`。
- Modify: 对应 scripts/src-tauri 目录图、`docs/DEVELOPMENT.md` 与两语运行错误文案。

**行为/接口：** 为额度所需公开资源建立单一受控映射，bundle 静态配置和审计通过比对保持一致，不在构建时重写追踪文件。部署完整包含两个 collector、扩展三文件以及后续最小归档模块；逐文件备份/哈希/失败恢复。增加无账号 `--runtime-info` 探针，按实际使用的 `-E -s` 启动规则检测版本、cryptography、解码能力和协议；不触碰 HOME/保险库。选择第一个通过能力探针的 runtime 后只发一次业务请求。暂不自动安装 Python/pip；是否随包提供受控 runtime，先核对体积、许可和维护成本再决定。

**依赖：** 无；Phase 1 新文件须回填相同资源映射。

**验证：** `python scripts/test-runtime-resources.py`、`python scripts/test-quota-runtime.py`（拟新增）及 `python scripts/test-audit-windows-package.py`。临时安装树中的资源路径/哈希应一致；首个解释器缺依赖、后一个可用时应正确选用，全部缺失应给明确原因。测试只调用抽离的资源事务，不执行会创建桌面快捷方式的完整 deploy 脚本。

**反模式：** 用开发源码路径掩盖安装资源缺失；把可执行 python 等同依赖齐全；遇到 HTTP 错误轮番换解释器重复请求；为测试修改系统 PATH、安装软件或真实安装目录。

### Phase 1: 最小归档投影与账号路由

**Status:** pending

**Files:**

- Create: `scripts/quota_archive.py`、`scripts/test-quota-archive.py`。
- Modify: `scripts/claude_quota.py`、`scripts/claude_quota_online.py`、`scripts/test-claude-quota-local.py`、`scripts/test-claude-quota-online.py`；Phase 0 资源清单与对应目录图。
- Modify: `src-tauri/src/identities/online.rs` 的受限路由结果契约，以及 `src/identity-online-quota.ts`/两语文案。

**行为/接口：** 提供 `read_online_identity(vault, archive)` 的内部最小投影：只取 manifest、账号配置、授权及必要的两份 settings 中路由字段，不展开 projects、不扫描会话、不把明文落 TEMP。解密遵循已有完整认证规则，强制结束帧、拒绝多余尾部/非法帧和不安全成员，设置有界配置大小、流式内存与总时限；旧 gzip/现有 Zstd 仍可读。若继续使用 tar.exe，仅通过受控 stdin/stdout 读取指定 member，禁止 -xf 明文解包；子进程纳入本次 helper 的受控进程树。

同时修复共享 decrypt_baga 的认证完整性，不能只让 online 绕开已确认缺陷。Python 请求前冻结有效账号路由，profile/usage 同路；不支持的显式路由拒绝静默降级。

**依赖：** Phase 0。归档辅助接口只在 Python 内流动凭据，不增加 GUI 秘密输出或改变账本单写者。

**验证：** `python scripts/test-quota-archive.py`（拟新增）、`python scripts/test-claude-quota-online.py`、`python scripts/test-claude-quota-local.py`。合成完整/截断/多尾帧、gzip/Zstd、巨大 projects 成员、链接成员和输出上限应证明：不读取项目、不产生明文临时目录，缺认证尾帧拒绝。用虚构 A/B 代理 transport 验证请求分别选路，不访问互联网。大样例验证资源上限，不设开发机速度阈值。

**反模式：** 重生成密钥/HMAC/种子；普通打包临时明文凭据；为了少读几个字节跳过尾部认证；把脱敏代理文本用于真实连接；全局修改 HTTP_PROXY。

### Phase 2: 统一批次状态、取消和恢复结果

**Status:** pending

**Files:**

- Modify: `src/identities.tsx`、`src/identity-online-quota.ts`、`src/identity-online-quota.test.ts`、`src/main.tsx`（仅任务状态接线）。
- Modify: `src-tauri/src/identities/online.rs`、`src-tauri/src/main.rs`、`scripts/claude_quota_online.py`、`scripts/test-claude-quota-online.py`、`scripts/test-identity-batch.ts`；对应目录图和两语文案。

**行为/接口：** 批次有原生 ID、可读状态、取消信号和整体预算。初始建议总预算 120 秒，作为可调整产品默认而非服务 SLA；到期停止排队，明确保留未执行目标，统一重试仍不要求逐卡操作。任务状态不依赖 IdentityPanel 挂载；先以同一 task 锁统一按钮/导航/恢复闸门，再允许读页面在任务服务接管后自由导航。所有路径 finally/取消/目标变更必须进入终态，目标恢复中原生拒绝新批次。

OAuth cooldown 透出白名单原因与通路范围：授权冷却期间手动统一查询可跳过 OAuth，尝试已经运行的对应网页登录；有效 429 不被清除。已有近期观测的 cooldown 显示保留/待重试，不计为新更新或普通失败。自动模式仍默认关闭，失焦/隐藏不再启动新的自动目标，取消不关浏览器。

将本地 expires 元数据与最近实际验证分开；通过绑定的服务端验证记录连接能力，卡片不再同时显示“本次已更新”与未经服务端证实的“必须重登”。不能据本地到期时间禁止用户查询。

**依赖：** Phase 0/1。可先保留整批 Cleaner 锁交付取消与时限，再进入 Phase 3 缩锁；不把半完成的缩锁混入此阶段。

**验证：** `bun test src/identity-online-quota.test.ts src/i18n.test.ts`、`python scripts/test-claude-quota-online.py`、`node --experimental-strip-types scripts/test-identities-ui.ts --online-only`；Rust 仅运行 `identities::online::tests`。用一个阻塞 worker 覆盖取消、离页重入、乱序/重复结果、目标变更终态、recovery 拒绝、过期元数据但服务端成功，以及“401→打开资料→冷却内统一重试网页”。

**反模式：** 只清 UI busy 就称已取消；用 taskkill /IM 杀所有 Python/Chrome；取消后回滚已写观测；把冷却当成功新观测；每卡重新增加查询按钮。

### Phase 3: 网络等待与身份提交分离

**Status:** pending

**Files:**

- Modify: `src-tauri/src/identities/online.rs`、`src-tauri/src/cleaner.rs`、`scripts/claude_quota_online.py`、`src-tauri/src/browser/quota_existing.rs`。
- Modify: 对应原生/Python 批次测试、目录图及 `src-tauri/SECURITY.md`。

**行为/接口：** 采用明确两阶段 helper 协议，而非简单释放现有锁。短锁冻结目标与身份代次；网络读取在锁外；helper 发出不含秘密的 ready_to_commit 通知后，由 Rust 重新取得身份事务门、核验代次/取消状态，再允许 Python 在其 ledger writer lock 中重读指纹/授权/路由并原子提交。Rust 持有短提交门直到收到提交结果；超时/断管即拒绝提交。锁顺序固定为“身份事务门→Python writer lock→SQLite”，不反向等待。

最小实现继续让 Python 读取凭据、请求服务及写账本，Rust 不持久化 usage 结果代替 Python。所有等待有截止时间；取消不得在原子 replace 中间强制终止写入。Windows 如需进程树清理，只将本次额度 helper 纳入专属 Job，不将已运行浏览器或 CLI 纳入。

**依赖：** Phase 1/2。若两阶段协议尚未验证，保留有取消/总时限的旧锁，明确列为剩余限制，不能宣称已解决网络等待阻塞。

**验证：** `cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol identities::online::tests` 与 `python scripts/test-claude-quota-online.py`。注入阻塞 transport，网络等待时身份事务应可进入；目标/credential/route 改变后旧 helper 应拒绝提交；取消、断管、过期 lease、Python 写入期间超时均不损坏 ledger。使用临时 fixture，不能进行真实切号。

**反模式：** 直接删除 Cleaner；只靠 UI generation 防止原生写入；跨请求复用全局 current；新增 Rust ledger 写入方；声称此门能锁住应用之外的所有 CLI 登录动作。

### Phase 4: 浏览器真导航集成与权益语义

**Status:** pending

**Files:**

- Modify: `browser-runtime/quota-bridge/content.js`、`browser-runtime/quota-bridge/background.js`、`src-tauri/src/browser/quota_bridge.rs`、`src-tauri/src/browser/quota_existing.rs`、`src-tauri/src/browser/server.rs`。
- Modify: `scripts/claude_quota_online.py`、`src/identity-model.ts`、`src/identity-online-quota.ts`、`src/identities.tsx`、现有桥接/在线测试及两语文案。
- Create: `scripts/test-quota-integration.mjs`；必要的原生 test-only fixture 接线及目录图。

**行为/接口：** 用真实页面导航加载 loopback 配对页和自动注入 content script，再进入被拦截的 HTTPS 合成 usage 页；覆盖 worker 休眠/重启、挑战/重定向、票据过期和多组织。请求设置明确超时、正文上限与失败原因。对网页请求中身份变化增加前后验证和拒收测试，不放松指纹或导出 Cookie。

分开 usage、billing、manual resets 的成功/失败及字段时钟。零余额省略状态字段按合成契约独立处理；正余额仍要求完整有效性。保存有界权益有效期或失效边界，过期后保留“上次观测”并标记需更新，不推进观测时间、不无限期声称余额可用。网页登录能力若要新增，先设计其探针、观测来源与失效事件；清理网页资料只令该能力未知，不推断 CLI 授权失效。只读展示，不增加消费动作。

**依赖：** Phase 0–3 的资源、取消、提交协议。test-only transport/路径注入必须在测试构建内，生产不得增加任意 endpoint 参数或绕过 TLS/账号校验的环境开关。

**验证：** `node scripts/test-quota-browser-bridge.mjs`、`node scripts/test-quota-integration.mjs`（拟新增）、`python scripts/test-claude-quota-online.py` 及 Rust `browser::quota_bridge::tests`。至少一个样例贯穿真实 Tauri command 编排→安装资源解析→系统 Python→原生回环 receiver→Python ledger→UI 读取；OAuth 用注入的合成 transport，浏览器用全新资料/受控 HTTPS 拦截，禁止外网。原有 VM/worker 单测保留作为局部证据，不替代此闭环。

**反模式：** 再用 worker.evaluate 直接调用当作自动注入验收；仅订阅成功就给额度成功；同组织即同账号；挑战页当已授权；把过期权益清成“服务端刚确认零”。

### Phase 5: 查询连接生命周期与集中修复队列

**Status:** pending

**Files:**

- Create: `docs/plans/quota-connection-capability.md`（执行时新建，不覆盖历史）。
- Create: `src/identity-connections.tsx`、`src/identity-connections.test.ts`。
- Modify: `src/identities.tsx`、`src/identity-online-quota.ts`、`src-tauri/src/identities/online.rs`、browser 显式启动边界、`scripts/claude_quota_online.py`、帮助与目录图。

**行为/接口：** 先回答服务商实际允许何种独立授权、作用域、撤销、续期和本机存储，再选择实现；不能预设存在只读 scope 或可复用的官方私有 client。能力验证可与前阶段规划并行，连接实现依赖前阶段通过。

统一批次完成后给“需要连接/路由修复”的集中队列，说明每账号原因和可行步骤。打开某个账号资料须用户明确动作，仅打开其独立绑定，不切全局 CLI/slot、不复制网页登录态；处理完成后回到同一统一服务继续待办。人工登录步骤无法消除，但不再要求用户逐卡点“查额度”。

若服务商支持适当的独立授权，单独设计私有存储、撤销和单持有者续期；不得接管共享 CLI refresh credential。若不支持，明确采用显式网页登录恢复及有限期复用，保留不可查询账号的真实原因，不把旧观测当作功能完成。任何账号级连接秘密不进入 SQLite 显示摘要、日志或 IPC 展示。

**依赖：** X-01/X-02 的能力复核、Phase 0/2/4；未通过 provider 能力验证不得实现自动刷新凭据。

**验证：** `bun test src/identity-connections.test.ts`（拟新增）、现有 `--online-only` 与 Python 在线测试。合成两个已连接、一个需登录、一个路由不支持的队列，验证一次全查询、集中修复、仅重试待办、始终正确绑定，且没有全局 CLI 写入。真实首次授权验收按第 8 节另行进行。

**反模式：** 为“免登录”偷偷轮换共享 refresh；循环打开全部浏览器；凭空承诺授权期限/只读 scope；以保留旧值或恢复逐卡查询代替需求。

### Phase 6: 高频产品闭环，分小批交付

**Status:** pending

本阶段各子项均为 pending，可独立实施；不要求等所有新增功能完成才交付可靠额度。

**6A 首次接入 / 浏览器启动 / 排障导航。** Modify: `src/claude-cli-panel.tsx`、`src/help.tsx`、`src/quick-actions.tsx`、`src/app-events.ts`、`src-tauri/src/browser/workspaces.rs`、相应模型/两语/目录图。CLI 未安装时提供经实施时官方资料核实的安装说明复制、明确重查入口；不在应用执行远端脚本。浏览器联动默认保留之前的运行状态，更新确认文案。排障入口只定位现有残留工具，不自动扫描或清理。依赖 Phase 2，避免再次绕过任务锁。验证：CLI 合成 UI、`node scripts/test-usage-statistics.mjs .local/preview/functional-review-quick --quick-only`、Rust 仅 browser workspace 对应测试；关闭浏览器的虚构切号不产生 launch，运行状态才重开。反模式：绑定等同必须启动；复制操作误报成功；把导航当执行授权。

**6B 用量归属 / 统计口径。** Modify: `src/usage-statistics.tsx`、`src/usage-model.ts`、`src/usage-export.ts`、`src-tauri/src/identities/usage.rs`、`usage_tests.rs`、两语与 `docs/USAGE_STATISTICS.md`。新增受限 read/set/clear 归属配置命令，使用已核验稳定 account ID 和确认预览，不用名字作为持久键；统计 read 不再承担新的用户配置写入。展示当前 fallback 规则、覆盖缺口、IANA 时区；清除规则可恢复未归属聚合，原始事件不动。依赖现有 usage 账本，无在线额度依赖。验证：`bun test src/usage-model.test.ts src/usage-export.test.ts`、Rust `usage_tests` 与对应统计合成 UI；两账号同名/改名、设置/撤销后 totals/trend/model/filter 保持一致，原 event owner 不变。反模式：按显示名重分配历史、无确认自动兜底、伪称官方账单。

**6C 电脑环境修改与恢复。** Create: `src-tauri/src/system_changes.rs`；Modify: `src-tauri/src/system.rs`、`browser/mod.rs`、`src/system.tsx`、两语和目录图。在每次用户明确修改前记录本次受限 before/after；恢复时比较当前值是否仍等于应用上次写入值，有冲突先提示并让用户选择字段。读不到的定位/自动时区不伪造可还原能力；部分失败记录实际完成项。依赖用户触发/原子私有写入。验证仅用 native adapter fake 与前端 fixture；真实时区/语言/定位变更及恢复只在一次性 Windows runner 验收。反模式：启动时保存“初始环境”后永久覆盖后续用户设置；本机运行 SystemTests；未知权限时自动更改。

**6D 数据备份与恢复救援。** Create: `src-tauri/src/identities/backup.rs`、`backup_tests.rs`；Modify: `src/settings.tsx`、`src-tauri/src/main.rs`、`identities/mod.rs`、`scripts/migrate-local-data.py` 的可复用边界及目录图。先加仅打开 app_data_dir 的原生命令，不接受任意路径。完整备份使用已有可靠加密库和经审查的口令派生/认证外层封装主密钥与归档；保持内部 BAGA/ID/HMAC 格式。SQLite 使用一致性 backup/snapshot，不热复制 WAL；浏览器资料另列离线范围及跨机登录态限制，不承诺 Windows 绑定 Cookie 可直接迁移。

恢复先在全新私有目标验证 hash、SQLite integrity、身份数量、归档认证及映射，源和失败副本保留。recovery 反复失败时提供只读原因/容量/损坏定位和救援副本，禁止以“强制清 recovery”作为默认修复。救援位置为每用户产品 AppData 下的新私有目录，或用户明确选择的新私有目标，不能写到源码仓库 .local。具体口令派生算法与参数在实施时评估，不预先承诺新增密码库依赖。依赖 Phase 1 严格归档与现有 private/migration 规则；不停止 claude.exe。验证：Rust `backup_tests`（拟新增）与 `python scripts/test-migrate-local-data.py`，全部使用合成保险库；错误口令、损坏/缺钥、写入中快照、目标已存在应安全拒绝，恢复不删除源。反模式：含 key.bin 的普通 zip 宣称加密；清恢复标记后掩盖失败；热复制浏览器资料；备份失败清空目标或源。

### Phase 7: 有条件试用与独立交付

**Status:** pending

**Files:**

- Create: 执行当日的验收记录和明确版本的发布说明；新文件路径由实际候选确定。
- Modify: `README.md`、`docs/DEVELOPMENT.md`、`docs/USAGE_STATISTICS.md`、帮助/目录图；确有交付时按规则更新 `HANDOFF.md`。
- Modify: 只有确需构建交付时，才调整对应 workflow/审计配置；不预设新版本号。

**行为/接口：** 先锁定可复核候选和资源 hash，完成第 7/8 节门槛，再按用户后续明确交付范围执行。保留正式 custom-protocol、资源隐私审计、备份、失败回滚与私有分发边界。0.1.8 标签不移动，不把 docs 提交当新产品版本。

**依赖：** 当前额度交付至少 Phase 0–4 完成；长期免逐号维护的承诺还依赖 Phase 5 的实际能力结论。Phase 6 可按收益单独交付。

**验证：** 对实际改动运行一次匹配验证；正式构建另按既有流水线审计。真实 NSIS 安装/升级/卸载只在一次性 Windows 环境执行。验收报告分开列源码、合成集成、真实只读账号和安装结果，不合成一个“全绿”。

**反模式：** 复用旧安装回执证明新源码；在本机大型 release 构建/系统修改；自动推送发布、移动旧标签或替换旧发布资产。

## 7. 验证总入口与交付门槛

本轮已执行的新增验证只有附录的内存认证结束帧复现；01 中的分层测试记录不在本规划中重复冒领。以下是后续实施选择性入口，不是要求每个文档改动运行全库：

```powershell
# 归档/请求改动
python scripts/test-quota-archive.py
python scripts/test-claude-quota-online.py
python scripts/test-claude-quota-local.py

# 批次状态与两语
bun test src/identity-online-quota.test.ts src/i18n.test.ts
node --experimental-strip-types scripts/test-identities-ui.ts --online-only

# 桥接改动：后者为拟新增的真导航集成
node scripts/test-quota-browser-bridge.mjs
node scripts/test-quota-integration.mjs

# 资源改动
python scripts/test-runtime-resources.py
python scripts/test-quota-runtime.py
python scripts/test-audit-windows-package.py
```

原生按实际修改只选 `identities::online::tests`、`browser::quota_bridge::tests`、`usage_tests`、`backup_tests` 等一个或必要的少数过滤器，使用 `--locked --features custom-protocol`。缺少完整引擎资源时采用 `docs/DEVELOPMENT.md:65–67` 的公开资源 TAURI_CONFIG 覆盖，保存并恢复原环境值，不覆盖用户已有配置；不设置 GITHUB_ACTIONS 强迫本机执行系统测试。修改前端实现后运行一次 `bun run build`。仅做文件复制/文档文案等低风险改动，不另写镜像测试。

通过即止；只有新的改动、失败或未解决证据才扩大验证。不执行无关全库回归，不增加多轮深度审查仪式。

新版额度的最小交付门槛：

- **资源门：** 实际安装树包含完整 helper/扩展/归档模块，目标环境能力探针明确通过；不是只验证开发终端。
- **隔离门：** 同组织异成员、错账号/凭据/路由变化、recovery、取消与旧 lease 均不能提交错误目标；归档缺认证结束帧必须拒绝。
- **可用性门：** 两 worker、有整体时限及取消，进度可恢复；冷却与授权修复不互相堵死，查询不长期冻结身份工作。
- **集成门：** 至少一个真实导航的合成原生链路通过，未触碰真实身份或系统设置。
- **说明门：** 明确哪些是本次新观测、哪些是保留缓存、哪些需要连接；不承诺全部账号长期可查。Phase 5 未闭环时，只能交付有边界的在线查询，不能宣称最终需求全部完成。

## 8. 首次真实只读授权/隔离验收

这是后续专门验收，需要用户在场并选择授权账号与允许的网络操作，本轮不执行。先通过合成门槛，再选最小代表样本：有效 OAuth、确需重新连接、可复用隔离网页登录，以及有多组织/独立路由的情况；无需机械地验证所有订阅类型。

用户亲自完成必要登录或授权；不让测试读取真实凭据正文、不导出 Cookie、不切运行中 CLI、不修改 .claude.json。只保留脱敏字段存在性、状态码类别、观测时间、路由模式、结果计数与资源 hash。通过本地实际资源运行统一查询，与用户在对应站点看到的同账号/组织/时间窗口做比较；核对单窗部分成功、真实权益有效期与返回未知的行为。网络路由有显式要求时分别确认，不能只看账号摘要判通过。

先验证一个账号的最短闭环，再扩展必要的异账号隔离样本。发现权限/字段不兼容即记录并修复对应解析，不关闭身份校验以完成验收。取消/清理只作用于本轮自建的合成资源；不清用户真实浏览器或保险库。

## 9. 最小交付、回滚和设计取舍

第一批最小交付建议为 Phase 0/1/2，再补齐 Phase 3/4 的集成门槛后进入真实只读试用；可把 CLI 引导和关闭浏览器时不强制启动的小功能独立交付。不要将全部产品愿望打成一次巨型改动。长期保存账号查询的最终可用性仍由 Phase 5 决定，不能用“旧数据显示正常”结项。

所有新增状态/元数据字段优先采用可忽略的附加字段，保持 SQLite user_version=3 和既有归档协议。回滚产品文件前保存本次候选、资源清单/哈希和原文件备份；只按实际授权替换精确产品文件，不停止 Claude、不退回保险库数据库、不删除新观测或浏览器资料。可先禁用新在线入口回到被动读取，但应明确这是降级恢复，不是满足全账号新鲜额度需求。

全项目复核中的三点边界已独立纠偏：

- 用量原生 candidates 先按可选 fallback_name 过滤；不能写成“只有一个账号就自动兜底”。后续必须由用户显式选择稳定 ID。
- 联动切号已有“关闭并重开关联浏览器”的确认文案，关闭状态仍被启动是可改进的使用行为；不能据此声称普通启动闸门失效。
- 清浏览器资料会 renew_session；CLI auth_status 来自 CLI 配置，历史额度来自账本。不能因此清 CLI 授权/历史额度，也不能用强清 recovery 或普通含主密钥压缩包作为容灾捷径。

**做了什么：** 综合 Q/P/X 证据、独立核对核心调用并复现一项归档完整性缺陷，给出分阶段文件、接口、依赖和验证计划。

**遗留什么：** 全部实现未执行；真实授权/字段/路由、长期连接能力、真实安装升级及第三方公开分发许可仍需分别验收。未逐行穷尽全仓，不作零缺陷保证。

**设计取舍：** 隔离优先；用户仍可能需要重新授权，但查询和恢复保持统一入口。暂不接管共享授权、不后台常驻、不自动启动全部资料；额外运行时、备份和系统恢复能力按收益与维护成本分期。

## 附录：认证结束帧最小内存复现

执行日期 2026-10-23。只读取公开源文件，AST 抽出 decrypt_baga；合成 AES-GCM key/nonce/frame，mock open 为 BytesIO；没有写文件、联网或读取用户资料。复现核心如下，可在仓库根用 Python 的 stdin 模式执行：

```python
import ast, io, os, struct
from pathlib import Path
from unittest.mock import patch
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

tree = ast.parse(Path("scripts/claude_quota.py").read_text(encoding="utf-8"))
fn = next(n for n in tree.body
          if isinstance(n, ast.FunctionDef) and n.name == "decrypt_baga")
ns = {"os": os, "struct": struct, "AESGCM": AESGCM}
exec(compile(ast.Module(body=[fn], type_ignores=[]), "<synthetic>", "exec"), ns)

master, key, nonce = bytes(range(32)), bytes(range(32, 64)), bytes(range(12))
header = b"BAGAID01" + nonce + AESGCM(master).encrypt(nonce, key, b"BAGAID01")
payload = b"synthetic-quota-projection"
length = struct.pack(">I", len(payload) + 16)
frame = length + AESGCM(key).encrypt(bytes(12), payload, length)
end_length = struct.pack(">I", 16)
end = end_length + AESGCM(key).encrypt(bytes(4) + struct.pack(">Q", 1), b"", end_length)

for label, raw in [("complete", header + frame + end),
                   ("missing_authenticated_end", header + frame)]:
    with patch("builtins.open", return_value=io.BytesIO(raw)):
        print(label, ns["decrypt_baga"]("synthetic", master, "synthetic.baga") == payload)
```

实际输出：`complete True`、`missing_authenticated_end True`。预期修复后：完整输入成功；缺少结束帧必须抛出受控完整性错误。源码还需对多余尾部和帧长度作一致校验。该结果证明读取器接受了截断形式，不证明真实凭据泄漏、账号串写或用户归档已经损坏。

