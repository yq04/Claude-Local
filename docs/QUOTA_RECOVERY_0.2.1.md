<!--
[INPUT]: User-selected restoration of passive quota defaults, isolated regression evidence and verified 0.2.1 delivery receipts.
[OUTPUT]: Functional recovery, actual delivery facts and remaining source/authorization limits.
[POS]: Versioned quota-recovery record; private paths, identities and probe contents remain outside Git.
[PROTOCOL]: Preserve 0.2.0 assets/tags, account isolation and Python-only ledger writes.
-->
# 0.2.1 额度同步恢复

用户选择保留0.2.0其他功能，恢复旧版本地额度同步作为默认方式；没有整机回退到0.1.7。

## 修复行为与原因

顶部主入口改为“同步本地额度”，统一读取已有本地记录，不依赖在线授权。CLI的 `/usage` 或既有采集器写入新缓存/账本后，身份页可见时约两秒检测变化并同步。保存账号仍显示各自的历史观测，估算、预计恢复和真实新观测保持区分。

旧的被动采集和Rust本地读取并未删除。0.2.0的两秒检测只检查产品账本，遗漏 `.claude.json` 的变化；现在检查固定三文件的修改时间/长度，拒绝链接，不读取正文、凭据或项目目录，也不写入Claude配置。正常摘要读取继续使用原有账号绑定规则，Python仍为额度账本唯一写入者。

在线批次、定时在线查询、错误和连接修复移入默认折叠的可选区域。关闭区域会停止定时在线查询；正在运行的任务仍可显示和取消。本地同步不被在线任务阻塞，旧在线错误及空订阅/重置提示不再占据默认卡片。

截图中的内部文案键来自缺失的双语条目。原测试仅扫描TSX，辅助TS模块未检查，模拟翻译又只返回键名。修复补齐状态、元数据及原生额度错误，覆盖产品TS/TSX、实际格式化翻译和原生错误代码，防止同类漏检。

## 已执行验证与交付

- 合成原生测试覆盖CLI缓存变化→revision变化→正常本地摘要读取、同邮箱其他账号锚点拒绝、账本不写入、观测时间/未知窗口/重置推定；2项通过。
- 真实组件定向检查9项通过，默认同步及被动更新不触发在线IPC；关闭在线区域停止定时查询，保留取消与旧结果隔离。
- 最终[远程构建39997277428](https://github.com/yq04/Claude-Local/actions/runs/39997277428)及[主分支独立检查39997273081](https://github.com/yq04/Claude-Local/actions/runs/39997273081)均成功：前端97项、Rust216项通过，1项保留忽略；相关Python和浏览器用例通过。
- 前端10个文件独立复现一致；109项资源、13项私密探针审计零发现。本机102个安装文件核验通过，7个文件先备份后替换；唯一主窗口、额度核心和Rust后端验证通过。更新前后Claude进程均为0，没有发出停止Claude或浏览器的操作。
- [v0.2.1私有预发布](https://github.com/yq04/Claude-Local/releases/tag/v0.2.1)包含8项逐项下载并验证哈希的资产。产品提交为 `08326745c6b44b43237fdadbb50c07d10d4a9541`，旧v0.2.0标签/资产不变。

安装包 `Claude-Local_0.2.1_x64-setup.exe` 为140370781字节，SHA256：`3369742bd164aaffeda7baf366eea672ed322e861994c00b566fc2abe6924d44`。本机未打包宿主SHA256：`9436b9d42c6782b525a40acf197f66c57891cd86e7862ec37c17dff90ced5612`。

## 保留边界

同步依赖CLI或采集器实际写入本地记录，不读取终端画面，不自动执行 `/usage`，不把未保存输出当作新观测。没有进行真实账号在线授权、查询或切号测试。本机采用备份文件覆盖更新，未执行NSIS安装/卸载。原始回执及备份定位分别在忽略的 `.local/release-0.2.1/` 和 `.local/last-local-update.json`。
