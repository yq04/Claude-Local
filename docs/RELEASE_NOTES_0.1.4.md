<!--
[INPUT]: Quota observation order fixes, privacy bridge, environment-first navigation, device-identifier preservation and quota setup diagnostics.
[OUTPUT]: Version 0.1.4 review release notes without account identifiers or workstation details.
[POS]: Manual private GitHub release documentation; publishing status is established by the actual release, not this file.
[PROTOCOL]: Keep validation claims tied to available reports and preserve NOTICE.md distribution limits.
-->
# Claude-Local 0.1.4

额度观测顺序修复、环境优先导航调整、本地隐私偏好桥接、设备标识与诊断状态保护及任务交接模板。建议作为私有预发布版本提供审阅；是否已构建、更新或发布，以本次交付回执及 GitHub Release 状态为准。

## 更新内容

- **额度观测与时序修复**：彻底修复切号后已耗尽额度回跳的问题。对比真实观测时间戳与窗口标识，归档创建时间不再作为覆盖账本的门槛；旧估计无法覆盖较新的服务端真实观测。过期或未知窗口保守标为未知且排除推荐，不再虚构满额。
- **菜单栏顺序优化（环境优先）**：侧边栏调整为先环境后账号的管理流向：快速配置 → 浏览环境 → 电脑环境 → 网络环境 → 身份管理 → 用量分析 → 使用说明 → 软件设置。默认启动首页仍保持身份管理不变。
- **原生隐私偏好桥与伴生页保护**：新增 `ui_privacy_read` / `ui_privacy_write` 原生偏好桥接；修复单字符邮箱打码漏洞；伴生浏览器起始页与主界面同步继承隐私打码状态；回环服务加强端口 Host、同源 Origin 校验与 CSP 响应头。
- **额度详情与官方用量直达**：身份卡片新增“额度详情”弹窗，展示额度来源（服务端快照 / 本地估算 / 来源未核验）与最新观测时间；如实呈现“官方未提供主动重置次数”，杜绝虚假按钮，并提供在当前身份伴生浏览器中打开官方用量页（`https://claude.ai/settings/usage`）的安全入口。
- **设备标识与诊断保护（S13）**：收缩账号清理白名单至 8 个核心凭据与必要缓存键，停止重置 `machineID`、`userID`、`anonymousId` 等设备与客户端标识，排除桌面 sentry 与 ant-did 诊断目标；兼容投影层确保旧版 68 键归档仍可完整读取，但不回灌设备标识。
- **额度采集自检（S14）**：新增 `quota_setup_status` 只读自检命令，可安全探测本机 `.claude/settings.json` 的 statusLine 状态，并在额度详情中给出透明说明与配置指引；不含自动覆写或未验证 Python 执行。
- **历史文件原样保留**：读路径与备份路径彻底停止自动调用会话 sanitizer，不再自动改写共享会话的组织和邮箱提醒；切换与恢复仅维护受控账号缓存。
- **任务交接模板**：在使用说明页提供纯本地、手动填写的任务交接骨架（目标、进展、下一步、约束），供换号或新会话时复制使用，不读取会话文件或凭据。

## 升级须知

- 账号、保险库、额度与用量记录、浏览器资料和设置位于 `%APPDATA%/ai.local.claude-local`，升级不清理该目录。
- 0.1.3 安装包引入的旧版自动卸载与保留数据逻辑自本版继续生效。
- 升级后首次启动时，若此前未配置原生隐私文件，系统会自动将本地已有隐私设置平滑迁移至安全存储。

## 分发文件

完整交付应包含 Windows x64 NSIS 安装包、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json`、本更新说明及相关源代码。安装包不得携带个人账号归属配置、数据库、密钥、浏览器资料或私密审计标记。

## 验证与限制

源码层级验证覆盖 TypeScript 与 Vite 生产构建、Bun 单元测试（38 项全部通过）、Python 额度与迁移测试（18 项全部通过）、Rust 原生定向测试（quota_setup、ui_privacy、profile 额度回归、S13 兼容与设备保护等全部通过）。

安装包按所有者决定继续保持未签名。第三方许可边界仍以 `NOTICE.md` 与 `docs/DISTRIBUTION.md` 为准；本版本不包含自动远端更新源。
