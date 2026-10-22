<!--
[INPUT]: 0.1.5 quota regression fixes, shared Rust core, verified local deployment/package receipts, and the explicitly authorized source/CI/private-release workflow.
[OUTPUT]: Context-free session handoff: product/task, delivered behavior, evidence, current publication state, next work and pitfalls.
[POS]: Repository handoff; machine paths, process IDs, private markers and workstation receipts remain in ignored .local/.
[PROTOCOL]: Back up to .local/handoff-archive/ and verify the copy before rewriting. Never rebuild or clean merely to refresh this document.
-->
# Claude-Local 会话交接

更新日期：2026-10-22，时区 America/New_York。写给完全没有上下文的新会话；以本文件顶部的 0.1.5 状态为准，不要把旧版回执当成本轮交付。

## 0. 三十秒现状

- 产品版本 **0.1.5**，正式安装包已构建、审计，本机软件已从 0.1.4 安全更新并运行。
- 已实机确认：有效的 5h/7d 额度恢复百分比，缺少新观测的单个 5h 仍显示未知；这不是未修复的整体未知故障。
- 原生界面与随包 Python 脚本已复用 Rust 窗口状态核心；安装版 `--quota-backend` 实测为 `rust`。
- **提交/CI/发布全部完成**：功能提交 `45cdfa6512dd1fbbc0b91b93507eafb31279195a` 已推送 `main`，同提交 Windows CI `39726136357` 成功；私有预发布 `v0.1.5` 已发布，8 个附件独立下载 SHA-256 校验全部一致，标签指向该功能提交。
- **当前无交付阻塞**。本文件最后仅文档回填另作提交；功能版本、CI、安装包和发布标签均以 `45cdfa6` 为准，最新文档 HEAD 可用 `git log` 核对。
- 未中断运行中的 Claude Code 会话，未切换真实身份、清理保险库或浏览器资料。

## 1. 我们在做什么任务

Claude-Local 是本仓库独立维护的 Windows x64 桌面产品，主程序 `claude-local.exe`，标识 `ai.local.claude-local`，用户数据在 `%APPDATA%/ai.local.claude-local`。核心功能包括加密身份备份/切换、离线额度观察、独立 Token 用量统计、环境配置与按需启动的伴生浏览器。

技术栈为 Tauri/Rust 原生层、React/TypeScript 界面，以及 Python 被动采集/账本写入。Token 统计与 5h/7d 额度是不同数据链，不能混为一谈。伴生浏览器只由用户操作或 `--browser` 启动；普通启动默认身份管理页，没有上游同步或自动更新源。

本轮用户先反馈“上一轮修复后所有身份额度未知”，要求调研修复并评估尽量 Rust 化；随后授权执行建议、全权交付，最后明确要求“完成更新、提交、发布，并更新交接”。本轮选择修复数据模型并收敛 Rust 核心，保留成熟界面，未承诺一次性把整个软件重写为 Rust。

## 2. 已完成的源码与行为

### 2.1 额度未知回归修复

根因有两类：5h/7d 共用整体来源，任一窗口过期或缺失便隐藏两窗；旧账本缺少新身份标记时，读取分支会污染本已可信的摘要。另有部分单窗回传借用整体时间戳，导致另一窗旧数据被误认为新观测。

- `src-tauri/src/identities/profile.rs`：逐窗来源/实际观测时间、账号与组织隔离、旧格式兼容、原生只读账本合并；旧实时锚点仅在 UUID/组织匹配且无已知组织 UUID 冲突时使用。
- `quota_5h_source` / `quota_7d_source` 与 `quota_5h_observed_at_ms` / `quota_7d_observed_at_ms` 独立传递，旧聚合字段保留兼容。
- 单窗到期或无证据保持未知；不得写 0 用量、滚动假 reset 或虚构满额。另一窗有效数据继续显示。未知窗口不参与账号推荐。
- 同窗口已用额度不回退，较新耗尽锚点优先；新窗口必须有新的真实观测，归档保存时间/计算时间不能充当观测时间。
- `src/identity-quota.ts`、`identity-model.ts` 与 `identities.tsx` 对齐逐窗证据；详情分别显示来源/时间，保留 180×286 工牌和双语文案。

### 2.2 Rust 核心收敛与 Python 兼容

- 新增 `src-tauri/src/quota_core.rs`，规范化、到期失效、同窗合并、来源聚合等纯规则由 Rust 统一执行；原生 profile 调用同一个核心。
- 主程序 `--quota-core` 在诊断、Tauri 与单实例初始化之前处理有界 JSON stdin/stdout。schema 1 / `merge_windows`，最多 1 MiB、256 项，仅接收额度数值、reset、source、observed_at_ms，不接受账号正文或路径，不读写文件/联网。
- 随包 `scripts/claude_quota.py` 在持有跨进程锁、重新读取账本之后批量调用核心；超时/非法返回时，在写 ledger/SQLite 前中止，不静默换算法继续写。
- **Python 仍是 quota_ledger 唯一写入者**，保留锁与 atomic replace；没有新增 Rust 桌面写入路径。独立旧脚本缺少固定 sibling 主程序时明确使用 `legacy_python`，安装包布局报告 `rust`。
- Windows 仅新增单个公开脚本资源；未捆绑 Python/cryptography，未自动改现有 statusLine。脚本随包存在和后端可用，不代表旧外部 hook 已自动迁移。
- React 界面、Python 会话采集/归档读取和部分计费计算继续保留。下一阶段若继续 Rust 化，应逐项迁移纯计算，不能增加第二账本写入者。

