<!--
[INPUT]: 66ffd00 source baseline, redacted runtime evidence, synthetic reproductions, prior implementation receipts and pinned public-source comparisons.
[OUTPUT]: Evidence-bounded functional optimization scheme with a minimal first batch, ordered follow-ups, file scopes and safe acceptance criteria.
[POS]: astra-plan / scheme artifact for the 2026-10-25 functional audit; business implementation and delivery remain unexecuted.
[PROTOCOL]: Preserve existing plans and user changes. No account identifiers, credentials, private paths, ledger bodies or browser-profile content.
-->
# Claude-Local 功能可靠性与优化方案

日期：2026-10-25，America/New_York。规划者：**GPT-6.1 Sol（astra-plan / scheme）**。

后续执行：用户已授权实施，完成情况与实际验收见 [05 执行记录](05-EXECUTION-RESULTS.md)。本文件保留规划时的 `pending` 状态及未执行说明，不用原始计划代替实现回执。

本轮完成只读取证、针对性合成复现、开源机制比较与方案设计；未修改业务源码、发送真实额度或唤醒请求、切换账号、构建、部署或发布。起点为 `feature/functional-reliability-20261023` 上的文档提交 `66ffd00`，自动续杯业务提交 `5d78c00`，当时仍为开发快照。已有安装回执与之后的自动续杯源码增强分开判断，不能拿旧安装包回执证明后续代码已发布。

## 0. 核心决策与边界

**先让自动续杯的结果真实、可追踪，再改调度归属，随后修复核验和统计。** 当前已有一次成功调用及同期未来 5h 服务端锚点，不能回答为“完全没效果”；但它存在影响后续空转退避的真实状态缺陷，其他两个账号槽也报告授权失败，因此也不能回答为“所有账号自动续杯均正常”。

建议采纳的最小第一批是 W01、W03、W04、W06，并在同一次结果契约调整中修 C01。它解决“成功保存旧 reset”“未证实 5h 却提示成功”“IPC 异常不退避”“无法区分自动/手动”“预检错误丢失原因”。第一批通过后可独立形成源码候选，不必等待全部增量功能。W02 的应用级调度属于下一批 M 级改动；第一批须如实提示当前页面运行范围。

推荐目标架构是**应用进程内唯一的原生调度所有者**：界面只读状态、显式修改配置，Rust 管理任务和调度状态，现有 Python 继续校验账号并独占写入额度账本。不开 Windows 服务或计划任务，不承诺应用退出、系统睡眠、断网期间继续唤醒。把 timer 临时搬到根 React 组件只能解决切页卸载，不能作为完整可靠性结项。

权威顺序为用户本轮范围、根 `AGENTS.md`、当前 `HANDOFF.md`、相应目录 `CLAUDE.md`、本轮 [01 运行证据](01-wakeup-evidence.md) / [02 问题证据](02-functional-findings.md) / [03 开源比较](03-github-comparison.md)，再参考历史计划。历史方案的未完成措辞必须与 [既有执行记录](../2026-10-23-functional-review/05-EXECUTION-RESULTS.md) 对照，不再把已实现的备份救援、CLI 安装引导、稳定账号归属、系统修改恢复记录当成新缺失。

这是研究与规划授权，不包含实施或交付授权。后续仅在用户要求执行时进入对应阶段；真实账号验收、安装更新和发布仍依各自已有确认与安全流程进行。

## 1. 已核实事实与证据限制

### 1.1 自动续杯已经出现效果，但归因和覆盖不足

最后可见持久配置为 `enabled=true`、08:00–23:00、40% 预热阈值。当地 2026-10-25 21:07:42 记录了一次唤醒 `updated`，同期 Python 状态与额度账本包含新的未来 5h 服务端锚点，其重置时间为次日 02:00 EDT。此前计划时间为 21:07:37，约 5.6 秒后出现成功，强烈支持自动调度执行；现有状态没有 trigger 字段，仍不能严格排除手动点击恰好发生在附近。来源、时间转换和活动 WAL 限制见 [01](01-wakeup-evidence.md)。这不是实时 DOM 检查，也不是新增额度或请求因果性的证明。

另两个账号槽报告 `auth_required`，持久数据缺少失败阶段，无法判断是 profile GET 还是 messages POST 返回 401。不得据此直接归咎于设备 ID、代理、地区或服务商风控，更不能为了验证而自动发起真实请求。

