<!--
[INPUT]: Verified 0.1.7 delivery (commit 765148f), documented completion (commit 9ea2df4), audited local installation, and private prerelease receipts.
[OUTPUT]: Comprehensive context-free project handoff for new sessions covering background, completed deliverables, current status, roadmap, and hard-earned pitfalls.
[POS]: Repository root handoff document. Machine-specific install paths, PIDs, private probes, and detailed receipts remain in ignored .local/.
[PROTOCOL]: Copy to .local/handoff-archive/ and verify SHA256 before rewriting. Do not rebuild or clean merely to refresh this document.
-->
# Claude-Local 会话交接与操作指南

更新时间：2026-10-22（时区 America/New_York）。
本文档面向**完全没有先前会话上下文的新会话/新协作者**编写。请先完整阅读本文档与根目录 `CLAUDE.md`，以此处记录的基线状态为准。

---

## 1. 我们在做什么任务（项目定位与本轮背景）

### 1.1 项目全貌与架构边界
Claude-Local 是一个独立维护的 Windows x64 桌面端产品：
- **核心定位**：本地加密身份备份与无缝切换、被动式 5小时/7天 额度观察、独立 Token 用量统计、环境配置与按需拉起的隔离伴生浏览器。
- **技术栈**：Tauri/Rust 原生层、React/TypeScript 前端界面、Python 被动额度采集管道。
- **产品边界**：
  - 主程序二进制为 `claude-local.exe`，应用标识为 `ai.local.claude-local`。
  - 用户数据独立存放于 `%APPDATA%/ai.local.claude-local`。
  - 伴生浏览器为按需子系统（通过显式用户动作或 `--browser` 启动），日常启动不拉起浏览器，默认展示身份管理页，仅持久化经过白名单验证的页面枚举。
  - 严禁添加上游远程同步、自动上游同步或官方应用更新源。
  - Python 是 `quota_ledger` 的唯一写入者（具备跨进程锁与原子替换）；Rust UI 仅只读该账本并在内存中合并；Token 统计则采用完全独立的原生账本。

### 1.2 本轮会话的起源与核心诉求
本轮工作由用户多阶段反馈与授权驱动：
1. **0.1.6 阶段问题修复与界面重构**：
   - 修复“YQ 账号的 5 小时额度进度条在达到重置时间后变成未知，而不是直接满额”的缺陷。
   - 解决按钮与下拉框尺寸过大、按钮颜色不统一（部分显黑色）的视觉体验问题，统一采用紧凑中性风格。
   - 重构电脑环境页面布局：将设备时区与语言并列成卡片（双列胶囊样式），地理位置精简为下方全宽横条。
2. **0.1.7 阶段开源借鉴与增量生产力功能落地**：
   - 参考优秀开源项目最佳实践，吸收有价值内容，落地 6 项核心生产力功能（身份检索排序、额度诊断、Ctrl+K 命令入口、任务交接便笺、TSV 用量导出、IANA/DST 时区用量统计）。
   - 修复额度百分比输入校验缺陷与 CLI 状态首次读取重试机制。
   - 最终执行端到端交付：源码构建、本地 13 项隐私探针审计、本机安全热更新替换、同提交 CI 校验及 GitHub 私有预发布。

---

## 2. 已经完成了什么（交付清单与详细成果）

### 2.1 0.1.6 核心修复与 UI 优化
- **预计已恢复（Reset Inferred）**：
  - 过去在额度重置时间到达后直接丢弃锚点置为 `unknown`。现在引入 `reset_inferred` 状态：当拥有受信任的服务端锚点、真实观测时间严格早于重置时间、且重置时间已过时，明确显示 0% 已用 / 100% 剩余，并清晰标注“预计已恢复”。
  - 绝不凭空推算未来的新重置周期，不将本地计算时间伪造成新观测时间，离线状态下不宣称掌握其他设备使用情况。
