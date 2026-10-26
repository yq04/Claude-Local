<!--
[INPUT]: Owner requests, reproduced local-auth/readiness defects, focused synthetic tests and versioned delivery receipts.
[OUTPUT]: Context-free status, remaining work, next actions and non-negotiable pitfalls.
[POS]: Repository-root handoff; personal identities, paths, process records and probes remain ignored in .local/.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only edits never rebuild a package or move product tags.
-->
# Claude-Local 新会话交接（0.1.1）

更新：2026-10-26，America/New_York。先读本文、根 AGENTS.md / CLAUDE.md，改模块前读对应目录 CLAUDE.md 和源码头。本文取代此前交接的当前状态描述，历史发行事实仍保留。

## 正在做什么

用户反馈：两个账号已完成验证及 Claude Code 重新登录，应用仍显示旧授权错误/未知、续杯面板内容挤出；浏览器环境20项中只有出口运营商分类及 WebRTC 本地候选两项未知，其余18项通过。要求先查明原因，再修复并完整交付。此前已授权本机更新、打包和 GitHub 上传；不是只交源码。

Claude-Local 是独立维护的 Windows 10/11 x64 桌面工具，React/TypeScript 前端、Tauri/Rust 原生事务、Python额度账本单写。主程序 claude-local.exe，应用ID ai.local.claude-local，可选浏览器注册名 Claude-Local-Browser，数据按用户保存在 %APPDATA%/ai.local.claude-local。默认身份管理页，普通启动不打开浏览器。不加 upstream、官方更新源、自动公开发布或别的软件发行依赖。

## 已完成与交付

**0.1.1 已完成源码修复、本机文件式更新、custom-protocol NSIS 打包、隐私审计及私有 GitHub 预发布上传。没有构建/CI/上传阻塞；真实账号消息权限仍未代用户验收。**

用户随后询问更新、安装、打包、上传及README，并要求加入隐私安全的界面图。本次已再次只读核对：本机正在运行0.1.1，宿主/安装包hash及GitHub服务端digest与回执一致，远端README已是0.1.1。此次采用文件式更新，未在用户机运行NSIS安装向导；安装/卸载/降级验收仍属下文遗留项。README新增身份管理、用量分析、自动续杯三张实际前端截图，全部使用隔离的合成账号/用量，邮箱遮罩且仅example.invalid；无真实资料、IP、代理、路径或PNG文本/EXIF。图片出处与边界见docs/screenshots/README.md；文档更新不重打包、不移动v0.1.1。此段更新前的HANDOFF备份/hash在.local/tasks/20261026-readme-screenshots/。

