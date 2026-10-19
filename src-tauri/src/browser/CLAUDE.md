# browser/
> L2 | 父级: ../CLAUDE.md
mod.rs: Tauri 浏览器命令、单次变更锁与运行时状态；本地版浏览器包标识 ai.local.claude-local.browser；引擎优先 /Applications/Claude-Local Browser.app，回退 ~/Applications；宿主启动时建立起始页会话（start.url）、写入 launch.args；已有浏览器时打开新会话页以重新连接，回报与接收时间同一快照，上下文/快照共享界面语言与出口服务目录；会话因保存/清理/退出/对齐失效时立即换新，宿主退出删除 start.url；默认浏览器读取与一键请求；快捷换指纹先正常退出，再随机更新种子/地区、清空显式代理以跟随 TUN 并开启 Canvas/布局种子；运行中可重开 Default 实测页，偏好写入、设置、清理与系统对齐要求先退出。
config.rs: 按当前身份保存的指纹配置（新资料默认代理留空以跟随 TUN）、实际机器参数、代理/地区语言白名单、回环地址豁免（--proxy-bypass-list 与 IPv6 规则规范化）和 Chromium 参数生成；独占 user-data-dir 内明确启动 Default 资料，防止最近使用资料与清理/偏好范围错位，品牌版本采用实际引擎版本。
profile.rs: 当前绑定的独立资料目录、进程占用检查、偏好窄范围写入与缓存清理；登录数据单独明确选择，旧/新两种定位偏好同时禁用；Unix 显式导入所有权与权限元数据 trait。
network.rs: macOS/Linux/Windows 原生平台与浏览器观测分别核验，Windows 识别 Win32 并要求真实版本/CPU；共用 ipwho.is/ipapi.co 服务目录；经同一指定代理检测出口，服务故障/限流按顺序备援，分块限定响应规模并报告 HTTP 原因；本机出口对比；按共用目录匹配目标国家/语言/区域；失败、国家/语言/区域或时区冲突均不显示通过，自定义地区未知时保持未核验。
server.rs: 仅向带随机令牌的回环 context 提供绑定身份的名称/邮箱/组织与同步状态，排除凭据/账号 UUID/匹配摘要；有界并发工作线程与总请求头超时防空置预连接阻塞，刷新实际机器与界面语言上下文，接收浏览器观测并提供同令牌只读回报/接收时间，供实际 A/B 启动验收，CSP 仅放行两个已选出口服务；存活到会话令牌被替换或清空；静态资源限制在打包目录；HTML/JS/CSS/字体及 JPEG/PNG/SVG/WebP/AVIF 统一 MIME 白名单，真实 HTTP 图片载荷回归防止 Vite 预览掩盖宿主 404。
windows.rs: Windows 引擎和共同资料/回环会话编排；运行中打开外部链接时沿用当前会话不重复追加实测页；用户点击后仅注册 Claude-Local-Browser、.URL/.HTML 独立名称空间，不改写默认关联；本地 B 启动项进入同一宿主，CI 启动阶段只记录固定字符串；纯内存回归拒绝把官方协议认作本地默认并核对安装钩子，CI 实际核验本地注册命令/两个协议，前后默认关联必须不变。
tests.rs: 模块共用临时目录样本，验证代理/资料边界、缓存隔离与地区核验；本机 HTTP 样本复现 429 并核验备援解析，Windows 使用真实 junction 样本验证拒绝跨资料目录；不触碰现有账号数据。
linux.rs: Linux libexec 隔离引擎（兼容源码/Arch 的资源目录），带双布局路径回归，与宿主驱动的 Claude-Local Browser 启动项；处理 --browser 链接、同资料重连、显式 xdg-mime 注册并核验 HTTP/HTTPS；定位状态未知的桌面禁止完整机器对齐，修改前停止；Linux UA 不提供内核版本，不用 UA 值伪装内核核验。
workspaces.rs: 以 SQLite 绑定统一解析 macOS/Linux/Windows 资料与配置；正常退出成功后才报告退出完成，身份动作结束再开始资料同步/重开阶段；持久阻断文件防止恢复前打开错误资料，删除关联资料单独确认。
launch.rs: 已持有浏览器互斥锁时复用的同步启动核心；身份联动与手动启动走同一参数、资料和进程验证。
workspace_tests.rs: 临时数据库清理前明确释放句柄以兼容 Windows；临时 Cookie/缓存/配置与种子隔离、手动换指纹持久化、旧资料保留及恢复阻断回归。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
