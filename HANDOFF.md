<!--
[INPUT]: Owner-marked UI regions, installed-production browser checks, source CI, synthetic captures and checked delivery receipts.
[OUTPUT]: Current project/task status, completed work, limits, next steps and non-negotiable pitfalls.
[POS]: Context-free handoff; identities, local paths, process receipts and private probes remain ignored.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only changes do not rebuild packages or move tags.
-->
# Claude-Local 新会话交接（0.1.5）

更新：2026-10-26，America/New_York。先读本文、根AGENTS.md/CLAUDE.md，改模块再读对应目录CLAUDE.md和源码头。

## 当前任务与交付结果

用户要求：修好浏览器检测，并按五张截图红框精简快速配置、浏览环境、网络环境、身份页和用量页的说明与工具栏，全权交付且不影响账号、浏览器登录或运行中的Claude Code。

**0.1.5已完成源码、隔离验证、本机文件更新、Windows NSIS打包审计和私有GitHub预发布上传。没有构建/CI/上传阻塞；真实账号消息权限和真实安装/卸载仍未验收。**

- 固定源码/标签：`v0.1.5` → `2ce460b9c059d002926d82fe2ca91e8d56c89aca`，[CI40311799063](https://github.com/yq04/Claude-Local/actions/runs/40311799063) success。工作分支feature/functional-reliability-20261023，普通快进推送main及远端工作分支，后续纯文档不移动产品标签。
- [私有预发布](https://github.com/yq04/Claude-Local/releases/tag/v0.1.5)，draft=false、prerelease=true。附件仅`Claude-Local_0.1.5_x64-setup.exe`，140,494,613字节，SHA256`7752c5cee71d206dc57c99f5433bb4dded182d47a99ed11f1f8ce34b9753d0b1`，GitHub服务端size/digest精确匹配。
- 中性custom-protocol构建，解包审计109文件/13外部隐私探针/0发现。本机102项应用文件校验一致，8项实际变化，先备份/hash/stage、宿主最后替换并验证启动；NSS/本机宿主SHA256`232b44cc3a9bf54c5eb35ef5a8f126003d2ba806c880fc1ee5f191f9a0bb56e2`，原始UNK`8bb41524c5dad5a14f0d95190c2b41562d6195e63238bd4d155d5b7cdca52f03`，仅审计确认的3字节包标记差异。
- CLI进程缺失0，原浏览器根PID及UTC创建时间保持；更新前后3个身份的索引/归档引用/大小/mtime、3个浏览器绑定、活动指针和SQLite v3一致。交付工具未直接读真实归档、密钥、凭据、Cookie或会话正文，未切号、清理、改代理/隐私参数/自动开关。

## 本轮做了什么

Quick移除重复的浏览器目标配置脚注，四项独立状态及失败反馈保持。浏览页绑定身份/状态/引擎移到紧凑顶栏，删除重复登录段落和未检测指引；有实际观测但未完成/冲突/过时仍明确提示。网络页删除重复范围段，保留一处检测用途、四域结果及固定复制动作。

身份页按自动续杯/时段与浮窗/同步/更多分组，统一28px并允许窄屏折行，业务回调原样保留。用量页更新指示与操作分组，常驻日期/简短时区，完整IANA/偏移在提示、跟踪起点在提示与方法说明；查询/TSV字段和计算不变。浏览页数据及高级卡按内容区容器宽度折为单列，避免只按视口判断导致侧栏挤压。

五页中文1280px/英文760px共10项DOM布局检查通过，额外浏览页窄屏与真实未完成反馈通过；没有标题操作重叠或文档横向溢出。全前端141测试、类型/构建检查通过，最终source CI另有完整原生/离线检查。图片视觉/DOM/PNG文本EXIF检查通过，README更新五张0.1.5实际组件演示图，邮箱只用example.invalid并遮罩。用户QQ原图未复制或公开，旧0.1.1图片保留历史。

入口：quick-actions.tsx/quick-setup.css、browser.tsx/vps.tsx/style.css、identities.tsx/identity-productivity.css、usage-statistics.tsx/usage-statistics.css。说明docs/UI_POLISH_0.1.5.md，交付docs/RELEASE_VERIFICATION_0.1.5_UI.md，图片docs/screenshots/0.1.5/。本轮私有计划/基线及回执.local/tasks/20261026-ui-polish/。

## 浏览器问题的已确认事实

用户截图页脚0.1.1是旧界面记录；本轮开始核对时可见实例/宿主/两个产品快捷入口都是0.1.4且hash匹配，没有发现旧运行副本。0.1.4及本轮安装后均用实际安装的生产前端、完整生产CSP、固定真实引擎/临时资料和合成HTTP验证20/20；这证明检测链生效，不是对用户真实出口或账号权限的认证。

以前绿色含乐观兜底，9b89502（2026-10-25 22:34 UTC-4）改成完整证据要求后，RTC超时/ISP缺字段显露为未知。旧1秒计时在构造前布放，而固定148.0.7778.215引擎构造约3.5秒。0.1.3改为构造后5秒协商、描述完成后2秒采集，无STUN、完整结束才通过，保留UDP保护；同IP分类仅缺hosting时沿原路由补查固定IPQuery，严验IPv4/IPv6与布尔，3秒/32KiB、无API密钥/凭据/Referrer/重定向，失败保留原geo和受控未知。

最终发现0.1.3生产CSP漏新域名，dev GUI未带CSP漏测。0.1.4精确放行api.ipquery.io，真实HTTP头断言及提取生产connect-src的页面测试先失败后通过；0.1.3标签资产保留候选并注明取代。0.1.5不改这条核心算法或安全策略。真实机房标记/服务失败仍须如实显示，不能强制20/20。

更新后主软件“浏览环境”点“重新打开实测页”，再实测；旧标签保留旧脚本/CSP且宿主重启后旧端口票据可能失效。无需清Cookie、退出Claude网页、重登CLI、换代理或重设指纹。环境项不判断账号封禁/CLI消息权限。

## 项目边界与此前已完成

独立Windows10/11 x64产品Claude-Local，主程序claude-local.exe，ID ai.local.claude-local；浏览器Claude-Local-Browser。数据%APPDATA%/ai.local.claude-local，按用户隔离，不是OS沙箱。默认身份页，仅合法页枚举可记忆；普通启动不拉起浏览器。无upstream自动同步、官方应用更新源、自动公开发布或别的软件发行依赖。

Rust唯一进程内自动续杯owner，切页/托盘可运行，退出/睡眠停止。新鲜未来5h reset且晚于到期reset才确认成功，普通updated/cached/7d-only不能冒充。未知POST先落盘不重放，只有同账号独立新鲜5h锚点解除unknown，不解除messages授权；401显式一次许可，429/共享错峰保护保持。网页查询队列与CLI唤醒已分离，网页登录不更新CLI OAuth，本地valid不证明消息权限；保存归档generation变化不等于重新登录。不要无故要求已成功登录用户反复重登。

0.1.2已加固备份新暂存RAII、解包资源限额、有界32字节密钥读取及自有明文缓冲；.baga/BAGAID01/CLBKUP01、AES/PBKDF参数、主密钥/ID/HMAC/SQLite v3/legacy浏览器seed字符串全部保留，用户明确不更换后缀。恢复只创建新私有副本，不覆盖源。没有DPAPI、Argon2或密钥轮换迁移。

Astra方案已实施，见docs/plans/2026-10-25-functional-audit/04及05；旧pending是规划历史，不重做。CCBaga对比固定bdfb90c/v0.2.49；单身份bagapack仍未实现。Agent Reach1.6.0已升级，不是产品依赖，不重装。iKuuu/Kookeey固定批准链接仅复制，无编辑或自动外跳。Python是quota账本唯一writer，锁/原子替换/新锚点优先；被动CLI/statusLine，不新增默认OAuth usage轮询/共享refresh或写.claude.json，额度UI一小时或手动。

## 遗留与下一步

没有当前交付技术阻塞。按用户新反馈核对版本与具体controlled reason，先区分真实账号、环境测量和旧页面，不为文档重打包。

1. 真实messages权限未代发消息验收；本地登录/环境通过不保证授权恢复，保存快照需对应正确账号并按需一次验证，不自动切号/refresh。
2. NSIS真实安装/卸载、0.3.x→0.1.x降级及睡眠恢复仍未在一次性Windows环境验收，文件式更新与解包不替代它们，不在用户电脑跑CI-only系统测试。
3. 仓库仍私有。Cromma复制子集、15个Pika图标取得范围、Chromium完整notices仍需核对，见NOTICE和DISTRIBUTION；顶层MIT/对方已公开不能替代授权依据，也不把未核实写成已证明违法。
4. 43历史文档删除仍无具体批准，旧清单/hash漂移，旧精简副本已落后。不改史/强推/移标签/删Release/转公开。旧v0.3.0/v0.3.1及v0.1.0–0.1.4保留，0.1.3仅历史候选。

## 不要再踩的坑

- 用户原AGENTS.md未提交修改保留且不顺带提交；多会话共享工作区，不stash/reset/restore/clean/强推或递归删worktree。
- pwsh7；functions.exec严禁notify/yield_control，保持单次最终工具响应。常规子代理Gemini3.8Flash high，复杂Sol6.1 high；不派Claude/Luna/Argon/Astra/旧Sol子代理，最多3子代理。
- 不读真实.env/credentials/token/secret/key/.baga/Cookies/会话正文，不输出真实邮箱、IP、指纹、代理秘密。测试用合成资料/独立浏览器，截图不能复制用户原图到GitHub。
- 不停claude.exe或用户浏览器，不用真实切号/清理/发消息测试。部署精确宿主路径/PID/创建时间与用户SID，先备份/hash、宿主最后更新；有恢复/归档写入则推迟。进程时间跨JSON要转UTC ticks，不能字符串与DateTime直接比较。
- GUI与Vite构建串行，源码验证通过即止，不无端全库重复或多轮深审；新问题有证据才扩测试。失败不靠Git清场。CSS宽度跟内容容器判断，不能忽略侧栏。
- 浏览器回归必须用生产CSP，dev放行不证明生产可用；仅精确白名单，不关网页安全或UDP保护。旧标签缓存/会话要重新打开，不清用户资料。
- 正式包custom-protocol，新中性Cargo home/target只用公共缓存，13标记只传私有路径。NSS对比解包宿主，UNK/NSS有合法3字节差异，不手改二进制。仅文档不重建/覆盖已发包。
- HANDOFF重写前归档并核验SHA256；本轮原件在.local/tasks/20261026-ui-polish/baseline/HANDOFF.md和baseline-manifest.json。旧回执保留各版本docs与.local对应任务，不拿早期候选hash代替现行。
