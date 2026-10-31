<!--
[INPUT]: Verified v0.2.3 security & warming enhancement implementation (F1–F6 + Stage A/B polish), neutral Windows NSIS build audit, backed-up local GUI deployment and GitHub Release v0.2.3.
[OUTPUT]: Context-free handoff for a brand-new session covering task overview, completed v0.2.3 deliverables, current state/remaining boundaries, next steps and critical pitfalls to avoid.
[POS]: Root maintenance handoff; real identities, IP/proxy values, process IDs, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only updates do not build/deploy, reload proxies, operate accounts, package/upload or move release tags.
-->
# Claude-Local 新会话交接文档（无上下文直接接手）

更新时间：2026-10-30 06:25 EDT（America/New_York）。当前最新已开发、已验证、已本机热更新并正式发布至 GitHub Release（Latest）的版本为 **`v0.2.3`**（源码标签 `v0.2.3` 指向提交 `dd25de8`）。

> **给新会话的第一句话（必读）**：
> 本次 `v0.2.3` 版本已将两套规划方案中的核心任务**全部编码落地、测试通过、更新至本机安装目录，并打包上传发布至 GitHub Release `v0.2.3`**：
> 1. `docs/plans/2026-10-30-security-and-warming-enhancement/` 中的 **F1–F6 全部完成并交付**（F1 伴生浏览器按需无阻断防泄露断路器 Kill-Switch、F2 Mihomo `strict-route` 分层闭环修复向导、F3 养号卡常驻国家/时区锁定与打开前防漂移确认、F4 养号编辑弹窗阶段防封 SOP 折叠指南、F5 额度详情高消耗速率温和提示、F6 全链路 `.clbackup` 覆盖 `warming_cards.json` 与 `manual_subscriptions.json`）。
> 2. `docs/plans/2026-10-30-multi-account-optimization/` 中的 **阶段 A（操作进度日志关闭/重开、返回 CLI 浏览器自动清理陈旧提示、自动续订与手动到期悬停提示区分、过期重置次数防误导）** 与 **阶段 B（跨槽位绑定资料直接同步当前 CLI 订阅日期与重置次数）** 及 **阶段 D（即 F6 备份范围扩展）** 均已完成并随 `v0.2.3` 一起交付。
> 3. **请勿重复实现上述已交付功能，也不要回退或移动 `v0.2.3` 标签及已上传安装包资产。**

新会话接手时请依次阅读：本文（`HANDOFF.md`） → 根目录 `AGENTS.md`（切勿提交到 Git） → 根目录 `CLAUDE.md`；修改具体模块前先读对应子目录的 `CLAUDE.md` 与源文件头注释（`[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]`）。本文受 Git 跟踪，**严禁写入任何真实账号、邮箱、身份指纹、真实 IP、代理凭据、个人绝对路径或真实截图**。

---

## 1. 我们在做什么任务