- **紧凑中性控件与颜色规范**：
  - 普通按钮统一高度 28px、水平内边距 10px，宽度自适应文字；移除原有 128px 强制最小宽度。
  - 统一采用中性 `secondary` 配色，消除不协调的纯黑按钮突兀感；仅危险操作保留红色确认。
  - 账号下拉筛选框宽度根据选中内容自适应，告别超大空白。
- **电脑环境页面布局重构**：
  - 将时区与语言卡片改造为并排对称卡片，内部结构分层清晰；容器宽度小于 572px 时自动响应式降级为单列。
  - 地理位置精简为卡片下方全宽小横条，紧凑且信息一目了然。

### 2.2 0.1.7 六大生产力功能落地
1. **身份检索与稳定排序**：支持按可见别名模糊检索，Esc 一键清空；支持按名称、保存时间及原始顺序排序；当前生效身份始终置顶固定；隐私模式开启时绝不暴露隐藏邮箱或原名。
2. **额度观测与白名单诊断复制**：展示各窗口真实观测来源及观测年龄；诊断信息导出采用严格字面白名单（仅包含版本、时间戳、配置布尔标志等），严禁泄露任何账号、Token、邮箱、路径或原始命令行数据。
3. **Ctrl+K / Cmd+K 命令面板**：支持八大功能页快速导航、当前活动页无损刷新、打开身份切换二次确认、唤起交接便笺；严格限制在其他模态框或任务锁激活时拦截快捷键，输入框内不劫持光标，回车绝不擅自执行不可逆切号。
4. **内存任务交接便笺**：提供任务名称、目标、进度、下一步、验证依据、约束条件 6 字段纯内存交接单；支持实时 Markdown 预览、复制到剪贴板与显式导出下载 `task-handoff.md`；不触碰会话历史，退出应用不自动持久化敏感草稿。
5. **当前聚合 Token 用量 TSV 导出**：支持当前筛选视角的统计数据复制与 TSV 文件下载；具备电子表格公式注入防护（防护 `=`、`+`、`-`、`@` 等注入前缀）；不输出隐藏推理 Token 或未来零值槽位。
6. **IANA / 真实 DST 历史用量统计**：支持前端传入命名时区（如 America/New_York）；原生引擎精确根据夏令时转换（23小时、25小时、重复小时偏移）以及 Lord Howe 等半小时转换区间进行事件聚合与平均值计算；非法时区友好拦截。

### 2.3 数据安全与 CLI 健壮性修复
- **畸形额度数据防御**：在 Rust 核心与 Python 采集端同步建立有限性检查，过滤负数、布尔值、超大异常数及 NaN/Infinity，将 100~101 微量舍入溢出安全归一为 100；额度摘要版本升至 **7**。
- **CLI 状态读取重试机制**：针对 Claude Code CLI 首次读取偶发超时或失败，区分“读取错误”与“未安装/更新错误”，提供无损的原地重试流程，避免误报未安装。

### 2.4 端到端交付与验证实证
- **版本基线**：产品版本正式升级至 **0.1.7**。
- **代码提交**：
  - 核心功能与构建配置提交：`765148f3e3c4b0d67f4f7e3e6cf6a2370d0ffaa5`（所有二进制、CI 和 GitHub Release 均严格对应此 commit）。
  - 文档交接收尾提交：`9ea2df433f055a21a8026cbd603ac613a95fc797`（仅包含 `HANDOFF.md` 更新）。
- **CI 验证**：Windows 官方工作流 **39777236360** 全步骤成功（包含代码静态检查、前端构建测试、原生测试、中立 NSIS 打包与私有草稿发布）。
- **本地 13 项隐私探针审计**：
  - 对解包出的 103 个安装包资源进行全量扫描，13 项私密标记 0 发现；
  - 资源清单与 CI 提取清单完全逐文件、逐 SHA-256 吻合；
  - 正确识别并验证了 Tauri 唯一的 3 字节安装包 Sentinel 变换（UNK -> NSS）。
