<!--
[INPUT]: Verified v0.2.5 end-to-end anti-ban & KYC/WebRTC/IPv6/DNS hardening, Open-Source Benchmarked P0-P7 Full Optimization, Identity & Warming Card UX Refinement (166px compact card geometry + top-pill pointer drag-and-drop reordering with FLIP spring animation + Quota HUD unobstructed bottom metric tiles + flicker-free silent 5s local quota revision sync + Store::save_inner has_live_identity guard preventing phantom blank cards), and comprehensive Research Analysis Report & 4-Phase Implementation Plan for Single-Account Cross-Machine Portability & Friend Handoff (.bagapack / CLPACK01 + Kookeey US static residential IP binding) in docs/PORTABILITY_PLAN.md.
[OUTPUT]: Context-free handoff covering verified deliveries and the latest owner decision: single-account .bagapack export/import is cancelled; friends configure their own network and sign in normally after source-side use stops. Historical portability research is not an implementation instruction.
[POS]: Root maintenance handoff; real identities, IP/proxy values, process IDs, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only updates do not build/deploy, reload proxies, operate accounts, package/upload or move release tags.
-->
# Claude-Local 新会话交接文档（无上下文直接接手）

> **2026-11-02 最新产品决定（覆盖下文历史可移植方案与实施指引）**：用户已明确取消单身份导入/导出功能，不开发 `.bagapack` / `CLPACK01`、跨机 OAuth/Cookie 搬运或相关向导。号主手动提供 Kookeey 节点信息，朋友在自己电脑配置 iKuuu + Kookeey、核验实际出口与解析路径后，在新建本地身份中正常登录同一账号。号主计划在朋友使用前通过现有确认流程删除该账号的本地资料；这只是后续人工计划，本轮未执行账号删除。先由用户自行结束相关 CLI/浏览器工作并关闭自动续杯、结束在线任务，再分别确认当前 CLI 登录、保存卡片及关联浏览器资料；删除保存卡片不等于清除当前登录，本地删除也不等于吊销所有服务端会话。现有整库 `.clbackup` 备份能力保留。`docs/PORTABILITY_PLAN.md` 仅为已取消的历史研究，不得据此继续实现。

更新时间：2026-11-02 EST（America/New_York）。当前最新正式发布至 GitHub Release（Latest）的版本为 **`v0.2.5`**（源码标签 `v0.2.5` 指向提交 `6d505a6`），本机安装目录 `%LOCALAPPDATA%\Programs\Claude-Local\claude-local.exe` 已热更新并运行包含 **「P0 ~ P7 全模块深度改进优化 + 额度小窗防遮挡与身份卡防闪烁 + 166px 紧凑卡片与顶部横条拖拽排序 + 养号 CLI 转正空白卡与幽灵『当前身份』卡根治」** 的最新正式版二进制（SHA-256: `D644D4B2DD889F534F81B7B8F622746FF824081E1D7B8E0241EE6D995E34DC09`）。

