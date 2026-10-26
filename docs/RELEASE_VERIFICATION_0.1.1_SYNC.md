<!--
[INPUT]: Pinned source CI, neutral Windows package audit, backed-up local deployment and GitHub asset metadata.
[OUTPUT]: Exact 0.1.1 delivery facts and explicit validation limits.
[POS]: Public-safe verification record; machine paths, process lists and private probes remain ignored.
-->
# 0.1.1 状态同步补丁交付核验

更新：2026-10-26。本文件描述 0.1.1 补丁交付核验；早期内部草案不代替本次发布回执。

修复与用户操作见 [AUTH_SYNC_0.1.1.md](AUTH_SYNC_0.1.1.md)。本次没有代账号持有人发消息验证权限。

## 固定源码与附件

- 固定源码：`a558efd29b0b46bf85edee4eb8f8b24e2545989a`；产品标签`v0.1.1`，既有 v0.1.0 保留。
- [发布页面](https://github.com/yq04/Claude-Local/releases/tag/v0.1.1)：附件仅安装器，无私有探针、账号数据库、浏览器资料、工作站备份或内部日志。
- 安装器：`Claude-Local_0.1.1_x64-setup.exe`，140,490,055 字节。
- 安装器SHA256：`4f53501f52852cc447700bb97ad0573933824af38aff33ef288aae01d9327a2b`。GitHub资产size和服务端digest已精确验证，不只核对上传命令退出码。
- package.json、tauri.conf.json、Cargo.toml和Cargo.lock中的产品版本一致为0.1.1。

## 构建、审计与本机更新

使用新的中性Cargo home/target，位于仓库和USERPROFILE之外，仅复制公共注册表缓存；发布启用custom-protocol。NSIS只读解包审计109文件、13项外部隐私探针，0发现。探针正文未进入仓库或附件。

本机102项应用文件与审计清单匹配，9项实际变更，先备份/hash/stage、宿主最后替换并验证启动。当前本机版本0.1.1，纯JSON quota-core管道冒烟通过，原Claude Code进程完整保留（missingClaudeCount=0），浏览器未被终止。

安装器解包NSS宿主及本机宿主SHA256均为`103c59c62e563ab7fca1ed4f11f9560db5cf91c1576b8c1aee1c851e44fcef88`；中性原始UNK宿主为`31bf44c6192b45a2adc805d5c2f8f7d07b040aebce51477f64c2259379cc4115`。差异是审计确认的3字节Tauri NSIS包格式标记，不是另一次源码构建。

更新后的白名单只读运行投影确认：自动开关仍为关闭，3个账号全部有能力和decision、unknown=0。历史授权阻断保留，未因本地valid或网页登录而伪造恢复。已打开的核验页需由用户刷新以加载新前端，不为更新关闭浏览器。

## 验证与边界

本地49项独立Bun定向测试、19项Rust定向测试、13项续杯GUI和8项浏览器GUI均通过，TypeScript及发布前端构建通过。合成GUI验证760px中英文无横向溢出，并验证18项通过、2项未知时整体显示黄色“检测未完成”，明确不符项仍失败。旧GUI夹具补齐确定的分类/RTC输入；未放宽产品验证标准。

[CI 40283578357](https://github.com/yq04/Claude-Local/actions/runs/40283578357) 对固定源码全部成功：Bun132通过；原生246通过1忽略、另1项检查通过；离线浏览器4通过，额度/运行资源/迁移100通过2跳过，Windows CLI19通过。

真实账号messages权限、NSIS安装/卸载、版本降级与睡眠/恢复仍未验收；后几项只在一次性Windows环境验证。本次文件式更新不替代安装验收，也不解决另行列出的第三方许可与公开合规核对。不改变兼容格式、应用ID、数据路径或浏览器种子。没有设计偏差。