- **本机安全热更新**：
  - 成功完成本机更新（安装目录读取自真实回执）；
  - 验证了全部 96 个程序文件，精准替换其中 13 个变更文件；
  - 替换前完成完整文件备份，更新后检测主窗口成功唤起、随包 Python 采集后端汇报为 `rust`；
  - 更新前后本机正在运行的 `claude.exe` 进程数严格一致（丢失数 0）。
- **私有预发布完成**：
  - GitHub 私有预发布已发布：`https://github.com/yq04/Claude-Local/releases/tag/v0.1.7`。
  - 包含 8 个经过独立下载和 SHA-256 严格双向比对的发布资产（安装包、SHA256SUMS.txt、隐私审计报告、资源清单、Release Notes、对应提交源码 ZIP、LICENSE、NOTICE.md）。
- **安装包与主程序哈希证据**：
  - 安装包 `Claude-Local_0.1.7_x64-setup.exe`，大小 133.54 MiB，SHA-256: `7e2272110c8bc7242e1439c402c23d31f620aa4ac8398f1fd05ac83c6b19589d`。
  - 本机主程序 `claude-local.exe`，SHA-256: `99b15c0e1f5d81cea14133dd8ccf661ecb068a43c8b546ecdeaa8053da1d7979`。

---

## 3. 当前卡在哪（现状、阻碍与真实边界）

### 3.1 核心交付现状：无任何阻塞
- **开发与交付已完全闭环**：0.1.7 的全部功能、测试、本地更新安装以及 GitHub 私有 Release 发布均已成功完成。
- **当前没有悬挂的紧急缺陷或未完成的交付任务**。

### 3.2 运行环境与审计边界限制（必须清楚认知）
1. **真实 NSIS 系统级安装/卸载验收限制**：
   - 本机采用的是“经过 13-probe 审计的安全文件替换事务（原子替换、备份、窗口拉起与回滚保护）”，并未执行 NSIS 安装包的静默覆盖安装或系统卸载程序。
   - 包含注册表写入、快捷方式创建、老版本数据无损继承等系统级真实安装验证，**必须保留给一次性（ephemeral）Windows 干净容器/虚拟机或 CI runner 进行**，绝不能在本机直接运行卸载破坏现有工作环境。
2. **本机内存资源限制与工作区保护**：
   - 本机承载有用户的实际工作（如大型 MATLAB 计算任务，占用数十 GB 提交内存）。
   - 本机曾两次在本地 release 编译（C++ 编译堆分配与 rustc 链接）时遇到 0xc0000409 内存耗尽错误；因此本轮交付明确策略为：**保护用户 MATLAB 进程，不改动系统分页文件，依赖远程 CI/Runner 完成正式编译**。
3. **GitHub Actions Artifact 配额满额限制**：
   - GitHub 仓库的免费 Actions Artifact 存储配额已满，导致标准 `upload-artifact` 步骤失败。
   - 本轮采用并验证了可靠的替代传输路径：工作流中设置 `delivery_transport=private-draft`，构建包上传至仓库**仅草稿（isDraft: true）、内部专用的临时 build draft release** 中进行传输，取回后本地脚本校验并下载。该临时传输草稿**严禁直接对外发布或删除**。

---

## 4. 下一步计划是什么（给新会话的行动指南）

新会话开始时，**请务必保持冷静，不要立即动手写代码或触发构建**。遵循以下顺序：

### 4.1 第一步：只读核对当前基线
在未获得用户明确的新增需求前，只做只读核验：
1. 检查当前 Git 状态：`git status`、`git log -n 2`。确认当前分支为 `main`，HEAD 为 `9ea2df4`，产品 tag `v0.1.7` 指向 `765148f`。
2. 检查本地安装程序：`D:/1_app/Claude-Local/claude-local.exe`，检查文件版本是否为 0.1.7，确认运行正常。
3. 检查忽略目录状态：确认 `.local/last-local-update.json`、`.local/release-0.1.7/session-close-receipt.json` 等回执均完好。

