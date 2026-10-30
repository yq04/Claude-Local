# locales/
identity.count / warming.count和warming.step.*：对应身份卡/养号卡数量及四个短动作；卡头状态保持简短，资料选择与完整运行信息放在提示中，不用装饰性中点分隔。
browser.currentCliIdentity/currentBrowserIdentity/runtime*/returnToCli*/verificationScope与warming.browserSelected/browserRunning/browserClosed/browserUnknown: 浏览器持久选择、窗口运行与未知状态分开；仅浏览器返回的关闭窗口确认、受控失败补偿及核验范围双语同键同插槽。risk.browserOwner*显示同上下文遮罩被测浏览器，不将CLI身份和浏览器身份混同。
risk_secure_random_unavailable: 安全随机源不可用时的局部桥接停用双语提示；保留诊断与独立手动配置，不显示不安全临时口令。
risk.audit.scope / *Source / risk.check.mihomoDnsLeak.* / risk.compare.* / risk_context_*: 六项配置与HTTP出口样本的有界说明、运行核心匹配文件/候选/未知来源、独立DNS缺项和未知原因、同国与同IP区别及上下文变化丢弃回执；不把静态配置或HTTP出口推断为DNS实测泄露、绝对防护或账号可用性。
warming.cliSwitchKeepsBrowser: 普通CLI切换保留当前养号浏览器的中英文确认提示；转正/恢复沿用原关闭重开提示。
warming.*: 精简「养号」标题与无加号新建按钮、四步引导/四阶段、自然日Day N与今日打开、七项浏览器/编辑/订阅/转正/删除动作、手工表单、不可撤销删除确认、CLI进程中断转正确认与浏览器warming绑定状态；中英文同键同插槽，名称/邮箱/备注在呈现层遵循隐私遮罩。

wakeup.view.* / wakeup.localAuth.* / wakeup.wait*: 简短主状态、本地授权与服务端验证的区别和可读时分秒等待；两语同键同插槽。
quotaOnline.browserFallback.* / wakeup.gate.* / wakeup.retryIn：区分网页额度读取失败与CLI唤醒授权，受控原因、冷却倒计时和明确单次恢复；不得承诺网页登录会更新CLI凭据。
> L2 | 父级: ../CLAUDE.md
browserVerify.classification* / probeElapsed及WebRTC分阶段原始提示：同IP分类来源、限流/超时/错配等受控原因，保留地理数据；协商/收集超时与测量完成分开，不把未知改绿或暗示账号安全。
归档资源上限与备份暂存清理异常：两语同键同插槽，清理提示可附在原始失败后；成功备份的清理警告不冒充备份校验失败，不暴露暂存路径或内容。
wakeup.*: 应用运行/托盘隐藏/真正退出边界、scope变化暂停、HTTP CONNECT类型支持（不代表网络可达）、无账号探针失败、逐账号暂停/一次受控授权恢复、最近尝试与审计写入失败；两语同键同插槽，不暴露代理值或身份指纹。
zh.yaml: localEdition.* 独立产品品牌与版本信息（全量默认简体中文）；身份、浏览器联动、离线额度、清理与电脑设置文案；独立本地帮助、软件设置页（外观/主题/布局/动画/隐私/版本中心）、iKuuu + Kookeey 快捷操作与 AI 自动配置提示词文案，以及用户手动触发的 Claude 服务连通性/逐域原因说明；数值以命名插槽传入，不含业务分支。
en.yaml: 与中文同键、同插槽的独立产品和功能文案（含软件设置页与网络环境快捷配置全量英文对照）；固定域名诊断明确服务连通性与公网出口、账号可用性的区别；不得翻译配置值、路径或用户输入。
yaml.d.ts: 构建期 YAML 导入类型；解析器由 Vite 使用，运行包只有静态对象。
文件残留预览与直接清理确认双语一致；路径、配置键名和文件内容不翻译，原始进度保留至呈现时转换。
network.*: 网络页隐藏推广地址的服务说明、「复制链接 / 复制提示词」固定按钮与真实失败反馈；两语同键同插槽，地址不进入展示文案。
computer.*: 电脑页简短说明、当前值标签、自动/手动/未知状态及定位服务说明；当前系统观测与草稿选项分开呈现。
usage.* / cli.* / quick.*: 小时/完整历史用量、集中筛选、均值/峰值、图表/数据切换、列排序/分页与模型占比；未来空区、日志来源/近实时刷新/历史夏令时限制；只读快速配置、局部失败与六卡入口；手动 CLI 更新、运行阻断与错误状态的同键双语文案。保留兼容词条，不在界面显示独立推理指标。
identity.* / identityCard.*: 身份工牌本地保存名优先、原账号名的非隐私提示与重命名范围说明；独立额度区、重置时间、订阅到期和未知状态。缺失的订阅日期统一说明未提供，不混用凭据有效期。
quota.independentWindows / quota.resetInferredSource / quota.resetInferredHint / identityCard.resetInferred: 说明5h/7d独立更新，可信服务端重置时间到期后的预计恢复、其他设备用量未知与不推算下一重置；缺证据仍未知，预计值不等于官方实时额度。两语同键且工牌提示保持单行。
identityCard.noSubscriptionOrResetData / identityCard.nextRenewal / identityCard.accessUntil / identityCard.manualResetsRemaining / identityCard.reauthRequired / identityCard.moreActions / identityCard.readOnlineQuota / identityCard.syncSubscription / identityCard.foregroundAutoRefresh / quotaOnline.status.*: 在线额度状态、冷却倒计时、订阅重置脱敏及无障碍操作的双语文案，纠正本地基础每小时与前台近实时在线读取描述，消除全部离线的过时陈述。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

