# src-tauri/
> L2 | 父级: ../CLAUDE.md
main.rs: 本地版 Tauri 生命周期、主窗口尺寸记忆接线、双语托盘和命令注册；--quota-core 在启动诊断与单实例之前执行纯 JSON 合并；普通启动不打开浏览器，发布必须 custom-protocol；无官方应用更新或重启插件。
window_state.rs: 仅 main 窗口的私有 app_data/window-state.json 尺寸/最大化状态、显示前恢复、当前工作区限制与居中、防抖 resize/move 保存及 Close/Exit 刷新；不保存最小化/隐藏状态，不涉及浏览器或账号数据。
window_state_model.rs: 无 Tauri/系统依赖的窗口尺寸状态校验、最大化/最小化捕获规则、DPI 换算、工作区限制与居中纯模型及合成单元测试。
SECURITY.md: 原生数据流与安全契约，列出本地读取、外部连接、确认后修改、代理不序列化及 Linux A/B 安装运行保护；验证范围按实际环境陈述。
宿主保持用户触发的网络诊断与系统权限在 Rust 中；剪贴板复制只在主线程执行。文件残留手动扫描/选择清理与电脑设置使用后台任务；残留入口不读写钥匙串，身份暂存经用户确认在原生层保存默认 Claude 凭据，正文不送 UI。
src/ - 身份管理、清理白名单、浏览器、地区、固定资源导航与不启动 GUI 的纯 JSON 额度核心边界；见其 CLAUDE.md。
src/identities/online.rs - 用户触发的固定额度读取、Python单写者子进程桥接和账号绑定的订阅/重置资料只读合并；脚本随公共资源打包。
native/ - macOS 剪贴板、授权、直接钥匙串删除与电脑环境设置；见其 CLAUDE.md。
capabilities/ - 主窗口能力边界；见其 CLAUDE.md。
windows/ - NSIS 当前用户安装钩子、欢迎页前确认/同步卸载且保留资料的升级流程与 B 入口；见其 CLAUDE.md。
icons/ - 应用包图标；见其 CLAUDE.md。
Cargo.toml: Win32 文件创建时原子指定用户 SID/私有 ACL；SQLite bundled 身份索引、ring 认证加密与 tar/Zstd 新归档（兼容旧 gzip）；Tauri 宿主、本地版无 updater/process 插件的原生桥依赖；custom-protocol 映射 tauri/custom-protocol，由正式打包启用以读取内嵌前端，开发模式默认不启用。
Cargo.lock: 锁定 Rust 与平台库的实际版本。
build.rs: 编译 Objective-C 桥并生成 Tauri 构建元数据。
tauri.conf.json: 本地独立产品名 Claude-Local、先隐藏以供尺寸恢复的主窗口、ai.local.claude-local 应用标识、内容安全策略、固定前端/图标许可资源及根 LICENSE/NOTICE 安装资源；不配置官方更新源。Windows 分享构建由隐私白名单核验资源，安装器当前未签名。
tauri.macos.conf.json / tauri.linux.conf.json / tauri.windows.conf.json: 分平台资源与打包配置；macOS 保持双应用归档，Linux 使用 PNG 和 /usr/libexec/Claude-Local Browser 隔离引擎，防止 linuxdeploy 递归改写厂商 ELF；默认 Tauri 构建 deb/AppImage，RPM 配置的依赖由原生 rpmbuild 消费；Windows 使用当前用户 NSIS、内嵌浏览器引擎、独立 Claude-Local-Browser 启动项，无自动更新；build.rs 只在 macOS 编译 Objective-C。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

Release metadata: 0.1.2 is synchronized across package.json, tauri.conf.json, Cargo.toml and Cargo.lock. Main-window entries in the base/Windows/Linux configs begin hidden and the native size restore explicitly shows the window.

Timezone analytics: chrono0.4.45与chrono-tz0.10.4使用内嵌IANA数据，查询时区由前端明确传入；不修改系统时区、不联网查时区。NOTICE保留本版实际静态查找依赖的许可与版权。
