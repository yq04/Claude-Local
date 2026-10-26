<!--
[INPUT]: Claude-Local release series from0.1.0, owner-managed GitHub publication, data compatibility and third-party notices.
[OUTPUT]: Publication and maintenance guidance independent of repository visibility or prerelease flags.
[POS]: User-facing publication policy; no history rewrite, visibility change or release-state change is performed by this document.
-->
# 发布与维护说明

Claude-Local 的发行版本从 **0.1.0** 开始，当前版本见[README](../README.md)及[GitHub Releases](https://github.com/yq04/Claude-Local/releases)。后续0.1.x版本在该基线上迭代；开发过程中的实验记录不构成另一条对外发行序列。

## 版本与资料兼容

产品版本同步维护package.json、Tauri配置、Cargo.toml及Cargo.lock中的本应用条目，不随意修改依赖版本。应用标识ai.local.claude-local、主程序claude-local.exe、按用户的数据目录，以及BAGAID01/.baga、SQLite v3、HMAC和浏览器种子保持兼容。升级不要求重建身份、重新加密归档或重设浏览器资料。

GitHub的Pre-release、Latest和仓库可见性由所有者分别管理，不由版本数字自动决定。更新介绍不会改变发布标记、仓库可见性、产品标签、安装包或校验值。版本说明应列出实际功能、已知限制和验证范围，不把文档调整当作重新构建。

## 源码与隐私边界

公开源码应保留应用代码、测试、构建脚本、锁文件、许可证及必要notices；不得加入账号库、密钥、归档、用量账本、代理凭据、真实账号截图、安装器、浏览器资料或机器专用回执。演示截图只用隔离合成数据并检查元数据。

公开现有仓库也会公开其可达提交、分支、标签及发布附件。清理当前文件不会清除旧Git历史；既有历史中曾出现机器路径，因此不能把本次文案清理解释为完成全历史隐私审查。历史清理需单独备份、确定范围并执行；本次不改史、不强推、不删除发布资产。

## 构建和安装验证

本地安装包按[分发说明](DISTRIBUTION.md)从锁定源码及固定浏览器引擎构建，启用custom-protocol；审计资源边界、SHA256和隐私标记。构建/解包不替代实际新装、升级、卸载和取消/失败验收，这些应在一次性Windows环境进行，不干扰用户运行中的CLI。

源码检查适用于公开或私有仓库。现有可选分享工作流有私有仓库条件，仓库公开后会跳过；公开仓库仍可使用本地构建流程。若调整工作流，应明确资源/审计边界，不顺带加入自动发布、外部更新源或发布秘密。

## 归属和许可

保留原CCBaga及Claude-Local贡献者的MIT声明，不因品牌或版本介绍调整而删除来源。Cromma复制子集、15个Pika图标取得范围及Chromium完整credits仍有待核对的分发依据，详见[NOTICE](../NOTICE.md)及[分发说明](DISTRIBUTION.md)。仓库公开和取消Pre-release本身不能替代这些依据；未核实也不直接等于已证明侵权。