**Claude-Local** 是基于开源项目 [CCBaga](https://github.com/liseami/CCBaga) 二次开发并在本仓库独立维护的 **Windows 10 / 11 x64** 桌面工作台（技术栈：Tauri 2 + Rust 后端、React 19 + TypeScript 前端、Python 外部额度单写者与加密备份脚本）。核心解决开发者在 Windows 桌面端管理多个 **Claude Code CLI** 与 **Claude Pro / Max / 待转正养号卡片** 时的四大痛点：
1. **多身份加密保险库与零强杀安全切号**（`BAGAID01` / `.baga` 归档、SQLite `user_version = 3`、`claude.exe` 进程锁检查、1572 行跨账号四维残留消毒）。
2. **被动额度同步、原生进程内 5h 自动续杯调度与多模态悬浮窗（HUD）**（Python 独占写 `quota_ledger.json`，零后台 OAuth 轮询、零 `.claude.json` 写入）。
3. **CPAMP / ccusage 风格本地 Token 用量分析**（未缓存输入/输出/缓存写入/缓存读取四类构成、统计身份独立登记、模型与 Effort 分布、IANA/DST 时区与 TSV 导出）。
4. **身份绑定的防关联伴生浏览器（Fingerprint Chromium）与风控 / KYC 环境核验**（每身份/每养号卡独立槽位与确定性指纹种子、20 项浏览器实测、6 项网络/DNS/Mihomo 运行时风控核验、手机同住宅出口 LAN 桥接）。

### 用户的真实使用习惯与架构取舍（已与用户对齐确认）
- **单出口顺序使用模型**：用户所有账号均通过本机 Clash Verge Rev（Mihomo 内核）TUN 模式共用同一个美国静态家宽出口，日常按顺序使用账号（极少同时跑多个账号，仅偶有在跑主力 Pro CLI 时打开某张养号卡网页查看）。因此**不需要**强推多账号不同代理 IP 池重架构。
- **单活跃 CLI 会话交接模型**：用户不需要多个 `claude.exe` 同时跑不同账号，现有 `--resume` 会话交接与 `cleaner_identity.rs` 跨账号残留消毒已满足切号需求。
- **真正高优诉求**：防止代理/TUN 意外掉线或节点漂移导致伴生浏览器直连暴露真实 IP（且断线保护**绝不能影响后续正常重新打开使用，更不能中断 CLI**）、解决 Clash Verge `strict-route: false` 双网卡 DNS 旁路隐患、防止养号卡跨国漂移打开网页触发二次验证，以及全链路备份养号与订阅元数据。

---

## 2. 已经完成了什么（v0.2.3 完整交付清单）

### 2.1 审计并纠偏既有调研与计划文档
在编码前对 `docs/plans/2026-10-30-security-and-warming-enhancement/`（`00-README.md`、`01-FINDINGS.md`、`02-IMPLEMENTATION-PLAN.md`、`CLAUDE.md`）进行了逐行代码级核查，修正了原报告中 6 处与真实代码基线不符的误判：
- **纠正误报 G8/S01 与 G9/S02**：`src-tauri/src/cleaner_identity.rs` 中的旧函数 `sanitize_cross_account_residue` 早已标注 `#[allow(dead_code)]` 且生产路径零调用，生产切号实际调用 `sanitize_cross_account_residue_in_home`；`Store::open` 与 `save_inner` 早已是纯只读或仅更新目标归档，无任何会话改写副作用。
- **纠正误报 G11/S03 与 G12/S11**：`src/identities.tsx` 的 `returnToCliBrowser()` 早已在 `!mountedRef.current` 前调用 `setState` 更新 `active_browser_slot` 与 `warming_cards[].browser_active`；`src-tauri/src/browser/windows.rs` 早已调用 `oauth_route::route_external_urls_locked` 将外部授权链接路由到当前 CLI 绑定资料。
- **纠正 `--disable-spoofing` 语义说明**：在 Fingerprint Chromium 中，`--disable-spoofing` 列表列出的是**豁免伪造、走原生能力**的项（开启 `native_graphics` 时豁免 `canvas,clientrects`，关闭时由 `--fingerprint=<seed>` 确定性接管 Canvas/ClientRects）。
- **补齐 `backup.rs` 白名单预检要求**：只改 `collect_files` 会被 `verify_staged()` 的严格文件名白名单拒绝，必须同步更新 `collect_files`、`rescue_files`、`verify_staged`、`verify_rescue_staged` 与 `identities_backup_restore_new`。

### 2.2 核心安全加固与养号全生命周期功能（F1–F6）
1. **F1 · 伴生浏览器按需无阻断防泄露断路器（Kill-Switch）**：
   - 后端：`src-tauri/src/browser/kill_switch.rs` + `src-tauri/src/risk_check.rs::system_tun_and_dns_status()` + `src-tauri/src/main.rs` 托盘图标联动。
   - **按需激活，零闲置开销**：后台巡检线程仅在检测到受管伴生浏览器（`browser/contexts/*/profile` 或 `browser/profile`）正在运行时激活；当所有受管伴生浏览器关闭时立即休眠，不执行任何 `ipconfig` 或网络请求。
   - **双通道故障触发与防抖**：
     - **系统 TUN 掉线（每 5 秒本地核验）**：若当前运行槽位未配置独立代理（依赖系统 TUN）且连续 2 次确认系统无活跃 TUN 适配器，立即调用 `profile::quit()` 优雅关闭全部运行中的受管伴生浏览器槽位。
     - **出口国家漂移（每 60 秒低频核验）**：若当前槽位锁定了预期国家且机器出口国家发生跨国漂移，立即优雅关闭全部运行中的受管伴生浏览器槽位。
   - **单次急停 + 醒目提醒，绝不拦截后续使用，绝不触碰 CLI**：
     - 触发后托盘图标动态染红，向前端发送 `kill-switch-state` 事件，在 `src/browser.tsx` 顶部渲染红色告警横幅（`[data-kill-switch-banner]`），并提供设置开关（`[data-kill-switch-toggle]`，持久化于 SQLite `settings` 表 `browser.kill_switch_enabled`，默认开启）。
     - 用户恢复代理后，点击横幅「知道了」（`browser_kill_switch_dismiss`）或直接点击任何「打开浏览器并实测」/ 养号卡「打开网页」按钮，浏览器即可正常启动并自动清除告警与恢复托盘图标；**全程绝不停止或干扰任何运行中的 `claude.exe` 进程**。
2. **F2 · Mihomo / Clash Verge `strict-route` 分层闭环修复向导**：
   - 前端：`src/risk-model.ts::buildMihomoStrictRouteSnippet()`、`src/risk-verification.tsx`、`src/risk-verification.css`。
   - 当「风控验证」页检测到 `tun_enabled && tun_strict_route === false` 时，在 `strict-route` 检查项旁渲染「修复 Strict-Route」按钮（`[data-open-strict-route-guide]`），弹窗说明 Clash Verge Rev「订阅配置 → 全局扩展覆写（Merge） → 运行期 `clash-verge.yaml`」三层覆盖机制，提供一键复制全局 Merge 覆写 YAML 片段与「我已完成设置，立即复核」按钮（原位重新调用 `system_network_audit` 验证运行期 `tun_strict_route === true`）。
3. **F3 · 养号卡片常驻国家/时区锁定与打开前防漂移核验**：
   - 后端：`src-tauri/src/identities/warming.rs` 为 `WarmingCardRecord` 与 `WarmingCardView` 新增向后兼容字段（`#[serde(default)]`）：`registered_country`、`registered_timezone`、`last_probe_country`、`last_probe_timezone`、`last_probe_at`，扩展 `identities_warming_update` 支持手动修改/清空锁定地区，并新增 `identities_warming_probe_check(app, id, update_lock)` 命令。
   - 前端：`src/warming-model.ts`、`src/warming-cards.tsx`。首次打开未锁定国家的养号卡时自动探测并锚定常驻国家与时区；后续点击打开前若检测到当前出口国家与 `registered_country` 不一致，弹出 `<AppDialog alert>` 警示确认框（`[data-warming-mismatch-dialog]`），支持「取消」、「仍要打开（不改锁定）」或「更新锁定地区并打开」；卡片环境行内联显示紧凑漂移徽章（`[data-warming-region-drift]`），严守 `180×286` 卡片几何尺寸与零中点（`·`）规范。
4. **F4 · 养号编辑弹窗阶段防封操作指南（SOP）**：
   - 前端：`src/warming-cards.tsx` 在养号卡片新建/编辑弹窗底部内嵌默认收起的 `<Disclosure>`（`[data-warming-sop]`），根据所选阶段（`unregistered` / `kyc_passed` 前 72h 观察期与稳定期 / `warming_free` / `pro_ready`）动态显示防封操作参考建议，并明确标注“社区抗风控经验提示，仅供手动操作参考”，不占用主界面卡片高度。
5. **F5 · 额度详情弹窗高消耗速率温和提示**：
   - 前端：`src/identities.tsx` 在「额度与重置权益」弹窗（`quotaDetails`）内，当 5h 窗口已用 `>= 85%` 或 7d 窗口进度超前 `deltaUsedPct >= 15%` 时，渲染非阻断温和节奏提示（`[data-quota-pace-hint]`）。
6. **F6 · 全链路加密备份扩展（含阶段 D）**：
   - 后端：`src-tauri/src/identities/backup.rs` 与 `backup_tests.rs` 将可选文件 `identity-vault/warming_cards.json` 与 `identity-vault/manual_subscriptions.json` 完整纳入 `collect_files`、自动救援备份 `rescue_files`、`verify_staged`（含养号卡在 `browser_bindings` 中的槽位存在性与正整数 `seed` 校验）、`verify_rescue_staged` 以及隔离恢复 `identities_backup_restore_new`。同步更新 `src/backup-panel.tsx` 及中英双语备份范围说明。

### 2.3 多账号与养号交互细节打磨（阶段 A & B）
1. **跨槽位绑定资料直接同步订阅（阶段 B）**：
   - `src-tauri/src/browser/quota_bridge.rs::sync` 与 `src-tauri/src/browser/quota_connection.rs::launch_bound_profile_url_locked`：解除了原先“当前 CLI 绑定槽位必须等于 `browser.active` 才能同步订阅”的限制。现在即使伴生浏览器当前停留在某张养号卡槽位，点击当前 CLI 身份的「同步订阅日期与额外重置」也会自动确保回环服务就绪，并直接在当前 CLI 身份绑定的独立浏览器资料中打开同步页完成同步，不改动 `browser.active` 也不关闭养号窗口。
2. **操作进度日志可关闭与重开（阶段 A）**：
   - `src/cleaner-activity.tsx::CleanupActivity`：当操作结束（`!activity.running`）后，在日志头部提供「关闭记录」按钮（`[data-activity-dismiss]`），关闭后折叠为精简的「查看上次记录」按钮（`[data-activity-reopen]`）；发起任何新操作时自动恢复展开。
3. **陈旧反馈自动清理与到期/重置语义精确化（阶段 A）**：
   - `src/identities.tsx`：`returnToCliBrowser()` 成功后自动清空陈旧的 `quotaFeedback`，并在主页面 `.identity-online-feedback` 旁提供手动关闭按钮（`[data-quota-feedback-dismiss]`）；`IdentityName` 区分浏览器自动续订日（`identityCard.renewalTooltip`）与手动设置到期日（`identityCard.expiryTooltip`）；`SubscriptionAndResets` 对已过 `validUntil` 有效期的正数重置次数不再展示为当前可用。

### 2.4 已执行的验证、本机热更新与 `v0.2.3` 打包发布结果
- **自动化测试全部通过**：
  - `cargo test -j 1 --manifest-path src-tauri/Cargo.toml warming`：**17 passed, 0 failed**
  - `cargo test -j 1 --manifest-path src-tauri/Cargo.toml backup`：**15 passed, 0 failed**
  - `cargo test -j 1 --manifest-path src-tauri/Cargo.toml kill_switch`：**4 passed, 0 failed**
  - `cargo test -j 1 --manifest-path src-tauri/Cargo.toml risk_check`：**12 passed, 0 failed**
  - `cargo test -j 1 --manifest-path src-tauri/Cargo.toml quota_`：**42 passed, 0 failed**
  - `bun x tsc --noEmit`：**PASS（0 error）**
  - `bun test src/identity-online-quota.test.ts src/i18n.test.ts src/risk-model.test.ts src/backup-panel-workflow.test.ts`：**38 passed, 0 failed**
  - `bun run scripts/test-identities-ui.ts --warming-only`：**29 warming UI checks passed**（含新增的地区漂移拦截弹窗、SOP 折叠面板、Kill-Switch 横幅及 `180×286` 几何零溢出断言）
- **中性目录 NSIS 安装包构建与 29 项隐私探针解包审计**：
  - 构建脚本：`scripts/build-windows-share.ps1`（中性根目录 `D:\ClaudeLocalBuild\...`，`--features custom-protocol --bundles nsis`）。
  - 产出目录：`.local/artifacts/20261030T100102Z-91eca54b81ca417eb557ea43ede2e66f/`。
  - 安装包：`Claude-Local_0.2.3_x64-setup.exe`，大小 **`140,883,227` 字节（`134.36 MiB`）**，SHA-256 为 **`fa122f952b9a0a7987e51047eb3b341171820e58823a4b15380cd85d362b3e31`**。
  - 未打包宿主 `claude-local.exe` SHA-256：**`6351891eb88ca76aa52716a971e0117a53de675f92b23850f2b57025aa451652`**；NSIS 内宿主 SHA-256：**`61305648ec4967ad155470968d633299be1972f0f7c90415628344037f1fdc50`**（仅偏移 `13418642` 处 `UNK` → `NSS` 三字节变换）。
  - 隐私审计：109 个解包文件全部匹配资源白名单，29 项本机外置隐私探针扫描 **`0` 命中**。
- **本机安装目录安全热更新**：
  - 更新前备份位于 `.local/tasks/20261030-v0.2.3-release/deployment-before-20261030T101644Z/`。
  - 已将 `v0.2.3` 宿主与前端资源部署至 `%LOCALAPPDATA%\Programs\Claude-Local`，校验已安装 `claude-local.exe` SHA-256 与未打包宿主完全一致（`6351891eb88ca76aa52716a971e0117a53de675f92b23850f2b57025aa451652`），并通过标准 `Win32_Process` CIM `Create` 重启 GUI；**本机正在运行的 `claude.exe` 终端进程全程保持原 PID 无中断**。
- **GitHub Release 正式发布与双语介绍文档同步**：
  - 标签 `v0.2.3`（指向 `dd25de8`）及公开资产 `Claude-Local_0.2.3_x64-setup.exe`、`SHA256SUMS.txt` 已正式发布至 https://github.com/yq04/Claude-Local/releases/tag/v0.2.3 （`isDraft: false`、`isPrerelease: false`、Latest），GitHub 服务端返回 `digest` 与本地 SHA-256 完全一致。
  - `README.md`、`README_EN.md`、`docs/RELEASE_NOTES_0.2.3_SECURITY.md`、`docs/FEATURE_NOTES_WARMING_CARDS.md`、`docs/PROJECT_ORIGIN.md` 及 GitHub Release `v0.2.3` 页面正文已完整同步 `v0.2.3` 核心特性矩阵、与 CCBaga 的演进对比表、安全边界说明及安装包 SHA-256 校验指引（未移动 `v0.2.3` 标签，未替换已上传安装包资产）。

---

## 3. 当前卡在哪（当前无阻塞，仅列出已知外部边界与未决背景）

当前**没有任何代码、构建、测试或发布阻塞**。工作区干净（仅保留用户原有的未提交 `AGENTS.md`，按规则绝不触碰或提交）。新会话只需了解以下背景边界，避免误判：

1. **本机 Clash Verge `strict-route` 与服务模式（`clash-verge-service`）运行配置核验已全部就绪**：
   - 已应用户要求备份并更新本机 Clash Verge 的 `config.yaml`、`profiles\Merge.yaml`、`clash-verge.yaml` 与 `clash-verge-service` 运行期 `config.yaml`（开启 `tun.strict-route: true`），并通过控制管道热重载运行中的 `verge-mihomo` 内核使其立即生效。
   - 同时已在 `src-tauri/src/risk_config_source.rs` 与 `src-tauri/src/windows.rs` 中补齐对 Clash Verge Rev 2.x 服务模式（`%PROGRAMDATA%\clash-verge-service\users\<64-hex>\runtime\config.yaml`，经 `active-owner.json` / `.runtime-manifest.json` 校验归属当前用户 `%APPDATA%`）的运行期配置来源确认，并热更新至本机安装目录（正在运行的 `claude.exe` 全程保持原 PID 无中断）。
2. **历史某个旧 Pro 账号曾出现的 `403 Request not allowed` 属于外部历史事件**：
   - 用户早已切换至当前正常工作的 Pro 账号；软件层面的 CLI/养号共存隔离、跨账号残留消毒与断路器防护均已交付完毕。新会话切勿自行尝试切换回旧账号或发起任何探测请求。
3. **伴生浏览器的单回环核验会话模型（架构设计边界，非缺陷）**：
   - 当养号窗口打开时，当前 CLI 账号可以通过「打开官方用量页」、「同步订阅日期与额外重置」或受保护的窄 OAuth 授权入口直接启动该 CLI 账号绑定的独立浏览器资料窗口。
   - 但 `browser.html` 的 20 项环境实测回环报告（`Session.report`）在架构上仍绑定当前全局选中的单个槽位（`browser.active`），尚未将回环服务改造为多槽位同时常驻多份独立 20 项实测报告（对应远期可选方案阶段 C/E）。在用户顺序使用账号的习惯下，当前设计已完全够用。

---

## 4. 下一步计划是什么

目前 `v0.2.3` 所有计划内目标均已圆满收官。新会话启动后：

1. **先听取用户的新指令**：
   - 若用户提出新的使用问题或新需求，先阅读相关模块的 `CLAUDE.md` 与源码头，按需复现并制定方案。
   - 若用户希望验证本机 `strict-route` 修复，可引导用户在已更新的 `v0.2.3` 界面打开「风控验证」→ 点击「修复 Strict-Route」→ 复制 YAML 到 Clash Verge 全局扩展配置（Merge）保存重载 → 点击弹窗内「我已完成设置，立即复核」。
2. **远期可选储备方向（仅在用户明确要求时再启动，切勿自行开工）**：
   - **可选方向 1（方案阶段 C / E：多槽位浏览器完整并行管理）**：将 `Browser.session` 升级为 `HashMap<String, SlotSession>`，允许已保存的非当前 CLI 身份卡在不切换 CLI 身份的前提下直接从卡片菜单打开各自绑定的浏览器实测页并独立回传报告。
   - **可选方向 2（方案 F7：`CLAUDE_CONFIG_DIR` 独立目录非破坏性试点）**：评估通过环境变量隔离配置目录的兼容性（注意目前用户仅顺序运行单个 CLI 会话，优先级为 P2 低优）。
   - **可选方向 3（单身份便携包 `.bagapack`）**：目前整库加密备份 `.clbackup` 已覆盖全部身份、养号卡与手动订阅；若未来需要将单个账号连同其元数据单独导出给另一台设备，可设计 `.bagapack` 单身份便携导出。

---

## 5. 有哪些踩过的坑绝对不要再踩

### 5.1 进程、数据与工作区安全铁律（最高优先级）
1. **绝不中断或强杀正在运行的 `claude.exe`（Claude Code CLI）**：
   - 无论是开发调试、跑测试还是做本机热更新（`deploy-local.ps1`），都只允许操作 `claude-local.exe`（GUI 宿主），**严禁停止、重启或干扰任何 `claude.exe` 进程**。本机热更新前后必须记录并核对 `claude.exe` 的 PID 与 `StartTime` 完全不变。
2. **绝不提交或还原根目录 `AGENTS.md`，绝不将 `.local/` 或真实隐私数据带入 Git**：
   - `AGENTS.md` 含有工作区本地规则修改，必须始终留在未暂存状态（`git add` 时显式排除 `AGENTS.md`）。
   - 严禁使用 `git clean`、`git reset --hard`、`git checkout --`、`git restore` 或递归删除工作区。
   - 提交或打包前必须用外置隐私探针扫描所有待提交文件，确保零真实账号、零邮箱、零身份指纹、零代理凭据、零个人路径。
3. **持久格式兼容性绝对不可破坏**：
   - `BAGAID01` 魔数、`.baga` 归档格式、SQLite `user_version = 3`、账号 HMAC 计算规则以及历史 `CCBaga/browser/...` 确定性种子派生域字符串属于持久数据格式契约，严禁在重构或品牌化时修改，否则会导致已有身份库和浏览器指纹失效。
   - `quota_ledger.json` 必须保持 **Python 唯一写入者**（跨进程文件锁 + 原子替换 + 较新锚点优先），Rust 端只读合并，绝不向 `~/.claude.json` 写入额度字段。

### 5.2 本轮实施与调试中踩过的技术坑（重要经验）
4. **锁序与重入坑：`Cleaner` 门禁不可在前端未 `await` 的并行 IPC 间争用**：
   - **踩坑现象**：在实现 F3 打开养号卡前的 IP 地区核验时，若前端对未锁定国家的卡片先不带 `await` 调用 `void invoke('identities_warming_probe_check')`，紧接着立即调用 `onOpen(card, mode)`（内部调用 `identities_warming_open`），而两者都在 Rust 端尝试获取 `cleaner.enter()`，会导致其中一个 IPC 因锁争用报错“正在执行另一项身份或清理操作”。
   - **正确做法（已修复）**：在 `warming.rs::identities_warming_probe_check` 中，前半段只读检查与网络探测不持有 `cleaner.enter()`，仅在需要落盘写入锁定国家/探测结果时短持 `cleaner.enter()`；同时前端 `onOpen` 返回 `Promise<boolean>`，首次未锁定卡片在 `await onOpen(card, mode)` 完成后再顺序触发后台 `identities_warming_probe_check` 锚定国家与时区。
5. **Kill-Switch 的设计边界坑：必须是“单次急停 + 状态提醒”，绝不能做成持久锁死门禁**：
   - **核心原则**：如果把断路器写成“触发后禁止再次启动浏览器，除非先跑通某项检查”，一旦遇上临时网络抖动就会把用户锁在外面无法使用。
   - **正确做法（已落地）**：断路器仅在受管伴生浏览器运行时监测；触发时执行一次 `profile::quit()` 并点亮横幅/红托盘；用户后续点击任何启动浏览器的按钮（`launch_locked`、`launch_with_urls_locked`、`start_windows_companion`、`launch_bound_profile_url_locked`）或点击「知道了」时，均直接调用 `kill_switch::clear_alert(app)` 自动解除告警并正常放行。
6. **备份白名单坑：修改 `.clbackup` 备份范围必须五处同步**：
   - `src-tauri/src/identities/backup.rs` 的 `verify_staged()` 采用了严格的文件路径白名单校验（未知文件直接报错拒绝恢复）。因此新增备份文件（如 `warming_cards.json`、`manual_subscriptions.json`）时，必须同步更新 `collect_files`、`rescue_files`、`verify_staged`、`verify_rescue_staged` 与 `identities_backup_restore_new` 五处，缺一不可。
7. **订阅同步与过期重置次数坑：注意合成测试 Fixture 的字段省略习惯**：
   - `tests/identities-fixture.tsx` 在模拟 `identities_sync_subscription` 时只设置了 `manual_resets_remaining: 0` 而未设置 `manual_resets_valid_until`。因此前端过滤过期重置次数时，应仅针对 `typeof validUntil === 'number' && validUntil * 1000 <= Date.now() && remaining > 0`（明确带有过期时间戳的正数次数）做拦截，保留 `remaining === 0` 或无 `validUntil` 时的展示，确保真实场景与合成测试双向兼容。
8. **Windows 构建与工具链坑**：
   - 在 Windows 下运行 `cargo test` 或 `cargo build` 前，务必设置 `$env:CARGO_INCREMENTAL="0"; $env:CARGO_BUILD_JOBS="1"` 并加 `-j 1`，避免 MSVC `link.exe` 并发争用或 PDB 锁死。
   - 生产构建与本地部署必须带 `--features custom-protocol`；否则 Tauri 宿主会尝试连 `http://localhost:1420` 导致白屏。
   - `scripts/build-windows-share.ps1` 需要显式传入本机已有的 7-Zip 路径（`-SevenZipPath "D:\1_Research\AI_Workspace\Claude-Local\.local\build-tools\7zip-26.04-f4a03f7e\portable\7z.exe"`）。
   - 在 PowerShell 工具调用中重启常驻 GUI 进程时，不要用 `Start-Process`（可能随命令会话结束被 Job Object 回收），应使用 `Invoke-CimMethod -ClassName Win32_Process -MethodName Create` 启动独立进程。
   - 部分源码文件（如 `scripts/test-warming-ui.ts`、`src/cleaner-activity.tsx`）在 Windows 工作区中为 `CRLF` 行尾，使用 `edit_file` 替换多行块若报 `target content not found`，优先改用单行精确锚点替换。

---

## 6. 关键源码与文档速查索引

- **伴生浏览器断路器与生命周期**：
  - `src-tauri/src/browser/kill_switch.rs`（按需巡检状态机、5s TUN 检查、60s 国家漂移检查、托盘图标切换）
  - `src-tauri/src/browser/mod.rs`、`launch.rs`、`windows.rs`、`workspaces.rs`、`lifecycle.rs`
  - `src/browser.tsx`、`src/browser-model.ts`、`src/browser-runtime.ts`
- **风控核验与 `strict-route` 修复向导**：
  - `src-tauri/src/risk_check.rs`、`src-tauri/src/risk_config_source.rs`
  - `src/risk-verification.tsx`、`src/risk-model.ts`、`src/risk-verification.css`
- **养号卡片、地区锁定、SOP 与跨槽位订阅同步**：
  - `src-tauri/src/identities/warming.rs`、`src/warming-cards.tsx`、`src/warming-model.ts`
  - `src-tauri/src/browser/quota_bridge.rs`、`src-tauri/src/browser/quota_connection.rs`
  - `src/identities.tsx`、`src/identity-online-quota.ts`、`src/cleaner-activity.tsx`
- **全链路加密备份与恢复**：
  - `src-tauri/src/identities/backup.rs`、`src-tauri/src/identities/backup_tests.rs`、`src/backup-panel.tsx`
- **发布说明与交付核验文档**：
  - `docs/RELEASE_NOTES_0.2.3_SECURITY.md`、`docs/RELEASE_VERIFICATION_0.2.3_SECURITY.md`
  - `docs/plans/2026-10-30-security-and-warming-enhancement/`、`docs/plans/2026-10-30-multi-account-optimization/`
- **本轮本地备份与打包审计产物（均在 `.local/` 忽略目录内，切勿提交）**：
  - `.local/artifacts/20261030T100102Z-91eca54b81ca417eb557ea43ede2e66f/`（`Claude-Local_0.2.3_x64-setup.exe`、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json`）
  - `.local/tasks/20261030-v0.2.3-release/`（热更新前备份 `deployment-before-20261030T101644Z`、上一版 `HANDOFF.before.md` 及 SHA256 备份回执 `handoff-backup-receipt.json`）
