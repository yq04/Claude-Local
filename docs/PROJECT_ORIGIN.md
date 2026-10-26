<!--
[INPUT]: CCBaga-derived baseline, verified repository modules, retained formats and attribution boundaries.
[OUTPUT]: Project lineage, local maintenance scope and evidence limits.
[POS]: Public provenance guide; not a declaration that every third-party asset is MIT-licensed.
[PROTOCOL]: Preserve original copyright and distinguish comparison references from an unverified historical fork point.
-->
# 项目来源、二次开发与维护边界

**Claude-Local 基于[CCBaga](https://github.com/liseami/CCBaga)二次开发，并由本仓库独立维护。** 感谢原维护者[@liseami](https://github.com/liseami)及[贡献者](https://github.com/liseami/CCBaga/graphs/contributors)提供的基础实现。独立维护不是“全部代码原创”，也不表示本项目是CCBaga或Anthropic的官方发布。

本项目的发行版本从0.1.0开始，当前公开版本见[README](../README.md)。本仓库负责自己的改动、问题反馈、安装包及版本说明，不接入CCBaga的自动更新端点、公钥或发布流水线，不自动同步上游代码。功能支持范围以本项目验证结果为准，目前发布Windows10/11 x64版本。

## 继承并保留的基础

- 身份归档的BAGAID01标识、.baga文件与AES-256-GCM认证分帧结构，见[codec.rs](../src-tauri/src/identities/codec.rs)。算法由标准密码库ring提供，不作为本项目自创算法宣传。
- Zstandard及旧gzip归档读取兼容，见[compression.rs](../src-tauri/src/identities/compression.rs)；身份快照的存储和恢复工作流以此为基础演进。
- SQLite身份目录及user_version=3、HMAC账号索引和稳定身份匹配规则，见[database.rs](../src-tauri/src/identities/database.rs)与[catalog.rs](../src-tauri/src/identities/catalog.rs)。HMAC用于账号索引，不把它误写为归档的加密算法。
- 按身份关联浏览器资料、历史种子派生规则与必要兼容字符串，见[browser_link.rs](../src-tauri/src/identities/browser_link.rs)及[浏览器模块](../src-tauri/src/browser/)。这些字符串保留是数据兼容需要，不代表运行时依赖另一应用。
- 既有桌面界面与复用组件基础；本项目对界面和工作流的修改不改变这些组件各自的版权归属。

## 本仓库维护和扩展的部分

- **额度与用量工作流**：默认被动读取本地CLI观测，Python作为quota账本单写者，明确触发的在线查询冻结并验证账号/组织；见[claude_quota.py](../scripts/claude_quota.py)、[online.rs](../src-tauri/src/identities/online.rs)及[claude_quota_online.py](../scripts/claude_quota_online.py)。
- **用量分析与导出**：Token、缓存、模型/Effort统计，IANA/DST日历区间和TSV导出；见[usage.rs](../src-tauri/src/identities/usage.rs)、[usage-statistics.tsx](../src/usage-statistics.tsx)及[usage-export.ts](../src/usage-export.ts)。
- **原生唤醒调度与监控**：应用进程内的唯一调度器、错峰和未知结果保护、新鲜5h窗口确认、有限审计，以及可选HUD；见[wakeup.rs](../src-tauri/src/identities/wakeup.rs)、[wakeup_audit.rs](../src-tauri/src/identities/wakeup_audit.rs)及[monitor_window.rs](../src-tauri/src/monitor_window.rs)。唤醒发送真实请求并产生用量，不会增加订阅额度。
- **全库口令备份与恢复校验**：CLBKUP01封装使用PBKDF2-HMAC-SHA256派生口令保护密钥，复用认证流并验收清单/SQLite/归档，恢复到新副本；见[backup.rs](../src-tauri/src/identities/backup.rs)。内部.baga保险库主密钥是既有随机密钥，不能把口令备份的派生机制写成所有归档的密钥来源。
- **Windows与存储可靠性**：AppContainer缓存ACL继承修复、私有暂存生命周期、归档资源限额、进程检查和显式操作恢复；见[private.rs](../src-tauri/src/identities/private.rs)、[profile.rs](../src-tauri/src/browser/profile.rs)、[archive_limits.rs](../src-tauri/src/identities/archive_limits.rs)及[cleaner_transaction.rs](../src-tauri/src/cleaner_transaction.rs)。这些是实现增强，不承诺任意环境均无损或绝对安全。
- **浏览器观测与交互**：有界无STUN本地候选测量、同IP分类补充、生产CSP回归、双语状态反馈与五页界面精简；见[浏览器修复](BROWSER_CSP_0.1.4.md)及[界面优化](UI_POLISH_0.1.5.md)。

以上列出当前可核对的维护范围，不以代码百分比划分作者，也不将继承能力重新标为本项目独创。

## 来源证据的边界

本仓库初始导入记录为167780a（2026-10-18）。[对比文档](CCBAGA_COMPARISON.md)所用bdfb90c（2026-10-19）是固定比较快照，**不是已证明的最初分叉点**；不能仅因部分文件一致就宣称整仓库精确源自该提交。除可核对的仓库链接和贡献者归属外，不推测作者的法律姓名、授权关系或贡献比例。

## 许可与第三方材料

原CCBaga贡献者的MIT声明与Claude-Local贡献者声明均保留在[LICENSE](../LICENSE)。[NOTICE](../NOTICE.md)列出浏览器、组件、图标和参考项目；顶层MIT不替代其他权利人的许可。Cromma复制子集、Pika取得范围及Chromium完整声明仍按[分发说明](DISTRIBUTION.md)核对，不将未核实写成已获授权或已证明违法。新增归属说明用于准确呈现来源，不单独构成第三方分发许可证明。
