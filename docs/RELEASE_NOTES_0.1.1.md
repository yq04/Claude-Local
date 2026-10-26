<!--
[INPUT]: Versioned0.1.1 product capabilities and checked delivery records.
[OUTPUT]: Claude-Local0.1.1 user-facing release notes.
[POS]: Release series begins at0.1.0; GitHub publication labels and visibility are managed separately.
-->
# Claude-Local 0.1.1 · 登录状态同步修复

修复关闭自动续杯时账号就绪状态未同步、当前身份摘要丢失已有授权元数据，以及续杯面板重复提示和横向溢出。

本地登录与历史服务端拒绝分别展示；一次恢复许可仍保留429、共享间隔和未知请求保护。浏览器仅有未知项时显示检测未完成。此版本的短时WebRTC观察后来由0.1.4完善，建议使用最新版本。

## 资料与验证

应用ID、按用户的数据路径、加密归档与身份格式保持兼容；不通过强制结束运行中的Claude Code执行升级或验证。恢复创建新的私有副本，不覆盖活动身份库。

安装器、源码、SHA256、CI与实际验收范围见[交付核验](RELEASE_VERIFICATION_0.1.1_SYNC.md)。构建/解包审计不等同于真实安装/卸载验收，环境检查不证明账号消息权限。适用许可和来源见[LICENSE](../LICENSE)、[NOTICE](../NOTICE.md)及[分发说明](DISTRIBUTION.md)。
