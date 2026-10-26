<!--
[INPUT]: Read-only runtime evidence, exact-key WebView WAL projection, and source inspection for automatic quota wakeup.
[OUTPUT]: Public, privacy-safe evidence and defect findings for the 2026-10-25 functional audit.
[POS]: docs/plans/2026-10-25-functional-audit evidence report.
-->
# 自动续杯运行证据与实现缺陷

审计只读进行：未发起额度或唤醒网络请求，未切换身份、改动设置或修改运行数据。运行证据仅投影自动续杯两个 localStorage 键及白名单额度字段；报告不包含个人路径、账号标识、指纹、代理信息或凭据。

## 运行结论

**开关已持久化。** 对 WebView2 LevelDB 当前活动 WAL 作了限量解析，只接受 `claude-local:auto-wakeup-config-v1` 与 `claude-local:auto-wakeup-state-v1` 两个精确键。配置记录为 `enabled=true`，生效时段 08:00–23:00，按需预热阈值 40%，无排除账号。该记录来自活动 WAL，已持久写入；运行中的 WebView 仍可能有尚未刷盘的更新，因此这是最后一条可见的持久记录，不是实时 DOM 读取。

**一次唤醒调用返回 `updated`，同期记录到一个新的服务端 5h 额度锚点。** 当地时间为 2026-10-25 21:07:42（America/New_York，EDT；2026-10-26 01:07:42 UTC）。前端状态记录 `lastStatus=updated`、`lastWokenAt` 和全局唤醒时间；Python OAuth 状态于 2026-10-26 01:07:42.490 UTC 记录 `updated`、`verified_at`、`last_observed_at`，错误计数为 0。同期额度账本中的 5h 服务端锚点报告使用率 0%，重置时间为 **2026-10-26 02:00 EDT（06:00 UTC）**。这证明同期获取并持久化了一个未来 5h 服务端锚点；不能证明本次请求单独造成了窗口重置或增加了额度。

**时间强烈支持自动调度执行，但不能严格归因。** 同一匿名状态槽在成功前记录计划时间为 2026-10-25 21:07:37.015 EDT，成功状态时间晚约 5.6 秒；这与 15 秒轮询定时器触发相符。手动唤醒走相同函数并写入相同状态结构，现有数据无法排除用户恰好在计划时间手动操作。

**另有两个账号槽报告授权失败。** Python 状态为 `auth_required`、错误计数各为 1，退避至 2026-10-26 02:56:29 EDT 与 03:00:41 EDT；一个槽有较早 OAuth 观测，另一个没有。持久状态未记录失败 stage/reason，因此不能判断失败来自 profile GET 还是 messages POST 的 401。缺少 `.claude.json` 的设备 ID 本身不是已证原因，源码会使用确定性账号级后备值；退出国家预检则仅在配置启用时执行，运行记录没有说明当时是否启用。

## `updated` 的证据边界

前端将 `updated` 或 `cached` 都当成唤醒成功（[identities.tsx](../../../src/identities.tsx#L548)）。Python `run_wakeup` 只有在 `/v1/messages` 返回 HTTP 200，并从响应头或 fallback 的 OAuth usage GET 取得有效额度锚点后，才提交并返回 `updated`（[claude_quota_online.py](../../../scripts/claude_quota_online.py#L1145)）。但锚点解析接受 5h 或 7d 中任一有效窗口，所以单看 `updated` 字段并不严格证明 5h 窗口存在或已刷新。此次同刻账本独立存在 5h 服务端锚点，补足了“有 5h 观测”的证据；响应头与 fallback 哪条路径被采用仍无从区分，`updated` 也不等同于额度增加。

## 确认的调度状态缺陷（P1）

唤醒成功路径先执行 `await read(false)`，随后立即从 `stateRef.current` 取 `afterSummary` 并记录 `wokenWindowResetSec`（[identities.tsx](../../../src/identities.tsx#L548)）。然而 `read()` 只调用 `setState(next)`（[identities.tsx](../../../src/identities.tsx#L994)），`stateRef.current` 仅在后续 React render 更新（[identities.tsx](../../../src/identities.tsx#L232)）。因此这段续体可能读取旧额度状态。

实机持久状态与此失效模式吻合：成功槽的 `wokenWindowResetSec` 与 `lastWokenForResetSec` 完全相同，仍指向旧到期边界；同期服务端 5h 锚点却报告了未来重置时间。引擎只在 `wokenWindowResetSec === inferredReset5h` 时结算上一轮是否空转（[identity-online-quota.ts](../../../src/identity-online-quota.ts#L888)）。旧值无法匹配下一轮的新到期时间时，`unusedStreak` 不会按预期递增，连续空转后的阶梯退避可能失效。最小修复是让 `read()` 返回新 `IdentityState`，并使用该返回值计算窗口 reset，不立即重读尚未刷新的 ref。

## 失败重试与运行范围

- IPC 调用抛异常时，`catch` 仅返回失败，没有写入 `backoffUntilMs`（[identities.tsx](../../../src/identities.tsx#L591)）。该槽仍保持已到期状态，15 秒后下一轮可立即重试。明确返回的授权、限流或普通错误状态则会写退避；缺口限于抛异常路径。建议在 `catch` 中持久化普通错误退避，并保留错误反馈。
- 自动调度器是身份页挂载期间的 React timer；页面卸载会清除 timer（[identities.tsx](../../../src/identities.tsx#L621)）。关页或应用退出时不会在后台运行，重新挂载后才可从已持久配置继续调度。
- 配置写入 localStorage 的异常被静默吞掉（[identity-online-quota.ts](../../../src/identity-online-quota.ts#L718)），界面没有持久化确认。虽然本次已从活动 WAL 确认开关落盘，但一般用户遇到存储失败时仍无法从 UI 得知。
- 当前没有应用唤醒诊断日志；手动与自动使用同一状态更新，不保存触发来源。

## 证据完整性与安全验证

活动 LevelDB 清单指向 `000004.log`；清单序列为 570，WAL 中匹配状态的写批序列为 703。解析器只处理上述两个键，不读取或输出其他 LevelDB 条目；模块探测显示没有可用的 `ccl_chromium_reader`、`plyvel`、`leveldb`、`snappy` 或 `cramjam`。WAL 文件系统修改时间早于其记录中的状态时间，因此不能用 mtime 判定数据先后；活动日志编号和 WAL 序列确认该记录已持久写入。WebView 的内存中仍可能存在比磁盘记录更新的状态。未发现应用唤醒诊断日志。

建议用 synthetic IPC 与临时 WebView profile 验证：模拟一个计划到期的账号，断言自动路径一次调用并记录新 reset；单独触发手动按钮，验证两者来源可区分；模拟 `invoke` 抛异常，断言退避生效；模拟 React state 更新延迟，确认新 reset 通过返回值而非旧 ref 写入。不要使用真实账号或网络唤醒请求。
