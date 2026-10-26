<!--
[INPUT]: Reproduced supplementary-request blocking under production CSP and passing exact-policy regressions.
[OUTPUT]: 0.1.4 browser integration completion and owner steps without identity/profile changes.
[POS]: Patch note; no private screenshot, IP, identity or browser ticket.
-->
# 0.1.4 浏览器核验完整交付

0.1.4保留[0.1.3的WebRTC分阶段计时与同IP分类补充](BROWSER_VERIFICATION_0.1.3.md)，修正最终发现的生产页面策略遗漏：此前CSP仍只允许原有地理服务，导致新增分类请求被浏览器拦截。

本版仅在生产`connect-src`中精确加入`https://api.ipquery.io`。没有添加任意HTTPS/通配域，没有开启unsafe-eval或关闭网页安全、UDP隐私保护。地理结果仍来自原服务，分类响应必须对应同一IP且字段为布尔；限流/超时/无效/错配继续未知。

页面回归现在提取并应用生产服务器的同一网络策略。修正前实际复现“出口IP属性未完成”，修正后10项页面检查通过；原生测试检查真实HTTP响应头中的精确名单及原有帧/Referrer限制。之前36项定向Bun、3项原生分类/报告测试与3组固定真实引擎验证的实现没有改变；本次另验证CSP头及页面集成。

更新后，在主软件“浏览环境”点击“重新打开实测页”，再重新实测。旧标签保留旧脚本和旧CSP，宿主更新也可能使其本地核验会话失效。无需清Cookie、换代理、退出Claude网页、重登CLI或重设指纹。普通网页和运行中的CLI保留。

0.1.3保留作历史候选，发行说明注明由0.1.4取代；没有覆盖旧资产或移动旧标签。测试为隔离/合成资料，尚未代用户用真实资料确认20/20；真实机房标记或测量失败仍应如实显示。安装器实际安装/卸载验收仍是独立任务。
