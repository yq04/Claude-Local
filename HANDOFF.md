<!--
[INPUT]: Owner-authorized 0.1.2 delivery, verified local installation, scoped source checks and version-specific publication receipts.
[OUTPUT]: Current project handoff with completed local deployment and explicit evidence rules for the GitHub prerelease.
[POS]: Repository handoff; workstation paths, private probes and publication receipts remain ignored under .local/.
[PROTOCOL]: Read the 0.1.2 receipts before interpreting historical 0.1.1 records; never republish merely to refresh documentation.
-->
# Claude-Local 会话交接

当前交付版本：**0.1.2**。记录时间：2026-10-21 UTC。本文件记录已核验的源码与本地替换；GitHub 最终状态以对应发布回执和 Release 实时状态为准。

## 1. 先确认最新交付证据

- `.local/last-local-update.json`：本地替换结果；本次状态为 `updated`，安装包文件名含 `0.1.2`。
- `.local/release-0.1.2/independent-delivery-verification.json`：独立复核安装版本为 0.1.2，95 个文件无哈希差异，安装包和主程序哈希匹配，13 项私密标记审计通过。
- `.local/release-0.1.2/published-receipt.json`：GitHub 发布最终回执。只有状态为 `updated-and-published` 才能认定提交、推送、CI、附件校验与私有预发布全部完成；提交 SHA 和 URL 从此读取。
- `.local/release-0.1.2/final-handoff-verification.json`：发布后对远程提交、标签、附件和本地交付的最终核对记录。
- 若最终发布回执存在且状态正确，0.1.2 的交付任务已经结束，不要重新构建、替换或覆盖 Release。没有最终回执时，只能认定已由本地回执证明的阶段完成，使用 `-PublishOnly` 续跑前先查明实际远程状态。

0.1.1 已完成的发布与回执仍保留作为历史记录。旧交接原文已备份至 `.local/release-0.1.2/handoff-before-0.1.2.md`；它不代表当前版本待办。

## 2. 项目内容与本次修复

Claude-Local 是独立维护的 Windows x64 产品，主程序 `claude-local.exe`，标识 `ai.local.claude-local`。React/TypeScript 负责界面，Tauri/Rust 负责原生操作，Python 是外部额度账本的唯一写入方。可选的 Claude-Local Browser 仅由明确用户操作或 `--browser` 启动。

本次用户报告快速配置中的浏览器状态无法读取，身份信息似乎依赖先访问身份管理。已在临时目录复现两个 `Database::open` 并发首次建库时，一个调用因独占创建失败。身份与浏览器读取共用身份 SQLite，旧初始化还存在 DEFERRED 事务读后升级竞争。后续 CI 暴露了创建句柄尚持有时，另一连接被 SQLite 降为只读的 Windows 文件共享窗口；临时 Barrier 样本复现 schema 阶段的 SQLite ReadOnly（扩展码 8）。

0.1.2 包含：

- 串行保护整个短生命周期的文件创建、连接打开与初始化；并发创建同一安全、当前用户拥有目录/数据库时重新校验目标，schema、版本迁移和默认状态写入置于 SQLite IMMEDIATE 事务中。锁不跨越 Database 生命周期，保留嵌套读取、`user_version=3`、已有身份、显式浏览器联动选择和种子规则。
- 快速配置的身份、浏览器、电脑环境和 CLI 各自读取完成即展示，单项慢读或失败不拖住其他状态；显示具体失败项和原生原因，支持手动刷新。
- 浏览器配置启用“跟随电脑”时，概览与浏览器核验共用有效时区/语言解析；配置目标不冒充实际浏览器观测。
- 侧栏与六个配置入口共用图标映射，保留原有用量图形；复用现有 Cromma Button 加载与尺寸、卡片、双主题及错误色，按可用内容宽度适配布局。没有新增第三方依赖或大幅改版。
- 应用版本已同步到 package.json、Tauri 配置、Cargo 清单与锁文件；README、开发说明和 `docs/RELEASE_NOTES_0.1.2.md` 已更新。

## 3. 已核验的本地替换

使用既有 `.local/tools/complete-local-update.ps1`，在新的中性 Cargo 根构建 `custom-protocol` Release 和全新 NSIS 安装包。沿用原有 13 项私密标记，102 个解包文件，零发现；只解包检查，没有执行安装器或卸载器。

