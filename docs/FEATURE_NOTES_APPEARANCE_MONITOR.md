<!--
[INPUT]: Verified feature-development custom wallpaper & 5-layer optical glassmorphism, floating Token/Quota HUD monitor window, 4-dimensional anti-ban security hardening, and open-source UX enhancements.
[OUTPUT]: Feature-development notes with source changes and verification boundaries.
[POS]: Engineering feature record, not a separate public release number.
[PROTOCOL]: Do not claim synthetic checks establish live account authorization or installer acceptance.
-->
# 外观、悬浮监控与安全边界开发记录

本文为功能开发记录，不属于对外发行编号。Claude-Local的发行序列从0.1.0开始；下载和版本说明以README及Releases为准。

围绕自定义壁纸与 5 层光学级毛玻璃视觉引擎、当前活跃账号实时 Token/额度悬浮监控窗（Floating Monitor HUD）、四维防封号/防风控安全加固以及开源竞品生产力交互体验进行全面升级，同时保持既有身份保险库、账本与本地额度同步边界不变。

- **自定义本地壁纸与 5 层光学级毛玻璃系统（Scheme A）**：
  - 新增本地壁纸导入引擎（`src/wallpaper-store.ts`）与 Rust 原生持久化模块（`src-tauri/src/ui_appearance.rs`），支持 PNG / JPG / WebP / GIF 壁纸上传、Canvas 等比压缩（最长边 `<= 1920px`）与主色调高饱和像素自动提取推荐强调色（`rgbToSuggestedAccent`）。
  - 新增 5 套一键主题预设（羊皮纸经典、极光毛玻璃、落日琥珀玻璃、沙丘暖金玻璃、星云暗夜玻璃）、6 色强调色、5 种背景氛围及 3 维连续光学调校滑块（毛玻璃模糊度 `8px–40px`、面板不透明度 `45%–92%`、壁纸暗化遮罩 `0%–65%`），并在 `%APPDATA%\ai.local.claude-local\ui-appearance.json` 与 `ui-wallpaper.json` 跨重启原子落盘。
- **实时 Token/额度悬浮监控小窗（Floating Monitor HUD）**：
  - 新增 Tauri v2 独立置顶无边框透明悬浮窗模块（`src-tauri/src/monitor_window.rs`、`src/floating-monitor.tsx`、`src/floating-monitor-model.ts`），可通过身份管理页顶栏「悬浮监控窗」按钮一键开关，位置自动记忆至 `monitor-window-state.json`。
  - 实时呈现当前活跃账号、CLI 运行状态脉冲灯（运行中 `2.5s` / 空闲 `8s` 自适应本地轮询，零后台网络请求）、5h/7d 双窗口剩余百分比与精确重置倒计时、窗口消耗速率（Burn Rate Pace）与预计耗尽时间（Exhaustion ETA）、以及今日输入/输出/缓存/推理 Token 明细与最近 5 分钟 `tok/m` 实时流速。
  - 支持主窗口与悬浮窗跨窗口实时同步主题、自定义壁纸、毛玻璃光学参数与中英双语切换。
- **四维防封号与防风控安全加固**：
  - **零跨进程内存读取**：`src-tauri/src/windows_process.rs` 对原生 `claude.exe` / `versions\X.Y.Z.exe` / `cowork-svc.exe` 仅使用 `PROCESS_QUERY_LIMITED_INFORMATION` 句柄并结合 `(pid, created)` 进程缓存，彻底避免 `PROCESS_VM_READ` 与 `ReadProcessMemory` 触发反作弊/EDR 遥测。
  - **官方 Claude Code CLI 协议头对齐與出口国家门禁**：`scripts/claude_quota_online.py` 对齐 `claude-cli/<ver> (external, cli)` User-Agent、`anthropic-version: 2023-06-01`、`x-app: cli` 请求头，并在手动在线校准前通过 Cloudflare `/cdn-cgi/trace` 校验代理出口国家/地区，严防非支持地区 IP 触发风控。
- **生产力与交互体验升级**：
  - 新增 5h/7d 额度消耗速率标签（偏快/平衡/充裕）、残留清理分类筛选胶囊（全部/缓存/认证/历史/备份）、CLI 环境变量导出预览（PowerShell / Bash / JSON 一键复制）与用量分析 4 维 KPI 摘要卡片（缓存节省比、输出/输入比、日均 Token、活跃模型数），升级物理弹簧点击反馈、View Transitions 平滑切换动画及 UI/等宽字体栈设置。

账号隔离、切号确认、共享历史保留策略、保险库格式与 Python 账本单写者保持原有约束。
