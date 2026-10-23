<!--
[INPUT]: Quota recovery defaults from 0.2.1 and owner-selected identity-page hierarchy cleanup.
[OUTPUT]: Version 0.2.2 release notes for the more focused identity and quota page.
[POS]: Versioned release description; delivery and account-specific verification are recorded separately.
[PROTOCOL]: Do not imply that synthetic checks establish live account authorization or installed-app behavior.
-->
# Claude-Local 0.2.2

本补丁清除身份页顶部的冗余说明，主界面集中展示账号和额度，保留0.2.1的默认本地同步。

- 移除顶部“默认同步本地额度”等长说明和整块“可选在线查询”展开区域，使用说明留在帮助页。
- 在线查询通过右上角“⋯”菜单按需打开，不会因打开弹窗而发起查询；关闭即停止定时在线查询。
- 运行中的批次保留精简进度、查看和取消入口，关闭弹窗或切换页面不会取消原生任务。
- 账号隔离、切换确认、默认保留项目/会话历史、切号交接与本地被动额度同步逻辑保持不变。未自动登录、切号、改写Claude配置或执行真实账号查询。
