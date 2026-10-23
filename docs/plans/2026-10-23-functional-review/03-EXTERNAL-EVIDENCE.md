<!--
[INPUT]: 固定公开源码、Chrome 官方文档、Claude 官方帮助及当前未提交工作区的对应调用点。
[OUTPUT]: 额度有效性与授权生命周期的外部证据卡，标明能支持及不能支持的结论。
[POS]: 本次功能复核的外部事实输入；不包含真实账号响应，不构成接口稳定性或运行验收承诺。
[PROTOCOL]: 公共源码事实与官方产品说明分别引用；不复制第三方产品实现，不升级为本机验证。
-->
# 外部资料复核与方案约束

日期：2026-10-23。获取方式：agent-reach 的 GitHub／gh 只读后端与 web／Jina Reader 后端。只访问公开源码和公开文档，没有使用用户 Claude 授权、Cookie 或账号接口。网络查询没有包含用户账号、邮箱、安装路径或凭据。

本文件的 X 编号是资料引用编号，不是证据等级。源码可证明第三方项目采用了某条通路，不能证明它是官方支持的公共 API，也不能证明本机账号当前有权限。本轮没有找到能保证这些内部额度端点长期稳定、统一限流额度或所有账号覆盖率的官方承诺。

## X-01：OAuth profile 与 usage 有公开实现先例

