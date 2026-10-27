<!--
[INPUT]: Independent Windows x64 product, upstream CCBaga baseline attribution, 0.2.0 verified delivery and synthetic-data previews.
[OUTPUT]: Comprehensive project presentation, architectural lineage, feature matrix, installation workflow and runtime boundaries.
[POS]: Repository introduction; published artifacts retain versioned release notes.
[PROTOCOL]: Keep private data, format compatibility and distribution boundaries in linked project documents.
-->
# Claude-Local

面向 Windows x64 的 Claude 本地管理与用量分析工具。本项目**基于 [CCBaga](https://github.com/liseami/CCBaga)（由维护者 [@liseami](https://github.com/liseami) 与贡献者开源）二次开发**，在继承其多身份归档与浏览器隔离工作流的基础上，针对 Windows 桌面运行环境进行持续独立维护、工程重构与功能扩展。

Claude-Local 独立维护产品生命周期与版本序列，版本发布从 **0.1.0** 开始，当前版本为 **0.2.0**。应用基于 Tauri、Rust、React、TypeScript 与 Python 构建，支持 Windows 10 / 11 64 位操作系统，提供多身份本地加密存储、受进程检查保护的账号切换、被动额度监测、用量与 API 等效成本（USD）分析、进程内原生自动续杯调度、Token Monitor 风格桌面悬浮监控小窗以及可选的专属隔离浏览器环境。

[下载 0.2.0 Windows x64 安装包](https://github.com/yq04/Claude-Local/releases/download/v0.2.0/Claude-Local_0.2.0_x64-setup.exe) · [0.2.0 Release 页面](https://github.com/yq04/Claude-Local/releases/tag/v0.2.0) · [0.2.0 界面与监控升级](docs/UI_MONITOR_0.2.0.md) · [0.1.5 界面优化说明](docs/UI_POLISH_0.1.5.md) · [0.1.4 浏览器修复](docs/BROWSER_CSP_0.1.4.md) · [0.1.2 存储加固](docs/CRYPTO_HARDENING_0.1.2.md) · [0.1.1 登录同步](docs/AUTH_SYNC_0.1.1.md) · [0.1.0 首发版本](docs/RELEASE_NOTES_0.1.0.md) · [版本与标签约定](docs/RELEASE_POLICY.md) · [发布与维护说明](docs/PUBLIC_PREPARATION.md) · [项目来源与继承](docs/PROJECT_ORIGIN.md) · [与 CCBaga 的定位和取舍](docs/CCBAGA_COMPARISON.md) · [分发与许可边界](docs/DISTRIBUTION.md)

---

## 目录

- [与 CCBaga 的来源关系和定位](#与-ccbaga-的来源关系和定位)
- [界面预览](#界面预览)
- [主要功能](#主要功能)
- [获取与安装](#获取与安装)
- [运行前置条件](#运行前置条件)
- [从源码构建](#从源码构建)
- [数据安全与运行时边界](#数据安全与运行时边界)
- [已知局限与排障](#已知局限与排障)
- [参与贡献](#参与贡献)
- [开源许可与致谢](#开源许可与致谢)

---

## 与 CCBaga 的来源关系和定位

本项目脱胎于开源项目 [CCBaga](https://github.com/liseami/CCBaga)，感谢原维护者 [@liseami](https://github.com/liseami) 及社区贡献者的开创性工作。Claude-Local 在吸收上游架构设计的同时，结合 Windows 桌面环境与日常工程需求进行了系统性的独立演进：

### 继承的基线能力

- **存储规范与归档格式兼容**：完整保留原项目的 `BAGAID01` 文件头标识、`.baga` 加密归档结构、SQLite `user_version = 3` 数据库架构、账号 HMAC 生成规则以及持久化浏览器种子域，维持已有资料的读取兼容，避免因品牌或版本介绍调整而重建身份。
- **身份与浏览器资料关联**：延续了账号与专属运行环境相互绑定的设计原型，以账号绑定和显式切换减少凭据混用；这些目录不是操作系统账号沙箱，也不支持在运行中的CLI上热切号。

### 本地独立工程增强

- **专注 Windows x64 平台工程**：针对 Windows 桌面运行细节进行针对性加固，实现 Chromium AppContainer 缓存目录 ACL 继承修复、保留用户资料与配置的升级流程、系统网络修改前后的快照记录与冲突字段按需恢复。
- **用量分析与 API 等效成本核算**：建立本地被动额度采集机制，直接读取 CLI 本地会话记录与外部账本，完全避免改写 `.claude.json`；细分 5h / 7d 独立额度窗口，结合 Anthropic 官方 Claude API 模型单价自动计算 **API 等效花费（USD）** 与 **Prompt 缓存节省金额（USD）**，提供精确到 Token 消耗、去重响应数、单次均值、缓存命中率、模型家族（Opus / Sonnet / Haiku）及推理深度（Effort 档位：low / medium / high / xhigh / max）的统计图表与 TSV 导出。
- **进程内原生自动续杯调度与新一代 HUD 监控小窗**：由应用进程内的单一调度器管理，基于真实 5h 窗口与错峰预算策略自动执行唤醒，无需向操作系统注册计划任务或开机服务，应用退出即刻停止调度；配备借鉴 Token Monitor 设计的毛玻璃桌面悬浮监控小窗，支持置顶、位置锁定、18px 边缘磁吸、贴边自动隐藏为侧边胶囊、50%–100% 无级透明度调节，并随软件主题、强调色与自定义壁纸实时联动。
- **存储加密加固与灾备救援**：基于口令派生（PBKDF2/AES-GCM）导出整库加密备份，恢复前全面验证清单哈希、SQLite 完整性、记录归档数量及内层清单结构；支持导出隔离救援副本以保留排障证据。
- **交互体验打磨**：极简化的左侧导航栏与一体化顶部工具栏，支持深浅色模式与自定义壁纸、勾选「联动浏览器」切号自动拉起新账号专属浏览器验证页、`Ctrl+K` 命令中心快速检索、待办登录排队恢复通道等功能。

### 维护与边界声明

- **独立演进与独立发行**：Claude-Local 在本地仓库独立演进并手动发布 Windows 安装包，未设置针对 CCBaga 上游的代码库自动同步流程，亦不接入上游的应用自动更新端点或依赖对方的发行流水线。
- **开源许可边界**：保留原CCBaga贡献者版权与适用MIT声明；本项目贡献沿用顶层LICENSE，其他权利人的组件仍按各自条款处理，并不覆盖所有第三方依赖与美术资产（详见 [NOTICE.md](NOTICE.md)）。
- **非官方与无背书声明**：本项目不是Anthropic或CCBaga的官方发行，不代表其赞助、认证或支持承诺。

---

## 界面预览

以下六张图片截取自 0.2.0 版本的真实前端界面（主窗口视口 1280×900 及桌面悬浮监控窗视口）。所有展示数据均为隔离环境下的合成演示数据：账号与组织名称均为虚构，示例邮箱均启用了内置的隐私遮罩；图片中不含任何真实个人账号、代理凭据、本地敏感路径或网络环境隐私。

**身份管理**：一体化顶部胶囊工具栏、精简三步法引导、当前激活身份与独立的 5h / 7d 额度窗口。

![Claude-Local 身份管理：一体化工具栏、虚构账号和已遮罩示例邮箱](docs/screenshots/0.2.0/identity-management.png)

**用量分析**：同行时间范围、6 项核心遥测横条（含 API 等效美元花费与缓存节省）、历史趋势图及按模型等效成本分布。

![Claude-Local 用量分析：API 等效美元花费、缓存节省与趋势图](docs/screenshots/0.2.0/usage-analytics.png)

**桌面悬浮监控小窗（HUD）**：展示 5h / 7d 剩余额度、重置倒计时与耗尽预警、主力模型占比，以及 5h 消耗、实时速率（`tok/m`）和 5h 等效花费（USD），支持置顶、位置锁定、边缘磁吸、贴边自动隐藏与无级透明度调节。

![Claude-Local 悬浮监控窗：Token Monitor 风格遥测与多控制开关](docs/screenshots/0.2.0/floating-monitor.png)

**浏览环境**：精简顶部启动卡片，查看身份绑定的隔离资料目录、网络出口状态及十项环境核验。

![Claude-Local 浏览环境：精简顶部卡片及待测状态演示](docs/screenshots/0.2.0/browser-environment.png)

<details>
<summary>点击展开：快速配置与网络环境预览</summary>

**快速配置**：状态概览卡片、诊断项与常用设置入口。

![Claude-Local 快速配置：四个状态卡与设置入口](docs/screenshots/0.2.0/quick-setup.png)

**网络环境**：官方域名连通性检测与推广参考链接。

![Claude-Local 网络环境：固定复制操作与手动连通性检测](docs/screenshots/0.2.0/network-environment.png)

</details>

---

## 主要功能

- **身份管理与多账号切换**：支持本地加密备份与受保护的账号切换；当前身份固定置顶显示，其余账号沿用原生记录顺序；采用 PBKDF2/AES-GCM 口令派生导出加密归档，恢复前严格核验清单哈希、SQLite 完整性与归档记录数量。
- **被动额度监测与在线同步**：默认被动同步本地额度记录（读取 CLI 的 `/usage` 缓存与外部本地账本，不向 `.claude.json` 写入数据）；在线查询需用户显式确认开启，收纳于右上角独立弹窗中，弹窗关闭即停；外部账本由 Python 作为单写者，受内存并发锁与文件锁保护。
- **用量与 API 等效成本分析**：基于已采集的本地记录统计 Token 消耗量、去重响应数、单次均值、Prompt 缓存命中率，并按 Anthropic 官方 Claude API 模型单价自动计算 **API 等效花费（USD）** 与 **缓存节省金额（USD）**；细分模型家族（Opus、Sonnet、Fable、Haiku）与推理档位（Effort：max、xhigh、high、medium、low），支持时区夏令时（IANA/DST）纠偏、图表/明细切换、分页排序与当前筛选数据的 TSV 复制下载。
- **进程内原生自动续杯调度**：用户显式开启后，由应用进程内的唯一原生调度器运行，按严格的新 5h 周期与预算进行错峰唤醒；切页或最小化到托盘保持运行，应用彻底退出后立即停止工作；不注册任何系统服务或计划任务；唤醒动作会发送真实提示词并产生正常用量。
- **新一代额度悬浮监控窗（HUD）**：借鉴 Token Monitor 的桌面实时监控小窗，支持展开（`340×258`）、紧凑（`340×152`）与侧边胶囊（`52×138`）三态切换，内置置顶、位置锁定、18px 边缘磁吸、贴边自动隐藏、50%–100% 透明度调节，并随主界面浅/深色主题、强调色与自定义壁纸实时变化，不因监控本身增加任何网络查询负担。
- **可选隔离浏览器与切号自动联动**：伴侣浏览器 `Claude-Local-Browser` 仅在用户主动点击、指定 `--browser` 参数或勾选「联动浏览器」切号时启动；为每个身份绑定专属资料目录与稳定种子，勾选联动切号时自动打开新账号的浏览器检测与验证页面；内置 Chromium AppContainer 缓存目录 ACL 自动修复机制。
- **环境安全检测与快照回滚**：独立读取身份、浏览器、系统网络与 CLI 运行状态；在修改系统配置前自动记录修改前后的完整快照，支持配置冲突比对与按字段恢复；提供本地与浏览器环境的诊断参考。
- **连接修复队列与快捷操作**：统一查询遇到需重新登录或路由异常的账号集中排队，引导在已绑定的隔离浏览器中完成恢复；支持 `Ctrl+K` 快捷呼出命令中心进行页面跳转与功能检索。

---

## 获取与安装

### 下载安装包

请前往 Releases 页面下载最新安装程序，并核对安装包的 SHA-256 校验和：

- **当前最新版**：[下载 0.2.0 Windows x64 安装包](https://github.com/yq04/Claude-Local/releases/download/v0.2.0/Claude-Local_0.2.0_x64-setup.exe)
- **全部版本与更新日志**：[GitHub Releases 列表](https://github.com/yq04/Claude-Local/releases)

### 安装与运行说明

1. 本软件专为 **Windows 10 / 11 64位（x64）** 系统设计。
2. 安装包采用当前用户模式的 NSIS 安装程序，默认安装至 `%LOCALAPPDATA%\Programs\Claude-Local`，安装包由维护者独立打包发布且未签名。
3. 主程序可执行文件为 `claude-local.exe`，应用标识为 `ai.local.claude-local`，伴侣浏览器注册名为 `Claude-Local-Browser`。
4. 安装与升级不得以强制关闭 `claude.exe` 会话为手段；具体已验收范围见交付记录。主程序启动后默认进入身份管理主界面，正常启动不会自动打开伴侣浏览器。

### 数据兼容与升级策略

- 发行版本从 **0.1.0** 开始持续演进，应用配置与持久化数据存储于当前用户的 `%APPDATA%\ai.local.claude-local` 目录。
- 升级流程按保留用户资料、数据库、密钥和浏览器资料设计，不要求重建身份；已验证的文件式更新与尚待隔离环境验收的安装器流程须分别看待。
- **升级前建议**：在“软件设置 → 数据管理”的“身份备份与恢复”中创建加密备份，妥善保存备份文件与口令。

---

## 运行前置条件

为确保 Claude-Local 的各项功能正常运行，运行环境需满足以下条件：

1. **操作系统**：Windows 10 / 11 64-bit (x64)。
2. **Python 运行环境**：涉及Python额度采集或在线查询时，需要可用的Python与`cryptography`。当前CI使用Python3.13验证；Python和库不随应用自动安装，不对更低版本作未经验证的最低兼容承诺：

   ```powershell
   python -m pip install cryptography
   ```

3. **Microsoft Edge WebView2 Runtime**：Tauri 桌面端渲染依赖组件。Windows 10（更新版）和 Windows 11 通常已内置；若系统缺失，需前往微软官网下载安装 Evergreen 独立安装程序。
4. **可选伴侣浏览器**：完整Windows安装包已包含配套浏览器；是否启动由用户决定。源码构建时需按脚本准备固定版本引擎；仅做不依赖浏览器的本地功能开发可使用独立开发流程。

---

## 从源码构建

如需自行编译或参与开发，请先阅读[开发说明](docs/DEVELOPMENT.md)。在 Windows 环境下准备好开发工具链：Bun、Rust（MSVC 工具链）、Python 3、Visual Studio C++ Build Tools 以及 WebView2 Runtime。

### 1. 安装依赖与基础验证

```powershell
# 安装前端依赖（使用锁定文件）
bun install --frozen-lockfile

# 安装构建与测试所需的 Python 依赖
python -m pip install -r scripts/requirements-ci.txt

# 运行前端测试与构建
bun test src
bun run build

# 运行 Rust 核心单测
cargo test --locked --manifest-path src-tauri/Cargo.toml usage_tests
```

### 2. 构建 Windows 本地运行产物

本地开发编译可直接执行：

```powershell
bun run build:local
```

### 3. 构建完整 Windows 安装包

构建包含独立浏览器内核的完整发布包需先拉取引擎并安装 7-Zip：

```powershell
# 获取固定版本的伴侣浏览器引擎
python scripts/fetch-browser.py

# 执行完整打包脚本（自动在中性临时目录完成编译、打包与校验）
bun run build:windows
```

构建脚本在完成编译后会执行 NSIS 解包、资源相对路径校验与 SHA-256 完整性检查，最终在 `.local/artifacts/<id>/` 目录下生成独立的安装包与校验清单。

---

## 数据安全与运行时边界

- **纯本地单机存储**：所有用户身份库、加密密钥、额度/用量账本及浏览器个人资料均保存在本机的 `%APPDATA%\ai.local.claude-local` 目录中。本项目不提供账号凭据云端托管；明确触发的在线操作会请求目标Claude服务，环境观测会请求列明的出口数据服务。不会把本地身份库作为发行包或演示素材。
- **被动观察与单写者架构**：额度信息默认通过被动读取 CLI 的本地输出获得，额度采集路径不写 `.claude.json`；Python 脚本作为外部额度账本的唯一写入方，通过跨进程文件锁与原子替换维护写入一致性，减少并发冲突。
- **续杯与唤醒的合规认知**：自动续杯调度与手动唤醒本质上是向目标账号发送轻量请求以触发服务端的 5h 配额窗口刷新，每次唤醒都会产生真实的 API 请求并消耗少量正常 Token。唤醒操作无法凭空增加额度，亦不提供防封号、免风控或规避官方服务协议的保证。
- **操作保护与会话边界**：执行身份切换或配置清理时，系统会优先检查当前正在运行的 `claude.exe` 进程状态，阻断不适合在运行会话中执行的操作，不把强制结束CLI作为切号手段；关键配置修改均提供快照记录与回滚机制。

---

## 已知局限与排障

- **平台支持范围**：当前仅适配并验证 Windows x64 平台，暂不提供 macOS 或 Linux 的打包分发版本。
- **单身份便携包状态**：单账号便携包导出功能（bagapack）目前尚未完成实现，当前版本已提供完整的全库加密备份、恢复校验与隔离救援副本导出。
- **代码签名与环境兼容**：安装包由维护者独立构建，当前未进行代码签名，在部分系统上可能触发 SmartScreen 提示；安装与卸载逻辑尚未完成一次性Windows环境中的完整安装/升级/卸载验收；现有构建和解包校验不替代这些实测。
- **排障指引**：
  - 遇到网页登录后无法正常读取额度或 CLI 授权异常：请查阅 [网页额度与CLI授权恢复说明](docs/CONNECTION_RECOVERY.md)。
  - 遇到时区计算或用量统计显示偏差：请查阅 [用量统计说明](docs/USAGE_STATISTICS.md)。
  - 升级过程与分发范围疑虑：请参阅 [发布与维护说明](docs/PUBLIC_PREPARATION.md) 与 [分发与许可边界](docs/DISTRIBUTION.md)。

---

## 参与贡献

欢迎在[本项目Issues](https://github.com/yq04/Claude-Local/issues/new/choose)反馈问题或提出需求，或提交Pull Request改进项目。本仓库对自身改动负责，不将本项目问题转交给上游作者。在提交代码前，请参阅 [参与贡献指南](CONTRIBUTING.md) 了解开发规范：

- 自动化测试与验证必须使用虚构数据和隔离环境，严禁在开发测试中影响本地真实的 Claude 凭据与进行中的终端会话。
- 修改代码后需确保 `bun test src` 与相关定向脚本通过验证。

---

## 开源许可与致谢

Claude-Local 代码仓库遵循 [MIT 许可证](LICENSE)。

### 基础项目致谢与版权归属

- **[CCBaga](https://github.com/liseami/CCBaga)**：感谢项目发起者与维护者 [@liseami](https://github.com/liseami) 及社区贡献者。本项目继承了原项目的 MIT 授权核心代码、身份归档架构与存储协议，原版权声明保留于 [LICENSE](LICENSE) 中。

### 第三方组件与参考项目

- **[Fingerprint Chromium](https://github.com/adryfish/fingerprint-chromium)**：伴侣浏览器内核采用基于 Ungoogled Chromium 构建的定制引擎，保留原 BSD-3-Clause 声明。
- **vendor/cromma-ui**：本地界面复用组件树，其独立上游授权状态在 [NOTICE.md](NOTICE.md) 中予以客观记录并持续跟进。
- **[LobeHub lobe-icons](https://github.com/lobehub/lobe-icons)**：AI 工具矢量图标，遵循 MIT 许可证。
- **[ccusage](https://github.com/ccusage/ccusage)、[Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) 与 Token Monitor**：为本地用量账本统计、API 等效成本核算与桌面悬浮监控小窗（HUD）的实时遥测卡片设计提供了参考。
- **[CPA-Manager-Plus](https://github.com/seakee/CPA-Manager-Plus)**：为用量分析界面的视觉层级与交互排布提供了参考。
- **[Unicode CLDR 48](https://github.com/unicode-org/cldr)**：用于 Windows 与 IANA 时区名称映射，遵循 Unicode License。
- **Rust Crates**（`chrono`, `chrono-tz`, `phf` 等）：提供时区计算与编译期静态哈希表，遵循 MIT 许可证。

更完整的第三方归属清单与授权边界说明请参阅 [NOTICE.md](NOTICE.md)。

### 免责声明

Claude-Local 为独立开发的开源辅助工具，与 Anthropic 官方及 CCBaga 项目均无商业赞助、官方合作或背书关系。“Claude”、“Anthropic” 及其他相关名称、商标与图形标识均属其各自所有者的财产。