### 2.3 不变的兼容边界

额度摘要版本为 5；SQLite `user_version=3`、BAGAID01、`.baga` 编码、账号 HMAC、归档密钥和 legacy 浏览器种子域保持不变。不要重生成身份 ID、密钥或浏览器种子。0.1.4 已交付的隐私桥、设备标识保护、历史会话不自动改写、环境优先导航等继续保留，默认首页仍是身份管理。

## 3. 已完成的验证与本机更新

- Rust core 5 项、profile 14 项；Python 26 项（含真实 Rust 子进程、失败不写入与锁内合并）；前端额度 5 项、双语 4 项；包审计 9 项；更新器合成 8 组；隔离 GUI 9 项；TypeScript/Vite 生产构建全部通过。
- 远端 Windows CI `39726136357` 全步骤成功：前端 41 项、原生主测试 150 项通过/1 项按设计忽略，另有隔离子测试通过；Python 额度 26 项（CI 缺 debug 主程序的真实管道用例按设计跳过，本机此前已实测）、浏览器 4 项、迁移 11 项、Windows CLI 19 项通过。仅临时 runner 执行系统相关 CI。
- 正式 Windows `custom-protocol` 中立构建通过，NSIS 包 **133.43 MiB**。解包审计 103 文件，原有 13 项私密标记零发现。
- 安装包：`Claude-Local_0.1.5_x64-setup.exe`。
- 安装包 SHA-256：`e97caf00f7d1e2811c1cffc829c8ea02ce67d1e69e131aa9f3a063fe21950ed5`。
- 本机主程序 SHA-256：`e1be324b8196eb2e0aba20101d136559434ee0e939e5ab670178bc0500ee5854`；版本属性 0.1.5，启动窗口已核验。
- release 管道在旧 GUI 仍运行时通过，随后备份并校验 96 安装文件，替换 8 个变更文件，重启主程序。3 个 Claude Code 会话前后 PID 一致；回执 `updated` / `quotaCoreSmoke=pass` / `missingClaudePids=[]`。
- 已只读查看本机真实额度区域截图：两个身份双窗有百分比，另一个仅 7d 有效；截图裁掉名字/邮箱，不通过切换真实账号来验证。

本地证据全在 ignored 目录：

- `.local/last-local-update.json`：安装更新回执、真实路径/进程、备份位置和哈希。
- `.local/artifacts/20261022T032618Z-8a71bef456cb461c9d1a304b7fb74274/`：安装包、校验和、隐私审计、资源清单。
- `.local/tasks/20261021-quota-regression/`：方案、进度、合成 GUI 脚本/报告及裁剪实机截图。
- `.local/tools/complete-local-update.ps1`：已实测的中立构建、13 标记审计、release 管道预检、精确主程序替换/回滚流程；配套合成测试。不要为了结束会话重复构建或更新。
- `.local/release-0.1.5/`：本轮 source-snapshot、prepared-assets、独立下载目录与 `published-receipt.json`；发布回执 `updated-and-published`，8 个附件校验一致。

## 4. 当前卡在哪、提交与发布状态

**没有阻塞；本轮更新、提交、CI、发布和会话交接均已完成。** 后续计划属于可选演进，不是本轮未完成交付。

- 仓库：`yq04/Claude-Local`，私有，默认分支 `main`。
- 原远端基线 `c4d722a`，本轮功能提交 `45cdfa6512dd1fbbc0b91b93507eafb31279195a`；`v0.1.4` 旧标签/旧附件未改。
- 实际发布：`https://github.com/yq04/Claude-Local/releases/tag/v0.1.5`，`isDraft=false`、`isPrerelease=true`，仓库保持私有。
- 实际 CI：`https://github.com/yq04/Claude-Local/actions/runs/39726136357`，`checks.yml`、headSha=`45cdfa6512dd1fbbc0b91b93507eafb31279195a`、conclusion=`success`。
- 已完成：源码非强制推送 → 同提交 CI 成功 → 草稿八附件上传 → 独立下载/逐个 SHA-256 一致 → 取消草稿/保持预发布 → 核对标签 SHA/附件数量并保存回执。
- 八附件为安装包、SHA256SUMS、隐私审计、资源清单、0.1.5 更新说明、对应提交源码 ZIP、LICENSE、NOTICE。
- 最终交接文档在已验证功能提交后另作仅文档提交，不重复跑全量源码 CI；标签/CI 明确指向功能提交，不能把文档 HEAD 当成另一次已构建产品。Release 源码 ZIP 固定对应标签提交；会话关闭后的最终交接以 main 最新 HANDOFF.md 为准。

