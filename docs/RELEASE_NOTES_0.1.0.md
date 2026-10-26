<!--
[INPUT]: Baseline capabilities from internal versions 0.1.0 through 0.3.1, version metadata reset for public candidate, and distribution boundaries.
[OUTPUT]: Initial public candidate 0.1.0 release notes with scope, compatibility and verification limits.
[POS]: Candidate release description; local file updates remain separate from public installers/releases and repository visibility.
[PROTOCOL]: Do not claim current public release or overwrite internal git history.
-->
# Claude-Local 0.1.0 (首次公开候选版本)

本版本将产品编号重置为首次公开候选版本 0.1.0，功能基线为 `9b89502` 的本地源码，包含此前迭代功能及尚未安装交付的 Astra 优化。

当前处于**公开筹备阶段，尚未转为公开仓库**；0.1.0 已完成本机更新、正式 NSIS 打包及当前私有仓库的预发布上传。内部历史记录与既有 `v0.3.0`、`v0.3.1` 标签保持原样，不覆盖或改写。安装器、校验值和实际验收范围见 [交付核验](RELEASE_VERIFICATION_0.1.0.md)。

连接恢复修复：网页额度查询失败与CLI唤醒授权分开显示，浏览器补充查询保留具体失败，手动门禁给出冷却/授权原因；参见 [恢复说明](CONNECTION_RECOVERY.md)。

## 继承功能与候选版本范围

- **单实例运行与系统托盘管理（`src-tauri/src/main.rs`、`src-tauri/src/window_state.rs`）**：
  - 主窗口可隐藏到托盘，退出菜单结束应用；原生层保存主窗口尺寸与最大化状态。
- **原生自动续杯周期调度（`src-tauri/src/identities/wakeup.rs`）**：
  - 应用主进程创建唯一的进程级自动续杯 owner，仅在应用运行或托盘常驻时有效，完全退出（Exit）时立即停止；
  - 需用户明确开启，不注册系统服务或计划任务；与手动唤醒共用账号/提交门禁及错峰预算，未知结果与授权失败按状态处理，不立即盲目补发。主动唤醒会发送消息并产生用量。
- **实时额度悬浮监控窗（HUD）（`src-tauri/src/monitor_window.rs`）**：
  - 可开关的置顶窗口，展示本地额度与会话用量遥测，不为监控新增在线查询。
- **身份管理与本地加密保险库（`src/identities.tsx`、`src-tauri/src/identities/`）**：
  - 集中管理 Claude 多身份的本地加密存储、当前身份展示与快速切换；
  - 采用标准 `BAGAID01` 归档编码、SQLite（`user_version=3`）与 HMAC 密钥派生规则；
  - 支持口令派生（PBKDF2/AES-GCM）导出加密全库备份；恢复前严格验证清单哈希、SQLite 完整性、记录/归档数量及内层清单结构；支持导出隔离救援副本以保留排障证据。
- **额度同步：被动为主与显式授权（`src-tauri/src/identities/online.rs`、`src/identities.tsx`）**：
  - 默认被动读取本地额度：监听 CLI `/usage` 及外部写入的本地账本，不主动轮询或写入 `.claude.json`；
  - 在线查询需用户显式操作（opt-in），收进右上角菜单独立弹窗；关闭弹窗即停止定时在线轮询；
  - OAuth 授权失效或网络断开时明确标记待重连，不借用或混淆其他账号凭据；Python 外部账本单写者与内存并发锁保护。
- **用量分析与推理档位（Effort）细分（`src-tauri/src/identities/usage.rs`、`src/usage-statistics.tsx`）**：
  - 深入支持按模型家族（Opus、Sonnet、Fable、Haiku）与推理档位（`max`、`xhigh`、`high`、`medium`、`low`）细分统计 Token 用量、缓存命中率与单次请求均值；
  - 提供用量趋势活跃时段统计、柱状图悬停明细与筛选结果 TSV 导出；按 IANA 时区处理夏令时与真实小时区间。
- **电脑环境、修改快照与参考核验（`src/system.tsx`、`src/browser-verification.ts`）**：
  - 独立读取与展示时区、语言和定位状态；系统修改前自动记录前后快照，支持冲突对比与字段级安全恢复；
  - 提供 10 项本机与 20 项浏览器环境检查核验项（ASN/ISP 属性、WebGL 硬件信息、WebRTC 配置、隐身状态等参考诊断）；连通性测试针对固定 Claude 官方域名。
- **可选隔离浏览器（`src-tauri/src/browser/`、`src/browser.tsx`）**：
  - 伴侣浏览器 `Claude-Local-Browser` 仅在用户显式触发或 `--browser` 参数时启动；
  - 按身份独立绑定隔离资料目录与稳定种子，切号联动时保持运行状态（运行则重启对应资料，关闭则保持关闭）；包含 Chromium AppContainer 缓存目录 ACL 自动修复机制。
- **合规推广参考（`src/vps.tsx`）**：
  - 仅提供项目所有者授权的固定推广参考链接（iKuuu / Kookeey，仅支持一键复制，不含自动外跳、推广链接编辑器或安装级重定向）。
- **CLI 维护与首次引导（`src/identities.tsx`）**：
  - 未安装时提供官方 PowerShell 安装命令一键复制与重新检查；已安装时支持手动检查更新并原位更新，运行中明确阻断，不强制结束运行中会话。

## 数据兼容与旧版私测升级/降级提示

1. **底层存储格式保持不变**：
   - 本次编号重置未修改 `BAGAID01`、`.baga`、身份库 `user_version=3`、HMAC 或浏览器种子；数据格式版本不跟着产品版本回退。
   - 应用标识保持为 `ai.local.claude-local`，应用数据根目录保持为 `%APPDATA%/ai.local.claude-local`。
2. **私测用户 0.3.1 → 0.1.0 版本回退（Downgrade）注意**：
   - 对于此前参与内部测试并已安装 `0.3.1` 版本的用户，从 `0.3.1` 切换到 `0.1.0` 在语义版本号上属于版本倒退；
   - Tauri schema 默认允许降级，现有安装钩子设计为确认后保留资料卸载旧版再安装；
   - 本轮未执行实际降级安装。正式发包前应在隔离 Windows 环境验证备份、取消/失败与资料保留，不能用配置默认值代替运行验收。

## 许可合规与分发边界

- 本项目保留 CCBaga 与本项目贡献者的 MIT 声明，见 [LICENSE](../LICENSE) 与 [NOTICE.md](../NOTICE.md)。
- 第三方许可材料尚未完全核实，尤其是 Cromma/Pika 的实际子集及 Chromium notices；公开源码与二进制须分别满足适用条件，见 [分发边界](DISTRIBUTION.md) 和 [公开准备](PUBLIC_PREPARATION.md)。
- **免责与独立性声明**：Claude-Local 是独立维护的本地桌面工具，与 Anthropic 官方无任何隶属关系，未获官方背书（endorsement），亦不提供上游自动同步或官方更新通道。
