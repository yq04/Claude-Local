<!--
[INPUT]: Immutable public v0.2.0 baseline and owner-authorized v0.2.2 release preparation, token-focused telemetry, synthetic verification and retained limitations.
[OUTPUT]: Context-free handoff covering active goal, completed work, current status/blockers, next actions and pitfalls.
[POS]: Repository-root maintenance handoff; private identities, process details, paths and probes stay in ignored .local/.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only changes do not rebuild binaries, replace assets or move product tags.
-->
# Claude-Local 新会话交接文档（v0.2.2 发布准备）

更新时间：2026-10-29（America/New_York）。
**写给完全没有上下文的新会话**：请先通读本文、根目录 `AGENTS.md` 与 `CLAUDE.md`；修改具体模块前再阅读对应子目录的 `CLAUDE.md` 与文件头部注释。

## 本轮增量：v0.2.2

用户已授权发布 v0.2.2；此前 0.2.1 仅为本机维护候选，没有公开发行。目前正在构建与审计新的 Windows x64 安装包，公开 Latest 暂为 v0.2.0；发布完成后更新本节。下方 v0.2.0 内容保留为历史交付基线。

- 统计身份独立于归档登记；受控新登录后可统计续聊产生的新响应；保留请求去重、账号证据与四类 Token 总量守恒。已有历史默认规则限制在固定截止时间内，不扩大到未来记录。
- 用量页突出四类 Token 构成、明确会话/活跃日、去重响应、全部模型与 Effort。移除美元猜价；账号下拉仅显示“全部”和动态正常账号，不再呈现历史规则或内部归属状态。
- 小窗与用量页共享按账号隔离的账本，显示滚动近 5 小时用量及近 10 分钟平均速率；保留配额来源、重置时刻与三态窗口能力，移除无证据的上下文/耗尽预测。
- 公开说明见 `docs/RELEASE_NOTES_0.2.2_USAGE.md`。`docs/USAGE_RELIABILITY_0.2.1.md` 仅记录维护候选的工程过程；当前界面以 0.2.2 为准。新用量图为合成、遮罩示例，其他 README 页面保留标注版本的历史图片。
- 私有维护、账号核验和本机运行回执保存在忽略的 `.local/` 中，不属于源码或发行材料。发布不得引用真实账号、机器路径、账本、个人截图或配置。预存 `AGENTS.md` 改动保持原样且不提交。
- v0.2.0 标签与已公布安装包保持不可变。新版本使用独立标签、全新中性路径构建、解包资源/隐私审计与 SHA256；不执行真实安装/卸载向导，不中断 Claude CLI 或用户浏览器。

---

> **v0.2.0 公开基线结论（历史交付记录）**：
> **Claude-Local `v0.2.0` 已全部开发、验证、打包、更新本机并正式发布至 GitHub Release（Latest）**。本机 `%LOCALAPPDATA%\Programs\Claude-Local\claude-local.exe` 已无中断升级至 `0.2.0`；GitHub 仓库已完成中英双语旗舰级 `README.md` / `README_EN.md`、13 张合成脱敏截图（`docs/screenshots/0.2.0/`）、仓库 About 简介与 `v0.2.0` Release 页面升级。**当前没有任何代码、测试、打包或发布阻塞**；新会话切勿无故重打包、移动 `v0.2.0` 标签、强杀运行中的 `claude.exe` 或提交 `AGENTS.md`。

---

## 1. 我们在做什么任务（项目定位与核心规则）

