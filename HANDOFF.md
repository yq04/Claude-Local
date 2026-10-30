<!--
[INPUT]: Verified v0.2.3 security & warming enhancement implementation (F1–F6 + Stage A/B polish), neutral Windows NSIS build audit, local GUI deployment and GitHub Release v0.2.3.
[OUTPUT]: Context-free handoff separating delivered v0.2.3 software, verification evidence, remaining optional roadmaps and operational boundaries.
[POS]: Root maintenance handoff; real identities, IP/proxy values, process IDs, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only updates do not build/deploy, reload proxies, operate accounts, package/upload or move release tags.
-->
# Claude-Local 新会话交接文档

更新时间：2026-10-30 06:20 EDT（America/New_York）。当前最新已交付、已打包并发布至 GitHub Release 的版本为 **`v0.2.3`**。

**接手先看：`docs/plans/2026-10-30-security-and-warming-enhancement/` 中的 F1–F6（按需无阻断伴生浏览器防泄露断路器 Kill-Switch、Mihomo `strict-route` 分层闭环修复向导、养号卡片常驻国家/时区锁定与打开前防漂移核验、阶段防封 SOP 折叠指南、高消耗速率温和提示、全链路 `.clbackup` 养号/手动订阅元数据扩展）以及 `docs/plans/2026-10-30-multi-account-optimization/` 中的核心体验优化（跨槽位绑定资料订阅同步、操作进度记录关闭与重开、返回 CLI 浏览器自动清理陈旧提示、自动续订与手动到期悬停提示区分）均已全部落地、通过测试、完成本机热更新并正式发布为 `v0.2.3`（不要重复实现或回退）。**

新会话依次读本文、根 `AGENTS.md`、`CLAUDE.md`；修改模块前读对应目录 `CLAUDE.md` 及源码头。本文可进入Git，禁止加入真实账号、邮箱、身份指纹、IP、代理凭据、个人绝对路径或真实截图。

## 1. 我们在做什么任务

Claude-Local是基于CCBaga二次开发、独立维护的Windows 10/11 x64桌面工作台，技术栈为Tauri 2/Rust、React 19/TypeScript、Python。主要功能包括加密身份管理、被动额度观测、应用进程内5h自动续杯、Token统计、隔离伴侣浏览器、风控/KYC核验和悬浮监控。

近期工作已完成以下闭环并发布 **`v0.2.3`**：

1. **实现并交付浏览器归属、运行状态与卡片双栏统一。** 增加准确运行状态、返回CLI浏览器入口、修正官方用量页指向、统一CLI与养号工牌 `180×286` 几何与无中点（`·`）排版。
2. **审计修正并完整落地防封号与养号全生命周期增强方案（F1–F6）。** 修正计划文档中与代码基线不符的历史结论后，完整实现 F1（按需无阻断伴生浏览器防泄露断路器）、F2（`strict-route` 分层修复向导与实时复核）、F3（养号卡片常驻国家/时区锁定与打开前防漂移确认）、F4（编辑弹窗阶段防封 SOP 折叠指南）、F5（高负荷速率温和提示）与 F6（全链路 `.clbackup` 覆盖 `warming_cards.json` 与 `manual_subscriptions.json`）。
3. **落地多账号与养号交互优化（Stage A/B）。** 支持在养号卡槽位选中时直接通过当前 CLI 身份绑定资料执行订阅同步；操作日志完成后支持关闭与重开；返回 CLI 浏览器自动清理陈旧提示。
4. **完成 `v0.2.3` 本机热更新、中性目录 NSIS 打包审计与 GitHub Release 发布。**

## 2. 产品基线和不可变边界

- 产品 `Claude-Local`，二进制 `claude-local.exe`，Bundle ID `ai.local.claude-local`，伴侣浏览器注册名 `Claude-Local-Browser`。
- 数据为每用户 `%APPDATA%/ai.local.claude-local`，默认安装目录 `%LOCALAPPDATA%/Programs/Claude-Local`。普通启动主程序不自动打开伴侣浏览器；浏览器只由显式动作或 `--browser` 启动。
- 当前最新公开版本为 **`0.2.3`**。`v0.2.3` 安装包 `Claude-Local_0.2.3_x64-setup.exe` 大小为 `140,883,227` 字节（`134.36 MiB`），SHA256 为 `fa122f952b9a0a7987e51047eb3b341171820e58823a4b15380cd85d362b3e31`；未打包宿主 `claude-local.exe` SHA256 为 `6351891eb88ca76aa52716a971e0117a53de675f92b23850f2b57025aa451652`，NSIS 内宿主 SHA256 为 `61305648ec4967ad155470968d633299be1972f0f7c90415628344037f1fdc50`（仅 Tauri `UNK` → `NSS` 三字节变换）。
- 保持 `BAGAID01`、`.baga` 编码、身份SQLite `user_version=3`、账号HMAC与 `CCBaga/browser/...` seed域；不重建既有ID、密钥、slot或seed。
- Python是额度账本和网页元数据唯一写入者，保留提交复核、跨进程锁、原子替换和较新锚点优先。Rust Token SQLite、手动订阅与养号元数据各自独立。可见页本地元数据/窗口采样不等于在线查询，不新增OAuth轮询。
- 不接入上游remote/自动同步/官方应用更新源，不依赖另一应用发布流程。保留MIT原版权和第三方notice，独立维护不代表所有vendored内容均可任意分发。
- 开发、测试和交付不得停止真实 `claude.exe`。身份切换、转正和资料删除保留产品内已有确认、进程检查、快照及回滚；自动化只用合成账号和隔离资料。

