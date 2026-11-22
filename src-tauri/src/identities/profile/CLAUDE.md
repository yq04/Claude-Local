# identities/profile/
当前/已保存身份只读摘要、`quota_ledger.json` 内存合并、本地 `.claude/projects` 估算及后台待接管作业扫描子包（不修改 `.claude.json`、不联网、不覆盖 Python 单写者账本）。
> L3 | 父级: ../CLAUDE.md
mod.rs: `Current` / `Summary` / `ActiveSession` / `LiveSession` / `CURRENT_QUOTA_VERSION=7` 公共模型、`.claude.json` 单次有界读取与脱敏投影（`read`、`read_live`、`read_live_with_ledger`、`summarize_stage`、`summarize_stage_with_ledger`、`fresh_server_anchors_cover_both_windows`）及 `crate::identities::profile::*` 门面重导出；保留 `#[cfg(test)] #[path = "../quota_regression_tests.rs"] mod quota_regression_tests;` 挂接点。
local_usage.rs: `now_epoch_sec`、ISO 时间解析（`parse_iso_epoch_sec`）、`parse_reset_value`、Claude Code qHr 模型计费表（含 Fable/Mythos 5.1/5.2 与 `fast`/`ultrafast`/`us` 倍率）、`(len, mtime_nanos)` 文件缓存、`MAX_JSONL_SCAN_BYTES` 有界扫描、全局 `(message.id, requestId)` 去重、自适应窗口标定与 `extract_quota`（零依赖其他 `profile` 子模块）。
ledger.rs: `quota_identity` SHA-256 账号指纹、账本账号/组织匹配（严格区分组织 UUID 与遗留账号锚点）、`merge_server_anchor`、`window_source` / `set_quota_evidence` / `set_summary_quota_evidence` / `cached_reset_inference`、`read_ledger_root`、`apply_anchor_scoped_extras`（Ultra `no_five_hour` 静息与 `scoped_fable_7d`）、`enforce_plan_quota_limits`、`apply_web_plan_tier` 与 `apply_ledger_to_summary` / `apply_parsed_ledger_to_summary`。
adopt_sessions.rs: `.claude/jobs/<short>/adopt.json` 活 Shell PID / 活跃 Agent 转录文件验证（`job_dir_has_live_adopt`、`live_adopt_referenced_paths`、`active_adopt_jobs`）及运行中进程到 `LiveSession` 的投影（`active_sessions_from_processes`）。
tests.rs: 单次读取投影、新鲜锚点跳过、账本账号隔离、OAuth 与订阅到期隔离及套餐降级清零的离线单元测试（`#[cfg(test)]`）。
[PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
