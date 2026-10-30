<!--
[INPUT]: Fixed v0.2.3 source, neutral Windows NSIS build audit, local deployment verification and GitHub Release metadata.
[OUTPUT]: Public reproducible delivery evidence without account identifiers, private probes or workstation paths.
[POS]: Release verification record; earlier versioned assets remain immutable.
[PROTOCOL]: Documentation-only corrections do not rebuild installers, replace assets or move product tags.
-->
# v0.2.3 交付核验

Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga) 二次开发并独立维护，保留原贡献者版权与 MIT 声明；第三方边界继续由 [NOTICE](../NOTICE.md) 和 [分发说明](DISTRIBUTION.md) 管理。

本机已完成 `bun test`、Rust `warming` / `backup` / `kill_switch` / `risk_check` / `quota` 测试、TypeScript 类型检查（`tsc --noEmit`）、前端构建及 29 项养号与安全增强 Playwright 无头验收（含按需无阻断伴生浏览器断路器、Mihomo `strict-route` 闭环修复向导、养号卡片国家/时区锁定与打开前防漂移核验、阶段 SOP 折叠指南、高消耗速率提示、全链路 `.clbackup` 养号/订阅元数据扩展及 `180×286` 零溢出几何检查）。

[GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.2.3) 已于 `2026-10-30` 正式发布为 Latest，非草稿、非预发布。

- 安装包：[Claude-Local_0.2.3_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.2.3/Claude-Local_0.2.3_x64-setup.exe)
- 大小：`140,883,227` 字节（约 `134.36 MiB`）。
- SHA256：`fa122f952b9a0a7987e51047eb3b341171820e58823a4b15380cd85d362b3e31`，与 GitHub 服务端 `digest` 一致。
- 校验和：[SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.3/SHA256SUMS.txt)。

构建使用新建的中性 Cargo home/target、已锁定依赖和固定浏览器，仅复制公共 registry 缓存，启用 `custom-protocol` 与路径重映射。NSIS 安装包只读解包后，审计精确核对 109 个文件的资源白名单和哈希；29 项外置本机隐私探针无发现。探针内容、真实账号/身份库/账本/浏览器资料及用户图片未进入构建输入或上传资产。

宿主的未打包 SHA256 为 `6351891eb88ca76aa52716a971e0117a53de675f92b23850f2b57025aa451652`；NSIS 内宿主为 `61305648ec4967ad155470968d633299be1972f0f7c90415628344037f1fdc50`。审计确认两者仅有 Tauri 独立 bundle sentinel 的 `UNK` → `NSS` 三字节变换（偏移 `13418642`），其他内容一致。

本机通过现有部署脚本完成有备份的文件更新，安装宿主与本次未打包宿主哈希一致（`6351891eb88ca76aa52716a971e0117a53de675f92b23850f2b57025aa451652`），只重启 Claude-Local GUI；原 Claude CLI 进程与启动时间保持不变。0.2.2 及更早公开标签和安装包未移动、未替换。