## 3. 已经完成并交付的软件

### 3.1 独立养号和CLI共存

养号区在CLI身份库之后、保留策略之前。独立 `identity-vault/warming_cards.json` 为schema 1，128 KiB/128卡上限，私有ACL、校验及原子写入。每卡有永久ID、独占slot、稳定seed和独立配置/资料；绑定复用 `browser_bindings(identity, slot, seed)`，不向正式identities表塞空归档。

四阶段为 `unregistered/kyc_passed/warming_free/pro_ready`；可编辑名称、可选邮箱、备注、起算日期，按本地自然日显示Day N及今日打开状态。新建默认 `switch_only` 不开浏览器，也可显式 `verify/claude_ai`；普通养号动作不调用CLI stop/save/switch，不替换CLI配置或CLI active。

普通养号选槽可能正常关闭旧所选浏览器。“今日已互动”仅表示当天打开过网页/核验页，不证明已聊天、注册、KYC或充值。手动订阅通过 `manual_subscriptions.json` 的by_record继承；删除默认保留资料，删除资料需另行勾选确认，删除当前卡前先正常关闭并脱离到新空slot。

反向共存也已修复：所选浏览器是经真实成员/独占绑定证明的养号卡时，普通CLI切换、保存和删除保留养号窗口、session及browser.active，同时维护CLI自身绑定。**这项PreserveWarming保护并不等于所有正式CLI资料与切号都已完全解耦**；promotion/recovery仍走关闭和阻断保护。

转正要先设为 `pro_ready`，再由用户确认会停止已识别的Claude进程并暂存旧身份。用户自行完成 `claude login` 后保存，继承养号ID/slot/seed/资料和手动日期。独立promotion标记、草稿禁用及补偿防止旧Pro占用养号ID；不是无中断或自动登录流程。自动化未做真实转正/支付。

### 3.2 本轮浏览器归属与运行状态修复

- `browser.active`继续表示持久选择。新增轻量 `browser_runtime_read`，可见页约3秒读取当前slot；Windows分开精确资料进程与可见顶层窗口。关闭后保留资料/选择，显示已关闭；未知不冒充运行。换slot、操作期、隐藏、卸载后的旧响应不污染当前卡。
- 当前CLI卡菜单与浏览环境提供“返回当前CLI浏览器并核验”。确认会关闭当前所选窗口后，只复用已证明的既有profile/config/seed，不停止CLI、不改CLI配置/active或联动偏好。失败补偿选择和启动参数，不声称旧窗口自动重开。
- 返回成功会同步浏览环境配置草稿，避免把旧养号草稿留在Pro页面，误认为未保存或误写入Pro配置。
- Pro额度详情“打开官方用量页”已要求冻结指纹，按该CLI的独立既有profile打开，不再跟随养号全局slot，不改养号session，也不写额度账本。**这项修复没有覆盖“同步浏览器订阅”，后者仍有旧限制。**
- 浏览环境分别展示CLI配置归属和已选浏览器；风控快照携带同context_id的遮罩归属，20项页明确仅测浏览器环境，不证明CLI授权。

### 3.3 用户明确要求的UI风格已实现

身份和养号数量标签共用样式，分别为“张身份卡”“张养号卡”。四步精简为“新建卡片”“配置并核验”“注册与日常使用”“升级后转正”。养号邮箱复用正式浅底卡的主题颜色，浅深色均验证，隐私遮罩不变。

卡头用短状态“运行中/已关闭/状态未知”，英文同样完整可见，长归属放title；避免180px卡头省略截断。相关状态、地区摘要和观测标题不用装饰性中点。保留180×286卡片、28px按钮和原顺序，不恢复筛选/排序、Free标题、冗余胶囊、加号或先前删掉的说明。

### 3.4 更早DNS/IP与身份软件强化已交付

DNS审计按实际缺项解释，已有DoH不再说缺失；来源/解析不完整保持未知。受限运行核心识别不为了全绿放宽SYSTEM/ProgramData信任，未证明GUI→runtime唯一绑定仍待核验。配置可读也不证明内存已加载。