cli.statusUnavailable / cli.retryRead: CLI状态读取失败与缺少安装分开呈现，允许手动重试。usage.allAccounts / coverageNote: 简洁「全部」标签和本地统计覆盖说明；账号选项来自动态账号目录。

identitySearch.* / identityDiagnostic.*: 可见别名检索、视图排序、观测年龄和白名单诊断复制。commandPalette.* / handoff.*: 受控快捷键入口和纯手填交接预览/复制/下载。usage.export* / usage.timezoneNote / 固定时区错误键: 当前scope导出、真实时区与旧offset兼容；峰值称时段峰值，覆盖半小时区间。

usage.composition / sessions / activity* / modelsHint: 四类Token构成与全模型占比，去重会话和本地活跃日含义；旧快照无可信字段保持未知，无美元或生成速度推算。monitor.velocity / responses5h / latestModel / accountUsageUnavailable / localUsageScope / *Short: 共享账本当前账号已确认5h用量、四类构成、10分钟均值速率与响应数；未知账号或模型不显示伪零值。两语同键同插槽。
quick.readFailed / quick.failedChecks / quick.followsMachine: 独立读取失败、具体分区与跟随电脑配置的同键同插槽双语提示。
quotaOnline.runtimeStage.* / quotaOnline.runtimeReason.* / quotaOnline.reason.* / quotaOnline.stage.* / quotaOnline.routeMode.* / quotaOnline.status.*: P0 探针/采集运行阶段与失败原因、P1 路由模式及 route_unavailable 状态映射。
wakeup.*: 唤醒尝试与确认新5h窗口的双语反馈；明确未知结果的延迟重试、授权恢复要求及配置/状态持久化失败，不将缓存或仅7d观测表述为5h成功。
usage.attribution*: 仅保留兼容词条，当前用量页面不引用。usage.dst*: IANA 时区与 23h/25h 夏令时日历徽章双语文案。
cli.installGuide / cli.installCommand / cli.copyInstall / cli.recheck: CLI 未安装时官方 Windows 安装指引与复制、重新检查双语文案。
quick.troubleshoot* / identitySafety.troubleshootHelp: 快速配置排障卡片与使用说明缓存/残留清理入口导航提示。
浏览器联动确认文案真实说明「运行中的浏览器会自动重开，未启动则保持关闭」。
identityCard.localQuotaGuide / identityCard.localQuotaSync / identityCard.localQuotaSynced / identityCard.resetInferredRemaining / identityCard.resetInferredUsed / identityCard.resetInferredElapsed / quota.calibrateOnline / quota.weeklyPace / quota.pace* / residue.envOverrideTitle / cli.copyPath / settings.preferenceResetGroup / settings.themePresets / settings.backdrop* / settings.font* / settings.mono*: 本地与在线额度查询分级双语文案、reset_inferred 语义化重置状态与已过时长、7d 消耗步调、环境变量覆盖告警、CLI 路径复制、一键主题预设、亚克力毛玻璃与氛围壁纸、字体与排版库及设置页偏好重置分组双语文案。
risk.* / quick.risk* / help.riskLine*: 风控验证页六项电脑 DNS 泄露与 claude.ai vs withpersona.com 跨域一致性核验、五重安全隐私徽章、公网/校园网自动回退提示、四端手机防泄露同源桥接（含小火箭免传文件 4 步加固、实况文本展开、列表假超时与 http/2 核验及 KYC/日常模式切换）与 6 步真机实拍飞行清单双语同键同插槽文案。
identityCard.setSubscriptionExpiry / expiryDialog* / rechargeDateLabel / expiryDateLabel / rechargedToday / cardPreviewLabel / clearManualExpiry / expiryTooltip* / rechargedNote / editExpiryShort / invalidSubscriptionDate: 身份卡片 PRO/MAX 右侧紧凑 MM/DD 订阅到期标签、手动补充充值日自动顺延 1 个月推算到期日及自动网页订阅获取方式说明的双语同键同插槽文案。
browser.killSwitch.* / risk.strictRouteGuide.* / identities.warming.sop.* / identities.warming.mismatch* / identities.quotaPaceHint / backup.scope: 防IP泄露断路器横幅与开关、Mihomo strict-route闭环修复向导、养号四阶段防封SOP与出口国家漂移预检、用量详情抗封温和提示及包含养号/订阅元数据的保险库备份范围双语同键同插槽文案。
