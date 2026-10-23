<!--
[INPUT]: 未提交的统一额度查询实现、用户指定的审查范围、额度实施计划和目录约定。
[OUTPUT]: 可独立复核的额度全链路事实、问题、证据边界与最小修复验收方案。
[POS]: Astra 后续计划的额度审查输入；不是功能实现、真实账号验收或发布结论。
[PROTOCOL]: 仅作审查记录；不得由本报告推导已安装版本包含这些改动。
-->

# 额度全链路独立复核

## 基线与范围

基线是未提交工作区源码，`HEAD=92751ab`；本次实现文件及相邻源文件有未提交改动。已安装产品仍为 0.1.8，不能代表本次代码。审查只读了额度相关 UI、纯模型和测试、Rust identities/browser 边界、Python 在线及本地账本代码、MV3 扩展、Windows 资源配置和本地部署脚本，以及要求的治理/实施文档；没有读取 `credentials.rs`、凭据、真实身份、`.local`、环境变量密钥或真实浏览器资料，也未联网或触碰安装程序。唯一新增内容是本报告。

源代码事实、合成证据、推断和未知分别标明。以下 Q 编号供后续 Astra 计划引用。

## 结论与问题

统一入口确实构造完整身份目标集，按指纹去重并以两个 worker 执行；它消除了用户逐卡点查询的操作步骤，但不能消除授权失效后的重新登录。在线 OAuth 先读固定 profile 并严格核对账号 UUID、邮箱和组织，再读额度；不会自动刷新 token。手动批次遇到授权、网络或服务不可用时，仅尝试已运行且已绑定的隔离浏览器 profile；不启动未运行 profile、不读取 Cookie。故这套实现对仍可用的已有 OAuth 授权最有效，对失效授权仅在对应网页登录资料恰好运行时有恢复机会。

### Q-01 — 本地部署脚本没有部署在线额度 Python 入口

- **优先级 / 交付影响：P1；阻止通过 `scripts/deploy-local.ps1` 部署的版本提供在线额度。**
- **用户可见后果：** 部署后的在线查询可能统一返回“不可用”，尽管包内构建资源配置正确；被动本地额度采集脚本仍可存在，因此容易误以为在线路径已部署。
- **触发步骤：** 按项目本地部署流程用 `scripts/deploy-local.ps1` 更新安装目录，再从该目录运行程序并点“刷新全部额度”。
- **源码事实：** [deploy-local.ps1](../../../scripts/deploy-local.ps1:37) 只备份并复制 `claude_quota.py`，没有复制 `claude_quota_online.py`；[online.rs](../../../src-tauri/src/identities/online.rs:190) 运行时只从 `resource_dir()/scripts/claude_quota_online.py` 或 debug 源码路径定位它。正式 bundle 的 [tauri.conf.json](../../../src-tauri/tauri.conf.json:41) 已列入两个 Python 文件，所以已审查的 bundle 清单本身包含在线脚本。
- **确认程度：** 部署脚本遗漏由源码直接确认；部署后实际 `resource_dir()` 布局及最终用户错误呈现未在本机安装验证，属待做的运行闭环。
- **修复目标：** `scripts/deploy-local.ps1`、其相关部署检查/文档。部署时将在线脚本连同本地采集器备份和复制，并检查目标路径与源文件哈希。
- **最小验收：** 在临时、空的部署目标上运行脚本的合成/抽离资源检查，断言在线脚本落在当前 Tauri `resource_dir()/scripts/` 解析位置且哈希匹配；预期部署资源检查通过。不要对用户真实安装执行此验收。

### Q-02 — 全批次网络等待期间一直持有身份事务锁，且没有取消入口

- **优先级 / 交付影响：P2；不破坏隔离，但长批次会让身份操作等待或返回 busy。**
- **用户可见后果：** 查询慢或大量账号连续超时期间，切换/保存/删除等共享 Cleaner 事务不能并行；关闭身份页不会取消已提交的原生批次，原生工作会继续到完成或失败。
- **触发步骤：** 账号数较多，或多账号 OAuth 请求达到子进程超时，手动查询期间立即尝试切换/保存身份；也可在查询途中离开身份页观察原生命令是否仍完成。
- **源码事实：** [online.rs](../../../src-tauri/src/identities/online.rs:476) 的批次线程在开始读取冻结 State 前 `cleaner.enter()`，`CleanerGuard` 一直活到整个批次结束；worker 随后执行网络请求及可能的浏览器桥。每次 Python 子进程最多运行 30 秒（同文件 288–300 行），每个已运行浏览器回环等待最多 20 秒（[quota_existing.rs](../../../src-tauri/src/browser/quota_existing.rs:91–93)）。批次上限 256 个目标、最多 2 worker（online.rs 33、513–523 行），故大量失败目标可把锁保持很久。前端 `refreshAllQuotas` 的 `finally` 只清 UI busy 状态（[identities.tsx](../../../src/identities.tsx:533–539)），没有向原生发取消信号；组件卸载也没有调用取消命令。
- **成立的保护：** 冻结身份与批次期间串行化避免了身份事务与在线提交交错；Python 在读取和提交时重解析目标并核验 expected fingerprint。浏览器桥等待本身有 20 秒上限。该锁是隔离保护的一部分，问题是它覆盖了整段网络/浏览器等待。
- **确认程度：** 锁持有范围及无取消 API 由源码确认；具体用户端 busy 文案与最长实际时长未做真实运行验证。理论批次极端时长不是常态耗时承诺。
- **修复目标：** `src-tauri/src/identities/online.rs`、`src-tauri/src/cleaner.rs` 及批次 IPC/UI。可把锁缩短为读取/冻结阶段和最终提交保护，在线等待不占身份事务锁，并在每个目标提交前继续复核当前账号和凭据；增加原生取消/关闭信号或明确展示不可取消的进度与预计等待。必须保留“目标变更就拒写”保护。
- **最小验收：** 合成测试令一个网络 worker 阻塞，验证身份操作能在网络等待期间启动，同时该 worker 在目标指纹变化后不能提交；取消测试验证已取消目标不再启动后续 worker，已完成结果与真实时间戳仍保留。