## 5. 下一步计划

1. 本轮已收尾。新会话先核对 main、`v0.1.5`、成功 CI 和发布回执，无用户新任务时不要重复构建、部署或发布；已发布附件不覆盖，后续代码变更走新版本。
2. 在一次性 Windows VM/临时 runner 验收 0.1.4 → 0.1.5 NSIS 真实升级、进程占用拦截、卸载与数据保留。本机只做已审计文件更新，不能冒充安装/卸载验收。
3. 若继续 Rust 化，先拆分并迁移纯额度估算/计费，配跨语言 fixture；最后才评估采集器替换。保持旧 hook 兼容与唯一写入者交接，避免为语言占比重写成熟 UI。
4. 若要自动接入采集，先解决受控 Python/cryptography 分发、签名与旧 statusLine 兼容；现有配置不可自动覆盖。
5. 若用户将来转公开，先按 NOTICE.md、docs/DISTRIBUTION.md 和现有合规记录清点第三方许可；私有仓库不消除分发义务。

## 6. 踩过的坑：绝对不要再踩

1. **不要用整体来源控制两窗**：单窗 unknown 不应隐藏另一窗；逐窗 source/time 优先，旧聚合字段只兼容。另一窗的新时间绝不能回填当前窗空观测。
2. **归档时间不是观测时间**：只比较真实服务端/对应窗口观测；相同窗口不让旧估计覆盖耗尽，不把过期窗口写成 0 或推进 reset 假装满额。
3. **旧账本兼容不能污染数据**：不匹配条目应忽略。恢复 legacy 证据须使用原始未过期窗口的 usage/reset/time，不能把过期 anchor 与已滚动未来 reset/0 拼成新证据；邮箱单独相等不够证明账号/组织。
4. **合并必须在 writer 锁内**：先锁、重读，再调用核心、atomic replace。安装版核心失败不可静默回落继续落盘；Rust UI 永远不写账本。
5. **headless 入口先于 Tauri 单实例**：否则可能唤起 GUI、无 stdout 或误当已有实例。Windows GUI-subsystem 的 release/custom-protocol 必须实测管道，debug 成功不够。
6. **不要中断 claude.exe**：更新只精确验证并重启自己的主程序，先备份/哈希，失败回滚。真实账号切换、清理、系统变更测试只在合成或一次性环境；本机不用 stash/reset/restore/clean 清场。
7. **固定资源白名单同步**：新增随包脚本必须同步 Tauri resource map、审计 allowlist、部署映射/fixture；只放单个公开脚本，不打包 scripts 整目录或用户运行数据。
8. **工牌严格 180×286**：可用内宽 160px；不要在头部挤按钮，复用额度区域入口。新增内容放详情弹窗；未知数值不参加推荐。
9. **GUI 测试必须匹配真实 DOM**：不能查不存在的 class 得到永远为零的假绿；默认隐私打码时测试明文必须在 mockIPC 明确返回隐私关闭。仅看测试截图不能声称实机恢复。
10. **WinError 10054 mock HTTP**：HTTP/1.1 响应明确 `Connection: close` 并 flush，避免客户端复用而服务端提前关 socket。
11. **工具/构建纪律**：Windows 只用 pwsh7。既有便携 7z 在 `.local/build-tools/7zip-26.04-f4a03f7e/portable/7z.exe`；release 必须 custom-protocol、中立 Cargo root 与隐私审计。不要因现有 advisory/dead-code warning 做无关重构。
12. **Cromma 与 Vite**：复用 SegmentedControl/Tabs/Switch/Disclosure 和 MOTION；vendor file 依赖改动后 bun install，再用 --force 刷预构建缓存；无 vendor 变化时不要重装。
13. **Tauri IPC 参数**：可选进度通道用 Webview + JavaScriptChannelId 转换，避免直接 Option<Channel<T>> 触发宏约束错误。
14. **工具响应与输出**：functions.exec 禁止 notify/yield_control；批处理只输出最终结果。不要输出账号、凭据、原始 statusLine 命令、私密标记或个人机器路径。
15. **通过即止**：按改动跑针对性验证；成功后推进交付。不要在真实机器跑 CI-only 系统变更测试，不做多轮无关审计。

## 7. 工作区归属与新会话起步

- `AGENTS.md` 本地修改不是本轮产品改动，不暂存；未跟踪 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/` 原样保留，不删除、不移动、不提交。
- 本轮 29 个功能/说明文件已提交；最后交接回填仅修改文档。预期工作区只剩上述既有本地规则与临时目录；这不表示产品交付未完成。
- `.local/`、身份归档、数据库、运行时账本、凭据、构建/安装包和机器笔记不得入 Git。原 MIT 版权和第三方 NOTICE 不变。
- 下一会话先读本文件、根/相关目录 CLAUDE.md，然后只读核对 `git status`、main/标签/CI/Release 和发布回执。源码已交付且没有用户新需求时，不自动清理或再次部署。
