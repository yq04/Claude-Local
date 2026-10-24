# src/
> L2 | 父级: ../CLAUDE.md
清理在本机执行；网络页仅提供用户触发的固定 Claude 服务连通性诊断，没有供应商导航或 Skill 依赖。生产命令提供身份压缩暂存、空身份切换、恢复、独立确认的直接删除及当前默认 Claude 文件残留维护。用户选择保留或随身份暂存，文件残留另经扫描和选择清理，系统设置独立。
identities/ - SQLite 身份目录、用户保留策略、加密压缩暂存、空身份切换、恢复、选择性直接删除与独立本地 Token 统计账本；见其 CLAUDE.md。
identities/online.rs - 固定端点在线额度与账号绑定的网页元数据桥，原生仅编排隐藏Python进程并读取白名单摘要；前台近实时需用户显式开启，后台不轮询。
identities/backup.rs / backup_tests.rs: 口令派生（ring PBKDF2/AES-GCM）身份全量与救援备份/恢复、SQLite 在线快照、归档清单与记录强校验（version=1、id/HMAC 强一致、data/n 完整性）、有界解包防护。
identities/quota_connection.rs: 集中连接与路由修复队列；打开独立绑定浏览器登录，不切换全局 CLI，不重放未经验证路由。
identities/online_native_chain_tests.rs: 真实原生编排核心、资源解析、系统 Python、回环接收器与单写者账本的闭环测试夹具。

