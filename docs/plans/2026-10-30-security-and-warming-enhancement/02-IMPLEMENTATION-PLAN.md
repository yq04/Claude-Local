<!--
[INPUT]: 源码校准版调研发现（01-FINDINGS.md）、前后端真实 API 签名与数据结构、UI 尺寸红线。
[OUTPUT]: F1–F7 分阶段实施规范、精确代码位置、非阻断保障与验收标准。
[POS]: 编码实施蓝图；所有拟新增字段与命令均经源码兼容性核查。
[PROTOCOL]: 实施前复读根 AGENTS.md/HANDOFF.md、模块 CLAUDE.md。绝不中断 claude.exe，绝不锁死用户后续浏览器使用。
-->
# 分阶段实施方案（源码校准版）

## 0. 目标、依赖和执行边界

目标是在已有 20+6 项核验、确定性指纹和窄缓存维护的基础上，补齐**伴侣浏览器运行期断线保护（Kill-Switch）**、**养号卡国家/时区一致性监测**、**`strict-route` 分层修复向导**、**保险库备份全链路扩展**与**非阻断养号参考建议**。

核心铁律（确保**绝不影响后续正常使用**）：
1. **零后续阻断**：Kill-Switch（F1）仅在伴侣浏览器窗口实际运行期间工作；一旦因 TUN 掉线或出口国家漂移而保护性关闭浏览器，只展示醒目告警横幅并把托盘图标染红，**绝不封锁后续的浏览器打开操作**——用户点击“知道了”或再次点击打开浏览器时，告警状态自动清除、托盘恢复正常。
2. **零误杀设计**：网络超时、DNS 偶发抖动、公共 IP API `HTTP 429` 限流均视为“待定/波动”，绝不触发关窗；仅当本地 TUN 适配器从开启变为掉线（连续 2 次确认）或出口国家码发生跨国漂移（连续 2 次确认）时才触发保护。
3. **不动 CLI 与系统网络**：绝不停止真实 `claude.exe`，绝不修改系统网卡/防火墙/路由表，不引入破坏 `--locked` 离线构建的新增 Cargo 依赖。
4. **严守 UI 几何与兼容边界**：保留 `180×286` 卡片尺寸、28px 按钮、短四步引导，不使用装饰性中点 `·`，保持 `BAGAID01`、`.baga`、SQLite `user_version=3`、HMAC 与 seed 域不变。

---

## F3. 养号卡出口国家与时区一致性监测（P0，先行实施以供 F1 复用）

**对应缺口**：G3。**优先级**：P0。

### F3.1 `warming_cards.json` 元数据扩展（兼容 schema 1）