- 源码/固定产品标签：`v0.1.1` → `a558efd29b0b46bf85edee4eb8f8b24e2545989a`，工作分支 `feature/functional-reliability-20261023`，普通快进推送到 origin/main 与远端工作分支；后续仅文档提交不移动产品标签。
- [0.1.1 预发布](https://github.com/yq04/Claude-Local/releases/tag/v0.1.1)，draft=false、prerelease=true，仓库仍私有。附件仅 `Claude-Local_0.1.1_x64-setup.exe`，140,490,055 字节，SHA256 `4f53501f52852cc447700bb97ad0573933824af38aff33ef288aae01d9327a2b`，GitHub服务端digest及大小精确匹配。
- 中性构建的109个解包文件、13项外部隐私探针，0发现。本机102项应用文件校验一致，实际替换9项，宿主最后更新；宿主NSS SHA256 `103c59c62e563ab7fca1ed4f11f9560db5cf91c1576b8c1aee1c851e44fcef88`。原始UNK宿主SHA256 `31bf44c6192b45a2adc805d5c2f8f7d07b040aebce51477f64c2259379cc4115`，仅既有经审计3字节Tauri包标记差异。
- 应用已重新打开，Claude Code进程保持（missingClaudeCount=0），未停止浏览器、未改身份/额度/自动开关。更新后只读投影：自动续杯关闭，3个账号全部同步能力/decision（均http_connect），unknown=0，仍有2个历史授权阻断按原样保留。不是宣称账号全部恢复。

本轮确认并修复：

- 自动续杯关闭时，后台和状态读取原先跳过本地账号就绪同步，能力/decision可能一直空。现在关闭仍每分钟以及显式读取/配置时同步，只更新本地状态，不派发请求。阻塞IO移至后台线程。
- Current转Summary原先把已有 OAuth有效期/刷新资料存在性置空。现在保留原有元数据流的可选字段，不新增凭据读取边界、不把OAuth有效期当订阅到期。
- 一次恢复原先依赖账号已存在于调度状态。现在重新核对绑定目标并初始化缺失状态；只解除确认的auth专属退避。明确未开始验证的本地依赖/启动/不支持代理失败保留许可，实际profile401消耗许可；429、共享间隔、未知请求保护不变，execute超时/协议异常继续未知保护。
- 新前端只展示短状态、本地登录、操作、单条原因及最近尝试；分开本地登录与历史服务端拒绝，等待改成时分秒，已授予的一次验证有明确反馈。多区块换行，阻止窄窗口横溢；手动批量计数只含真正可操作账号。
- 浏览器完整报告只有未知项时显示检测未完成，明确不符显示失败，全部确认通过才显示通过。出口未提供机房属性仍未知，可展示已有ISP/ASN帮助理解；无新增查询服务/真实ASN白名单。WebRTC无STUN，增加statechange/完成状态检查及1000ms有界收集；超时/失败仍未知，不把未知改绿。

实现入口：src-tauri/src/identities/wakeup.rs、wakeup_tests.rs、profile.rs；src/wakeup-presentation.ts/test、identities.tsx、identity-productivity.css；browser-webrtc.ts/test、browser-verification.ts/test、browser-start.tsx、style.css。两语同键同插槽，产品四处版本一致0.1.1。用户说明见 docs/AUTH_SYNC_0.1.1.md；准确交付数据见 docs/RELEASE_VERIFICATION_0.1.1_SYNC.md。

验证完成：本地49项独立Bun定向测试、19项Rust定向测试、13项续杯GUI及8项浏览器GUI检查均通过，TypeScript与发布前端构建通过。760px中英文无横向溢出，实际页面覆盖18通过/2未知→黄色未完成。旧浏览器GUI夹具缺少hosting分类及确定RTC输入，已修正夹具，不放宽产品准入。

[Windows CI 40283578357](https://github.com/yq04/Claude-Local/actions/runs/40283578357) 对固定源码a558efd全部成功：Bun132项；原生246通过、1忽略及另1项检查；离线浏览器4项、额度/运行资源/迁移100通过2跳过、Windows CLI19项。测试和审计使用合成数据/公共输入，没有真实账号查询或消息验证。

## 真实账号状态与限制

本轮修复前，只读官方CLI状态已确认loggedIn=true、claude.ai/firstParty/Pro，当前身份与其中一个保存账号匹配；另一个保存摘要valid但保留历史auth_required、authBlocked及授权退避。账号别名、邮箱、组织、指纹和投影留在私有回执，不写公开文档。自动续杯原本关闭，未擅自开启。

这些证据不说明封禁，也不证明所有保存账号的messages权限恢复。网页登录不更新CLI OAuth，本地valid不等于云端验证成功，归档generation变化也不证明重新登录。没有替用户登录、refresh共享授权、真实切号、发消息/唤醒或修改真实额度。更新后由持有人确认身份快照对应正确账号，再显式允许一次验证；只有新鲜可信结果可确认恢复或新5h窗口。

## 此前任务已经完成，勿重复

- Astra优化方案已实施，见 docs/plans/2026-10-25-functional-audit/04-ASTRA-OPTIMIZATION-PLAN.md 和05-EXECUTION-RESULTS.md；04的pending是规划历史，不是当前待执行清单。
- 只有Rust唯一调度器，应用运行/托盘隐藏可工作，退出/睡眠不发送；React旧15秒timer已删除。成功必须同账号新鲜未来5h reset且晚于到期reset，普通updated/cached/7d-only不能冒充成功。
- unknown派发前落盘，崩溃不重放；只有同账号独立新鲜5h服务端被动锚点解除unknown，不解除messages授权阻断。共用路由6–13分钟错峰与逐账号退避/主力阈值待命保持。
- 网页查询修复队列与CLI唤醒结果已经分离，browser_fallback_status保留具体失败，统一重试保留回执；不能用网页登录修复CLI提示误导用户。
- Agent Reach已升级1.6.0，原配置保留；不是产品运行依赖，不重装。
- CCBaga对比见 docs/CCBAGA_COMPARISON.md，固定外部bdfb90c/v0.2.49。值得借鉴单身份便携包和安装排障，但.bagapack尚未实现，不写成现成功能。
- 首次公开候选从0.3.1重置到0.1.0已经交付。v0.1.0固定ff6bc8128de0732ca893afbdb76b1d7156f76a8a，安装器SHA256 37bfd3cbe1653dfaff9412fb4e2324304db44841c606d5fae480268d11bba1ec，140504677字节。旧v0.3.0/v0.3.1保留。不得覆盖这些标签/资产。

## 遗留与下一步

1. 真实账号权限验收必须根据持有人新操作/具体错误判断，不能根据本地登录宣布全部恢复；环境两项未知独立于账号登录。无需无故再次要求已经成功登录的用户重登。
2. NSIS真实安装/卸载、0.3.x→0.1.x降级、系统修改、睡眠恢复仍未在一次性Windows环境验收。本机文件式更新、三语模板编译和只读解包不能替代这些验收；禁止在用户电脑跑CI-only系统测试。
3. 仓库仍私有，预发布不等于对外公开。Cromma复制子集授权、15个Pika图标取得范围、完整Chromium notices仍待专门核对，见NOTICE.md及docs/DISTRIBUTION.md。未核实不能写成已解决或已证明违法。
4. 43历史文档删除尚未获具体确认，旧清理清单/hash已漂移，不执行删除。用户全权负责打包上传未扩大成改史、强推、移标签、删Release或改变可见性。旧精简副本已落后于修复，不用于公开。
5. 若后续继续功能增强，按需规划Windows单身份便携导入导出/安装排障，不重新做已完成Astra方案。文档更新不重建产品。

当前无技术阻塞。下一会话先核对用户新反馈及只读状态；若只是补文档，不重建/覆盖0.1.1。已打开的浏览器核验页需刷新或由用户重新打开以加载新前端，不能为更新杀浏览器。

## 绝对不要再踩的坑

- 工作树原AGENTS.md是用户未提交修改，保留且不顺带提交；多会话共享工作区，不stash/reset/restore/clean/强推/递归删worktree。常规代码局部编辑与测试自愈可自主；删除/丢改动的操作仍需明确范围确认。
- 用pwsh7；不用WindowsPowerShell5.1。functions.exec严禁notify和yield_control，单次最终输出，避免CPA工具配对损坏。常规子代理Gemini3.8Flash high，复杂Sol6.1 high，不派Claude/Luna/Argon/Astra/旧Sol子代理。
- 不读取凭据/令牌/密钥/.env/.baga/Cookies正文，不输出真实邮箱、账号指纹、代理/IP或秘密。只读诊断使用白名单投影，日志不整段倾倒。私有证据在.local/tasks/20261026-sync-repair/，不加入Git。
- 不停claude.exe或浏览器，不自动切号、改真实开关/账本、清理身份/资料或代发消息验证。更新仅精确产品宿主，备份/hash/回滚，宿主最后替换。新窗口/home/profile用合成数据。
- BAGAID01、.baga格式、SQLite user_version3、HMAC、legacy CCBaga/browser seed-domain不变，不重生成ID/密钥/浏览器种子。迁移复制到新私有目标并验证，保留源资料。
- Python是quota账本唯一写入者，跨进程锁/原子替换/新锚点优先；被动CLI/statusLine，不新增OAuth usage默认轮询/共享refresh，不写.claude.json。UI一小时或手动刷新边界保留。
- Windows正式包必须custom-protocol，中性Cargo home/target在仓库与USERPROFILE外，13外部隐私探针只传路径。NSIS内NSS宿主与原始UNK宿主有经审计3字节格式标记差异；本机比对解包NSS载荷，不能误认正常hash差异为源码不同或手工改二进制。
- 失败的验证不能靠清空工作区骗绿；定向测试通过即止。无必要全库回归或多轮深审。本轮Rust额外quota_regression_tests.rs仅rustfmt换行，无行为修改。
- HANDOFF重写前备份并核验SHA256；本轮原件和校验在.local/tasks/20261026-sync-repair/HANDOFF.before-0.1.1.md及handoff-backup.json。
