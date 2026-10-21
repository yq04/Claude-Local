<!--
[INPUT]: Owner requests, Git/worktree state, delivered 0.1.2 receipts, the 0.1.3 frontend unification and installer upgrade sources, and their verification reports.
[OUTPUT]: Standalone session handoff: delivered baseline, 0.1.3 scope and delivery gates, validation limits, next actions and non-repeatable pitfalls.
[POS]: Repository handoff; private paths, proxies, identities, receipts and machine-specific notes stay ignored under .local/.
[PROTOCOL]: Separate published artifacts from later working-tree changes and from out-of-repo environment work. Do not rebuild, republish, clean or deploy merely to refresh this document.
-->
# Claude-Local 会话交接

更新日期：2026-10-21（本机时区 America/New_York，回执用 UTC）。写给没有上文的新会话。

## 1. 当前状态

- **0.1.2 已交付**：发布提交 `34408efbad890358eb3f6b589df5bc95c11659c8`，CI Run `39555056373` 成功，私有预发布 `v0.1.2` 的 8 个附件已独立下载核验。安装包 SHA-256 `59ce86f3918a0282754d0026157452ef0a2c289545661ca82e02b807d65602d4`。不要重跑或覆盖 0.1.2。
- **0.1.3 由所有者授权全权交付**（版本号 0.1.3）。范围是下面第 2 节的两部分源码。交付链沿用 0.1.2：中性 Cargo 根 + `custom-protocol` 构建 → 原 13 标记解包隐私审计 → 本机文件事务替换（只重启 Claude-Local 主程序，不结束 Claude Code 或浏览器）→ 审阅快照提交 → 非强制推送 → 同提交 CI → 私有预发布 8 附件下载核验。**是否已完成以 `.local/last-local-update.json`、`.local/release-0.1.3/published-receipt.json` 和 GitHub Release 状态为准，不以本文件为准。**
- 用户机器上的外部代理配置事故（不属于本仓库）的记录已移到 `.local/handoff-archive/HANDOFF-before-0.1.3-20261021T092525Z.md`。本仓库不包含代理、节点、分流或号池功能，也不提供此类配置。

## 2. 0.1.3 的内容

### 2.1 前端交互统一

- `vendor/cromma-ui` 新增三件只组合已装 Radix 的原语：`SegmentedControl`（ToggleGroup 单选，radio 语义）、`Switch`、`Disclosure`（Collapsible + 行尾 ChevronGlyph + base 档高度动效）。Tabs 与 SegmentedControl 共用 `control.ts` 的分段皮。`MotionRoot` 可接收 `reducedMotion="always"`，并转出 `useSpring`／`useReducedMotionConfig`。没有新增 npm 依赖，`bun.lock` 未变。
- 设置页分栏／分段／开关、侧栏 CN／EN、用量时段与图表／数据、帮助／身份保留策略／浏览器缓存与高级设置／残留提示／用量口径的折叠区全部改用这些原语；删除手写 tablist 方向键、`aria-pressed` 分段、手写开关、emoji 图标与约 190 行重复 CSS。页面切换用 `MOTION.base` 淡入。
- 「减少动画」偏好现在同时驱动 Motion 与 Cromma `--motion-*`。设置页原「检查更新」只是 420ms 定时器后宣称已是最新，已与无消费者的启动检查、更新通道、默认终端一起移除，改为只读版本说明；旧偏好键读取时丢弃。

### 2.2 安装器升级顺序

`src-tauri/windows/installer-hooks.nsh` 通过 `MUI_CUSTOMFUNCTION_GUIINIT → ClaudeLocalUpgradeBeforeWelcome` 在欢迎页前校验当前用户已登记的旧版，确认（默认“否”）后用 Restart Manager **只读**检查占用，再同步调用固定的 `"<旧目录>\uninstall.exe" /UPDATE _?=<旧目录>`，核对返回码 0、旧 exe 消失、四个登记值清空后才进入新版向导；取消、占用、无法验证或失败都直接 `Quit`，不覆盖安装。新卸载器在升级模式下保留浏览器注册名称空间。

**只有源码与合成编译证据**：`scripts/test-installer-upgrade.ps1` 三语警告即错误编译通过（`installerExecuted=false`）。真实安装／升级／卸载从未执行过；本机是手工部署、无卸载登记，文件替换也不会走这条流程。旧 0.1.2 卸载器仍会删除浏览器注册，发行说明已提示升级后需重新设置默认浏览器。

## 3. 已验证（全部为虚构数据）

`tsc`、`bun test` 31 项、`bun run build` + `browser_ui.py`、`cargo metadata --locked`、Python 合成测试（浏览器准备、额度、迁移、打包审计）、`test-usage-statistics.mjs` 全量与 `--quick-only`、`test-identities-ui.ts` 60 项、`test-local-shell.mjs`、安装器三语合成编译。GUI 中工牌仍 180×286，只发生只读 IPC。完整 Rust 原生测试只在 CI 的一次性 runner 上跑（隔离 HOME/APPDATA），本机未跑。

## 4. 下一步

1. 若 0.1.3 交付中断：先读 `.local/release-0.1.3/` 下回执与日志，用 `.local/tools/finish-release-0.1.3.ps1` 的 `-ValidateOnly` / `-PublishOnly` 续跑；不要强推、不要覆盖已发布 Release。
2. 在一次性 Windows 环境（托管 runner、虚拟机或临时账户）用虚构账号验证：首次安装、已登记 0.1.2 → 0.1.3 升级、拒绝／取消、占用重试、失败退出与资料哈希／身份数量保留、浏览器注册状态。不要在本机真实安装或卸载。

## 5. 工作区与归属

- `AGENTS.md` 是用户自己的规则改动，不随版本提交。
- `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/` 不属于产品源码，不移动、不删除、不暂存。
- `.local/`、外部代理配置、凭据、安装包与回执永远不进 Git。

## 6. 踩过的坑

- **Vite 预打包缓存**：`node_modules/cromma-ui` 是安装副本。增删 vendor 文件后要 `bun install`，并让 Vite 以 `--force` 重建一次，否则页面空白且报缺少新导出；依赖哈希只看锁文件，不会自动失效。
- **GUI 选择器语义**：CN／EN 与主题等分段选择是 `radio`；趋势视图与时段是 `tab`／`aria-selected`；折叠区是带 `aria-expanded` 的按钮，不再是 `summary`。
- **SQLite 的 Windows 竞争发生在事务之前**：不要删掉 `Database::open` 的短锁，也不要把它延长成 Database 生命周期锁。
- **NSIS**：`/UPDATE` 只给旧卸载器；`_?=<旧目录>` 必须是最后一个参数；占用检查不能用带 Shutdown 的宏；合成编译产物立即退出，绝不能上传或冒充发行包。
- **发布必须依据同一提交的 CI 结果**；失败要修根因，不能重试碰运气或弱化测试。
- **不要中断运行中的 `claude.exe`**；测试只用合成数据与隔离浏览器；Windows 上用 pwsh 7。
- **保护格式边界**：BAGAID01、`.baga`、SQLite `user_version=3`、账号 HMAC 与旧浏览器种子域保持不变；Python 是额度账本唯一写入者；不写 `.claude.json`、不轮询 OAuth。
