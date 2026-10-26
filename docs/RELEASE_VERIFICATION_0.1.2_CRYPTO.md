<!--
[INPUT]: Fixed 0.1.2 source, passing Windows CI, package audit, backed-up local update and GitHub asset metadata.
[OUTPUT]: Public-safe delivery hashes and explicit data/validation boundaries.
[POS]: Verification record; private paths, process receipts and user metadata remain ignored.
-->
# 0.1.2 加密存储加固交付核验

日期：2026-10-26。此为 0.1.2 补丁交付核验；早期内部草案不代替本次发布回执。

- 固定源码/产品标签：`9d642ea50425b716f94075aea517c3293127fee9` / `v0.1.2`。
- [发布页面](https://github.com/yq04/Claude-Local/releases/tag/v0.1.2)：附件仅安装器，不含用户资料、探针或内部日志。
- `Claude-Local_0.1.2_x64-setup.exe`，140,582,806字节；SHA256`7ec212d4f1a46c708eeb629008a9c0c0708c7e20f8694408120af9e54f0b3858`。服务端digest及size已核对。
- 发布启用custom-protocol、新中性Cargo home/target，原始缓存保留。只读解包审计109文件/13外部探针/0发现。
- 本机0.1.2，102项应用文件核对一致，实际变更7项；备份/hash/stage后宿主最后更新，启动与纯JSON quota-core冒烟通过，missingClaudeCount=0。浏览器未停止。
- NSS载荷及本机宿主SHA256`3408c2742798a160129dfcc16fc407f3167a4a5e2f8d1ae3245b1fd300cd207a`；原始UNK宿主`b472d27f26449751054999ad9376a51b42dcd6daf41e9985f151268f1a197fbb`，差异仅审计确认的3字节Tauri包标记。

更新前后只读SQL及文件元数据投影一致：3身份索引及归档引用/大小/mtime、3浏览器绑定、活动指针、SQLite v3及恢复标记保持。测试及交付工具没有解密或改写真实归档，也未直接读取密钥或会话正文，没有切号、旋转授权或修改自动开关。文件式更新只覆盖审计计划内的应用文件。

定向Rust22、Python6、前端/双语7及TypeScript检查通过。完整[Windows CI 40292415566](https://github.com/yq04/Claude-Local/actions/runs/40292415566) success：前端132通过，原生主套件257通过1忽略、另1项定向检查通过，离线额度/迁移及Windows CLI fixtures通过。测试均使用合成数据；没有将真实资料作为测试输入。

功能与兼容边界见[CRYPTO_HARDENING_0.1.2.md](CRYPTO_HARDENING_0.1.2.md)。保留既有格式、算法参数、主密钥与持久标识，不自动转换已有资料；异常超限归档拒绝加载并保留原件。成功备份的暂存清理异常作为独立诊断，不冒充认证失败。

NSIS真实安装/卸载/降级、真实账号消息权限及公开许可核对仍未完成，文件式更新和合成回归不替代它们。没有设计偏差。
