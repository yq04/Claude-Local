<!--
[INPUT]: Fixed v0.3.2 source, passing Windows CI, neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and local deployment receipts.
[OUTPUT]: Public release and local-update verification without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and installer execution remains outside this workstation check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.3.2 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权和 MIT 声明。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.2)：2026-11-12T08:11:42Z 发布为 Latest，非草稿、非预发布。
- 标签 `v0.3.2` 固定到源码提交 [`260f80ec78729fbd1f01dbd8d268e873f8ff2209`](https://github.com/yq04/Claude-Local/commit/260f80ec78729fbd1f01dbd8d268e873f8ff2209)。后续文档提交不移动该标签。

## 安装包

- [Claude-Local_0.3.2_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.3.2/Claude-Local_0.3.2_x64-setup.exe)：`140,960,687` 字节，约 `134.44 MiB`。
- SHA-256：`4b9babc95ee530b574103565ee904289d02baa047a7d9b0f93b33cac48aa2b5d`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.2/SHA256SUMS.txt)：安装包和校验文件的 GitHub 服务端 digest 均与本地对应文件一致。

本次使用中性 Cargo home/target、锁定依赖、固定浏览器引擎、单作业原生构建与 `custom-protocol`。NSIS 只读解包后的精确资源白名单/哈希审计通过：109 个文件、24 项外置隐私探针、0 项发现。探针内容、身份库、用户浏览器资料、账本及本机代理配置不属于构建或上传资产。

## 验证范围

本机类型检查与前端构建通过；193 项 Bun 单测、327 项全量 Rust 单元测试和 85 项核心合成 Python 测试（在线 40、本地 38、归档 7）通过。67 项 Playwright 界面测试（卡片 28、在线 10、预热 29）通过。测试使用合成账号与隔离资料，不进行真实登录或切号。

## 范围与兼容

本版交付五大核心域（身份卡片、账号隔离、风险规避、额度查询、用量分析）全量打磨与加固、额度/用量加载提速（根治卡顿）、额度详情弹窗重新设计以及主动重置次数显示修复：

- **额度与用量加载提速**：含损坏行的大型日志缓存游标并保留提示、未变化文件走零读取快路径、跳过逐文件所有者查询、HUD 增量采集不做全量聚合、身份页内容判断不因 CLI 簿记字段触发重读、用量页按时段/账号缓存快照。
- **额度详情弹窗重新设计**：资料头 → 5h / 7d 双额度卡片 → 7d 消耗步调标签 → 续期时间 / 可用主动重置次数 / 隔离状态列表 → 折叠的采集说明，底部主操作「网页同步额度与重置」。修复步调文案双加号。
- **主动重置次数**：网页同步额外保存权益真实到期时间；卡片直接显示次数，仅在确认已到期时隐藏。
- **多账号网页同步与浏览器隔离、账号隔离与净室清洗、风险规避、额度查询、用量分析、UI 细节**：详见 [发布说明](RELEASE_NOTES_0.3.2.md)。

`v0.3.1` 仍指向 `fa1fedde2982bc123986ed70b8ca95fdeb56e18a`，其安装包和校验文件保持不变。隐私探针和配置检查覆盖其明确检查范围，不构成任意秘密绝对不存在或账号免风控的保证。