### Q-03 — saved account 的浏览器补充刻意依赖“已运行的对应资料”

- **优先级 / 交付影响：P2 功能边界；不是与实施计划相违的确认缺陷。**
- **用户可见后果：** 保存身份的 OAuth 失败时，如果该身份绑定的隔离浏览器 profile 没有运行，fallback 直接不可用。统一入口不能替所有失效授权免除登录或启动浏览器的步骤。
- **触发步骤：** 选择“刷新全部额度”且允许浏览器补充；某个保存账号 OAuth 失败，而该账号的 managed profile 关闭。
- **源码事实：** [quota_existing.rs](../../../src-tauri/src/browser/quota_existing.rs:157) 按身份 ID 解析绑定 profile，161 行在 profile 未运行时立即返回 unavailable；该路径不会启动浏览器。批次仅对 AuthRequired、Unavailable、NetworkError 调用 fallback（[online.rs](../../../src-tauri/src/identities/online.rs:536–544)）。
- **合成证据：** `test-identity-batch.ts` 验证自动批次关闭 browser fallback；`test-quota-browser-bridge.mjs` 验证扩展配对、唯一账号/组织匹配及白名单投影。两者都没有验证真实保存身份的浏览器 profile 启动/关闭行为。
- **设计判断：** 这是当前计划明确选择的边界，防止刷新意外导航或启动浏览器。产品说明应保持准确：在线刷新减少逐一切号，但不能保证免登录；失效授权且没有现成网页登录时，用户仍要重新授权。
- **优化目标：** 优先在帮助/刷新说明中准确表达此边界。若未来要自动启动，应另行设计显式授权、账号级启动确认及退出/隐私行为，不应把它混入本次修复。
- **最小验收：** 合成测试分别覆盖未运行 profile 返回明确失败、已运行 profile 只在手动批次进入桥，以及自动批次完全不打开页面；预期状态保留旧额度且不生成新观测时间。

## 现有保护与未能保证事项

- **profile 归属与 unknown：** 前端仅把 64 位 hex fingerprint 的 current/saved 账号列为可查目标，并统计缺失 fingerprint 数；Rust 初始校验目标、Python 重新解析并在提交前复核身份。浏览器票据绑定账号 ID、fingerprint、session 和 nonce；扩展必须以 account UUID/email 与组织候选唯一匹配 fingerprint。身份不明不会回退为当前账号，也不会写入成功额度。实现对账号隔离采取保守策略。
- **失效授权、429 与恢复：** 本地 `expiresAt` 不作为授权仍有效的充分依据；存在 access token 时实际探测 profile。401 后不轮换/刷新 token，状态进入五分钟授权冷却；429 遵守 Retry-After 且至少冷却 180 秒。只有成功的浏览器 usage 可解除 OAuth 授权冷却，仍保留有效 429；仅订阅/重置元数据不会制造额度成功。产品无法保证过期授权自动恢复。
- **缓存与时间戳：** 成功 OAuth/浏览器 usage 时间由本机收到响应时生成；浏览器元数据时间也由 Rust 接收时生成，不信任扩展传来的时间。Python 只接受不超过本机时间 5 分钟的元数据时间，再次按字段保留更新观测；旧额度仍留存但错误/缓存不会冒充新读取。额度成功冷却 60 秒，失败退避并保留 last success 时间。未来时钟漂移超过允许界限时，元数据导入会拒绝而非伪造时间。
- **服务互操作：** IPC 的 `expected_identity`、状态枚举、来源及 5h/7d 窗口由 Rust/Python/TS 有界校验；web extension 发到固定 Origin 的回环 nonce 入口，Rust 校验后再交 Python 写账本。打包 Tauri 资源清单包含在线脚本和三份桥接资源，然而 Q-01 说明本地部署脚本不是同一条打包路径。
- **测试边界：** 在本次只读审查中通过了 Python 在线额度 18 项、在线 UI 6 项（合成 IPC）、MV3 浏览器桥合成测试。UI 批次测试应由 `node --experimental-strip-types scripts/test-identities-ui.ts --online-only` 入口运行；单独运行 `test-identity-batch.ts` 没有输出，不能据此当作验证成功。合成 UI 验证真实 React 控件与假 IPC，Python 测状态/账本，Rust 当前测试测边界解析/模型，MV3 测 extension worker；尚无覆盖“真实 Tauri command + 系统 Python 子进程 + Rust Cleaner 锁 + 实际资源目录 + managed browser”的端到端合成通路。报告未运行全库或安装测试。

## 未知与后续验证

真实 Anthropic profile/usage 字段在实际账号下的权限、返回结构及限流行为仍未验证；公开参考只证明实现依据字段名称，不能证明真实账号现在可访问。managed browser profile 的真实登录态与多组织账户的实际网页 API 响应也未验证。Windows 正式 bundle 资源布局与本地部署资源解析路径没有安装验收；尤其需先修复 Q-01，再用隔离临时安装树验证，不能拿旧 0.1.8 安装结果推断当前工作区功能。

除 Q-01、Q-02 外，没有发现可由本次有限源码/合成证据确诊的跨层接口不兼容；这不等于真实账户或部署已验收。设计偏差：本报告按要求仅记录额度子系统，没有评估身份卡片视觉质量或其他产品功能。
