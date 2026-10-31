<!--
[INPUT]: Verified v0.2.4 multi-account Smart Relay & rotation, WebRTC Network Limiter lockdown & Clash/Mihomo anti-leak global override YAML, official API USD cost & cache savings analytics, 2-column Shadowrocket bridge & paste auto-split, companion browser verification header & CLI return workflow, activity log dismissal, neutral Windows NSIS build audit, and GitHub Release v0.2.4.
[OUTPUT]: Context-free handoff for a brand-new session covering task overview, completed deliverables, current state/remaining boundaries, next steps and critical pitfalls to avoid.
[POS]: Root maintenance handoff; real identities, IP/proxy values, process IDs, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only updates do not build/deploy, reload proxies, operate accounts, package/upload or move release tags.
-->
# Claude-Local 新会话交接文档（无上下文直接接手）

更新时间：2026-10-31 05:00 EDT（America/New_York）。当前最新正式发布至 GitHub Release（Latest）的版本为 **`v0.2.4`**，`main` 分支与本机安装目录 `%LOCALAPPDATA%\Programs\Claude-Local` 均已同步至 **`v0.2.4`**。

> **给新会话的第一句话（必读）**：
> 本次 `v0.2.4` 版本的全部功能研发、界面与交互打磨、WebRTC 与 Clash/Mihomo 防泄露加固、单元测试与 Playwright UI 回归、本机热更新、中性目录 NSIS 安装包构建（109 文件白名单 + 29 项隐私探针 `0` 命中）、双语 `README.md` / `README_EN.md` / `docs/RELEASE_NOTES_0.2.4_SMART_RELAY.md` 更新以及 **GitHub Release `v0.2.4` 正式发布**均已圆满完成：
> 1. **多账号智能接力与轮换（Smart Relay，借鉴 `yetone/magpie`，默认关闭）**：在 `src/smart-relay-model.ts`、`src/identities.tsx`、`src/settings.tsx` 实现完整的多账号智能接力工作台（默认 `enabled: false`；支持在身份管理顶栏胶囊、`⋯` 菜单或软件设置中开启；平铺展示全量账号池而无需嵌套滚动条；支持「智能 / 按顺序 / 轮流 / 用量少的优先 / 重置前用完」五大路由策略、被限流时「保持原位 / 排到最后」、会话保持与换号阈值 `90% / 95% / 98% / 100%`、首选号滞回恢复切回，以及弹窗与顶部横幅一键切换按钮）。
> 2. **伴生浏览器 WebRTC 全链路防泄露与桌面端 Clash/Mihomo 一键覆写规则（`.yaml`，借鉴 `ryuu-restart/agent-route` 与 `ippure.com` 防封实践）**：
>    - 在 `src-tauri/src/browser/profile.rs` 的 `preferences()` 中写入 Google 官方 `WebRTC Network Limiter` 同款完整三项策略（`webrtc.ip_handling_policy = "disable_non_proxied_udp"`、`webrtc.multiple_routes_enabled = false`、`webrtc.nonproxied_udp_enabled = false`），并在 `src-tauri/src/browser/config.rs` 注入 `--enforce-webrtc-ip-permission-check`、去重 `--host-resolver-rules` 的 `EXCLUDE 127.0.0.1`、追加 `--test-type` 消除 Chromium 顶部不支持参数横幅。
>    - 在 `src/risk-model.ts`（`buildDesktopMihomoAntiLeakYaml`）与 `src/risk-verification.tsx` 底部新增 **「查看一键覆写配置 (.yaml)」** 与 **「复制覆写配置 (.yaml)」**，一键生成可直接粘贴进 Clash Verge Rev 全局扩展覆写（Merge）的防泄露 YAML（阻断 `UDP 443` QUIC 与 `UDP 3478/19302/5349` WebRTC STUN/TURN、拦截 `198.18.0.0/15` Fake-IP、锁定 `1.1.1.1/1.0.0.1/8.8.8.8` DoH 走家宽、配置 `:7899` 纯 TCP 监听并将 `claude.ai` / `withpersona.com` / `stripe.com` / `ipquery.io` / `ippure.com` 统一锁死同一静态家宽出口）。
> 3. **用量分析（`用量分析`）官方 API 美元等效花费（`$`）与缓存节省升级**：在 `src/usage-model.ts`、`src/usage-statistics.tsx` 中用高价值的 **API 等效花费（`$`）**、**缓存节省（`$`）**、**缓存命中率（`%` + 缓存复用倍数）** 与 **日均/时均等效花费（`$`）** 替换原摘要区低信息量的「会话数」、「去重响应数」与重复「活跃天数」，并在模型分布、Effort 档位与多账号表中全面展示 `$` 花费。
> 4. **风控验证（`风控验证`）两步状态去误报与小火箭（Shadowrocket）双栏桥接优化**：第 1 步静态检查 `3/3` 通过且未点击实测时展示清爽绿色横幅（消除旧版黄色「配置缺失」误报），移除右上角重复的「开始一致性实测」与无作用的「刷新本机配置」按钮；将手机扫码桥接重构为左右均衡双栏卡片，并支持在代理地址框直接粘贴 `socks5://user:pass@host:port` 或 `host:port:user:pass` 自动拆解填入四项参数。
> 5. **伴生浏览器实测页（`browser.html`）、养号返回 CLI 浏览器与操作日志彻底关闭**：将 `browser.html` 的「仅核验所选浏览器环境，不验证网页登录或 CLI 授权。」整合进顶部深色身份工牌下层（`.verification-scope`）；在身份卡片菜单与额度详情中新增「进入 Claude.ai」、「打开官方用量页」、「返回 CLI 浏览器」快捷入口，并在养号激活时于身份栏顶部提供一键「返回 CLI 浏览器」；点击「关闭记录」后操作日志彻底隐藏（`return null`），「检查更新」无安装时不弹冗余日志，养号操作日志归位至「养号」专区内部。
> 6. **请勿重复实现上述已交付功能，也不要回退或移动 `v0.2.4` 标签及已上传安装包资产。**

