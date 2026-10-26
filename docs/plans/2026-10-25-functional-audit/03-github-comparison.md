<!--
[INPUT]: Public GitHub source at six pinned commits, repository license text, and source-backed local findings.
[OUTPUT]: Verified implementation comparisons, applicability limits and evidence-based recommendations for the Astra scheme.
[POS]: Documentation-only functional audit; public code was read but not executed, cloned into the product or vendored.
[PROTOCOL]: Separate external implementation facts, local bugs and unverified leads. Private runtime data is excluded.
-->
# GitHub 开源机制对比与适用边界

日期：2026-10-25，America/New_York。使用 `agent-reach` 的 GitHub / `gh` 只读后端；所列提交为本轮读取的固定版本，不保证是以后查询时的最新 HEAD。未执行第三方代码、修改远端或向外部查询发送本机账号信息。

调研先关注多账号/额度工具，再对照本项目已经确认的问题；没有以“别人有这个功能”推断本项目存在 bug。本地缺陷及复现以 [02](02-functional-findings.md) 为准，采用顺序以 [04](04-ASTRA-OPTIMIZATION-PLAN.md) 为准。

## 1. 检索与核验方法

先核验仓库身份、可读源码路径与许可证，再用 GitHub contents API 指定 `?ref=<完整SHA>` 读取源码，检查实际函数、条件和返回值。许可证 API 的机器识别值与正文不一致时，保留两者，不凭 API 标签断定许可不存在。

可复用的只读命令形态：

```powershell
gh search repos "Claude usage monitor" --limit 10
gh api repos/realiti4/claude-swap
gh api 'repos/realiti4/claude-swap/contents/src/claude_swap/poll_policy.py?ref=042a36b673d51f4bf990b04f903aee02f1ab07e1'
gh api repos/ccusage/ccusage/license
```

源码事实只能说明对应版本采用了某机制；项目注释中的服务测量是该作者经验，不是服务商公共契约。社区 Issue 也不自动成为本项目的已证缺陷。本轮没有执行这些项目，也没有验证它们在本机真实账号上的效果。

## 2. 六个项目及具体可借鉴机制

### GH-01 · realiti4/claude-swap：服务反馈驱动的退避

固定提交：`042a36b673d51f4bf990b04f903aee02f1ab07e1`。许可证：MIT；保留原作者版权及许可条件。

**已读取的实现：**

