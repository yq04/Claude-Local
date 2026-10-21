<!--
[INPUT]: Owner-supplied Tianshu-harness review and handoff design, current implementation results, and source-level compatibility boundaries.
[OUTPUT]: Explicit adoption decisions and independently scoped follow-up implementation tasks.
[POS]: Addendum integration record; preserves the original review files and distinguishes verified facts from interpretations.
[PROTOCOL]: Do not overwrite concurrent review/HANDOFF changes; no real account, installer, config or process operations during development.
-->
# Tianshu 补充材料采纳记录

日期：2026-10-21。用户要求吸收有价值内容并继续完善，原额度与安全修复继续有效。

## 直接采纳的工程内容

1. **设备标识与账号凭据分离（S13）。** 核查 `ACCOUNT_KEYS` 和桌面清理目标；保护设备/客户端标识与 UI/实验设置，只处理实际账号凭据、账号归属元数据和必要缓存。修改前核对旧归档 manifest 验收与恢复规则，不能因收缩写入白名单而拒绝旧 `.baga`，也不能把旧归档中的设备标识再写回当前设备。
2. **额度采集接入自检（S14）。** 不把“本地没有新观测”只解释成账号未知。区分未配置、自定义 statusLine、采集器缺失、配置无效和正常接入，并展示可信观测时间。优先保护已有 statusLine；任何接入/撤销必须由用户明确触发，只改 settings.json 的 statusLine 键，保留其他键，不写 `.claude.json`、不轮询 OAuth。
3. **项目映射与历史目录的策略区分。** `policy.projects` 对应配置内的项目映射键，`.claude/projects` 会话目录由 `history` 控制。保持现有布尔语义，补解释与针对性断言，不按名称猜作用域。
4. **回滚被进程阻断。** 覆盖恢复标记保留和可执行错误指引；不为强行回滚结束用户进程，不把进程状态不可读当作进程安全停止。
5. **一次性安装器验证诚实记录。** 没有环境就保留未执行，不用本机文件替换或合成编译代替真实安装验证。

## 已落实或正在落实的部分

Q01 已有先红后绿的合成回归，修复真实观测被较新归档/计算时间覆盖；原始会话不再被读取、备份或切换路径改写。额度来源、未知值和时间已进入有界前端契约，浏览器与菜单改动继续整合。

## 独立处理任务交接设计

保留“不改会话原件、不复制登录状态、不自动按额度换号、明确用户触发”的设计原则。任务交接与可恢复的账号会话包是不同功能，不合并到身份切换事务。

首先提供不读取会话正文的可编辑交接模板，供用户自行填写目标、当前进度、下一步和约束，并明确预览/复制。原始会话导入导出、新魔数/密码体系、会话正文抽取保留为独立后续设计；它们不因这份增补就自动改变 BAGAID01 或现有档案格式。

不会声称仅过滤 `thinking`、工具块、邮箱或某些前缀就能保证摘要不含秘密；普通 user/assistant 文本同样可能有敏感内容。模板不把 `git diff --stat` 等同于“已经完成并验证的工作”。

## 保留判断的内容

第三方帖子、star 数和源码注释不证明服务端风控机制或某种操作必然违规。官方原文与工程观察分开记录；AUP 段落编号属于增补作者的内部编号，不冒充官方条款号。

是否存在合作式 OS 锁可直接从代码核验，但“缺锁”不等于已证明正常产品入口会造成并发损失。锁设计仍需处理线程所有权、异常释放、恢复状态和旧版本不配合的限制，不依靠未知的 Claude 内部锁协议。

本次保持私有分发边界与已有许可声明，不更改仓库可见性，也不把“开源前清单”误当作已获公开发布授权。