cleaner_identity.rs: 身份目标与保留策略适配（含个人设置下的独立代理环境变量与项目记录下的 githubRepoPaths 隔离与无损合并）、跨账号混杂残留清理（含 plugins/synced、model-catalog、groveConfigCache、异号 .claude.json 备份隔离、共享会话 credential_org/userEmail/thinking 签名与 api-request-blob/bridge-session 脱敏、跨账号中断 tool_use/孤儿 tool_result 成对自愈修复、异号会话 tengu_exit 遥测拆弹）及协作式 Claude 进程锁年龄协议清理；测试显式断言规范源路径，复用白名单、完整快照与窄 JSON 键操作，不扫描源码。
local_edition_tests.rs: 独立应用标识/产品/二进制与无更新插件、权限、配置的离线回归，不读取真实数据。
main.rs: 本地版 Tauri 生命周期、主窗口尺寸恢复与事件/退出保存、双语托盘、身份/文件残留/CLI 手动检查与更新/用量分析/浏览器/网络命令注册；--quota-core 在启动诊断与单实例之前执行纯 JSON 合并；普通启动不打开浏览器，发布必须 custom-protocol，Windows GUI 子系统和固定脱敏启动诊断；无官方应用更新或重启插件。
window_state.rs / window_state_model.rs: 仅主窗口正常逻辑尺寸/最大化记忆，忽略最小化；Windows 以系统 WINDOWPLACEMENT 恢复外框、正常样式非客户区和窗口 DPI 换算，避免最大化过渡缓存/实时客户区污染，不采集移动；按工作区约束居中，resize 有界防抖与关闭/退出私有原子保存；512字节读取上限，纯合成测试覆盖过渡期与 DPI，不访问实际窗口。
quota_core.rs: GUI/Python writer 共用的逐窗状态、观测百分比有限性/边界验证、可信服务端窗口到期后的 reset_inferred 推定、观测顺序与同窗单调合并；保留过去边界和原观测，不伪造新 reset/观测。schema 1 的 --quota-core stdin/stdout 有界协议（最多 1MiB / 256 窗口），不接路径、不读文件或联网，非法输入只报固定错误。
local_runtime.rs: 启动参数明确门控配套浏览器，普通启动不启动引擎；含纯输入策略回归。
ui_language.rs: 受 zh/en 白名单限制的界面偏好，原子持久化后发布内存状态；本地版托盘菜单，独立于电脑与浏览器语言。
ui_appearance.rs: 界面外观偏好（主题、6 色强调色、字体栈、五层光学毛玻璃无级参数与 8 款壁纸画布）及自定义壁纸 Data URI 的原生白名单校验、Win32 私有 ACL 原子落盘（ui-appearance.json / ui-wallpaper.json）与主窗口原生标题栏明暗主题同步（set_theme）。
monitor_window.rs: 独立可开关无边框置顶「实时额度悬浮监控窗」（monitor）生命周期控制与零网络本地实时遥测引擎；基于 mtime/size 缓存增量解析 ~/.claude/projects JSONL 的 5h Token 消耗、10m 实时速率、缓存命中率、200k 上下文水位及 5h 燃烧速率/触顶预警。
browser/: 指纹浏览器、资料与缓存边界、真实浏览器回报及目标地区环境核验；见其 CLAUDE.md。
windows.rs: Win32 剪贴板、当前用户 TokenUser/TokenOwner/管理员组文件所有权与权限保留回退、Win32 与注册表读取时区/首选语言/定位偏好/系统代理（跳过空白环境变量并区分 SOCKS4/5）、缓存系统版本与用户触发设置；控制台工具隐藏窗口，外部链接；拒绝凭据管理器自动读取和 SSH 操作。
windows_tests.rs: 临时文件所有者/长路径、虚构输入的空白代理回退与 SOCKS 协议回归；本机不修改系统设置，时区还原测试仅允许一次性 CI。
windows_timezones.rs: CLDR 48 固定全量 Windows/IANA 映射与目录别名，无运行时下载或猜测；原始许可证作为 Windows 资源交付。
windows_process.rs: 当前用户 Toolhelp/MSIX 固定 Claude 包族（含 cowork-svc/claude-ssh 辅助进程）与精确 CLI 参数/WinGet 链接识别、创建时间和句柄复核、终止等待收敛、独立资料主浏览器进程的正常窗口关闭；原始参数不序列化，超时子进程使用 Job Object；Windows CI 回归实际映射时区写入后还原。
system.rs: 电脑环境查询、系统修改历史记录（system_changes）before/after 事务包装、多字段冲突检查恢复与 restore_operation 范围判定；后台执行原生操作，错误后重新读取系统状态并保存已发生修改。
native.rs: 剪贴板、辅助功能设置、进程编号与凭据解锁桥；旧扫描只读凭据属性，已移除旧批量单项凭据删除包装；身份快照/恢复仅原生可用，默认服务正文不送 UI。
cleaner.rs: 共享精确进程停止、文件扫描/快照保护/只读进程状态与独立残留扫描计划；Windows 外置 AppData 只允许同一目标白名单与受限旧组织会话且复核规范路径/用户所有权；原生 CLI 识别当前用户官方 versions 下的精确数字版本程序；结束全部已识别的 Claude 进程时逐轮核验与收敛；CLI/身份/残留修改共用事务锁，各调用独立进度通道。
claude_cli.rs: 本地安装方式/路径/版本/运行状态，用户手动固定公开版本检查与安全原位更新；限制元数据大小、重定向和超时，通过既有代理读取但不发送账号凭据；更新前拒绝运行中的 CLI，不自动结束会话，经原安装方式更新并核验。旧管理脚本/失败回滚与隔离测试保留兼容，Windows 子进程清理继承 PSModulePath，测试不操作真实安装。
cleaner_folder.rs: 用户所选目录内的 Claude 白名单发现；不跟随链接、不扫描目录外、不处理项目权限或凭据。
progress.rs: 有序脱敏阶段事件与有界内存日志；供清理与浏览器共享，只读取事务传入的计数和状态。
cleaner_transaction.rs: 文件残留和隔离历史样本共用删除/窄 JSON 改写引擎；全体快照预检后逐项复核进程，失败停止并报告部分完成，拒绝钥匙串操作。
cleaner_residue.rs: 手动默认 Claude 文件残留扫描（含系统环境变量 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_OAUTH_TOKEN 覆盖告警）与按 ID 选择清理及逐目标真实进度，独立一次性计划，执行前阻断身份恢复/运行进程；动态报告/缓存名称匹配明确边界，排除同前缀其他应用；不停止进程、不访问钥匙串、不处理 Shell/共享代理、个人偏好/窗口状态、Skills/插件、保险库或浏览器资料，Code 文件凭据仅移除登录键。
cleaner_residue_tests.rs: 临时根/虚构账号/隔离 SQLite/注入进程状态验证路径范围、桌面个人偏好/密钥/工作区永不作为残留目标、无凭据输出、MCP/插件秘密保留、过期/不完整/伪造快照拒绝、身份恢复阻断与部分失败；不修改 HOME 或真实 Claude。
cleaner_targets.rs: 官方已确认的会话计划/附件/环境/任务/终端快照/反馈和 Claude 白名单、桌面登录存储子目录（保留个人偏好、密码密钥和工作区，不删整个应用资料目录）、无条目截断的动态目标发现与读取警告、完整目录规模和元数据指纹（读取失败不生成可删除快照）、按 Windows 实际规范化 AppData 的旧组织会话检索；不进入链接目标或项目源码。
cleaner_config.rs: 账号缓存和代理认证配置的窄范围变换；Code 文件登录键独立白名单复用于身份和残留，保留共享 MCP/插件秘密和其他配置，仅返回键名。
cleaner_io.rs: 清理后配置原子写入；Windows 写入前保留原所有者/DACL，临时文件仅保存新内容，失败移除，不保留原配置。
cleaner_tests.rs: 临时白名单/快照/日志验证，覆盖超过 30,000 文件的完整清理与权限失败保护；官方原生版本路径、自编译并经启动握手的可丢弃进程与 Node 样本验证身份、终止与其他 Node 保留；Windows 子进程隔离的外置 AppData 验证白名单和身份目标，不复制系统平台二进制，不修改用户数据。
regions.rs: 地区编号到语言、区域格式和代表时区的唯一白名单与目标语言前缀/美国多时区地区匹配；供前端选择与系统/浏览器快捷操作共用，包含目录与本机时区验证。
linux.rs: Linux procfs 当前用户进程、zoneinfo/timedatectl、GNOME 定位偏好、GNOME/KDE 设置入口与 Wayland/X11 剪贴板；LC_MESSAGES/LC_TIME 分别读取会话语言/区域格式，不匹配时先报手动操作再改时区；未知定位为 null，Linux 钥匙串明确不可用；不将系统代理凭据序列化给 WebView。
network_links.rs: 用户手动触发的固定四域名并发只读 HTTP 探针（downloads 验证安装器公开版本号，Cloudflare 浏览器质询标为可达），优先显式或系统脱敏代理、不携带认证、不跟随重定向、校验目标域、八秒超时，真实连接对端不冒充出口；不接收任意 URL、不打开外部资源、不依赖 Skill 或供应商配置；离线回环测试覆盖域名、响应和注册边界。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
