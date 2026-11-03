<!--
[INPUT]: Fixed v0.2.7 source, passing Windows CI, neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and local deployment receipts.
[OUTPUT]: Public release and local-update verification without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and installer execution remains outside this workstation check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.2.7 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权和 MIT 声明。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.2.7)：2026-11-03T08:37:55Z 发布为 Latest，非草稿、非预发布。
- 标签 `v0.2.7` 固定到源码提交 [`70f5cc3cd7173c29cc8f38e7a64281a3e1eebb0f`](https://github.com/yq04/Claude-Local/commit/70f5cc3cd7173c29cc8f38e7a64281a3e1eebb0f)。后续文档提交不移动该标签。
- [Windows source checks](https://github.com/yq04/Claude-Local/actions/runs/41602038305) 对同一完整提交执行，全部步骤通过；系统修改夹具仅在临时 Windows runner 上运行。

## 安装包

- [Claude-Local_0.2.7_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.2.7/Claude-Local_0.2.7_x64-setup.exe)：`140,856,655` 字节，约 `134.33 MiB`。
- SHA-256：`1ff6e2539e25f7b5095db4d1b9e062fdbfa7738f0fb00e0748c3e45f06fbec27`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.7/SHA256SUMS.txt)：安装包和校验文件的 GitHub 服务端 digest 均与本地对应文件一致。

本次使用新的中性 Cargo home/target、锁定依赖、固定浏览器引擎、单作业原生构建与 `custom-protocol`。NSIS 只读解包后的精确资源白名单/哈希审计通过：109 个文件、29 项外置隐私探针、0 项发现。探针内容、身份库、用户浏览器资料、账本及本机代理配置不属于构建或上传资产。

未打包宿主 SHA-256 为 `73ed31862bebcb36258ad1aa70721ca78d7634c780ea9de06042bfa1e7ba6c00`；NSIS 内宿主为 `a2a8a01541df1973ebc01a78b7b0b3d49d0e1b494ac16ff12d8939434cefe86d`。审计确认差异仅为 Tauri 唯一 bundle sentinel 的 `UNK` → `NSS` 三字节转换。

## 验证范围

本机类型检查与前端构建通过；174 项 Bun 单测（26 个文件）、19 项针对性 Rust 测试（身份 11、HUD 6、本地版 2）和 101 项合成 Python 测试（包审计 9、资源 2、本地额度 34、在线额度 35、浏览器抓取 4、迁移 11、归档 6）通过。测试使用合成账号与隔离资料，不进行真实登录或切号。发布源码的完整 Windows CI 另行通过。

## 本机更新

本机直接部署本次审计后的应用 payload：102 个应用文件逐一核验，其中 8 个需要替换，替换前原件已备份并核对哈希；NSIS 辅助文件不作为应用资源部署。旧版遗留文件不进行推测性清理。

安装宿主 SHA-256 为 `a2a8a01541df1973ebc01a78b7b0b3d49d0e1b494ac16ff12d8939434cefe86d`，与安装包内宿主完全一致。0.2.7 已在交互式桌面启动并存在主窗口。本机更新前后即时快照确认当时运行的 Claude CLI 进程编号及启动时间一致（`missingClaudeCount = 0`）；只重启 Claude-Local GUI，没有向 `claude.exe` 发出停止操作。

更新仅处理明确的程序资源路径，未执行身份删除、切换、迁移或代理重载，未读取保险库内容来推断账号数量。实际 NSIS 安装/卸载生命周期没有在维护者电脑上执行，不能将文件更新当作安装器生命周期验收。

## 范围与兼容

本版交付 Claude Code CLI 与伴生浏览器的防漏与同源代理增强：

- 桌面 Clash Verge / Mihomo 一键防漏覆写 YAML 与 AI 代理修复 Prompt 新增 `datadoghq.com`（CLI 直连遥测日志）及 OpenAI Codex 域名族（`openai.com`、`chatgpt.com`、`oaistatic.com`、`oaiusercontent.com`、`auth0.com`）强绑定至同一静态住宅出口链。
- 识别同端口 `socks5://`（伴生浏览器）与 `http://`（Claude Code CLI）双协议等价，同步按钮自动转换为浏览器所需的 `socks5://127.0.0.1:<port>`，交接说明同时展示双协议端点。
- 「风控与核验」新增 Claude Code CLI `settings.json` 防漏代理片段预览、一键复制与安全合并提示，涵盖大小写 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`GRPC_PROXY`/`NO_PROXY` 及 `169.254.0.0/16`、`.local` 豁免。
- 原生身份归档与清理白名单补齐 `env.GRPC_PROXY` 与 `env.grpc_proxy`，保持既有 `BAGAID01`、`.baga`、SQLite `user_version=3`、账号 HMAC 和浏览器种子不变。

`v0.2.6` 仍指向 `8c1935a27ed0512010ebd6d48b005728d412ca7f`，其安装包和校验文件保持不变。隐私探针和配置检查覆盖其明确检查范围，不构成任意秘密绝对不存在或账号免风控的保证。
