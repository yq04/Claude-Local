<!--
[INPUT]: Verified0.1.7 productivity features, input/retry fixes, private runner build, local13-probe audit and backed-up update/publication receipts.
[OUTPUT]: Current product/task, delivered behavior, evidence, remaining limits and safe next steps for a context-free session.
[POS]: Repository handoff; process IDs, install paths, private probes and machine receipts remain in ignored.local/.
[PROTOCOL]: Copy to.local/handoff-archive/ and verify SHA256 before rewriting. Do not rebuild or clean merely to refresh this document.
-->
# Claude-Local 会话交接

更新日期：2026-10-22，时区 America/New_York。以本文件的 **0.1.7** 状态为准；旧版包、CI或安装回执不能替代本轮证据。

## 0. 当前交付状态

- **0.1.7 已完成更新、源码上传、CI与私有预发布**。最终产品/构建提交 `765148f3e3c4b0d67f4f7e3e6cf6a2370d0ffaa5`；功能主体在其祖先 `06673d8`，后续提交只增强手动私有构建证据与传输，不改六项功能。
- 精确同提交的 Windows workflow **39777236360** 成功，含源码检查、原生/前端/离线测试、中立 custom-protocol NSIS 构建与受控私有草稿传输。
- 发布 `https://github.com/yq04/Claude-Local/releases/tag/v0.1.7` 为非草稿的私有预发布；八附件独立下载/SHA256全匹配，v0.1.7指向上述提交。旧v0.1.6与附件未覆盖。
- 本机文件版本0.1.7、主窗口存在、资源/主程序哈希核验通过；随包采集脚本后端rust。更新验证96个程序文件，替换13个；更新前记录的Claude进程均仍在运行。
- 最终交接另作仅文档提交，main可能领先产品标签；成功产品CI、安装包和源码ZIP仍固定对应上述提交。没有遗留交付阻塞。

## 1. 产品与本轮任务

Claude-Local是独立维护的Windows x64桌面产品，主程序claude-local.exe，标识ai.local.claude-local，用户数据在 `%APPDATA%/ai.local.claude-local`。提供本地加密身份备份/切换、被动5h/7d额度观察、独立Token统计、环境配置及按需伴生浏览器。技术栈为Tauri/Rust、React/TypeScript与Python被动采集。普通启动不打开浏览器，默认身份页，只记忆合法页面枚举，无上游同步或官方应用更新源。

用户先要求继续调研优秀开源项目、修复问题并建议增量功能；随后明确“按推荐内容执行”。本轮已实现六项建议，并保留调研阶段确认的畸形额度输入与CLI读取重试修复，沿用先前授权的完整更新/上传流程交付。

## 2. 六项已交付功能

1. **身份检索与视图排序**：可见别名搜索、Esc清空，名称/最近保存/原顺序排序；当前身份固定，原生记录顺序和180×286工牌不变。隐私打开时不按隐藏邮箱或原名命中/排序；关闭时可搜索邮箱。
2. **额度观测与采集诊断**：逐窗来源、观测年龄，缺失或未来时间不伪造年龄；配置存在、脚本随包与运行时未验证分别说明。诊断复制采用字面白名单，仅版本/时间/来源/配置flag，不含账号名、邮箱、ID、代理、路径或原始statusLine。
3. **Ctrl+K / Cmd+K命令入口**：八页导航、活动页刷新、打开已保存身份的既有确认和交接表单。输入区、IME、其他dialog/alertdialog和任务锁阻止快捷键劫持；方向键/Home/End滚动活动项并保持输入焦点。关闭恢复可用触发入口，回车不直接切号/清理。
4. **手工任务交接**：任务、目标、进度、下一步、验证、约束六个有界内存字段，Markdown文本预览、复制回退与显式下载task-handoff.md。没有读取会话/项目/凭据，没有自动填写“已验证”，退出应用不自动持久化草稿。
5. **当前聚合TSV导出**：仅当前有效scope的汇总与已发生时段，含生成时间/时区/覆盖范围，复制或用户点击下载不额外读原生日志。隐私下范围用通用标签；单元格转义与公式前缀保护，不附隐藏未归属桶、独立推理或未来零值，不含原始事件/会话正文。
6. **IANA/DST统计**：前端传命名时区，原生按逐事件本地日历及午夜边界聚合；今日区间支持23/25小时、重复小时偏移与LordHowe半小时转换，Token不重计/丢失。每小时均值按真实区间时长；当前未结束槽仍按完整区间计入。旧offset-only调用保持兼容，非法时区固定报错。

