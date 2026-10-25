# src/
> L2 | 父级: ../CLAUDE.md
额度入口默认只读取本地身份摘要与 CLI 被动观测；identities_quota_revision 约2秒检查账本和配置文件元数据，首次检查及变化时刷新摘要，摘要读取成功后才确认版本，失败或旧响应被替代则下次重试。元数据检查不读取正文。在线额度查询、前台定时查询和绑定浏览器资料补充放在标题⋯菜单打开的弹窗；手动批次按冻结指纹验证所有账号、最多两路并发，运行中可恢复/取消，失败状态不覆盖本地额度。
共享操作控件：普通 Button 统一使用中性 secondary 皮肤、28px 高与10px水平内距，按文字占宽；图标按钮、导航和180×286工牌内专用几何保留，危险确认显式红色。账号筛选框随已选文本占宽，弹出选项保持可读宽度；不修改 vendor 原语或业务行为。
界面只管理输入、状态和执行记录；本机权限交给原生层；网络页提供发行者批准的固定推广链接和配置提示词复制，用户点击后才检测固定 Claude 服务连通性，没有收件人链接编辑、Skill 安装或自动外部导航。两入口复用 YAML 中英文文案，原始诊断保留到呈现时翻译；系统语言与界面语言独立。
browser.tsx: 统一全宽卡片风格的浏览器环境控制台（顶栏标题右侧内联集成「打开浏览器并实测」「设为默认浏览器」与「正常退出浏览器」、绑定身份隐私遮罩与状态/CLI代理不一致提醒及一键同步、10项（5×2满格）目标地区与防封特征核验及一键对齐、按身份自动隔离的日常释放缓存与排障全清理）及默认折叠的指纹与代理高级设置抽屉（底部内联开关与保存动作对齐）；去除机械序号徽章；站点永久删除使用 Alert 警告并默认取消；复用 Cromma UI 和活动日志。缓存明细与高级设置统一使用 Cromma Disclosure，未保存修改时高级设置保持展开。
browser-model.ts: 有界浏览器身份摘要与同步状态；工具箱与起始页共享配置、目标地区、机器、出口服务目录、ASN/ISP/机房分类（classifyExitIsp）、时区偏移/Canvas音频/客户端提示探针字段、观测接收时间与默认浏览器契约；effectiveBrowserTarget 统一解析跟随电脑的有效时区/语言及 en→en-US，不接入原生权限；三平台设备/CPU/版本核验由共用函数保持一致，Windows 必须 Win32。
browser-start.tsx: 检测区上方紧凑黑色身份工牌、绑定状态与不匹配/未知/断连；真实观测与回报编排（内建 WebRTC 泄漏、WebGL 硬件渲染、webdriver 反自动化、CheckCC 时区偏移、BrowserScan Canvas/音频采样、IPHey UA-CH/屏幕色深与 Ping0 ISP/ASN 属性全套 20 项 5×4 满格原生体检）；重测清空旧结果，断连/未知/上报失败不通过；不接入 Tauri 权限。
browser-verification.ts: 纯核验模型，20项逐项实际/目标值与失败清单，沿用宿主配置时区/语言/平台规则与内建第三方防封算法；只有完整回传且所有实测匹配才通过。
browser-verification.test.ts: 跨平台虚构上下文验证三态、失败原因、连接/定位未知和目标时区改变，不访问网络。
browser-network.ts: 按宿主服务目录经浏览器当前路由检测出口，限流/故障切换服务，校验结果并保留失败原因。
browser-network.test.ts: 模拟限流、备用响应与非法出口，验证故障恢复和错误信息，不访问外网。
main.tsx: 独立产品壳、默认身份页与受限页面记忆；侧栏统一全四字标头（快速配置、网络环境、身份管理、用量分析、浏览环境、电脑环境、使用说明、软件设置），底部含语言/版本与命令面板入口；Ctrl+K/Cmd+K 尊重输入焦点、IME、其他模态和任务锁。命令面板导航八页、对当前可刷新页分发本地事件，身份项仅打开已有身份确认；Root 常驻受控手工交接弹窗。根 MotionRoot 读取「减少动画」偏好。
command-palette.tsx / command-model.ts / command-model.test.ts: 键盘可搜索的八页面命令、当前页刷新、身份确认入口与交接入口；身份只在用户打开面板时只读载入，标签遵循隐私遮罩；方向键和 Home/End 更新活动项并滚入可视区但焦点留在搜索框；不执行身份切换。
task-handoff.tsx / handoff-model.ts / handoff-model.test.ts: 六项有界手填任务字段、Markdown 预览/复制/显式下载；字段只保留在组件内存，模板不读取会话/项目/账号，未填验证保持待补充。
productivity-shell.css: 经典侧栏底部自适应两行网格避免命令按钮内容受压，紧凑侧栏保留纵向快捷入口；命令面板与手工交接表单复用现有主题变量。
page-icons.tsx: 侧栏与快速配置共用的页面图标映射；复用已有 Pika 子集与现存用量图形，不增加图标依赖或重复 SVG。
app-events.ts: 活跃页面的本地手动刷新事件与身份确认请求类型；ref维持最新回调、挂载/卸载清理监听，不包含原生写操作。
command-palette.tsx / command-model.ts / command-model.test.ts: Ctrl+K/Cmd+K受控搜索、八页导航、活动页刷新及仅打开既有身份确认；隐私标签过滤、IME/输入框/其他模态/任务锁守卫、键盘可见滚动和焦点恢复。
task-handoff.tsx / handoff-model.ts / handoff-model.test.ts: 六个有界手填内存字段、Markdown预览、复制回退与用户显式下载；导出与导入成对处理标题转义，保留用户手写反斜杠。关闭保留本次内存草稿，不读取会话、项目、账号或凭据，不自动宣称已验证。
productivity-shell.css: 经典侧栏底部自适应两行网格避免命令按钮内容受压，紧凑侧栏保留纵向快捷入口；可滚动命令列表及响应式交接表单使用现有主题和控件。
navigation.ts / navigation.test.ts: 本机页面偏好白名单（含 settings 设置页和 usage Token 统计页）、存储失败回退身份页；不存账号或路径。
help.tsx: 双语只读本地产品说明，含置顶的「新用户与添加新号」三步法及身份/浏览器/离线额度/网络诊断/电脑设置分节说明（统一采用与软件设置一致的强调色竖条标头，去除机械数字序号），Cromma Disclosure 折叠应用使用、账号边界与申诉；不读取用户资料或调用原生命令；手工交接由共享有界模板显式打开。
identity-connections.tsx / identity-connections.test.ts: 中央身份连接与路由修复队列；严格校验当前完整账号/指纹清单的冻结子集，只为明确的授权失败提供按账号打开已有绑定浏览器资料，只提交待处理子集到既有统一额度命令；进程内保留结果以跨页面卸载呈现成功与原失败，不保存凭据或落盘账号结果，合成测试覆盖双成功/授权/路由队列、冷却重试、重新挂载和过期指纹拒绝。
identities.tsx: 紧凑身份工作台与180×286工牌；顶部默认按钮执行本地身份摘要同步并给出已同步徽章反馈，同时提供一键持久化开关的「自动续杯」胶囊与生效时段配置入口；定时元数据检查接收CLI被动额度的本地变化；无订阅/重置资料时紧凑卡片省略该行，详情仍保留未知。在线额度批次、前台定时查询开关、5h 到期自动续杯配置面板（含自定义生效时段、待命号联动阈值、逐账号防风控退避状态与一键唤醒）和集中修复队列位于标题⋯菜单或时段胶囊打开的弹窗；默认身份页无在线说明和结果错误。额度详情弹窗在 reset_inferred 状态下显示剩余/已用双语语义文案、原锚点与已过时长（formatElapsedSinceReset）、7d 消耗步调、一键「唤醒 5h 计时」与「在线校准额度」入口。关闭弹窗会停用前台定时查询，不取消原生批次；批次重新挂载后以紧凑进度/打开/取消入口恢复，不强制打开弹窗。手动在线批次按冻结指纹读取全部当前/保存账号，最多两路并发；结果不清除本地观测，目标身份变化使旧结果失效；成功服务端锚点按原有严格账号绑定合并。保持额度窗口来源区分、预计恢复说明、180×286卡片、身份安全和保留策略现有行为。
identity-model.ts: 浏览器绑定脱敏状态与 SQLite 受限目录、当前/暂存显示字段（含离线/在线 5h/7d 额度百分比、逐窗来源/实际观测时间、quota_identity 64hex脱敏指纹、重置时间戳、订阅日期、重置余额、manual_resets_valid_until 与各自独立的观测时间戳）和保留策略契约；订阅日期与重置资料缺失保持未知，不复用 OAuth 凭据有效期。
identity-list.ts / identity-list.test.ts: 仅保留逐窗观测年龄格式化，搜索/排序辅助已移除；身份页固定当前卡，其余卡片按原生记录顺序显示。
identity-diagnostics.ts / identity-diagnostics.test.ts: literal白名单诊断JSON，仅限有界版本、时间、来源枚举与配置/资源flag；运行时始终未验证，不包含账号名/邮箱/id/代理/路径或原始命令。
identity-productivity.css: 观测年龄、⋯无障碍下拉菜单、顶部自动续杯胶囊、在线额度与5h到期自动续杯配置面板、紧凑活动批次状态、预计进度条弱化、Pro/Max药丸、前台自动刷新开关与集中连接修复队列的局部紧凑布局，维持180×286工牌；已清除搜索/排序行及其空结果样式。
identity-online-quota.ts / identity-online-quota.test.ts: 在线额度状态解析、批量目标构建与指纹集变动检测（buildBatchTargets/generateBatchRequestId/formatBatchProgress）、严格目标指纹核验（isExpectedCurrentTarget/isExpectedSavedTarget）、冷却倒计时格式化、带独立观测时钟和有限有效期/过期状态的订阅与重置格式化、前台聚焦180s串行调度器，以及 5h 到期自动续杯纯模型（含跨午夜生效时段判定 isWithinWakeupTimeWindow、同账号阶梯退避 computeSameAccountWakeupDelayMs、跨账号错峰间隔 computeCrossAccountSpacingMs 与主力号联动唤醒 evaluateWakeupAccount），保证离线/在线数据来源真实性与纯模型测试验证。
identity-quota.ts / identity-quota.test.ts: 逐窗优先读取 5h/7d 来源，兼容旧整体来源；可信服务端重置时间已过时显示 reset_inferred 本地预计恢复及已重置时长（formatElapsedSinceReset），保留原观测且不推算下一重置；缺少可信依据仍未知。evaluateWeeklyPace 按 7d 锚点计算已耗时占比与实际消耗偏差（重置后前24小时静默，超前>=15%预警）。evaluateQuota.recommendable 保持严格非预计契约，切到最优号支持 5h 已静置恢复且 7d 窗口有效的备用账号（同分优先实测账号）。身份页仅更新本地显示时钟，不增加每小时/手动之外的原生读取；详情逐窗展示来源/观测时间，卡片维持180×286。
claude-cli-panel.tsx: 身份页内的品牌 CLI 维护卡片，展示本地版本/路径（支持路径一键复制）与用户手动检查的最新版本，未安装时展示官方 Windows 安装命令复制与「重新检查」入口；读取失败显示不可读与手动重试，不误报未安装，读取错误和操作错误分别保留；运行中禁用更新，首次挂载只读，不自动结束进程。
usage-attribution.ts / usage-attribution.test.ts: 用量归属纯模型；提供脱敏账号标签（复用 settings-model 的 maskDisplayName/maskEmailAddress，防止本地邮箱别名泄露）、未归属用量范围预览、DST 23h/25h 判定与 IANA 时区格式化。
app-events.ts: 共享本地刷新与排障导航事件（APP_REFRESH_EVENT, FAULT_NAVIGATE_EVENT），保持各页解耦。
quick-actions.tsx / quick-setup.css: 按需挂载的快速配置页，展示六环境卡片与新增「系统与缓存排障」导流卡片（定位身份页残留工具，不自动扫描清理）；具体分区错误/原生原因、手动重试入口；不直接清理、轮换指纹、启动浏览器或修改系统。
claude-residue-panel.tsx: 身份页内带「切号已自动清理」状态徽章的固定 Claude 文件按需扫描、环境变量覆盖凭据顶层告警横幅（ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_OAUTH_TOKEN）、动态风险分级提示条与场景预设快捷按钮（仅选安全缓存 vs 选入异常登录项）、路径/字段名/大小/影响预览；仅完整缓存默认勾选，登录/历史/备份独立选择，不完整项禁选。直接清理使用默认取消的 Alert 与勾选确认，成功/失败均复查且清空选择；不访问钥匙串、通用配置或浏览器资料。扫描提示折叠复用 Cromma Disclosure。
cleaner-activity.tsx: 单次调用隔离的 ActivityController 与身份卡片正下方 IdentityOperationProgress；身份/空身份/残留清理共用真实事件阶段、局部 n/N 与脉冲，不预填步骤或按时间推算百分比，未知总量只显示运行。失败/回滚/完成带警告分开呈现，保留实际耗时和原始日志用于即时切换语言；其他页面沿用 CleanupActivity。
cleaner-model.ts: 文件残留快照类型与选择规则、POSIX/Windows 路径父子去重、子项排除、重扫编号映射与规模格式化，供预览和执行共享。
cleaner-model.test.ts: 预设、跨平台父子选择隔离与重扫不扩大选择的回归，不调用清理命令。
system.tsx: 时区/语言并排的等宽圆角卡片，状态徽章随标题布局，目标选择小标题、下拉框与操作按钮合并为单行紧凑横排；定位为下方全宽横条，内容窄于572px时卡片堆叠。当前观测与目标草稿分离，未知定位不显示关闭，保留平台判断、授权、错误和任务锁。
index.css: 系统字体与明确的 Microsoft YaHei UI 中文回退、中性黑白基础主题入口及共享控件扫描；Landing 的几何与纹理归 style.css。
locales/: 双语 YAML 目录及导入类型，包含使用说明页的操作、安全和账号风险文案、软件设置页文案、智能环境托管文案、新账号 3 步添加指引文案以及 iKuuu + Kookeey 链式代理配置指南文案；见其 CLAUDE.md。
i18n.ts: 共享界面语言订阅与文案格式化；优先精确键，动态原生结果按最具体模板匹配，未知诊断保留原文；切换语言保留 Claude-Local 主窗口标题，伴生核验页标题独立。
i18n.test.ts: 双语键/插槽一致性、界面文案覆盖、原生错误与语言切换回归；不访问真实设置。
local-edition.tsx: 侧栏只读本机版本号徽章，保留无障碍分组语义，不发起网络请求或更新检查，不参与任务锁。
language-switch.tsx: 侧栏底部 CN / EN 分段单选（Cromma SegmentedControl，radio 语义）；宿主原子持久化成功后更新界面，失败保留原偏好并显示错误。
dialog.tsx: Radix Dialog/AlertDialog 受控模态，警告阻止遮罩误关闭且默认聚焦取消；无 Trigger 时的原焦点恢复与读屏标题/描述，ModalShell 关闭按钮支持当前语言、底部操作自动换行。
settings.tsx: 独立「软件设置」页；对齐 Cockpit Tools 顶栏左标题 + 居中悬浮胶囊 Tabs（通用 / 外观与布局 / 数据管理 / 关于）且四分页正交解耦：通用（备份与资料目录摘要卡 + 语言/默认页/额度口径/隐私打码/数据目录快捷操作）、外观与布局（一键主题预设、应用主题、6 色主题强调色、表面玻璃化风格、5 款背景氛围壁纸、减少动画、字体与排版库实时预览 + 侧栏与工作区布局）、数据管理（独立资料与保险库目录 + 加密身份备份表单 + 界面偏好重置）与关于（只读版本信息与三张架构规格卡片）。本地版不联网检查更新，不提供无实际作用的更新通道、启动检查或默认终端选项。
backup-panel.tsx / backup-panel.css: 软件设置的数据管理页内提供加密身份备份、只读预检、明确选择的救援证据副本、口令与完整性检查，以及创建新隔离恢复副本；固定显示备份范围和诊断标记，不接受覆盖已有文件，原身份库不会被恢复流程替换。
settings-model.ts / settings-model.test.ts: 纯前端响应式视图偏好存储与消毒层（只保留有界面消费者的选项，旧版无效键读取即丢弃），同步根元素 .dark 类与 data-theme-mode / data-accent / data-sidebar / data-surface / data-backdrop / data-font / data-mono-font / data-reduce-motion / data-ui-scale 属性及 --glass-blur / --glass-opacity / --wallpaper-dim 光学毛玻璃 CSS 变量、页面缩放、一键主题预设（applyThemePreset）与 View Transitions 平滑切换辅助（startSmoothTransition）；不保存凭据或个人路径。
wallpaper-store.ts / wallpaper-store.test.ts: 纯前端自定义本地壁纸引擎；在内存中通过 Canvas 将本地图片降采样压缩为高清 WebP/JPEG Data URI，利用感知色距提取壁纸主色调映射至 6 套 AccentTone（rgbToSuggestedAccent / sampleRgbaBufferForAccent），同步根元素 --custom-wallpaper-image 变量且绝不记录任何本地文件路径与文件名。
floating-monitor.tsx / floating-monitor-model.ts / floating-monitor-model.test.ts / floating-monitor.css: 独立可开关无边框置顶固定尺寸「实时额度悬浮监控窗」（?window=monitor）与纯模型计算；100% 本地只读遥测（3s 活跃 / 12s 待机自适应节奏，零后台 OAuth 请求），参考 Token Monitor 采用 5h/7d 双列并排紧凑进度条、7d 消耗步调刻度、羽毛渐变分割线、活跃会话 200k 上下文微表与双宫格用量/速率磁贴，窗口尺寸恒定且禁止双击全屏，并通过 BroadcastChannel 与主窗口实时同步外观、玻璃参数与隐私打码状态。
usage-statistics.tsx: CPAMP 分析层次适配的本地用量工作台；集中时间（今天/昨天/近7天/近30天/全部）/账号筛选与重置、默认自动归属未绑定历史用量、四张统一指标卡、趋势均值/峰值/活跃时段数、图表/数据切换、模型家族标签（Opus/Sonnet/Fable/Haiku）/响应/占比/Effort推理档位（max/xhigh/high/medium/low）分布、单次均值/缓存命中底栏与账号明细。可见页面读取完成后等待30秒刷新，隐藏暂停、返回重读、卸载清理，同筛选错误保留旧数据；不更改 Python 配额采集或轮询 OAuth。时段与图表/数据切换使用 Cromma Tabs，统计口径说明使用 Disclosure，重置筛选使用 Button。
usage-trend.tsx / usage-statistics.css: 紧凑总Token SVG与响应式趋势/模型双栏；按真实小时区间呈现23/25小时和偏移标签，旧无区间快照兼容24槽，未来留空；键盘/指针精确值、筛选保护旧悬停索引，保持全页无横溢。
usage-table.tsx: 本地时段明细视图；仅已发生时段，时间/总Token/响应数排序、每页10行、精确值与可聚焦局部横滚；切换视图、排序和翻页不发起IPC，刷新保留有效页码。
usage-model.ts / usage-model.test.ts: 脱敏 Token 聚合契约、K/M/B 与精确值、缓存命中率；小时/自然日与完整历史补零、剔除未来的均值/峰值及合成测试；不读取身份配置或会话文件。
usage-export.ts / usage-export.test.ts: 当前可见汇总及已发生区间的TSV纯格式化、隐私范围别名与公式注入/单元格转义防护，不导出隐藏桶/独立推理/未来槽或任何原始记录；复制/下载不额外发起统计查询。
style.css: 双主题、六色强调色、亚克力毛玻璃表面与五款弥散壁纸、四套正文字体与三套等宽字体栈、View Transitions 平滑过渡、物理按压微反馈（:active scale(0.97)）、192px经典与72px紧凑自适应侧栏及统一54px页头/20px页边距；身份库窄于600px时添加账号引导按容器换行，步骤不藏入横向滚动。保留180×286工牌与当前顶部绿光，名称/邮箱/双额度/订阅固定行高，额度中性底色、进度条和百分比承载状态色，正文/日期/倒计时同族12px且数字等宽。电脑页并排圆角卡片、紧凑定位行与按容器宽度换行；统一28px普通按钮、网络页按文字占宽的复制按钮与轻量反馈、软件设置卡片、CC Switch分段选择器、窗口适配及Cromma模态。分段、页签、开关与折叠区皮肤归 Cromma UI，本文件只保留其布局类；「减少动画」同时把 Cromma --motion-* 归零。
quick-actions.tsx / quick-setup.css: 按需挂载的快速配置页，身份、浏览器、电脑和 CLI 各自完成即展示；具体分区错误/原生原因、手动重试及六个配置入口，不依赖先访问身份/浏览页。共用有效浏览器目标、页面图标、Button 加载/尺寸、设置卡片与主题错误色；按内容宽度自适应，不直接清理、轮换指纹、启动浏览器或修改系统。
vps.tsx: 固定分发网络配置页；iKuuu/Kookeey只显示服务标题与说明，不把URL/邀请码放入可见文本或提示属性。两家按钮固定「复制链接」，Agent入口固定「复制提示词」；勾图标/独立状态反馈成功，原生与浏览器复制均失败时提示重试。固定链接随构建内置且忽略旧覆盖，无编辑/自动导航。精简双语提示词只含链路目标、现状备份、按版本配置、回环直连与验证/回滚方法；不预置完整脚本或参数。四域名诊断仍单独手动触发。
Linux 呈现边界：设备平台由原生快照提供；未知定位不显示关闭；系统授权提示不固定 macOS；本地版不挂载自动更新器，侧栏显示本机版本。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

Usage filters use a label-sized 28px All/account selector with a 220px bound for long names; private workstation setup seeds a stable native fallback ID; distributed frontend assets contain no account selector seed. Redundant scope/live/history copy is removed.
