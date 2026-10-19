# Claude-Local

独立维护、优先适配 Windows 的 Claude 本地工作台。把身份备份、账号切换、额度观察、可选浏览器和环境诊断放在一个本机工具中。

**自己的产品、自己的版本与维护路线。** 无上游同步、官方更新提示、购买推广或外部 Skill 安装引导。当前版本为 0.1.0，支持 Windows 11 / Windows 10 x64。

## 日常使用

- **身份管理**：原地加密备份、暂存/恢复、空身份、保留策略、会话预览与保护确认。
- **额度观察**：被动接收 Claude Code statusLine 数据，结合本地记录估算 5h / 7d 使用情况；一小时或手动刷新，可推荐剩余额度较多的已保存身份。
- **可选浏览器**：Claude-Local Browser 是独立资料的配套组件，按身份绑定资料和稳定种子；宿主普通启动不打开浏览器，需要时再启动。
- **服务连通性**：手动检测四个固定 Claude 服务域名，展示实际状态、延迟与失败原因；连接对端地址不等同于出口IP。
- **本机环境**：读取并按用户选择调整时区、语言、地区及定位相关设置。

默认进入身份页，记住上次页面和界面语言。主应用 **Claude-Local** 与配套 **Claude-Local Browser** 使用一个 Windows 安装包，不再使用 A/B 产品名。

## 开发与安装

需要 Bun、Rust MSVC、Python 和 Visual Studio C++ Build Tools；完整流程见 [开发说明](docs/DEVELOPMENT.md)。

```powershell
bun install --frozen-lockfile
python -m pip install -r requirements-dev.txt
bun test
bun run build
cargo test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

浏览器引擎不进入源码仓库。只在准备浏览器/安装包时运行固定版本、校验摘要的准备工具：

```powershell
python scripts/fetch-browser.py
bun run build:windows
```

本机开发部署可使用 `bun run build:local` 与 `bun run deploy:local`。部署默认写入当前用户的 `LocalAppData/Programs/Claude-Local`，可显式指定独立目录；不写入身份资料，不调用上游安装器。

## 数据与行为边界

- 应用标识：`ai.local.claude-local`；宿主程序：`claude-local.exe`。
- 配套浏览器注册：`Claude-Local-Browser`，由宿主 `--browser` 入口启动。
- 用户资料：`%APPDATA%/ai.local.claude-local`；独立保险库、SQLite、额度账本与浏览器资料。
- 管理对象仍是当前用户默认的 Claude 工作区。这不是操作系统沙箱；请勿同时让多个身份管理程序切换或清理同一工作区。
- `.claude.json` 对额度采集器保持只读；Python 是外部额度账本唯一写入方，锁内拒绝旧锚点覆盖新数据，Rust 在内存合并最新同账号锚点。
- 本地切换/清理不删除服务端记录；需要结束 Claude 的操作保留明确确认。开发、部署和测试不得中断用户的 Claude 会话。

首次从旧版迁移时，用 `scripts/migrate-local-data.py` 显式传入源/目标。该工具拒绝目标覆盖、链接、活跃程序、SQLite日志及待恢复事务，私有复制并完整验收后才公开新目录。**源资料保留，首次迁移后不要重复覆盖。**

个人账号、归档、凭据、浏览器资料、代理配置和运行日志不会进入仓库。机器专用笔记请放到被忽略的 `.local/`。可分享构建、CI与第三方许可边界见 [分发说明](docs/DISTRIBUTION.md)。

## 验证

```powershell
bun run test:identities
python scripts/test-claude-quota-local.py
python scripts/test-migrate-local-data.py
python scripts/test-fetch-browser.py
node scripts/test-local-shell.mjs
```

测试使用虚构身份与临时目录。普通CI只检查源码，不使用个人账号、不下载引擎、不发布；安装包构建通过工作流手动触发，仅保存私有构建产物，不创建公开Release或更新源。

## 项目与许可

源码在本仓库独立演进，未关联为 GitHub fork，不依赖旧仓库远程、提交历史或发布权限。承接的 MIT 代码保留原始版权与来源归属；第三方引擎、组件和图标各自适用其许可，见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。保留格式兼容常量是为了导入现有本地资料，不代表继续同步旧项目。

Claude-Local 为社区开发的本地管理工具，与 Anthropic 无隶属关系。软件与账号应在本人授权范围内使用。