由于 [`network::probe()`](../../../src-tauri/src/browser/network.rs#L11-L25) 的 `Exit` 结构体返回的是 2 位大写国家码 `country`（如 `"US"`，ISO 3166-1 alpha-2）与 IANA `timezone`（如 `"America/Los_Angeles"`），在 [`WarmingCardRecord`](../../../src-tauri/src/identities/warming.rs#L24-L36) 与 [`WarmingCardView`](../../../src-tauri/src/identities/warming.rs#L38-L58) 中新增带 `#[serde(default)]` 的可选字段：

```rust
#[serde(default)]
pub registered_country: Option<String>,   // 如 "US"（2位大写 ASCII 国家码）
#[serde(default)]
pub registered_timezone: Option<String>,  // 如 "America/Los_Angeles"
#[serde(default)]
pub last_probe_country: Option<String>,   // 最近一次探测国家码
#[serde(default)]
pub last_probe_timezone: Option<String>,  // 最近一次探测时区
#[serde(default)]
pub last_probe_at: Option<u64>,           // 最近一次探测 Unix 秒时间戳
```

- **隐私与容量**：绝不保存真实出口 IP 地址；每张卡仅增加约 80 字节，128 张卡远在 128 KiB 上限内。
- **编辑支持**：`identities_warming_Save` / 编辑弹窗允许用户查看或手动设置/清空 `registered_country`（如 `US`）与 `registered_timezone`。
- **卡面展示**：在 [`warming-cards.tsx`](../../../src/warming-cards.tsx#L90-L94) 的单行 `.warming-region` 中，若已有 `registered_country` 且与最近探测一致或未探测，紧凑附加显示锁定国家码（不使用中点 `·`，不增加新行，保持 `180×286` 高度不变）。

### F3.2 打开养号浏览器前的预检与自动锁定

新增 Tauri 命令 `identities_warming_probe_check(app, id)`（定义在 [`src-tauri/src/identities/warming.rs`](../../../src-tauri/src/identities/warming.rs) 并在 [`src-tauri/src/main.rs`](../../../src-tauri/src/main.rs) 注册）：
1. 通过只读路径查询该养号卡绑定的 `slot = db.browser_for(&id)?`。
2. 读取 `browser/contexts/{slot}/config.json` 的 `proxy`；若为空则回退读取 `browser::config::machine()?.system_proxy`。
3. 调用 `browser::network::probe(&effective_proxy)`：
   - 若探测成功（得到 `exit.country` 与 `exit.timezone`）：
     - 更新该卡的 `last_probe_country`、`last_probe_timezone`、`last_probe_at`。
     - 若该卡尚未设置 `registered_country`（首次打开），自动将 `registered_country = Some(exit.country)`、`registered_timezone = Some(exit.timezone)` 写入保存，并返回 `status: "locked_initial"`。
     - 若已有 `registered_country` 且与 `exit.country` 不一致（或 `registered_timezone` 非空且与 `exit.timezone` 不一致），返回 `status: "mismatch"` 及当前/锁定国家与时区。
     - 若一致，返回 `status: "matched"`。
   - 若探测超时或 `rate_limited`：返回 `status: "probe_skipped"`，**不阻断用户打开浏览器**。
4. 前端 [`warming-cards.tsx`](../../../src/warming-cards.tsx) 在点击打开网页/核验（`open_mode !== 'switch_only'`）时先调用 `identities_warming_probe_check`：
   - 若返回 `"mismatch"`，弹出 `<AppDialog alert>` 提示：“当前出口（{current}）与该养号卡锁定的注册环境（{registered}）不一致，是否仍要打开伴侣浏览器？”，用户可点“继续打开”或“取消”，并在弹窗内允许用户一键“更新锁定环境为当前出口”。

---

## F1. 按需激活、零后续阻断的伴侣浏览器 Kill-Switch（P0）

**对应缺口**：G1。**优先级**：P0。

### F1.1 运行期按需监测与全槽位急停

在 [`src-tauri/src/browser/mod.rs`](../../../src-tauri/src/browser/mod.rs)（或独立子模块 `src-tauri/src/browser/kill_switch.rs`）实现轻量后台守护：

1. **按需激活（浏览器未打开时零外网请求）**：
   - 循环每 15 秒检查一次 `any_managed_profile_running(&root)`（遍历 `browser/contexts/*/profile` 及旧 `browser/profile` 检查 `profile::running`）。
   - 若没有任何受管伴侣浏览器进程运行：重置连续异常计数，**不执行 `ipconfig`、不发送任何 `probe()` 网络请求**。
2. **双层健康检查（仅当伴侣浏览器运行时）**：
   - **第一层（每 15 秒，本地 `spawn_blocking` 检查）**：调用 `risk_check::inspect_system_network_snapshot()` 检查 `tun_adapter_active`。若浏览器打开期间曾观测到 `tun_adapter_active == true`（且当前有效代理为空，即依赖 TUN），而当前 `tun_adapter_active` 突变为 `false`，记一次本地 TUN 掉线异常。
   - **第二层（每 120 秒低频，或本地网络状态变化时）**：按当前活跃槽位的有效代理调用 `network::probe(&effective_proxy)`：
     - 若返回网络超时或 `rate_limited`（HTTP 429）：**忽略，不计入异常**（防误杀）。
     - 若返回的 `exit.country` 与当前卡片/浏览环境预期国家（优先取当前养号卡 `registered_country`，其次取 `Config::region` 推导的 `target_country`，默认 `"US"`）不一致，记一次出口国家漂移异常，并立即在 5 秒后复核一次。
3. **触发保护动作（连续 2 次确认异常后）**：
   - 遍历 `browser/contexts/*/profile`（及 `browser/profile`），对所有正在运行的受管伴侣浏览器实例调用 `profile::quit(&profile_dir)`（确保同时关闭养号窗口、Pro 独立用量页与窄 OAuth 窗口）。
   - 清空 `Browser.quota_sync` 票据并刷新会话 token（`renew_session`）。
   - 将系统托盘图标（`app.tray_by_id("main")`）动态转换为红色告警图标并更新托盘 Tooltip。
   - 记录最新 `KillSwitchAlert` 状态并通过 `app.emit("kill-switch-triggered", &alert)` 通知前端。
4. **零后续阻断恢复机制（确保不影响后续使用）**：
   - 提供 `browser_kill_switch_state` 与 `browser_kill_switch_dismiss`（及开关 `browser_kill_switch_set_enabled`）命令。
   - 前端在顶栏/浏览环境/风控页收到告警后展示醒目的可关闭横幅（说明关闭原因：TUN 掉线 / 出口国家从 XX 漂移至 YY）。
   - **自动解警**：用户点击横幅上的“知道了”按钮，**或者用户修复网络后直接再次点击任何“打开浏览器 / 打开养号网页 / 核验”按钮时**，自动清除告警状态并将系统托盘图标恢复为正常图标，**绝不拦截用户的后续打开操作**！

---

## F2. `strict-route` 分层修复向导与一键复核闭环（P0）

**对应缺口**：G2。**优先级**：P0。

在 [`src/risk-verification.tsx`](../../../src/risk-verification.tsx) 与 [`src/risk-model.ts`](../../../src/risk-model.ts) 中：
1. 当 `local?.mihomo.tun_enabled === true && local?.mihomo.tun_strict_route === false` 时，在 `mihomo_dns_leak` 检查卡片及底部 `.risk-remediation-bar` 中显示 **“修复 Strict-Route”** 按钮。
2. 点击打开 `<AppDialog>` 分层修复向导：
   - 清晰说明为何 `strict-route: false` 存在辅助网卡明文 DNS 泄露风险，以及 Clash Verge Rev / Mihomo Party 的持久层覆盖机制（直接改生成层 `clash-verge.yaml` 会被客户端覆盖）。
   - 提供两个一键复制动作：
     - **一键复制 Clash Verge Merge 覆写 YAML 片段**（`tun:\n  strict-route: true`），指导用户在 Clash Verge「订阅 → 全局扩展覆写配置 (Merge)」中粘贴并保存，或开启虚拟网卡设置中的严格路由开关；
     - **一键复制 AI 诊断提示词**（复用/增强 `desktopFixPrompt`）。
   - 提供 **“我已完成设置，立即复核”** 按钮：点击后触发 `runVerification()`，复核后在同一弹窗或状态栏内立即反馈：`strict-route` 是否已变为 `true`、辅助明文 DNS 警告是否已消除；若仍为 `false`，提示用户检查是否在持久覆写层保存并重启了内核。

---

## F6. 保险库备份全链路扩展（P1，加速完成方案 D 核心目标）

**对应缺口**：G6。**优先级**：P1。

在 [`src-tauri/src/identities/backup.rs`](../../../src-tauri/src/identities/backup.rs) 中全链路支持可选的 `identity-vault/warming_cards.json` 与 `identity-vault/manual_subscriptions.json`：

1. **常量与路径白名单（[`backup.rs:437-446`](../../../src-tauri/src/identities/backup.rs#L437-L446)）**：
   - 在 `allowed_backup_path` 中，除 `identities.sqlite`、`key.bin` 和 `*.baga` 外，允许 `"identity-vault/warming_cards.json"` 与 `"identity-vault/manual_subscriptions.json"`。
2. **导出收集（[`collect_files` at `backup.rs:414`](../../../src-tauri/src/identities/backup.rs#L414)）**：
   - 检查 `vault.join("warming_cards.json")` 是否存在（`symlink_metadata` 存在且为普通文件），存在则先调用 `warming::read_cards(&vault)?` 校验合法性并加入 `files`；
   - 检查 `vault.join("manual_subscriptions.json")` 是否存在，存在则先调用 `subscription::read_store_checked(&vault)?` 校验合法性并加入 `files`。
3. **自检与导入预检（[`verify_staged` at `backup.rs:802-838`](../../../src-tauri/src/identities/backup.rs#L802-L838) 及 [`verify_rescue_staged` at `backup.rs:892-898`](../../../src-tauri/src/identities/backup.rs#L892-L898)）**：
   - 允许 `manifest.files` 包含可选的 `"identity-vault/warming_cards.json"` 与 `"identity-vault/manual_subscriptions.json"`；
   - 若归档中包含 `warming_cards.json`，在 `verify_staged` 中调用 `warming::read_cards(&staged_vault)?` 验证其 schema/大小，并打开 staged `identities.sqlite` 验证每张养号卡的 `id` 在 `browser_bindings` 中均有合法的 `browser_for(&card.id)` 与 `browser_seed(&slot)`！
   - 若归档中包含 `manual_subscriptions.json`，调用 `subscription::read_store_checked(&staged_vault)?` 验证其 schema/大小。
4. **恢复写入与复核（[`identities_backup_restore_new` at `backup.rs:1375-1422`](../../../src-tauri/src/identities/backup.rs#L1375-L1422)）**：
   - 若 `staged_vault` 中存在 `warming_cards.json` 或 `manual_subscriptions.json`，将其一并拷贝至 `copy_vault` 并设置私有 ACL，且在写入后哈希复核循环中校验其 SHA-256。
5. **前端备份范围说明（[`src/identities.tsx`](../../../src/identities.tsx) + 双语目录）**：
   - 在保险库备份/恢复区域明确说明：包含加密身份归档、养号卡元数据与手动订阅日期；不包含伴侣浏览器缓存/Cookie 会话目录（`browser/contexts/*/profile`）。

---

## F4 & F5. 养号编辑弹窗参考建议 SOP 与正式卡额度使用节奏提示（P1）

**对应缺口**：G4、G5。**优先级**：P1。

### F4.1 养号卡编辑弹窗内的可折叠阶段建议
- 在 [`src/warming-cards.tsx`](../../../src/warming-cards.tsx#L100-L110) 的编辑弹窗（`<AppDialog open={!!editor}>`）底部新增默认收起的 `<Disclosure>`（标题：“当前阶段养号参考建议（非官方规则）”）：
  - `unregistered`：建议先通过本卡“核验”模式检查出口国家/DNS/WebRTC，确认锁定国家与时区后再注册。
  - `kyc_passed`（及 `days <= 3` 派生提示）：刚完成注册与号码验证的前 1–3 天建议保持同一国家/时区出口轻度自然对话，暂缓立即高频调用或跨档升级。
  - `warming_free`：保持按自然日适度互动（Day N 追踪），避免出口国家频繁跳变。
  - `pro_ready`：升级订阅并执行“转正为 CLI 身份”前，建议先运行一次风控核验确认 `strict-route` 与出口一致性。
- **严守 UI 约束**：绝不修改 `180×286` 卡片表面高度，绝不添加外部第三方链接，绝不使用此建议阻断任何用户操作。

### F5.1 正式身份卡额度详情弹窗的使用节奏参考提示
- 在 [`src/identities.tsx`](../../../src/identities.tsx#L1853-L1984) 的额度详情弹窗（`quotaDetails`）中：
  - 当该正式身份的 5h 窗口已用百分比 `>= 85%`（剩余 `<= 15%`），或 7d 窗口已用百分比高于 `paceExpected + 15%` 时，展示一行温和的非阻断提示（如：“当前窗口负载较高，建议适度平滑调用节奏或切换至其他可用身份”）。
  - 不为纯浏览器 Free 养号卡伪造不存在的 5h 额度百分比。

---

## F7. `CLAUDE_CONFIG_DIR` 独立评估结论（P2，保持现状不改生产路径）

经源码核查，[`cleaner_identity::root()`](../../../src-tauri/src/cleaner_identity.rs#L395-L397) 返回 `%USERPROFILE%`，`.claude.json` 位于 `%USERPROFILE%\.claude.json`，而 Claude Code CLI 的 `CLAUDE_CONFIG_DIR` 会同时重定向 `.claude/` 目录与 `.claude.json`。鉴于用户采用**单出口顺序使用 + 单活跃 CLI 会话交接**模型，现有加密归档事务与 [`maintain_account_caches`](../../../src-tauri/src/cleaner_identity.rs#L1055-L1143) 已完全满足零串号需求，本阶段不改动生产路径。

---

## 验证标准

1. **Rust 单元测试**：设置 `CARGO_INCREMENTAL=0`、`CARGO_BUILD_JOBS=1`，带 `-j 1` 运行 `warming`、`backup`、`browser`、`risk_check` 定向测试，验证：
   - `WarmingCardRecord` 新旧 JSON 兼容读写、首次 probe 自动锁定国家/时区、国家漂移检测；
   - `KillSwitch` 在无浏览器运行时零探测、连续异常触发全槽位关闭、手动/重开自动解警；
   - `backup` 包含/不包含 `warming_cards.json` 与 `manual_subscriptions.json` 时的导出、`verify_staged` 自检（含损坏/缺绑定拦截）与恢复后哈希校验。
2. **前端与合成测试**：运行 `bun test src/risk-model.test.ts`、双语目录完整性检查、`bun x tsc --noEmit` 及养号 UI 合成测试（`scripts/test-warming-ui.ts` / `scripts/test-identities-ui.ts --warming-only`），确认 `180×286` 卡片尺寸、28px 按钮与双语展示全部通过。
