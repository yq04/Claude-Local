<!--
[INPUT]: Current source at 66ffd00, redacted runtime evidence, and isolated synthetic probes of actual functions.
[OUTPUT]: Prioritized functional defects, evidence limits and improvement candidates for the Astra scheme.
[POS]: Functional-audit evidence; no business changes, live account requests, deployment or account data.
-->
# 功能问题与证据

日期：2026-10-25（America/New_York）。基线：文档提交 `66ffd00`，自动续杯业务提交 `5d78c00`，版本元数据 `0.3.1`。

本文件区分：运行态已观测、合成实验已复现、源码确定的条件路径、尚未验证的推断，以及可选功能建议。P1 表示优先修复的正确性或可靠性问题，不等同于已发生账号泄漏；P2 表示随后处理的统计、诊断及兼容问题。S/M/L 是相对改动规模，不是工期承诺。

## W01 · P1 / S：成功后保存旧窗口，空转阶梯退避可能失效

**证据：运行态与源码相互支持，纯模型已复现后果。**

- [identities.tsx:232](../../../src/identities.tsx#L232) 只在 React render 时更新 `stateRef.current`。
- [identities.tsx:994](../../../src/identities.tsx#L994) 的 `read()` 调用 `setState(next)` 后返回布尔值，不返回新快照，也不立即更新 ref。
- [identities.tsx:548](../../../src/identities.tsx#L548) 成功路径 `await read(false)` 后立即读取该 ref，作为 `wokenWindowResetSec`。
- 本机成功槽的持久记录保存的是旧过期 reset，同期服务端账本已经记录更晚的新 reset；匿名详情见 [01](01-wakeup-evidence.md)。
- [identity-online-quota.ts:888](../../../src/identity-online-quota.ts#L888) 仅在新过期窗口等于 `wokenWindowResetSec` 时结算未使用轮数。

**影响：** 本来应进入第二档等待或后续按需待命的账号，可能继续按第一档调度。隔离模型中，旧 reset 得到 `unusedStreak=0`、等待 180 秒；正确 reset 得到 `unusedStreak=1`、等待 1,500 秒，使用相同固定时钟和随机数。

**建议：** 成功提交直接返回经过身份复核的 5h 锚点，或让本地读取返回新 `IdentityState`；由返回值更新运行状态。不要通过等待下一次 render、固定延时或 `flushSync` 解决。若历史成功记录无法可靠修复，标记待校准，不猜测推进轮数。

## W02 · P1 / M：自动续杯的运行范围依赖当前页面

**证据：源码确定。** [main.tsx:201](../../../src/main.tsx#L201) 按页面条件挂载身份面板；[identities.tsx:621](../../../src/identities.tsx#L621) 创建自动调度，卸载在 [695](../../../src/identities.tsx#L695) 清除定时器。

**触发与影响：** 开启后切换到用量、设置或其他页面，应用仍运行但该调度停止；返回身份页才恢复。这与应用级持久开关的用户预期存在偏差。最小化或隐藏后的 WebView 节流属于另外的未实测风险，不能仅凭页面代码断言一定失效。

**建议：** 明确“应用运行时有效”的范围，由单一应用级调度器管理，前端仅展示状态和修改配置。阶段性移到根组件可以解决页面卸载，但不能宣称解决操作系统睡眠或 WebView 节流。不增加常驻 Windows 服务，不承诺程序退出后仍唤醒。

## W03 · P1 / S–M：`updated` 没有严格表示新 5h 窗口已确认

**证据：源码确定的条件路径，未声称本机这一次是假成功。**

- [claude_quota_online.py:1152](../../../scripts/claude_quota_online.py#L1152) 接受响应头或兜底 usage 查询产生的任意非空 `updated` 窗口集合。
- [claude_quota_online.py:1171](../../../scripts/claude_quota_online.py#L1171) 成功后返回通用 `updated_windows`，未要求其中有 5h、reset 位于未来且相较旧过期 reset 更新。
- [identities.tsx:548](../../../src/identities.tsx#L548) 仅以 `updated` 或 `cached` 进入唤醒成功状态，封存当前过期周期。当前 Python `_claim` 走冷却时返回 `cooldown`，不能声称正常路径必然返回 `cached`；后者是前端过宽契约。

**影响：** 若只取得 7d，或未取得新 5h reset，仍可能提示成功并不再尝试该旧周期。额度观测成功与新 5h 窗口确认应分别表达。

**建议：** 分开表达请求已接受、额度已观测、新 5h 窗口已确认。仅在同账号新鲜服务端 5h 锚点满足明确条件时记录 `lastWokenForResetSec`，并回传新 reset。结果不确定时显示未知，不立即重复 POST；未来窗口也不证明是这一次请求单独造成。

## W04 · P1 / S：IPC 抛异常不进入持久退避

**证据：源码确定的异常路径。** [identities.tsx:571](../../../src/identities.tsx#L571) 对返回的错误状态保存退避；[591](../../../src/identities.tsx#L591) 的 `catch` 仅在手动操作时显示错误，不保存状态。

**触发与影响：** IPC 拒绝、桥接异常等 throw 路径保留已经到期的计划；下次约 15 秒 tick 可以再次尝试。不同于已经返回 `rate_limited` 等结果后的受控退避。本轮没有在真实账号上制造异常，也没有观察到重试风暴。

**建议：** throw 也生成有限、可观察的失败状态，保存下次允许尝试时间；未知结果与明确未发出请求分别处理。跨账号间隔应基于实际尝试/调度预算，而不只是成功记录，保持单请求与现有原生锁保护。

## W05 · P2 / S–M：授权阻断缺少明确恢复条件

**证据：实际存在两条授权失败记录；阻断延续行为通过纯模型复现。** [identity-online-quota.ts:938](../../../src/identity-online-quota.ts#L938) 在检查退避时间之前，若同过期周期 `lastStatus=auth_required` 就直接 `auth_blocked`。因此单纯等待 6 小时并不能解除这一分支。现有在线查询成功路径未显式协调清除此自动调度状态。

**影响：** 用户重新授权后，自动状态仍可能被旧错误锁住；界面显示的冷却时长无法解释实际恢复条件。真实两条失败究竟发生在 profile 还是 messages 阶段，没有日志可区分。

**建议：** 保留授权门禁；由显式重新验证成功、账号凭据代次变化或用户明确恢复动作解除旧阻断。不要按时间直接无限重试 401，不引入共享凭据自动刷新。合成验收应证明“未验证仍阻断，已验证新代次可恢复”。

## W06 · P2 / S：缺少可归因日志，配置保存失败静默

**证据：运行态与源码确认。** 本机没有专用唤醒日志；手动和自动共用运行状态及原生命令，见 [identities.tsx:522](../../../src/identities.tsx#L522)、[online.rs:931](../../../src-tauri/src/identities/online.rs#L931)。[identity-online-quota.ts:718](../../../src/identity-online-quota.ts#L718) 与 [745](../../../src/identity-online-quota.ts#L745) 忽略 localStorage 写入异常。

**影响：** 无法从历史中严格区分自动成功和手动成功；失败阶段、等待原因及重启后的持久状态也难以诊断。保存失败时，开关可能只在本次内存中开启。本机本次已确认 WAL 保存成功，不意味着该异常已经发生。

**建议：** 有界记录 trigger、阶段、结果、时间、旧/新 reset、下次计划和匿名槽；保留数量/期限上限，账号关联不进入公开导出。不得记录凭据、账号原始标识、代理/IP、请求正文。提供保存成功/失败和最近执行结果，不增加网络采集。

## B01 · P1 / S–M：缺少核验结果仍可显示整体通过

**证据：直接调用真实导出的 `verifyBrowser`，已复现。**

- [browser-verification.ts:27](../../../src/browser-verification.ts#L27) 对未知 ISP 不建立检查；[34](../../../src/browser-verification.ts#L34) 的语言列表检查也有条件；[49](../../../src/browser-verification.ts#L49) 起的多个探针只在字段存在时加入。
- 整体结果仅检查已经加入的 `checks.every(...)`，不验证完整项集合。
- 合成输入缺少全部深探针和 ISP：仅 12 项仍 `passed`；完整为 20 项；单独缺 WebRTC 或 UA-CH：19 项仍 `passed`。
- 原生 [network.rs:429](../../../src-tauri/src/browser/network.rs#L429) 对三项缺少字段使用 `unwrap_or(true)`；前端 [browser-model.ts:18](../../../src/browser-model.ts#L18) 则把未命中关键词的未知运营商直接归为 ISP。

**影响：** 未测、数据缺失、旧版报告可能被解释为已验证，尤其是用户依据绿色状态做账号环境判断时。

**建议：** 定义带版本的必需指标集合；每项有通过/失败/未知，缺失不能整体通过。ISP 黑名单只能提示已知机房或未识别，不能证明住宅属性。前后端共用指标语义，旧报告保留兼容读取并显示待重测。

## B02 · P2 / S–M：泄漏和音频核验文案超出实际测量范围

**证据：源码确定，未执行真实网络泄漏测试。** [browser-start.tsx:30](../../../src/browser-start.tsx#L30) 的 WebRTC 探针不配置 STUN、只等 300 毫秒，而且 offer 失败/构造异常也通过同一 `finish()` 根据“没收集到地址”返回成功；不能由此证明公网 STUN 或 DNS 没有泄漏。原生 [network.rs:405](../../../src-tauri/src/browser/network.rs#L405) 的标题却合并为 DNS / WebRTC。

[browser-start.tsx:145](../../../src/browser-start.tsx#L145) 在缺少 OfflineAudioContext 时使用默认 48,000Hz，存在时也只读 sampleRate、不执行音频渲染；它检测的是接口/采样率可用性，不能证明音频指纹真实性或无篡改。

**建议：** 先收窄文案，接口错误/超时记未知；如后续增加 DNS/STUN 实测，必须单独说明网络目标、范围和用户触发边界。未实测前不宣称“零泄漏”或“无封禁风险”。

## U01 · P2 / S–M：增量扫描丢失 Effort 上下文

**证据：原样 Rust 解析器片段隔离执行已复现，未修改产品源码。** [usage.rs:318](../../../src-tauri/src/identities/usage.rs#L318) 每次解析从空 `last_effort` 开始；[345](../../../src-tauri/src/identities/usage.rs#L345) 从先前行继承；[506](../../../src-tauri/src/identities/usage.rs#L506) 续读时从已完成 offset 开始，游标缓存不保存 effort 上下文。

**复现：** 合成文件先写 `user.perTurnEffort=high` 与第一条 assistant；首次读为 high。追加第二条不带 effort 的 assistant，从缓存 offset 解析得到空档位；对同一完整文件从 0 解析，两条均为 high。实验保留真实 Counts/Event/clean_effort/parse_file_from、chrono 和 ring；仅将私有文件安全层替换为合成路径适配，不包含 SQLite/UI 集成验证。

**影响：** 同一份日志因首次/增量扫描不同而分入不同档位；不代表总 Token 都错误，也不证明任何真实会话必然缺少逐条 effort。

**建议：** 将可验证的 effort 上下文与游标同事务保存，或在有界范围内可靠恢复上下文；兼容历史缓存并保留账号归属、offset 与已采集事实，缺证据显示未知。不要根据模型名猜档位或无条件全量重扫所有用户日志。

## C01 · P2 / S：出口预检错误不符合 Rust 接收契约

**证据：源码确定的条件路径。** 可选预检启用后，[claude_quota_online.py:1124](../../../scripts/claude_quota_online.py#L1124) 在失败时产生 `reason=non_us_exit|exit_check_failed`、`stage=exit_check` 和可选 `country`；[online.rs:45](../../../src-tauri/src/identities/online.rs#L45) 的 `deny_unknown_fields` 结构没有 country，[parse_result:434](../../../src-tauri/src/identities/online.rs#L434) 的 reason/stage 白名单也不接收上述值。

**影响：** 原本有明确原因的受控拒绝，变成无法解析的通用失败。不会绕过出口门禁。本轮未改变该开关，也没有确认本机已启用它。当前 reason 的 `non_us_exit` 在允许国家可配置时还可能文案不准确。

**建议：** Python/Rust/前端使用相同的有界结果契约和固定错误枚举；若保留国家字段只允许两位代码。增加合成跨语言契约用例，而不是放开任意 JSON 字段或原始错误文本。

## G01 · P3 / S：运行能力预检应反映真实限制

这是**已知能力边界及可改进的接入体验，不是已证安全漏洞**。浏览器 [config.rs:111](../../../src-tauri/src/browser/config.rs#L111) 可接受 HTTP/HTTPS/SOCKS 代理，在线 Python [claude_quota_online.py:129](../../../scripts/claude_quota_online.py#L129) 目前只接受无认证 HTTP CONNECT，并拒绝静默改成直连。Python/cryptography 由外部运行环境提供也是已有明确设计。

建议开启自动续杯前复用无账号能力探针，显示哪些匿名账号支持现有传输、哪些需要明确授权恢复；在用户点击前解释代理能力差异。不要自动改代理、安装依赖或新增绕过路径。

## 可选增量功能（不能当成现有 bug）

1. **可解释的调度面板：** 最近一次结果、等待原因、下次计划、当前时段，以及应用退出/睡眠时的工作范围；与 W06 共用本地记录。
2. **逐账号暂停/恢复：** 现有配置已有 `excludedIdentities`，可以提供明确界面，避免用户只能关闭总开关；重新授权后只恢复通过验证的账号。
3. **本地通知：** 新窗口确认、授权失效、重复失败或长时间未运行的可关闭通知；按已有本地事件去重，不增加 OAuth 轮询，不自动切换账号。
4. **统计覆盖提示：** 保留未知 effort、扫描覆盖范围与版本说明；如增加成本估算，明确 API 价目估计不等同于订阅剩余额度或实际账单。

## 本轮验证与范围

- 真实导出的前端核验函数：`bun .local/research/functional-browser-probe-20261025.ts`，Exit 0，复现缺项仍通过。
- 真实导出的调度纯模型：`bun .local/research/functional-wakeup-model-probe-20261025.ts`，Exit 0，复现旧 reset 的轮数差异与退避到期后仍 auth_blocked。
- 原样 Rust 解析片段：独立临时 rustc harness，使用现有预编译依赖，Exit 0，复现增量/full-scan 的 effort 差异；不等同于全原生集成测试。
- 只读真实状态取证由 [01](01-wakeup-evidence.md) 记录；没有发送真实额度/唤醒请求、切换账号、修改系统或运行安装器。
- 历史方案中已实现的备份救援、稳定账号归属设置、系统设置恢复记录、CLI 安装引导不重复列为缺失。

代码修改、针对性回归、构建、部署与正式发布均不在本轮执行范围。开源参考见 [03](03-github-comparison.md)，分批方案见 [04](04-ASTRA-OPTIMIZATION-PLAN.md)。