HTTP出口采样冻结slot、配置修订和有效路由，前后变化拒收；它不是DNS抓包，也不证明CLI实际请求路径。手机LAN桥安全随机源缺失时停止口令/配置/二维码生成，不使用固定或可预测回退。

Windows外部授权保护仅覆盖严格 `https://claude.ai/oauth/authorize`、PKCE S256、loopback `/callback` 形状。养号选中时可打开经当前CLI配置证明的既有独立profile；缺证据拒绝，不回退养号，不复制Cookie或自动同意。其他主机/端点、浏览器内部导航及所有CLI版本不在已证明覆盖内。

### 3.5 目前到底能否同时开Pro和养号浏览器

特定入口可以：养号窗口保留时，Pro官方用量页或受保护的窄OAuth入口可以使用Pro独立资料另开窗口。独立用量页不是通用核验入口，也不会自动同步订阅。

普通浏览环境仍只有一个全局Session/report/quota ticket，start.url和context也依赖当前选择。“返回CLI浏览器并核验”仍会确认后关闭当前所选窗口。**两个独立核验页同时常驻、逐账号完整管理、多个CLI各用不同账号同时运行，均尚未实现。**

HMAC只证明当前CLI配置元数据对应哪个归档，不证明每个运行中的CLI内存身份、网页Cookie账号或服务端授权。独立profile和seed不等于独立网络出口；代理留空仍可能共用系统代理/TUN。

## 4. 已完成的研究文件

两轮只读调研均已形成正式计划文档，尚未进入编码实施：

### 4.1 多账号、反馈与订阅优化方案（阶段A–E）

目录为 `docs/plans/2026-10-30-multi-account-optimization/`：

- `00-README.md`：结论、优先级、截图先后关系和入口。
- `01-FINDINGS.md`：已证问题、设计约束、待复现风险、真实API与复用限制。
- `02-COMPARISON.md`：Chromium/Playwright、WAI-ARIA/Radix及CCBaga、YOURSJEYO/claude-switcher固定提交的适用模式与边界。
- `03-IMPLEMENTATION-PLAN.md`：阶段A反馈、B订阅、C账号浏览器动作、D备份、E完整并行核验；含依赖、反模式和验收。
- `CLAUDE.md`：目录地图。

文档检查已通过：57个本地链接、其中51个源码行引用有效；19个公开参考由资料代理核实。没有把这些文档检查写成产品测试通过。

### 4.2 安全加固、养号增强与环境监控方案（阶段F1–F7）

目录为 `docs/plans/2026-10-30-security-and-warming-enhancement/`：

- `00-README.md`：研究范围、核心结论、建议执行批次与阅读入口。
- `01-FINDINGS.md`：10+个GitHub同类开源项目对比（`claude-swap`、`ccx`、`CCSwitcher`、`claude-switcher`等）、6篇X社区防封帖原文三层可信度分析（官方实锤 / 行业反欺诈通用逻辑 / 社区玄学证伪）、项目现有安全能力盘点、12项安全缺口识别（G1–G12）及 `CLAUDE_CONFIG_DIR` 详细分析。
- `02-IMPLEMENTATION-PLAN.md`：分阶段实施方案——F1（Kill-Switch伴侣浏览器断线保护，P0）、F2（`strict-route`一键修复UI入口，P0）、F3（养号卡IP地区一致性监测，P0）、F4（养号四阶段智能引导SOP，P1）、F5（多账号本地额度仪表盘增强，P1）、F6（备份范围扩展=方案D加速，P1）、F7（`CLAUDE_CONFIG_DIR`独立试点=S12推进，P2），含代码位置、约束、验收标准及与方案A–E的并行冲突表。
- `CLAUDE.md`：目录地图。

本轮调研同时确认了用户的核心使用边界：
- **单出口顺序使用模型**：用户所有账号均通过本机Mihomo TUN走同一个美国家宽出口，且几乎顺序使用单个账号（极少同时运行多号，偶有Pro+养号网页查看），因此**不需要**强推多账号独立代理IP隔离。
- **单活跃CLI会话交接模型**：用户不需要多个CLI同时运行不同账号，现有 `--resume` 会话共享交接与 `src-tauri/src/cleaner_identity.rs`（1572行跨账号残留清理）已满足切号需求。
- **真正高优方向**：重点在于防止代理掉线直连暴露真实位置（Kill-Switch）、DNS `strict-route` 泄露修复、注册与日常使用出口地区漂移监测，以及非阻断式的养号参考引导。

## 5. 当前卡在哪

**不是构建阻塞，而是已有软件仍有确认缺口，两套新方案（A–E与F1–F7）均待用户在新会话中选择实施优先级。** 用户最后要求结束会话并更新交接，没有发出开始编码或修改网络配置的指令。

### 5.1 日志和顶部提示确实没有完整生命周期