主要新增模块：src/app-events.ts、command-palette.tsx/command-model.ts、handoff-model.ts/task-handoff.tsx、identity-list.ts、identity-diagnostics.ts、usage-export.ts及对应测试/CSS。主壳与各页面复用现有控件和刷新逻辑，不新增路由枚举或大列表运行时。

## 3. 数据修复与兼容边界

Rust与Python在把观测当作可信百分比前校验有限性/范围，异常大数、负值、布尔值或NaN/Infinity不再截成假耗尽/满额或让采集崩溃；100–101轻微超出兼容为100。Python在副本上过滤坏锚点，不修改输入缓存对象，不用一窗异常隐藏另一窗。额度摘要版本 **7** 触发旧缓存惰性回填。

CLI首次状态读取失败显示不可读与手动重试，不误报未安装；读取错误和检查/更新错误分别保留。统计说明已对齐“全部/已保存账号”界面；未确定归属历史仅在用户明确的稳定兜底适用时聚合，原始归属证据不改。

Python仍是quota_ledger唯一写入者，保留跨进程锁、锁内重读和atomic replace；Rust UI只读该额度账本，Token统计有独立原生私有账本。schema1 `--quota-core` 仍为纯有界JSON（1MiB/256项），入口早于Tauri/单实例初始化，不读文件或联网；安装布局核心失败不得静默fallback写入。

SQLite user_version=3、BAGAID01、.baga编码、账号HMAC、归档密钥与legacy浏览器种子域不变。0.1.6的reset_inferred继续明确预计恢复、不推下一reset、不把计算/保存时间当新观测、不参与推荐。离线仍不能确认其他设备用量。安装包未捆绑Python/cryptography，不自动改现有hook；脚本存在/后端rust不代表旧statusLine已经迁移。

## 4. 验证与实际构建路径

- 聚焦Bun36项与TypeScript/Vite构建通过；Rust额度核心8、profile回归15、用量归组24，Python34（含真实debug Rust子进程）通过。
- 隔离GUI：身份27断言、用量导出/DST6组、命令与交接12组，通过。涵盖隐私搜索、诊断白名单/复制失败、无真实身份写命令、焦点/模态守卫、23/25小时、导出范围/不额外读取、侧栏内部文本边界。最后实测身份排序触发器96×28px，经典侧栏快捷按钮按内容占宽并分行避免内部溢出。
- 同提交临时Windows runner完成检查与正式中立构建。新增chrono/chrono-tz与phf静态查找依赖保留原版权和所选MIT声明，NOTICE已随包；未升级无关依赖。
- 本机两次初始release构建因系统提交内存耗尽而停止，未替换安装文件；agent没有结束MATLAB等任务。用户随后回复会自行保存并释放MATLAB内存；已运行的远程构建路线继续完成，未重复编译原生程序。临时runner之后构建成功，但Actions artifact存储配额阻断上传，未删除历史artifact或改系统内存设置。
- 因此增加显式手动private-draft传输：同样公开的原始主程序、前端、安装包、哈希和审计证据上传到始终draft的内部build release。无私密probe/用户数据/长效发布密钥上传，也无自动产品发布。取回后在本机用原13项probe重新审计，按路径/SHA逐项比对CI和本机提取清单，验证原始host及已知Tauri3字节bundle标记变换；未逆转或猜测二进制。
- 本机审计103文件、13私密probe零发现，正式版额度管道在停止旧主程序前通过；随后复用既有备份/哈希/精确host身份/回滚事务，只重启本产品主程序。
- 独立前端核对曾拦截旧工作树CRLF与新检出LF造成的资源哈希差异；从同一Git提交导出源码、锁依赖重建并建立独立Git扫描边界后，10个前端文件与远程全部逐字节相同。无边界的嵌套archive会改变Tailwind自动扫描范围，因此不能只复制源码后直接把差异当随机哈希。完整包审计以新的Git对象源码、已独立复现前端和固定引擎为参考，保留第一次失败记录；没有覆盖旧工作树或旧dist，也没有用包自身作唯一真实性依据。以后复现使用清洁、独立仓库边界。

