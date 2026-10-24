<!--
[INPUT]: Verified account-safety hardening, reset_inferred quota clarity, Cockpit Tools settings alignment and sidebar layout updates.
[OUTPUT]: Version 0.2.4 patch notes with actual source changes and verification boundaries.
[POS]: Immutable versioned release description; delivery receipts are recorded separately.
[PROTOCOL]: Do not claim synthetic checks establish live account authorization or installer acceptance.
-->
# Claude-Local 0.2.4

围绕账号隔离安全、已到期窗口额度呈现、软件设置座舱对齐与左侧导航菜单比例进行升级，不破坏既有保险库、账本与本地额度同步边界。

- **账号安全加固**：内置浏览器启动页身份工牌遵循全局「账号邮箱与名称打码」偏好；回环摘要补充本地 CLI 代理配置并支持在浏览器页提示代理不一致；残留扫描新增全局 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` 环境变量覆盖告警，防止切换账号后仍被系统环境变量串联。
- **额度到期恢复显示优化**：`reset_inferred` 窗口改用清晰状态标签（「窗口已过 · 预计满额」/「窗口已过 · 待重测」）并展示原重置时间与已过时长；本地会话/账本在已到期 `server_anchor` 之后产生新消耗时，以 0% 为基线叠加实测增量而非回退未知；展开卡片详情时为含过期推定的账号提供一键打开在线校准弹窗入口。
- **软件设置对齐 Cockpit Tools**：顶栏升级为左标题 + 居中胶囊 Tabs（通用 / 外观与布局 / 数据管理 / 关于）；通用页置顶独立「备份与资料目录」卡片（支持一键打开或复制 `%APPDATA%\ai.local.claude-local` 路径）与分组列表卡片，完整加密备份与恢复表单收敛至「数据管理」页；新增 `90%–110%` 界面缩放（含 `Ctrl/Cmd + +/-/0` 快捷键）与「启动默认页」设置。
- **左侧导航栏比例与分组优化**：按中英双语分别优化导航字号、字距与胶囊内边距，清理将上方 6 个核心页面切碎的冗余分割线，仅保留底部工具区单分割线；副标题更新为「本地身份座舱 / Local Cockpit」消除英文截断，侧栏收起按钮升级为矢量面板图标，选中态统一为全胶囊高亮且悬停保持页面图标可见。

账号隔离、切号确认、共享历史保留策略、保险库格式与 Python 账本单写者保持原有约束。没有执行真实账号切换或在线额度查询；安装器系统级验收仍限一次性 Windows 环境。
