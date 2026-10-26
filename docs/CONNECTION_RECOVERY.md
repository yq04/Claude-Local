<!--
[INPUT]: Explicit online-query recovery, bound-browser quota reads and native wakeup authorization/admission results.
[OUTPUT]: User-facing distinction between website quota recovery and Claude Code wakeup authorization, with actionable wait/failure meanings.
[POS]: Connection troubleshooting; no credential extraction or automatic account changes.
-->
# 网页登录、额度重试和 5h 唤醒

## 网页登录恢复的是什么

“打开此账号的浏览器资料”打开该账号已经绑定的隔离浏览器。完成 `claude.ai` 登录后，点击“统一重试待处理”，应用可以尝试通过该网页会话读取额度。只有读到与目标账号严格匹配的有效 5h 或 7d 额度并成功提交，查询问题才算解决；单纯打开页面或完成登录不是额度读取成功的证明。

网页会话与 Claude Code 使用的 CLI 授权是两套凭据。网页登录不会更新已保存身份中的 CLI 授权，因此“网页额度可以读取”和“可以发送 CLI 唤醒消息”可能同时一成功、一失败。不要为了修 CLI 唤醒而反复登录同一个网页。

## 统一重试仍失败

修复后的界面会分别保留原 OAuth 查询状态与网页读取失败原因，例如绑定浏览器未运行、网页登录仍失效、访问被拦、请求超时、未读到有效额度或账号不匹配。先按具体原因处理，不再把所有网页失败都显示成相同的“重新连接授权”。

若提示账号不匹配，确认打开的是此卡片绑定的浏览器资料以及对应账号/组织，不能把其他账号的网页登录结果合并到该卡片。网页受限或登录挑战需在服务商页面完成；应用不会提取 Cookie、代登录或自动轮换共享 OAuth。

## 唤醒 5h 被阻止

手动唤醒现在返回具体阻断原因。账号授权失败时，应先在 Claude Code 完成该账号需要的登录/授权，再使用明确的单次恢复入口；这不会自动切换当前 CLI 身份，也不会使已失效的归档凭据凭空恢复。

冷却、全局错峰和服务端限流仍会限制一次请求，界面会显示等待时间。明确恢复可释放已确认属于授权失败的账号退避，但保留服务端 429、共用错峰和结果未知保护。按钮点击没有发送请求时应明确说明原因，不显示为正在唤醒或成功。

如果上一条消息已发出但结果未知，不立即重发。只有匹配的新鲜服务端被动观测能解除对应未知状态；网页额度查询成功也不等于证明 CLI/messages 权限已经恢复。主动唤醒会产生真实请求与用量。