### 1.1 项目定位
- **产品名称**：**Claude-Local**（基于开源项目 [CCBaga](https://github.com/liseami/CCBaga) 二次开发并独立维护的 Windows 10 / 11 x64 桌面应用，非全仓原创，亦非 Anthropic 或 CCBaga 官方发行）。
- **技术栈与标识**：Tauri 2 + Rust（原生事务与进程/文件安全边界）+ React 19 / TypeScript（前端工作台与悬浮监控窗）+ Python 3.10+ / `cryptography`（外部额度账本单写者与口令备份加解密）。
  - 主程序二进制：`claude-local.exe`
  - 应用 Bundle ID：`ai.local.claude-local`
  - 伴侣隔离浏览器：`Claude-Local Browser`（Windows 注册名：`Claude-Local-Browser`）
  - 用户持久化数据目录：`%APPDATA%\ai.local.claude-local`（按用户隔离，非 OS 账号沙箱）
  - 默认安装目录：`%LOCALAPPDATA%\Programs\Claude-Local`

### 1.2 必须遵守的用户偏好与架构铁律
1. **对外发行序列**：从 **`0.1.0`** 开始计数，依次发布了 `v0.1.0`、`v0.1.1`、`v0.1.2`、`v0.1.3`、`v0.1.4`、`v0.1.5`，当前最新正式版为 **`v0.2.0`**。早期开发记录中的内部编号仅作工程历史归档，不得当作另一条公开版本线。
2. **100% 存储兼容（绝不改后缀或重生成密钥）**：完整保留 `BAGAID01` 魔数、`.baga` 归档后缀、SQLite `user_version = 3`、账号 HMAC 规则、32 字节主密钥及 legacy 浏览器种子域，确保已有身份库与专属浏览器资料无损读取。
3. **显著标注 CCBaga 二次开发归属**：`README.md`、`README_EN.md`、`NOTICE.md` 与所有 Release 正文均显著声明基于 [@liseami/CCBaga](https://github.com/liseami/CCBaga) 二次开发并保留原 MIT 版权声明。
4. **严禁中断运行中的 `claude.exe` 或用户浏览器**：测试、编译与本机部署均不得杀死正在运行的 `claude.exe` 会话；所有自动化测试必须使用合成数据与隔离临时目录，绝不触碰真实身份库或发真实消息。
5. **公开截图与文档零隐私泄漏**：仓库内所有截图（`docs/screenshots/`）必须由合成 IPC 数据与保留域名 `@example.invalid`（开启软件隐私打码）生成；用户聊天中上传的真实截图绝不复制入库或上传 GitHub。
6. **固定推广链接只读复制**：网络环境页内置的 iKuuu 与 Kookeey 链接经产品所有者批准随包分发，仅提供「复制链接」与「复制提示词」动作，不渲染明文 URL/邀请码，不提供界面编辑器或自动外部跳转。

---

## 2. 已经完成了什么（v0.2.0 及历史关键成果）

### 2.1 本轮完成的 `v0.2.0` 九项界面与功能升级
详见 [docs/UI_MONITOR_0.2.0.md](docs/UI_MONITOR_0.2.0.md)：

1. **浏览环境顶部启动卡片精简**（`src/browser.tsx`）：
   - 移除了「启动内置浏览器与 CLI 授权联动」卡片中冗余的 `绑定身份: ...` 与 `Chromium ...` 胶囊，以及右侧极少使用的 `正常退出浏览器`、`设为默认浏览器` 按钮，仅保留运行状态徽章与主启动/重开实测页按钮。
2. **电脑环境顶栏精简**（`src/system.tsx`）：
   - 移除了右上角低频冗余的「查看/恢复本次环境修改」、「系统授权设置」和「刷新状态」三个按钮。
3. **身份管理顶栏一体化与三步法精简**（`src/identities.tsx`、`src/identity-productivity.css`）：
   - 将右上角 `[• 自动续杯 | 08:00–23:00] | [• 悬浮监控窗] [↻ 同步本地额度] [⋯]` 重构为统一 `30px` 高度的分段胶囊与操作栏；
   - 移除了「添加新号 3 步法」引导条右侧冗余的「打开内置浏览器」按钮。
4. **「联动浏览器」切号自动弹出新账号验证页**（`src-tauri/src/browser/workspaces.rs`、`src-tauri/src/browser/mod.rs`、`src-tauri/src/identities/mod.rs`）：
   - 修复了勾选「联动浏览器」后切换身份时若浏览器未处于运行状态则不会自动弹出的问题：`workspaces::switch_identity` 现传入 `launch_on_linked = true`，在绑定开启且未指定 `skip_browser_launch`（测试参数）时自动启动或重开新切入账号对应的隔离浏览器实测与登录验证页。
5. **用量分析时间区间同行排布**（`src/usage-statistics.tsx`、`src/usage-statistics.css`）：
   - 将筛选日期区间与时区标识（如 `2026年10月6日 – 2026年10月26日 EDT`）移至 `[今天 | 昨天 | 近7天 | 近30天 | 全部]` 右侧同行空白处。
6. **用量分析新增官方 API 等效美元花费（USD）、缓存节省与单次均值**（`src/usage-model.ts`、`src/usage-model.test.ts`、`src/usage-statistics.tsx`）：
   - 将四大 KPI 卡片下方的 3 项次级统计升级为单行 **6 项遥测横条**（`去重响应数 | API 等效花费 ($USD) | 缓存节省 ($USD) | 单次均值 | 缓存写入 | 缓存读取`）；
   - 基于 Anthropic 官方 Claude API 模型单价（区分 Opus 4.x、Sonnet 4.x、Haiku 4.5 / 3.5 的输入、输出、缓存写入与缓存读取单价）自动核算美元花费与缓存节省金额，并在右侧「模型分布」中逐模型标注美元成本。
7. **使用说明移除「任务交接模板」**（`src/help.tsx`、`src/main.tsx`）：
   - 从帮助页面底部与主壳层移除了非必要的 `<TaskHandoff />` 板块（组件源码与单测保留以备兼容）。
8. **左侧导航栏移除搜索框并升级视觉设计**（`src/main.tsx`、`src/productivity-shell.css`、`src/style.css`）：
   - 移除了左下角「命令 Ctrl K」搜索按钮（保留 `Ctrl+K` 快捷键呼出命令中心），为当前选中项增加左侧 `3px` 主题色指示条与柔和渐变胶囊背景，并将底部 `[CN | EN]` 语言切换与 `v0.2.0` 版本徽章合并为单行底栏。
9. **借鉴 Token Monitor 全面重构桌面悬浮监控小窗（HUD）**（`src-tauri/src/monitor_window.rs`、`src-tauri/src/main.rs`、`src/floating-monitor-model.ts`、`src/floating-monitor.tsx`、`src/floating-monitor.css`）：
   - **三态几何自适应**：支持 **展开模式（`340×258`）**、**紧凑模式（`340×152`）** 与 **侧边胶囊模式（`52×138`）**，消除窄窗倒计时（`重置 2h 15m`）与耗尽预警（`⚠ ~1h10m`）文字截断；
   - **Token Monitor 三栏实时遥测磁贴**：底部展示 `5h 消耗（含缓存命中率）`、`实时速率（tok/m + 路由隔离状态）` 与 `5h 等效花费（$X.XX + 缓存省 $X.XX）`，账号行展示主力模型调用次数及占比；
   - **置顶 / 位置锁定 / 18px 边缘磁吸 / 贴边自动隐藏 / 50%–100% 无级透明度**：支持一键置顶（Pin）、位置锁定（Lock）、显示器工作区四边 18px 自动磁吸对齐（持久化 `dock_edge`）、左右边缘移出 420ms 自动收缩为 `52px` 侧边胶囊（悬停或点击即刻展开），以及 50%–100% 无级透明度滑块与预设档位（持久化至 `%APPDATA%\ai.local.claude-local\monitor-window.json`）；
   - **主题与自定义壁纸实时联动**：通过 `BroadcastChannel` 与 `storage` 事件实时同步主窗口的浅/深色主题、6 套强调色、毛玻璃参数与自定义本地壁纸。

### 2.2 中英双语旗舰级 GitHub 呈现与预览图重拍
- **`README.md`（默认简体中文）与 `README_EN.md`（完整英文版）**：
  - 顶部居中品牌徽标、一句话定位、5 枚状态徽章与醒目的双向中英文切换栏（`🌐 语言 / Language：🇨🇳 简体中文 · 🇺🇸 English`）；
  - 包含「✨ 核心特色一览」六大模块表、图文并茂的五大核心界面导览、三态 HUD 并排对比表、与 CCBaga 的演进对比表、`v0.1.0`–`v0.2.0` 版本演进表、安装校验指南与安全边界说明。
- **`docs/screenshots/0.2.0/`（13 张合成脱敏预览图）**：
  - 中文五页（`1280×900`）：`identity-management.png`、`usage-analytics.png`、`browser-environment.png`、`quick-setup.png`、`network-environment.png`；
  - 英文五页（`1280×900`，供 `README_EN.md` 使用）：`identity-management-en.png`、`usage-analytics-en.png`、`browser-environment-en.png`、`quick-setup-en.png`、`network-environment-en.png`；
  - 桌面 HUD 三态预览：`floating-monitor.png`（浅色展开）、`floating-monitor-dark.png`（深色极光）、`floating-monitor-collapsed.png`（侧边胶囊）。

### 2.3 当前仓库、安装包、本机与 GitHub 唯一有效状态
- **公开仓库**：[yq04/Claude-Local](https://github.com/yq04/Claude-Local)（`main` 与工作分支 `feature/functional-reliability-20261023` 完全快进同步）。
- **固定产品源码与标签**：
  - 标签 `v0.2.0` → 提交 `5521719f3a15351922be9f47fa3e91d1b8cac877`（后续 `f79b824` 及本交接提交为纯文档/介绍润色，按规范不移动 `v0.2.0` 标签、不重打包）。
  - 远端现共有 7 个正式 Release（`v0.1.0` 至 `v0.1.5` 及 **`v0.2.0` Latest**，均 `draft=false, prerelease=false`）。
- **`v0.2.0` Windows x64 安装包（已审计并上传 GitHub Release）**：
  - 下载地址：<https://github.com/yq04/Claude-Local/releases/download/v0.2.0/Claude-Local_0.2.0_x64-setup.exe>
  - 文件大小：`140,537,513` 字节（134.03 MiB）
  - 安装包 SHA-256：`37cfa5106f54aaf16e379dff7b53a93aef4456fe70a229d776039fbff8c645b4`（已与 GitHub Release 资产服务端 `digest` 核对一致）
  - 中性目录构建回执：`.local/artifacts/20261027T020452Z-8ef3115ef1464922a71646053976fb45/`（NSIS 只读解包 109 个文件，13 项隐私探针 `findings=0`）。
- **本机安装状态**：
  - 已通过 `scripts/deploy-local.ps1` 将 `%LOCALAPPDATA%\Programs\Claude-Local\claude-local.exe` 无中断更新至 **`0.2.0`** 并自动重启 GUI；
  - 本机未打包宿主 SHA-256：`9651d76a46ce1608c63297c683192b0710cf9569be90b74c4bcecf502088d792`；
  - 更新前后正在运行的 `claude.exe` 终端进程数量保持为 `1`（零中断），已有身份库与伴侣浏览器资料完整保留。
- **全量验证结果（100% 通过）**：
  - `bun test`：23 个文件、**142 项通过**（0 失败）
  - `bun run build`（`tsc --noEmit && vite build`）：**0 错误**
  - `cargo test --manifest-path src-tauri/Cargo.toml --bin claude-local`：**260 项通过**、0 失败、1 项保留忽略
  - `python scripts/test-windows.py`：**18 项通过**、1 项 CI-only 按设计跳过
  - Playwright 合成端到端与多视口几何回归：`test-identities-ui.ts`（73 项）、`test-handoff-ui.ts`、`test-local-shell.mjs`、`test-usage-statistics.mjs`（含 `--layout-only` 96 项、`--quick-only` 16 类及完整 38 类）、`.local/tasks/20261026-ui-polish/check-layout.mjs`（15 项中英双语五页检查）全部通过。

### 2.4 历史核心架构成果速查（0.1.0–0.1.5 继承基线）
- **浏览器两项未知修复（0.1.3–0.1.4）**：`src/browser-webrtc.ts` 将 RTCPeerConnection 同步构造与 ICE 协商/收集预算分离（5s 协商 + 2s 候选收集，真实耗时约 3.7s）；`src/browser-network.ts` 在地理结果缺少 `hosting` 字段时向固定 `api.ipquery.io` 补查同 IP 分类，并在生产 CSP（`src-tauri/src/browser/server.rs`）中精确放行 `https://api.ipquery.io`。更新宿主后需在「浏览环境」点击「重新打开实测页」。
- **自动续杯与授权分离（0.1.1）**：`src-tauri/src/identities/wakeup.rs` 是进程内唯一自动续杯调度器（切页/最小化托盘不中断，退出即停）；仅当同账号返回新鲜未来 `new_5h_confirmed` reset 时才记为成功；网页额度恢复队列与 CLI/messages 授权状态严格分离。
- **加密存储兼容加固（0.1.2）**：`src-tauri/src/identities/backup.rs` 与 `archive_limits.rs` 实现 `ScratchGuard` 暂存目录自清理、普通解包有界限额、Zeroizing 明文缓冲与 32 字节主密钥严格核验。

---

## 3. 当前卡在哪（阻塞状态与未执行边界）

**当前没有任何研发、构建、本机部署或 GitHub 发布阻塞。**

以下事项属于**按设计保留的工程边界或独立后续议题**（切勿将它们误认为当前版本发布失败，也不要未经用户指令擅自启动）：
1. **真实 NSIS 安装器向导全生命周期验收**：本机采用带备份的文件式无中断更新（`deploy-local.ps1`），未在个人开发机上直接运行 NSIS 安装/升级/卸载向导。完整安装器 UI 与系统时区修改测试需在一次性 Windows 虚拟机/Runner 中使用合成数据验收。
2. **第三方组件独立许可核对**：`vendor/cromma-ui` 复用子集的独立上游许可证、Pika 图标子集来源及 Fingerprint Chromium 完整 credits 清单仍在 `NOTICE.md` / `docs/DISTRIBUTION.md` 中客观记录边界，不将顶层 MIT 等同于所有第三方资产授权。
3. **单身份便携包（`bagapack`）与跨平台打包**：目前仅分发 Windows x64 版本，并提供全库口令加密备份与隔离恢复副本；单账号便携包导出属于远期候选特性。
4. **公开仓库下的手动 CI 打包工作流（`.github/workflows/share-windows.yml`）**：该工作流保留了私有仓库安全门禁条件，公开仓库下默认跳过（日常 `checks.yml` 正常运行，本机可通过 `scripts/build-windows-share.ps1` 构建审计安装包）。

---

## 4. 下一步计划是什么（新会话行动指南）

1. **先等待并响应用户的新指令**：
   - 当前 `v0.2.0` 已完美收官，新会话启动后**不要重跑构建、不要重发 Release、不要修改已发布的 `v0.2.0` 标签**，直接根据用户提出的新需求或新反馈开展工作。
2. **若用户后续提出 `v0.2.1` / `v0.3.0` 新功能或体验微调**：
   - 先阅读对应目录的 `CLAUDE.md` 与源码头部 `[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]` 注释；
   - 修改代码时同步维护 `src/locales/zh.yaml` 与 `src/locales/en.yaml` 双语词条；
   - 运行对应的定向测试（`bun test`、`cargo test`、`test-usage-statistics.mjs --layout-only` 等）；
   - 如需打包 `build:windows`，传入本机便携 7-Zip 路径：
     ```powershell
     pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows-share.ps1 -SevenZipPath (Resolve-Path .local/build-tools/7zip-26.04-f4a03f7e/portable/7z.exe).Path
     ```

---

## 5. 有哪些踩过的坑绝对不要再踩（避坑铁律）

1. **绝不提交或还原根目录 `AGENTS.md`**：
   - `git status` 中未暂存的 `M AGENTS.md` 是用户的本地规则文件改动，**必须原样保留在工作区，绝不能 `git add AGENTS.md`，更不能 `git checkout / restore / reset --hard / clean` 清掉它**。
2. **绝不执行 `git push --tags`**：
   - 本地 `.git/refs/tags/` 与 `.local/tasks/20261026-github-presentation/legacy-development-tags.bundle` 中保留了早期开发标签的本地备份（远端已获批清理）。推送新版本标签时**必须显式指定标签名**（如 `git push origin refs/tags/v0.2.0`），严禁运行 `git push --tags` 把旧开发标签重新推上远端。
3. **纯文档/README 更新绝不重编译安装包或移动已有版本标签**：
   - 修改 `README.md`、`README_EN.md`、`HANDOFF.md` 或 `docs/` 时，只提交并推送文档 commit，**不要重新生成 `.exe` 替换已发布的 Release 资产，也不要移动已发布的 `v0.2.0` 标签**，确保已公布的 SHA-256 校验和永久有效。
4. **绝不杀死运行中的 `claude.exe` 或用户浏览器进程**：
   - 本机通常有正在运行的 `claude.exe` 终端会话。部署更新本机软件时只允许停止并重启精确匹配的 `claude-local.exe` GUI 进程，严禁停止 `claude.exe` 或 `chrome.exe`。
5. **在 `identities_switch` 测试中注意 `skip_browser_launch`**：
   - `v0.2.0` 起，当身份库中 `browser.enabled === true`（默认开启联动）时，调用 `identities_switch` 会自动启动新切入账号的内置浏览器（`workspaces::switch_identity` 传入 `launch_on_linked = true`）。因此，在不需要实际拉起 Chromium 窗口的无头/合成测试中，调用 `identities_switch` 应显式传入 `skipBrowserLaunch: true`（Rust 侧 `skip_browser_launch: Some(true)`）。
6. **响应式与窄窗布局必须同时验证中英文与容器宽度**：
   - 调整侧边栏（`.app-sidebar`）或悬浮窗（`.monitor-hud`）样式时，务必同时检查中文（`zh`）与英文（`en`，单词更长）在窄视口（`760×640`）和 HUD 固定宽度（`340px`）下是否发生文字截断或溢出（可运行 `node scripts/test-usage-statistics.mjs --layout-only` 与 `node scripts/test-local-shell.mjs` 验证）。
7. **数据与安全边界红线**：
   - 绝不在源码、测试或文档中写入任何真实邮箱、账号 UUID、OAuth Token、代理凭据或个人路径；
   - 额度采集路径绝不向 `.claude.json` 写入数据，Python 是 `quota_ledger.json` 的唯一写入者；
   - `package.json` 中的 `"private": true` 是防止意外发布到 npm 的保护标记，与 GitHub 仓库公开状态无关，切勿删除。
8. **重写 `HANDOFF.md` 前必须先备份并校验 SHA-256**：
   - 本次更新前的上一版 `HANDOFF.md` 已备份于 `.local/tasks/20261026-v0.2.0-handoff/HANDOFF.before-rewrite.md`（SHA-256: `c3e86749377707afc533ab97b205e2674f1d15b77d5fc7adcb1cd15210589a50`），清单见同目录 `backup-manifest.json`。
