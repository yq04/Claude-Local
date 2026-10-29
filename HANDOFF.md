<!--
[INPUT]: Verified v0.2.2 release/assets/local hot-deploy, identity card MM/DD subscription expiry, Risk & KYC workbench, usage/HUD contracts, and multi-account anti-leakage research.
[OUTPUT]: Context-free handoff covering current task, completed work, blockers/boundaries, next actions, and hard-won pitfalls.
[POS]: Root maintenance handoff; account aliases, emails, IPs, probes, repair receipts, and workstation paths stay strictly in ignored .local/ or %APPDATA%.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only changes do not rebuild binaries, replace release assets, or move product tags.
-->
# Claude-Local 新会话交接文档（v0.2.2）

更新时间：2026-10-29（America/New_York）。

**先读结论：`v0.2.2` 已完成全部功能开发、自动化测试、无隐私解包审计、本机无感热更新（`claude.exe` 全程零中断）及 GitHub Release Latest 正式发布。当前没有任何研发、构建或发布阻塞。新会话接手后请先等待用户新需求，不要重复修改本地数据、不要重打包或移动已发布的 `v0.2.2` 标签。**

新会话请依次先读本文、根目录 `AGENTS.md` 和 `CLAUDE.md`；修改具体模块前再读对应目录的 `CLAUDE.md` 与源码文件头注释（`[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]`）。本文是公开仓库跟踪文件，**严禁写入任何真实账号别名、邮箱、身份哈希、住宅出口 IP、代理凭据、个人工作站路径或真实截图**。

---

## 1. 我们在做什么任务

### 1.1 项目定位与架构边界

