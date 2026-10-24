# browser/
> L2 | 父级: ../CLAUDE.md
quota_existing.rs: 统一手动查询的已运行资料补充通路；按数据库绑定解析每身份独立profile，不切换全局slot、不复制资料、不读取Cookie，独立短期回环票据/固定扩展Origin/Host与16KiB正文上限；20秒总等待受批次deadline限制，取消每250ms协作检查；真实5h/7d和网页权益摘要经Python再次校验后写账本，自动刷新不调用此通路。`receive_for_test` 仅在 `cfg(test)` 暴露回环接收器给合成原生编排测试，不启动浏览器或读取用户资料。
mod.rs: Tauri 浏览器命令、单次变更锁与运行时状态；本地版浏览器包标识 ai.local.claude-local.browser；引擎优先 /Applications/Claude-Local Browser.app，回退 ~/Applications；宿主启动时建立起始页会话（start.url）、写入 launch.args；已有浏览器时打开新会话页以重新连接，回报与接收时间同一快照，上下文/快照共享界面语言与出口服务目录；会话因保存/清理/退出/对齐失效时立即换新，宿主退出删除 start.url；默认浏览器读取与一键请求；快捷换指纹先正常退出，再随机更新种子/地区、清空显式代理以跟随 TUN 并开启 Canvas/布局种子；运行中可重开 Default 实测页，偏好写入、设置、清理与系统对齐要求先退出；同步票据随浏览器会话失效。
quota_connection.rs: 用户显式选择账号后，只解析数据库中该账号已有绑定的资料与固定 `claude.ai/settings/usage` 地址；Cleaner enter_quota 后再取 Browser gate，冻结并复核账号指纹/绑定路径/配置；不切换全局 slot、不写全局 launch.args、不登记系统浏览器、不创建缺失资料、不读取 Cookie 或启动任意 URL；合成解析测试只用临时身份库和资料。
config.rs: 按当前身份保存的指纹配置（新资料默认代理留空以跟随 TUN）、实际机器参数、代理/地区语言白名单、回环地址豁免（--proxy-bypass-list 与 IPv6 规则规范化）和 Chromium 参数生成；Windows 仅在固定扩展清单存在时加载隔离额度桥；独占 user-data-dir 内明确启动 Default 资料，品牌版本采用实际引擎版本。
profile.rs: 当前绑定的独立资料目录、进程占用检查、偏好窄范围写入与缓存清理；登录数据单独明确选择，旧/新两种定位偏好同时禁用；Unix 显式导入所有权与权限元数据 trait。
network.rs: macOS/Linux/Windows 原生平台与浏览器观测分别核验，Windows 识别 Win32 并要求真实版本/CPU；共用 ipwho.is/ipapi.co 服务目录并提取 ASN/机房标识；经同一指定代理检测出口，服务故障/限流按顺序备援，分块限定响应规模并报告 HTTP 原因；本机出口对比；按共用目录匹配目标国家/语言/区域；结合浏览器实测 WebGL/webdriver/WebRTC 回报完成全部 9 项检测闭环。
server.rs: 仅向带随机令牌的回环 context 提供脱敏身份/环境状态，排除凭据/账号 UUID/匹配摘要；共用请求头解析器校验唯一 Host、Content-Length 和传输编码，quota-sync 仅接受固定 MV3 扩展 Origin、短期单次 nonce 和当前 active/quota_identity 双绑定快照，正文、请求时限及并发边界不放宽；静态资源限制在打包目录。
quota_bridge.rs: 用户显式命令打开当前绑定隔离浏览器，创建 90 秒一次性桥票；仅将现有 quota_identity SHA256 指纹放在 loopback 配对 fragment，扩展内用账号 UUID/email 与有界组织 UUID 候选进行唯一哈希匹配后回传，原生侧再复核 active/quota_identity 并只调用 Python 额度元数据入口；next_charge_date 标为 next_renewal，正余额要求完整有效 grants，零值缺少活动字段时仅给6小时有效边界，所有权益有效期最长限24小时；无后台轮询或 Cookie 读取。
windows.rs: Windows 引擎和共同资料/回环会话编排；运行中打开外部链接时沿用当前会话不重复追加实测页；用户点击后仅注册 Claude-Local-Browser、.URL/.HTML 独立名称空间，不改写默认关联；本地 B 启动项进入同一宿主，CI 启动阶段只记录固定字符串；纯内存回归拒绝把官方协议认作本地默认并核对安装钩子，CI 实际核验本地注册命令/两个协议，前后默认关联必须不变。
tests.rs: 模块共用临时目录样本，验证代理/资料边界、Windows 固定额度扩展参数、缓存隔离与地区核验；合成 HTTP 样本验证 Host/framing 拒绝及 429 备援解析，Windows 使用真实 junction 样本验证拒绝跨资料目录；不触碰现有账号数据。
linux.rs: Linux libexec 隔离引擎（兼容源码/Arch 的资源目录），带双布局路径回归，与宿主驱动的 Claude-Local Browser 启动项；处理 --browser 链接、同资料重连、显式 xdg-mime 注册并核验 HTTP/HTTPS；定位状态未知的桌面禁止完整机器对齐，修改前停止；Linux UA 不提供内核版本，不用 UA 值伪装内核核验。
workspaces.rs: 以 SQLite 绑定统一解析 macOS/Linux/Windows 资料与配置；transition 仅在 was_running 且绑定开启时重开浏览器，关闭状态保持关闭；正常退出成功后才报告退出完成，身份动作结束再开始资料同步/重开阶段；持久阻断文件防止恢复前打开错误资料，删除关联资料单独确认。
launch.rs: 已持有浏览器互斥锁时复用的同步启动核心；身份联动与手动启动走同一参数、资料和进程验证。
workspace_tests.rs: 临时数据库清理前明确释放句柄以兼容 Windows；临时 Cookie/缓存/配置与种子隔离、手动换指纹持久化、旧资料保留及恢复阻断回归。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
