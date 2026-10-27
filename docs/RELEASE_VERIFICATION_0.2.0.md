<!--
[INPUT]: Exact 0.2.0 audited NSIS build, synthetic frontend/Rust/Python verification, and non-disruptive local deployment.
[OUTPUT]: Verified delivery facts and explicit acceptance boundaries for Claude-Local v0.2.0 without private paths, probes or accounts.
[POS]: Product-tag/source reference for public release v0.2.0.
[PROTOCOL]: Preserve private distribution boundaries and keep local build receipts under ignored .local/.
-->
# Claude-Local 0.2.0 交付核验

2026-10-26，已完成 `v0.2.0` 的九项界面/功能升级、分层合成测试、中性目录 Windows NSIS 安装包构建与隐私审计、本机无中断覆盖更新及 GitHub Release 发布。

## 1. 自动化测试与验证结果

- **前端单元测试（`bun test`）**：23 个测试文件、142 项用例（10,599 次断言）全部通过，含新增的 Anthropic 官方 API 定价等效美元成本/缓存节省核算测试（`usage-model.test.ts`）与悬浮监控小窗三态几何/磁吸/贴边隐藏/透明度纯模型测试（`floating-monitor-model.test.ts`）。
- **TypeScript 与生产构建（`bun run build`）**：0 错误，生成 `dist/index.html`、`dist/browser.html` 及对应生产资源包。
- **Rust 原生核心单测（`cargo test --manifest-path src-tauri/Cargo.toml --bin claude-local`）**：260 项通过、0 失败、1 项保留忽略（含 `monitor_window::tests::scan_live_token_metrics_computes_velocity_cache_hit_cost_and_burn_eta` 等新增测试）。
- **Python Windows 与额度测试（`python scripts/test-windows.py`）**：18 项通过、1 项一次性 CI 专属测试按设计跳过。
- **Playwright 合成端到端与视觉布局回归**：
  - `node --experimental-strip-types scripts/test-identities-ui.ts`：73 项通过；
  - `node --experimental-strip-types scripts/test-handoff-ui.ts`：通过；
  - `node scripts/test-local-shell.mjs .local/preview/local-shell`：通过（覆盖主界面深浅色及悬浮监控小窗展开/深色极光/侧边胶囊三态）；
  - `node scripts/test-usage-statistics.mjs`（含 `--layout-only` 96 项双语多视口几何断言、`--quick-only` 16 类及完整 38 类检查）：全部通过；
  - `node .local/tasks/20261026-ui-polish/check-layout.mjs`：10 项双语五页无溢出/无重叠/无隐私泄漏检查全部通过，产出 `docs/screenshots/0.2.0/` 下 6 张合成演示截图。

## 2. 安装包与本机更新核验

- **Windows x64 NSIS 安装包**：`Claude-Local_0.2.0_x64-setup.exe`
  - 文件大小：`140,537,513` 字节（134.03 MiB）
  - 安装包 SHA-256：`37cfa5106f54aaf16e379dff7b53a93aef4456fe70a229d776039fbff8c645b4`
  - 隐私与资源审计：中性目录 `custom-protocol` 构建，NSIS 只读解包 109 个文件，外部隐私探针 0 发现（`findings=0`）。
- **本机无中断部署更新**：
  - 本机宿主 `claude-local.exe` 版本已更新为 `0.2.0`，未打包宿主 SHA-256：`9651d76a46ce1608c63297c683192b0710cf9569be90b74c4bcecf502088d792`。
  - 更新前后正在运行的 `claude.exe` 终端进程数量保持为 `1`（零中断），已有身份保险库与伴侣浏览器资料目录完整保留。