### 4.2 第二步：若用户提出新功能或新排查
根据用户的新指令推进工作：
1. 若要开展新需求设计，先查阅 `docs/PRODUCT_REVIEW_2026-10-22.md` 中尚未实施的后续规划，或倾听用户具体想法。
2. 如需在干净环境验证 NSIS 安装包的安装/卸载与数据迁移，应在一次性虚拟机中运行已发布的 `Claude-Local_0.1.7_x64-setup.exe`。
3. 若计划将项目由私有仓库转为公开发布，必须首先依据 `docs/DISTRIBUTION.md`、`LICENSE` 与 `NOTICE.md` 全面审计第三方（如 Cromma UI、Chromium 提取运行时）的版权边界，补充合规义务。

---

## 5. 有哪些踩过的坑绝对不要再踩（血泪避坑指南）

新会话请反复研读本节，每一条都是前车之鉴：

### 坑 1：Gemini / CPA 工具调用的 1:1 响应配对纪律（违者必导致整个会话报废！）
- **原理与严重后果**：在使用 CLIProxyAPI（CPA）号池调用 Gemini 模型时，Google 底层 API 严格要求每一次 `functionCall` 必须且只能对应一个同 ID 的 `functionResponse`。
- **致命雷区 1**：绝对严禁在 `functions__exec` 的 JavaScript 脚本内部调用 `notify(...)`！`notify` 会向队列额外注入一个相同 call_id 的响应，导致 CPA 队列错位，下一次工具调用直接抛出 HTTP 400（`invalid Gemini function call history: functionResponse.id does not match functionCall.id`）。该错误会被 Codex 固化进 session 数据库，后续该会话的所有轮次都会秒报 400，**会话彻底死亡无法恢复**！
- **致命雷区 2**：绝对严禁在 `functions__exec` 脚本内部调用 `yield_control()`！它同样会破坏 1:1 配对。
- **正道**：过程思考与进展汇报必须在工具调用之外通过正常的消息输出；脚本执行的所有结果必须在完成时通过唯一的 `text(...)` 统一返回！

### 坑 2：本地 Release 构建内存爆炸与 MATLAB 冲突
- **惨痛经历**：在开启多线程 cargo 编译（尤其是包含 C/C++ 依赖与大型 windows crate 链接）时，系统提交内存（Committed Memory）会瞬间暴增 10~20GB。当时用户后台正跑着占用 50GB+ 的重要 MATLAB 运算，直接导致编译器报 C1060（内存耗尽）与 0xc0000409 异常崩溃。
- **纪律**：
  - 严禁擅自杀掉、关闭或重启用户的任何无关进程（特别是 MATLAB、已有 Claude 会话等）！
  - 严禁自行修改系统的虚拟内存/分页文件设置！
  - 正式发布包的编译直接走 GitHub Actions 远程 Runner 构建，安全、干净且隔离，不要盲目在本机硬拼 `cargo build --release`。

### 坑 3：GitHub Actions Artifact 配额满导致构建无法下载
- **现象**：CI runner 上构建顺利完成，但在最后 `actions/upload-artifact` 步骤报错 `Artifact quota exceeded`。
- **避坑方案**：使用工作流已配置的 `delivery_transport=private-draft` 手动触发。它会将公开产物打成一个 ZIP，上传到一个始终处于 `draft: true`、`prerelease: true` 的内部构建 Release 中，既避开了 Artifact 配额，又绝不会把未审核的包对公开发布，同时绝不上传私密探针。