首次完整备份后替换 9 个变化文件；CI 暴露的 Windows 首建共享窗口修复后，又从全新中性根重新构建、审计，并备份更新了 1 个主程序文件。最终验证 95 个安装文件和启动窗口。两次更新中三个 Claude Code 进程的 PID 均保持一致，`missingClaudePids` 为空。没有结束 Claude Code 或配套浏览器，没有重新配置个人 Token 归属规则。

- 安装包 SHA-256：`59ce86f3918a0282754d0026157452ef0a2c289545661ca82e02b807d65602d4`。
- 已安装主程序 SHA-256：`b35916557c92bf1358d5d0d89398dd46074899ea1dd84ab44af513890fff2078`。

实际安装目录、中性构建目录、备份及安装包路径只从私有回执读取，不加入受跟踪文档。

## 4. GitHub 发布约定

目标仓库保持私有：`yq04/Claude-Local`；手动发布版本 `v0.1.2`。用户明确授权源码提交、上传、新安装包和本机替换，不需要重复询问同一操作。用户已拒绝 GitHub 插件，使用现有 GitHub CLI。

发布工具为 `.local/tools/finish-release-0.1.2.ps1`。它只暂存审阅清单内的源码/文档，非强制推送到 main，等待同一提交的 `Windows source checks` 成功，再创建私有草稿并上传八个附件；下载全部附件逐个核对 SHA-256 后才转为预发布并写最终回执。不会改变仓库可见性、旧版 Release、自动更新源或现有远程配置。

八个附件：新安装包、SHA256SUMS.txt、privacy-audit.json、resource-manifest.json、RELEASE_NOTES_0.1.2.md、Claude-Local_0.1.2-source.zip、LICENSE、NOTICE.md。源码快照清单与获准暂存对象见 `.local/release-0.1.2/source-snapshot.json`。

`gh run watch` 在本地等待远程 CI；Rust 编译需要时间，依据实际步骤与结果判断，不因旧截图或短时无输出认定卡死。中断本地等待会中断后续发布，续跑前检查当前回执、暂存对象和远程状态，不清理用户工作区。

## 5. 验证与仍有的边界

本次源码改动已通过 3 项 Rust 数据库并发初始化/迁移测试（含 24 轮 Barrier 首建争用）、9 项 Bun 本地化/浏览器核验测试、16 组隔离快速配置 GUI 检查、TypeScript/Vite 构建；新发布脚本的五组合成 Git/假 GitHub 续跑测试通过。修正后的新 Release 构建、13 标记解包审计和本地文件替换有独立回执。首次 CI 的 124 通过/1 失败/1 忽略结果已促成本次完整打开边界修复，不绕过失败发布；完整 Windows CI 只在临时托管 runner 执行，最终成功结果从发布回执和 GitHub 读取。

GUI 证据位于忽略的 `.local/preview/quick-setup-20261021/`。针对快速配置使用 `node scripts/test-usage-statistics.mjs <output> --quick-only`，复用原有隔离 IPC/浏览器环境，不运行无关全库检查。

既有边界仍保留：历史固定 UTC 偏移未完整处理夏令时；JSONL 头部/边界采样不能保证检测任意中段改写；真实 NSIS 安装/升级/卸载需临时 Windows 环境验证；安装包未签名；第三方许可和完整 Chromium 声明仍以 NOTICE.md、docs/DISTRIBUTION.md 为准。私有仓库不构成公开分发许可。

## 6. 工作区和后续纪律

- AGENTS.md 的既有用户修改保留；`--help/`、`.planning/`、`docs/superpowers/` 等无关未跟踪目录不暂存、不移动、不删除。
- 只读了解或定位问题不等于获准清理。禁止 git clean、hard reset、仓库范围 restore、递归 worktree 删除及终止真实 Claude 会话。
- 更新保留真实保险库、浏览器资料、个人配置和源数据；不写 .claude.json，不轮询 OAuth 用量，Python 继续独占额度账本写入。
- 保留 BAGAID01、.baga 编码、SQLite v3、账号 HMAC 与旧浏览器种子域字符串，不因升级再生成密钥/身份/种子。
- `.local/`、安装器、运行时资产、账本、数据库、身份归档、私密标记和机器专用路径不进入 Git。正式构建使用新的中性 Cargo 根，不复制 Cargo 凭据、根配置或 registry/src。
- 后续修改先读相关 CLAUDE.md 与源码头，保持双语目录完整，只运行针对性合成测试；深色 GUI 检查使用真实偏好 API，SQLite 测试显式关闭连接后清理临时目录。
