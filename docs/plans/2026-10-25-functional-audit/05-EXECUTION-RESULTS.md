<!--
[INPUT]: Owner-authorized Astra scheme execution, scoped source ownership and synthetic verification receipts.
[OUTPUT]: Actual implementation progress and remaining acceptance boundaries, separate from the original planning evidence.
[POS]: Execution record; personal account diagnostics and workstation/tool migration receipts stay in ignored .local/.
[PROTOCOL]: Record only completed work as complete; preserve identity formats, live sessions and independent delivery boundaries.
-->
# Astra 优化方案执行记录

日期：2026-10-25，America/New_York。用户已要求执行 [04 方案](04-ASTRA-OPTIMIZATION-PLAN.md)。基线为 `66ffd00`，现有 feature 分支和任务前工作树改动保留。

## 当前状态

1. 第一批：严格唤醒效果、新窗口返回、异常退避、持久化反馈与匿名审计。**complete**。
2. 应用级唯一原生调度与授权恢复。**complete**。
3. 浏览器完整指标、未知状态和测量范围。**complete**。
4. Effort 增量游标上下文。**complete**。
5. 开启前能力预检、逐账号控制和运行状态。**complete**。
6. 源码验证、候选管理与执行回执。**complete**；产品安装更新与发布未执行。

源码当时仍为开发快照，没有指定新发布版本或移动标签。当前安装版本与新源码候选分开判断，不能将本次测试视作新功能已经热更新。源文件清单与 SHA256 见 [06 源码候选](06-SOURCE-CANDIDATE.json)。

## 已实现的行为

**唤醒结果与失败说明。** Python/Rust 通过有界字段区分请求结果、额度观测与新 5h 窗口确认。只有同一冻结账号、未来的新 5h reset 且晚于目标过期 reset，才封存该周期。前端直接使用返回的新 reset，移除读取尚未 render 的旧 ref 路径。7d-only、cached 或结果不完整不算确认成功。返回的失败及 IPC 异常均有退避和尝试记录，已确认成功不因审计写入失败而降为网络未知。

**有限审计。** 原生私有 `wakeup-audit.json` 最多保留 200 项和 30 天，记录随机请求编号、触发类型、阶段、状态、时间及旧/新 reset。账号槽由独立审计域派生短值，不保存原账号 UUID、邮箱、指纹、代理、IP 或正文。读取前限长并验证旧条目，审计写入状态与额度结果分开；Python 仍是额度账本唯一写入者。

**进程级调度。** Tauri setup 持有唯一原生调度 owner，React 不再创建自动唤醒 timer。切页或隐藏到托盘不中断调度；实际退出进程后停止，不添加 Windows 服务或计划任务。手动和自动尝试共享预算、原生门禁与既有采集路径。配置和运行计划私有持久化，旧 localStorage 经过白名单迁移且原键保留；只有原生保存确认后界面才显示保存成功。新增账号集合会暂停自动范围，当前/保存槽位在相同账号集合内变化不扩大授权。

**未知与授权恢复。** 派发前先持久保存结果未知标记，崩溃后不立即重放 POST。同账号、独立 5h 观测时间足够新且 reset 有效的服务端被动锚点可解除未知并建立后续窗口跟踪；本地估算、旧观测或仅 7d 的全局时间不能解除。关闭自动功能后只可继续有限本地未知结果对账，不派发请求。授权失败保留阻断，明确恢复入口只允许一次受控尝试，不自动刷新 OAuth，不因等待时间到、切换总开关或普通 GET 成功就宣称 messages 授权已恢复。

**能力与控制。** 开启前复用无账号 Python/cryptography 能力探针，路由信息只投影为传输能力枚举，不通过 profile/usage/messages 请求做预检。面板显示最近尝试、下一计划、等待原因、逐账号暂停/恢复及存储失败；普通合成 fixture 默认没有隐藏调度 IPC。已运行的 CLI、已知周额度低于门限、时段和排除项等保护继续生效。

