# scripts/e2e/

> L2 | 父级: `../CLAUDE.md`

独立于产品源码与既有 `scripts/test-*.ts|mjs|py` 的黑盒端到端（E2E）测试基础设施与 4-Tier 需求驱动套件目录。所有用例均在 `mkdtemp` 沙盒、白名单环境变量、`127.0.0.1:0` 临时端口和锁定的 `browser-runtime/WindowsBrowser/chrome.exe` 中运行，严禁读写宿主机 `~/.claude/settings.json` 或 `%APPDATA%/ai.local.claude-local`，严禁调用 `scripts/test-windows.py` 或中断运行中的 `claude.exe` / `claude-local.exe`。

## `<directory>` 目录映射

- `run.ts` — 统一 CLI 运行器（支持 `--mode baseline|target`、`--tier 1|2|3|4|all`、`--feature`、`--report-dir`、`--json`、`--self-check`）；动态扫描 `suites/*.ts`（拒绝 `*.test.ts` 防 `bun test` 误扫），在 `--mode target` 严格校验 Tier 1–4 `>= 138` 用例全覆盖门禁，输出 `report.json` 与 `report.md` 至 `.local/e2e/`。
- `lib/types.ts` — 共享类型契约（`ALL_FEATURE_IDS`, `FeatureId`, `ALL_TIERS`, `Tier`, `RunMode`, `CaseStatus`, `E2ECaseOutcome`, `E2ECase`, `E2EContext`, `SuiteModule`, `SandboxHandle`, `E2ERunReport` 等），解耦 runner、harness 与各 suites。
- `lib/sandbox.ts` — `mkdtemp` 全隔离沙盒（`home/`, `appdata/`, `localappdata/`, `xdg-config/`, `xdg-cache/`, `temp/`, `profiles/`）、白名单环境变量清洗、symlink/junction 逃逸扫描、PID 级 `taskkill.exe /PID <pid> /T /F` 进程树清理（严禁 `/IM`）与只读元数据宿主哨兵自校验。
- `lib/mock-proxy.ts` — 绑定 `127.0.0.1:0` 的 HTTP + HTTPS `CONNECT` 代理，支持 `tcp_tunnel` 与 `tls_terminate` 路由、7 种故障注入（`healthy`/`delay`/`hang_pre_connect`/`slow_tls`/`drop_mid_stream`/`reject_502`/`rate_limit_429`）、`ProxyAuditEntry` 全量日志与 `assertNoDomainDnsLeak()`。
- `lib/mock-network.ts` — 绑定 `127.0.0.1:0` 的 HTTP + HTTPS 仿真服务端（沙盒内 `python` + `cryptography` 签发临时 SAN 证书），提供 `/cdn-cgi/trace` 国家/机房预设、5 源 GeoIP + 同 IP `ipquery` 分类、Mock `claude.ai` usage/kyc、WebRTC/跨上下文探针页及 `extractProductionCsp()`。
- `lib/chrome-harness.ts` — 强制使用 `browser-runtime/WindowsBrowser/chrome.exe`（禁止系统 Chrome/Edge 回退）、独立 Vite 服务（通过一次性 `httpServer.listen` `port=0` 拦截真实绑定 OS `127.0.0.1:0` 临时端口、收敛 HTTP keep-alive 并追踪销毁活动 socket，`hmr: false`）、`@tauri-apps/api/mocks`（`mockIPC`/`mockWindows`）壳层、持久化扩展上下文、默认防系统代理/后台网络卫生参数与路由白名单阻断及按页/路由清理上下文。
- `lib/rust-blackbox.ts` — 黑盒驱动 `claude-local.exe --orchestrate` 与 `--quota-core`（拒绝空参数 GUI 启动）、`sealBagaArchive()`（`BAGAID01` + `gzip` + AES-256-GCM）、`seedSyntheticVault()`（`identities.sqlite v3` + `key.bin` + HMAC + `CCBaga` 种子）及只读 `bun test` / 离线 Python 辅助。
- `suites/security-helpers.ts` — 导出 `cases: E2ECase[] = []`（兼容 `run.ts:loadSuites`），提供 `gapOrFail()`、Rust/JS 词法级剥离与块提取原语、沙盒 NTFS Junction 安全辅助、`startLoopbackQuotaCallbackServer()`、`runBrowserStartInPinnedChrome()`、`openRiskPanelWithMockIpc()` 与 `runMv3QuotaBridgeSync()`。
- `suites/perf-ui-helpers.ts` — 导出 `cases: E2ECase[] = []`，提供 `SharedUiHarness` 有界轮转与瞬态自愈共享会话（`getSharedUiSession` / `resetSharedUiSession` / `openAppWithMockUi`，`MAX_SHARED_UI_USES = 8`）、全量 Tauri `mockIPC` 映射与 `unhandledCommands` 审计，以及沙盒隔离 YAML / TS AST / Rust 原生错误键校验器。
- `suites/tier1-security-compat.ts` — Tier 1 happy-path 安全与兼容套件（覆盖 `E2E-01,03,07,08,09,10,11,12`，40 条，每特性 5 条）。
- `suites/tier2-security-compat.ts` — Tier 2 边界/角点/故障拒绝安全与兼容套件（覆盖 `E2E-01,03,07,08,09,10,11,12`，45 条，含 Tier 5 对抗回归）。
- `suites/tier1-perf-ui.ts` — Tier 1 happy-path 性能/弹窗/全站排版/双语套件（覆盖 `E2E-02,04,05,06`，20 条，每特性 5 条）。
- `suites/tier2-perf-ui.ts` — Tier 2 边界/极端视口/IPC 故障降级/YAML 故障注入套件（覆盖 `E2E-02,04,05,06`，20 条，每特性 5 条）。
- `suites/tier3-pairwise.ts` — Tier 3 跨特性成对组合测试套件（`T3-PAIR-01..T3-PAIR-12`，`>= 12` 条，全覆盖 `E2E-01..E2E-12`）。
- `suites/tier4-scenarios.ts` — Tier 4 真实端到端多阶段工作流套件（`T4-SCEN-01..T4-SCEN-06`，`>= 6` 条，覆盖身份导入与冷/热启动、详情 2 按钮与重置核验、双账号并发隔离、Kill-Switch 熔断恢复、全站多断点巡检与 MV3 反检测闭环）。

