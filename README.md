<!--
[INPUT]: Independent product source, version metadata and initial public candidate requirements.
[OUTPUT]: Product overview, build/verification entries and retained-data upgrade expectations.
[POS]: Repository introduction; published artifacts retain their own versioned release notes.
[PROTOCOL]: Keep private-data, compatibility and distribution boundaries in the linked project documents.
-->
# Claude-Local

面向 Windows x64 的 Claude 本地管理工具，集中管理身份备份、账号切换、用量分析和可选的隔离浏览器。使用 Tauri、Rust、React、TypeScript 与 Python，独立维护产品和版本。

当前候选版本：**0.1.0**（首次公开候选版本编号重置，尚未公开发布；既有 v0.3.0/v0.3.1 标签保持）。已整合用量分析模型推理档位（Effort）分布、原生自动续杯周期调度、可开关悬浮监控窗、Windows 隔离浏览器缓存目录 ACL 自愈及连接恢复反馈修复。支持 Windows 10 / 11 x64；主程序与可选的 Claude-Local Browser 使用独立产品入口。候选已完成本机文件式更新，正式安装/降级包验收仍单独进行。

[版本说明](docs/RELEASE_NOTES_0.1.0.md) · [公开筹备边界](docs/PUBLIC_PREPARATION.md) · [与 CCBaga 的定位和取舍](docs/CCBAGA_COMPARISON.md) · [开发说明](docs/DEVELOPMENT.md) · [用量统计](docs/USAGE_STATISTICS.md) · [分发与许可边界](docs/DISTRIBUTION.md) · [参与贡献](CONTRIBUTING.md)