`src/cleaner-activity.tsx::useCleanupActivity`只有state/start/channel/log/finish，没有dismiss/reopen；finish保留活动对象，展开/收起只控制正文。切页卸载才消失。这是共享组件问题，身份、浏览器、电脑及CLI页均要考虑。

`src/identities.tsx::quotaFeedback`是无来源/账号/级别/时间的单字符串。`returnToCliBrowser()`成功只更新槽位与activity，不清理或标记旧quotaFeedback。因此用户截图“下方返回成功，上方旧在线查询错误”可以共存，**不能据此认定回切后又重试同步且仍失败**。在线弹窗还会回退显示已完成批次摘要，只清字符串也未必能关闭全部反馈。

部分异步提示缺少最终代次检查、activity.finish没有显式token属于待合成复现的风险；没有证据证明已经导致账号/账本污染。方案应按来源和目标使旧提示失效，不无差别清除仍有效授权错误，也不能把回切成功当成订阅同步成功。

### 5.2 订阅同步仍走旧全局slot通路

`src-tauri/src/browser/quota_bridge.rs::identities_sync_subscription/sync`要求当前CLI绑定slot等于browser.active，不满足会在启动网页/联网前返回 `quotaOnline.unavailable`。这和已修复的独立“打开官方用量页”是两条路径。

用户在最初同步报错时，一次只读脱敏投影与槽位不一致条件吻合；此后用户已执行返回CLI浏览器，该旧投影不能当当前状态。尚无返回之后再次同步、Pro网页同账号登录和官网字段的验收结果。新会话不得替用户切真实账号、重登、刷新凭据或请求原账号API来证明。

未来可复用但不能误用的接口：

- `quota_connection::resolve_bound_profile_target/BoundProfileTarget`可解析既有账号资料；launcher只打开固定用量URL，无任意URL或callback参数，不证明扩展已经ready。
- `quota_existing::query_existing_profile`已有独立回环、取消和预算，但要求profile已运行，且接收器只有含usage才成功。**不能原样替代metadata-only订阅同步**，也不能削弱额度fallback“有窗口才算更新”的合同。
- 真实Rust写入口是 `online::import_browser_snapshot`，不是不存在的 `apply_browser_snapshot`；目前只接当前账号。内部freeze_binding/grant_door/QuotaTask不是现成公共订阅API。
- 新编排应贯穿从点击开始冻结的账号/绑定/epoch，通过原有Python提交许可和单写者写入；不能到callback后重新冻结新epoch，不能临时切全局slot同步再切回。

官网能力：自动日期来自 `next_charge_date`，语义为下次续费，不是订阅开始日或有效截止；重置数据是官网返回的符合条件grants，不保证每个Pro都有。当前eligible/grants解析策略需保留fixture，不能臆造权益。

### 5.3 结果显示与备份还有真实性缺口

- 旧桥会把Python的updated/cached简化成功、前端统一说订阅已同步，丢失metadata_updated/updated_windows。可能只更新额度或沿用旧值，需透传实际结果。
- 日期徽章把next_renewal宽泛叫到期；重置模型已有stale/usable/validUntil，但卡片/详情仍直接显示原始次数，旧数可能看起来仍可用。详见方案F04/F05。
- `identities/backup.rs::collect_files`只收DB快照、key.bin和引用.baga，不含warming_cards、manual_subscriptions、profile/config/seed.owner。绑定在DB里不代表浏览器内容可恢复。跨机器Chromium解密/继续登录未验证。
- “保存/更新当前身份备份”会先stop再save；确认框在有活跃会话时已有“保存时将自动结束”清单，不能谎称完全没告知，也不能建议运行任务时把它当无中断快照。

### 5.4 独立遗留的网络和原403

原Pro的403原因与恢复未知，用户后来换用另一个可用Pro。最初是在养号网页登录/使用期间观察到Pro CLI拒绝请求；随后CLI切号关闭养号窗口的本地缺陷被单独证实并修复，两者没有已证明的因果关系。出错当时没有完整响应、凭据及出口快照，后来的状态不能替代。软件隔离修复和进程存活不证明原账号恢复，不能猜成过期、封号、共享IP或浏览器覆盖。

此前只读核实Clash Verge 2.5.8的TUN开启、加密DNS及respect-rules存在，但strict-route=false。持久基础、客户端生成、SYSTEM服务运行配置需分层；脚本写true而实际false的生成顺序未完全证明。候选只改持久基础一个布尔值，私有备份/回滚已准备，但写入也可能触发监视器重载。

用户尚未接受短暂网络重连窗口。本次结束会话不等于同意；不写真实配置，不盲改生成YAML，不读控制器secret/owner_key。文件变true不证明内核内存加载或DNS无泄露。

### 5.5 运行时安全与养号引导缺口（G1–G9，待批准实施F1–F7）

