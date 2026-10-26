<!--
[INPUT]: Exact 0.2.0 CI, independent frontend/package audit, backed-up local update and eight-asset publication receipts.
[OUTPUT]: Verified delivery facts and explicit acceptance boundaries without private paths, probes or accounts.
[POS]: Product-tag/source reference; later documentation commits do not move v0.2.0 or rebuild assets.
[PROTOCOL]: Preserve private distribution and original receipts under ignored .local/release-0.2.0/.
-->
# Claude-Local 0.2.0 交付核验

> 开发过程归档，不作为对外发行序列。Claude-Local的发行版本从0.1.0开始；当前版本与下载以README和Releases为准。以下源码/哈希/测试记录保持原值，不代表当前发布状态。


2026-10-23，已完成用户授权的打包、私有预发布和本机覆盖更新。

- 产品提交及固定标签：`774e41a2b982db31cf3241104d119c4edebda0ea` / `v0.2.0`。
- [正式构建39985744960](https://github.com/yq04/Claude-Local/actions/runs/39985744960)和[同提交主分支检查39985743576](https://github.com/yq04/Claude-Local/actions/runs/39985743576)均成功。
- [私有预发布及下载](https://github.com/yq04/Claude-Local/releases/tag/v0.2.0)包含8项逐项下载并验证SHA256的资产；仓库保持私有，内部 `build-0.2.0-39985744960` 仍为草稿，旧0.1.8标签及资产不变。

## 实际完成

版本配置同步为0.2.0，正式构建启用custom-protocol。前端95项、Rust214项通过，1项保留忽略；Python资源/归档/额度/迁移/Windows用例及实际MV3导航、在线额度界面检查通过。构建前修复旧扩展断言、Windows回环测试时序、最终文案选择器，以及Python冷启动超过4秒被误判不可用的问题。探针现在每个解释器最多10秒，所有探测和准备共用30秒预算，仍受取消及批次截止时间约束。

前端从精确Git提交独立构建，10个文件与远程产物逐字节一致。安装包只解包、未执行；109项资源通过独立审计，13项私密探针零发现，CI和本机资源哈希清单一致，并核对唯一的Tauri三字节打包标记变换。

本机102个安装文件核验通过，16个待替换文件先备份再更新，具备失败回滚。浏览器引擎未替换，账号库和浏览器资料不属于更新目标。新宿主版本、哈希、唯一主窗口、额度核心及Rust后端通过；已安装Python3.12.10的隔离探针及cryptography能力通过。

更新仅重启精确匹配的Claude-Local主程序，没有发出停止Claude或浏览器的操作。早期预检的1个Claude进程在实际更新开始前已不存在；更新前后数量均为0，不能描述为跨整个构建期持续存活。

## 安装包与回执

- 安装包：`Claude-Local_0.2.0_x64-setup.exe`，140295393字节。
- 安装包SHA256：`a0cd162d53acdd18327d0c49f71ead3c06ed9103dcca228abebf42c1251bdd9f`。
- 本机未打包宿主SHA256：`db47d5b5278ca4b377408dbd991ab4393ea44fbae9f19c5e7d03892712b3d69b`。

原始回执保存在忽略的 `.local/release-0.2.0/`：`ci-receipt.json`、`frontend-reproduction-receipt.json`、`prepared-*/prepare-receipt.json`、`build-receipt.json`、`runtime-receipt.json`、`published-receipt.json`。备份位置由 `.local/last-local-update.json` 记录，不写入Git。

## 尚未执行与设计边界

本机采用备份文件覆盖更新，不冒充NSIS安装、升级和卸载验收。没有进行真实账号登录、额度查询、切号或备份恢复演练；服务商真实权限和会话有效期仍需实际账号验收。系统变更相关CI用例在一次性runner执行，不等于安装器验收。

Python3.10+及cryptography仍为外部依赖；额度代理只支持无认证HTTP CONNECT。恢复只生成独立验证副本或隔离救援证据，不自动激活或合并当前库。浏览器扩展首次激活仍需正常的显式浏览器启动，未强制关闭已有浏览器。

资源哈希核验发生在构建、独立审计及部署阶段；运行时按固定路径解析并进行能力探测，不宣称每次查询重新验证资源哈希。后续交接采用独立文档提交，产品标签和发布资产保持不变。