### 1.2 优先修复的调用链有直接依据

W01 的核心链条是 [render 更新 ref](../../../src/identities.tsx#L232) → [read 只 setState 并返回布尔值](../../../src/identities.tsx#L994) → [成功续体立即读取旧 ref](../../../src/identities.tsx#L548)。实机状态的旧 reset 与同期新账本不一致；[空转轮数结算](../../../src/identity-online-quota.ts#L888) 又依赖新 reset 精确匹配，纯模型已复现等待档位不同。这不只是日志缺失，而是状态正确性问题。

W03 的 Python 路径接受任一有效额度窗口并 [返回通用 updated](../../../scripts/claude_quota_online.py#L1171)，界面 [仅按 updated/cached 判成功](../../../src/identities.tsx#L548)。因此 7d 单窗更新不能自动等价于新 5h 已确认。本次实机存在独立 5h 锚点，所以不能把这个条件缺陷反说成本次已经假成功。

W02 来自 [页面条件挂载](../../../src/main.tsx#L201) 和 [timer 卸载清理](../../../src/identities.tsx#L621)。W04 来自 [throw 路径不写退避](../../../src/identities.tsx#L591)。W05 来自 [auth 阻断先于退避检查](../../../src/identity-online-quota.ts#L938)，单纯等满 6 小时并不会解除同一过期周期的阻断。

浏览器 B01 已通过真实导出的 [verifyBrowser](../../../src/browser-verification.ts#L12) 合成调用复现：缺少深探针和 ISP 只剩 12 项仍通过，完整为 20 项，缺 WebRTC 或 UA-CH 时 19 项仍通过。原生 [缺少探针默认 true](../../../src-tauri/src/browser/network.rs#L421) 也需改正。这里证明的是“未知误绿”，没有证明发生了实际网络泄漏或账号事故。

U01 已用真实 Rust 解析片段在隔离合成文件中复现：首次 high，追加无逐条 effort 的消息后增量读为空，而从头解析仍为 high。原因在 [每次清空 last_effort](../../../src-tauri/src/identities/usage.rs#L318) 与 [从缓存 offset 续读](../../../src-tauri/src/identities/usage.rs#L506) 的组合。它影响档位分布，不意味着总 Token 全部错误；实验还不是 SQLite/UI 集成验收。

### 1.3 开源研究依据

本轮 GitHub 取证覆盖六个固定提交，详细仓库、许可证与源码路径见 [03](03-github-comparison.md)。这里只采纳与现有证据直接相关的机制，不把外部项目的经验参数、issue 或建议当成本项目已证缺陷。

- **计算与显示分离、原子状态写入：** [claude-code-usage-bar 的 daemon.py，b801a87c](https://github.com/leeguooooo/claude-code-usage-bar/blob/b801a87c0bceeb4a5f255187067d3cc060b166f6/src/claude_statusbar/daemon.py#L27) 明确所有缓存写入走兄弟临时文件和 `os.replace`，是状态提交与显示分离的参考；[ip_risk.py，同提交](https://github.com/leeguooooo/claude-code-usage-bar/blob/b801a87c0bceeb4a5f255187067d3cc060b166f6/src/claude_statusbar/ip_risk.py#L21) 的失败缓存和 in-flight 期限说明“失败也应进入状态”这一模式。用于 W04/W06 和第二批。仅借鉴机制，不引入其后台 daemon、不照搬固定 300 秒或检测 TTL，也不新增外网 IP 风险评分。
- **失败分类与请求节奏：** [claude-swap 的 oauth.py，042a36b6](https://github.com/realiti4/claude-swap/blob/042a36b673d51f4bf990b04f903aee02f1ab07e1/src/claude_swap/oauth.py#L411) 按 HTTP 状态和数字 Retry-After 分类，并用 context/kind/retry 记录失败；它并没有可直接移植的 `stage=profile|usage` 结果字段。[poll_policy.py，同提交](https://github.com/realiti4/claude-swap/blob/042a36b673d51f4bf990b04f903aee02f1ab07e1/src/claude_swap/poll_policy.py#L117) 的抖动策略可用于比较请求节奏。本项目的阶段枚举是针对 W05/W06 独立设计的契约；不把参考项目注释中的经验限流数字解释为 Anthropic 的普遍额度或请求上限，不移植共享授权刷新或 CLI 锁操作。
- **解析与聚合分层、事件去重：** [ccusage 的 Claude adapter，b40f5114](https://github.com/ccusage/ccusage/blob/b40f51149d117e7c01b5f92466bae44e39c66a10/rust/adapters/claude/src/lib.rs) 用于比较文件解析和去重组织。U01 的直接修复依据仍是本项目隔离复现；不声称 ccusage 的成本模式已经解决 Effort 游标继承，不根据其设计重写本项目事件主键、账号归属或整段读取架构。该仓库 License API 为 `NOASSERTION`，但本轮核对的根 LICENSE 正文为 MIT，以正文而非 API 标签作此项判断。
- **精确补丁与本地配置边界：** [cc-switch 的 claude_direct.rs，e8e1cfbf](https://github.com/farion1231/cc-switch/blob/e8e1cfbff4f2d93f2d6c4ba4ad10b511e012c733/src-tauri/src/services/provider/claude_direct.rs) 只作局部写入与配置职责划分参考。其 [issue #7808](https://github.com/farion1231/cc-switch/issues/7808) 属于运行中环境变量行为线索，未在本项目受控复现，不列为本轮本地 bug，不据此写真实设置、置空凭据或改锁。
- **HTTP 重试与凭据状态对照：** [claude-meter 的 oauth.rs，acef1aa4](https://github.com/m13v/claude-meter/blob/acef1aa48f39fdb0f8567313f6df8d0dd2fdf8aa/src/oauth.rs) 用于比较 401/429 和 Retry-After 的解释。保留本项目“本地 expiry 可能滞后，服务器 profile 决定绑定有效性”的现有选择，不照搬仅凭本地过期时间拒绝的策略，更不将任意 GET 成功视为 messages 权限已恢复。
- **profile 字段事实对照：** [ClaudeTimer 的 ClaudeUsageClient.cs，ddf542ef](https://github.com/TimeWinder-dk/ClaudeTimer/blob/ddf542efdcf1c7fb208d0ec1e8c4820db9d4f440/src/ClaudeTimer/Services/ClaudeUsageClient.cs#L26) 只强制 account UUID 非空，组织 UUID 允许缺省，因此仅作字段形状参考，不能当作三字段强绑定的先例。本项目已有更严格的 account/email/organization 验证，不列新缺失；其 AGPL-3.0 源码不进入本方案实现。其他五个仓库的 MIT 参考也不免除版权与 notices 核查。

这些外部机制支持的是工程取舍，不直接证明本机效果、服务商许可或无风控风险。实施时只复读实际采用机制的固定文件，独立实现；未核实的共享配置竞态、精确限流制度、成本回填与“住宅 IP 安全”结论不进入验收门槛。

## 2. 问题分级、最小改动与未知

### 2.1 已证 bug 与可靠性缺口

以下编号与 [02](02-functional-findings.md) 一致，S/M/L 为相对改动规模，不是工期。P1 是优先正确性问题，不等同于高危安全漏洞。

- **W01，P1 / S：旧窗口进入成功状态。** 触发是异步读取完成但 React 尚未 render；后果是下一轮空转计数可能不递增。最小改动是消费明确返回的新快照或已提交新 reset，禁止等待 render、固定延时或 `flushSync`。历史无法证实的空转轮数保持未知。
- **W02，P1 / M：持久开关随身份页卸载停摆。** 触发是切到其他页面；后果是应用仍在运行却没有自动调度。最小过渡是 root 常驻控制器，完整解法是进程级单一原生所有者。隐藏/最小化节流尚未实测，不能先声称已证失效。
- **W03，P1 / S–M：额度更新与新 5h 成功混用。** 触发是只有 7d、缺少新 reset 或结果不完整；后果是提示成功并封存旧周期。最小改动是独立的唤醒效果字段，通用额度更新状态继续保留。
- **W04，P1 / S：异常绕过退避。** 触发是 IPC throw；后果是下个约 15 秒 tick 可再次尝试。最小改动是异常也落入有界失败状态，区分确定未派发与派发后未知，不能对后者立即重复 POST。
- **W05，P2 / S–M：授权失败没有明确恢复规则。** 触发是同一过期周期曾报授权失败；后果是时间到了仍被旧状态阻断。最小修复先显示真实恢复条件；后续按已验证的新凭据代次或显式恢复动作允许受控尝试。不能把任意 profile/usage GET 成功当成 messages POST 权限恢复的充分证明。
- **B01，P1 / S–M：必需项缺失仍整体通过。** 触发是旧报告、探针缺失或未知运营商；后果是用户把未测理解为已验证。最小改动为版本化必需项与通过/失败/未知三态，缺项显示待重测。
- **B02，P2 / S–M：检测结论超过测量范围。** 无 STUN、300ms 内未见地址或构造异常不能证明公网/DNS 零泄漏；默认 48kHz 或读 sampleRate 不能证明音频指纹真实。先收窄文案并把异常记未知，再决定是否值得新增明确触发的测量。
- **U01，P2 / S–M：增量扫描遗失 Effort 上下文。** 触发是 effort 出现在已扫描行，新增消息不再重复字段；后果是同日志随扫描方式改变分组。最小改动是游标与必要上下文同事务持久化，文件替换、截断或 guard 失效时一并重置。
- **C01，P2 / S：Python 的出口预检错误超出 Rust 白名单。** 可选预检失败时，`country`、新 reason 和 `exit_check` 被严格接收器拒绝。修明确有界契约即可；它是错误解释丢失，不是门禁被绕过，也不能放开任意 JSON 作为修复。

### 2.2 真实功能缺口与建议功能分开

**W06，P2 / S** 是诊断与持久化反馈缺口：缺少自动/手动、阶段、最近结果和等待原因，存储异常又被吞掉。虽然优先级为 P2，它是回答“自动续杯有没有效果”的必要条件，故与第一批一起交付。只保存有界枚举、时间、匿名本地槽和必要 reset，公开导出不携带账号关联。

**G01，P3 / S** 是现有能力的可见性不足：浏览器支持的代理类型比 Python 在线通路更多，而 Python 正确拒绝不支持的配置。先显示能力差异，复用已有无账号运行时探针；不应把拒绝改成静默直连，也不必先引入新的代理依赖。

逐账号暂停、安静的本地通知、统计覆盖说明是可选增量，不属于已证 bug。原有 `excludedIdentities` 可做界面入口；成本估算如将来需要，应明确 API 价目估计不等于订阅额度或实际账单。第一批不同时扩展这些产品功能。

### 2.3 推断和仍未知的内容

“21:07 附近的成功由自动触发”有时间关联支持，但缺少来源记录，不能提升为严格事实。两个授权失败的确切阶段、当前凭据有效性、出口预检当时是否启用、隐藏窗口调度节流的真实程度尚未核实。

本轮不是穷尽全仓的安全审计，未验证真实 DNS/STUN 泄漏、服务商长期接口稳定性、未来风控行为、真实安装升级或全部账号类型。开源项目相同机制只说明可借鉴的工程模式，不能证明服务商许可、账号绝对安全或本项目采用后一定正常。

## 3. 分阶段实施方案

### 3.1 第一批：成功语义、窗口状态与可归因诊断

**Status: pending。优先级 P1，规模 S–M。覆盖 W01/W03/W04/W06，并顺带修 C01。**

**目标与依赖。** 不扩大调度运行范围或新增网络采集，先保证“已确认新 5h”可被证据支持。依赖当前严格 profile 账号绑定、原生提交复核、Python writer lock 和原子替换，全部保留。W05 在这一批先显示“等待重新授权/手动恢复”，不显示一个实际上不能解除阻断的倒计时。

**目标文件。** 修改 `scripts/claude_quota_online.py`、`scripts/test-claude-quota-online.py`、`src-tauri/src/identities/online.rs`、`src/identity-online-quota.ts`、其 `.test.ts`、`src/identities.tsx`、`src/identity-diagnostics.ts`、两语目录及 `scripts/test-quota-reset.ts`。如已有诊断导出不能安全容纳唤醒记录，新增独立的白名单投影模块。新增原生有界唤醒审计模块的候选位置为 `src-tauri/src/identities/wakeup_audit.rs`，相应在 `identities/mod.rs` 接入。更新受影响源头部和目录 map，不改归档格式。

**具体产出。** 通用 `updated_windows` 仍表示额度观测；另回传唤醒请求阶段与效果，例如 `request_accepted`、`quota_observed`、`new_5h_confirmed`、`outcome_unknown`。只有同一冻结账号、已提交的新鲜 5h 服务端锚点，且新 reset 晚于当前时刻与目标旧过期 reset，才可写 `lastWokenForResetSec` / `wokenWindowResetSec`。不要求恰好从请求时刻加 5 小时；不把已观测未来窗口描述为本请求独自造成。

新 reset 首选直接来自 Python 已提交结果，经 Rust 严格接收；如果阶段性使用 `read()` 返回的新快照，必须再次核验其账号指纹与目标一致，并处理读取失败/响应被新读取代次替代。不得重新使用等待 render 的 ref。仅 7d 更新保留有效额度，唤醒效果显示未确认，并受尝试退避保护，不能立即重发。

原生记录最小一次任务的随机 request ID、trigger=`auto|manual`、阶段、状态、时间、匿名本地账号槽、旧/新 reset 及下次允许时间；不存请求正文、响应正文、账号 UUID/email/指纹、代理、IP 或凭据。状态文件位于固定每用户私有产品目录，数量和保留期有上限；只有原生写此审计文件，Python 继续独占额度账本及既有在线状态。公开导出经过额外白名单，不导出账号映射、原始错误或路径。保存失败明确反馈，开关只有持久化成功才显示已保存。

异常路径统一保存退避。已知未派发与已经派发但结果未知分别显示；任何真实尝试均纳入全局节奏，遵守 `Retry-After`。将 C01 的失败原因/阶段一并纳入两端固定枚举；国家字段若保留，仅允许两位代码，并将 `non_us_exit` 改为符合“可配置允许国家”的中性语义。保持 `deny_unknown_fields`。

**安全验收。** 以下均为后续命令，尚未在本轮执行：

```powershell
python scripts/test-claude-quota-online.py
bun test src/identity-online-quota.test.ts src/identity-diagnostics.test.ts src/i18n.test.ts
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol identities::online::tests
node --experimental-strip-types scripts/test-identities-ui.ts --quota-reset-only
bun run build
```

新增用例重点是：延迟 render 后仍记录新 reset；只有 7d、不完整结果、cached 不被当作新 5h；IPC throw 后下一 tick 不重发；同一结果不会重复结算；保存失败不假装持久化；auto/manual 可区别；出口失败结果可跨 Python→Rust→UI 保留受控原因。Python 测试用 fake HTTP，界面用 fake IPC，禁止真实账号与外网。`wakeup_audit` 如独立新增，只加其有界记录/脱敏直接测试过滤器。每个命令针对本批实际改动运行一次，通过即止。

**兼容和回滚。** 字段采用有版本、有界的附加契约，同步修改 Python/Rust/前端，不能混装新旧 helper。保留旧运行状态原始证据，不凭未来新 reset 伪造过去漏计的空转轮数；无法证明的历史标为不完整，从可信新观测开始跟踪。出现问题可关闭新入口并恢复精确产品文件备份；不回滚或删除额度账本、保险库、浏览器资料。网络请求已经产生的消耗不能通过软件回滚撤销。

### 3.2 第二批：单一应用级调度与明确授权恢复

**Status: pending。优先级 P1/P2，规模 M。覆盖 W02/W05。依赖第一批成功和审计契约。**

**目标文件。** 新增 `src-tauri/src/identities/wakeup.rs` 与隔离 `wakeup_tests.rs`，修改 `identities/mod.rs`、`src-tauri/src/main.rs`、`online.rs`、`src/main.tsx`、`src/identities.tsx`、`identity-online-quota.ts`、相关目录 map 和两语目录。任务状态/设置命令采用固定类型和白名单，不接受任意文件路径或 URL。

**具体产出。** Rust 在主应用进程内创建唯一所有者；前端挂载/卸载只影响订阅显示，不销毁任务。既有 TS 纯模型在迁移期作兼容与展示辅助，迁移完成后由原生快照成为唯一调度事实，禁止并存两套会发请求的调度器。禁用旧 timer 必须先于启用原生 owner。

控制状态包括已禁用、时段外、等待连接、冷却、计划、运行、结果未知及新窗口已确认。继续沿用现有显式开关、时段、排除项、已知周额度门禁、当前运行 CLI 保护和账号冻结/提交复核。不自动切换当前身份、不停止 `claude.exe`、不启动浏览器。添加账号或目标集合变化时须有明确范围与代次规则，不能借架构迁移暗中扩大已授权目标。

原生只使用已有受限摘要/元数据与已提交结果决定时机，不为了调度增加 OAuth usage 轮询。计算一次并保存计划时间；不每 tick 重抽随机数导致倒计时不断后移。等待期间不占身份事务长锁，临近派发与提交仍复用现有门禁。尝试预算覆盖失败与成功，不把“配置了代理字符串”当作已证明独立出口的依据。

W05 采用“新代次或明确恢复”的门禁：历史未知阶段的授权失败保持保守；验证新凭据与冻结账号匹配后，最多允许一次受控恢复尝试，具体请求阶段仍可失败并重新阻断。显式成功恢复清掉该旧代次阻断。仅时间到、同一 profile 再次成功或用户关闭重开总开关，均不能产生无限 401 重试。不得添加共享 OAuth refresh 或修改 `.claude.json`。

持久化设置与运行状态有 schema、范围和时间戳校验。旧 localStorage 配置显式迁移并在原生提交成功后确认，原键保留作兼容证据，失败不默默重新默认启用。跨重启恢复计划，睡眠恢复后重新检查时段、目标、周额度和退避，不补发睡眠期间每个遗漏 tick。请求派发后若崩溃而结果未提交，记录为未知，优先使用现有被动观测或等待用户明确校准，不能立即重放 POST；不承诺跨崩溃网络 exactly-once。

**验收入口。** 原生新建模块按实际模块名使用 `cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol identities::wakeup`；前端继续使用第一批 Bun 相关模型测试。新增仅覆盖调度生命周期的 fake-IPC GUI 检查，可在 `test-identities-ui.ts` 中增加专用 `--wakeup-only` 选择器后运行，不跑无关页面套件。最后一次 `bun run build` 验证契约接线。

验收必须证明：启用后切页仍只有一个任务；返回页面不重复派发；禁用后无新任务；重启/休眠恢复不会补发风暴；相同周期成功幂等；throw、429、401、目标/凭据/路由代次变化均受控；历史未知结果不立即重发；重新授权没有通过时仍阻断。全部用合成账号、fake 时钟与 fake transport，个人机器不进入睡眠或真实身份切换。

**兼容和回滚。** 迁移不得改变 BAGAID01、`.baga`、身份 HMAC、SQLite `user_version=3` 或浏览器 seed-domain。新状态是独立附加数据；保留旧值和新值迁移回执。回滚必须避免原生 owner 与旧 timer 同时激活，不回退身份数据库；最安全降级是明确关闭自动功能、保留被动额度与手动入口。应用关闭/系统睡眠的实际 Windows 验收留给隔离测试环境，不能由 fake timer 冒充。

### 3.3 第三批：浏览器核验真实表达完整性和测量范围

**Status: pending。优先级 P1/P2，规模 S–M。覆盖 B01/B02，可在第一批后独立实施。**

**目标文件。** 修改 `src/browser-model.ts`、`browser-verification.ts` / `.test.ts`、`browser-start.tsx`、`browser.tsx`、`src-tauri/src/browser/network.rs`、相应原生测试、两语目录与 map；仅在需要覆盖真实页面采集错误时扩展已有隔离浏览器测试。无需改浏览器资料、引擎或指纹种子。

**具体产出。** 建立版本化指标 ID 目录，分别表达是否适用、是否完成、实际结果、测量方法和时间。不能仅按现存数组 `every()` 或硬凑“20 项”判成功；缺必需项、缺采样、超时或旧报告统一为未知/待重测。平台不支持的项单列能力限制，不能画成通过。前后端对同一报告给出一致结论，保留旧报告的有界读取兼容。

ISP 分类改为“已识别机房特征/未识别/有来源支持的运营商信息”；黑名单未命中不等于住宅 IP。WebRTC 构造、offer 或等待失败记未知；当前无 STUN 测量只表达有限本地候选检查，不包含 DNS。AudioContext 不存在不得填默认采样率冒充实测；若只读采样率，标签明确为能力信息。若确需真正渲染音频样本，单独给方法/失败状态，仍不能因此保证指纹无篡改。

**安全验收命令。**

```powershell
bun test src/browser-verification.test.ts src/browser-network.test.ts src/i18n.test.ts
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol browser::tests
bun run build
```

合成场景覆盖缺全部探针、单缺必需项、未知 ISP、旧版本、报告过期、探针 throw/超时，以及完整有效报告；前后端结果一致。采集器用 fake API 或隔离 browser context，阻止外部网络。单纯收窄文案无需扩展大回归。真实 DNS/STUN 测量若将来要做，须先形成独立、用户可见的网络目标和范围，再单独授权验收；本阶段不为修绿灯而添加隐式外网探测。

**兼容和取舍。** 升级后可能出现更多“未知/待重测”，这是纠正原先证据不足，不是让所有账号必须通过更多“防封”动作。保留配置和既有报告，不删除资料，不声称随机延迟、请求头模拟或住宅出口可以消除账号风险。

### 3.4 第四批：Effort 与增量游标保持一致

**Status: pending。优先级 P2，规模 S–M。覆盖 U01，与浏览器批次互不依赖。**

**目标文件。** 修改 `src-tauri/src/identities/usage.rs`、`usage_tests.rs`、`docs/USAGE_STATISTICS.md` 和目录 map；只有展示覆盖范围需要时才改 `src/usage-model.ts`、`usage-statistics.tsx` 与两语目录。

**具体产出。** 在独立 usage ledger 的文件游标记录中附加已验证 effort 上下文，完整行 offset、guard 与上下文同事务提交。新增数据只含枚举/有界档位和解析器版本，不写入会话正文。文件被替换、截断、guard 不一致或重扫时上下文随游标失效；不得从前一个文件泄漏上下文。

旧游标没有上下文时标记迁移范围，选择一次受控回填或有界可靠恢复；不能无条件全量重扫全部用户日志，也不能把未知自动猜为 high。复用已有去重、账号归属、sidechain 规则，修复档位不改变原始账号证据。历史缺少来源时保留未知，并展示统计覆盖限制。

**安全验收命令。**

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol identities::usage_tests
```

在该模块增加有意义的合成集成回归：真实 ledger 首读后追加无 effort 的 assistant，再读，与同文件首次全扫的档位一致；Token/请求总计不重复；中途 effort 改变被正确继承；文件重置不沿用旧上下文；迁移失败不提前推进 offset。若只改 Rust 与文档，不额外跑全前端 GUI；确改展示时仅跑 `bun test src/usage-model.test.ts src/i18n.test.ts` 和构建。

**兼容和回滚。** 仅对 usage ledger 作可忽略的附加迁移，身份库 `user_version=3` 不变；缓存修复不能当成原始事件删除理由。回滚保留新列、已有事件和账号归属，旧版本忽略附加字段即可。不要通过删账本、清缓存或重置所有归属验证修复。

### 3.5 第五批：开启前能力预检与逐账号控制

**Status: pending。优先级 P3，规模 S–M。覆盖 G01 与有价值的增量功能，依赖原生调度快照。**

**目标文件。** 修改已有 `quota_runtime.py` 探测接线、`online.rs` 的公开能力投影、`src/identities.tsx`、`identity-online-quota.ts`、相关测试和两语目录；只有资源集合实际变化时才更新 runtime manifest 与打包审计 allowlist。

**具体产出。** 开启面板说明“应用运行时有效”、当前生效时段、匿名账号可运行/待授权/传输不支持状态。复用现有无账号 Python/cryptography 能力探针，不发 profile、usage 或 messages 来做启动预检。代理能力来自现有受限配置解析，向 UI 返回支持/原因枚举，不暴露地址或认证信息，不自动改代理或安装依赖。

为现有排除配置提供逐账号暂停/恢复，显示最近结果、下次计划和等待原因。暂停不删除历史，不影响手动本地同步；恢复仍通过身份及授权门禁。安静的本地通知可在这一批之后另做，默认不增加通知权限或网络流量，按本地事件去重，可关闭。暂不新增成本估算、自动切号或浏览器批量登录。

**安全验收入口。** `python scripts/test-quota-runtime.py` 仅在能力探针改动时运行；`bun test src/identity-online-quota.test.ts src/i18n.test.ts`；原生仍按实际新能力函数所在模块过滤；有 UI 变更再运行专用 `--wakeup-only` 和一次构建。断言预检不触发账号网络请求，不支持代理保持明确拒绝，不静默直连；单账号暂停不影响其他账号且不越过授权门禁。

**兼容和取舍。** 本阶段不承诺增加 HTTPS/SOCKS/认证代理在线支持。若用户确有此需求，再单独评估传输适配、依赖许可、运行时资源与真实路由一致性；现阶段先让限制可见，避免扩大凭据或网络攻击面。

### 3.6 按实际候选形成实施回执，交付单独处理

**Status: pending。规模取决于实际执行批次。**

执行时新增本目录的 `05-EXECUTION-RESULTS.md`，记录实际修改、精确候选、对应测试结果、未验收范围和设计偏差；不把所有 pending 一次改成 complete。只有用户另行要求更新/打包/发布时，才准备对应版本说明和交付。

本方案没有指定新版本号，不移动已有产品标签，不运行部署脚本、不推送、不创建发布资产。若之后交付，使用既有 `--features custom-protocol` 与资源/隐私审计流程，产品文件先备份并核验，不停止 `claude.exe`。真实安装、升级、卸载及系统修改验收仅在一次性 Windows 环境进行；文档提交和合成测试不能替代这些回执。

## 4. 执行时才做的事

后续用户要求执行后，先重新只读核对工作树与当前源码，保留用户既有改动；按第一批开始，不把所有阶段合成一个巨型改动。每一批更新受影响的 INPUT/OUTPUT/POS、目录 map 和双语键，再运行相应有限验证。原生资源不足时按 [开发说明](../../DEVELOPMENT.md#L64) 使用公开静态资源覆盖，并保存、恢复原有 `TAURI_CONFIG`，不覆盖用户自己的环境值。

合成测试均使用临时目录、虚构账号与 fake transport，不读取真实保险库或 Cookie，不运行真实额度 collector、切号或清理。本方案中的未来验收命令不代表已经执行。通过即止，只有新改动或未解决失败才扩大验证；不安排无请求的全库大回归或多轮深度审查。

真实效果验收优先等待用户已有使用过程自然产生新的 trigger-tagged 事件，再被动查看对应时间/结果。若确需主动触发真实唤醒，由用户明确选账号、了解请求会消耗用量并指定允许范围；本轮不借“验证”发新请求。授权失败只能由用户本人完成必要连接，不能自动刷新共享凭据、提取 Cookie 或绕过 profile/organization 匹配。

## 5. 明确不做与最终取舍

不添加上游 remote、自动同步、官方应用更新端点或自动发布流程；不挪用他人的应用发布链。不触碰 BAGAID01、`.baga` 编码、SQLite 身份库 `user_version=3`、账号 HMAC 与 legacy seed-domain，不再生已有身份、密钥或浏览器种子。

不让 Rust 成为第二个额度账本写入者，不写 `.claude.json`，不增加默认 OAuth 轮询或后台 refresh，不启动浏览器来维持登录。不为修问题做真实身份切换、清理、全库重扫、运行中 CLI 中断或保险库覆盖。备份与迁移继续是新私有目标、完整性检查、源保留的路径。

不把任何开源实现或“防封”检查当成服务商授权与账号安全保证。引入依赖前核对固定版本和许可证，保留 MIT 原始版权及第三方 notices；既有 vendored UI/Chromium 分发边界仍按 [DISTRIBUTION](../../DISTRIBUTION.md) 处理。参考源码机制不等于复制实现，更不隐含取得无许可代码的分发权。

**做了什么：** 将运行证据、真实缺陷、功能缺口和可选增量分开，给出最小第一批、后续所有权架构、具体文件、验证入口与兼容要求。

**遗留什么：** 全部业务实施仍为 pending；自动触发的严格历史归因、两个授权错误的具体阶段、隐藏窗口/睡眠运行行为、真实账号与安装交付验收仍有明确证据边界。

**设计取舍：** 第一批先修正确性和解释能力；原生进程级调度在后续承担页面独立性，不增加系统常驻服务。未知显示未知，不用额外网络请求、丢弃历史或降低身份校验换取绿色状态。
