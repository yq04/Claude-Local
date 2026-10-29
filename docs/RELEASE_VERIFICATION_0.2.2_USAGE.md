<!--
[INPUT]: Fixed v0.2.2 source, successful Windows CI, neutral build audit and GitHub asset metadata.
[OUTPUT]: Public reproducible delivery evidence without account identifiers, private probes or workstation paths.
[POS]: Release verification record; earlier versioned assets remain immutable.
[PROTOCOL]: Documentation-only corrections do not rebuild installers, replace assets or move product tags.
-->
# v0.2.2 交付核验

Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga) 二次开发并独立维护，保留原贡献者版权与 MIT 声明；第三方边界继续由 [NOTICE](../NOTICE.md) 和 [分发说明](DISTRIBUTION.md) 管理。

源码标签 [v0.2.2](https://github.com/yq04/Claude-Local/tree/v0.2.2) 指向 `13dd440ae448bd2c2fd0d52b069c14210fea3427`。本机已完成 `bun test`（154 项）、Rust 订阅/风控/被动额度修订测试、前端构建以及 Playwright 布局与在线配额回归（含 `180×286` 身份卡片 `PRO`/`MAX` 右侧 `MM/DD` 到期徽章、风控验证页、普通账号下拉、总量守恒、导出及中英双主题布局）；公开预览图均使用合成、遮罩数据。

[GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.2.2) 已于 `2026-10-29` 正式发布为 Latest，非草稿、非预发布。

- 安装包：[Claude-Local_0.2.2_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.2.2/Claude-Local_0.2.2_x64-setup.exe)
- 大小：`140,697,822` 字节（约 `134.18 MiB`）。
- SHA256：`981b26f6cec183cabf58baefe8bb8184a4d9d647eb30cc65570dd3e111838617`，与 GitHub 服务端 `digest` 一致。
- 校验和：[SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.2/SHA256SUMS.txt)。

构建使用新建的中性 Cargo home/target、已锁定依赖和固定浏览器，仅复制公共 registry 缓存，启用 `custom-protocol` 与路径重映射。NSIS 安装包只读解包后，审计精确核对 108 个文件的资源白名单和哈希；17 项外置本机隐私探针无发现。探针内容、真实账号/身份库/账本/浏览器资料及用户图片未进入构建输入或上传资产。公开源码变更也通过相同探针比对。

宿主的未打包 SHA256 为 `ef4bb6d06ed22c6a32e3341cd43a521dc938600d054bbce91c915d3598e369d9`；NSIS 内宿主为 `5d291cb92df757f437c75654ca9e374a80180d03f6ce7630e0cd1f4bf0256322`。审计确认两者仅有 Tauri 独立 bundle sentinel 的 `UNK` → `NSS` 三字节变换，其他内容一致。

本机通过现有部署脚本完成有备份的文件更新，安装宿主与本次未打包宿主哈希一致，只重启 Claude-Local GUI；原 Claude CLI 进程与启动时间保持不变。没有执行真实账号切换、安装器升级/卸载向导或系统设置变更。本记录不替代一次性 Windows 环境下的完整安装器生命周期验收，也不宣称已解决第三方许可清单的既有边界。

0.2.1 为未公开的本机候选；0.2.0 及更早公开标签和安装包未移动、未替换。后续 README、交接或核验文档提交可以位于产品标签之后，源码与二进制校验仍以本记录的固定对象为准。
