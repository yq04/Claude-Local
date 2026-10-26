<!--
[INPUT]: Owner-authorized 0.1.8 delivery of the narrower sidebar, responsive identity onboarding and native main-window size memory.
[OUTPUT]: Private prerelease notes describing implemented behavior and the remaining runtime verification boundary.
[POS]: Versioned release description; actual CI, package audit, local update and upload receipts are stored separately.
[PROTOCOL]: Do not describe quota research proposals as shipped features. Preserve private distribution and existing user data.
-->
# Claude-Local 0.1.8

> 开发过程归档，不作为对外发行序列。Claude-Local的发行版本从0.1.0开始；当前版本与下载以README和Releases为准。以下源码/哈希/测试记录保持原值，不代表当前发布状态。


本版调整侧栏与窄窗内容布局，并记忆主窗口上次使用的大小。

## 界面布局

- 经典侧栏由 232px 缩为 192px，给主内容释放 40px；紧凑侧栏保留 72px。
- 品牌、折叠按钮、菜单和底部命令/语言/版本区域同步调整，中英文菜单保持完整。
- 身份库较窄时，添加账号的三个引导步骤自动换行；账号卡仍为 180×286，卡片列表保留局部滚动。

## 窗口尺寸记忆

- 默认保存正常窗口的逻辑宽高及最大化状态，关闭到托盘和退出时保存。
- 最大化不覆盖正常窗口大小，最小化不污染下次启动状态。
- Windows 直接读取系统保存的正常窗口外框与显示状态，并按正常样式和 DPI 换算客户区，避免最大化事件早于运行时缓存更新时覆盖正常大小。
- 再次启动时按主屏可用区域、DPI 和窗口外框调整并居中，恢复完成后显示；不恢复旧显示器的绝对坐标。
- 连续调整尺寸先更新内存，防抖写入独立私有文件；损坏、超大或无效记录安全回退。

## 验证与交付范围

源码阶段已通过 96 组隔离界面场景、6 项纯窗口规则测试、TypeScript/Vite 构建及 Rust 集成编译检查。正式包的同提交 CI、隐私审计、本机覆盖更新与上传状态以发行附件和交接记录为准。

本版没有引入在线额度查询、订阅日期或手动重置余额采集；这些内容仍属于调研方案。身份归档格式、SQLite user_version=3、账号匹配、浏览器种子及 Python 额度账本唯一写入者保持原有契约。

发行方式沿用用户授权的私有预发布与已审计文件替换。本机覆盖更新保留备份，不执行 NSIS 安装/卸载；系统级安装验收仍限定一次性 Windows 环境。
