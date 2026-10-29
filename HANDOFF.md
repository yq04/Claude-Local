<!--
[INPUT]: Verified v0.2.2 release/CI/local installation, latest owner UI choices, implemented usage fixes and retained engineering boundaries.
[OUTPUT]: Context-free handoff covering task, completed work, blockers, next actions and pitfalls.
[POS]: Root maintenance handoff; account details, diagnostics, probes, repair receipts and machine paths stay in ignored .local/.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only changes do not rebuild binaries, replace release assets or move tags.
-->
# Claude-Local 新会话交接文档（v0.2.2）

更新时间：2026-10-29（America/New_York）。

**先读结论：v0.2.2 已完成开发、验证、打包、上传和正式发布，是 GitHub Latest；本机也已更新至 0.2.2。没有研发或发布阻塞。当前任务仅为整理这份会话交接，后续等待用户新需求，不要重复修复数据、重打包或重发同一版本。**

新会话先读本文、根目录 `AGENTS.md` 和 `CLAUDE.md`；修改模块前再读对应目录 `CLAUDE.md` 与源码头部。本文只记录可公开的工程信息，不记录真实账号、个人用量、机器身份或私有修复范围。

## 1. 我们在做什么任务

### 项目定位与架构

Claude-Local 是基于 [CCBaga](https://github.com/liseami/CCBaga) 二次开发、独立维护的 Windows 10/11 x64 桌面工作台，非 Anthropic 或 CCBaga 官方发行。主要功能为多身份加密管理、被动额度观测、自动续杯、Token 用量分析、隔离伴侣浏览器和桌面悬浮监控窗。

- Tauri 2 / Rust：原生命令、身份事务、进程检查、浏览器、系统操作和独立 Token 账本。
- React 19 / TypeScript：主工作台、分析页、悬浮窗；维护中英文 YAML 两套目录。
- Python 3.10+ / cryptography：外部额度账本及相关网页元数据的唯一写入者。**Token 统计 SQLite 与 Python 额度账本是不同的数据通道。**
- 产品二进制 `claude-local.exe`；Bundle ID `ai.local.claude-local`；伴侣浏览器注册名 `Claude-Local-Browser`。
- 用户数据在 `%APPDATA%\ai.local.claude-local`，默认安装在 `%LOCALAPPDATA%\Programs\Claude-Local`。普通启动不自动启动伴侣浏览器。

不接入上游应用同步或外部自动更新端点。保留原 MIT 版权和全部第三方 notices；“独立维护”不等于全仓原创或解决了全部第三方许可问题。

### 本会话任务链

1. 调查“新账号登录后直接使用 CLI、没有先切出去再切回来，Token 没计入该账号”。
2. 经用户确认历史范围后，完成有备份、精确限定记录集合的历史补计；再修复新登录统计绑定。
3. 比较 CLI `/stats` 与软件总量差异；保证本产品计数有源记录依据，不修改 CLI 统计缓存。
4. 优化用量页与小窗：突出 Token 构成、缓存命中、会话/活跃日、模型和近期消耗；移除美元猜价及缺少依据的推算。
5. 用户最终要求简化界面，移除历史默认规则和“未归属”等内部概念的展示，然后打包、上传并正式发布 **v0.2.2**。
6. 现在整理会话交接。上述产品与发布任务已经完成。

**用户最终界面要求是当前产品约束：账号下拉只显示“全部”和动态正常账号；不要恢复历史兜底横幅、“未归属”提示、特殊筛选项或特殊明细行。** 隐藏内部状态不意味着删除底层事件或强制归属。

## 2. 已经完成了什么

### 2.1 统计可靠性与历史维护

已定位旧缺口：身份卡只要读到登录资料就能出现，而旧 Token 归属主要依赖保存/切换提交的时间边界。新登录直接使用可能留在未知区间；旧全局 fallback 又把这些记录显示给之前的默认账号。

已完成：

- 在独立 usage 账本登记统计身份，按现有账号/组织 HMAC 关联，不伪造身份归档、不重生成密钥。
- 主窗口摘要读取接入轻量观察；显式“新身份”流程产生独立的受控 empty 登录回执，可支持新账号接力旧会话的新响应。
- 没有受控回执的普通外部登录变化，仅接受足够的新会话证据；不能凭当前配置猜测旧会话归属。
- 修复同账号切换快捷路径遗漏的统计 hook，并避免重复提交相同边界。
- 旧 fallback 首次冻结历史截止时间；未来无法确认的记录不再静默流入旧账号。
- “全部”包含所有有效事件，包括空 owner 或无法映射旧 owner 的记录；四类 Token 总量守恒。账号明细之和可能小于“全部”，这是证据边界，不能为凑齐明细而造归属。
- 用显式 `sessionId` 的域隔离哈希计算会话；parser v2 重读旧游标补证据，不自动改变既有事件 owner。
- 修复同一强请求标识的主会话与 sidechain 回放优先顺序，保留按请求去重与累计值合并。
- 用户确认过的历史区间已经补计并校验；其他记录及全局 Token 数值保持不变，私有备份和回滚凭据留在忽略的 `.local/`。**无需新会话再次执行补计或改全局 fallback。**

CLI 数值对照采用独立 JSONL 数值投影：已有请求与软件账本的四类计数一致；原始重复行累加、请求去重和 CLI 累计缓存不是同一口径。未发现足以证明“账号接力使软件漏算一半”的证据，也没有据截图直接判定 CLI 算错。CLI 的 `stats-cache.json` 未修改，真实聊天正文不进入产品账本或公开材料。

### 2.2 用量页和额度小窗

当前用量页：

- 总 Token 与未缓存输入、输出、缓存写入、缓存读取四类构成；总量不额外重复加 reasoning。
- 缓存命中、具备证据的会话数/活跃日、去重响应和单次均值。
- 全部模型及 Effort 分布、Token 占比和模型缓存命中；时间/普通账号筛选、IANA/DST、趋势/数据视图与范围内 TSV 保留。
- 移除 API 等效美元、缓存节省金额；只保留“全部”和正常账号选项，隐藏内部归属提示。
- 会话证据不足时显示未知，不能以请求数或文件数补造会话。

当前 HUD：

- 与用量页共用按账号隔离的 usage 账本，删除原先独立扫描全部账号近 5 小时日志的路径。
- 当前账号 HMAC 不一致、证据不足或账本失败时不借用上一账号/全库/fallback 的数据；未知不显示成真实零。
- 展示四类构成、缓存命中、最近有记录的模型、滚动近 5 小时 Token/响应，以及近 10 分钟固定窗口的 `tok/m`。
- **滚动 5 小时 Token 与服务端配额重置窗口不同；`tok/m` 含缓存，是近 10 分钟平均消耗，不是生成速度、输出 tok/s 或 TTFT。**
- 移除假定上下文容量和没有充分时间序列依据的耗尽预测。
- 保留 5h/7d 额度来源、重置倒计时，以及 `340×258` 展开、`340×152` 紧凑、`52×138` 胶囊、置顶、锁定、磁吸、自动隐藏、透明度、主题/壁纸同步。

配额读取仍保留原有 `profile` 估算机制；共享 Token 账本不等于删除了所有配额相关 JSONL 读取。

### 2.3 当前版本、源码和交付证据

- 仓库：[yq04/Claude-Local](https://github.com/yq04/Claude-Local)。
- 当前正式版：[v0.2.2 / Latest](https://github.com/yq04/Claude-Local/releases/tag/v0.2.2)，`draft=false`、`prerelease=false`。
- 产品标签 `v0.2.2` 指向 `13dd440ae448bd2c2fd0d52b069c14210fea3427`（含身份卡片 `PRO`/`MAX` 右侧 `MM/DD` 订阅到期显示与 `manual_subscriptions.json` 手动充值补录、「风控验证」跨域出口与手机同住宅出口 KYC 桥接、统计身份归属及共享账本 HUD）。
- 公开版本序列是 `0.1.0–0.1.5 → 0.2.0 → 0.2.2`。`0.2.1` 只是本机维护候选，从未单独公开发行；早期同号工程文档不能当作另一条公开版本线。

发行资产：

- [Claude-Local_0.2.2_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.2.2/Claude-Local_0.2.2_x64-setup.exe)，`140,697,822` 字节，约 `134.18 MiB`。
- SHA256：`981b26f6cec183cabf58baefe8bb8184a4d9d647eb30cc65570dd3e111838617`，已与 GitHub 服务端 digest 核对。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.2/SHA256SUMS.txt)。
- 中性路径、锁定依赖、固定浏览器、`custom-protocol` 构建；NSIS 只读解包核对 `108` 个文件，`17` 项外置隐私探针无发现。仅上传安装包与校验和，没有上传账号、账本、配置、探针或真实截图。
- 本机已使用有备份的文件部署热更新至最新 `0.2.2`，仅重启 GUI；维护期间原 CLI 进程与启动时间保持不变。未执行真实安装器向导。
- 已安装的未打包宿主 SHA256：`ef4bb6d06ed22c6a32e3341cd43a521dc938600d054bbce91c915d3598e369d9`。
- NSIS 内宿主 SHA256：`5d291cb92df757f437c75654ca9e374a80180d03f6ce7630e0cd1f4bf0256322`。差异是已审计的 Tauri bundle sentinel `UNK → NSS` 三字节变化，不能把二者直接比对后误报篡改。

### 2.4 验证和公开文档

[Windows CI 40818011121](https://github.com/yq04/Claude-Local/actions/runs/40818011121) 在产品源码提交全部通过，包含前端、原生、资源、隔离 Python 和 Windows fixtures。

相关本地验证已完成：usage 原生定向测试、HUD 原生/模型测试、受影响的 Bun/i18n/导出测试、生产构建；最终用量页 `12` 项检查/`8` 组中英主题尺寸，小窗 `12` 组布局均通过。无需仅为接手或文档更新重复运行全库测试。

优先阅读：

- `docs/RELEASE_NOTES_0.2.2_USAGE.md`：当前正式版双语发布说明。
- `docs/RELEASE_VERIFICATION_0.2.2_USAGE.md`：源码、CI、包审计、服务端摘要、本机更新与验收边界。
- `docs/USAGE_RELIABILITY_0.2.1.md`：未公开维护候选的工程过程，部分界面已被 0.2.2 简化。
- `README.md` / `README_EN.md`：下载、当前功能与来源；用量页采用 `docs/screenshots/0.2.2/` 的两张完整 `1280×900` 合成遮罩图，其他页面保留标注版本的旧图。
- `NOTICE.md`、`docs/DISTRIBUTION.md`、`docs/RELEASE_POLICY.md`：第三方边界、审计构建与不可变发布约定。

## 3. 当前卡在哪

**没有当前研发、构建、部署、CI、上传或发布阻塞。用户要求的功能修改和 v0.2.2 交付全部完成。**

以下是保留的工程边界，不是未完成的本轮任务；不要未经新指令主动扩展：

- 无充分登录/会话证据的历史或并发外部会话无法可靠归属；维持原始证据，不依据显示名、邮箱或当前账号推认。
- 缺少显式 sessionId 时，不保证完整会话/活跃统计；解析有既定行大小/目录深度限制，游标采样不能证明任意中段改写从未发生。不能宣称所有可能日志都绝对可恢复。
- 未在个人开发机运行 NSIS 安装/升级/卸载全生命周期；该验收和系统设置变更测试应在一次性 Windows 环境完成。
- `vendor/cromma-ui`、Pika 子集及 Chromium 全量 credits 的既有独立许可核对边界仍在 NOTICE/分发说明中，不把顶层 MIT 当作全部组件授权。
- 手动 `share-windows.yml` 保留私有仓库门禁，公开仓库默认跳过；`checks.yml` 正常，正式包使用本地审计构建。
- 单账号便携包与跨平台发行不是当前交付内容。

## 4. 下一步计划

1. **等待用户新需求或新反馈。** 新会话不应重跑历史补计、恢复已移除的界面、重建 v0.2.2、重传旧资产或移动已发布标签。
2. 接手先只读核实 Git/版本/相关状态，保留 `AGENTS.md`。这份 HANDOFF 的本地修改可以按用户后续要求另作纯文档提交；没有必须立即提交或发布的遗留。
3. 有新功能时先定位模块、读目录说明/头注释，同步中英文和地图，运行与改动匹配的合成测试；通过即止。优先入口：
   - `src-tauri/src/identities/usage.rs`：解析、去重、游标、统计、边界、共享 HUD 查询。
   - `usage_attribution.rs`：usage registry、受控登录回执、会话证据、历史截止；`usage_reliability_tests.rs` / `usage_tests.rs`：合成回归。
   - `identities/mod.rs` / `store.rs`：观察接线、受控 empty、保存/切换生命周期。
   - `src/usage-statistics.tsx`、`usage-model.ts`、`usage-export.ts` 及 CSS/双语目录。
   - `src/floating-monitor*` / `src-tauri/src/monitor_window.rs`：小窗表现与共享遥测。
4. 定向验证按需要选择，不是每次全部执行：
   - `bun test src/usage-model.test.ts src/usage-export.test.ts src/i18n.test.ts`
   - `cargo test --locked --manifest-path src-tauri/Cargo.toml --bin claude-local identities::usage -- --test-threads=1`
   - `node scripts/test-usage-statistics.mjs .local/preview/usage --usage-reliability-only`
   - `node scripts/test-local-shell.mjs .local/preview/monitor --monitor-only`
5. 只有新的发行需求才递增版本并重新打包。走 `scripts/build-windows-share.ps1` 的全新中性目录与解包审计；可显式传本机现有 7z。不得把当前安装目录当作发布源，不把真实资料带入构建。
6. 公开发布前准备可核对的源码、包、校验和、双语说明及合成预览；只操作明确的新标签/资产。文档后续提交可以在产品标签之后，不影响不可变产品包。

## 5. 踩过的坑绝对不要再踩

1. **保留本地规则与共享工作区。** `M AGENTS.md` 是用户预存改动，不能提交、还原或清掉；不用 stash/reset/restore/clean 清场，不做递归 worktree 删除。默认终端是 `pwsh`，不用 Windows PowerShell 5.1。
2. **维护时绝不停止 Claude CLI 或浏览器。** 只在明确部署时精确备份、停止/重启 `claude-local.exe` GUI，并核对 CLI 前后进程证据。测试仅用合成数据、临时上下文，不调用真实身份切换/清理/授权。
3. **“保存备份”不是无干扰补归属按钮。** 当前 UI 的该流程会先调用 `identities_stop`；不能建议用户在 CLI 运行期间点它绕过统计问题。身份卡出现不等于已归档，归档也不能代替独立统计登记。
4. **普通 NULL gap 不是受控 empty 登录回执。** 不能根据 `.claude.json` mtime、旧组织/邮箱标记或当前账号给所有旧会话无条件追加全局归属。已有事件 upsert 保留 owner，后来加边界/刷新/切回来不会自动补历史。
5. **不要全局改 fallback 来补一个历史区间。** 这会改变其他历史展示。精确修复需用户确认、唯一账号证据、冻结集合/计数、SQLite 一致性备份、原子事务及回滚；本轮已完成，不要重复执行。
6. **不要恢复用户明确删掉的界面。** “历史兜底规则”“未归属”相关横幅、下拉、明细行均已按要求移除。后台兼容字段可以保留，但不能为追求明细求和而丢掉“全部”中的有效记录或伪造归属。
7. **不要再把美元或猜测性能当真实指标。** 当前不用 API 猜价；HUD `tok/m` 不是生成速度，滚动 5h Token 不是官方配额计费窗口。缺证据显示未知，不造上下文容量、TTFT、输出 tok/s 或耗尽时间。
8. **额度账本与 Token 账本不能混写。** Python 是外部额度账本单写者；不写 `.claude.json`，不新增后台 OAuth 轮询。Rust usage SQLite 可写数值/哈希证据，但不得把聊天正文、凭据或真实路径存进去。
9. **保持持久格式与自动续杯契约。** 不更改 `BAGAID01`、`.baga` 编码、身份 SQLite `user_version=3`、账号 HMAC、主密钥或 legacy 浏览器种子域。网页恢复不等于 CLI/messages 授权恢复；续杯成功须有新鲜未来 `new_5h_confirmed` 窗口。
10. **产品标签不可移动，禁止 `git push --tags`。** 本地保留早期工程标签，批量推送会把它们重新公开；只推明确新标签。纯文档更新不重编译、不替换公开资产、不改变 SHA；注意未打包/NSIS 宿主有已知 sentinel 差异。
11. **不泄漏资料到源码、包或图片。** 不读取/展示凭据，不把账号别名、邮箱、真实 UUID、代理、机器路径、私有回执写进可提交文档。公开图只用合成 IPC、保留域名、遮罩并检查 PNG 元数据；用户截图绝不直接入库。
12. **兼容浏览器与窄窗。** 合成切换测试显式 `skipBrowserLaunch: true`；联动开启后真实切换会启动/重开浏览器。UI 需检查中英与主窗/HUD固定尺寸，保持未知检测不被误报为通过。
13. **避开工具配对和 PowerShell 参数坑。** `functions.exec` 内绝不调用 `notify` 或 `yield_control`；进度在外部 commentary 发。PowerShell 中引用含花括号的 Git revision，例如 `git rev-parse 'v0.2.2^{}'`；不把未定义 session ID 写入工具 store，也不要因工具包装错误重复已成功的提交/发布。
14. **HANDOFF 重写先备份和校验。** 本次改写前的旧版 SHA256 为 `e4c45aff5402c5f7e585dfd7ea52f4e0e7f96567470b406a1cdb739ded5c8fa3`；备份与清单位于忽略的 `.local/tasks/20261029-session-handoff-20261029T054136655Z/`，仅供本地恢复。
