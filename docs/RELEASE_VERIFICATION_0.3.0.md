<!--
[INPUT]: Fixed v0.3.0 source, passing Windows CI, neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and local deployment receipts.
[OUTPUT]: Public release and local-update verification without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and installer execution remains outside this workstation check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.3.0 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权和 MIT 声明。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.0)：2026-11-07T09:03:17Z 发布为 Latest，非草稿、非预发布。
- 标签 `v0.3.0` 固定到源码提交 [`c784588e206be85d7bcccda4eadec5cebab3e8dc`](https://github.com/yq04/Claude-Local/commit/c784588e206be85d7bcccda4eadec5cebab3e8dc)。后续文档提交不移动该标签。
- [Windows source checks](https://github.com/yq04/Claude-Local/actions/runs/42357163813) 对同一完整提交执行，全部步骤通过；系统修改夹具仅在临时 Windows runner 上运行。

## 安装包

- [Claude-Local_0.3.0_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.3.0/Claude-Local_0.3.0_x64-setup.exe)：`140,860,505` 字节，约 `134.34 MiB`。
- SHA-256：`8d2a56c93ebe7a2cf56a886bb00fcf78c4df2e7b46dbc934f7ee5a8b64f3e8d6`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.0/SHA256SUMS.txt)：安装包和校验文件的 GitHub 服务端 digest 均与本地对应文件一致。

本次使用新的中性 Cargo home/target、锁定依赖、固定浏览器引擎、单作业原生构建与 `custom-protocol`。NSIS 只读解包后的精确资源白名单/哈希审计通过：109 个文件、29 项外置隐私探针、0 项发现。探针内容、身份库、用户浏览器资料、账本及本机代理配置不属于构建或上传资产。

未打包宿主 SHA-256 为 `baafdb7e4cf3a1686e8a3c5c65cbc6c7c7e231d170aed714c1fa0777ee5916e7`；NSIS 内宿主为 `cbe79fbde3cffa2544497d3cfc6a7cbfcc436c823094b787ce02edfce5dbb889`。审计确认差异仅为 Tauri 唯一 bundle sentinel 的 `UNK` → `NSS` 三字节转换（偏移 `13544602`）。

## 验证范围

本机类型检查与前端构建通过；183 项 Bun 单测（26 个文件，14,086 次断言）、315 项全量 Rust 单元测试和 80 项核心合成 Python 测试（包审计 9、资源 2、本地额度 34、在线额度 35）通过。测试使用合成账号与隔离资料，不进行真实登录或切号。发布源码的完整 Windows CI（含全部 101 项 Python 与系统修改夹具）另行在临时 runner 通过。

## 本机更新

本机直接部署本次审计后的应用 payload：102 个应用文件逐一核验，其中 9 个需要替换，替换前原件已备份并核对哈希；NSIS 辅助文件不作为应用资源部署。旧版遗留文件不进行推测性清理。

安装宿主 SHA-256 为 `cbe79fbde3cffa2544497d3cfc6a7cbfcc436c823094b787ce02edfce5dbb889`，与安装包内宿主完全一致。0.3.0 已在交互式桌面启动并存在主窗口。本机更新前后即时快照确认当时运行的 Claude CLI 进程编号及启动时间一致（`missingClaudeCount = 0`）；只重启 Claude-Local GUI，没有向 `claude.exe` 发出停止操作。

更新仅处理明确的程序资源路径，未执行身份删除、切换、迁移或代理重载，未读取保险库内容来推断账号数量。实际 NSIS 安装/卸载生命周期没有在维护者电脑上执行，不能将文件更新当作安装器生命周期验收。

## 范围与兼容

本版交付 Claude Code v2.1.309~2.1.318 净室隔离、CLI 遥测护盾与 MCP 供应链安全审计、智能接力 2.0 及实时额度小窗 2.0：

- **净室切号与跨号防染色**：原生切号清理 `.claude/telemetry/1p_failed_events.*.json`、`groveConfigCache`、异号 `.claude.json.backup.*` / `.corrupted.*` 副本、共享会话 JSONL 中的 `credential_org` / `userEmail` / `thinking.signature` / `api-request-blob` / `bridge-session` 染色字段，并支持跨号中断 `tool_use` 与孤儿 `tool_result` 成对自愈修复；写回前按锁类型（60s / 15s）回收残留僵尸锁；`CREDENTIAL_KEYS` 扩展至 7 项、`ACCOUNT_KEYS` 扩展至 25 项（严格保留设备/客户端配置与 `metricsStatusCacheByPrincipal`）。
- **CLI 遥测护盾、全栈防漏域名锁与 MCP 供应链审计**：Mihomo 一键防漏覆写 YAML、AI 配置提示词与原生风险检查同步锁定 `claude.com`、`growthbook.io`、`claudemcpcontent.com`、`datadoghq.com` 等域名（兼容 `rules` / `prepend-rules` / `append-rules`）；「风控验证」与「身份页文件残留」新增 CLI 遥测护盾与 MCP 供应链只读审计（识别非回环远程 `http/sse` 服务、Windows 裸 `npx/npm/pnpm/yarn/uvx/bunx` 启动器、自定义 `hooks` / `apiKeyHelper` 及危险权限跳过项）。
- **智能接力 2.0 与 `magpie` / `claude-swap` 算法融合**：吸收 `magpie` 的 `WeekLow` 临期周配额抢救规则（`Tier 0` 保级）与 `claude-swap` 的 7d 重置后前 24 小时步速静默窗口；新增动态防乒乓换号裕度、5h 饥饿态大差值紧急切换放行、单向防回弹锁与独立 `standbyCandidate` 下一顺位待命候选展示。
- **实时额度小窗 2.0 与跨页面持久化审计**：新增 `computeMonitorBarFillPct` 双口径极值防虚标渲染（`4%`~`96%` 视觉余量夹持）、紧凑下一顺位接力待命胶囊、`Escape` 快捷隐藏与 `Ctrl/Cmd + =/-/0` 缩放；身份页活动条新增三段式净室切换管线胶囊摘要、跨页面持久化的最近 5 次操作内存审计时间线与 `verifyWakeupAnchorAdvancement` 5h 续杯重置锚点真实推进核验。

`v0.2.7` 仍指向 `70f5cc3cd7173c29cc8f38e7a64281a3e1eebb0f`，其安装包和校验文件保持不变。隐私探针和配置检查覆盖其明确检查范围，不构成任意秘密绝对不存在或账号免风控的保证。
