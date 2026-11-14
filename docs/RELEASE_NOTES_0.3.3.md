<!--
[INPUT]: Source-confirmed Windows x64 0.3.3 patch release covering CLI proxy/security shield unification, kernel handle-level live CLI detection, transient file-lock self-healing and zero-residue switch rollback, Usage Analytics session-cost KPI upgrade, and aligned KPI/model/poster layout.
[OUTPUT]: Bilingual public release notes; artifact hashes come only from the audited build's SHA256SUMS.txt.
[POS]: Public release notes linked from both READMEs and the v0.3.3 GitHub Release.
[PROTOCOL]: Retain attribution and persistent format compatibility; never require Companion Browser as the Windows default browser.
-->

# Claude-Local 0.3.3 发布说明 / Release Notes

Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。第三方组件遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包 / Download installer](https://github.com/yq04/Claude-Local/releases/download/v0.3.3/Claude-Local_0.3.3_x64-setup.exe) · [Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.3) · [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.3/SHA256SUMS.txt)

## 简体中文

0.3.3 是一次面向日常高频痛点的稳定性与细节精修补丁版本，重点解决 **CLI 残留进程误报、瞬态锁导致的切号故障、CLI 代理风控判定不一致、以及用量分析 KPI / 模型分布与分享长图排版对齐** 问题：

- **内核句柄级 CLI 进程存活核验与分级状态徽章**：
  - 修复 Windows 终端父进程尚未释放子进程句柄时，已退出 `claude.exe` 仍短暂滞留 Toolhelp 快照造成“正在运行”误报的问题；枚举与终止进程统一校验内核对象退出态（`WaitForSingleObject(0) == WAIT_TIMEOUT` / `STILL_ACTIVE`）并自动清理陈旧 PID 缓存。
  - 识别 `node.exe` / `bun.exe` 启动参数优先使用受限查询 `NtQueryInformationProcess(60)`，原生 `claude.exe` 与伴生浏览器全程零跨进程 `PROCESS_VM_READ`。
  - 新增亚毫秒级实时会话查询命令 `identities_live_sessions`（打开切换/采集/删除弹窗、弹窗驻留轮询、窗口聚焦与空闲心跳自动同步），活跃卡片按真实态分级展示 **`CLI 运行中` / `桌面端运行` / `当前使用`**，无运行中会话时切换确认改用平和提示文案。
- **瞬态文件锁自愈、切号零残留回滚与一键干净恢复**：
  - 结束进程改为幂等等待退出，并在清理与切号前短暂排空 `.claude.json` / `.claude` 写共享锁；原子写入与文件清理针对 Windows 共享冲突/拒绝访问（`os error 5 / 32 / 33 / 145`）执行有界指数退避重试。
  - 目录指纹与归档扫描统一跳过 `.claude/debug/latest` 及 `*.tmp.*`、`.oauth_refresh.lock*`、`.storage-write.lock` 等瞬态锁文件，避免日常写入误触发残留告警或锁冲突。
  - 未保存的当前账号切号在任一阶段失败时自动回滚切前工作区凭据与缓存、核验 `live_key` HMAC，并清除临时生成的“当前身份”卡片与 `.baga` 归档，避免列表残留无用恢复卡；恢复横幅支持一键干净恢复且不再衍生多余检查点卡片。
- **CLI 安全边界统一判定与防断流提示增强**：
  - 「风控验证」与「CLI 残留审计」统一共用 `isCliSecurityShieldOk` 与 `isCliMcpBoundarySafe` 边界判定，消除两处绿标标准不一致；当仅开启遥测护盾而缺少显式 HTTP 代理，或误配 `socks5://` 变量时，明确标黄并展示具体缺项胶囊说明。
  - 补充合盖休眠唤醒 / 切换 Wi-Fi 后重新复测、在 Clash 连接日志核对实际命中线路以及桌面端混用 `--proxy-server` 的双语操作指引。
- **用量分析高价值 KPI 升级与卡片/长图对齐精修**：
  - 将顶部 KPI 卡片第二项由“缓存节省”升级为基于真实去重会话数的 **`单会话均耗`（`Avg. session cost`，附均轮次/均输出与 `/compact` 提示）**；账号明细表末列同步升级为 **`单次均耗`（`Avg. turn cost`）**（TSV 导出保留 `cache_savings_usd` 列确保外部脚本兼容）。
  - 对齐顶栏右侧 `API 等效花费` 与 `单会话均耗` 的上下视觉基准线，避免副文案小数点/单位被折行拆断；将「模型分布」卡片副标重构为规整的 `2×2` 等高微指标网格与右对齐等宽占比列，并同步校准 2× Retina 分享海报排版。

`BAGAID01` / `.baga`、SQLite `user_version = 3`、已有主密钥、账号 HMAC 与浏览器种子 100% 向下兼容。升级保留已有身份库与浏览器资料，不主动终止运行中的 `claude.exe`。0.3.3 使用新标签与新资产，既有 0.3.2 及更早标签和安装包保持不变。

## English

Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and maintained independently. Original copyright and the [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained; third-party terms are documented in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

0.3.3 is a targeted stability and layout polish patch release resolving stale CLI process false positives, transient file-lock failures during identity switching, inconsistent CLI proxy security checks, and Usage Analytics alignment across KPIs, model rows, and exported posters:

- **Kernel handle-level CLI liveness & graded active badges**:
  - Filters exited `claude.exe` entries that linger briefly in Windows Toolhelp snapshots while a parent terminal still holds handles by checking `WaitForSingleObject(0) == WAIT_TIMEOUT` / `STILL_ACTIVE` and pruning dead PIDs from the process cache.
  - Prefers limited-rights `NtQueryInformationProcess(60)` for `node.exe` / `bun.exe` inspection with zero `PROCESS_VM_READ` on native `claude.exe` or Companion Browser processes.
  - Adds sub-millisecond `identities_live_sessions` syncing across dialog open/polling, window focus, and idle heartbeats, displaying graded active badges (**`CLI running` / `Desktop active` / `Active`**) and calm idle switch guidance when no session is running.
- **Transient file-lock self-healing, zero-residue switch rollback & one-click clean recovery**:
  - Makes process termination wait idempotently for handle release, drains workspace write locks briefly before switching, and adds bounded backoff retries on Windows `os error 5 / 32 / 33 / 145` lock errors.
  - Excludes `.claude/debug/latest`, `*.tmp.*`, `.oauth_refresh.lock*`, and `.storage-write.lock` from workspace fingerprinting and archiving without hashing volatile directory `mtime`.
  - Automatically restores prior credentials/caches, re-verifies the `live_key` HMAC, and removes any temporary unsaved identity card/archive when a switch fails, while adding one-click clean recovery from the recovery banner without spawning extra checkpoint cards.
- **Unified CLI proxy & telemetry shield checks**:
  - Unifies `isCliSecurityShieldOk` and `isCliMcpBoundarySafe` between Risk Verification and CLI Residue panels; incomplete HTTP proxy env or `socks5://` entries trigger clear `.warn` pills and remediation guidance for sleep/wake reconnects, Clash connection logs, and desktop `--proxy-server` usage.
- **Usage Analytics `Avg. session cost` KPI & card/poster alignment**:
  - Replaces the "cache savings" KPI and account-table column/sort with **`Avg. session cost`** (with turns/session, output/session, and `/compact` hint) and **`Avg. turn cost`** across UI, Markdown exports, and Retina posters while retaining `cache_savings_usd` in TSV exports for compatibility.
  - Aligns `.usage-summary` / `.usage-metric` baselines across KPI cards with atomic non-breaking subtitle spans, refactors model captions into a uniform `2×2` micro-stats grid with a tabular right-aligned share column, and synchronizes 2× Retina Canvas poster layout.

`BAGAID01` / `.baga`, SQLite `user_version = 3`, existing master keys, account HMACs and browser seeds remain 100% compatible. Upgrades preserve vaults and browser profiles without terminating running `claude.exe` sessions. Version 0.3.3 uses a new tag and assets; existing 0.3.2 and earlier artifacts remain unchanged.

## 安装包校验 / Installer verification

请将以下结果与本版 Release 的 `SHA256SUMS.txt` 比对。 / Compare the result with `SHA256SUMS.txt` from this release.

```powershell
Get-FileHash .\Claude-Local_0.3.3_x64-setup.exe -Algorithm SHA256
```
