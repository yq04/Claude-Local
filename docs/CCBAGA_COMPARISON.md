<!--
[INPUT]: CCBaga at bdfb90ceadfc5fae6772ffff597bddecb0b73cc3 and Claude-Local source at 9b89502.
[OUTPUT]: Evidence-bounded product comparison and selective adoption priorities for public preparation.
[POS]: Public product assessment; source implementation is distinguished from installed/released behavior.
-->
# 与 CCBaga 的定位和取舍

核查日期：2026-10-25。CCBaga 参考 [固定提交 bdfb90c](https://github.com/liseami/CCBaga/tree/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3) 与 [v0.2.49](https://github.com/liseami/CCBaga/releases/tag/v0.2.49)；Claude-Local 功能基线为本地源码 `9b89502`。这是源码与发行信息比较，没有运行第三方应用或用真实账号做横向测试。

## Claude-Local 的主要优势

**额度和用量工作流更完整。** 本项目已有本地被动额度、明确触发的多账号在线查询、5h/7d 来源与时间区分、用量归属、IANA/DST 统计、模型/Effort 分布、TSV 导出和悬浮监控。最新源码把唤醒改为原生应用级单一调度器，增加严格新 5h 确认、有限审计、错峰、未知结果处理和授权恢复入口。CCBaga 当前可读文件树和已核对入口未见对应额度调度/用量分析模块；这是一项范围内观察，不是断言对方以后不会提供。

这些能力也带来维护成本：在线接口不是本项目控制的稳定公共协议，授权失效不能靠定时器修复；主动唤醒会发送真实消息并产生用量，不是免费增加额度。结果记录与延迟策略也不能保证账号不会受到服务端限制。

**Windows 细节和恢复边界更贴近日常使用。** 本项目重点维护 Windows x64，具有浏览器 AppContainer 缓存 ACL 继承修复、保留资料的升级确认、系统修改前后记录与冲突恢复、全库加密备份/救援，以及切号前额度与隔离信息比较。浏览器是用户显式打开的子系统；最新核验源码区分通过、失败和未知，缺项不会显示整体通过。没有做真实性能测量，不能由此宣称速度或安全性全面领先。

**功能之间有较强的账号证据约束。** 在线请求冻结目标账号，先验证服务端 profile 的账号/组织，再提交复核；Python 是额度账本唯一写入者。这里比较的是新额度功能的实现边界，不意味着 CCBaga 的身份归档本身没有保护。

## CCBaga 的优势及本项目短板

**跨平台发行更广。** CCBaga 的 [README](https://github.com/liseami/CCBaga/blob/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3/README.md) 与 v0.2.49 提供 macOS Apple Silicon、Linux x86_64 和 Windows 的分发说明/资产。Claude-Local 当前只承诺 Windows x64；保留其他平台源码不等于已经支持或验证。若主要用户就在 Windows，不需要为了功能表好看而同时维护三套发行链。

**单账号便携交换更方便。** CCBaga 已有 [portable.rs](https://github.com/liseami/CCBaga/blob/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3/src-tauri/src/identities/portable.rs)：`BAGAP001`、PBKDF2-HMAC-SHA256 600,000 次、AES-GCM 和压缩归档，导入校验同 OS 后以目标主密钥重新封存。Claude-Local 有整库备份与隔离恢复，但没有同等完整的单身份便携包入口。这是最值得补齐的实际功能差距。

**对普通用户的安装与维护路径更成熟。** 对方已有多平台安装文档、版本化资产和应用更新入口。Claude-Local 的额度能力依赖可用的外部 Python/cryptography，浏览器引擎也使完整安装包较大，接入和故障解释更复杂。当前 README/工作流还有私有开发时期的表述，手动打包任务在仓库公开后会受私有仓库条件限制，公开首版应把这些边界说明白。

**本项目新功能的真实运行证据较少。** 最新原生调度和统计修复已通过定向合成测试，但尚未作为完整新宿主安装部署，也没有真实 Windows 睡眠/恢复或全部账号类型验收。功能较多不等于已经更稳定，公开前应先做有限的独立测试环境验收和小范围试用。

## 值得取长补短的顺序

1. **优先做单账号密码保护导出/导入。** 参考便携格式和认证/大小/路径校验，先只支持 Windows→Windows；导入到新的私有目标，验收后才显式添加，不覆盖活动身份或转交主密钥。保留原 MIT 归属，独立评审格式兼容，不把“可导入”当成可以公开分享真实账号。
2. **借鉴清楚的安装、首次使用和故障恢复文档。** 重点说明 Python 能力、浏览器的可选性、授权失败如何恢复、后台生效范围和数据位置。多平台流水线可作测试隔离参考，暂不承诺其他平台。
3. **逐项比较清理目录和瞬态锁处理。** 只采用本项目确实遗漏且有引用/影响证据的目标，维持预览、快照、进程检查、明确确认和回滚。对方将某日志列为缓存，不代表本项目可以删除仍用于额度/统计的证据。
4. **保留自己的独立发行边界。** 可以改善版本说明和手动检查体验，但不能接入 CCBaga 的更新源、公钥或官方应用更新端点，也不建立自动 upstream 同步。采用源码思路和依赖对方发行流程是两回事。

本轮没有发现需要把已有独立包审计工具重新实现一遍的证据，故不把“已有能力”当成新增需求。

## 两项容易误解的比较

CCBaga 的 [cleaner_identity.rs:299](https://github.com/liseami/CCBaga/blob/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3/src-tauri/src/cleaner_identity.rs#L299) 在检测到进程运行时返回错误，**这个检查函数不负责杀进程**。不能把它写成对方每次切号都会强杀，也不能声称本项目能在运行中的 CLI 上安全热切号。两边身份事务都必须遵守各自的进程保护。

浏览器核验展示更多项目，不代表做了外部 STUN/DNS 泄漏证明。Claude-Local 当前 WebRTC 测量是无 STUN 的短时本地候选观察，超时记未知；不以“防封”或“零泄漏”作为公开承诺。

## 公开和许可

[CCBaga LICENSE](https://github.com/liseami/CCBaga/blob/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3/LICENSE) 是 MIT，本项目保留其版权及许可。对方的 [NOTICE](https://github.com/liseami/CCBaga/blob/bdfb90ceadfc5fae6772ffff597bddecb0b73cc3/NOTICE.md) 同样提醒 Cromma UI/Pika 子集的独立许可需要核实，因此不能以对方已公开推定每个第三方资产都已取得足够分发权。版本重置、改名或删除声明都不会解决这个问题。

本项目应公开说明“源自 CCBaga 并独立维护”，保留必要归属；持久格式、HMAC、SQLite 身份版本及 legacy seed 字符串继续兼容。公开准备与目录整理见 [PUBLIC_PREPARATION.md](PUBLIC_PREPARATION.md)。
