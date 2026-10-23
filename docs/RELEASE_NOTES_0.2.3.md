<!--
[INPUT]: Owner-requested identity control cleanup and verified passive-quota/handoff fixes.
[OUTPUT]: Version 0.2.3 patch notes with actual source changes and verification boundaries.
[POS]: Immutable versioned release description; delivery receipts are recorded separately.
[PROTOCOL]: Do not claim synthetic checks establish live account authorization or installer acceptance.
-->
# Claude-Local 0.2.3

移除身份页多余的搜索、排序与提示，修复本地额度同步遗漏和交接文件内容丢失，不增加功能或替代控件。

- 当前账号保持置顶，其余卡片沿用原生记录顺序；清除搜索/排序行及失效样式、筛选辅助逻辑。
- 本地额度摘要读取成功后才确认文件版本；临时读取失败或响应被较新读取替代时，下次检查继续重试。
- 首次检测本地额度文件版本时补读摘要，避免打开页面时漏掉CLI缓存变化；仍只读取本地观测，不新增在线轮询。
- 修复手工交接Markdown导出后再导入时，标题前用户手写反斜杠丢失的问题，保留双语旧模板兼容。
- 修正额度界面测试遗留的旧按钮文案选择器，并加入真实组件/虚构IPC的首次竞态与失败重试回归。

账号隔离、切号确认、共享历史保留策略、保险库格式与Python账本单写者保持原有约束。额度仍依赖CLI或既有采集器实际落盘，不承诺所有账号服务端额度实时更新。没有执行真实账号切换或在线额度查询；安装器系统级验收仍限一次性Windows环境。
