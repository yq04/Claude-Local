<!--
[INPUT]: Inferred elapsed trusted quota reset, adaptive button and filter geometry, paired system card layout, and workspace verification evidence.
[OUTPUT]: Version 0.1.6 release notes without workstation paths, real account identifiers, or unverified publication claims.
[POS]: Manual local/private delivery notes; build, deployment, and publication status are established by delivery receipts.
[PROTOCOL]: Preserve NOTICE.md distribution boundaries; never claim an installed update or passing CI from source-only changes.
-->
# Claude-Local 0.1.6

引入到期额度的明确预计恢复机制，优化普通操作按钮与用量筛选控件几何尺寸，并重构电脑环境卡片排版。改动已完成针对性验证与构建检查；是否已构建安装包、部署或发布，以本次交付回执为准。

## 额度到期预计恢复

- 可信服务端重置到期推定：针对具有真实且早于重置时间的服务端快照（trusted server anchor），当已知重置时间到达后，展示 0% 已用 / 100% 剩余，并明确标注「预计已恢复」。
- 保守推断与证据保护：不猜测下一次重置时间（原始过去的重置时间仅作为依据保留，界面不展示为下一重置时间），不把当前计算时间作为新观测；纯本地估算（pure local）或缺少依据的窗口继续保持未知（unknown）。预计恢复不参与自动切号推荐，新的真实观测窗口优先。
- 离线限制说明：离线状态下无法确认其他设备后续是否产生新用量，100% 剩余是界面明确标注的本地预计值。
- 历史账本回填与版本演进：从账号与组织严格匹配的原始账本与缓存中恢复旧版已清空的过期证据；额度摘要版本升至 6 触发现有惰性回填，SQLite 保持 `user_version=3`，身份数据与 `.baga` 归档格式保持兼容。
- 本地时钟与独立窗口：身份管理页增加前台可见时的本地显示时钟，静置跨过重置时间即可就地平滑更新状态，不增加原生读取或网络请求频率；5h 与 7d 窗口依然保持独立。

## 控件几何与界面布局

- 紧凑按钮与中性样式：普通操作按钮统一采用现有 `secondary` 中性皮肤，尺寸收敛为 28px 高度及 10px 水平内距，宽度随文字内容自适应，移除网络页面 128px 强制最小宽度。危险确认操作保留红色醒目提示；导航、图标与身份工牌专用几何保持原样。未修改 vendor 原语或依赖。
- 自适应账号筛选：用量分析页面的账号筛选下拉框改为随所选文字自适应占宽，采用小档高度，长名称限制最大宽度 220px，下拉选项弹层保留充足阅读空间。
- 电脑环境卡片重构：时区与语言重构为并排等宽圆角卡片，目标选择独占一行、操作按钮靠右排布；窗口宽度窄于 572px 时自动堆叠为单列。定位状态保留为下方全宽紧凑横条，保留原有真实状态/草稿、授权、禁用和任务锁行为。

## 架构边界与兼容性

- 写入者契约：Python 仍然是额度账本的唯一外部写入方，继续执行跨进程锁、锁内重读与原子替换；Rust 核心仅在内存中合并与计算有界元数据，不直接写入账本。
- 环境与依赖：安装包不包含 Python 或 cryptography 运行时，不自动修改已有 statusLine 配置，不改动现有钩子。
- 格式兼容：`.baga` 归档编码、账号 HMAC 计算逻辑以及伴生浏览器种子算法完全保持兼容。

## 验证与状态

本版改动已完成针对性验证：包括 Rust core 7 项测试、profile quota regression 12 项测试；Python 31 项测试（包含真实 debug Rust 子进程与 legacy 对照）；Bun 额度及双语 12 项测试；TypeScript/Vite 构建及普通 debug Rust 构建；以及 10 组隔离 GUI 页面渲染与测量。本文件记录源码与架构改动，不提前声称已构建 Windows 安装包、已通过 CI 或已发布。
