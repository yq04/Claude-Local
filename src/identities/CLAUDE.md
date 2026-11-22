# identities/
身份工作台弹窗与卡片原语子模块，由 `../identities.tsx`（`IdentityPanel` 壳层）统一编排。
> L3 | 父级: ../CLAUDE.md
IdentityCardPrimitives.tsx: 共享工牌与弹窗纯呈现原语（`QuotaWindow`、`IdentityQuota`、`SubscriptionAndResets`、`IdentityName`、`IdentityCard`）、类型契约及 `sameStringArrays` / `sameActiveSessions` / `sameSlotSessions` / `canQueryLiveSessions` 等比较辅助；保持 `166×286` 卡片几何、零 `transform` 拖拽过渡与可访问性属性不变。
WakeupModal.tsx: 受控在线额度批量查询与 5h 自动续杯弹窗（`identity-online-query-dialog`，宽 `680`）；仅在 `open` 为真时懒挂载行列表并渲染 `<IdentityConnections />`，保持 `fallbackFocusRef={quotaOpenerRef}`。
SmartRelayModal.tsx: 受控多账号智能接力与 CLI 编排弹窗（`identity-relay-dialog`，宽 `720`）；持有弹窗内 CLI 包装安装、槽位代理草稿/错误与绑定浏览器同步状态，保留 `.identity-relay-banner-actions`、`.identity-relay-awaiting-pill`、单轴全宽表单对齐及 `{open ? (...) : null}` 懒挂载。
QuotaDetailsModal.tsx: 受控额度详情弹窗（`quota-details-dialog`，宽 `600`）；持有 `quota_setup_status` 与版本诊断读取及只读诊断复制，通过 `restoreFocus={!suppressQuotaRestoreFocus}` 维持切往 `WakeupModal` / 过期时间编辑器的焦点交接。
IdentityActionDialogs.tsx: 受控渲染 7 类身份操作确认与编辑弹窗（返回 CLI 浏览器、暂存当前身份、切换/转正/恢复确认、删除、浏览器核验、重命名、订阅到期与套餐校准）；复用本地 `LiveCliContinuityCallouts` 辅助并保持全部 `data-*` 选择器与 AlertDialog 焦点契约。
[PROTOCOL]: 变更子模块边界、弹窗宽度或焦点引用时更新此文件与 ../CLAUDE.md
