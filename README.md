<!--
[INPUT]: Independent product source, version metadata and current owner distribution requirements.
[OUTPUT]: Product overview, build/verification entries and retained-data upgrade expectations.
[POS]: Repository introduction; published artifacts retain their own versioned release notes.
[PROTOCOL]: Keep private-data, compatibility and distribution boundaries in the linked project documents.
-->
# Claude-Local

面向 Windows x64 的 Claude 本地管理工具，集中管理身份备份、账号切换、用量分析和可选的隔离浏览器。使用 Tauri、Rust、React、TypeScript 与 Python，独立维护产品和版本。

当前源码版本：**0.1.7**。支持 Windows 10 / 11 x64；安装包包含 Claude-Local 与 Claude-Local Browser 两个入口。[本版更新](docs/RELEASE_NOTES_0.1.7.md) · [开发说明](docs/DEVELOPMENT.md) · [用量统计](docs/USAGE_STATISTICS.md) · [分发与许可边界](docs/DISTRIBUTION.md)

## 主要功能

- **身份管理**：本地加密备份与恢复、账号切换和保留策略。支持隐私安全的名称搜索、Esc清空及视图排序，当前身份固定显示，原生记录顺序不变。
- **额度观察**：被动接收 statusLine 数据，逐窗展示5h/7d额度、来源与观测年龄，支持复制白名单诊断摘要；每小时或手动读取，可信重置到期明确标注预计恢复。
- **用量分析**：查看Token、缓存、模型与账号聚合，支持图表/数据、排序分页及当前筛选TSV复制下载；按IANA时区处理历史夏令时和真实小时区间。未确认归属的记录仅按用户明确的稳定规则聚合，个人选择不随包分发。
- **快速配置**：按需独立读取身份、浏览环境、电脑环境与 CLI 状态，显示具体异常并支持手动刷新；提供六类设置入口，按“跟随电脑”规则显示浏览器配置目标。
- **网络环境**：手动检测固定 Claude 服务的连通性，复制预置 iKuuu / Kookeey 推广链接及精简配置提示词；不自动打开外部网站。
- **电脑环境**：分项展示时区、语言与定位状态，定位采用紧凑布局；系统修改由用户明确触发。
- **可选浏览器**：按身份保存隔离资料与稳定种子，仅在用户操作或 `--browser` 时启动。
- **CLI 维护**：手动检查并按原安装方式更新 Claude Code CLI；运行中的 Claude Code 会话不会被自动结束。
- **快捷操作与交接**：Ctrl+K / Cmd+K搜索页面、刷新或打开现有身份确认；提供六字段手填便笺、Markdown预览与复制/下载，草稿仅保留在本次运行内存中。

## 获取与安装

本仓库按私有开发和审阅范围维护。手动发布的测试包应附带 SHA-256、隐私审计报告、资源清单及更新说明；CI 仅执行检查和可选的私有构建产物，不自动创建 Release 或更新源。

安装包使用当前用户 NSIS 安装，按所有者决定继续保持未签名。构建与解包校验不等于安装、升级和卸载验证；第三方组件的公开分发许可仍以 [分发说明](docs/DISTRIBUTION.md) 为准。

后续安装包会在显示新版安装向导前检查已登记的旧版，先提示卸载旧程序并保留账号、保险库、额度记录、浏览器资料与设置；卸载成功后再进入新版安装。取消或卸载失败时停止升级。手工复制的未登记程序目录不会被自动扫描或删除。该流程自 0.1.3 安装包起提供，已发布的 0.1.2 安装包保持原样。

主程序：`claude-local.exe`；应用标识：`ai.local.claude-local`；浏览器注册：`Claude-Local-Browser`。主程序默认进入身份管理，正常启动不会打开浏览器。

## 从源码构建

准备 Bun、Rust MSVC、Python、Visual Studio C++ Build Tools 和 WebView2 Runtime，使用现有锁文件：

```powershell
bun install --frozen-lockfile
python -m pip install -r scripts/requirements-ci.txt
bun test src
bun run build
cargo test --locked --manifest-path src-tauri/Cargo.toml usage_tests
```

构建完整安装包还需固定版本的浏览器引擎和已有的 7-Zip：

```powershell
python scripts/fetch-browser.py
bun run build:windows
```

`build:windows` 在工作区和用户目录之外创建全新的中性 Cargo 构建目录，仅复制 crates.io 索引与归档缓存，保留原有缓存及 Rustup。正式构建启用 `custom-protocol`，完成 NSIS 只读解包、资源路径与 SHA-256 校验后，输出唯一的 `.local/artifacts/<id>/` 目录。可通过 `-BuildRoot` 指定满足相同边界的新目录，通过 `-SevenZipPath` 指定已有 7-Zip，通过 `-PrivateMarkersFile` 提供仓库之外的私密审计标记。

开发用本地编译可使用 `bun run build:local`；文件式部署默认写入当前用户的 `LocalAppData/Programs/Claude-Local`。已有安装的更新应先备份、核对进程和文件，再以可回滚方式替换；安装程序和个人资料不应成为构建输入。

## 数据边界

- 应用数据按用户存放在 `%APPDATA%/ai.local.claude-local`，包含身份库、密钥、额度／用量账本及浏览器资料，不随安装包或源码分发。
- 身份切换管理当前用户默认 Claude 工作区；独立应用目录不等于操作系统沙箱。破坏性操作保留明确确认、进程检查和回滚。
- 额度采集不轮询 OAuth 用量接口，不写入 `.claude.json`。Python 是外部额度账本的唯一写入方，用量统计使用独立账本。
- 开发、测试和本地更新不得中断运行中的 `claude.exe`；自动测试使用虚构数据和隔离环境。
- 迁移只复制到新的私有目标并校验完整性、哈希与身份数量，保留源资料。兼容现有 `.baga` 格式、账号 HMAC 和浏览器种子。

## 验证

```powershell
python scripts/browser_ui.py dist
python scripts/test-claude-quota-local.py
python scripts/test-migrate-local-data.py
python scripts/test-fetch-browser.py
python scripts/test-audit-windows-package.py
node scripts/test-local-shell.mjs
node scripts/test-usage-statistics.mjs
```

系统修改、安装／升级／卸载测试仅在临时 Windows 环境执行，不能在个人工作机上运行 CI 专用系统测试。

## 许可与归属

保留原 CCBaga 贡献者的 MIT 版权及第三方声明，详见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。应用代码的 MIT 声明不替代第三方组件、图标或浏览器的许可。当前 Cromma UI 复制树的独立许可及 Chromium 完整声明清单仍需核实，公开源码或二进制分发必须遵守这些边界。

Claude-Local 独立于 Anthropic，不提供上游同步、官方应用更新端点或自动公开发布流程。