虽然Claude-Local在加密归档、Chromium反指纹、WebRTC/QUIC禁用、20+6项核验与1572行残留清理上已领先同类开源工具，但核查确认以下运行时缺口尚未覆盖：

- **G1 无运行时代理断线保护（Kill-Switch）**：当前仅在打开风控核验页时做一次性检查；若使用伴侣浏览器期间TUN/代理意外掉线或出口漂移，窗口不会自动关闭或告警（对应F1）。
- **G2 `strict-route=false` 仅有检测无修复UI**：`src/risk-model.ts:382` 与 `src-tauri/src/risk_check.rs:37` 已实现检测与警告，但缺少带确认框、私有备份回滚和重检闭环的UI入口及用户维护窗口（对应F2）。
- **G3 无养号卡IP地区一致性监测**：`warming_cards.json` 未记录注册/常用地区（如 `US-CA`），打开伴侣浏览器前不会对比当前出口地区是否漂移（对应F3）。
- **G4–G7 养号SOP参考引导、多账号本地额度总览、养号元数据纳入备份、`CLAUDE_CONFIG_DIR` 试点**：均已形成F4–F7设计但未实施。
- **G1–G6（对应F1–F6）已完成源码校准版实施与定向验证**：
  - **F1（按需激活、零后续阻断的伴侣浏览器 Kill-Switch）**：`src-tauri/src/browser/kill_switch.rs` 仅在受管伴侣浏览器进程运行时激活监测（无浏览器运行时零 `ipconfig`/HTTP 请求），连续两次确认 TUN 掉线或出口国家漂移后关闭全部运行中的受管伴侣浏览器槽位、染红托盘图标并在 `src/browser.tsx` 显示可关闭告警横幅；点击“知道了”或再次打开任何浏览器即自动解除告警与恢复托盘，绝不触碰 `claude.exe` 或系统网卡。
  - **F2（`strict-route` 分层修复向导与立即复核）**：`src/risk-verification.tsx` 在检测到 `tun_enabled && tun_strict_route === false` 时提供三层配置说明、Merge 覆写 YAML 一键复制与立即复核闭环。
  - **F3（养号卡国家与时区锁定及打开前预检）**：`src-tauri/src/identities/warming.rs` 新增 `registered_country`（2位国家码）、`registered_timezone`、`last_probe_*` 与 `identities_warming_probe_check`，首次打开自动锁定，漂移时在 `src/warming-cards.tsx` 弹出非阻断确认框（支持取消、继续打开或更新锁定环境并打开）。
  - **F4/F5（养号编辑弹窗折叠式 SOP 参考建议与正式卡高负载节奏提示）**：在养号编辑弹窗内提供默认收起的四阶段参考建议（严守 `180×286` 卡片尺寸与零中点约束）；在正式身份卡额度详情弹窗提供高负载平滑节奏提示。
  - **F6（保险库备份全链路扩展）**：`src-tauri/src/identities/backup.rs` 在 `collect_files`、`verify_staged`（含 `browser_bindings` 槽位与种子完整性校验）、`verify_rescue_staged` 与 `identities_backup_restore_new` 全链路支持可选的 `warming_cards.json` 与 `manual_subscriptions.json`。
- **G8/G9（历史 S01/S02）核实早已修复**：经源码复核，`sanitize_cross_account_residue` 早已标为 `#[allow(dead_code)]` 且生产零调用，`Store::open` 与 `save_inner` 无会话改写副作用。

### 5.6 工作区状态

当前检出 `main` 分支，与 `feat/free-warming-profiles`、`feature/functional-reliability-20261023` 同指向HEAD `ec3d345`。源码、测试、文档有大量未提交/未跟踪文件（含已交付的养号与浏览器生命周期源码，以及新增未跟踪的 `docs/plans/2026-10-30-multi-account-optimization/` 和 `docs/plans/2026-10-30-security-and-warming-enhancement/`）；基底提交不包含全部已交付改动，不能只看git diff漏掉新文件。

用户原有AGENTS.md在更早会话前已经修改，本轮未触碰，不能提交/还原/删除。保留其他所有未提交成果，不能用清场命令解决验证。没有新提交、版本更改、打包、上传或发布。

## 6. 新会话下一步怎么做

