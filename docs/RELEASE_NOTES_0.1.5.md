<!--
[INPUT]: Independent quota-window evidence, legacy compatibility fixes and a shared native quota merge protocol.
[OUTPUT]: Version 0.1.5 release notes without workstation paths, account identifiers or private audit markers.
[POS]: Manual local/private delivery notes; build, deployment and publication status are established by delivery receipts.
[PROTOCOL]: Preserve NOTICE.md distribution boundaries; never claim an installed update from source-only tests.
-->
# Claude-Local 0.1.5

修复身份卡片额度全部显示未知的问题，并将窗口状态合并规则收敛到 Rust 核心。5h 与 7d 独立显示有效额度，任一窗口过期或缺少观测不会再隐藏另一窗口。

## 额度修复

- 兼容旧额度账本。不匹配或缺少身份标记的条目不再污染已有可信摘要；旧格式实时锚点仅在账号和组织严格匹配时使用。
- 每个窗口分别记录来源与实际观测时间，单窗口回传不会使另一窗口的旧观测变新。
- 到期或缺少证据的窗口保持未知，不把过期快照视为恢复满额。同窗口已耗尽的较新证据继续保留。
- 额度详情分别展示 5h、7d 来源与观测时间，保持原有工牌尺寸和中英文界面。

## Rust 核心与采集兼容

原生界面和随包 Python 采集脚本复用 Rust 的窗口状态、到期失效与证据合并规则。Python 仍是额度账本唯一写入者，继续使用跨进程锁与原子替换；Rust 核心只接受有界的额度元数据，不读取账号文件，也不写账本。

Windows 包含 `scripts/claude_quota.py` 源码，使用安装目录内固定位置的主程序进行无窗口计算。没有主程序的独立旧脚本保留明确的兼容模式；本次不会自动修改已有 statusLine，也不包含 Python 或 cryptography 运行时。

React 界面继续保留。归档编码、账号 HMAC、浏览器种子及 SQLite user_version=3 不变；额度摘要版本为 5。安装包继续遵循原有未签名分发和第三方许可边界，不添加自动更新源。

## 验证与交付

验证覆盖额度核心、Rust 身份摘要、Python 锁内写入与桥接、双语和界面合成场景。正式 Windows 构建启用 custom-protocol，经 NSIS 解包、资源白名单、文件哈希与私密标记审计；实际完成结果以本次交付回执为准。
