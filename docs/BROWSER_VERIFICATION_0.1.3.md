<!--
[INPUT]: Versioned source history, isolated pinned-engine timing, public service documentation and synthetic UI/native regressions.
[OUTPUT]: Browser 0.1.3 measurement fixes, classification provenance and unchanged privacy/data boundaries.
[POS]: Public-safe patch note; no real screenshot, user IP, identity or browser ticket is included.
-->
# 0.1.3 浏览器核验修复

**完整交付请使用0.1.4。** 0.1.3候选的RTC和分类逻辑通过测试，但最终集成检查发现生产核验页CSP未允许新增分类域名。0.1.4补齐该固定域名，并让GUI使用生产connect-src复现和验证，不覆盖旧标签或附件。

早期版本的“通过”包含乐观兜底：WebRTC在300ms内未看到候选地址也会通过，出口名称未命中机房关键词就默认非机房。2026-10-25的9b89502改为完整证据要求后，两项缺少测量能力的问题显露为未知；这不证明用户的网络突然变差。0.1.1将预算延长至1000ms，仍早于实际引擎初始化完成；0.1.2未修改这条浏览器检测链。

## 本次处理

WebRTC保持无STUN和原有UDP隐私参数。同步构造不再消耗候选观察预算；后续协商有5秒截止，描述设置成功后给予独立2秒收集窗口。只有真正结束候选或收集状态complete才通过，错误/超时仍未知；回传受控原因与耗时。固定148.0.7778.215引擎在独立临时资料中的三组对照均在约3.6–3.7秒完成。初始化为同步原生调用，JavaScript不能强行中止它；这里修复的是过早超时，不是禁用网络保护。

保留现有ipwho.is/ipapi.co地理检测。它们当前的公共响应缺少所需机房分类，因此仅在hosting缺失时，用固定IPQuery HTTPS接口补充已测出的同一个IP，不覆盖国家、时区或运营商。返回地址必须相同（IPv6按地址规范化比较），分类必须是布尔值；请求限3秒/32KiB，无凭据、无Referrer、不跟随重定向。服务限流、超时、响应无效或IP不一致时，保留地理成功并明确显示分类未知，不换路由重试。

页面显示分类来源与本地测量耗时。分类表示该数据源是否标记机房，不是住宅接入、无泄漏或账号安全保证。20个必需指标及报告schema1保持，新增诊断字段可选且有界，旧报告/旧调用兼容。

## 使用方式

更新主程序后，从主软件重新打开浏览器核验页，再点击重新实测。已经打开的旧标签仍运行旧脚本，而且宿主重启后原本地核验会话可能失效；重新打开可取得新页面和上下文。无需清理Cookie、退出Claude网页、重新登录CLI、修改代理或关闭隐私保护。普通Claude网页标签和运行中的CLI保留。

不能保证任意网络都20/20：确实被标记机房或检测失败时仍会如实提示。环境核验不判断Claude账号封禁或消息权限。自动化验证使用合成HTTP/账号及临时浏览器资料，没有对真实账号发送消息，也未把真实截图或身份信息上传。

公开资料：[ipwhois字段与套餐](https://ipwhois.io/documentation)、[ipapi字段](https://ipapi.co/api/)、[IPQuery](https://ipquery.io/)、[Chrome WebRTC隐私策略](https://developer.chrome.com/docs/extensions/reference/api/privacy)。IPQuery为外部公共服务，不作为本应用更新源；仅新增分类所需的请求，不包含API密钥。