- [poll_policy.py:259](https://github.com/realiti4/claude-swap/blob/042a36b673d51f4bf990b04f903aee02f1ab07e1/src/claude_swap/poll_policy.py#L259) 根据新额度、既往状态和最近 429 调整间隔；[261–276](https://github.com/realiti4/claude-swap/blob/042a36b673d51f4bf990b04f903aee02f1ab07e1/src/claude_swap/poll_policy.py#L261) 扩大限流后的间隔，并用有限抖动计算下次时间。
- [oauth.py:411](https://github.com/realiti4/claude-swap/blob/042a36b673d51f4bf990b04f903aee02f1ab07e1/src/claude_swap/oauth.py#L411) 的 `_classify_usage_error` 区分 HTTP 错误并提取数字形式 Retry-After；[440](https://github.com/realiti4/claude-swap/blob/042a36b673d51f4bf990b04f903aee02f1ab07e1/src/claude_swap/oauth.py#L440) 的日志函数接受 context、错误分类与重试信息。
- [profile 解析:265](https://github.com/realiti4/claude-swap/blob/042a36b673d51f4bf990b04f903aee02f1ab07e1/src/claude_swap/oauth.py#L265) 独立获取 profile 并检验账号字段，是“凭据归属与额度结果分开处理”的参考。

**对应本项目：** W04 的 throw 路径应纳入同一失败治理；W05/W06 应保留失败阶段、分类和恢复条件。借鉴“基于明确返回结果计算计划”，不要求采用对方周期或参数。

**限制与不采用部分：** 文件开头关于每小时约 28–30 次的文字是作者特定时间/账号的测量，不能称为官方硬限制，也不能据此保证三分钟一次安全。该文件不证明本项目 React 旧 ref 的根因；那个结论来自本地源码和运行证据。这里也没有证据证明对方已实现 `stage="profile"|"usage"` 的统一 JSON 诊断契约，Claude-Local 应独立设计自己的有界阶段枚举。不引入对方账号自动轮换、凭据刷新或持续 usage 轮询。

### GH-02 · leeguooooo/claude-code-usage-bar：失败缓存与显示/计算解耦

固定提交：`b801a87c0bceeb4a5f255187067d3cc060b166f6`。许可证：MIT。

**已读取的实现：**

- [daemon.py:22](https://github.com/leeguooooo/claude-code-usage-bar/blob/b801a87c0bceeb4a5f255187067d3cc060b166f6/src/claude_statusbar/daemon.py#L22) 区分较重数据计算和较轻渲染；[27](https://github.com/leeguooooo/claude-code-usage-bar/blob/b801a87c0bceeb4a5f255187067d3cc060b166f6/src/claude_statusbar/daemon.py#L27) 明确通过兄弟临时文件和 `os.replace` 原子发布。实际渲染写入调用见 [524](https://github.com/leeguooooo/claude-code-usage-bar/blob/b801a87c0bceeb4a5f255187067d3cc060b166f6/src/claude_statusbar/daemon.py#L524)。
- [ip_risk.py:21](https://github.com/leeguooooo/claude-code-usage-bar/blob/b801a87c0bceeb4a5f255187067d3cc060b166f6/src/claude_statusbar/ip_risk.py#L21) 定义失败 TTL 和在途有效期；[60–99](https://github.com/leeguooooo/claude-code-usage-bar/blob/b801a87c0bceeb4a5f255187067d3cc060b166f6/src/claude_statusbar/ip_risk.py#L60) 为成功与失败使用不同新鲜度规则，并在失败缓存仍有效时避免立即刷新。

**对应本项目：** W04/W06 可采用“失败也是带有效期的明确状态”；W02 可借显示与任务所有权解耦。Claude-Local 已有 Python 账本锁和原子替换，不应把这一已有能力重列为缺失；新增审计和调度状态复用同样的受控发布思路。

**限制与不采用部分：** 这是 IP 风险探针的失败缓存，不能说它已经覆盖本项目 Tauri IPC 的所有异常。五分钟是该项目参数，不直接成为本项目统一要求。不引入第三方常驻 Python daemon、额外 IP 画像服务或隐式探测；本项目的原生应用级调度仍仅在应用运行时有效。

### GH-03 · ccusage/ccusage：保留去重与成本口径的独立性

固定提交：`b40f51149d117e7c01b5f92466bae44e39c66a10`。`ryoppippi/ccusage` 的 API 请求会重定向到 `ccusage/ccusage`。GitHub License API 返回 `NOASSERTION`，但根 [LICENSE](https://github.com/ccusage/ccusage/blob/b40f51149d117e7c01b5f92466bae44e39c66a10/LICENSE) 正文为 MIT，Copyright 2025 ryoppippi。

**已读取的实现：**

- [Claude adapter:40](https://github.com/ccusage/ccusage/blob/b40f51149d117e7c01b5f92466bae44e39c66a10/rust/adapters/claude/src/lib.rs#L40) 定义 `DedupeIndex`，从 [155](https://github.com/ccusage/ccusage/blob/b40f51149d117e7c01b5f92466bae44e39c66a10/rust/adapters/claude/src/lib.rs#L155) 读取文件，并维护去重索引。
- [219–259](https://github.com/ccusage/ccusage/blob/b40f51149d117e7c01b5f92466bae44e39c66a10/rust/adapters/claude/src/lib.rs#L219) 结合 message/request/session/timestamp 查找重复，并专门识别 sidechain 重放。这说明读取性能优化不能牺牲不同日志副本的重复计数规则。
- [cost.rs:40](https://github.com/ccusage/ccusage/blob/b40f51149d117e7c01b5f92466bae44e39c66a10/rust/crates/ccusage-core/src/cost.rs#L40) 的 `CostMode::Auto` 优先用已有 `cost_usd`，缺失时按 Token 和价格表估算。它处理的是成本来源，不是 Effort 继承。

**对应本项目：** U01 的修复应让游标与必要上下文保持一致，同时保留本项目现有 message/request 哈希去重、sidechain 规则和账号归属。可用完整首次扫描与增量扫描结果相等作为直接验收条件。

**限制与不采用部分：** 已读文件没有提供可直接照搬的 Effort 游标恢复方案，不能把 DedupeIndex、并行读文件或 CostMode 称为已解决 Effort 继承。也没有理由仅据该参考把本项目主键改成 `(session_id,request_id)`、更换全部扫描单位或无条件全量重扫。若以后增加价格估计，要明确它与订阅额度、实际账单不同；本轮不加成本功能。

### GH-04 · farion1231/cc-switch：显式操作报告与受控补丁

固定提交：`e8e1cfbff4f2d93f2d6c4ba4ad10b511e012c733`。许可证：MIT。

**已读取的实现：** [claude_direct.rs:52](https://github.com/farion1231/cc-switch/blob/e8e1cfbff4f2d93f2d6c4ba4ad10b511e012c733/src-tauri/src/services/provider/claude_direct.rs#L52) 根据前后 provider 投影构造 `direct_patch`；[73–88](https://github.com/farion1231/cc-switch/blob/e8e1cfbff4f2d93f2d6c4ba4ad10b511e012c733/src-tauri/src/services/provider/claude_direct.rs#L73) 通过 `AppWrite::begin`、`FileChange` 和 `OperationReport` 组织一次受控操作。

**对应本项目：** W01/W03/W06 可以借鉴“一次操作有明确输入、已提交结果和报告”的契约，前端消费确定返回值，不猜异步 UI 状态。这里只借操作组织方式，不能仅凭调用处证明其所有下层原子性、ACL 或回滚保证。

**限制与不采用部分：** cc-switch 的 provider/API 配置切换不等同本项目的订阅身份、归档和浏览器槽位。社区关于 env 热重载与 CLI 锁的讨论仅作为以后兼容性研究线索；本轮未证明本项目已有相同缺陷，不把它列入已证 bug，也不建议未经本地验证就把所有 env 键置空、修改官方锁协议或绕过运行中进程门禁。本轮不触碰真实 settings、凭据或 CLI 进程。

### GH-05 · m13v/claude-meter：显示观测来源并尊重服务返回

固定提交：`acef1aa48f39fdb0f8567313f6df8d0dd2fdf8aa`。许可证：MIT。

**已读取的实现：**

- [oauth.rs:114](https://github.com/m13v/claude-meter/blob/acef1aa48f39fdb0f8567313f6df8d0dd2fdf8aa/src/oauth.rs#L114) 对本地已过期授权给出引导；[136–150](https://github.com/m13v/claude-meter/blob/acef1aa48f39fdb0f8567313f6df8d0dd2fdf8aa/src/oauth.rs#L136) 分别读取 usage/profile，展示组织和账号信息。
- [177–197](https://github.com/m13v/claude-meter/blob/acef1aa48f39fdb0f8567313f6df8d0dd2fdf8aa/src/oauth.rs#L177) 仅在 HTTP 429 时解析秒数形式 Retry-After，再把重试信息传给上层。

**对应本项目：** W05/W06 应让用户知道授权失败、等待和观测时间；W04 应尊重已核验的服务重试要求。保留明确的 HTTP 分类，不能用一个通用错误掩盖所有原因。

**限制与不采用部分：** 不抄其读取钥匙串/Cookie、原始响应片段日志或仅凭本地 expiresAt 拒绝请求的策略。本项目已经采用 profile 实际校验，不能因外部工具有本地过期检查而倒退。该项目也不能证明服务商提供了本项目可使用的长期独立只读授权。

### GH-06 · TimeWinder-dk/ClaudeTimer：Profile 字段与失败语义的参考

固定提交：`ddf542efdcf1c7fb208d0ec1e8c4820db9d4f440`。许可证：AGPL-3.0。此处只阅读接口投影与错误处理；本方案不复制源码、不引入依赖。如以后拟引入，须单独核对许可义务及与现有分发方式的相容性。

**已读取的实现：** [ClaudeUsageClient.cs:21–36](https://github.com/TimeWinder-dk/ClaudeTimer/blob/ddf542efdcf1c7fb208d0ec1e8c4820db9d4f440/src/ClaudeTimer/Services/ClaudeUsageClient.cs#L21) 调用 profile；当 Account.Uuid 缺失时抛出错误，之后把邮箱和可选组织字段投影到账号模型。

**对应本项目：** 可佐证 profile 是独立的身份检查环节，缺少关键账号字段应有明确失败。本项目的冻结账号、邮箱/组织匹配与提交复核仍以自身更严格契约为准。

**限制与不采用部分：** 此函数将 Organization.Uuid 作为可选字段，并未强制组织 UUID 非空，不能声称它证明了本项目全部组织强校验规则。其公开实现也不是服务商支持承诺，不适用于解释浏览器 WebRTC、DNS 或住宅 IP 真实性。

## 3. 如何映射为本项目优化

1. **首先修 W01/W03/W04/W06 和 C01。** 返回已提交的新窗口结果，保留明确错误阶段，给 throw 也记录退避及尝试。成功不由 React render 时机或一个通用 updated 推断。外部参考为 GH-01/GH-02/GH-04/GH-05；参数由本项目契约和合成验收决定。
2. **随后修 W02/W05。** 调度所有权与显示解耦，应用内只保留一个发起者，定义授权恢复门禁。外部 daemon 是结构参考，本方案不增加应用退出后的后台服务，不自动刷新凭据或开启轮询。
3. **修 B01/B02 的未知误绿。** 此结论来自本地真实核验函数的合成复现，不靠上述额度工具证明浏览器安全。先让未知可见、收窄测量结论，不直接增加外部 IP 欺诈评分或 STUN 网络服务。
4. **修 U01 时保留现有记账证据。** GH-03 的价值在去重、重放与成本口径分离，不是现成 Effort 方案。实际修复为游标上下文一致性，验收增量与完整扫描的档位一致，保留账号和 Token 计数。
5. **最后再做能力预检、逐账号暂停与本地通知。** 它们依赖前面的正确状态和安全投影；不因为参考工具功能多就照搬整个架构。

## 4. 明确不成立的推论与边界

没有证据支持“随机延迟、CLI 请求头或住宅出口可以消除封禁风险”。没有把作者测量的请求次数当作官方统一上限。没有把一个 JSONL 成本估算模式当成 Effort 恢复，更没有据此建议替换当前主键或清空账本。

没有确认本项目存在 cc-switch 社区讨论中的 env 热重载或锁竞态；这类讨论是候选研究，不是本轮修复依据。没有使用外部工具宽松的 profile 校验削弱本项目账号/组织绑定。

MIT 项目如以后实际复制代码，需要保留对应版权与许可；单纯阅读和独立实现机制不等于已经解决本项目全部第三方许可问题。AGPL 项目保持阅读参考，不引入产品。既有 UI、图标、Chromium 的分发边界继续由仓库规范约束。本轮没有新增依赖、运行任何第三方实现或改变发行方式。

## 5. 工具环境

本轮 GitHub 读取使用现有 `gh`，通过 agent-reach GitHub 路由。只读版本检查显示 Agent Reach 当前 v1.5.0、可用 v1.6.0，未进行安装或更新。若以后要更新，可使用维护者说明：<https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/update.md>。这与 Claude-Local 功能修复无依赖。
