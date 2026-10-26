<!--
[INPUT]: Versioned0.1.3 product capabilities and checked delivery records.
[OUTPUT]: Claude-Local0.1.3 user-facing release notes.
[POS]: Release series begins at0.1.0; GitHub publication labels and visibility are managed separately.
-->
# Claude-Local 0.1.3 · 浏览器核验实现记录

引入WebRTC分阶段计时和同IP机房分类补充，保留无STUN和UDP隐私保护。

**已知限制：该版本生产核验页CSP遗漏新增分类域名，补充查询仍会被拦截。0.1.4已修正；请使用0.1.4或更新版本。** 本条保留该发行记录的真实边界，不将其当作完整浏览器修复验收。

## 资料与验证

应用ID、按用户的数据路径、加密归档与身份格式保持兼容；不通过强制结束运行中的Claude Code执行升级或验证。恢复创建新的私有副本，不覆盖活动身份库。

安装器、源码、SHA256、CI与实际验收范围见[交付核验](RELEASE_VERIFICATION_0.1.3_BROWSER.md)。构建/解包审计不等同于真实安装/卸载验收，环境检查不证明账号消息权限。适用许可和来源见[LICENSE](../LICENSE)、[NOTICE](../NOTICE.md)及[分发说明](DISTRIBUTION.md)。
