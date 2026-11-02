<!--
[INPUT]: Fixed v0.2.6 source, passing Windows CI, neutral custom-protocol NSIS build, extracted-payload audit, GitHub digests and local deployment receipts.
[OUTPUT]: Public release and local-update verification without account identifiers, process IDs, private probes or workstation paths.
[POS]: Delivery receipt; product tags/assets remain immutable and installer execution remains outside this workstation check.
[PROTOCOL]: Documentation follow-ups do not rebuild or replace release artifacts.
-->
# v0.2.6 交付核验

Claude-Local 基于 CCBaga 二次开发并独立维护，保留原贡献者版权和 MIT 声明。第三方边界由 [NOTICE](../NOTICE.md) 和[分发说明](DISTRIBUTION.md) 管理。

## 发布与源码

- [GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.2.6)：2026-11-02T12:47:49Z 发布为 Latest，非草稿、非预发布。
- 标签 `v0.2.6` 固定到源码提交 [`8c1935a27ed0512010ebd6d48b005728d412ca7f`](https://github.com/yq04/Claude-Local/commit/8c1935a27ed0512010ebd6d48b005728d412ca7f)。后续文档提交不移动该标签。
- [Windows source checks](https://github.com/yq04/Claude-Local/actions/runs/41446008377) 对同一完整提交执行，全部步骤通过；系统修改夹具仅在临时 Windows runner 上运行。

## 安装包

- [Claude-Local_0.2.6_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.2.6/Claude-Local_0.2.6_x64-setup.exe)：`140,900,020` 字节，约 `134.37 MiB`。
- SHA-256：`75ff03b772919c0968b6d466d484dc3e3020e7ce1f43f63d3462fedcebfb78ae`。
- [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.6/SHA256SUMS.txt)：安装包和校验文件的 GitHub 服务端 digest 均与本地对应文件一致。

本次使用新的中性 Cargo home/target、锁定依赖、固定浏览器引擎、单作业原生构建与 `custom-protocol`。NSIS 只读解包后的精确资源白名单/哈希审计通过：109 个文件、29 项外置隐私探针、0 项发现。探针内容、身份库、用户浏览器资料、账本及本机代理配置不属于构建或上传资产。

未打包宿主 SHA-256 为 `35fa14d418bc604dd8316992036e45d987877eb385fc78ee2195455d0ff2e186`；NSIS 内宿主为 `481c6d154f864688fbcd5b42a21b062cab226ed3507c3d3e84353263fcbaba1c`。审计确认差异仅为 Tauri 唯一 bundle sentinel 的 `UNK` → `NSS` 三字节转换。

## 验证范围

本机类型检查通过；173 项 Bun 单测、65 项既有合成 UI 检查（身份28、养号29、额度重置8）、19 项针对性 Rust 测试（身份11、HUD6、本地版2）和11项合成 Python 包/资源测试通过。测试使用合成账号与隔离资料，不进行真实登录或切号。发布源码的完整 Windows CI 另行通过。

## 本机更新

本机直接部署本次审计后的应用 payload：102 个应用文件逐一核验，其中11个需要替换，替换前原件已备份并核对哈希；NSIS 辅助文件不作为应用资源部署。旧版遗留文件不进行推测性清理。

安装宿主 SHA-256 为 `481c6d154f864688fbcd5b42a21b062cab226ed3507c3d3e84353263fcbaba1c`，与安装包内宿主完全一致。0.2.6 已在交互式桌面启动并存在主窗口。本机更新前后即时快照确认当时运行的 Claude CLI 进程编号及启动时间一致；只重启 Claude-Local GUI，没有向 `claude.exe` 发出停止操作。

更新仅处理明确的程序资源路径，未执行身份删除、切换、迁移或代理重载，未读取保险库内容来推断账号数量。实际 NSIS 安装/卸载生命周期没有在维护者电脑上执行，不能将文件更新当作安装器生命周期验收。

## 范围与兼容

本版交付已实现的 HUD、166px 卡片排序、5秒静默本地同步、幽灵卡修复、定向额度查询、智能接力及用量导出优化。单身份 `.bagapack` / `CLPACK01` 迁移方案已取消；额外网络门禁和删除提示建议没有被写成已实现功能。现有整库 `.clbackup` 保留，持久格式、账号 HMAC 和已有浏览器种子不改变。

`v0.2.5` 仍指向 `6d505a6`，其安装包和校验文件保持不变。隐私探针和配置检查覆盖其明确检查范围，不构成任意秘密绝对不存在或账号免风控的保证。
