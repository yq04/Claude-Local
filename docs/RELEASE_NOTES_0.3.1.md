<!--
[INPUT]: Verified 0.3.1 reasoning effort analytics, Windows browser cache DACL self-healing, compact browser/system layouts, single-layer workspace glassmorphism, 10/20-item native anti-ban probes, and practical copywriting.
[OUTPUT]: Version 0.3.1 release notes with actual source changes and verification boundaries.
[POS]: Immutable versioned release description; delivery receipts are recorded separately.
[PROTOCOL]: Do not claim synthetic checks establish live account authorization or installer acceptance.
-->
# Claude-Local 0.3.1

围绕「用量分析」模型与推理档位（Effort）分布、Windows 隔离浏览器缓存目录 ACL 自愈、「浏览环境」与「电脑环境」紧凑排版、单层工作区光学毛玻璃渲染引擎、原生 10/20 项防封环境核验、切换前额度/隔离对比以及全应用实用化文案进行全面升级，同时保持既有身份保险库、账本与本地额度同步边界不变。

- **用量分析：模型家族胶囊与推理档位（Effort）细分（`src-tauri/src/identities/usage.rs`、`src/usage-statistics.tsx`、`src/usage-model.ts`）**：
  - 在 `usage.sqlite` 的 `events` 表新增 `effort` 字段并支持历史 Claude Code JSONL 会话一次性自动回填，提取每次请求的推理档位（`max`、`xhigh`、`high`、`medium`、`low`）并按模型聚合。
  - 「模型分布」新增模型家族胶囊标签（`Opus`、`Sonnet`、`Fable`、`Haiku`）、输出 Token 明细、各推理档位的请求次数与占比进度条，以及底部单次请求均值与缓存命中率汇总栏；「用量趋势」新增活跃时段统计与柱状图悬停请求数/输出 Token 提示。
- **浏览环境与 Windows 缓存枚举 ACL 自愈（`src/browser.tsx`、`src-tauri/src/identities/private.rs`、`src-tauri/src/browser/profile.rs`）**：
  - 将「打开浏览器并实测」、「正常退出浏览器」与「设为默认浏览器」按钮整合进「启动内置浏览器与 CLI 授权联动」顶部标题栏，移除冗余虚线底栏；统一「浏览器数据」卡片内的次级说明与状态字号样式。
  - 新增 `ensure_owner_dacl` 与 `read_cache_dir` 自愈机制：当 Chromium AppContainer 沙箱改写 `Default\Cache` 子目录 ACL 导致枚举报 `PermissionDenied`（「无法枚举缓存。」）时，自动合并当前登录用户的 `OBJECT_INHERIT | CONTAINER_INHERIT` 访问控制项并恢复缓存大小统计。
- **电脑环境单行紧凑布局与网络诊断网格（`src/system.tsx`、`src/vps.tsx`、`src/style.css`）**：
  - 将「目标时区」与「目标语言」的小标题、下拉选择框及「系统设置 / 应用时区 / 应用语言」按钮合并为单行横向布局，显著压缩纵向空间。
  - 「网络环境」升级为 3 列等高准备卡与 `2×2` Claude 官方域名连通性诊断网格。
- **原生 10/20 项防封核验、单层工作区毛玻璃与悬浮监控窗稳固（`src/browser-verification.ts`、`src/style.css`、`src-tauri/src/monitor_window.rs`）**：
  - 内置 `Ping0.cc`、`CheckCC.org`、`BrowserScan`、`IPHey` 核心防封判据（ASN/ISP 住宅宽带 vs IDC 机房识别、硬件 WebGL、WebRTC 零泄漏、`webdriver` 隐身、语言列表纯净度），主界面「本机环境验证」满格展示 10 项（`5×2`），内置浏览器实测页展示 20 项（`5×4`）。
  - 自定义壁纸升级为「单层工作区统一毛玻璃画布 + 零模糊轻盈内卡」架构，解耦卡片外框高光与内部细分割线，浅色/深色模式自适应柔光或暗幕遮罩。
  - 实时额度悬浮窗（HUD）锁定 `340×278` / `340×152` 精确尺寸约束并禁用双击最大化，身份卡片统一采用 `MM-DD HH:mm` 重置时间格式与进度条右下角静态 `5h` 角标。
- **额度对比、账号隔离展示、会话接力与实用化文案（`src/identities.tsx`、`src/task-handoff.tsx`、`src/locales/*.yaml`）**：
  - 在「额度详情」与「确认切换账号」弹窗中新增「当前剩余额度 vs 目标账号额度」对比及「账号隔离状态」（独立浏览器配置绑定 + 专属代理状态）；会话接力模板新增「清空草稿」按钮。
  - 全应用中英文标签、备注与设置说明全面去浮夸化，采用简明实用的表述。

账号隔离、切号确认、共享历史保留策略、保险库格式与 Python 账本单写者保持原有约束。
