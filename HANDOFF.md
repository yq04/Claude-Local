<!--
[INPUT]: Final repository/release state, checked product delivery, source and metadata receipts, owner preferences and retained limitations.
[OUTPUT]: Context-free handoff covering active goal, completed work, remaining gates, next actions and pitfalls.
[POS]: Repository-root maintenance handoff; private identities, process details, paths and probes stay in ignored .local/.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only changes do not rebuild binaries, replace assets or move product tags.
-->
# Claude-Local 新会话交接（0.1.5）

更新时间：2026-10-26，America/New_York。新会话先读本文、根`AGENTS.md`和`CLAUDE.md`，改模块前再读相应目录`CLAUDE.md`及源码头。

**最终结论：本机已运行0.1.5，源码、Windows安装包、审计及GitHub上传已闭环；公开仓库的README、CCBaga二次开发归属、About、Topics、Issue表单、六个发行页与远端Tags已整理并核验。没有构建、CI、上传或待确认标签删除阻塞。本次结束只更新交接，不再构建、安装、切号、清理或改动运行中的会话。**

## 1. 当前任务与用户目标

Claude-Local是**基于[CCBaga](https://github.com/liseami/CCBaga)二次开发、独立维护的Windows10/11 x64工具**，不是全仓原创，也不是Anthropic/CCBaga的官方发行。Tauri/Rust管理原生事务，React/TypeScript负责界面，Python负责额度账本采集/单写。主程序`claude-local.exe`，应用ID`ai.local.claude-local`，伴侣浏览器注册名`Claude-Local-Browser`；资料按用户存放于`%APPDATA%/ai.local.claude-local`，不是OS账号沙箱。

本会话连续处理：自动续杯诊断/Astra方案实施、网页登录与CLI授权混淆、重新登录后的状态同步、浏览器两项未知、加密存储兼容加固、五页截图红框排版与冗余说明精简，最后完成公开项目介绍和来源归属。用户反复强调不能影响已有账号、浏览器登录和正在运行的Claude Code；允许子代理并授权必要的本机更新、打包、上传与GitHub整理。

最新偏好必须保留：

- Claude-Local**对外发行序列从0.1.0开始**，当前0.1.5。不要把开发快照、早期功能记录或上游版本写成本项目的另一条发行序列。
- 用户明确决定**不更换.baga后缀**。不改BAGAID01/CLBKUP01、密钥值、账号ID、HMAC、SQLite v3或历史浏览器种子；不为改名重加密资料。
- README必须显著写CCBaga二次开发，介绍要完整、准确；不能靠末尾一句致谢或抹掉上游版权。原LICENSE和既有第三方声明继续保留。
- 图片只能用隔离合成数据。用户发来的QQ原图包含真实身份信息，未复制或上传到GitHub，不能拿来做公开预览。
- iKuuu/Kookeey固定推广链接已经用户批准，随包内置但只复制，不提供收件人编辑、安装级覆盖或自动外跳。

## 2. 当前仓库、发布与本机的唯一有效状态

- 仓库：[yq04/Claude-Local](https://github.com/yq04/Claude-Local)，**已公开**；公开和取消Pre-release由用户本人手动操作，不是代理擅自变更。
- `v0.1.0`至`v0.1.5`共六个Release均`draft=false`、`prerelease=false`，Latest为`v0.1.5`。标题不再带Preview；旧0.1.3已保留CSP缺陷及推荐更新说明，不能因为标为正式版就说其缺陷已消失。
- 远端现仅有六个0.1.x发行标签。两个旧远端开发标签已获**用户明确确认**，在Git bundle及SHA256核验后原子删除；**提交历史没有删除或重写**。
- 两个旧标签的**本地引用和bundle仍保留备份**，不要执行`git push --tags`把它们重新上传。只推明确版本引用。对象/恢复证据见`.local/tasks/20261026-github-presentation/tag-cleanup-plan.json`、`tag-cleanup-receipt.json`和`legacy-development-tags.bundle`；删除远端标签的确认不等于授权删除本地备份或改史。
- 工作分支`feature/functional-reliability-20261023`；`origin/main`与远端工作分支已普通快进同步。本文重写前最新文档提交`71db808`，公开介绍主提交`67cde86`；本文后续纯文档提交会使HEAD继续前进。
- **产品代码/标签固定**：`v0.1.5` → `2ce460b9c059d002926d82fe2ca91e8d56c89aca`。HEAD比产品标签晚是文档更新的正常结果，不是本机没更新；不要为此重打包、移动标签或替换资产。
- [0.1.5安装器](https://github.com/yq04/Claude-Local/releases/download/v0.1.5/Claude-Local_0.1.5_x64-setup.exe)：`140,494,613`字节，SHA256`7752c5cee71d206dc57c99f5433bb4dded182d47a99ed11f1f8ce34b9753d0b1`；服务端digest/size已精确核对。
- 本机0.1.5宿主与解包NSS载荷一致，SHA256`232b44cc3a9bf54c5eb35ef5a8f126003d2ba806c880fc1ee5f191f9a0bb56e2`。原始UNK宿主SHA256`8bb41524c5dad5a14f0d95190c2b41562d6195e63238bd4d155d5b7cdca52f03`；二者仅经审计的3字节Tauri安装格式标记差异，不是两次源码构建。
- 中性custom-protocol构建：109个解包文件、13项外部隐私探针、0发现；本机102项应用文件核验一致，实际替换8项，先备份/hash/stage，宿主最后替换并验证启动。
- 更新保留CLI进程（missingClaudeCount=0）及原有两个浏览器根进程；前后3个身份的索引/归档引用/文件大小mtime、3个浏览器绑定、活动指针和SQLite v3一致。工具没有直接读真实归档、密钥、凭据、Cookie或会话正文，也未切号/清理/改代理、指纹或自动开关。
- **本机采用文件式更新，没有运行NSIS安装/卸载向导验收**。不要把更新成功写成真实新装/升级/卸载全通过。

具体安装路径、PID、创建时间、备份位置和metadata签名仅在忽略的私有回执，不写入公开文档。完整交付见[0.1.5核验](docs/RELEASE_VERIFICATION_0.1.5_UI.md)及`.local/tasks/20261026-ui-polish/`。

## 3. 已完成的关键工作与真实证据

### 3.1 公开呈现、归属和文档

README已完整重构：首屏二开说明、继承与本地改动、下载/安装/依赖、功能、五张演示截图、构建、限制、排障、贡献和致谢。新增[项目来源](docs/PROJECT_ORIGIN.md)、[版本与标签约定](docs/RELEASE_POLICY.md)，NOTICE显著链接上游仓库/许可/贡献者；原LICENSE及NOTICE所有既有第三方章节保持原文。

About已写CCBaga二开，首页指向本仓库Releases/latest；Topics14项包含ccbaga/claude-code/Windows等实际关键词。新增两个Issue Forms及config，保留空白Issue，要求脱敏，不虚构私密安全渠道，不将本项目支持责任转给上游。六个Release正文追加来源/许可页脚，原正文、发布flags、Latest、附件ID/字节/digest及0.1.x标签目标均核验保持。

当前README和规范版本说明不再讲旧开发编号重置/降级，也不定位为私有预览产品。两个误导性旧版本说明文件改为`FEATURE_NOTES_APPEARANCE_MONITOR.md`、`FEATURE_NOTES_USAGE_BROWSER.md`，内容备份保留；其他早期功能/计划资料标注为开发记录，不作现行发行时间线。源候选manifest只调整非必要版本描述，原files/hash/base commit保留。

对外来源不能夸大：`bdfb90c`是固定**比较快照**，不是已证明最初fork点；本仓库初始导入`167780a`日期早于它。不要推测作者法律姓名或贡献百分比，不把通用AES算法宣传为本项目创造。

最近的公开说明整理没有改应用代码、版本号、CI权限或自动发布流程，没有重编译或替换任何已发安装包。`package.json`的`private:true`是阻止npm发布的保护，与GitHub仓库已公开并不矛盾，不要顺手改掉。

### 3.2 浏览器两项未知的修复

“以前通过、后来两项未知”的源码转折是`9b89502`（2026-10-25 22:34 UTC-4）：旧RTC超时未见地址也通过，旧ISP未命中机房关键词默认通过；收紧证据后暴露了真正的测量缺口，不说明网络突然变差。

- **RTC计时**：固定引擎`148.0.7778.215`创建RTCPeerConnection约3.5秒，旧1秒定时器在构造前布放，返回时已经过期。现在同步构造不吃ICE预算，之后5秒协商，描述设置成功再给2秒候选观察；真正结束/complete才通过，异常/超时仍未知，晚到Promise不能复活关闭探针。无STUN，原UDP隐私参数保留；本地候选完成不证明公网STUN/DNS或账号安全。
- **机房字段**：原ipwho.is公共调用和ipapi.co缺所需hosting字段；ipapi.is当前匿名短响应同样不适用，没有接入。仅缺hosting时，沿浏览器当前路由或冻结原生proxy client向固定IPQuery补查**同一个IP**；IPv4/IPv6规范化校验、布尔字段、3秒/32KiB、无API密钥/凭据/Referrer/重定向。失败保留原地理信息和受控未知，不按ASN猜住宅。
- **生产CSP**：0.1.3候选最初漏放新增分类域名，dev页面测试未带生产CSP而漏测。0.1.4只精确加入api.ipquery.io，保留其他脚本/帧/来源限制；实际HTTP头和带生产connect-src的GUI先复现失败再通过。0.1.5延续这些核心修复。

已用实际安装的生产前端、完整生产CSP、真实引擎RTC和隔离临时资料，配合**合成地理/分类HTTP**验证20/20；更新后RTC约3.7秒完成。不是用户真实出口或账号权限的20/20认证，不能用演示数据声称用户已无风险。

更新宿主后，用户应在主软件“浏览环境”点“重新打开实测页”，再实测。旧标签仍持有旧脚本/CSP，宿主重启后旧端口/票据也可能失效；不要只反复点击旧页按钮，更不能为此清Cookie、全重置、重登CLI或换代理。

核心入口：`src/browser-webrtc.ts`及test、browser-network.ts/test、browser-model.ts、browser-verification.ts、browser-start.tsx；`src-tauri/src/browser/network.rs/mod.rs/server.rs/tests.rs`。详见[0.1.4说明](docs/BROWSER_CSP_0.1.4.md)。

### 3.3 五页红框排版（0.1.5）

Quick去掉重复的目标时区/语言脚注；浏览页绑定/引擎合入紧凑顶栏、删除重复登录段和未检测指引，但真实未完成/冲突/过时仍提示；网络页去重复范围段，保留一处用途说明及手动检测。

身份页将续杯/时段与浮窗/同步/更多分组，统一28px并窄屏折行；用量页收拢更新与导出/刷新，日期和简写时区常驻，完整IANA/偏移/跟踪起点保留在提示和方法说明，查询/TSV字段不变。浏览器数据卡和高级设置按**内容容器**宽度折为单列，不能只按整个窗口宽度忽略侧栏。

五页中文1280px/英文760px共10项布局检查通过，额外窄屏浏览器及真实未完成反馈通过。五张0.1.5公开预览为合成数据，邮箱仅example.invalid并遮罩，视觉/DOM/PNG文本EXIF检查通过，远端五图及渲染核验一致。截图页脚0.1.1不是当时实际运行版本；检查过实际实例/hash和两个快捷入口均已是正确安装，没有发现旧运行副本。

入口：quick-actions.tsx/quick-setup.css、browser.tsx/vps.tsx/style.css、identities.tsx/identity-productivity.css、usage-statistics.tsx/usage-statistics.css。详见[UI说明](docs/UI_POLISH_0.1.5.md)。

### 3.4 授权、续杯与加密加固

Astra优化已实施，见`docs/plans/2026-10-25-functional-audit/04`与`05`；旧pending为规划历史，不重新执行。Rust是唯一进程内续杯owner，切页/托盘可工作，退出或睡眠不发请求。不注册服务/计划任务，明确opt-in；只有同账号新鲜未来5h reset且晚于到期reset才确认成功，普通updated/cached/7d-only不算。派发前unknown落盘，崩溃不重放，429/共享错峰保护保持。

网页查询失败队列与CLI/messages授权已分离；浏览器补充失败保留具体原因，网页登录不更新CLI OAuth。本地valid/CLI本地登录成功不等于保存快照或云端messages权限恢复，保存generation变化也不证明重新登录。关闭自动续杯仍同步本地readiness，当前摘要保留既有授权到期元数据；显式一次恢复只释放确认的auth专属退避，不绕过全局/429/unknown。不要让已登录用户无故反复重登。

0.1.2加固备份操作自有新暂存RAII/错误清理、成功副本的独立清理诊断、普通解包资源限额及认证尾部排空、自有明文Zeroizing缓冲和最多33字节读取后严格要求32字节的主密钥验证。内部保险库主密钥是随机值，**不是PBKDF派生，也没有DPAPI包装**；PBKDF2只用于口令导出备份。未实施Argon2、密钥轮换或格式迁移；单身份bagapack尚未实现。

## 4. 验证与回执入口

[源码CI40311799063](https://github.com/yq04/Claude-Local/actions/runs/40311799063)对固定产品源码success：141项前端通过，原生主套件260通过1忽略、另1项定向检查通过；离线Python套件121通过2跳过。类型/前端构建、真实生产策略GUI与隔离固定引擎验证已完成；已绿的验证不因文档更新重复运行。

私有证据都在忽略的`.local/tasks/`，不要加入Git：

- `20261026-ui-polish/`：0.1.5构建、package/deployment/release回执、storage前后、browser进程保留、安装前后生产bundle检查、10项布局/额外浏览器检查、演示图与源/HANDOFF基线。
- `20261026-github-presentation/`：来源/README草稿及基线、metadata审计、六Release前后、validation-final、旧标签批准删除计划/receipt、bundle及SHA256。
- `20261026-public-docs/`：从0.1.0开始的介绍整理，85文档备份/hash、源manifest hash保持和owner手动公开/正式标记的记录。
- `20261026-browser-csp/`、`browser-repair/`、`browser-unknown-diagnosis/`：CSP红绿复现、1.3候选/1.4交付、历史与实机耗时诊断。
- `20261026-crypto-hardening/`、`sync-repair/`：加密加固/1.2与授权同步/1.1的合成测试和交付证据。

公共核验`docs/RELEASE_VERIFICATION_0.1.0.md`及各0.1.x后缀核验文件保留精确源/包/CI信息，后续文档不重算旧校验值。对照时不要拿某个更早源码候选或旧内部同名功能笔记代替当前发行回执。

## 5. 当前卡在哪、下一步怎么做

**没有当前交付技术阻塞，也没有待批准的远端标签删除。以下是明确未完成事项，不是已经验收成功。新会话先接受用户新目标，不自行启动大范围重构或清史。**

1. **公开后许可核对应优先单独推进**：Cromma复制子集独立许可、15个Pika图标取得范围、Chromium完整credits/notices清单仍未核实完。保留NOTICE/DISTRIBUTION的事实，不把顶层MIT、上游已公开或加致谢当作全部授权，也不直接推定已违法。必要时在明确范围内替换组件并保留原归属。
2. **历史隐私尚未完整审查**：以前受控Markdown历史曾发现机器路径，当前文件清理/Tag删除未清除旧提交。若用户要审查可达历史/分支/资产，另开有明确范围的任务；改史、强推或删除历史必须先备份并明确确认，不能直接执行。
3. **真实NSIS生命周期验收**：新装、保留资料升级、卸载、版本回退、取消/失败，以及睡眠恢复，仍需一次性Windows环境使用合成身份测试。不能在当前个人工作机跑CI-only系统测试，也不能把文件更新/三语编译/解包审计代替它们。
4. **真实账号权限未代测**：环境通过不判断封禁或messages授权。按用户新反馈和stage/reason/retry_at等证据判断，必要时由账号持有人确认保存快照及一次验证；不代发消息/唤醒或共享refresh测试，不自动改开关。
5. **公开仓库的分享工作流**：现有可选share-windows任务仍有private-only条件，公开后会跳过；源码checks正常，本地build:windows可用。若用户要公开CI手动打包，再独立调整门禁/资源与审计，不顺带加自动公开发布、upstream更新或secret。
6. 单身份便携包和macOS/Linux发行只是后续候选方向，不是现有功能；不要为本次结束补做。Agent Reach1.6.0已升级且不属于产品运行依赖，不重装。

## 6. 绝对不要再踩的坑

- **保护用户改动**：当前只剩用户原始`AGENTS.md`未提交，必须保留且不顺带提交。不要stash/reset/restore/clean/强推或递归删worktree来“清场”；多会话共享工作区，失败先查原因。
- **授权边界**：远端两个旧标签已明确批准删除且已完成，不能无限扩大为删本地备份/其他标签/Release/重写历史。破坏性动作遵守现行AGENTS说明范围并等明确确认。只推具体版本，禁止push全部本地Tags。
- **工具纪律**：使用pwsh7；functions.exec严禁notify/yield_control，CPA1:1响应错位会报400并毁会话。进度在commentary工具外发送；tools.exec_command返回session_id时完整保存并用write_stdin续查，不要只打印output丢句柄；functions.exec返回Script running with cell ID时才用functions.wait，二者不能混用。
- **子代理与节约**：当前AGENTS的Lane-A默认Gemini3.8Flash high，复杂用Sol6.1 high，fork none；不派Claude/Luna/Argon/Astra/旧Sol。按实际工具槽位上限调度（本次最多3子代理+root），Lane-B含root在飞<=3且ultra<=1。例行独立工作并行卸载，不由主会话串行包揽；验证通过即止，不无端重复全库或多轮深审。子代理草稿必须核事实，不能直接转述。
- **隐私与进程**：工具不读真实.env/credentials/token/secret/key/.baga/Cookies/会话正文，不输出邮箱/IP/代理秘密/身份指纹。测试只用临时合成上下文；不杀claude.exe或用户浏览器，不切号/清理真实资料/发消息测试。公开图片不使用用户原图。
- **部署与时间比较**：精准校验宿主路径/PID/创建时间/当前用户SID，先备份/hash，宿主最后；有recovery或.pending/.stage写入先推迟。PowerShell跨JSON会自动解析ISO日期，进程创建时间须转UTC ticks比较，不把字符串与DateTime直接比而误报浏览器被关。
- **浏览器测量**：必须使用生产CSP测试，Vite放行不等于实际页面可请求。只精确许可固定域名，不用通配HTTPS、unsafe-eval或disable-web-security强行变绿。初始化和ICE分预算；没有完整结果就未知，不用“没看见”推断安全。旧页面重新打开，不重置用户资料。
- **资料兼容**：保留.baga/BAGAID01/CLBKUP01、SQLite user_version=3、HMAC、稳定ID和legacy种子域。迁移只复制新私有目标并验收，保留源。Python是quota账本唯一writer，跨进程锁/原子替换/新锚点优先；默认被动CLI/statusLine，不加OAuth usage后台轮询、不写.claude.json或旋转共享refresh，额度UI一小时或手动。
- **正确表述**：随机内部主密钥与PBKDF口令备份分开；没有DPAPI/Argon2迁移。bdf只是比较基线，不是确证fork点。未验证的Python最低版本、无损升级、零泄漏/防封或全第三方许可，不能写成保证。GitHub公开不等于所有组件已许可；源码/安装包校验不等于真实安装验收。
- **包与文档**：正式build启用custom-protocol，新中性Cargo home/target只复制公共缓存，外部13标记只传私有路径。NSS/UNK合法3字节差异不能当版本不一致，也不手改二进制。README/归属/介绍/交接变更不重建安装包、替换资产、升软件版本或移Tag；`package.json private:true`防npm发布，不是GitHub隐私状态。
- **维护资料**：43份历史文档整批删除仍无具体批准，旧清单/hash已漂移；不是按年龄自动删除的垃圾。YAML表单检查语法、字段和尾随空白即可，不为文档跑全库。CSS响应式按内容容器宽度而不只看视口。HANDOFF整篇更新前必须备份/hash。

本次收尾前原HANDOFF及SHA256在`.local/tasks/20261026-final-handoff/HANDOFF.before-session-close.md`和`backup-manifest.json`。新会话不要再从“没更新/没打包/没上传/没注明CCBaga/旧远端Tags没处理”重做，先核实用户最新反馈与实际状态。
