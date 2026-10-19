# Claude-Local 会话交接

最后更新：2026-10-18 22:30（America/New_York）。写给完全没有旧会话上下文的维护者。先读本文件、AGENTS.md，再读相关目录的 CLAUDE.md。本机路径、部署、迁移回执和代理维护记录在被忽略的 `.local/HANDOFF.local.md`；不要把私有记录加入 Git。

## 1. 我们在做什么

用户最初要求研究 CCBaga 更新、吸收有用内容，之后明确把目标改为：**本地彻底独立发展，更名 Claude-Local，自行设计、改进和优化，使用自己的私人 GitHub 仓库，未来可能分享给他人。** 用户已授权实施、更名、独立建库和本机部署，无需重新询问是否继续独立化。

这是自己的产品；历史调研只作来源记录，后续按本地需求决定。不要恢复官方更新提醒、上游自动同步、原产品发布渠道或推广链接。沟通使用中文，当前支持 Windows x64。

当前产品为 **Claude-Local 0.1.0**；宿主 `claude-local.exe`，应用标识 `ai.local.claude-local`，资料根 `%APPDATA%/ai.local.claude-local`。可选浏览器称 **Claude-Local Browser**，Windows 注册名 `Claude-Local-Browser`。一个当前用户 NSIS 安装器包含宿主和浏览器，不再以 A/B 作为产品名。

## 2. 已完成什么

### 独立项目与产品

- 在新的源码目录独立初始化 Git；仅有自己的私有仓库 origin，无 upstream、旧 Git 历史或共享对象库。旧工作区、程序、资料和六个工作树保留，不能当作新项目部署来源。
- 新建 CL 标志、应用和浏览器图标；重写 README、开发规则、帮助、目录说明、开发和分发文档。默认进入身份管理，安全记忆已验证的页面和界面语言。
- 删除官方 updater 的前端入口、Rust 插件/依赖、权限、端点及公钥；页脚只读本地版本。没有后台检查、下载或更新重启链路。
- 删除服务商推广/返利链接、旧 VPS Skill 安装入口和对应原生命令。保留手动触发的四个固定 Claude 服务域名诊断，展示真实失败/耗时；连接对端地址不能当作出口 IP。
- 常规启动只开主应用，浏览器仅在明确操作或 `--browser` 时启动；已验证主应用启动不会额外拉起浏览器。

### 原有能力与数据

- 保留原地加密身份备份、独立浏览器槽位、账号/凭据摘要、离线额度估计与账号推荐；保留中英文界面、保护确认、事务和恢复边界。
- 已完成本机旧资料到新资料根的保留源迁移：419 个所选文件、2 个身份；哈希、SQLite、密钥、加密归档、浏览器绑定 ID/种子均验证保持。仅显式排除可再生浏览器缓存，登录和配置没有按缓存排除。详细回执在 `.local/`。
- 已部署并启动新宿主，原 Claude 会话保留。旧快捷方式移到私有备份；新宿主/浏览器代理规则按本机原规则追加并读回确认。细节见私有记录。

### 额度链路

- `scripts/claude_quota.py` 是版本化源码，已安装 statusLine 脚本与其一致；原 statusLine 命令路径保留。
- Python 是外部 `quota_ledger.json` 唯一写入者：跨进程锁、临时文件 fsync、原子替换，锁内拒绝旧锚点/旧估计，部分响应保留同账号最新未观测窗口。
- Rust `profile::read_live` 只读官方配置和外部账本，在内存合并同 UUID 较新的服务端锚点；GUI 不再回写账本。
- 外部脚本不写 `.claude.json`，不轮询 `/api/oauth/usage`；保留 Relay 的 `CLAUDE_CONFIG_DIR` 隔离，界面保持一小时或手动刷新。额度估计不等于服务端最终额度。

### 构建、仓库与分享准备

- 源码和锁文件已推送私有独立仓库。功能基线是 `b251ee83c3bd3446351eee9b4fe9ec8634d0534f`；之前两次提交为 `167780a`（独立产品）与 `37542f5`（移除继承的开发机路径）。后续文档提交的实际 HEAD 以 `git log` 为准。
- `.github/workflows/checks.yml` 做 Windows 源码检查，不下载浏览器、不注入真实登录或发布密钥。测试使用合成资料和隔离目录。
- `share-windows.yml` 仅手动运行、检查仓库私有状态、复用检查、下载固定引擎并生成私有 artifact；不创建 Release/tag/updater feed。
- 本机已经生成单个未签名 NSIS 安装包，稳定副本在 `.local/artifacts/`；**没有执行此安装器**，当前运行的是已验证的独立部署。

## 3. 已验证结果与证据范围

