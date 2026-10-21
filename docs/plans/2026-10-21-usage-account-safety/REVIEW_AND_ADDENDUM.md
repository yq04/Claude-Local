<!--
[INPUT]: README.md / FINDINGS.md (S01-S12, O1-O4) / IMPLEMENTATION_PLAN.md (阶段 0-5) / QUOTA_AND_NAVIGATION.md (Q01-Q03), 0.1.3 / 17779ea sources, five owner-supplied X posts and fetched Anthropic legal pages.
[OUTPUT]: Independent verification of the existing plan's key claims, three uncovered gaps (device-identifier reset removal, session export/import, quota-hook provisioning), two implementation risks, and a pre-open-source checklist; no code change.
[POS]: Review addendum to the pending plan; everything here is proposal only and no behavior, test or release is claimed.
[PROTOCOL]: Fold accepted items into README/FINDINGS/IMPLEMENTATION_PLAN by their owner; do not implement before the running implementation batch merges.
-->
# 计划审查与增补建议

日期：2026-10-21。基线：0.1.3 / `17779ea`。审查对象是同一目录下的四份文档。

方法：独立读源码复核关键路径，不采信文档断言；另做了两类该计划未做的一手取证——五篇用户提供的 X 经验帖全文（存于 `.rivet/scratch/x-posts/`）与 Anthropic 官方条款原文（`consumer-terms`、`aup`）。

本文件不改代码、不改其他四份文档。是否采纳由你决定。

## 一、核验结论：现有计划的判断成立

逐条复核了三条最关键的证据链，全部与源码一致：

| 计划条目 | 我读到的源码 | 结论 |
|---|---|---|
| S01 读路径可能触发维护 | `store.rs:94-97` `Store::open` 在 `recovery` 为空且 `stopped()` 通过时执行 `let _ = identity::sanitize_cross_account_residue(&store.home)`；`mod.rs` 的 `state()` 在记录缺 `account_key` 或无额度摘要时 `cleaner.enter()` → `Store::open` | 成立。"只读页面"确实会走到写 |
| S02 保留历史≠保留原件 | `store.rs:625` 切换成功后 `let _ = identity::sanitize_cross_account_residue(...)`；`archive.rs` 的 `save_inner(reuse=true)` 在采集前调用 sanitizer | 成立 |
| Q01 额度回跳方向 | `profile.rs:689` `apply_ledger_to_summary`；`:717` 取 `updated_at_sec`；`:722` 的 `if missing_quota || ledger_sec > saved_at_ms / 1000` 决定是否用账本值覆盖摘要 | 成立。归档时间晚于账本观测时间时，账本里的耗尽值会被拒绝应用，卡片回落到归档内的旧快照 |

**这份计划可以作为实施基线，不需要大修。** 下面三块是它没有覆盖的，两条是落地时会绊住的风险。

## 二、缺口一：设备标识复位没有任何条目覆盖

推荐 A 说"停止切换/恢复中的自动会话内容转换"，覆盖的是 `sanitize_project_sessions`。**设备标识复位不走那条路**，它在另一条代码路径上，计划里 S01–S12 一条都没提到：

- `cleaner_config.rs:22-91` 的 `ACCOUNT_KEYS` 实测 68 个顶层键：`userID`(:23)、`machineID`(:24)、`anonymousId`(:25)、`oauthAccount`(:26)、`primaryApiKey`(:27)、`customApiKeyResponses`(:50)、`remoteControlMachineId`(:79) 这 7 个是身份/设备/凭据键，其余 61 个是 UI 与实验态键（`numStartups`、`firstStartTime`、`tipsHistory`、`cachedExperiment*`、`cachedStatsigGates` 等）。
- `transform` 在 `EditKind::Account` 时对这 68 个键逐个 `object.remove`。
- 桌面侧另有 `ant-did`、`ant-device-registry.json`、`.machine-id`、`sentry/scope_v3.json` 的删除。
- UI 文案直接写着「再次运行时由 Claude 重新生成本地标识」（`cleaner_targets.rs:285` 附近）。

要在公开仓库里区分的是三件事，处置各不相同：

- **真凭据**在 `.claude/.credentials.json` 的 `claudeAiOauth`、`trustedDeviceToken`（`CREDENTIAL_KEYS`，`cleaner_config.rs:15`）。切换时清掉是必须的隔离——不清就是下一个账号带着上一个账号的 token 跑。
- **账号归属元数据**在 `.claude.json` 的 `oauthAccount`（邮箱、组织、accountUuid）、`primaryApiKey`、`customApiKeyResponses`。清除它们是隐私隔离，避免下一个账号读到上一个账号的邮箱与组织。保留为可清除项。
- **设备与客户端标识**是 `machineID`、`userID`、`anonymousId`、`remoteControlMachineId`。清除它们不改善任何本地正确性，唯一效果是让服务端把同一台机器当成新设备。`ant-did`、`ant-device-registry.json`、`sentry/scope_v3.json` 同理。