复核 TimeWinder-dk/ClaudeTimer 固定提交 `ddf542efdcf1c7fb208d0ec1e8c4820db9d4f440` 的 [ProfileApiResponse.cs](https://github.com/TimeWinder-dk/ClaudeTimer/blob/ddf542efdcf1c7fb208d0ec1e8c4820db9d4f440/src/ClaudeTimer/Models/ProfileApiResponse.cs#L5)。其模型明确声明根 `account` 与 `organization`；账号包含 `uuid`、`email`，组织包含 `uuid`。这为本项目 `validate_profile` 的字段检查提供了固定源码依据。

另复核 m13v/claude-meter 固定提交 `acef1aa48f39fdb0f8567313f6df8d0dd2fdf8aa` 的 [oauth.rs](https://github.com/m13v/claude-meter/blob/acef1aa48f39fdb0f8567313f6df8d0dd2fdf8aa/src/oauth.rs#L114)：136–145 行分别请求 `/api/oauth/usage` 与 `/api/oauth/profile`，147–155 行使用 profile 的组织 UUID 和邮箱，并明确订阅账单字段未通过相同 OAuth 通路暴露。

可支持：直接读取常规额度并校验身份有工程先例，不能因为没有网页账单资料就判定常规额度也不可查询。不能支持：profile 每个账号一定返回全部字段、本项目额外强制字段在全部订阅类型下均可用、某个固定刷新频率得到官方保证。本项目应保持严格账号归属检查，同时将“身份字段不完整”“未授权”“服务不可用”分别诊断，而非用一个不可用状态掩盖原因。

## X-02：静态归档授权不能自然变成长期免登录

同一 [oauth.rs 的模块说明](https://github.com/m13v/claude-meter/blob/acef1aa48f39fdb0f8567313f6df8d0dd2fdf8aa/src/oauth.rs#L1) 说明不自行轮换 refresh credential，由运行中的 CLI 维护授权；114–123 行还对过期状态给出恢复提示。此事实与本项目避免干扰共享 CLI 授权的边界一致，但它也直接说明：只保存一次 access credential，不能保证账号长期无人值守可查询。

本项目已改为由 profile 的实际响应判断授权是否仍有效，而不只信本地 expiresAt，这是对错误本地过期记录的可用性改善；它无法延长服务器已经撤销或真正过期的授权。后续功能计划应包含统一批次里的授权恢复队列、清楚的能力探针及按账号隔离的恢复流程。应先验证服务商实际提供的授权能力，不能预先承诺存在独立的只读 OAuth scope，不能复用或轮换正在运行的 CLI 的共享 refresh credential 来实现所谓自动恢复。

## X-03：usage 查询治理需要按服务反馈调整

复核 realiti4/claude-swap 固定提交 `c896cdd64829ae3a4e674cc520238dce13c0c847` 的 [oauth.py:397–427](https://github.com/realiti4/claude-swap/blob/c896cdd64829ae3a4e674cc520238dce13c0c847/src/claude_swap/oauth.py#L397)：固定 GET usage、Bearer、OAuth beta header、五秒超时和 Retry-After 分类。其 [451–457 行说明](https://github.com/realiti4/claude-swap/blob/c896cdd64829ae3a4e674cc520238dce13c0c847/src/claude_swap/oauth.py#L451) 提醒跨设备、不同授权或多种界面的请求可能竞争同一额度接口预算。这是该项目的实现经验，不是官方统一限流规范。

可支持：本项目共享账号级去重、尊重 Retry-After、错误退避有合理依据；同账号的两个别名不应发两次查询。不能支持：60 秒成功冷却或三分钟前台周期一定不会限流，也不能把单项目作者测量的小时次数上限套用到所有账号。后续应记录脱敏的请求阶段、来源、退避截止和成功观测时间，用实际服务响应调整调度，不能通过重登清除账号级退避。

## X-04：手动重置权益有独立语义和有效期

复核 Claude 官方 [What is a limit reset?](https://support.claude.com/en/articles/17007452-what-is-a-limit-reset)。文档说明：此类权益只会偶尔发给符合条件的方案；可能恢复五小时或周额度，不改变平时周重置时刻；存在有效期，降级或取消可能失去权益；使用入口在网页或 Desktop 的 Settings > Usage，终端／IDE 不提供相同按钮；不会退回已产生的 extra usage 费用或改变用量信用余额。

因此，自动额度窗口、手动重置次数、订阅扣款日期和 extra usage 必须保持不同字段。余额历史观测不能无限期当作仍有效的权益；产品应在拿到可信截止时间时显示有效期或标注该项需要刷新。本轮仅展示权益，没有理由新增消耗权益的动作。

## X-05：网页 grants 解析应兼容零余额，但不能推断未知为零

复核 tnunamak/clawmeter 固定提交 `17edf27e68d194724b9a6741b1c1dd3b10ca119c` 的 [extension/resets.js:55–74](https://github.com/tnunamak/clawmeter/blob/17edf27e68d194724b9a6741b1c1dd3b10ca119c/extension/resets.js#L55)。其实现区分 `cedar_ember` 缺失、明确不符合资格、grants 数组和剩余次数；正数余额才要求完整 paused/starts_at/ends_at，并按当前有效、未暂停权益合计。

当前项目 `src-tauri/src/browser/quota_bridge.rs` 对每个 grant 都读取 paused 和两项时间。这是源码可观察的差异；如果服务端为零余额 grant 省略这些字段，本项目会显示未知。真实返回形状未验证，因此此处是有公开先例支持的兼容性待验证项，不是已复现的真实账号故障。修复应为零余额、省略可选字段、格式变化及未知权限添加合成样例，不能为了获取数字而放宽账号／组织匹配。

Clawmeter 此处按组织处理的做法不适合作为本项目多成员账号归属依据。Claude-Local 当前额外验证账号 UUID、邮箱和组织指纹是必要保护，不能只因组织 ID 相同而合并账号。

## X-06：MV3 worker 会结束，测试要跨越真实浏览上下文

复核 Chrome 官方 [The extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)。官方列出的终止条件包括约30秒闲置、单请求超时和 fetch 长时间未得到响应；全局变量会在 worker 停止时丢失，应使用合适的存储并能在重启后恢复。

项目使用 `chrome.storage.session` 保存短期配对上下文，与该方向一致。当前 `scripts/test-quota-browser-bridge.mjs` 确实加载了固定 Chromium 的真实扩展 worker，并验证了真实扩展 Origin，但其配对由 `worker.evaluate` 直接调用，站点 content script 在 VM 中执行且网络为合成响应。因此它不能证明实际本地配对页面导航、Chrome content script 自动注入、网页登录跳转、挑战页面、worker 重启、Tauri 接收和 Python 提交的全流程可用。

建议以全新隔离资料、拦截的 HTTPS 合成站点和临时安装树增加一次真实浏览导航集成验证；未验证前只能称“worker 和投影通路合成验证通过”。无需用用户真实 Cookie 或实际切号来补这项测试。

## X-07：运行依赖和部署路径要与功能交付一起验收

本地代码交叉核对：`scripts/deploy-local.ps1` 当前只复制旧采集脚本，新增在线脚本与三份扩展资源未包含；正式 Tauri 资源映射则包含它们。该确认缺口详见 Q-01。另 `identities/online.rs` 在首个成功 spawn 的 Python 返回不可用后不会继续选择其他解释器；Python 缺少 cryptography、Windows 应用执行别名和 Explorer/终端不同 PATH 的影响，需要临时环境样例验证，不能靠开发机终端中的 Python 成功推断安装后的运行环境。

后续路线应给出单一受控资源清单、能力探针和用户可操作的错误原因。是否分发受控 Python runtime 应在体积、许可、维护成本与兼容性核实后决定；无需为此修改账号保险库或自动安装系统软件。

## 不作出的保证

本轮未证明真实账号端点权限、实时更新延迟上限、所有授权可恢复、所有网页登录资料可自动复用，也未验证 NSIS 安装／卸载。资料显示统一查询是可行方向，但“无需每次切 CLI 身份”与“永远无需重新授权”不是同一承诺。最终交付门槛应由可复现的资源、隔离、取消和端到端验收决定，而不是由引用数量决定。
