<!--
[INPUT]: Owner-reported persistent feedback, current uncommitted source, the latest local delivery handoff and verified public references.
[OUTPUT]: Entry point and ordered recommendations for multi-account, browser isolation, subscription and feedback improvements.
[POS]: Research and planning only; no product implementation, deployment or real-account acceptance is performed here.
[PROTOCOL]: Keep evidence and proposals separate; preserve source compatibility, privacy and the owner's UI preferences.
-->
# 多账号管理、隔离与反馈优化建议

核查日期：2026-10-30。基线为 `feat/free-warming-profiles` 当前未提交工作区，HEAD为 `ec3d345`；不能把分支基底提交当成本轮全部源码。已安装软件仍以根 [HANDOFF.md](../../../HANDOFF.md) 第5.5节的交付回执为准。本目录只记录调查和方案，不代表下列改进已经实现。

## 结论与建议顺序

现有账号绑定、加密归档、受控切换、养号共存和Python单写者应继续保留。优先补齐跨功能衔接和状态真实性，再增加并行能力。

1. **先让操作反馈可关闭、可追溯。** 完成记录提供关闭，运行中的任务提供收起和恢复查看；关闭界面不取消任务。顶部提示记录来源和账号，旧错误不能冒充后续操作结果。
2. **修订阅同步的账号路径和结果语义。** 当前同步仍依赖全局浏览器选择；改为精确操作目标账号的既有资料，并分别报告续期日期、重置权益和额度窗口是否实际更新。
3. **统一多账号浏览器动作。** 在卡片菜单中明确打开、核验、关闭的目标，保留CLI切换作为独立且有确认的动作；资料选择、窗口运行、网页登录和CLI配置归属分别表达。
4. **明确备份覆盖，再增加全环境备份。** 当前保险库导出没有包含养号元数据、手动订阅和浏览器资料。先说明范围，后续再设计加密、一致性及恢复到新目录的扩展。
5. **完整并行核验单列升级阶段。** 目前只有一套全局核验会话。双浏览器分别核验，需要贯穿会话、上下文、回报、票据和事件的独立作用域，不能只多开一个窗口。

建议首批执行实施方案的阶段A和B，阶段C解决多账号入口一致性，阶段D和E分别处理备份与完整并行核验。首批不改变现有数据格式，也不引入多CLI账号同时运行的新承诺。

## 对截图的准确解释

下方“已返回当前CLI的浏览器”成功记录，与上方旧“在线查询暂不可用”可以同时留在页面。源码确认返回操作没有清理或标记旧 `quotaFeedback`，操作记录自身也没有关闭接口。

这说明反馈生命周期有缺口，**不能仅凭截图判断回切后再次订阅同步仍失败**。用户已经执行回切；是否在正确的Pro网页登录态下再次同步、官网实际提供哪些字段，仍待后续明确操作和结果。

## 阅读顺序

- [问题证据和能力边界](01-FINDINGS.md)：已证问题、现有保护、待验证风险与实际API。
- [公开资料和实现对比](02-COMPARISON.md)：Chromium、Playwright、WAI-ARIA、Radix及固定提交的开源参考。
- [分阶段实施方案](03-IMPLEMENTATION-PLAN.md)：改动位置、依赖、约束、验收与交付门槛。

本轮未修改产品代码、运行账号测试、启动真实浏览器、停止CLI、构建部署或调整代理。原403和严格路由维护继续作为独立遗留，不能由本研究推断已恢复。设计取舍是先完善现有账号操作，再按独立阶段增加浏览器并行；多CLI独立运行需另行研究。