建议新增一条 **S13（P0，公开分发前必须完成）**：

1. 把 `ACCOUNT_KEYS` 收缩到真实的账号/凭据键与必要的凭据缓存，移除设备标识键与纯 UI/实验态键；
2. 删除桌面 `ant-did`、`ant-device-registry.json`、`sentry scope` 三类目标；
3. 改写 `cleaner_targets.rs` 的「重新生成本地标识」文案，以及 `cleaner_identity.rs` 文件头与正文里「风控脱敏」「阻断 … 遥测」这类自述措辞。

这一条会有可见的行为变化：**切换账号后本地设备标识不再重置**。这是有意取舍，需要写进版本说明，不能静默改。另外，那 61 个 UI/实验态键（`tipsHistory`、`cachedExperiment*` 等）清除与否不影响正确性，也没有正当性理由，建议一并从清除清单移出以减少无谓写入。

依据（原文抓取，非转述）：AUP 第 126 条禁止 "Intentionally bypass or interfere with capabilities, restrictions, or guardrails established within our products"；第 122 条禁止 "create multiple accounts, to avoid detection"。Consumer Terms 要求不得 "share your Account login information ... or Account credentials"，这正说明**凭据隔离该做、设备指纹复位不该做**——两者不是一回事。

补充一点该计划 S02 没说的：`credential_org` 的改写（把旧账号的 `organizationUuid` 替换成当前组织）连"数据一致性"都算不上。代码里它只作为 `attachment` 标记被读写，没看到参与请求校验的路径，而注释自述目的是「阻断 `context_credential_org_change` 遥测」。**这一条是静态推断，我没有做真实 `--resume` 复现**——若要据此保留该判断，实施前应先补一个跨组织 resume 的合成用例，确认它在不改写时究竟报不报错。这条应当在推荐 A 里显式点名，不要和 thinking 签名剥离混在一起处理——后者是真实的 `--resume` HTTP 400 来源。

## 三、缺口二：额度可能压根没有数据源

Q01 处理的是"已有观测被旧估计覆盖"。更基础的一层没人回答：**仓库里没有任何代码把 `claude_quota.py` 注册成 Claude Code 的 statusLine hook**。

- 检索 `statusLine` 的全部出现位置：**注册动作零命中**——没有任何代码向 `.claude/settings.json` 写入 `statusLine`。字样只出现在处理侧与说明里：`claude_quota.py` 5 处（`--statusline` 入口、docstring、看板标题等）、`SECURITY.md:11`、`profile.rs` 一行注释、`settings.tsx` 一句文案。
- `claude_quota.py:869` 的 docstring 写的是"Passive statusLine hook invoked by Claude Code after every turn"，即它假定自己已被外部配置成 hook。

也就是说：用户装完这个产品，如果没有手工改 `~/.claude/settings.json`，`rate_limits` 永远进不来，`quota_ledger.json` 里只有估算值。卡片上显示的数字不是观测，是推算——而界面没有任何地方告诉用户这件事。

S05 说"没有可信采集时间就显示未知"，但没回答"为什么一直没有采集时间"。

建议新增 **S14（P1）**：设置页给出"额度采集接入状态"三态——已接入且最近观测于 X、未接入、配置存在但路径失效。未接入时提供写入 `statusLine` 配置的动作，要求：用户显式确认、只改 `statusLine` 一个键、复用 `private::` 写入层、可一键撤销、不动其他键。不做任何自动轮询或后台刷新。

这一条同时是"本该发声的东西安静了"的典型案例：产品自称能看额度，却把"数据从哪来"留在文档之外。

## 四、缺口三：会话迁移（用户明确诉求，计划未覆盖）

用户第一轮的原话里有"会话共享"。现有实现只有两种粒度：整体删除（`cleaner_targets.rs` 的 history 组）与整棵目录进 `.baga`（需 `policy.history=false`）。没有"选择若干会话导出/导入"的通道。

建议独立成一个阶段，不要并进阶段 1——阶段 1 要改的是"历史原样保留"的行为，两件事搅在一起会让回归范围失控。

设计要点：

