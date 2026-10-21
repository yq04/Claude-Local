<!--
[INPUT]: Cromma UI interaction primitives, frontend preference fixes, the post-0.1.2 installer upgrade hook and their available verification reports.
[OUTPUT]: Version 0.1.3 review release notes without account identifiers or workstation details.
[POS]: Manual private GitHub release documentation; publishing status is established by the actual release, not this file.
[PROTOCOL]: Keep validation claims tied to available reports and preserve NOTICE.md distribution limits.
-->
# Claude-Local 0.1.3

界面交互统一、设置页如实化与安装器升级顺序调整。建议作为私有预发布版本提供审阅；是否已构建、更新或发布，以本次交付回执及 GitHub Release 状态为准。

## 更新内容

- 统一交互组件：内置 Cromma UI 新增分段单选、开关与折叠区三个组件，行为均来自已安装的 Radix，外观沿用现有令牌；设置页分栏与各项选择、侧栏中英文切换、用量时段与图表/数据切换，以及帮助、保留策略、浏览器缓存与高级设置、残留扫描提示、统计口径等折叠区全部改用这些组件。键盘方向键、读屏语义与焦点环由组件统一提供，删除了重复的手写控件与样式。没有新增第三方依赖。
- “减少动画”现在同时作用于页面淡入、折叠展开和身份卡片弹簧滚动；页面切换增加短暂淡入，系统或软件内减少动画时直接到位。
- 设置页移除了不会实际执行的“检查更新”“启动时检查新版本”“更新通道”和“默认终端”选项，改为只读版本说明：本地独立版不联网检查更新，新版本以安装包形式交付。旧版保存的这些偏好会被安全忽略。
- 安装器：检测到当前用户已登记安装的旧版时，先在欢迎页前确认并以保留资料的方式卸载旧程序，卸载并核验成功后才进入新版安装向导；取消、占用或卸载失败时直接停止，不覆盖安装。占用检查只读，不会替用户结束 Claude-Local、内置浏览器或 Claude Code。

## 升级须知

- 账号、保险库、额度与用量记录、浏览器资料和设置位于 `%APPDATA%/ai.local.claude-local`，升级不清理该目录。
- 旧版卸载器的行为由旧版本决定：从 0.1.2 升级时，旧卸载器会移除“Claude-Local Browser”的系统浏览器注册；如之前设为默认浏览器，升级后请在浏览环境页重新设置。
- 手工复制、未在系统中登记的程序目录不会被扫描或自动删除。
- 如升级流程提示无法验证旧安装或卸载失败，可先在 Windows“已安装的应用”中卸载 Claude-Local（不要勾选删除应用数据），再运行本安装包。

## 分发文件

完整交付应包含 Windows x64 NSIS 安装包、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json`、本更新说明及相关源代码。安装包不得携带个人账号归属配置、数据库、密钥、浏览器资料或私密审计标记。

## 验证与限制

源码层级验证覆盖 TypeScript 与 Vite 生产构建、Bun 单元与本地化测试、隔离虚构 IPC 的完整 GUI 回归（用量、快速配置、身份、浏览器、网络与整壳双语预览），以及安装器钩子在英文、简体中文、繁体中文下警告即错误的合成编译和实际生成 Tauri 模板的合成载荷编译。

安装器升级顺序目前只有源码与合成编译证据，尚未在真实环境执行过安装、升级或卸载；合成编译产物不是可分发安装包。安装包必须另外通过解包与隐私白名单审计，已有本地安装的更新需核对更新回执和文件 SHA-256 哈希，源码测试不能替代交付证明。

安装包按所有者决定继续保持未签名。第三方许可边界仍以 `NOTICE.md` 与 `docs/DISTRIBUTION.md` 为准；本版本不包含自动远端更新源。