Claude-Local 是基于 [CCBaga](https://github.com/liseami/CCBaga) 二次开发、在本仓库独立维护的 Windows 10/11 x64 桌面工作台（非 Anthropic 或 CCBaga 官方产品），核心能力包括：多身份加密归档与切换、被动额度观测、进程内 5h 自动续杯、Token 用量分析、隔离伴侣浏览器、风控验证与手机同住宅出口 KYC 桥接，以及桌面悬浮监控窗（HUD）。

- **Tauri 2 / Rust（`src-tauri/`）**：原生命令、加密身份库事务、进程树检查、伴侣浏览器编排、跨域出口/DNS 风控探测、手动订阅到期存储（`manual_subscriptions.json`）及独立 Token 统计 SQLite 账本。
- **React 19 / TypeScript（`src/`）**：9 页主工作台、弹窗与桌面悬浮小窗；完整维护 `src/locales/zh.yaml` 与 `src/locales/en.yaml` 双语词条。
- **Python 3.10+ / `cryptography`（`scripts/`）**：外部额度账本（`quota_ledger.json`）及网页配额元数据的**唯一写入者**。**Rust Token 统计 SQLite、Rust 手动订阅 `manual_subscriptions.json` 与 Python 额度账本三者严格分仓，互不混写，且绝不写入 `.claude.json`。**
- **标识与目录**：主程序 `claude-local.exe`；Bundle ID `ai.local.claude-local`；伴侣浏览器注册名 `Claude-Local-Browser`；用户数据位于 `%APPDATA%\ai.local.claude-local`；默认安装位于 `%LOCALAPPDATA%\Programs\Claude-Local`。普通启动主程序绝不自动拉起伴侣浏览器。
- **独立与兼容契约**：不配置上游远程同步，不接入外部自动更新源；完整保留原 MIT 版权与 `NOTICE.md` 第三方声明；100% 保持 `BAGAID01`、`.baga` 归档、身份 SQLite `user_version=3`、账号 HMAC 与 legacy 浏览器种子域 `CCBaga/browser/...` 向下兼容。

### 1.2 本轮已闭环任务链

1. **风控验证与移动端同住宅出口 KYC 协助**：协助用户打通桌面端静态住宅链式代理与手机端同住宅出口配置，并在软件内落地「风控验证」工作台（双域出口一致性、DNS 泄露审计、离线手机代理配置生成与二维码投送）。
2. **身份卡片 `PRO`/`MAX` 右侧 `MM/DD` 订阅到期显示与充值补录**：解答订阅到期获取原理，实现卡片 `PRO` 标签右侧月/日格式（如 `11/12`）展示、浏览器自动同步与手动填充值日自动 `+1 个自然月` 推算，并在本机私有 `%APPDATA%` 完成用户现有账号的到期日补录。
3. **继承并固化 `v0.2.2` 用量与 HUD 改造**：统计身份独立登记、受控新登录续聊归属、聚焦四类 Token 构成并隐藏内部“未归属/历史兜底”概念的简洁用量页，以及共享账号隔离账本的 HUD。
4. **`v0.2.2` 本地无感热更新、无隐私审计打包与 GitHub 正式发布**：中性目录构建、NSIS 解包 108 个资源文件与 Git 提交差异的私有特征零检出审计、仅重启 GUI 的本地热部署，以及 GitHub Release `v0.2.2` 资产上传与服务端 SHA-256 核验。
5. **新号注册与充值防关联调研咨询**：输出桌面普通 Chrome vs 内置隔离浏览器 vs iPhone 原生 `Claude App`（美区礼品卡 IAP）的泄露面、清理边界与 CLI 兼容性分析。

---

## 2. 已经完成了什么

### 2.1 身份卡片订阅到期显示（`MM/DD`）与手动充值补录

- **获取机制**：Claude Code CLI 本地的 `.claude.json` 与凭据文件不含月度账单续费日期。现支持双通道：
  1. **自动通道**：账号在绑定的内置伴侣浏览器登录 `claude.ai` 后，点击「同步浏览器订阅」读取官方账单 `renewsAt / endsAt`。
  2. **手动通道**：直接点击身份卡片 `PRO`/`MAX` 右侧的 `MM/DD` 标签，或通过卡片右上角 `⋯` →「设置订阅到期」（及额度详情弹窗「设置」按钮），输入充值日期自动按自然月 `+1 个月` 推算到期日（支持「今天刚充值」快捷按钮），或直接指定到期日、一键清除手动值。
- **后端实现（`src-tauri/src/identities/subscription.rs`，已接线 `identities/online.rs`、`identities/mod.rs`、`main.rs`）**：
  - 独立存储在 `%APPDATA%\ai.local.claude-local\identity-vault\manual_subscriptions.json`（Windows 当前用户 SID 专属保护 DACL + 临时文件原子替换写入），优先按 64-hex `quota_identity`（`by_identity`）索引，回退按 32-hex 记录 ID（`by_record`）索引。
  - `add_one_month_ymd` 处理跨年与大小月/闰月末日夹紧；`ymd_to_utc_noon_sec` 统一锚定当日 **`12:00:00 UTC` 正午时间戳**，确保在北京时间（`UTC+8`）与美东/美西时区（`UTC-4/-5/-8`）下格式化 `MM/DD` 均不会跨天偏移。
  - `apply_manual` 合并优先级：当浏览器后续同步到比手动记录更新一期的官方 `renewsAt/endsAt` 时，自动优先采用最新官方周期；否则展示手动到期日。
  - Tauri 命令 `identities_set_subscription_expiry` 全程不停止 `claude.exe`、不写 `.claude.json`、不触碰 Python 独占的 `quota_ledger.json`。
- **前端实现（`src/identities.tsx`、`src/identity-model.ts`、`src/identity-online-quota.ts`、`src/identity-productivity.css`）**：
  - `IdentityName` 在 `.identity-plan-pill` 右侧渲染 `.identity-expiry-tag`（`[data-identity-expiry]`），严格保持 `180×286` 卡片尺寸不溢出；完成中英双语词条与单测/布局测试覆盖。
  - 用户本机的现有账号充值/到期数据已仅在本机 `%APPDATA%` 的 `manual_subscriptions.json` 中写入生效，100% 未进入仓库。

### 2.2 风控验证工作台与手机同住宅出口 KYC 桥接

- **后端探测（`src-tauri/src/risk_check.rs`）**：Tauri 命令 `risk_run_verification` 通过独立无 Cookie 客户端同时探测 `claude.ai` 与 `withpersona.com` 真实出口 IP、国家、ASN 与机房/住宅分类，审计系统 DNS 解析器与公共 DoH 状态，并结合 `browser::current_risk_browser_context` 校验内置浏览器的目标地区/时区/语言一致性。
- **前端与离线桥接（`src/risk-verification.tsx`、`src/risk-model.ts`、`src/risk-verification.css`、`src/qrcode-svg.ts`）**：
  - 新增第 9 个一级页面「风控验证」（接入 `navigation.ts`、`main.tsx`、`page-icons.tsx`、`command-palette.tsx`、`quick-actions.tsx`、`help.tsx`、`settings.tsx`）。
  - 纯本地离线生成手机端 Shadowrocket / Clash Mi / Stash / sing-box 链式静态住宅代理配置与本机 SVG 二维码（凭据仅留内存/下载文件，零外部请求），协助手机在 Safari 无痕模式下使用与桌面完全相同的静态住宅出口完成 Persona KYC。
  - 同步优化 `src/vps.tsx` 网络排障 AI 提示词（补充 `dialer-proxy` / `detour` 与 Fake-IP 排障上下文，且严格遵守测试禁止出现 `rules:` / `rules=` 的约束）。

### 2.3 Token 统计可靠性、简洁用量页与共享账本 HUD（当前生效产品约束）

- **统计身份独立于归档**：受控「新身份」流程产生受控 empty 登录回执，支持新账号接力旧会话的新响应归属；无充分新会话证据的普通外部变更不臆测旧记录归属；历史全局 fallback 已冻结截止时间。
- **用户明确锁定的 UI 约束（切勿恢复）**：用量页移除美元等效成本与缓存节省金额；**账号筛选下拉框只保留「全部」与正常动态账号列表，严禁恢复“历史兜底规则”横幅、“未归属”提示、特殊筛选项或特殊明细行**。「全部」包含所有有效事件并保持四类 Token（未缓存输入、输出、缓存写入、缓存读取）总量守恒。
- **账号隔离 HUD**：与用量页共用按账号隔离的 SQLite 账本，展示当前账号滚动近 5 小时 Token、四类构成、缓存命中与近 10 分钟平均 `tok/m`（非生成速度 tok/s，移除假定上下文容量与无依据耗尽预测）；账号无法确认时显示未知而非借用全库或伪造零值。

### 2.4 多账号注册与移动端充值调研结论（供后续需求参考）

- **桌面端注册/升级 SOP**：应弃用普通 Google Chrome（存在 WebRTC/QUIC UDP 旁路、顶层 `Local State` 共用、Chrome 同步账号连带风险及 `zh-CN`/`UTC+8` 错位），全程使用 `Claude-Local` 内置隔离浏览器（每身份独立 `--user-data-dir`、独立 `--fingerprint` 种子、禁用非代理 UDP 与 QUIC），在「浏览环境」关闭“跟随本机”锁定 `en-US` 与静态家宽所在美国时区，「风控验证」全绿后用邮箱验证码注册并走网页 Stripe 升级 Pro（100% 兼容 `Claude Code CLI`）。
- **空身份在 Free 养号期的现有行为边界**：`store.rs` 的 `save_current` 目前要求本地存在 CLI 登录凭据（`!record.empty`）才生成已保存身份卡片，而 Free 账号无法登录 `Claude Code CLI`。因此若用户在空身份注册 Free 号后、升级 Pro 登录 CLI 之前切回旧 Pro 卡片跑 CLI，下次再点「新身份」时 `browser_link.rs` 会分配新的随机浏览器槽位。若用户后续明确提出“多天 Free 网页养号同时自由切 CLI”需求，可新增“纯网页养号槽位”特性。
- **iPhone App Store 内购（`apple_subscription`）风险**：① `Claude Code CLI` 官方已知偶发不识别 `apple_subscription` 账单权益（报 `does not have access to Claude Code`）；② 1 个美区 Apple ID 同一时间只能绑定 1 个活跃 Claude Pro 订阅，单台 iPhone 频繁切换多个美区 Apple ID 充礼品卡极易触发苹果锁死余额；③ 未越狱 iPhone 卸载重装+重启虽可刷新 `IDFV` 并清 Safari，但清不掉 iOS `Keychain` 残留。手机端最佳定位是挂同静态家宽辅助网页扫码过 Persona KYC，而非在原生 `Claude App` 内轮换多个主力账号。

### 2.5 当前版本、交付资产与验证证据

- **仓库与正式版**：[yq04/Claude-Local](https://github.com/yq04/Claude-Local) · [v0.2.2 Release (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.2.2)（`draft=false`，`prerelease=false`）。
- **Git 提交拓扑**：
  - 产品标签 `v0.2.2` 固定指向产品源码提交：`13dd440ae448bd2c2fd0d52b069c14210fea3427`。
  - 发布校验文档提交：`3c0b80d`（位于标签之后，记录精确校验和与双语说明，含 `[skip ci]`）；本文本次交接更新同样属于标签后的纯文档维护，不改变产品标签与二进制资产。
  - 公开版本序列：`0.1.0–0.1.5 → 0.2.0 → 0.2.2`（`0.2.1` 仅为未公开本机维护候选）。
- **已发布资产与校验和（已与 GitHub 服务端 `digest` 核对一致）**：
  - 安装包：[Claude-Local_0.2.2_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.2.2/Claude-Local_0.2.2_x64-setup.exe)
  - 大小：`140,697,822` 字节（`134.18 MiB`）
  - 安装包 `SHA-256`：`981b26f6cec183cabf58baefe8bb8184a4d9d647eb30cc65570dd3e111838617`
  - 校验和清单：[SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.2/SHA256SUMS.txt)
  - 未打包宿主 `claude-local.exe` `SHA-256`：`ef4bb6d06ed22c6a32e3341cd43a521dc938600d054bbce91c915d3598e369d9`（本机热部署运行版本）
  - NSIS 内置宿主 `claude-local.exe` `SHA-256`：`5d291cb92df757f437c75654ca9e374a80180d03f6ce7630e0cd1f4bf0256322`（与未打包宿主仅有已审计的 Tauri `UNK → NSS` 三字节 bundle sentinel 差异）
- **审计与自动化测试结果**：
  - `scripts/build-windows-share.ps1` 中性目录构建（`--features custom-protocol --remap-path-prefix`），NSIS 只读解包 `108` 个资源文件，`17` 项本机外置隐私探针检出为 `0`；Git 暂存差异同样通过动态隐私探针扫描（`0` 检出）。
  - `bun test`（24 文件 154 项全过）、Rust `subscription`（4 项）/ `passive_quota_revision`（2 项）/ `risk_check`（6 项）单测、`bun run build && python scripts/browser_ui.py dist`、`node scripts/test-usage-statistics.mjs`（含 `--layout-only` 108 项双语双主题卡片尺寸与遮罩校验）、`bun scripts/test-identities-ui.ts --online-only`（10 项）全部通过。
  - 本机通过 `scripts/deploy-local.ps1` 完成有备份热更新并由 `Win32_Process.Create` 独立拉起新 GUI，活跃 `claude.exe` 会话 PID 与启动时间全程未变。

---

## 3. 当前卡在哪

**当前没有任何研发、测试、构建、部署或发布阻塞。用户本轮提出的全部功能、本地补录、热更新、打包发布与技术调研均已完成。**

以下为既定工程边界与待命演进点（非阻塞项，未经用户明确新指令切勿自行改动）：

1. **Free 纯网页养号未登录 CLI 前的卡片持久化**：如 2.4 所述，当前空身份在未登录 `Claude Code CLI` 前不保存为独立身份卡片；只有用户后续明确要求支持“多日 Free 养号期间自由切回其他 Pro CLI 卡片”时，再设计纯浏览器养号槽位或洁净注册向导。
2. **证据与统计边界**：缺少充分登录/会话证据的历史记录不强行推认归属；无显式 `sessionId` 的日志不伪造会话数。
3. **一次性环境验收与第三方许可边界**：未在用户日常工作站执行会改动系统注册表/卸载状态的 NSIS 向导全生命周期测试（此类测试仅限一次性 Windows runner）；`vendor/cromma-ui`、Pika 子集与 Chromium 完整 credits 的第三方许可说明继续按 `NOTICE.md` 和 `docs/DISTRIBUTION.md` 管理。

---

## 4. 下一步计划

1. **等待用户新需求或使用反馈**。接手时先用 `git status --short --branch` 只读确认工作区状态（预期仅有用户本机预存的 `M AGENTS.md`），不要重跑历史数据补计，不要重建或覆盖 `v0.2.2`。
2. **如用户提出新功能需求（例如「纯网页养号槽位」或「洁净注册向导」）**，先读对应目录 `CLAUDE.md` 与源码头注释，保持双语词条与目录地图同步：
   - 订阅到期与在线配额合并：`src-tauri/src/identities/subscription.rs`、`src-tauri/src/identities/online.rs`、`src/identities.tsx`、`src/identity-online-quota.ts`。
   - 风控验证与手机桥接：`src-tauri/src/risk_check.rs`、`src/risk-verification.tsx`、`src/risk-model.ts`、`src/qrcode-svg.ts`。
   - 浏览器槽位绑定与指纹参数：`src-tauri/src/identities/browser_link.rs`、`src-tauri/src/browser/workspaces.rs`、`src-tauri/src/browser/config.rs`、`src-tauri/src/identities/store.rs`。
   - Token 账本与 HUD：`src-tauri/src/identities/usage.rs`、`src-tauri/src/identities/usage_attribution.rs`、`src/usage-statistics.tsx`、`src/floating-monitor.tsx`。
3. **按改动范围运行最小充分合成验证**：
   - 前端与词条：`bun test`、`bun run build`
   - Rust 定向单测（注意先设防 OOM 环境变量，见第 5 节）：`cargo test -j 1 --locked --manifest-path src-tauri/Cargo.toml --bin claude-local <filter>`
   - UI 布局回归：`node scripts/test-usage-statistics.mjs --layout-only`、`bun scripts/test-identities-ui.ts --online-only`
4. **如后续需要发新版本**：必须递增版本号（如 `v0.2.3` 或 `v0.3.0`，同步修改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`），绝不移动已发布的 `v0.2.2` 标签或覆盖其资产；继续走 `scripts/build-windows-share.ps1` 中性构建 + 7z 解包隐私审计流水线。

---

## 5. 踩过的坑绝对不要再踩

1. **严禁触碰 `AGENTS.md` 与危险 Git 清理命令**：工作区中的 `M AGENTS.md` 是用户本机预存规则，**绝不能 `git add`、提交、还原或删除**；严禁使用 `git clean`、`git reset --hard`、`git checkout -- .`、`git stash` 或递归删除目录。默认终端为 `pwsh`。
2. **维护与热更新期间绝不中断 `claude.exe`（及用户科研进程如 MATLAB）**：热部署只允许精确停止并重启 `claude-local.exe` GUI，操作前后必须核对 `claude.exe` 的 PID 与 `StartTime` 未受影响。所有测试只用合成数据与临时目录，绝不触发真实身份切换或真实清理。
3. **高内存占用下 Cargo 编译防 OOM 崩溃（`0xc0000409`）**：本机常驻大型科研进程（如 MATLAB 占用数十 GB 提交内存）时，直接默认并行编译 Rust 极易耗尽页面文件崩溃。运行任何 `cargo` 命令前务必设置 `$env:CARGO_INCREMENTAL='0'` 并限制并行任务数（如 `$env:CARGO_BUILD_JOBS='4'` 或传 `-j 1`）。
4. **热更新后拉起 GUI 须脱离短期命令 Job Object**：在自动化工具子会话中直接 `Start-Process` 启动的 `claude-local.exe` 可能在命令结束时随 Job Object 被系统回收。应使用 `Invoke-CimMethod -ClassName Win32_Process -MethodName Create` 独立创建桌面进程，并在下一条独立命令中用 `Get-Process claude, claude-local` 确认存活。
5. **打包脚本显式指定 `7z.exe` 与清理临时探针**：本机 `7z.exe` 不在系统 `PATH`（可使用已安装的 `C:\Program Files\AMD\CIM\Bin64\7z.exe` 传给 `-SevenZipPath`）；外置 `-PrivateMarkersPath` 探针文件必须建在仓库外临时目录并在审计完成后立即删除，绝不落入仓库。
6. **严禁 `git push --tags` 与回退不可变标签**：本地仓库存有早期未公开实验标签，批量 `--tags` 推送会污染公开仓库；永远只显式推送目标分支（`main` 及当前工作分支）和明确的单一新版本标签（如 `refs/tags/v0.2.x`）。已正式发布的标签与资产不可移动或静默替换。
7. **三类本地数据通道严格分仓 + 订阅日期 `12:00 UTC` 正午锚点**：
   - Python 是 `quota_ledger.json` 的唯一写入者；Rust 切勿写 `quota_ledger.json`，任何模块切勿写 `.claude.json` 或新增后台 OAuth 轮询。
   - 手动订阅到期只写 `identity-vault/manual_subscriptions.json`；年月日（`YYYY-MM-DD`）转 Unix 秒必须锚定当日 `12:00:00 UTC`（而非 `00:00`），否则在中美时区转换时会导致 `MM/DD` 显示跨天少一天。
8. **网络排障提示词的正则红线（`/rules\s*[:=]/i`）**：`scripts/test-usage-statistics.mjs` 强制校验 `network.agentPromptBody` 不能匹配 `/rules\s*[:=]/i`。修改 `src/vps.tsx` 提示词时，诸如 `dns.respect-rules` 等配置项名称后绝不能紧跟冒号 `:` 或等号 `=`。
9. **不要恢复用户已明确移除的界面或猜价指标**：不要加回美元成本、缓存节省金额、HUD 假定上下文容量/耗尽时间预测，也不要加回“未归属”“历史兜底规则”横幅或下拉项；“保存备份”按钮会先调 `identities_stop`，绝不能建议用户在 CLI 运行时点它。
10. **零隐私泄露铁律（源码 + 安装包 + 文档 + 图片）**：任何可提交文件（含本文、`README*`、`docs/*`、测试样本）不得出现真实账号名/别名、邮箱、64-hex `quota_identity`、真实 UUID、静态住宅 IP、代理地址/口令或个人本机路径；每次 `git commit` 前对 `git diff --cached` 运行隐私扫描，并检查全仓不存在旧版遗留校验和。
11. **本机 CLI / SQLite 小坑备忘**：
    - 本机 `gh release view --json` 不支持 `isLatest` 字段（核验 Latest 请用 `gh api repos/yq04/Claude-Local/releases/latest`）。
    - PowerShell 中含花括号的 Git 参数须加单引号（如 `git rev-parse 'v0.2.2^{}'`）。
    - `%APPDATA%` 下 `identities.sqlite3` 的 `identity_summaries` 表有效载荷列名为 `summary`（操作前先查 `PRAGMA table_info`）。
    - 重写 `HANDOFF.md` 前先备份至忽略目录 `.local/tasks/` 并记录旧版 SHA-256（本次改写前备份位于 `.local/tasks/handoff-backup-20261029T111540Z/HANDOFF.prev.md`，SHA-256 为 `c7d0e0bfc2c1d4ccf9ba79bfec40af4329ed4af85ccbf1051b0ebf3086ca756f`）。
