<!--
[INPUT]: Validated SQLite initialization, independent quick-setup reads, effective browser targets and UI refinements.
[OUTPUT]: Version 0.1.2 review release notes without account identifiers or workstation details.
[POS]: Manual private GitHub release documentation; publishing status is established by the actual release, not this file.
[PROTOCOL]: Keep validation claims tied to available reports and preserve NOTICE.md distribution limits.
-->
# Claude-Local 0.1.2

Windows x64 数据库并发事务加固、快速配置就绪检测与界面一致性更新。建议作为私有预发布版本提供审阅；是否已构建、更新或发布，以本次交付回执及 GitHub Release 状态为准。

## 更新内容

- 修复 `identities_read` 与 `browser_read` 并发调用时 SQLite 首次创建及旧库迁移的竞争问题，采用 `IMMEDIATE` 事务锁保证初始化原子性，严格保留 SQLite `user_version=3` 结构、既有身份数据及浏览器稳定种子派生规则。
- 快速配置中的身份、浏览环境、电脑环境和 Claude Code CLI 状态各自完成即展示，单项故障不阻塞其余结果；显示具体失败项目和原因，可通过刷新状态重试。
- 浏览器配置启用“跟随电脑”时，概览按电脑当前时区和首选语言显示目标，不再展示保存的备用值；配置目标与浏览器实际观测仍分别核验。
- 界面视觉与交互对齐：统一样式与共享图标，复用现有 Cromma Button 尺寸规范、加载反馈与错误主题色，按容器可用宽度自适应排版，不增加新的第三方依赖。
- 优化暗色模式与窄窗口排版，提升异常场景下的容错表现。

## 分发文件

完整交付应包含 Windows x64 NSIS 安装包、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json`、本更新说明及相关源代码。安装包不得携带个人账号归属配置、数据库、密钥、浏览器资料或私密审计标记。

## 验证与限制

源码层级验证已覆盖 3 项 Rust 并发数据库初始化与迁移测试、9 项 Bun 本地化与浏览器状态核验、16 组隔离环境下的 Quick Setup 专项 GUI 检查，以及 TypeScript 与 Vite 生产构建编译。

上述结果属于源码层级的自动化验证。安装包必须另外通过独立环境下的解包与隐私白名单审计，已有本地安装的更新需核对更新回执和文件 SHA-256 哈希，源码测试不能替代交付证明。

安装包目前尚未签名。真实 NSIS 安装、覆盖升级与卸载仍需在专用临时 Windows 环境验证，文件式本地替换不替代这些验证。第三方许可边界仍以 `NOTICE.md` 与 `docs/DISTRIBUTION.md` 为准；本版本不包含自动远端更新源。