安装包 `Claude-Local_0.1.7_x64-setup.exe`，133.54MiB；SHA256 `7e2272110c8bc7242e1439c402c23d31f620aa4ac8398f1fd05ac83c6b19589d`。
本机主程序SHA256 `99b15c0e1f5d81cea14133dd8ccf661ecb068a43c8b546ecdeaa8053da1d7979`。

文件式更新和NSIS只读解包不等于实际安装/升级/卸载验收；这些系统验收仍只在一次性Windows环境执行。额度/身份功能测试使用合成数据，不通过真实切号验收。

## 5. 源码、发布与证据

仓库yq04/Claude-Local保持私有、默认main；最终产品提交 `765148f3e3c4b0d67f4f7e3e6cf6a2370d0ffaa5`，成功workflow https://github.com/yq04/Claude-Local/actions/runs/39777236360 。v0.1.7标签与八附件固定对应该提交，最终交接仅文档回填另作提交，不把文档HEAD当重新构建的产品。

八附件是安装包、SHA256SUMS、隐私审计、资源清单、0.1.7更新说明、对应提交源码ZIP、LICENSE、NOTICE，均独立下载校验。内部build-*传输release保持草稿，仅用于保留取包证据，不是另一个产品预发布；不覆盖或删除旧v0.1.6附件。

本地证据全部ignored：

- .local/last-local-update.json：实际安装、备份/进程/hash回执。
- .local/release-0.1.7/：源码/CI/内部传输/本机审计/准备计划/发布/独立下载/最终verification回执及私有日志；失败构建日志也保留。
- .local/tasks/20261022-productivity-implementation/：任务计划、locale决策、GUI脚本/报告/合成截图与最初未发布补丁快照。
- .local/tasks/20261022-product-research/：七项目证据、额度坏输入和CLI恢复合成验证。
- .local/tools/complete-local-update-0.1.7.ps1及release目录的import/apply helpers：原更新器复用与审计导入事务；不要为刷新交接重新运行。

报告docs/PRODUCT_REVIEW_2026-10-22.md保留调研时点建议，实际本轮已执行；用户说明见docs/RELEASE_NOTES_0.1.7.md和docs/USAGE_STATISTICS.md。研究Canvas为本机旁挂产物，不是安装包输入。

## 6. 后续与执行纪律

本轮六项建议与既有修复均已交付，无待办阻塞。后续可在一次性Windows环境验收0.1.6→0.1.7 NSIS真实升级/卸载数据保留；自动采集接入仍需受控Python依赖分发和既有hook兼容，不可自动覆盖设置。转公开前仍需按NOTICE与DISTRIBUTION核查Cromma/Chromium等既有许可边界，私有仓库不消除分发义务。

保持唯一额度writer、账号/组织隔离和原观测时间；预计恢复不等于新服务端证据，缺数值不补0。不得停止claude.exe或强改真实身份/浏览器资料。普通启动不拉起浏览器，命令入口仅打开确认。导出保持隐私和聚合边界，交接只处理用户手填内容。

Windows用pwsh7，functions.exec禁止notify/yield_control；不输出完整凭据、原始statusLine、私密probe或个人安装路径。按改动验证、通过即止，不用stash/reset/restore/clean清场，也不为结束会话重复建包。

## 7. 工作区归属

AGENTS.md既有本地修改不属于产品提交；未跟踪 --help/、.planning/、.rivet/、docs/superpowers/原样保留，不删除、不移动、不暂存。.local/、真实归档/数据库/账本/凭据/包和机器笔记不得进Git。

新会话先读本文件和根/相关CLAUDE.md，再只读核对main、v0.1.7、成功CI、私有发布和本轮回执。无需自动清理或再次部署。