新会话接手时请依次阅读：本文（`HANDOFF.md`） → 根目录 `AGENTS.md`（切勿提交到 Git） → 根目录 `CLAUDE.md`；修改具体模块前先读对应子目录的 `CLAUDE.md` 与源文件头注释（`[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]`）。本文受 Git 跟踪，**严禁写入任何真实账号、邮箱、身份指纹、真实 IP、代理凭据、个人绝对路径或真实截图**。

---

## 1. 我们在做什么任务

**Claude-Local** 是基于开源项目 [CCBaga](https://github.com/liseami/CCBaga) 二次开发并在本仓库独立维护的 **Windows 10 / 11 x64** 桌面工作台（技术栈：Tauri 2 + Rust 后端、React 19 + TypeScript 前端、Python 外部额度单写者与加密备份脚本）。核心解决开发者在 Windows 桌面端管理多个 **Claude Code CLI** 与 **Claude Pro / Max / 待转正养号卡片** 时的五大痛点：
1. **多身份加密保险库与零强杀安全切号**（`BAGAID01` / `.baga` 归档、SQLite `user_version = 3`、`claude.exe` 进程锁检查、跨账号四维残留消毒、全链路 `.clbackup` 加密备份）。
2. **Magpie 风格多账号智能接力与轮换（Smart Relay）**（默认关闭，五大路由策略、限流顺位处理、会话保持、首选号滞回恢复切回与一键安全接力）。
3. **被动额度同步、原生进程内 5h 自动续杯调度与多模态悬浮窗（HUD）**（Python 独占写 `quota_ledger.json`，零后台 OAuth 轮询、零 `.claude.json` 写入）。
4. **CPAMP / ccusage 风格本地 Token 与官方 API 美元等效花费（`$`）分析**（四类 Token 构成、API 等效花费 `$`、缓存节省 `$` 与复用倍数、模型与 Effort 分布、IANA/DST 时区与 TSV 导出）。
5. **身份绑定的防关联伴生浏览器（Fingerprint Chromium）与风控 / KYC 环境核验**（每身份/每养号卡独立槽位与确定性指纹种子、WebRTC Network Limiter 三重强锁、按需无阻断 Kill-Switch、20 项浏览器实测、6 项网络/DNS/Mihomo 运行时风控核验、桌面端一键 Clash 防漏覆写 YAML、手机同住宅出口 LAN 扫码桥接）。

---

## 2. 已经完成了什么（v0.2.4 完整交付清单）

### 2.1 多账号智能接力与轮换（Smart Relay，`src/smart-relay-model.ts` & `src/identities.tsx` & `src/settings.tsx`）
- **借鉴 `yetone/magpie` 的多账号路由与首选号滞回恢复机制**：
  - 默认关闭（`enabled: false`），持久化于本地 `claude-local.smart-relay.v1`，不干扰原有手动使用习惯。
  - 双入口配置：「身份管理」顶栏右侧胶囊 `[• 智能接力 | 策略]` / `[⋯]` 更多菜单，以及「软件设置 → 通用」。
  - **平铺全量账号列表（无嵌套滚动条）**：直观展示当前身份与全部已保存身份的 `5h / 7d` 已用百分比进度条、重置时间、`当前` / `首选` / `下一顺位` 徽章，支持勾选参与轮换池与一键「设为首选」。
  - **五大路由策略**：`smart`（三级余量池 `>90% / 10% / 耗尽` + 优先消耗最快重置窗口）、`ordered`（按顺序）、`rotate`（轮流 Round-Robin）、`least_used`（用量少的优先）、`pace`（重置前用完）。
  - **被限流处理与会话保持**：支持 `keep_position`（保持原位）与 `sink_to_end`（排到最后）；会话保持支持 `auto`、`session`、`manual`；换号阈值支持 `90% / 95% / 98% / 100%`。
  - **首选号恢复滞回保护（Hysteresis）与一键切换**：当启用「首选账号恢复后切回」且首选账号冷却恢复至安全余量（`5h` 已用低于阈值 `15%` 以上且 `7d < 85%`）时，弹窗底部状态卡与「身份管理」顶部横幅自动提示一键 **`切到 {目标账号}`**。

### 2.2 伴生浏览器 WebRTC 全链路防泄露与桌面端 Clash 一键覆写配置（`.yaml`）
- **伴生浏览器底层 WebRTC Network Limiter 三重加固**：
  - `src-tauri/src/browser/profile.rs`（`preferences()`）：在写入 `Default/Preferences` 时完整设置 Google 官方 `WebRTC Network Limiter` 扩展同款三项策略：
    - `webrtc.ip_handling_policy = "disable_non_proxied_udp"`
    - `webrtc.multiple_routes_enabled = false`
    - `webrtc.nonproxied_udp_enabled = false`
  - `src-tauri/src/browser/config.rs`（`arguments()`）：新增 `--enforce-webrtc-ip-permission-check`，去除 `--host-resolver-rules` 中重复的 `EXCLUDE 127.0.0.1`，并加入 `--test-type` 消除 Chromium 顶部的 `"You are using an unsupported command-line flag"` 提醒条。
- **「风控验证」桌面端 Clash Verge / Mihomo 一键覆写配置（`buildDesktopMihomoAntiLeakYaml`）**：
  - 在 `src/risk-model.ts` 与 `src/risk-verification.tsx` 底部新增 **「查看一键覆写配置 (.yaml)」** 与 **「复制覆写配置 (.yaml)」**，生成可直接粘贴至 Clash Verge Rev 全局扩展覆写（Merge）的 YAML：
    - 阻断 `UDP 443` QUIC 与 `UDP 3478/19302/5349` WebRTC STUN/TURN 端口及 `DOMAIN-KEYWORD,stun,REJECT`；
    - 封锁 `IP-CIDR,198.18.0.0/15,REJECT,no-resolve` Fake-IP 回流并强制 `1.1.1.1/32`、`1.0.0.1/32`、`8.8.8.8/32` DoH 走家宽节点；
    - 开启 `tun.strict-route: true`、`dns.respect-rules: true` 与 `:7899` 纯 TCP 独立监听（`udp: false`）；
    - 将 `claude.ai`、`anthropic.com`、`withpersona.com`、`stripe.com`、`ipquery.io`、`ippure.com` 统一锁定至同一静态家宽节点。

### 2.3 用量分析（`用量分析`）美元等效花费（`$`）与风控验证 / 小火箭双栏体验升级
- **用量分析高价值 `$` 指标**：
  - `src/usage-model.ts`、`src/usage-statistics.tsx`、`src/usage-statistics.css`：将主摘要区右侧升级为 **API 等效花费（`$`）**、**缓存节省（`$`）**、**缓存命中率（`%` + 缓存复用倍数）** 与 **日均/时均等效花费（`$`）**，并在模型分布、Effort 档位与多账号表中展示 `$` 花费。
- **风控验证与小火箭（Shadowrocket）双栏桥接优化**：
  - `src/risk-verification.tsx`、`src/risk-verification.css`：消除第 1 步 `3/3` 通过但第 2 步未实测时的黄色误报横幅，移除顶部重复的「开始一致性实测」与无用的「刷新本机配置」按钮；将手机扫码桥接重构为左右均衡双栏布局，并支持粘贴完整代理串自动拆解主机、端口、账号与密码。

### 2.4 伴生浏览器实测页、养号返回 CLI 浏览器与操作日志关闭打磨
- **`browser.html` 深色一体化身份与范围卡**：在 `src/browser-start.tsx` 与 `src/style.css` 中将 `.verification-scope` 嵌入 `.verification-identity` 深色卡片下层，统一排版与字体。
- **养号后一键返回 CLI 浏览器**：在 `src/identities.tsx`、`src-tauri/src/browser/lifecycle.rs`、`src-tauri/src/browser/quota_connection.rs` 中，为身份卡片菜单与额度详情新增「进入 Claude.ai」、「打开官方用量页」、「返回 CLI 浏览器」，并在养号浏览器激活时于身份栏顶部显示一键「返回 CLI 浏览器」按钮，切换 CLI 身份时同步切回 CLI 浏览器。
- **操作日志彻底关闭与养号日志归位**：在 `src/cleaner-activity.tsx`、`src/claude-cli-panel.tsx`、`src/warming-cards.tsx` 中，点击「关闭记录」后彻底隐藏面板（不再残留「查看上次记录」），点击「检查更新」无安装时不弹日志，养号操作日志直接渲染在「养号」专区内部。

### 2.5 验证、本机热更新与 `v0.2.4` 打包发布回执
- **自动化测试全部通过**：
  - `bun x tsc --noEmit && bun test`：**162 passed, 0 failed**
  - `cargo test -j 1 --manifest-path src-tauri/Cargo.toml browser::`：**44 passed, 0 failed**
  - Playwright 隔离 UI 验收（`--verification-only`、`--warming-only`、`--cards-only`）：**10 + 29 + 28 checks passed**
- **中性目录 NSIS 安装包构建与 29 项隐私探针解包审计**：
  - 产出目录：`.local/artifacts/20261031T084338Z-3b7d1f2ab630482c9f01faa6f30e3e45/`
  - 安装包：`Claude-Local_0.2.4_x64-setup.exe`
  - 文件大小：**`140,893,501` 字节（`134.37 MiB`）**
  - SHA-256：**`ceae7f931c15ae857c235f89b464e2c6c4cbcd912ae1a044c304dbb107cdecec`**
  - 隐私审计：109 个解包文件全部匹配资源白名单，29 项外置隐私探针扫描 **`0` 命中**。
- **本机安装目录安全热更新**：
  - 已将 `v0.2.4` Release 宿主与前端资源部署至 `%LOCALAPPDATA%\Programs\Claude-Local`（本机已安装 `claude-local.exe` SHA-256 为 `3523012c0ac826af35e6d466c01ab32fe561957b0eb60b49d7d50f642872ee1d`），并通过 `Win32_Process` CIM `Create` 重启 GUI；**本机正在运行的 `claude.exe` 终端进程全程保持原 PID 与启动时间无中断**。

---

## 3. 当前卡在哪（当前无阻塞）

当前**没有任何代码、构建、测试或发布阻塞**。工作区干净（仅保留用户原有的未提交 `AGENTS.md`，按规则绝不触碰或提交）。

---

## 4. 下一步计划是什么

目前 `v0.2.4` 所有目标均已圆满收官。新会话启动后：
1. **先听取用户的新指令**：若用户提出新的需求或反馈，先阅读相关模块的 `CLAUDE.md` 与源码头，按需制定方案。
2. **远期可选储备方向（仅在用户明确要求时再启动，切勿自行开工）**：
   - 多槽位浏览器完整并行 20 项回环实测会话（`HashMap<String, SlotSession>`）；
   - 单身份便携包（`.bagapack`）独立导出与导入。

---

## 5. 有哪些踩过的坑绝对不要再踩

1. **绝不中断或强杀正在运行的 `claude.exe`（Claude Code CLI）**：
   - 无论是开发调试、跑测试还是做本机热更新，都只允许操作 `claude-local.exe`（GUI 宿主），**严禁停止、重启或干扰任何 `claude.exe` 进程**。
2. **绝不提交或还原根目录 `AGENTS.md`，绝不将 `.local/` 或真实隐私数据带入 Git**：
   - `AGENTS.md` 必须始终留在未暂存状态（`git add` 时显式指定文件路径，切勿 `git add .` 或 `git add -A`）。
   - 严禁使用 `git clean`、`git reset --hard`、`git checkout --`、`git restore` 或递归删除工作区。
3. **持久格式兼容性绝对不可破坏**：
   - `BAGAID01` 魔数、`.baga` 归档格式、SQLite `user_version = 3`、账号 HMAC 计算规则以及历史 `CCBaga/browser/...` 确定性种子派生域字符串属于持久数据格式契约，严禁修改。
   - `quota_ledger.json` 必须保持 **Python 唯一写入者**，Rust 端只读合并，绝不向 `~/.claude.json` 写入额度字段。
4. **Windows 构建与工具链注意事项**：
   - 运行 `cargo test` 或 `cargo build` 前设置 `$env:CARGO_INCREMENTAL="0"; $env:CARGO_BUILD_JOBS="1"` 并加 `-j 1`。
   - 生产构建与本地部署必须带 `--features custom-protocol`。
   - 在 PowerShell 工具调用中重启常驻 GUI 进程时使用 `Invoke-CimMethod -ClassName Win32_Process -MethodName Create`。
