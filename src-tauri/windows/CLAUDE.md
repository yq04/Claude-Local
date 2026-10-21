# windows/
> L2 | 父级: ../CLAUDE.md
LICENSE.unicode.txt: 全量 Windows/IANA 时区互操作数据的 Unicode 许可原文，随 Windows 包交付。
installer-hooks.nsh: 欢迎页前校验 Claude-Local 当前用户旧安装记录，显式确认后只读查询应用/内置浏览器文件占用，并用旧版 uninstall.exe /UPDATE _?=<旧目录> 同步卸载；取消、占用、执行错误或旧程序/注册记录残留均阻止新版安装。/UPDATE 保留用户数据，升级时保留浏览器注册名称空间；普通卸载仅清理本地版 .URL/.HTML 与 HKCU 注册项。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