[下载 0.1.0 Windows x64 安装器](https://github.com/yq04/Claude-Local/releases/download/v0.1.0/Claude-Local_0.1.0_x64-setup.exe) · [预发布页面](https://github.com/yq04/Claude-Local/releases/tag/v0.1.0) · [打包、上传与本机一致性核验](docs/RELEASE_VERIFICATION_0.1.0.md)。当前仓库保持私有，下载需要仓库访问权限。

遇到网页登录后仍无法查询或唤醒，先看 [网页额度与CLI授权恢复说明](docs/CONNECTION_RECOVERY.md)：两套授权独立，重试会分别显示网页读取失败和CLI唤醒阻断原因。

## 主要功能

- **窗口与系统托盘**：关闭主窗口可隐藏到托盘，退出菜单结束应用；保留主窗口尺寸和最大化状态。
- **原生自动续杯调度**：用户明确开启后，由应用进程内的唯一调度器运行；切页或隐藏到托盘不停止调度，应用退出后不工作。不注册系统服务或计划任务，与手动唤醒共用账号校验、提交复核和错峰预算；未知结果与授权失败有明确等待/恢复状态。主动唤醒发送真实消息并产生用量，不等于增加额度。
- **额度悬浮监控窗（HUD）**：可开关的置顶窗口，展示本地额度与会话用量遥测，不为监控新增在线查询。
- **身份管理**：本地加密备份与恢复、账号快速切换和保留策略。当前身份固定显示，其余账号沿用原生记录顺序；采用口令派生（PBKDF2/AES-GCM）导出加密备份，恢复前全面验证清单哈希、SQLite 完整性、记录/归档数量及内层清单结构。
- **额度同步**：默认被动同步本地额度记录（读取 CLI 的 `/usage` 及外部写入的本地账本，不主动轮询或写入 `.claude.json`）；在线查询需用户显式确认（opt-in），收进右上角菜单独立弹窗，关闭弹窗即停止定时在线轮询；OAuth 授权失效或网络断开时明确标记待重连，不借用或混淆其他账号凭据；Python 外部账本单写者与内存并发锁保护。
- **用量分析**：查看 Token、缓存命中率、模型家族（Opus、Sonnet、Fable、Haiku）与模型推理档位（Effort：max、xhigh、high、medium、low）细分统计，支持图表/数据、排序分页及当前筛选 TSV 复制下载；按 IANA 时区处理历史夏令时和真实小时区间。未确认归属的记录仅按用户明确的稳定规则聚合，个人选择不随包分发。
- **快速配置与环境核验**：按需独立读取身份、浏览环境、电脑环境与 CLI 状态，显示具体异常并支持手动刷新；电脑环境记录时区、语言与定位状态，系统修改前自动记录前后快照，支持冲突对比与按字段安全恢复；提供 10 项本机与 20 项浏览器环境检查核验项（ASN/ISP 属性、WebGL 硬件信息、WebRTC 配置、隐身状态等参考诊断）。
- **网络环境与推广参考**：手动检测固定 Claude 官方域名连通性；仅提供项目所有者授权的固定推广参考链接（iKuuu / Kookeey，仅支持一键复制，不含自动外跳、推广链接编辑器或安装级重定向）。
- **可选隔离浏览器**：伴侣浏览器 `Claude-Local-Browser` 仅在用户显式操作或 `--browser` 时启动；按身份绑定专属隔离资料目录与稳定种子，切号联动时保持运行状态（运行则重启对应资料，关闭则保持关闭）；包含 Chromium AppContainer 缓存目录 ACL 自动修复机制。
- **CLI 维护与首次引导**：未安装时展示官方 PowerShell 安装命令复制与重新检查入口；已安装时手动检查更新并原位更新，运行中明确阻断，不强制结束运行中会话。
- **全库备份与救援**：基于口令派生导出加密备份，恢复前全面验证清单哈希、SQLite 完整性、记录/归档数量及内层清单结构；支持导出隔离救援副本以保留排障证据。
- **连接与路由修复队列**：统一查询遇到需重登或路由变更的账号集中排队，指引在已绑定的隔离浏览器中登录，支持统一重试待办。
- **快捷操作与便笺**：Ctrl+K / Cmd+K 搜索页面、刷新或打开现有身份确认；提供六字段手填便笺、Markdown 预览与复制/下载，草稿仅保留在本次运行内存中。

## 获取与安装

本仓库按公开筹备与私有审阅范围维护。手动发布的测试包附带 SHA-256、隐私审计报告、资源清单及更新说明；CI 仅执行非破坏性检查和可选的私有构建产物，不自动创建 GitHub Release 或官方更新源。

安装包使用当前用户 NSIS 安装，按所有者决定继续保持未签名。构建与解包校验不等于安装、升级和卸载验证；第三方组件的公开分发许可仍以 [分发说明](docs/DISTRIBUTION.md) 为准。

主程序：`claude-local.exe`；应用标识：`ai.local.claude-local`；浏览器注册：`Claude-Local-Browser`。主程序默认进入身份管理，正常启动不会打开浏览器。

### 版本回退与数据兼容提示（私测用户必读）

本次 `0.1.0` 属于首次公开候选版本编号重置。对于此前已安装内部私测版 `0.3.1` 的用户，切换或安装 `0.1.0` 在语义版本上属于版本号倒退（Downgrade）：
- **资料标识保持**：应用标识、资料目录以及 `BAGAID01`、`.baga`、身份库 `user_version=3`、HMAC 和浏览器种子未因版本编号重置而改变。
- **安装与降级行为**：Tauri 配置 schema 默认允许降级，现有安装钩子设计为先确认、保留资料卸载旧版再安装；0.3.1→0.1.0 的实际安装尚未验证，应先在隔离 Windows 环境完成备份、取消/失败及资料保留验收。

## 从源码构建

准备 Bun、Rust MSVC、Python、Visual Studio C++ Build Tools 和 WebView2 Runtime，使用现有锁文件：

```powershell
bun install --frozen-lockfile
python -m pip install -r scripts/requirements-ci.txt
bun test src
bun run build
cargo test --locked --manifest-path src-tauri/Cargo.toml usage_tests
```

构建完整安装包还需固定版本的浏览器引擎和已有的 7-Zip：

```powershell
python scripts/fetch-browser.py
bun run build:windows
```

`build:windows` 在工作区和用户目录之外创建全新的中性 Cargo 构建目录，仅复制 crates.io 索引与归档缓存，保留原有缓存及 Rustup。正式构建启用 `custom-protocol`，完成 NSIS 只读解包、资源路径与 SHA-256 校验后，输出唯一的 `.local/artifacts/<id>/` 目录。可通过 `-BuildRoot` 指定满足相同边界的新目录，通过 `-SevenZipPath` 指定已有 7-Zip，通过 `-PrivateMarkersFile` 提供仓库之外的私密审计标记。

开发用本地编译可使用 `bun run build:local`；文件式部署默认写入当前用户的 `LocalAppData/Programs/Claude-Local`。已有安装的更新应先备份、核对进程和文件，再以可回滚方式替换；安装程序和个人资料不应成为构建输入。

## 数据边界

- 应用数据按用户存放在 `%APPDATA%/ai.local.claude-local`，包含身份库、密钥、额度／用量账本及浏览器资料，不随安装包或源码分发。
- 身份切换管理当前用户默认 Claude 工作区；独立应用目录不等于操作系统沙箱。破坏性操作保留明确确认、进程检查和回滚。
- 额度采集不后台轮询、不写入 `.claude.json`、不自动轮换 CLI 授权。在线读取只使用该账号已有的有效授权，过期时提示重新授权；前台近实时默认关闭且仅在本次运行内保留。Python 是外部额度账本和网页元数据的唯一写入方，用量统计使用独立账本。
- 账号隔离优先于新鲜度：统一查询冻结所有目标指纹，每个请求分别验证服务端账号/组织，提交前复核身份和授权；目标账号集合改变时撤销前台模式。授权有效性由只读服务验证，不仅凭本地过期日期拦截；不会自动轮换共享授权。缺少身份验证时拒绝更新，不借用其他账号。
- 开发、测试和本地更新不得中断运行中的 `claude.exe`；自动测试使用虚构数据和隔离环境。
- 迁移只复制到新的私有目标并校验完整性、哈希与身份数量，保留源资料。兼容现有 `.baga` 格式、账号 HMAC 和浏览器种子。

## 验证

```powershell
python scripts/browser_ui.py dist
python scripts/test-claude-quota-local.py
python scripts/test-claude-quota-online.py
python scripts/test-migrate-local-data.py
python scripts/test-fetch-browser.py
python scripts/test-audit-windows-package.py
node scripts/test-local-shell.mjs
node scripts/test-usage-statistics.mjs
```

系统修改、安装／升级／卸载测试仅在临时 Windows 环境执行，不能在个人工作机上运行 CI 专用系统测试。

## 许可与归属

保留原 CCBaga 贡献者的 MIT 版权及第三方声明，详见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。应用代码的 MIT 声明不替代第三方组件、图标或浏览器的许可。当前 Cromma UI 复制树的独立许可及 Chromium 完整声明清单仍需核实，公开源码或二进制分发必须遵守这些边界。

Claude-Local 独立于 Anthropic，未获官方背书（endorsement），不提供上游同步、官方应用更新端点或自动公开发布流程。