- 只读枚举 `.claude/projects/<project>/<session>.jsonl` 与 `<session>/subagents/*.jsonl`；
- 导出为独立加密包，复用 `codec` 的 AES-256-GCM 分帧实现但使用**新魔数**，不复用 `BAGAID01`，避免与身份归档混淆；
- 导入只做"补缺失"，不覆盖已存在文件，与 `merge_kept_history` 语义一致；
- 包内绝不含 `.credentials.json` 与 `.claude.json` 的账号段；导出前展示将包含的会话数、项目名与总字节数；
- UI 文案必须写清：这是**搬你自己的对话数据**，不是账号共享。两者在 Anthropic 条款下性质完全不同。

## 五、两条落地风险

### 5.1 `Policy::projects` 的命名与作用域错位

`Policy::keeps()` 的 match 分支只有 `skills / plugins / mcp / settings / history / cache`，`projects` 落到 `_ => false`。而 `policy.projects` 实际控制的是 `.claude.json` 里的 `projects` 与 `githubRepoPaths` **键**；`.claude/projects` **目录**由 `policy.history` 控制。

实施阶段 1 时若按字段名理解，会以为关掉 projects 就不动会话目录。建议在阶段 1 显式加内部断言或具名常量，把这两个语义分开；对外布尔语义保持不变，避免已有用户的选项被静默重置。

### 5.2 失败回滚被进程门控

`store.rs` 的回滚分支是 `if self.stopped().is_ok() { ...rollback... }`。回滚前若检测到 Claude 进程在跑，**直接放弃**，返回「原身份已暂存，请使用恢复操作」。

阶段 3 的失败矩阵应当单独覆盖这个分支：这是"已经 clear 了一半、回滚又被跳过"的最坏状态。建议区分两类放弃原因——检测到进程（给出可执行的指引：关闭哪个 PID，然后重试恢复）与 IO 失败（仍应尝试恢复），不要让两种情况共用同一句提示。

## 六、对现有计划的微调建议

1. **S09 的跨进程锁**：不必再做"是否可以交错"的可行性实验来判断"有没有锁"——两轮检索都是零命中：`flock|LockFile|fs2::|fd_lock|lock_exclusive|portalocker` 无结果，`CreateMutexW|OpenMutexW|WaitForSingleObject|LockFileEx|CreateSemaphore` 也无结果。唯一的 `CreateFileW` 出现在 `private.rs` 的私有文件创建辅助函数里（`GENERIC_READ|GENERIC_WRITE` + `FILE_SHARE_READ` + `CREATE_NEW`，创建时限制共享模式随后设 ACL），句柄不长期持有，不是锁。现有保护只有进程内 `Cleaner{active: AtomicBool}` 与 Tauri 单实例插件。可以省掉一轮实验直接进设计；实验的意义只剩"交错后实际损失多大"。
2. **Q01 的测试基线**：建议先写一条能稳定复现"归档时间晚于观测时间导致耗尽值被估计覆盖"的失败用例，再动 `profile.rs` 与 `claude_quota.py`。否则修完之后无法证明修的是那个现象。
3. **阶段 5**：安装器真实验证依赖一次性环境。若环境短时间内不可得，建议把 S10 明确标成"未执行"并冻结，不要用本机替换去替代——两者验证的不是同一件事。

## 七、开源前检查清单（计划未覆盖）

- 两个同类参考项目的许可已一手核实：`farion1231/cc-switch` 为 **MIT**（147,196 star，Rust + Tauri）；`realiti4/claude-swap` 为 **MIT**（3,750 star，Python）。均为 GitHub API 直接读取，不是聚合站转述。MIT 与本项目兼容，可参考架构思路。
- 但 `claude-swap` 的仓库描述原文是 "with automatic rate-limit rotation"——**该行为不引入**，只借鉴它的"写入前持有被管理进程自身凭据锁"这一并发思路。
- 公开前需要完成：NOTICE 补齐 vendor 来源、SECURITY.md 补隐私边界并明确"不承诺防封"、README 增加"本工具不提供地区限制或用量限制的规避"声明、确认 `--help/`、`.planning/`、`.rivet/`、`.local/` 不会被带进首次公开提交。

## 八、关于用户提供的五篇经验帖

五篇看下来，方法论是一致的四类：环境伪装（时区、DNS、WebRTC、住宅 IP）、标识重置（清 `machineID`/`userID`/钥匙串以伪装新用户）、支付绕行、多号轮换（`cswap auto` 到 90% 自动换号）。

按抓到的官方原文逐条对照，后三类直接命中 AUP 第 122、124、125、126、129 条；第一类命中 Supported Regions Policy。**这些不做进产品**，理由不重复展开。

其中有两项本身是中立的、可以吸收：