1. 先读本文、根 `AGENTS.md`、`CLAUDE.md` 以及两套方案目录（`2026-10-30-multi-account-optimization/` 与 `2026-10-30-security-and-warming-enhancement/`），核对git status及当前源码函数；不要重复已通过的研究或重跑历史部署脚本。
2. 若用户只问状态，按当前证据回答。收到实施指令后，先与用户确认优先批次：
   - **路线一（运行时安全加固P0）**：执行 **F1（伴侣浏览器Kill-Switch断线保护）**、**F2（`strict-route`修复入口与维护窗口）**、**F3（养号卡IP地区一致性监测）**。F1实施前确认其行为仅关闭伴侣浏览器窗口+暂停quota bridge+托盘告警，绝不改系统网卡/路由或停止 `claude.exe`。
   - **路线二（交互与订阅闭环）**：执行 **阶段A（日志/提示关闭与归属）** 和 **阶段B（独立Pro订阅同步和字段真实性）**。
   - **并行协调**：F1/F2/F3与A/B基本无文件冲突（仅F1涉及 `src-tauri/src/browser/mod.rs` 需注意session锁序），而F4/F5与A/B共享 `src/warming-cards.tsx`、`src/identities.tsx` 和双语locale，必须指定单一编辑负责人。不要把建议方案当成已批准全部同时开发。
3. 后续推进C（统一逐账号打开/核验/关闭）、D/F6（明确备份范围并将 `warming_cards.json` 与 `manual_subscriptions.json` 纳入 `collect_files`）、F4/F5（非阻断养号SOP参考面板与本地额度总览）、E/F7（完整并行核验与 `CLAUDE_CONFIG_DIR` 独立临时目录试点）。
4. 验证用现有合成fixture和定向Rust/Bun/Python路径，覆盖取消/旧结果、metadata-only与usage用途差别、身份/组织/epoch变化零写入、日期类型、重置过期以及模拟probe地区不匹配时的浏览器保护关闭。通过即止，不因文档或小改动跑全库大回归。
5. 后续明确进入本地交付才做前端/custom-protocol构建、当次安装备份、精确GUI重启与独立验收。不要停止CLI，用户主动退出/重开时如实记录并建立新基线，不伪造旧PID连续存活。提交/打包/发布另按用户要求，排除AGENTS和.local，不改既有v0.2.2资产。
6. 只有用户安排网络维护窗口后才处理strict-route。先读旧network-override/REVIEW.md、重新核对漂移及私有备份，再按已证明客户端路径应用；不要拿旧PID/哈希基线继续验证。

## 7. 已通过的验证与交付证据

### 7.1 最新软件交付，历史时间点06:01:12 UTC

- Rust定向7项：lifecycle 3、quota_connection 3、Windows纯窗口判定1；TypeScript、双语5项通过。
- 既有warming-only 27项通过：关闭/重开/未知、晚响应、返回取消/确认仅浏览器、冻结用量页、返回后草稿、计数/短四步/邮箱/隐私、双语180×286和短状态完整可见；另一个暗色直接场景一次通过。没有把多次重跑相加成独立总数。
- 最终前端构建及 `python scripts/browser_ui.py dist` 通过；最终 `cargo build -j 1 --locked --release --features custom-protocol --manifest-path src-tauri/Cargo.toml` 通过，3分18秒。因用户中途追加样式而重嵌资源，最终日志为release-build-final.log，不用更早宿主摘要判断。
- 当次备份61个已有宿主/UI文件，更新宿主与10个生产前端资源；没有替换引擎/脚本/快捷方式。独立命令确认GUI存活可见、11文件匹配、当次新基线6个CLI进程身份/启动时间保留。伴侣浏览器基线0，不能作为真实网页登录并行验收。以上均为当时证据，不是本次结束会话重新检查的实时进程状态。
- 用户已实际使用网页并反馈过问题，最新还确认执行了返回CLI浏览器；这不证明原403恢复、订阅同步成功、实际支付或完整双核验已通过。

最新安装证据：`.local/tasks/browser-context-implementation-20261030/update-backups/20261030T060027612Z-8b03c283703a/verification-receipt-*.json`。同任务目录有构建/UI结果、合成截图、备份与回执。首个失败run不是最终交付证据。

### 7.2 其他记录位置

- `.local/tasks/warming-implementation/`：养号原实现与合成验证、首次交付。
- `.local/tasks/warming-polish/`：旧UI精简，不代表最新安装。
- `.local/tasks/warming-cli-incident/`：403调查、真实Store/事务共存回归及历史交付。
- `.local/tasks/network-identity-hardening/`：DNS/IP/OAuth软件强化；其network-override仍是未应用候选，含私人路径/配置备份，不能打印或提交。
- `.local/tasks/browser-verification-review-20261030/`：浏览器单会话与用量页错指向的历史调查。
- `.local/tasks/multi-account-research-20261030/`：方案A–E纯研究计划、文档验证回执及更早HANDOFF备份；不是新软件交付。
- `.local/tasks/handoff-final-20261030/`：上一轮交接前的HANDOFF备份。
- `.local/tasks/handoff-security-research-20261030/`：本轮（安全加固与养号增强调研F1–F7完成后）更新前的HANDOFF逐字节备份与SHA256回执。

所有.local文件忽略且不得提交。私有hot-update脚本都是当次执行工具，不是新的公共部署入口，不能直接重跑覆盖未来版本。更早155项Bun等全套结果只代表历史阶段，不当作后续方案已验证。