> **给新会话的第一句话（必读）**：
> 0. **历史记录（下述功能已由用户取消）：「单账号跨机可移植与朋友交接能力」调研与四阶段草案**：
>    - **用户核心诉求**：号主在自己电脑上使用 Kookeey 美国静态住宅 IP 养号并充值 Pro 后，希望将该单个账号（含 CLI OAuth 凭据、伴生浏览器确定性指纹、网页端登录态、手动订阅到期日及 Kookeey 美国家宽代理配置）打包为口令加密的独立便携胶囊（`.bagapack`），交给朋友在另一台 Windows 电脑上安全导入并绑定同一 Kookeey 美国家宽 IP 零风控使用。
>    - **调研与设计成果**：已完成对 `CCBaga`、`cc-switch`、`Playwright/Puppeteer`（CDP `storageState`）、`HackBrowserData`（Windows DPAPI 机制）、`Fingerprint Chromium` 与 `Mihomo`（独立 `listeners` + `dialer-proxy` 链式代理）的深度对标，逐行定位了本仓库阻断跨机移交的 **5 个硬性源码壁垒**，并在 **`docs/PORTABILITY_PLAN.md`** 中给出了完整的二进制协议（`CLPACK01`）、数据结构、Tauri IPC 签名、Kookeey `127.0.0.1:7899` 专线桥接与五维预检门禁、跨 DPAPI 本地 CDP 网页会话快照、宿主机 `handed_off` 防双开冻结以及 **Phase 1 → Phase 4 分阶段实施蓝图**。
>    - **接手行动指引**：该方案未实现且已取消，不按 Phase 1 → Phase 4 开工。下文的“零风控”与“100% 指纹恒定”等措辞为历史假设，不是经验证的能力或交付承诺。
> 1. **本会话最新完成的 5 项界面交互打磨与核心 Bug 根治（均已通过全量单测、Rust 测试、Playwright 合成 UI 验证并热更新至本机）**：
>    - **修复 1：移除额度小窗（Quota HUD）底部「接力备选」遮挡条（`src/floating-monitor.tsx`）**：
>      - 此前额度小窗底部的 `接力备选: ... / 池内 X 就绪` 横条会遮挡底部三枚核心指标卡（`5h 消耗`、`近10分钟速率`、`5h 响应`）。现已彻底移除小窗内的接力备选展示（接力状态仅在身份管理页「智能接力」弹窗与横幅中呈现），小窗底部三项指标清晰完整无遮挡。
>    - **修复 2：根治身份管理页卡片频繁闪烁与本地额度轮询过勤问题（`src/identities.tsx`、`src/use-browser-runtime.ts`）**：
>      - **根因**：① 后台 `identities_quota_revision` 轮询触发 `read(false)` 时无条件执行了 `setLoading(true)`，导致每当 `.claude.json` 与 `quota_ledger.json` 先后落盘时，所有卡片按钮瞬间变灰禁用、`运行中` 徽章闪变为 `检查中`；② 轮询周期仅 2 秒，单次 CLI 对话中 `.claude.json` 与 `quota_ledger.json` 前后写入会触发 5 秒内连续 2 次重绘；③ `useBrowserRuntime` 每 3 秒轮询每次返回新对象引用触发重渲染。
>      - **修复**：后台 `read(false)` 改为静默更新（仅在首次挂载尚无 `state` 时置 `loading = true`，并提供 `syncingQuota` 供顶部手动同步按钮使用）；桌面端 `identities_quota_revision` 轮询周期调整为 **5 秒**（合成测试态保持 2 秒），并在首次挂载时对齐初始 `revisionRef` 避免双重读取；`useBrowserRuntime` 增加全字段值相等比对去重。
>    - **优化 3：卡片横向宽度适度收窄（`180px` → `166px`）且确保重置日期与倒计时零挤压（`src/style.css`、`src/identity-productivity.css`）**：
>      - 将 `.identity-card` 宽度从 `180px` 收窄至 **`166px`**（缩窄 `14px`），同步微调卡片内边距（`11px 9px 6px`）、额度框内边距（`2px 4.5px`）与 `.identity-quota-reset` 字号（`11px`），实测进度条下方左侧重置日期时间（如 `🕒 11-02 00:30`）与右侧倒计时（如 `4h 30m`）之间保持约 **`23.5px`** 充足间距，绝不重叠或贴靠。
>    - **优化 4：新增顶部药丸横条手动拖拽调换卡片顺序（`src/card-order.ts`、`src/identities.tsx`、`src/warming-cards.tsx`）**：
>      - 支持在**「身份」栏**与**「养号」栏**中按住每张卡片顶部居中的药丸横条区域（`.identity-card-drag-handle`，`64px × 17px` 热区，悬停时药丸从 `28px` 平滑展宽至 `38px` 并显示 `grab` 手型）水平拖动调序；
>      - 被拖卡片实时像素级跟随鼠标并微微浮起（`scale(1.018)` + 柔和投影），跨过相邻卡片中线时触发 **FLIP 弹簧换位动画**（`240ms cubic-bezier(0.22, 1, 0.36, 1)`），靠近轨道边缘自动平滑横滚，同时支持聚焦手柄后按键盘 `←` / `→` 方向键调序；
>      - 自定义顺序分别持久化保存在 `localStorage`（`claude-local.identity-card-order.v1` 与 `claude-local.warming-card-order.v1`），且完全不干扰卡片内按钮点击与身份切换。
>    - **修复 5：根治养号 Pro 登录 CLI 转正 / 新身份卡片空白区 & 切换/转正时产生多余空白「当前身份」卡（`src-tauri/src/identities/archive.rs`、`profile.rs`、`src/identities.tsx`、`src/warming-cards.tsx`）**：
>      - **为什么会产生多余的空白「当前身份」卡**：当工作区处于「新身份 / 待登录」状态（无 `account_key`、无 OAuth 凭据、`profile.present == false`）但「保留在工作区」策略保留了 `.claude/projects`、`.claude/history.jsonl` 或 `.claude/cache` 等共享目录时，旧版 `Store::save_inner` 仅因为 `entries` 非空就判定 `record.empty = false`，并在用户再次点击切换或养号转正时把未登录工作区归档成一张名为 **`当前身份`（`邮箱未提供`、`5h/7d 未知`）** 的幽灵空白卡，甚至误消费浏览器预留草稿。
>      - **后端根治**：在 `src-tauri/src/identities/archive.rs` 的 `Store::save_inner` 中新增 `has_live_identity = account_key.is_some() || !credentials.is_empty() || super::profile::read(&self.home).present;`。当 `reuse && !has_live_identity`（普通保存/切换/转正且工作区无实际登录身份）时，不消费 `browser_draft()` 并强制标记 `record.empty = true`（自动走空身份清理回收，绝不入库生成空白卡片）；同时 `save_checkpoint`（`reuse = false`）仍保留中断恢复语义。在 `profile.rs` 中同步为 API Key 模式设置 `current.present = true`。
>      - **前端根治**：在处于激活态的 `.identity-card.empty.selected`（`新身份 / 待登录` 卡）中部填充结构化双步骤指引框（**步骤 1：内置浏览器验证并登录 Pro 账号** + **步骤 2：终端运行 `claude` 授权后点击「保存身份」自动归档**），消除卡片中部大片空白；当 `current?.present === false` 时在切换/转正确认弹窗中隐藏冗余的「当前身份保存为」输入框；并已安全备份后清理了本机 SQLite 中多余的空白「当前身份」记录与孤儿 `.baga` 归档。
> 2. **此前已完成的对标 GitHub 高星开源项目（`EcoPaste`、`pot-desktop`、`yetone/magpie`、`ryoppippi/ccusage`、`Claude-Code-Usage-Monitor`、`Claude-Usage-Tracker`、`steipete/CodexBar`、`cc-switch`、`claude-gauge`、`claude-usage-widget`）的 P0 ~ P7 全模块优化与 PayPal 美国家宽分流加固均完整保留（详见下文第 2 节與 `docs/OPTIMIZATION_PLAN.md`）**。
> 3. **关于「智能接力（Smart Relay）」的明确产品定调**：
>    - 智能接力保持默认关闭（`enabled: false`），采用**「纯本地余量推荐 + 手动点击走原生安全切号流程（含跨账号四维消毒与 `claude.exe` 进程检查）」**，**严禁**开发本地 HTTP 反向代理网关或后台无确认自动偷换 Token。
> 4. **请勿重复实现已交付功能，也不要擅自回退或移动 `v0.2.5` 标签及已上传安装包资产。**