上一实施阶段实际运行后的会话汇总：Bun 21 项通过（4,138 个断言）；隔离身份/浏览器/网络 GUI 55 项检查通过；Rust 99 项通过、1 项手动性能测试忽略；合成 Python 额度 7 项、迁移 11 项、引擎准备 4 项通过；前端和 Windows 发布构建成功。

测试原始控制台日志没有全部归档到新项目，不能将这份汇总当作完整原始报告。迁移/资料验证有 JSON 回执；预览有 `preview-results.json`（errors 为空）和 `.local/preview/` 的虚构账号截图。没有用真实身份做切换/清理验收，没有终止 `claude.exe`。会修改系统设置的测试只允许在一次性托管 Windows runner 上执行。

截至上述更新时间，GitHub 首轮云端检查已出现一个明确失败，最新功能提交仍在运行：

- [39188980989](https://github.com/yq04/Claude-Local/actions/runs/39188980989)：`167780a`，completed/failure。前端、原生、引擎准备、额度/迁移步骤通过；`Offline Windows CLI fixtures` 运行13项、失败1项。
- `39189175146`：`37542f5`，completed/cancelled，被后续待运行提交替换；取消不等于测试失败。
- [39189428167](https://github.com/yq04/Claude-Local/actions/runs/39189428167)：`b251ee8`，in_progress，尚无结论。

失败是 `scripts/test-windows.py:230` 的 `SystemTests.test_language_format_write_retains_languages_and_restores_state`：调用 `scripts/windows-region.ps1` 时，20—22行中文字符串乱码并报 `Unexpected token 'Windows'`、字符串未终止/缺少大括号。测试明确调用 Windows PowerShell 5.1；该PS1为无BOM的UTF-8（首字节 `23 20 5b 49`）。**优先排查脚本读取编码差异，这是待验证的根因推断，尚未修复。** 原始失败日志已保存 `.local/ci/39188980989-failed.log`。不要在本机执行区域设置写入脚本来复现，可先做不执行脚本的解析检查。

这些是时间点快照，下一会话应重新查询；后续文档推送也可能生成新一轮检查。不能提前写成“GitHub CI 全绿”。

## 4. 当前卡在哪

本地独立化、真实资料迁移和日常部署已完成，没有已知的本地功能阻断，也没有等待用户授权。

尚未闭环的是三项验收：

1. 首轮云端 Windows 区域设置测试已有脚本解析失败，尚未修复；最新功能提交的检查仍待结果。参见上面的准确用例、脚本和日志。
2. NSIS 安装/升级/卸载没有在干净 Windows 环境实际测试；安装包未签名。
3. `vendor/cromma-ui` 与其 Pika 图标子集缺少独立上游许可证声明，完整 Chromium 依赖许可清单也未审完。私有仓库不等于取得再分发许可；对外分享前要核实许可/获得许可或替换相关组件。保留根 LICENSE 原版权及 NOTICE。

## 5. 下一会话按什么顺序继续

1. 确认位于独立项目根，读 AGENTS.md、`.local/HANDOFF.local.md`；查看 `git status`、`git log`、`git remote -v`，不要恢复旧仓库开发流程。
2. 查询最新 GitHub Actions，优先调查上面的 Windows PowerShell 脚本解析失败。先确认5.1与UTF-8读取的差异，做无副作用的解析/合成回归；实际系统设置测试仍只在一次性runner执行。修复后记录准确提交和成功运行链接。冷构建仍运行/排队不等于另一个失败，不无理由重复本机全套。
3. 若继续准备分享，在一次性 Windows 虚拟机/账号里验证 NSIS 安装、启动、浏览器注册、升级、卸载及数据保留，记录准确包哈希。不要在真实身份资料上做安装器实验。
4. 对外分享前完成第三方许可核查或替换，并补足浏览器许可材料；只打包固定引擎和可分发资源，不打包运行中的安装目录、真实资料或代理配置。
5. 按本地需求继续优化界面和功能。用户没有要求下一轮追赶上游，也没有设置后台监控或自动发布任务。

## 6. 必须保留的兼容边界

下列旧名称是持久格式，不能机械更名：

- `BAGAID01`、加密 `.baga` 容器及 SQLite `user_version=3`。
- 账号 HMAC 匹配规则、已存记录 ID、主密钥、浏览器槽位和绑定。
- `identities/browser_link.rs` 的字面量 `CCBaga/browser/{id}/{attempt}`：参与确定性浏览器种子派生。改名会改变已有身份指纹；已有稳定种子回归测试。

独立应用资料根不等于 Windows 用户沙箱；默认 `~/.claude` 与 `~/.claude.json` 仍是本产品管理对象。不要同时启动两个身份管理器切换同一默认工作区，不要中断现有 Claude 会话，也不要启用 Number_Pool 的 Claude 模型干扰 Relay 隔离。

## 7. 踩过的坑，不能再踩

1. **旧 HANDOFF 的阶段结论已过时。** 旧产品名、部署根、资料根、upstream remote、未提交状态、早期迁移的 1,995 文件均不是当前 Claude-Local 状态。旧 PR 和工作树仅供历史查阅，不要推错仓库、部署旧程序或用旧资料覆盖新资料。
2. **迁移目标已在使用，不要重跑覆盖。** 工具拒绝已有目标、嵌套/相对路径、链接/硬链接、运行中的源宿主/浏览器、待恢复事务和 SQLite sidecar。源和失败的私有 stage 都保留；不能为通过迁移而删除资料、接管源 ACL、忽略任意读取错误或放宽保护。
3. **浏览器缓存 ACL 不一定是锁或长路径问题。** 实际遇到 `No_Vary_Search/journal.baj` 只对 sandbox SID 可读。修复是明确的 `--exclude-browser-caches`，仅跳过已知可再生缓存；默认仍严格，Cookie/登录/偏好必须复制。回归现为 11 项，旧记录的 10 项过时。
4. **只停止目标程序。** 正常关闭经路径确认的旧专用浏览器和旧宿主，不能笼统结束 chrome，更不能结束 `claude.exe`。不要用真实身份做破坏性回归，不要执行 `git clean`、hard reset、全仓 restore 或递归删除工作树。
5. **额度不能回退到多写入者。** 不让 Rust/GUI 写账本，不让外部脚本写官方 `.claude.json`，不增加 OAuth usage 轮询或高频刷新；安装脚本、源码和实际资料根必须配套。
6. **发布构建必须带 `--features custom-protocol`。** 否则可能白屏/编译失败。固定引擎版本为 148.0.7778.215；不能改成移动 latest 地址，不能把用户 profile 当引擎打包。
7. **旧 target 只曾借作编译缓存。** 后续默认用本项目 `src-tauri/target`，不能写入旧项目绝对路径形成依赖。Tauri 打 NSIS 时会修改输出二进制 bundle 标记，部署 exe 与打包后的 exe 哈希不同可能正常；核对具体产物，不为对齐哈希覆盖运行中程序。
8. **保留精确 UI 与测试语义。** 当前身份卡片 196×312；旧文档的 198px 不是修复依据。Windows 注册回归已从旧 B 命名改为 `claude-local-browser.url`。Rustfmt 只格式化入口时，用 `skip_children=true` 防止改动无关 include 测试模块。
9. **CI 环境不能伪造到个人机器。** 不要设 `GITHUB_ACTIONS=true` 强行跑系统设置测试；Windows Known Folder 不一定服从环境变量隔离。不要拿真实账号补云端凭据。
10. **本机代理控制管道以进程参数为准。** 运行 YAML 曾残留旧 pipe，直接 reload 报 FileNotFound；细节只记私有文档，不提交代理内容或覆盖既有链式规则。
11. **源码隐私与许可分别处理。** `.local/`、运行引擎、数据库/密钥/归档/账本、安装包、真实截图和机器资料不进 Git。已清除继承的第三方开发机绝对路径；不能重新引入。原版权和第三方来源声明必须保留。
12. **PowerShell 7解析通过不能代替5.1验收。** 云端区域脚本的中文乱码解析失败暴露了读取编码差异；输出编码UTF-8不等于脚本读取编码UTF-8。排查须使用真实调用的powershell.exe版本，先只解析，不在个人机器写区域设置。
13. **部署不能只看构建成功。** `build:local` 只产宿主；部署还需要 dist 与独立引擎。部署默认目录与本机现用目录不同，维护现有部署时显式传安装目录，见私有记录。

## 8. 开发入口与必要检查

React/TypeScript 负责界面；Rust/Tauri 负责受验证的原生命令、进程检查和事务；Python 负责被动额度收集、迁移和合成测试。主要入口包括 `src/navigation.ts`、`src/vps.tsx`、`src-tauri/src/local_runtime.rs`、`scripts/claude_quota.py`、`scripts/migrate-local-data.py`、`scripts/deploy-local.ps1` 和上述工作流。

以下命令在**独立项目根目录**执行，按改动选用，不必为文档修改重跑全套：

```powershell
bun install --frozen-lockfile
python -m pip install -r scripts/requirements-ci.txt
bun test
bun run build
python scripts/test-claude-quota-local.py
python scripts/test-migrate-local-data.py
python scripts/test-fetch-browser.py
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol -- --test-threads=1
bun run test:identities
node scripts/test-local-shell.mjs .local/preview
```

无引擎时原生测试使用 docs/DEVELOPMENT.md 的公共静态资源覆盖；GUI 回归需要显式准备固定引擎。构建/部署入口是 `bun run build:local`、`bun run build:windows`、`bun run deploy:local`；部署默认到当前用户 LocalAppData 的 Programs/Claude-Local，本机另有显式安装位置。构建、部署和真实迁移不是可随意启动的测试命令。