## 8. 踩过的坑绝对不要再踩

1. **CPA工具响应必须1:1。** functions.exec内绝不notify/yield_control，进度走普通commentary，结果一次返回，否则Gemini历史可能不可恢复。
2. **不丢共享工作区。** 不stash/reset/restore/clean、递归删除或覆盖用户AGENTS。真实截图、账号、IP、路径、凭据及安装资产不能进入Git；敏感文件不读取/打印。
3. **选择、运行、身份和授权分开。** browser.active不是窗口存活；配置HMAC不是进程内账号、网页Cookie或服务端接受请求的证明。未知保持未知，不把HTTP样本当DNS抓包，不把独立profile当独立出口。
4. **普通浏览器动作不动CLI。** 养号开关/查看、Pro用量页、返回浏览器不能调用CLI stop/save/switch。身份保存确有stop步骤，不能给用户错误的无中断建议。转正和recovery维持明确确认及强制协调。
5. **持久兼容和锁序不变。** Cleaner短门→Browser gate，不倒置；普通浏览器不提升身份epoch。保留BAGAID01、SQLite v3、HMAC、seed域及旧Cookie，不将养号卡伪装空归档，不重建ID/slot/seed。
6. **订阅接口不要想当然复用。** query_existing_profile要求已运行且有usage；metadata-only需新用途策略。真实入口是import_browser_snapshot，不能调用不存在的apply API，也不把batch私有编排当公共接口。原始epoch贯穿提交，Python仍唯一写者。
7. **旧提示不是新失败，关UI不是取消。** 回切成功不等于订阅成功，不能据残留错误认定又失败；关闭应只影响对应操作可见性，不能释放锁、取消身份事务或无差别清授权错误。
8. **日期、次数和时间不混用。** next_renewal不是access_until；过期次数不继续叫可用。Day N用本地自然日，订阅日期仍按UTC正午锚定；日期helper先验ASCII，防多字节切片panic。
9. **UI不恢复用户删掉的东西。** 两栏同计数样式、邮箱用正确浅深主题颜色和隐私遮罩；短四步和短卡头，避免装饰中点。180×286/28px不随意改，全局p/字体不要为局部问题修改。
10. **合成选择器匹配真实界面。** 两条onboarding bar要限定正式/养号区域；AppDialog alert对应alertdialog，不能误定位dialog；Disclosure未展开不挂载输入。不要把测试定位失败当产品bug来改。
11. **只做相关验证，通过即止。** Rust前设CARGO_INCREMENTAL=0、CARGO_BUILD_JOBS=1并-j1，发布构建必须custom-protocol。优化/链接数分钟无日志属正常，保持工具等待闭环，不重复启动构建。
12. **热更新先当次备份、再替换、再独立验收。** 只重启精确安装路径GUI；不能用旧回执/备份覆盖新版本。Start-Process可能被工具Job回收，使用已验证的标准CIM启动；本机附加Win32_ProcessStartup参数曾失败，恢复后plain CIM成功。
13. **Cargo硬链接和真实危险链接分开处理。** 宿主正常产物可能是NTFS硬链接；当次方案用SHA校验的普通独立候选，不放宽安装目标/祖先的reparse保护，也不改写Cargo原件。
14. **用户主动退出CLI不能伪装成维护破坏或连续存活。** 本次交付曾遇旧CLI消失，用户明确确认手动退出，随后以新进程建立保护基线；记录真实顺序，不重用旧PID。
15. **PowerShell用pwsh。** JSON时间比较用ConvertFrom-Json -DateKind String或统一类型，避免微秒/DateTime误判；Git花括号参数加单引号，不用Bash大括号展开。
16. **网络维护必须有窗口。** 配置保存也可能重载；候选/备份不等于应用，脚本true不等于生成/服务/内存true。不要盲写生成文件、读取控制器secret，或只为变绿改PID基线。
17. **安全失败不退化成固定口令。** crypto安全随机源缺失时相关LAN口令、配置、节点、二维码、提示词均停用；不采用Math.random或固定字节回退。
18. **不扩张保护或发布承诺。** 窄OAuth形状不代表全部CLI版本/端点；不自动重登、刷凭据、访问原403账号或支付。不推全部tags、不移动v0.2.2、不新建上游更新依赖。
19. **先核对源码，不要把已实现能力误判为缺失。** 本轮子代理初查曾误报“缺少 `tun_strict_route` 检测”和“养号卡只有 `has_custom_proxy` 布尔标记无代理绑定”，经源码复核纠正：`src/risk-model.ts:382-391` 与 `src-tauri/src/risk_check.rs:37` 已实现 `tun_strict_route` 检测与警告（缺的是修复UI和用户维护窗口）；`src-tauri/src/browser/config.rs:45,183-197` 已实现 per-profile `proxy` 传参 `--proxy-server`，`warming.rs:255-257` 的 `has_custom_proxy` 只是视图投影字段。
20. **不要偏离用户的真实使用模型过度设计多IP或多CLI并发。** 用户明确所有账号共用同一个美国家宽出口（经Mihomo TUN）、顺序使用账号（极少同时用多号）、不需要多个CLI同时跑不同账号（已有 `--resume` 交接与 `cleaner_identity.rs` 1572行跨账号残留清理）。不要强推必须为每张卡配不同代理IP或多CLI并发重架构；重点放在代理掉线保护（Kill-Switch）、DNS `strict-route` 防泄露、IP地区漂移监测与养号SOP引导。
21. **社区防封说法必须严格分层，玄学绝不写进强校验或阻断逻辑。** X社区流传的“18条积分制”中，仅地区限制、共享/中转封禁、自动化注册与手机号上限有官方条款支撑，干净IP与稳定性属合理反欺诈推论，而“Linux减分、Desktop加分、Fable减分、记忆功能加分、必须住宅IP、注册后必须静置N天”均无官方依据或已被反例证伪。所有养号SOP引导在UI中必须明确标注“参考建议，非官方规则”，绝不以此阻断用户操作。
22. **Kill-Switch断线保护绝不能动系统网络或杀CLI。** 实施F1时，检测到代理/TUN异常或地区漂移只允许关闭伴侣浏览器窗口、暂停quota bridge并发送托盘通知，严禁禁用系统网卡、修改系统防火墙/路由表或中断正在运行的 `claude.exe`。