## 运行命令与覆盖门槛

- **严格 TypeScript 类型检查**：
  ```powershell
  $libs = (Get-ChildItem scripts/e2e/lib/*.ts).FullName; $suites = (Get-ChildItem scripts/e2e/suites/*.ts).FullName; bunx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --types bun,node scripts/e2e/run.ts @libs @suites
  ```
- **基础设施自检**：`bun run scripts/e2e/run.ts --mode baseline --self-check --json`
- **全量基线回归**：`bun run scripts/e2e/run.ts --mode baseline --json`（要求 `fail === 0`、`hostSafety.ok === true`、`coverage.ok === true`，允许未重编二进制造成的诚实 `baseline_gap`）。
- **全量目标验收门禁**：`bun run scripts/e2e/run.ts --mode target --json`（要求 `coverage.ok === true`、`fail === 0`、`baseline_gap === 0`、`hostSafety.ok === true`）。
- **分层/分特性定向调试**：`bun run scripts/e2e/run.ts --mode target --tier 3,4 --json` 或 `--feature E2E-08,E2E-10`。
- **`validateTargetCoverage` 覆盖门槛（`>= 138` 条）**：
  - `Tier 1 >= 60`（`E2E-01..E2E-12` 每项 `>= 5` 条）
  - `Tier 2 >= 60`（`E2E-01..E2E-12` 每项 `>= 5` 条）
  - `Tier 3 >= 12`（全部 12 项特性 `E2E-01..E2E-12` 均至少出现 1 次）
  - `Tier 4 >= 6`（真实端到端多阶段场景）

## `[PROTOCOL]`

1. 变更 `scripts/e2e/` 内代码时同步更新文件顶部 `[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]` 注释与本目录地图。
2. 禁止使用 `*.test.ts` 命名，禁止导入或修改 `scripts/e2e/` 之外的仓库源码或测试脚本。
3. 保持相对导入使用显式 `.ts` 后缀；`bun:sqlite` 仅在 `rust-blackbox.ts` 或用例 `run()` 内按需懒加载以兼容 Node `--experimental-strip-types`。