- **"切换前确认没有运行中的 Claude 进程"** —— 本项目已有 `ensure_stopped()`，但存在检查与写入之间的时间窗（见 5.2）；
- **"写入前持有目标进程自己的锁"** —— 这是 `claude-swap` 值得借鉴的唯一工程点，对应 S09 的 OS 锁设计。

**本文件不包含任何节点、代理、DNS 分流或出口配置的建议，也不建议产品触碰这些层面。** 上面提到它们只是为了说明"哪些不做、为什么不做"。

## 九、本文件没有做的事

- 没有执行任何测试、构建、安装或真实账号操作。
- 没有修改产品代码，也没有修改同目录下另外四份文档。
- "全仓没有跨进程锁"是检索事实；"这构成多大风险"未评估，取决于外部进程能否绕过单实例约束。
- 安装器真实行为、服务端风控阈值、用户既有数据是否已被历史改写影响，均未验证。

## 附录 A · 官方条款原文摘录

抓取日期 2026-10-21，来源 `https://www.anthropic.com/legal/consumer-terms` 与 `https://www.anthropic.com/legal/aup`，整页正文去标签后按段落切分，未改写。

**编号说明**：下文 "AUP:122" 这类编号是我按抓取文本的段落序号编的，用于本仓库内部互相引用；它不是 Anthropic 的官方条款编号。官方条文位于 AUP 的 `Do Not Abuse Our Platform` 小节下。别人按编号去官网查会查不到，请以原文为准。

### AUP · Do Not Abuse Our Platform

- **AUP:122** — Coordinate malicious activity across multiple accounts, or create multiple accounts, to avoid detection, circumvent product guardrails, or generate identical or similar inputs that otherwise violate our Usage Policy
- **AUP:124** — Circumvent a ban through the use of a different account, such as the creation of a new account, use of an existing account, or providing access to a person or entity that was previously banned
- **AUP:125** — Access, facilitate, or provide others (including end users) with access to our products or services in violation of our Supported Regions Policy
- **AUP:126** — Intentionally bypass or interfere with capabilities, restrictions, or guardrails established within our products, including by circumvention of the account sign-up or log-in process or by instructing the model to produce harmful outputs (e.g., jailbreaking or prompt injection), without prior authorization from Anthropic
- **AUP:127** — Use stolen, fraudulent, or unauthorized payment methods, or otherwise evade payment for our services
- **AUP:129** — Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used

### Consumer Terms · Account creation and access

- You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. You also may not make your Account available to anyone else. You are responsible for all activity occurring under your Account.
- You may access and use our Services only in compliance with our Terms, including our Acceptable Use Policy, the policy governing the countries and regions Anthropic currently supports ("Supported Regions Policy"), and any guidelines or supplemental terms we may post on the Services (the "Permitted Use").

### 对照表：五篇经验帖的做法与条款

| 类别 | 具体做法 | 命中 | 结论 |
|---|---|---|---|
| 环境伪装 | 时区改台北、DNS 强制海外、禁 WebRTC、住宅 IP、指纹浏览器、断网优于直连 | Supported Regions Policy + AUP:125 | 不做 |
| 标识重置 | 清 `machineID`/`userID`/钥匙串、换号前"洗环境"、让新号像全新安装 | AUP:126 | 不做 |
| 支付绕行 | 美区 Apple ID + 礼品卡 + 找客服解除购买限制 | AUP:127 | 不做 |
| 多号轮换 | 额度到阈值自动换号（`cswap auto`）、两台机器各多个号轮用 | AUP:122 | 不做 |

### 项目侧可引用的两个中立做法

- 切换前确认没有运行中的 Claude 进程 —— 本项目已有 `ensure_stopped()`，缺的是检查与写入之间的时间窗保护（见 5.2）。
- 写入凭据前持有目标进程自己的锁 —— `claude-swap` 的唯一可借鉴工程点，对应 S09 的 OS 锁设计。

## 附录 B · 参考项目核实记录

| 项目 | 许可 | Stars | 语言 | 核实方式 |
|---|---|---|---|---|
| `farion1231/cc-switch` | MIT | 147,196 | Rust | `api.github.com/repos/farion1231/cc-switch` 直读 |
| `realiti4/claude-swap` | MIT | 3,750 | Python | `api.github.com/repos/realiti4/claude-swap` 直读 |

`claude-swap` 的仓库描述原文含 "automatic rate-limit rotation"——**该行为不引入**，只借鉴凭据锁的并发思路。两者均为 MIT，与本项目许可兼容。

> 注：本机 `web_fetch` 对 github.com / api.github.com / r.jina.ai 全部返回 fake-IP 拦截，上表数据由 `curl` 直连 GitHub API 取得。后续会话若需复核，用 `curl` 而不是 `web_fetch`。