新会话接手时请依次阅读：本文（`HANDOFF.md`） → 根目录 `AGENTS.md`（切勿提交到 Git） → 根目录 `CLAUDE.md`；已取消的 `docs/PORTABILITY_PLAN.md` 仅在需要查阅历史研究时阅读。修改具体模块前先读对应子目录的 `CLAUDE.md` 与源文件头注释（`[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]`）。本文受 Git 跟踪，**严禁写入任何真实账号、邮箱、身份指纹、真实 IP、代理凭据、个人绝对路径或真实截图**。

---

## 1. 我们在做什么任务

**Claude-Local** 是基于开源项目 [CCBaga](https://github.com/liseami/CCBaga) 二次开发并在本仓库独立维护的 **Windows 10 / 11 x64** 桌面工作台（技术栈：Tauri 2 + Rust 后端、React 19 + TypeScript 前端、Python 外部额度单写者与加密备份脚本）。目标是让普通用户也能一键配置、管理、安全使用多个 **Claude Code CLI** 与 **Claude Pro / Max / 待转正养号卡片** 账号，核心涵盖五大模块：
1. **多身份加密保险库与零强杀安全切号**（`BAGAID01` / `.baga` 归档、SQLite `user_version = 3`、`claude.exe` 进程锁检查、1572 行跨账号四维残留消毒与 `--resume` / `-c` 会话签名剥离、全链路 `.clbackup` 口令加密备份、单卡跨机防关联交接卡导出、`166×286` 紧凑卡片与顶部横条丝滑拖拽调序）。
2. **多账号智能接力与轮换（Smart Relay，默认关闭）**（借鉴 [yetone/magpie](https://github.com/yetone/magpie) 的余量与重置窗口评估模型，支持五种路由策略、三态会话缓存亲和、账号池容量汇总、首选号恢复滞回提醒与一键安全切换入口，零反向代理网关、零后台偷切）。
3. **被动额度同步、定向防风控在线查询、原生进程内 5h 自动续杯调度与多模态悬浮窗（HUD）**（Python 独占写 `quota_ledger.json`，零后台 OAuth 轮询、零 `.claude.json` 写入；支持 5 秒静默无闪烁本地修订同步、「仅查未知/过期」定向批次查询与带 5h/7d 时间进度游标、Win32 鼠标穿透、底部三指标无遮挡的桌面 HUD）。
4. **CPAMP / ccusage 风格本地 Token 与官方 API 美元等效花费（`$`）分析**（未缓存输入/输出/缓存写入/缓存读取四类构成、API 等效花费 `$`、缓存节省 `$` 与缓存复用倍数、单次请求均值 `tok/req` 与 `$/req`、峰值时段徽章、五维可排序账号表、含花费/缓存率的时段明细表、模型与 Effort 分布、IANA/DST 时区及 Markdown 简报 / TSV 导出）。
5. **身份绑定的防关联伴生浏览器（Fingerprint Chromium）与风控 / KYC / 支付环境核验**（每身份/每养号卡独立槽位与确定性指纹种子、WebRTC Network Limiter 三重强锁、按需无阻断防泄露断路器 Kill-Switch、20 项浏览器实测、6 项网络/DNS/Mihomo 运行时风控核验、桌面端一键 Clash 防漏覆写 YAML、手机同住宅出口 LAN 扫码桥接、PayPal/Stripe 跨区 Cookie 清理助手）。
6. **【已取消，不开发】单账号跨机可移植与朋友交接能力（`.bagapack` / `CLPACK01`）**：仅保留历史研究。当前采用号主人工提供 Kookeey 信息、朋友独立配置网络并正常登录同一账号的流程；没有待实施的跨机身份包任务。

---

## 2. 已经完成了什么（v0.2.5 基线 + P0 ~ P7 全模块开源对标优化 + 本轮界面与转正流程根治完整清单）

### 2.00 历史调研（功能已取消）：单账号跨机可移植与朋友交接草案（`docs/PORTABILITY_PLAN.md`）
1. **源码级五重壁垒定位**：
   - 查明现有 `.baga` 归档与 `.clbackup` 无法直接用于朋友跨机交接的 5 处源码壁垒：① `src-tauri/src/identities/archive.rs:126` 强制校验 `manifest.home == self.home` 且 `sources` 存储宿主机 `%USERPROFILE%` 绝对路径，异机解包直接拒绝；② `backup.rs` 的 `.clbackup` 耦合整库 `key.bin` 且 `catalog.rs:13` 的 `account_key` 为 `HMAC_SHA256(key.bin, ...)`，无法单卡合入朋友既有保险库；③ `src-tauri/src/browser/config.rs:150` 默认读取运行机器的 `machine.cores`、`machine.version` 且默认 `follow_machine: true`、`native_graphics: true`，跨不同硬件/中文系统的朋友电脑会导致 CPU 核数、系统版本、语言时区与 Canvas 哈希跳变；④ Windows Chromium `Default/Network/Cookies` 的 `os_crypt.encrypted_key` 经 DPAPI 绑定在宿主机 Windows 用户 SID 上，直接拷贝 `User Data` 目录必报 `0x80090005` 解密失败（而 CLI 的 `.claude/.credentials.json` 是纯 JSON，跨机重绑路径后天然可用）；⑤ `browser/config.rs:101` 拒绝带账密的 SOCKS5 URL，且缺少宿主机交接后防双开冻结与朋友端启动前 Kookeey 出口强预检。
2. **四阶段完整实施方案（详见 `docs/PORTABILITY_PLAN.md`）**：
   - **Phase 1（底层 `CLPACK01` 胶囊引擎、硬件指纹固化与跨机合入核心）**：在 `browser/config.rs` 新增 `pinned_cores` 与 `pinned_platform_version`；新增 `src-tauri/src/identities/portable.rs` 与 `portable_tests.rs`，实现宿主机单卡净室抽提（100% 剔除 `projects`/`history`/`mcp`）、朋友端非破坏性合入（路径重绑至朋友 `%USERPROFILE%` + 朋友 `key.bin` 重算 `account_key` 与重封 `.baga` + 原样保留 `seed`）及 `portable_state.json` 状态管理（宿主机 `handed_off` 冻结态与朋友端 `pending | verified` 预检态）。
   - **Phase 2（Kookeey `127.0.0.1:7899` 专线 Mihomo 覆写生成与五维预检门禁）**：在 `src/risk-model.ts` 新增 `buildKookeeyFriendHandoffMihomoYaml`（生成独立 `7899` `mixed` 监听 + `dialer-proxy` 串联 `Kookeey-US-Static` 的 Clash Verge Rev Merge 配置，使 CLI 与伴生浏览器专走 7899 而不影响朋友主端口日常分流）；在后端实现 `identities_portable_preflight` 五维实测（7899 连通、`US` 国家、非机房住宅、`expected_ip_hash` / `expected_asn` 匹配、`claude.ai` vs `withpersona.com` 同出口且时区一致）。
   - **Phase 3（可选跨 Windows DPAPI 便携网页会话快照）**：通过内置 Chromium 本地回环 CDP（`--remote-debugging-port=0`）在导出时执行 `Storage.getCookies` 提取 `.claude.ai` 明文 Cookie 入包，在朋友端首次启动通过预检的浏览器时执行一次性 `Storage.setCookies` 注入并销毁暂存快照。
   - **Phase 4（前端导出/导入/预检向导、防双开冻结徽章与双语词条）**：严守 `166×286` 卡片几何红线，通过卡片顶部状态徽章、`⋯` 菜单与 `<AppDialog>` 弹窗完成全链路交互。

### 2.0 本轮最新完成：界面交互打磨、卡片拖拽排序与养号转正空白卡/幽灵卡根治
1. **额度小窗（Quota HUD）底部遮挡修复（`src/floating-monitor.tsx`）**：
   - 移除了悬浮小窗底部的 `接力备选: ... / 池内 X 就绪` 横条，确保小窗底部 `5h 消耗`、`近10分钟速率`、`5h 响应` 三张指标卡完整显示、绝不重叠。
2. **身份管理页卡片闪烁根治与 5s 静默同步（`src/identities.tsx`、`src/use-browser-runtime.ts`）**：
   - 将后台 `identities_quota_revision` 触发的 `read(false)` 改为静默刷新（不置 `loading = true`，仅手动同步按钮置 `syncingQuota = true`），桌面端元数据检查间隔从 `2000ms` 调整为 **`5000ms`**，并对齐初始挂载 `revisionRef`，配合 `useBrowserRuntime` 值相等去重，彻底消除卡片闪烁。
3. **166px 紧凑卡片宽度与重置时间行防挤压校准（`src/style.css`、`src/identity-productivity.css`）**：
   - `.identity-card` 宽度从 `180px` 缩窄为 **`166px`**，微调内边距与 `.identity-quota-reset` 字号（`11px`），确保 `5h`/`7d` 进度条下方的重置日期时间与倒计时之间保持 **`~23.5px`** 安全间距。
4. **顶部药丸手柄拖拽调序 + FLIP 弹簧动画 + 键盘无障碍调序（`src/card-order.ts`、`src/card-order.test.ts`、`src/identities.tsx`、`src/warming-cards.tsx`）**：
   - 实现 `useCardRailReorder` Hook，支持在「身份」栏与「养号」栏按住卡片顶部横条拖动调序，含鼠标实时跟随、相邻卡片 `240ms cubic-bezier(0.22, 1, 0.36, 1)` FLIP 动画、边缘自动横滚、键盘 `ArrowLeft`/`ArrowRight` 调序及 `localStorage` 独立持久化。
5. **养号 Pro 登录 CLI 转正 / 新身份卡片双步骤引导 & 未登录工作区防生成幽灵「当前身份」卡（`src-tauri/src/identities/archive.rs`、`profile.rs`、`tests.rs`、`src/identities.tsx`、`src/warming-cards.tsx`）**：
   - 后端 `Store::save_inner` 增加 `has_live_identity` 判定：当工作区无登录身份（`account_key`、凭据、`profile.present` 均为空）且为普通保存/切换（`reuse == true`）时，不消费浏览器草稿并强制 `record.empty = true`，防止因保留的 `.claude/projects` / `history.jsonl` / `cache` 产生多余空白「当前身份」卡；新增回归测试 `switching_from_unauthenticated_workspace_with_cache_or_projects_never_creates_blank_identity_card`。
   - 前端为激活态 `.identity-card.empty.selected` 补充结构化双步骤框（步骤 1 浏览器核验与登录、步骤 2 CLI 授权与自动接管），并在 `current?.present === false` 时隐藏切换/转正确认弹窗中的「当前身份保存为」输入框。
   - 本机 `%APPDATA%\ai.local.claude-local\identity-vault\identities.sqlite` 中此前因转正产生的空白「当前身份」记录及孤儿归档已备份至 `.local/tasks/20261101-cleanup-empty-card/` 并清理完毕。

### 2.1 对标开源项目的 P0 ~ P7 全链路改进优化（详见 `docs/OPTIMIZATION_PLAN.md`）
- **P0：Tauri v2 额度小窗静态声明式生命周期、Capabilities ACL 授权、Win11 透明圆角与位置记忆**（`src-tauri/capabilities/main.json`、`tauri*.conf.json`、`src-tauri/src/monitor_window.rs`、`src/floating-monitor.css`）。
- **P1：额度小窗 HUD 5h/7d 时间流逝刻度游标（`computeWindowTimePace`）、Win32 鼠标穿透幽灵模式（`monitor_window_set_click_through`）与系统托盘直达开关**。
- **P2：「用量分析」脱敏 Markdown 简报一键复制（`formatUsageMarkdownSummary`）**。
- **P3：单卡「复制跨机防关联交接卡 / Copy Handoff Spec」（`formatIdentityHandoffSpec` / `formatWarmingHandoffSpec`）**。
- **P4：PayPal / Stripe / KYC 站点残留地区 Cookie 预检与一键清理地址复制（`chrome://settings/content/all?searchSubpage=paypal.com`）**。
- **P5：智能接力 `inferred7d`/`inferred5h` 满血恢复账号归入 `Tier 0 (ready)`、三态会话保持（`auto | session | manual`）与账号池容量汇总条（`summarizeRelayPool`）**。
- **P6：在线额度查询「仅查未知/过期 ({count})」定向防风控批次筛选（`buildStaleOrUnknownBatchTargets`）**。
- **P7：用量分析单次请求均值（`tok/req`、`$/req`）、峰值时段徽章、账号表五维点击排序、时段明细表花费/缓存率列与 TSV 导出花费字段**。
- **全量测试结果**：
  - `bun x tsc --noEmit && bun test`：**173 passed, 0 failed**（26 个测试文件）；
  - `cargo test --manifest-path src-tauri/Cargo.toml identities::tests -j 1`（**11 passed**）、`cargo test monitor_window -j 1`（**6 passed**）、`cargo test local_edition -j 1`（**2 passed**）；
  - Playwright 合成 UI 测试：`--cards-only`（**28 passed**）、`--warming-only`（**29 passed**）、`--quota-reset-only`（**8 passed**）。

### 2.2 PayPal / Braintree 支付全链路美国家宽分流加固与 `v0.2.5` 基线
- 本机 Clash Verge Rev 全局 `Script.js`、订阅绑定扩展脚本、主配置 `config.yaml`（`ipv6: false`）与服务模式 `runtime\config.yaml` 已将 `paypal.com`、`paypalobjects.com`、`paypal-mktg.com`、`paypal.me`、`py.pl`、`braintreegateway.com`、`braintree-api.com`、`venmo.com` 及远程 DoH IP（`1.1.1.1/32`、`1.0.0.1/32`、`8.8.8.8/32`、`8.8.4.4/32`）锁死至美国静态住宅家宽出口并阻断 `UDP 443`。
- 伴生浏览器 `Default/Preferences` 三重 WebRTC 强锁 + `--enforce-webrtc-ip-permission-check` + `--test-type`，20 项实测结果按 `(slot, config)` 内存持久保留。

---

## 3. 当前卡在哪（当前零阻塞，仅记录工作区状态与产品边界）

当前**没有任何代码、编译、测试或运行阻塞**。
- **本机运行状态**：
  - 最新编译的 Release 二进制（`src-tauri/target/release/claude-local.exe`，SHA-256: `D644D4B2DD889F534F81B7B8F622746FF824081E1D7B8E0241EE6D995E34DC09`）已热更新至 `%LOCALAPPDATA%\Programs\Claude-Local\claude-local.exe`，并在交互式桌面会话（`SessionId 1`）中正常启动运行。
  - 本机身份保险库（`%APPDATA%\ai.local.claude-local\identity-vault\identities.sqlite`）干净保留 **5 张正式 Pro 身份卡**与 **2 张养号卡**，0 张空白异常卡。
- **当前 Git 工作区未提交改动说明**：
  - `AGENTS.md`：用户本地规则文件，**按铁律永远保留在未暂存状态，绝不提交或还原**；
  - `docs/PORTABILITY_PLAN.md`（本会话新增：单账号跨机可移植与朋友交接深度调研报告及四阶段实施方案）；
  - `docs/OPTIMIZATION_PLAN.md`、`src/card-order.ts`、`src/card-order.test.ts`（新增）以及 `src-tauri/`、`src/`、`scripts/` 下的修改：包含 **P0 ~ P7 全模块开源对标优化**、**PayPal 支付域名分流加固**、**额度小窗防遮挡与身份卡防闪烁**、**166px 卡片与顶部横条拖拽排序** 以及 **养号 CLI 转正空白卡/幽灵卡根治**。
  - 以上改动保持 `v0.2.5` 标签指向 `6d505a6` 不变，待用户后续指示后再决定是提交新 commit 还是打包新版本安装器。

---

## 4. 下一步计划是什么

1. **新会话启动后先听取用户指令**：
   - **单身份跨机导入/导出已取消**：不执行 `docs/PORTABILITY_PLAN.md` 的四阶段开发。朋友端沿用现有网络配置、环境核验与正常登录流程；没有为此次人工交接必须新增的业务功能。本机账号删除必须由用户完成必要确认，不能把本条产品决定视为 agent 操作真实账号或删除资料的授权。
   - 若用户要求将当前已完成并验证的全部改进提交 Git commit 或打包新版本 NSIS 安装器（如 `v0.2.6` 或更新 `v0.2.5`），按标准流程执行（显式列出文件路径 `git add`，**严禁暂存 `AGENTS.md` 或 `.local/`**，打包前执行 29 项隐私探针扫描）。
   - 若用户提出新的功能需求或界面微调，先阅读对应目录的 `CLAUDE.md` 与源文件头注释再动手。
2. **远期可选储备方向（仅在用户明确要求时再启动，切勿自行开工）**：
   - **多槽位浏览器完整并行 20 项回环实测会话**：将 `Browser.session` 升级为 `HashMap<String, SlotSession>`。

---

## 5. 有哪些踩过的坑绝对不要再踩

### 5.1 进程、数据与工作区安全铁律（最高优先级）
1. **绝不中断或强杀正在运行的 `claude.exe`（Claude Code CLI）**：
   - 无论是开发调试、热重载 Mihomo 还是热更新 `claude-local.exe`，**严禁停止、重启或干扰任何 `claude.exe` 进程**。
2. **绝不提交或还原根目录 `AGENTS.md`，绝不将 `.local/` 或真实隐私数据带入 Git**：
   - `git add` 时必须显式指定文件路径，严禁 `git add .` 或 `git add -A`。
   - 严禁使用 `git clean`、`git reset --hard`、`git checkout --`、`git restore` 或递归删除工作区。
   - 提交或写文档前必须确保零真实账号、零邮箱、零真实 `seed`、零真实 IP、零代理密码、零个人路径。
3. **持久格式兼容性绝对不可破坏**：
   - `BAGAID01` 魔数、`.baga` 归档格式、SQLite `user_version = 3`、账号 HMAC 计算规则以及历史 `CCBaga/browser/...` 确定性种子派生域字符串严禁修改。
   - `quota_ledger.json` 必须保持 **Python 唯一写入者**。

### 5.2 历次实施与调试中踩过的技术坑（重要经验）
4. **`Store::save_inner` 中 `reuse && !has_live_identity` 与 `save_checkpoint`（`reuse = false`）的边界坑（本轮新踩重点坑）**：
   - 在 `src-tauri/src/identities/archive.rs` 的 `Store::save_inner` 中，普通保存/切换/转正（`Store::save` -> `reuse = true`）在工作区无实际登录身份（`!has_live_identity`）时必须强制标记 `record.empty = true` 且不消费 `browser_draft()`，否则只要工作区保留了 `.claude/projects` 或 `.claude/history.jsonl`，就会生成一张多余的空白「当前身份」卡。
   - **但切勿对 `reuse == false`（即 `Store::save_checkpoint`，用于中断恢复 `Store::recover`）强制设置 `record.empty = true`**！因为 `tests.rs::interrupted_switch_can_recover_and_preserves_pre_recovery_state` 要求在切换中断后的空白工作区中产生的新 `history.jsonl` 必须通过 `save_checkpoint` 归档保存为非空恢复检查点。因此判定条件必须严格保持 `if reuse && !has_live_identity`。
5. **SQLite `identities.sqlite` 表结构字段名坑（本轮新踩重点坑）**：
   - 在 `identities.sqlite`（`user_version = 3`）中，`browser_bindings` 表的主键列名为 **`identity`**（不是 `identity_id` 或 `id`），`identities` 表的时间戳列名为 **`saved_at`**（不是 `updated_at`）。编写诊断或维护脚本时务必先核对 `src-tauri/src/identities/database.rs` 或 `PRAGMA table_info(...)`。
6. **Playwright 合成 UI 测试脚本中的卡片宽度断言同步坑（本轮新踩重点坑）**：
   - `scripts/test-identities-ui.ts`、`scripts/test-warming-ui.ts` 和 `scripts/test-quota-reset.ts` 中均硬编码校验了 `.identity-card` 的 `width === 166` 与 `height === 286`（以及换行阈值 `clientWidth >= 344`）。若未来调整卡片尺寸，必须同步更新这三个测试脚本中的几何断言，且注意 `scripts/test-identities-ui.ts` 与 `scripts/test-warming-ui.ts` 使用 CRLF 换行符。
7. **Tauri v2 多窗口 Capabilities ACL 权限遗漏坑**：
   - `src-tauri/capabilities/main.json` 的 `"windows"` 数组必须包含 `["main", "monitor"]`，否则 `"monitor"` 额度小窗调用任何 `@tauri-apps/api` IPC 都会被 Tauri v2 ACL 拦截。
8. **Windows Tauri v2 静态声明隐藏小窗 + `MainThreadEnv<T>` 线程亲和性坑**：
   - `"monitor"` 小窗已在 `tauri*.conf.json` 中静态预声明为 `visible: false`，运行时仅调 `show()` / `hide()`；动态兜底提取 `ICoreWebView2Environment` 时必须全部在 `app.run_on_main_thread` 主线程闭包内同步完成。
9. **沙箱 PowerShell `SessionId 0` 启动 GUI 进程坑**：
   - AI 工具沙箱 PowerShell 位于 `SessionId 0`，直接运行 `Start-Process claude-local.exe` 会产生桌面不可见的僵尸进程。**热更新后重启 `claude-local.exe` 必须使用 `schtasks /Create ... /IT /F` + `schtasks /Run` 在 `SessionId 1` 交互式桌面拉起**。
10. **智能接力 `inferred7d` / `inferred5h` 满血回血账号误判坑**：
    - `inferred7d === true` 代表 7d 重置时间已过、本地判定 100% 满血恢复，在 `src/smart-relay-model.ts` 中必须归入 `Tier 0 (ready)`，切勿当作 `Tier 3 (unavailable)` 过滤。
11. **Clash Verge Rev 订阅独立扩展脚本与 PayPal / 远程 DoH 规则坑**：
    - 修改本机代理规则时必须同步更新全局 `Script.js`、订阅绑定脚本、主配置 `config.yaml`、`profiles\Merge.yaml` 与服务模式下的 `runtime\config.yaml`；PayPal 全系域名与远程 DoH IP（`1.1.1.1/32`、`8.8.8.8/32` 等）必须一并走美国静态家宽并阻断 `UDP 443`。
12. **Windows 构建与代码搜索工具坑**：
    - Windows 下无 `rg`，搜索代码用 `Get-ChildItem -Recurse | Select-String`；`cargo` 构建/测试务必加 `-j 1`。
13. **【可移植开发必避坑 1】`.baga` 内部 `manifest.home` 强校验与 `account_key` 跨机重算坑**：
    - `src-tauri/src/identities/archive.rs:126` 强制校验 `manifest.home == self.home` 且 `sources` 均为当前机器 `%USERPROFILE%` 下的路径；同时 `catalog.rs:13` 的 `account_key` 是用本机 `key.bin` 计算的 HMAC-SHA256。因此朋友端导入 `.bagapack` 时，绝不能直接把宿主机的 `.baga` 原封不动拷入朋友的 `identity-vault`，必须将相对槽位重写为朋友的 `friend_home.join(...)`，用朋友本机的 `vault/key.bin` 重算 `account_key` 并调用 `codec::Seal::new` 生成新 `.baga`，再通过 `Store::load` 验收。
14. **【可移植开发必避坑 2】伴生浏览器跨机器硬件指纹漂移坑（`browser/config.rs`）**：
    - `browser/config.rs:150` 默认把运行机器的 `machine.cores` 和 `machine.version` 传给 `--fingerprint-hardware-concurrency` 与 `--fingerprint-platform-version`，且默认 `follow_machine: true`、`native_graphics: true`。导出便携包时必须在 `Config` 中固化宿主机核数（`pinned_cores`）与平台版本（`pinned_platform_version`），并强制设 `follow_machine: false`、`native_graphics: false`，否则朋友电脑上的 20 项浏览器验证与 Canvas 哈希会发生跳变。
15. **【可移植开发必避坑 3】Windows Chromium DPAPI (`os_crypt`) 阻断 Cookie 直接拷贝与扩展权限红线坑**：
    - Windows 下 Chromium `Default/Network/Cookies` 的 AES 密钥经 DPAPI 绑定在宿主机 Windows 用户 SID 上，直接拷贝 `browser/contexts/{slot}/profile` 到朋友电脑必然报 `0x80090005` 解密失败；同时 `browser-runtime/CLAUDE.md` 规定内置 `quota-bridge` 扩展严禁读取 Cookie（`"never reads cookies"`）。因此跨机迁移网页登录态必须走内置 Chromium 的本地回环 CDP（`Storage.getCookies` / `Storage.setCookies`），切勿修改 `quota-bridge` 扩展权限或直接打包整个 `User Data` 目录。
16. **【可移植开发必避坑 4】Kookeey SOCKS5 账密限制与双机同开碰撞坑**：
    - `browser/config.rs:101` 拒绝带用户名密码的代理 URL，因此朋友端必须通过本地 Mihomo 独立监听端口 `127.0.0.1:7899`（`type: mixed, udp: false`）桥接 Kookeey 节点；且宿主机导出后必须默认将该卡标记为 `handed_off` 冻结态（从智能接力推荐与批量额度轮询中排除），防止两台不同 `machine-id` 的电脑并发刷新同一 `refreshToken`。

---

## 6. 关键源码与文档速查索引

- **单账号跨机可移植与朋友交接历史研究（已取消，不作为实施指令）**：
  - `docs/PORTABILITY_PLAN.md`
- **卡片横向拖拽排序、紧凑卡片样式与身份/养号工作台（本轮重点修改）**：
  - `src/card-order.ts`、`src/card-order.test.ts`
  - `src/identities.tsx`、`src/warming-cards.tsx`、`src/style.css`、`src/identity-productivity.css`
  - `src-tauri/src/identities/archive.rs`、`src-tauri/src/identities/profile.rs`、`src-tauri/src/identities/tests.rs`
  - `scripts/test-identities-ui.ts`、`scripts/test-warming-ui.ts`、`scripts/test-quota-reset.ts`
- **额度小窗（Quota HUD）原生层、模型与界面（P0 / P1 / P5）**：
  - `src-tauri/capabilities/main.json`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.windows.conf.json`、`src-tauri/tauri.linux.conf.json`
  - `src-tauri/src/monitor_window.rs`、`src-tauri/src/main.rs`、`src-tauri/src/ui_language.rs`、`src-tauri/src/local_edition_tests.rs`
  - `src/floating-monitor-model.ts`、`src/floating-monitor-model.test.ts`、`src/floating-monitor.tsx`、`src/floating-monitor.css`
- **多账号智能接力与在线额度定向查询（P3 / P5 / P6）**：
  - `src/smart-relay-model.ts`、`src/smart-relay-model.test.ts`
  - `src/identity-online-quota.ts`、`src/identity-online-quota.test.ts`、`src/identity-quota.ts`
- **用量分析、单次效率、五维排序与 Markdown/TSV 导出（P2 / P7）**：
  - `src/usage-statistics.tsx`、`src/usage-statistics.css`、`src/usage-table.tsx`
  - `src/usage-export.ts`、`src/usage-export.test.ts`、`src/usage-model.ts`、`src/usage-model.test.ts`
- **风控核验、PayPal/Stripe/KYC 同源家宽分流与 Cookie 清理助手（P4）**：
  - `src/vps.tsx`、`src/risk-model.ts`、`src/risk-model.test.ts`、`src/risk-verification.tsx`
- **本地备份与打包审计产物（均在 `.local/` 忽略目录内，切勿提交）**：
  - `.local/tasks/20261102-handoff-portability-plan/HANDOFF.md.bak`（本会话重写 `HANDOFF.md` 前的 SHA-256 校验备份）
  - `.local/artifacts/20261101T051704Z-c2d03423ff1946e1beb70aa1dc2e9138/`（`Claude-Local_0.2.5_x64-setup.exe`、`SHA256SUMS.txt`）
  - `.local/tasks/20261101-cleanup-empty-card/`（本轮清理多余空白身份卡前的 SQLite 与 `.baga` 备份）
  - `.local/tasks/20261101-paypal-us-residential/`（Clash Verge Rev 配置备份）
  - `.local/tasks/20261101-handoff-p0-p7/`（`HANDOFF.md` 历史备份）
