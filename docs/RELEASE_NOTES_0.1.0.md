<!--
[INPUT]: Versioned0.1.0 product capabilities and checked delivery records.
[OUTPUT]: Claude-Local0.1.0 user-facing release notes.
[POS]: Release series begins at0.1.0; GitHub publication labels and visibility are managed separately.
-->
# Claude-Local 0.1.0 · 首个版本

Claude-Local 的首个发行版本，适用于Windows10/11 x64。提供加密身份备份与切换、默认被动额度观察、明确触发的在线查询、用量与Effort分析、自动续杯、悬浮监控窗及可选隔离浏览器。

网页额度查询与CLI唤醒授权分开处理；自动续杯由应用进程统一调度，需明确开启，保留错峰、限流和未知请求保护。只有新鲜可信的5h窗口才确认唤醒成功。网页登录不会更新CLI授权，主动唤醒会产生真实请求与用量。

## 资料与验证

应用ID、按用户的数据路径、加密归档与身份格式保持兼容；不通过强制结束运行中的Claude Code执行升级或验证。恢复创建新的私有副本，不覆盖活动身份库。

安装器、源码、SHA256、CI与实际验收范围见[交付核验](RELEASE_VERIFICATION_0.1.0.md)。构建/解包审计不等同于真实安装/卸载验收，环境检查不证明账号消息权限。适用许可和来源见[LICENSE](../LICENSE)、[NOTICE](../NOTICE.md)及[分发说明](DISTRIBUTION.md)。
