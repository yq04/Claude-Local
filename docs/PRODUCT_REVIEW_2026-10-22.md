<!--
[INPUT]: Claude-Local 0.1.6 source, pinned public repository evidence and isolated defect reproductions.
[OUTPUT]: Evidence-based adoption decisions, verified source fixes and prioritized user-experience proposals.
[POS]: Product research record; published 0.1.6 remains the baseline and this round's source changes are not deployed.
[PROTOCOL]: Separate existing behavior, verified defects and proposed features; preserve attribution and data boundaries.
-->
# Claude-Local 产品调研与改进建议

执行进度：用户已授权执行本报告建议，六项功能已完成源码实现与针对性验证，正在纳入0.1.7交付。具体功能见 `docs/RELEASE_NOTES_0.1.7.md`，实际安装/CI/发布状态以 `HANDOFF.md` 最新记录为准。下文保留调研时点的比较与建议，不能把原先“尚未实现”的状态当作当前实施进度。

日期：2026-10-22。基线为已安装、已发布的 0.1.6；本轮新增修复尚未提交、打包或部署。调研通过 GitHub API、README 和固定提交的源码/测试交叉核对，比较行为及适配成本，不按星数直接判定质量，也未复制第三方代码或引入新运行时依赖。

本轮建议优先提高可诊断性和身份定位效率。现有加密身份库、逐窗额度证据、请求级去重与增量账本继续作为基础；先让用户看得懂状态、遇到失败可恢复，再逐步增加快捷操作。

## 已确认并修复的问题

### 异常百分比被解释为真实额度

在合成 statusLine 数据中，把 `used_percentage` 写成时间戳量级的大数，旧代码会将它截成 100% 已用；负数会截成 0%，布尔值也会被当作数值。Python 默认接受的 NaN/Infinity 会在转整数时抛错，导致本轮采集中止。同样的问题存在于原生缓存/账本锚点的读取路径。

现已在 Rust 与 Python 的入口验证观测百分比，再进行估算或合并：拒绝异常大数、负数、非有限数和布尔值；保留正常数值，对 100–101 的轻微超出兼容为 100。Python 保留旧格式合法数值字符串的兼容读取。坏窗口不伪装成满额或耗尽，另一窗的合法数据仍可使用；写入前复制并过滤异常锚点，避免把 NaN 带入持久化 JSON，也不修改原缓存对象。

额度摘要版本升至 7，使旧摘要从原始证据惰性回填；SQLite `user_version=3`、归档、HMAC、账号/组织隔离、原观测时间和 Python 唯一写入者不变。`reset_inferred` 继续明确表示本地预计恢复，缺失 rate_limits 不作为删除静默账号证据的理由。

验证：先在旧代码上复现误报与异常，再通过 Rust core 8 项、profile quota regression 15 项、Python 34 项（含新 debug Rust 子进程与持久化往返）。输入校验思路参考 Usage-Monitor 的 `official.py`，但未据其源码注释就断言本机发生了对应上游 issue。

### CLI 读取失败后没有就地恢复入口

旧版首次 `claude_cli_read` 失败时，`status=null`，界面误显示“未安装”，检查/更新按钮均被禁用；用户只能离开页面再回来重试。

现已将状态读取错误与检查/更新错误分别保存：读取失败显示“状态不可读”及“重试读取状态”，读取期间禁用重复操作，成功后恢复版本和检查入口。更新失败后的状态重读不会吞掉原操作错误。中英文假 IPC 用例同时验证旧版基线和修复后的恢复路径，未调用真实 CLI 更新或系统操作。

### 统计说明与实际筛选范围不一致

双语统计口径和开发文档仍写着“未归属历史单列”，但界面已经只有“全部”和已保存账号。已纠正为实际规则：“全部”汇总可归属的已保存账号记录；未确定归属的历史，仅在用户明确配置的稳定兜底账号适用时计入该账号。内部未归属计数仍保留，不恢复已移除的筛选入口，不自动猜测归属。

