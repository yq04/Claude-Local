<!--
[INPUT]: Versioned0.1.2 product capabilities and checked delivery records.
[OUTPUT]: Claude-Local0.1.2 user-facing release notes.
[POS]: Release series begins at0.1.0; GitHub publication labels and visibility are managed separately.
-->
# Claude-Local 0.1.2 · 加密存储兼容加固

完善备份验证暂存目录的生命周期和异常清理、归档解包资源限制、敏感缓冲管理及有界密钥读取。

保留.baga/BAGAID01/CLBKUP01和既有密码学参数、密钥、账号ID、HMAC及浏览器种子；不要求迁移或重新加密已有资料。成功备份的清理异常独立提示，不冒充认证失败。

## 资料与验证

应用ID、按用户的数据路径、加密归档与身份格式保持兼容；不通过强制结束运行中的Claude Code执行升级或验证。恢复创建新的私有副本，不覆盖活动身份库。

安装器、源码、SHA256、CI与实际验收范围见[交付核验](RELEASE_VERIFICATION_0.1.2_CRYPTO.md)。构建/解包审计不等同于真实安装/卸载验收，环境检查不证明账号消息权限。适用许可和来源见[LICENSE](../LICENSE)、[NOTICE](../NOTICE.md)及[分发说明](DISTRIBUTION.md)。