**浏览器证据。** 报告增加版本和固定指标 ID，缺失、旧版或未知结果不再整体通过；前后端未知语义对齐。运营商未被识别不再推成住宅/安全出口。WebRTC 仅表达无 STUN 的短时本地候选观察，构造异常、offer 失败和 300ms 超时返回未知；浏览器入口与 fakeRTC 测试共用实际采集器。音频项收窄为接口能力，不用默认采样率冒充测量，不新增外部 DNS/STUN 服务或 IP 风险画像请求。

**Effort 游标。** 独立 usage ledger 的 `files` 表附加 `effort` / `parser_version`，同一事务保存完整行 offset、guard、上下文和事件。正常增量继承上下文，截断/替换/guard 失效或跨文件时不继承。静止旧文件不全量重扫，仅在旧游标新增内容时回读紧邻 cursor 的 64KiB；窗口内没有档位声明则保持未知。未知保留在事件和模型总量中，不为测试改变原有档位聚合格式，也不猜为 high。身份库 `user_version=3`、账号归属、去重、归档和浏览器种子保持兼容。

## 范围

本轮允许源码实现与合成验证；不触发真实账号额度或唤醒请求，不切换身份、不修改真实授权/代理或系统环境、不停止运行中的 Claude 会话。产品构建安装、热更新及发布按方案与源码实施分开，不将旧安装回执算作新功能交付。

Agent Reach 更新是本轮用户单独授权的工具维护，不改变 Claude-Local 的运行依赖或发布流程；其机器级记录保存于私有任务目录，账号差异诊断也不写入公开文档。

## 验证回执

- `python scripts/test-claude-quota-online.py`：35 项通过。
- Bun 定向测试：在线额度模型 18、诊断 2、双语字典 5、浏览器核验 8、出口解析 4、实际 WebRTC 采集器 fakeRTC 3，共 40 项通过。
- `bun run build`：TypeScript 和 Vite 生产前端构建通过；有既存静态/动态导入 chunk 警告，不影响构建。
- 原生过滤 `identities::online::tests`：14 项通过；`identities::online::wakeup_audit`：1 项通过；`identities::wakeup`：14 项通过；`browser::tests`：18 项通过。
- 原生 `identities::usage_tests`：首次 27 项通过、1 项失败。新增测试错误假设未知档位有空聚合桶；修正为 SQLite 原始事件/游标与模型总量的直接断言后，该项单独重跑通过。未把两次结果写成一次 28/28，也未重复运行已通过项。
- 隔离 GUI：`--wakeup-only` 7 项、`--quota-reset-only` 8 项通过，覆盖迁移、保存失败、切页/返回、暂停和明确恢复。
- 最终范围内 `git diff --check` 通过；一处测试文件多余 EOF 空行已局部修正，没有为纯格式改动重跑测试。

全部使用合成账号、fake IPC/transport、fake RTC 或临时 SQLite/目录。本轮没有用历史 HANDOFF 测试冒充新候选验证，也没有跑个人机器上的系统修改测试。完整输出保存在忽略的私有任务目录。

## 遗留与设计偏差

**遗留验收。** 未执行真实账号查询/唤醒、真实授权恢复、Windows 睡眠/唤醒及退出运行验收，也未构建发布宿主、更新本机安装、打包 NSIS、推送或发布。已有授权失败不能通过软件优化凭空恢复，仍需要账号持有人在官方入口处理，再通过明确恢复路径尝试。

**设计取舍。** 未确认独立出口的账号统一使用共用路由 6–13 分钟间隔，每次真实尝试只抽样一次并持久保存；不再仅凭代理字符串存在就采用原来的 2.5–5.5 分钟档。旧迁移中无法恢复的随机间隔保守按上界处理。未知结果保守冻结，只有合格被动证据可以解除；不承诺跨崩溃网络 exactly-once。Windows 产品的本地时段已实现，其他平台的时段保护保守处理且未作运行验收。可选本地通知与成本估算未添加。

**交付状态。** 本轮交付为通过定向验证的本地源码候选与执行记录。Agent Reach 工具已实际升级到 1.6.0；它的升级不是 Claude-Local 产品安装更新。
