<!--
[INPUT]: Versioned0.1.4 product capabilities and checked delivery records.
[OUTPUT]: Claude-Local0.1.4 user-facing release notes.
[POS]: Release series begins at0.1.0; GitHub publication labels and visibility are managed separately.
-->
# Claude-Local 0.1.4 · 浏览器核验完整修复

保留WebRTC构造后独立5秒协商/2秒候选收集，以及严格校验同IP的分类补充；精确补齐生产CSP所需的IPQuery HTTPS域名。

页面回归使用生产网络策略，覆盖成功、限流和IP错配；未知不强制通过。更新后从主软件浏览环境重新打开实测页，无需清Cookie、换代理或重登CLI。

## 资料与验证

应用ID、按用户的数据路径、加密归档与身份格式保持兼容；不通过强制结束运行中的Claude Code执行升级或验证。恢复创建新的私有副本，不覆盖活动身份库。

安装器、源码、SHA256、CI与实际验收范围见[交付核验](RELEASE_VERIFICATION_0.1.4_BROWSER.md)。构建/解包审计不等同于真实安装/卸载验收，环境检查不证明账号消息权限。适用许可和来源见[LICENSE](../LICENSE)、[NOTICE](../NOTICE.md)及[分发说明](DISTRIBUTION.md)。
