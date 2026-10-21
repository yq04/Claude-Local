<!--
[INPUT]: Validated local usage, identity, referral and computer-environment changes.
[OUTPUT]: Version 0.1.1 review release notes without account identifiers or workstation details.
[POS]: Manual private GitHub release documentation; publishing status is established by the actual release, not this file.
[PROTOCOL]: Keep validation claims tied to available reports and preserve NOTICE.md distribution limits.
-->
# Claude-Local 0.1.1

Windows x64 界面与用量统计更新。建议作为私有预发布版本提供审阅；是否已构建、更新或发布，以本次交付回执及 GitHub Release 状态为准。

## 更新内容

- 用量分析集中时间与账号筛选，增加趋势均值、峰值和图表／数据切换，明细支持排序与分页。
- 账号筛选使用紧凑尺寸，“全部绑定账号”缩短为“全部”，移除未归属历史入口及重复说明。
- 支持将历史及后续未确认归属的 Token 计入私有配置指定的账号，绑定稳定 ID，重命名不会改变归属；已知其他账号的记录保持原归属。
- 身份卡片统一保存名优先的单行标题与额度、重置时间、倒计时字体，改善长名称、隐私模式和卡片对齐。
- 网络页隐藏推广地址与邀请码，只保留复制入口；固定“复制链接／复制提示词”按钮并精简提示词，正确反馈复制失败。
- 电脑环境采用自然高度布局，定位区改为紧凑横行，时区与语言区分当前状态与目标选项。
- 完善中英文、明暗主题及窄窗口适配；保留原有身份格式、浏览器种子及被动额度采集方式。

## 分发文件

完整交付应包含 Windows x64 NSIS 安装包、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json`、本更新说明及相关源代码。安装包不得携带个人账号归属配置、数据库、密钥、浏览器资料或私密审计标记。

## 验证与限制

源码回归涵盖前端、Rust 用量、Python 合成数据和隔离 GUI 检查。安装包必须另外通过新构建的解包与隐私审计，已有安装必须另外核对更新回执和文件哈希，不能用源码测试替代交付证明。

安装包尚未签名。当前未将真实安装、升级或卸载验证视为完成；这些测试只允许在临时 Windows 环境运行。第三方许可仍受 `NOTICE.md` 与 `docs/DISTRIBUTION.md` 所列边界约束，不改变仓库可见性或建立自动更新源。
