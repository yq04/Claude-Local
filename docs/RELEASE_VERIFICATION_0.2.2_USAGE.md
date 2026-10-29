<!--
[INPUT]: Fixed v0.2.2 source, successful Windows CI, neutral build audit and GitHub asset metadata.
[OUTPUT]: Public reproducible delivery evidence without account identifiers, private probes or workstation paths.
[POS]: Release verification record; earlier versioned assets remain immutable.
[PROTOCOL]: Documentation-only corrections do not rebuild installers, replace assets or move product tags.
-->
# v0.2.2 交付核验

Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga) 二次开发并独立维护，保留原贡献者版权与 MIT 声明；第三方边界继续由 [NOTICE](../NOTICE.md) 和 [分发说明](DISTRIBUTION.md) 管理。

源码标签 [v0.2.2](https://github.com/yq04/Claude-Local/tree/v0.2.2) 指向 `5f6ead951a573d29772f2d5a85ae9f01d889976c`。[Windows source checks 40818011121](https://github.com/yq04/Claude-Local/actions/runs/40818011121) 在该提交全部通过，包含前端、原生、资源及隔离 Python/Windows fixtures。用量页针对性检查验证普通账号下拉、总量守恒、导出及 8 组中英/主题/窗口布局；公开两张预览图均使用合成、遮罩数据。

[GitHub Release](https://github.com/yq04/Claude-Local/releases/tag/v0.2.2) 已于 `2026-10-29T04:34:28Z` 正式发布为 Latest，非草稿、非预发布。

- 安装包：[Claude-Local_0.2.2_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.2.2/Claude-Local_0.2.2_x64-setup.exe)
- 大小：`140,550,954` 字节（约 `134.04 MiB`）。
- SHA256：`1a121cb4c1c6f1fc19b5825375dfd741de85bb81f6848aea05586d51852d0e51`，与 GitHub 服务端 `digest` 一致。
- 校验和：[SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.2/SHA256SUMS.txt)。

构建使用新建的中性 Cargo home/target、已锁定依赖和固定浏览器，仅复制公共 registry 缓存，启用 `custom-protocol` 与路径重映射。NSIS 安装包只读解包后，审计精确核对 109 个文件的资源白名单和哈希；29 项外置本机隐私探针无发现。探针内容、真实账号/身份库/账本/浏览器资料及用户图片未进入构建输入或上传资产。公开源码变更也通过相同探针比对。

宿主的未打包 SHA256 为 `8e0a44d7df96578ca1759d7acfe5ba4339f368649a09e19e4a8be97fa703987e`；NSIS 内宿主为 `dc660e1e779faa9021e6bb882d51cdbb2d554bc1a305be9a9ec3a6b81dc30e05`。审计确认两者仅有 Tauri 独立 bundle sentinel 的 `UNK` → `NSS` 三字节变换，其他内容一致。

本机通过现有部署脚本完成有备份的文件更新，安装宿主与本次未打包宿主哈希一致，只重启 Claude-Local GUI；原 Claude CLI 进程与启动时间保持不变。没有执行真实账号切换、安装器升级/卸载向导或系统设置变更。本记录不替代一次性 Windows 环境下的完整安装器生命周期验收，也不宣称已解决第三方许可清单的既有边界。

0.2.1 为未公开的本机候选；0.2.0 及更早公开标签和安装包未移动、未替换。后续 README、交接或核验文档提交可以位于产品标签之后，源码与二进制校验仍以本记录的固定对象为准。
