<!-- [INPUT]: Real 0.2.2 frontend components and isolated synthetic IPC. [OUTPUT]: Two privacy-masked 1280×900 usage-page previews. [POS]: Public presentation assets, not real-account acceptance evidence. -->
# 0.2.2 用量页预览

[usage-analytics.png](usage-analytics.png) 和 [usage-analytics-en.png](usage-analytics-en.png) 分别展示中文与英文用量页。两图均为实际前端的完整 `1280×900` 应用窗口，保留侧栏、标题、筛选、Token 构成和趋势区域，未裁成局部指标卡。

图片复用 `scripts/test-usage-statistics.mjs` 的隔离浏览器与合成 IPC；临时导出逻辑仅替换截图步骤和演示版本号。账号、Token、会话、日期、CLI 状态与模型分布均为合成数据，邮箱仅使用保留域名 `example.invalid`。两图都显式启用 `privacyMask=true`，使用固定演示时钟与浅色主题；不是实际账号、机器或当前实时状态。

生成过程不读取真实身份、会话、代理、Cookies 或客户端资料，不操作已安装客户端。浏览器仅访问本机演示服务器，其他请求均被阻止。已逐张视觉检查并核对尺寸；PNG 仅包含 `IHDR`、`IDAT`、`IEND` 图像块，没有文本或 EXIF 元数据。文档截图不作为真实账号功能验收证据，也不触发软件重建。
