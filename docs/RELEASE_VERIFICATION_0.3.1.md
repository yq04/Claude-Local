<!--
[INPUT]: Fixed v0.3.1 source, passing Windows CI, neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and local deployment receipts.
[OUTPUT]: Public release and local-update verification without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and installer execution remains outside this workstation check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.3.1 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权和 MIT 声明。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.1)：2026-11-09T08:35:54Z 发布为 Latest，非草稿、非预发布。
- 标签 `v0.3.1` 固定到源码提交 [`fa1fedde2982bc123986ed70b8ca95fdeb56e18a`](https://github.com/yq04/Claude-Local/commit/fa1fedde2982bc123986ed70b8ca95fdeb56e18a)。后续文档提交不移动该标签。
- [Windows source checks](https://github.com/yq04/Claude-Local/actions/runs/42585468806) 对同一完整提交执行，全部步骤通过；系统修改夹具仅在临时 Windows runner 上运行。

## 安装包

- [Claude-Local_0.3.1_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.3.1/Claude-Local_0.3.1_x64-setup.exe)：`140,896,139` 字节，约 `134.37 MiB`。
- SHA-256：`1551e85799f16bb7f6bfa8678d4e13f10e1efce2d85f3a41a10a7f786a7fc281`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.1/SHA256SUMS.txt)：安装包和校验文件的 GitHub 服务端 digest 均与本地对应文件一致。

本次使用新的中性 Cargo home/target、锁定依赖、固定浏览器引擎、单作业原生构建与 `custom-protocol`。NSIS 只读解包后的精确资源白名单/哈希审计通过：109 个文件、29 项外置隐私探针、0 项发现。探针内容、身份库、用户浏览器资料、账本及本机代理配置不属于构建或上传资产。

未打包宿主 SHA-256 为 `9ca91cf3f9ff08fb42573f5efe27e46282c6a1fa187c63d8265c31819117b5c9`；NSIS 内宿主为 `0579a61aa4886e34d7b22740a807719dc0a061c6abf843a55bafb00621285b66`。审计确认差异仅为 Tauri 唯一 bundle sentinel 的 `UNK` → `NSS` 三字节转换（偏移 `13554682`）。

## 验证范围

本机类型检查与前端构建通过；185 项 Bun 单测（26 个文件，14,193 次断言）、315 项全量 Rust 单元测试和 80 项核心合成 Python 测试（包审计 9、资源 2、本地额度 34、在线额度 35）通过。测试使用合成账号与隔离资料，不进行真实登录或切号。发布源码的完整 Windows CI（含全部 101 项 Python 与系统修改夹具）另行在临时 runner 通过。

## 本机更新

本机直接部署本次审计后的应用 payload：102 个应用文件逐一核验，其中 8 个需要替换，替换前原件已备份并核对哈希；NSIS 辅助文件不作为应用资源部署。旧版遗留文件不进行推测性清理。

安装宿主 SHA-256 为 `0579a61aa4886e34d7b22740a807719dc0a061c6abf843a55bafb00621285b66`，与安装包内宿主完全一致。0.3.1 已在交互式桌面启动并存在主窗口。本机更新前后即时快照确认当时运行的 Claude CLI 进程编号及启动时间一致（`missingClaudeCount = 0`）；只重启 Claude-Local GUI，没有向 `claude.exe` 发出停止操作。

更新仅处理明确的程序资源路径，未执行身份删除、切换、迁移或代理重载，未读取保险库内容来推断账号数量。实际 NSIS 安装/卸载生命周期没有在维护者电脑上执行，不能将文件更新当作安装器生命周期验收。

## 范围与兼容

本版交付智能接力与自动续杯弹窗全链路防卡顿优化、用量分析 2× 高清长图海报一键复制/保存与模型等高排版、净室切号设备指纹连续性（`s13`）及身份引导流程优化：

- **智能接力与自动续杯弹窗全链路防卡顿优化（GPU 合成 + React 渲染 + Rust IPC 单次读取 + Python 探针缓存）**：
  - **去除全屏 SVG `feTurbulence` 实时噪声滤镜与多层毛玻璃叠加**：移除 `.app-sidebar` 与 `.workspace` 全屏实时重光栅化的 `feTurbulence` SVG 滤镜，移除模态遮罩层 `.app-dialog-overlay` 的第二层 `backdrop-filter: blur(2px)`，为毛玻璃/自定义壁纸下的弹窗赋予 96% 高不透明隔离表面与 `contain: paint` / `contain: content`，并在弹窗开启期间自动暂停底层活跃身份卡片无限光晕动画（`clActiveCardAura`）。
  - **React 重型列表按需挂载与快照去重**：对 `batchTargetInfo`、`currentTargetSetKey`、`staleQuotaTargets`、`currentQuota`、`bestSaved`、`relayAccounts`、`relayEval`、`relayPoolSummary` 与 `wakeupAccountRows` 全面启用 `useMemo` 缓存；仅在弹窗打开时挂载自动续杯与智能接力内部账号列表 DOM；后台 `wakeup-scheduler-state` 15 秒轮询事件增加 JSON 序列化相等性去重（并在 Rust 侧仅在快照变更时发射事件）；自动续杯配置保存支持防丢片合并队列（`pendingAutoWakePatchRef`）。
  - **Rust 账本/元数据单次解析与 Python 运行时探针缓存**：`state_for` 与 `read_with_ledger` 将 `quota_ledger.json` 和 `quota_web_metadata.json` 由逐卡重复读取解析（`N + 2` 次）收敛为每次请求仅读取解析 1 次；`wakeup_runtime_capability` 按探针脚本路径、长度与修改时间缓存验证通过的 Python 解释器，修改自动续杯时间窗口或阈值时无需重复冷启动 `python.exe`。
- **用量分析 2× 高清海报一键复制/保存与等高排版**：顶栏新增「📸 截图数据」/「📈 截图趋势」与「导出 ▾」菜单，纯前端 Canvas 2D 离线渲染 2× Retina 高清海报（自动应用邮箱脱敏且零网络上传）；三模型分布固定按 `Opus` → `Sonnet` → `Haiku` 排序并与趋势图等高对齐，悬停展示 `Effort 档位分布` 浮层。
- **净室切号设备指纹连续性（`s13`）与统一引导**：跨号切换显式保留 `.claude.json` 中的 `userID`、`cachedGrowthBookFeatures` 与 `metricsStatusCacheByPrincipal`，避免同机频繁重置设备指纹触发异常风控；操作进度条收拢为单行水平胶囊，待登录新身份卡与养号引导统一为结构化步骤卡片。

`v0.3.0` 仍指向 `c784588e206be85d7bcccda4eadec5cebab3e8dc`，其安装包和校验文件保持不变。隐私探针和配置检查覆盖其明确检查范围，不构成任意秘密绝对不存在或账号免风控的保证。