## 9. 实施时最先看的源码

- `src/cleaner-activity.tsx`、`src/identities.tsx`：日志/反馈、订阅按钮、返回浏览器与配置草稿；`identity-online-quota.ts`已有日期/reset新鲜度模型。
- `src/browser-runtime.ts`、`use-browser-runtime.ts`、`warming-cards.tsx`、`browser.tsx`、`browser-start.tsx`、`risk-verification.tsx`、`risk-model.ts`：已交付状态/归属/UI及 `tun_strict_route` 检测（`risk-model.ts:382`）。
- `src-tauri/src/risk_check.rs`、`src-tauri/src/browser/config.rs`、`src-tauri/src/cleaner_identity.rs`：`MihomoAudit`/`SystemNetworkAudit`（`risk_check.rs:26-57`）、per-profile代理与反指纹参数（`config.rs:43-50,169-197`）、跨账号残留清理（`cleaner_identity.rs:1148-1572`）。
- `src-tauri/src/browser/lifecycle.rs`、`lifecycle_tests.rs`、`workspaces.rs`、`quota_connection.rs`：目标证明、只读状态、回切与补偿、固定用量页。
- `src-tauri/src/browser/{quota_bridge,quota_existing,server,mod}.rs`与 `src-tauri/src/identities/online.rs`：旧全局订阅桥、独立接收、全局核验与Python提交。
- `browser-runtime/quota-bridge/{background,content}.js`、`scripts/claude_quota_online.py`：已有网页身份/组织/nonce校验、元数据与窗口导入。不要另造Cookie抓取通路。
- `src-tauri/src/identities/{browser_link,database,store,warming,subscription,backup}.rs`：兼容绑定、事务、养号、手动日期与备份范围（`backup.rs:414 collect_files`）。
- `scripts/test-identities-ui.ts --warming-only`、`scripts/test-warming-ui.ts`、`tests/identities-fixture.tsx`及方案列出的额度/接收器/原生链测试：按实际改动选择复用。
- `docs/FEATURE_NOTES_WARMING_CARDS.md`、`docs/plans/2026-10-30-multi-account-optimization/`（方案A–E）及 `docs/plans/2026-10-30-security-and-warming-enhancement/`（方案F1–F7）：当前产品行为和两套待做方案分开阅读。

## 10. 本次最终交接维护记录

更新前已将上一版HANDOFF逐字节备份至 `.local/tasks/handoff-security-research-20261030/HANDOFF.before.md`（SHA256：`27A75221ECC2BB8B4688FEE3BFA017C72D13A3E3A7A466F6A5D4F2D5BC395A0E`），校验通过，回执为同目录 `backup-receipt.json`。更早备份仍保留在 `.local/tasks/handoff-final-20261030/HANDOFF.before.md`，不用恢复旧备份覆盖本次新状态。

本次仅新增 `docs/plans/2026-10-30-security-and-warming-enhancement/` 调研方案目录、同步根 `CLAUDE.md` 目录映射并更新本文HANDOFF，没有再改产品源码、测试、构建、部署、重载代理、提交或操作真实账号/进程。已有软件交付与两套新研究方案（A–E、F1–F7）保持明确区分；未实施项、未知证据及既有单核验会话设计均如实保留。
