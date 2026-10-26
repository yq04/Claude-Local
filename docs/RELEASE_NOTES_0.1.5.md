<!--
[INPUT]: Versioned0.1.5 product capabilities and checked delivery records.
[OUTPUT]: Claude-Local0.1.5 user-facing release notes.
[POS]: Release series begins at0.1.0; GitHub publication labels and visibility are managed separately.
-->
# Claude-Local 0.1.5 · 界面精简与布局优化

精简快速配置、浏览环境、网络环境、身份管理和用量分析五页的重复说明；整理身份及用量工具栏，改善中英文窄屏换行。

保留全部操作、真实时区查询和TSV语义，延续0.1.4浏览器修复。README更新为隔离演示数据截图，不含真实账号、代理或本机路径。

## 项目来源

Claude-Local基于[CCBaga](https://github.com/liseami/CCBaga)二次开发并独立维护，保留原贡献者版权和适用许可。感谢上游提供的基础实现；本项目新增改动与发行由本仓库维护者负责，不代表上游或Anthropic的官方版本。详见[来源说明](PROJECT_ORIGIN.md)及[NOTICE](../NOTICE.md)。

## 资料与验证

应用ID、按用户的数据路径、加密归档与身份格式保持兼容；不通过强制结束运行中的Claude Code执行升级或验证。恢复创建新的私有副本，不覆盖活动身份库。

安装器、源码、SHA256、CI与实际验收范围见[交付核验](RELEASE_VERIFICATION_0.1.5_UI.md)。构建/解包审计不等同于真实安装/卸载验收，环境检查不证明账号消息权限。适用许可和来源见[LICENSE](../LICENSE)、[NOTICE](../NOTICE.md)及[分发说明](DISTRIBUTION.md)。