### 坑 4：前端哈希不一致之坑（CRLF vs LF，以及 Tailwind v4 扫描穿透）
- **现象**：本地打出的前端产物与 CI 编译的前端产物哈希对不上，导致本地包审计脚本拦截拒绝更新。
- **深层根因**：
  1. **CRLF vs LF**：Windows 本机旧工作树中的文件包含了 CRLF 换行符（如 SVG 图标），而 CI 环境是按 `.gitattributes` 检出的纯 LF 文件，导致构建工具产出的文件哈希产生微小偏差。
  2. **Tailwind v4 自动扫描穿透**：如果把 git archive 解压到当前项目内的某个子目录（例如 `.local/...`）并在该目录下执行 Vite build，由于没有独立的 Git 边界，Tailwind v4 会沿着目录向上扫描整个父级仓库的全部代码文件！提取出了多达 569 条多余的 CSS rules，导致编译出的 CSS 文件从 126KB 暴增到 160KB！
- **解决方案**：在独立目录执行前端复现前，必须执行 `git init --quiet` 建立独立的 Git 扫描边界，并且确保源码是以 Git 树对象导出的纯 LF 源码。

### 坑 5：PowerShell 严格模式（Strict-Mode）与参数绑定语法陷阱
- **陷阱 1**：`Test-Path $A -or Test-Path $B`
  - 在 PowerShell 7 中，如果不加括号，`-or` 会被当作 `Test-Path` 命令的位置参数，引发 `ParameterBindingException`！必须写成：`((Test-Path $A) -or (Test-Path $B))`。
- **陷阱 2**：`Set-StrictMode -Version Latest`
  - 脚本开头开启了最新严格模式，如果访问自定义对象中不存在的属性（例如旧回执可能没有 `installer` 字段，只有 `installerSha256`），PowerShell 会直接抛出 `PropertyNotFoundException` 导致整个脚本崩溃！在读取回执属性时必须防御性检查，或者对可选字段进行类型自适应。

### 坑 6：高危操作与破坏性 Git 清理禁令
- **硬性禁止**：严禁执行任何 `git reset --hard`、`git clean`、`git checkout --`、`git restore`、`git stash`（含 drop/pop）！
- **保护用户资产**：工作区中常年保留有用户未提交的配置与工具：
  - `AGENTS.md`（用户自定义的工作区总则）
  - `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/`（未跟踪目录）
  - 绝对不可将它们删除、暂存或还原！
- **保护 Claude 会话**：进行本地主程序热更新时，必须只对目标 `claude-local.exe` 进行精准 PID 识别与停止，严禁误伤终端中正在运行的 `claude.exe` 进程！更新前后必须做 PID 留存比对，丢失数必须为 0。

### 坑 7：数据流向与唯一写入者契约
- **唯一写入者**：Python 脚本（`scripts/claude_quota.py`）是 `quota_ledger.json` 的**唯一合法写入者**。它拥有文件跨进程锁，采用原子替换机制。
- **Rust/前端角色**：Rust 核心与前端**只读**该账本，在内存中进行重叠窗口合并与时效计算。绝对不要试图在 Rust 原生层直接写账本，也绝对不要在前端搞轮询 OAuth 或改写用户根目录的 `.claude.json`。

### 坑 8：提交与发布的版本分离契约
- **产品版本（0.1.7）**：代码已固定于 `765148f3e3c4b0d67f4f7e3e6cf6a2370d0ffaa5`，v0.1.7 tag、GitHub Release 以及所有安装包严格锁定该提交，确保二进制构建的一致性与可追溯性。
- **文档提交（skip ci）**：后续更新 `HANDOFF.md` 等文档使用独立的仅文档提交（如 `9ea2df4`），提交信息带 `[skip ci]`，虽然远程 `main` 分支的 HEAD 会前移，但产品标签绝不能随意移动，更不需要为了文档修改而去重新跑一遍构建或发布流程。

### 坑 9：更新 HANDOFF.md 必须遵守协议
- 在覆写 `HANDOFF.md` 前，必须先完整复制到 `.local/handoff-archive/` 下并用 SHA-256 严格双向比对备份完整性，严禁直接无备份覆写！
