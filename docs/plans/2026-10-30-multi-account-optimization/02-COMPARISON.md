<!--
[INPUT]: Public primary documentation and pinned open-source files fetched read-only on 2026-10-30.
[OUTPUT]: Applicable design patterns, explicit non-applicable mechanisms and evidence limits.
[POS]: Implementation-pattern comparison; no third-party application or real account was exercised.
[PROTOCOL]: Keep repository owner and commit explicit; do not convert documentation examples into product security guarantees.
-->
# 公开资料与实现对比

读取日期：2026-10-30。`parallel-web` 所需CLI未安装，本轮使用标准HTTPS/GitHub REST读取公开资料，没有安装或认证工具。搜索和请求未发送真实账号、截图、内部路径或运行配置。

本比较针对资料组织、会话作用域、反馈交互和备份机制，不作产品安全排名。固定提交表示此次读取的源码，不代表对方最新版本；未观察到的功能保持未核实。

## 1. Chromium：资料分开与安全边界分开表达

来源：[user_data_dir.md，固定提交255504c](https://chromium.googlesource.com/chromium/src/+/255504c421a834aa37229aeb0ac9070a33b01e6b/docs/user_data_dir.md)，重点第7–11、115行；[Chrome官方profile帮助](https://support.google.com/chrome/answer/2364824?hl=en)。

资料目录包含历史、书签、Cookies和部分安装级状态，profile是其子目录，`--user-data-dir`可改变资料位置。Chrome帮助也说明，能使用设备的人可能切换profile查看信息。

本项目已经为账号保存独立资料目录和稳定seed，这是应保留的基础。应改进的是让用户分别看到资料归属、窗口状态和网页登录是否已证明，不能用“独立资料”概括操作系统隔离、独立出口或服务端安全。

不建议为视觉上的“隔离”复制Cookie、创建临时替代profile或重新生成既有seed。并行打开应继续使用该账号已有的私有资料。

## 2. Playwright：并行对象要有各自作用域

来源为固定提交 `018adb570c757898e7035f23e29ebb689d1d6ead`：

- [browser-contexts.md](https://raw.githubusercontent.com/microsoft/playwright/018adb570c757898e7035f23e29ebb689d1d6ead/docs/src/browser-contexts.md)，第12、75–90行：context分开cookies、localStorage、sessionStorage，并给出多用户示例。
- [class-browsertype.md](https://raw.githubusercontent.com/microsoft/playwright/018adb570c757898e7035f23e29ebb689d1d6ead/docs/src/api/class-browsertype.md)，第335–351行：同一User Data Directory不允许多个实例，自动化应使用独立目录。
- [network.md](https://raw.githubusercontent.com/microsoft/playwright/018adb570c757898e7035f23e29ebb689d1d6ead/docs/src/network.md)，第113–118行：代理另行按browser/context配置。

可借鉴的是“每个并行对象自带状态和目标”，以及用两个独立context做合成隔离测试。生产环境仍使用现有账号profile和指纹引擎，不能把Playwright示例直接改造成对真实用户网页登录的自动化。

Claude-Local当前的主要缺口在全局核验session及其上下文，而非缺少启动第二个Chrome进程的能力。并行方案必须覆盖token、report、票据、事件和生命周期；只增加窗口按钮不足以达成目标。

## 3. WAI-ARIA：状态、警告与日志分别承担不同职责

来源：[status](https://www.w3.org/TR/wai-aria-1.2/#status)、[log](https://www.w3.org/TR/wai-aria-1.2/#log)、[alert](https://www.w3.org/TR/wai-aria-1.2/#alert)、[APG Alert Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/)。

`status`适合非紧急状态，隐含polite与atomic，不应抢焦点。`log`表示按有意义顺序追加的信息。`alert`适合重要、通常有时效的信息，不宜把所有完成通知都升级为高强度打断。

可用于本项目的分工：短消息说明本次结果，进度表示任务仍在执行，展开后的记录供用户追溯。成功结果与错误都应有清楚的关闭入口；重要错误不要过早自动消失，键盘和屏幕阅读器用户应能访问关闭及查看记录。

标准没有规定日志必须落盘、保存多少天，也没有规定关掉日志要取消后台任务。这些是本项目需要自行明确的业务合同。

## 4. Radix：关闭呈现不等于取消业务

来源：[Toast官方文档](https://www.radix-ui.com/primitives/docs/components/toast)；固定提交 `eb3a2b7091293e27df8f9ba906632d8daa3d81a3` 的 [toast.tsx](https://raw.githubusercontent.com/radix-ui/primitives/eb3a2b7091293e27df8f9ba906632d8daa3d81a3/packages/react/toast/src/toast.tsx)，第430–446、854–865行。

Toast有独立Close和受控open/onOpenChange，关闭链路改变展示状态。这个模式适合修正本项目“结果保留只能靠切页清除”的问题。

无需因此整体替换现有Cromma/Radix组件或新建全局通知中心。先为已有操作记录和简短反馈增加受控可见性、关闭和恢复查看即可。必须另行保证：隐藏UI不释放原生锁、不取消请求、不丢失需要恢复的事务状态。

## 5. CCBaga：单身份便携导入可参考，浏览器完整备份不能据此宣称已有

复核历史固定提交 `bdfb90ceadfc5fae6772ffff597bddecb0b73cc3`：

- [portable.rs](https://raw.githubusercontent.com/liseami/CCBaga/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3/src-tauri/src/identities/portable.rs)，第18–19、118–123、170–177、373–409行：独立便携包标识、密码派生、同OS/路径校验、新建导入记录并以目标保险库密钥重封存，完成后当前身份未切换。
- [README](https://raw.githubusercontent.com/liseami/CCBaga/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3/README.md)，第106行：可选浏览器指纹设置不含Cookies、密码和代理设置。
- [identities.tsx](https://raw.githubusercontent.com/liseami/CCBaga/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3/src/identities.tsx)，第189、198、208–209行：关联标识、恢复入口及切号联动说明。

适合借鉴的是单账号密码保护导出、完整认证后导入新记录、导入不自动切号，以及清楚说明携带范围。不能把其便携包能力当成浏览器Cookie完整备份、跨机器可解密或每张保存卡都能独立打开浏览器的证据；后一个能力本轮尚未核实。

本项目已有整库加密备份和隔离恢复，应先复用其完整性/资源上限/新目标恢复原则，不重新实现相同底座。新增单账号便携包与全浏览器环境备份应分别设计，保留现有BAGAID01、.baga和SQLite v3兼容。

[LICENSE](https://raw.githubusercontent.com/liseami/CCBaga/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3/LICENSE)为MIT；[NOTICE](https://raw.githubusercontent.com/liseami/CCBaga/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3/NOTICE.md)另列Chromium和vendored UI边界。未来参考源码仍需保留适用归属，本研究未复制实现。

## 6. YOURSJEYO/claude-switcher：可参考状态表达，不移植切换方式

固定提交 `abfb2d718368f0cbbe4849d112e98afa457c1cab`：[windows/claude-switch.ps1](https://raw.githubusercontent.com/YOURSJEYO/claude-switcher/abfb2d718368f0cbbe4849d112e98afa457c1cab/windows/claude-switch.ps1)，第261–316行；[README](https://raw.githubusercontent.com/YOURSJEYO/claude-switcher/abfb2d718368f0cbbe4849d112e98afa457c1cab/README.md)；[LICENSE](https://raw.githubusercontent.com/YOURSJEYO/claude-switcher/abfb2d718368f0cbbe4849d112e98afa457c1cab/LICENSE)。

可证明的优点是显式报告当前账号与归档存在性。其Windows实现还包含强制停止Claude，以及删除重建活动目录的操作；这些方式与本项目保留运行中CLI、严格事务/恢复和资料保护要求不相容，不应移植。

这个仓库与本项目历史profile字段参考中的其他同名claude-switcher不是同一来源。功能、许可及平台行为均按完整owner/repo和固定提交分别判断。

## 7. 采用建议与证据限制

首批采用明确关闭、操作归属、字段级结果和已有profile的精确解析；后续再采用独立会话作用域及便携导入的设计原则。保留现有Python单写者和事务底座，不引入上游remote、同步、官方更新源或第三方应用依赖。

本轮没有真实账号横向测试、性能基准或第三方运行验收。公开代码的实现思路，不证明本机代理实际加载、账号授权可用或服务端不会触发限制。