Bun 额度/双语 12 项、TypeScript/Vite 生产构建均通过。以上是源码级修复，本轮没有重启或替换已安装的 0.1.6。

## 开源参考与采纳判断

### ccusage/ccusage：复杂日志解析与去重

许可证 MIT。核对源码提交 `06a3343369c026e7e199aa4fa495bd730a0e17c4`，调研时发布版 v20.0.40。其跨文件请求去重、sidechain 回放处理和父/子会话分组可作为回归样本来源。

本产品已有跨文件请求去重、完整行游标、账本索引及小时/日统计，不能将这些已有能力再包装成新增功能。并查集分组剪枝只作为后续扫描优化研究，尚未证实本项目需要该算法修复重复计数。

依据：[会话路径与分组](https://github.com/ccusage/ccusage/blob/06a3343369c026e7e199aa4fa495bd730a0e17c4/rust/adapters/claude/src/paths.rs)、[日统计](https://github.com/ccusage/ccusage/blob/06a3343369c026e7e199aa4fa495bd730a0e17c4/rust/adapters/claude/src/daily.rs)。

### Claude-Code-Usage-Monitor：观测校验与新鲜度

许可证 MIT，源码提交 `c59a83bf943f329f0e61f1a29c760353ee1860a5`，发布版 v4.0.0。已吸收其“先验证观测值，再把它当可信百分比”的防御思路，并通过本项目自己的合成用例确认和修复缺陷。

其新鲜度标记适合进一步设计额度诊断；到期直接置空、缺少 rate_limits 就写清除记录的策略不直接用于本产品，因这里还要保留静默账号的逐窗证据与明确预计恢复。

依据：[official.py](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/c59a83bf943f329f0e61f1a29c760353ee1860a5/src/claude_monitor/output/official.py)。源码注释提到的上游 issue 仅作为注释来源，本轮未独立验证其上游触发条件。

### sirmalloc/ccstatusline：小组件与消耗速率

许可证 MIT，源码提交 `bed850187783904a9affcaba1dd80e967622e70b`，发布版 v2.2.32。值得参考的是组件化状态、未知值处理和消耗速率的最小采样窗口。

消耗速率可先考虑 Token/分钟；美元/小时需要明确计价版本与“API 等价估算”含义，不能把订阅额度估算显示成真实账单。其主动 OAuth 查询方式不引入本产品。

依据：[SessionCostRate](https://github.com/sirmalloc/ccstatusline/blob/bed850187783904a9affcaba1dd80e967622e70b/src/widgets/SessionCostRate.ts)、[BlockResetTimer](https://github.com/sirmalloc/ccstatusline/blob/bed850187783904a9affcaba1dd80e967622e70b/src/widgets/BlockResetTimer.ts)。

### Haleclipse/CCometixLine：终端呈现降级

许可证 MIT，源码提交 `586e624679f9385d52300b1ff4b121a9dfdeec78`，发布版 v1.1.2。ANSI 可见宽度与字体图标降级适用于未来的可选终端输出。本产品桌面界面已经由 DOM 布局处理宽度，因此不为该能力引入额外桌面依赖。主动用量轮询和修改 CLI 二进制不采纳。

依据：[statusline.rs](https://github.com/Haleclipse/CCometixLine/blob/586e624679f9385d52300b1ff4b121a9dfdeec78/src/core/statusline.rs)。

### farion1231/cc-switch：可检索的管理列表

许可证 MIT，源码提交 `e4873bc8aa2555225d4867ec2f04b1290f1d21d9`，发布版 v4.0.18。受控搜索、Esc 清空和长列表测试很适合本产品的多身份卡片。可独立实现轻量搜索，账号数量较少时不必引入虚拟列表库。

依据：[搜索测试](https://github.com/farion1231/cc-switch/blob/e4873bc8aa2555225d4867ec2f04b1290f1d21d9/tests/components/ManagementListSearch.test.tsx)、[会话管理规范](https://github.com/farion1231/cc-switch/blob/e4873bc8aa2555225d4867ec2f04b1290f1d21d9/session-manager.md)。不引入远端凭据托管或自动应用更新依赖。

### hotovo/aider-desk：命令入口与焦点恢复

许可证 Apache-2.0，源码提交 `ca4001e8a4dcc71d0e68b9e17c85f34bb33d4f06`，发布版 v0.88.0。命令面板的键盘导航、焦点恢复和行为测试可用于统一页面入口。选中身份后只打开既有确认流程，任务锁和危险确认继续生效。

依据：[CommandPalette](https://github.com/hotovo/aider-desk/blob/ca4001e8a4dcc71d0e68b9e17c85f34bb33d4f06/src/renderer/src/components/common/CommandPalette/CommandPalette.tsx)、[键盘/焦点测试](https://github.com/hotovo/aider-desk/blob/ca4001e8a4dcc71d0e68b9e17c85f34bb33d4f06/src/renderer/src/components/common/CommandPalette/__tests__/CommandPaletteContent.test.tsx)。本产品不需要为此引入在线模型编排、向量库或自动 Git 合并。

### YishenTu/claudian：时间分组与结构化便笺

许可证 MIT，源码提交 `55c4481fb328de9ee4a94269f0dc852b446cf349`，发布版 2.3.28。时间分组及本地快照的结构值得参考。源码中未确认的收藏/置顶能力不作为该项目已有事实；本产品未来收藏功能是自己的产品建议。

依据：[SessionListOrganizer](https://github.com/YishenTu/claudian/blob/55c4481fb328de9ee4a94269f0dc852b446cf349/src/features/chat/session-manager/SessionListOrganizer.ts)、[快照格式](https://github.com/YishenTu/claudian/blob/55c4481fb328de9ee4a94269f0dc852b446cf349/src/features/chat/session-messaging/formatSessionSnapshot.ts)。不引入笔记同步或跨会话常驻消息服务。

## 建议的实施顺序

以下为建议，均尚未实现。成本“小/中”为按现有代码判断的相对工作量，不是承诺工期。

**P1：身份检索与少量排序（成本小）。** 先支持保存别名搜索、Esc 清空、名称/最近保存排序，保持原生身份顺序与事务不变。邮箱检索应服从隐私模式，不因搜索结果泄露被隐藏身份；180×286 工牌保持原尺寸。虚拟化、复杂标签和收藏可在账号数量确有需要时再扩展。

**P1：额度新鲜度与采集健康说明（成本中）。** 在现有额度入口提示观测时间和来源，区分“配置存在”“脚本已随包”“运行时未验证”和“最近收到实际数据”。复用现有详情，避免增加整页重复状态。提供可复制的白名单诊断摘要，只含版本、时间、来源、状态码/计数，不输出凭据、原始 statusLine、账号正文或个人路径。

**P2：Ctrl+K 操作入口（成本中）。** 先覆盖页面跳转、手动刷新和打开身份确认；输入框、模态框和运行中的任务锁要有明确快捷键规则。回车不直接执行切号或清理，也不改变确认逻辑。

**P2：手工任务交接模板（成本小至中）。** 将仓库已有交接设计落实为用户填写的目标、已完成、下一步、验证结果和约束模板，预览后复制或保存。初版不读取会话正文，git 文件统计也不能自动写成“已完成验证”。

**P2：聚合统计复制/导出（成本小至中）。** 优先复用剪贴板复制当前筛选的表格数据，遵循隐私遮罩，并带上统计时间与覆盖范围。导出只包含已展示的聚合，不附带原始会话或请求正文。

**P2：历史夏令时归组校正（成本中）。** 当前按查询时的固定 UTC 偏移归组历史，跨夏令时边界存在已知限制。应单独设计逐事件时区归组与边界 fixture，不把前端补零当成已修复历史时区问题。

## 交付边界

本轮已完成调研、两类软件缺陷修复和统计说明修订；本机安装版与 GitHub 发布版仍为 0.1.6。较大的新功能只形成优先级建议，没有暗中改变采集频率、账号切换、设置、浏览器资料或发布流程。测试均使用合成数据和隔离上下文，未中断运行中的 Claude 会话。
