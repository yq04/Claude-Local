<!--
[INPUT]: User-reported 0.2.0 quota regression and the selected compatibility-first recovery.
[OUTPUT]: Version 0.2.1 release notes for the local quota default and refresh behavior.
[POS]: Versioned release description; delivery and account-specific verification are recorded separately.
[PROTOCOL]: Do not imply that synthetic checks establish live account authorization or installed-app behavior.
-->
# Claude-Local 0.2.1

> 开发过程归档，不作为对外发行序列。Claude-Local的发行版本从0.1.0开始；当前版本与下载以README和Releases为准。以下源码/哈希/测试记录保持原值，不代表当前发布状态。


本补丁针对0.2.0额度使用体验回退问题，恢复旧版本地同步为默认方式，保留备份、环境恢复等其他功能。构建、审计及实际更新状态另行记录。

## 额度同步恢复

- 顶部主入口改为同步全部本地额度，不要求先完成在线查询。已保存账号继续保留各自最近的观测，估算和预计恢复仍明确标注。
- 身份页可见时约每两秒检查既有账本和固定CLI配置文件的元数据。`/usage` 或采集器写入新缓存后可自动拾取；不会自动执行命令、写入Claude配置、扫描凭据或切换账号。
- 在线查询、定时在线查询及连接修复移入默认折叠的可选区域。关闭后停止定时在线查询，旧在线错误不再占据默认卡片；正在运行的任务仍可查看和取消。
- 修复额度状态及订阅/重置文案缺失导致显示内部键名的问题，增加实际格式化结果及辅助模块文案覆盖检查。

同步依赖CLI或既有采集器实际写入本地记录，不把终端中未保存的输出当作新观测，也不承诺离线读取能实时获得所有已保存账号的服务器额度。真实账号授权和服务商接口仍需独立验收。
