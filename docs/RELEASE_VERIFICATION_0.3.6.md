<!--
[INPUT]: Fixed v0.3.6 source (1b4cfcd), neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and local atomic hot-update receipt.
[OUTPUT]: Public release and local-update verification without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and installer execution remains outside this workstation check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.3.6 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权和 MIT 声明。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.6)：`2026-11-16T02:58:53Z` 发布为 Latest，非草稿、非预发布。
- 标签 `v0.3.6` 固定到源码提交 [`1b4cfcdc90c32aa244fec795472bd6ee91a12b50`](https://github.com/yq04/Claude-Local/commit/1b4cfcdc90c32aa244fec795472bd6ee91a12b50)。后续文档提交不移动该标签。

## 安装包与本机同步

- [Claude-Local_0.3.6_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.3.6/Claude-Local_0.3.6_x64-setup.exe)：`140,976,087` 字节，约 `134.45 MiB`。
- SHA-256：`8370d30f836e712b22ec892581e6705e5c1bba4efa712575a9f503c9169f0bdf`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.6/SHA256SUMS.txt)：`99` 字节，SHA-256 `edb7fdbeac14bae5f5238f4c992202aafbb7c40d08b1dfa22759e937b6b38b7e`；安装包与校验文件的 GitHub 服务端 digest 均与本地对应文件一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎、单作业原生构建与 `custom-protocol`。NSIS 只读解包（`extracted-payload` 模式）后的精确资源白名单/哈希审计通过：`109` 个文件（`464,885,213` 字节）、`7` 项外置工作站路径隐私探针、`0` 项发现。同批次桌面主程序已通过本机原子热更新验证（`hostSha256` `4f7daf681e3a3b8c79dc5ef1399e938483419374d8f5ea7281b4593fc2959701`，`27` 个安装与采集脚本文件 SHA-256 对账一致，其中 `9` 项变更文件已原子替换，交互桌面 Session 1 存活，`missingClaudeCount == 0`）。实际 NSIS 安装器向导运行与真实账号登录、切号操作仍在本次核验范围之外。

## 验证范围

以下验证均在 `0.3.6` 版本号与源码定稿后运行并通过：

- 源码隐私与行尾校验：`24` 项待提交源码与文档保持 UTF-8 无 BOM 与纯 LF，`7` 项外置工作站路径隐私探针零命中；
- 类型检查与前端构建：`bun run build`（`tsc --noEmit && vite build`，`663` 个模块）与 `python scripts/browser_ui.py dist` 通过；
- 前端单元测试：`bun test` `195` 项全部通过（`26` 个测试文件、`15,084` 次 `expect()` 断言）；
- Release Rust 单元测试：`cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local` `332 passed`、`0 failed`、`2 ignored`（`2` 项合成重负载基准 `usage_perf`）；
- Python 离线合成测试：`8` 套共 `114` 项通过（本地 `38`、在线 `40`、迁移 `11`、包审计 `9`、归档 `7`、浏览器预备 `4`、运行时 `3`、资源清单 `2`）；
- Playwright 串行合成 UI 测试与视觉审计：`test-identities-ui.ts` 全量 `73` + `--verification-only` `10` + `--warming-only` `29`、`test-usage-statistics.mjs` 全量 `38` + `--quick-only` `16` + `--layout-only` `108` + `--usage-reliability-only` `11`（含 `8` 组响应式布局）、`test-local-shell.mjs --monitor-only`（`12` 种双语/明暗/收折悬浮小窗模态）与 `0.3.6` `20` 张多视口/展开态/独立双跳实拍截图审计（零页面/控制台错误、零水平溢出）全部通过。测试仅使用合成账号与隔离上下文，不触碰真实凭据、账号或运行中的 CLI 会话。

## 范围与兼容

本版交付参考「快速配置」风格对桌面端 **「浏览环境」「电脑环境」「网络环境」「风控验证」** 四大页面的重构与二次像素级打磨，详见 [发布说明](RELEASE_NOTES_0.3.6.md)：

- **统一样式底座与容器查询（[`src/env-pages.css`](../src/env-pages.css)）**：建立共享 `@container` 四栏发丝遥测条（`.env-telemetry-strip`）、`.settings-group-heading` 区块标头与边到边发丝分隔矩阵，清除 `style.css` 历史样式冲突与横轴留白；
- **浏览环境（[`src/browser.tsx`](../src/browser.tsx)）**：全宽双区顶栏 + 四栏去重遥测条（次行展示关联状态与独立资料/内核版本）+ 双列核验矩阵 + 并排缓存/重置场景卡 + `16px` 内距高级面板与 `580px` 容器断点；
- **电脑环境（[`src/system.tsx`](../src/system.tsx)）**：四栏美区基线摘要条（`English` / `en-US` 层级对照）+ 纯净等宽目标基线标头 + 内联单行设置控件，确认定位「已关闭」时省略右侧冗余的禁用「已关闭定位」按钮；
- **网络环境（[`src/vps.tsx`](../src/vps.tsx)）**：新增双跳链式代理拓扑遥测条、页头右侧复制状态胶囊（零跳动）、强调色微混悬停三联代理卡及边到边 `2×2` 域名连通矩阵；
- **风控验证（[`src/risk-verification.tsx`](../src/risk-verification.tsx) / [`src/risk-verification.css`](../src/risk-verification.css)）**：重构为态势顶卡（前缀去重 `13.5px`/`11.5px` 四栏条 + 两行边界说明）+ 带 `.settings-group-heading` 的 `@container risk-env` 三列诊断/探针矩阵 + `3+2` 边界徽章分置手机 KYC 桥接卡（含全宽贴边紧凑独立双跳栏）+ 2×3 飞行清单。

数据与安全边界 100% 向下兼容：`166×286` `.identity-card`、`.browser-verification-page` / `.browser-start` / `.verification-*` 几何、`BAGAID01` 魔数、`.baga` 归档、SQLite `user_version = 3`、账号 HMAC 规则、浏览器种子字符串与 `%APPDATA%\ai.local.claude-local` 目录均保持不变。`v0.3.5`（`966a2e6` / 核验提交 `fa8342f`）、`v0.3.3`（`01f7085` / 核验提交 `c443015`）与 `v0.3.2`（`260f80e` / 核验提交 `a72a145`）此前所有标签、安装包和校验文件保持不变。隐私探针与静态审计仅覆盖明确检查范围，不构成任意秘密绝对不存在或账号免风控的保证。
