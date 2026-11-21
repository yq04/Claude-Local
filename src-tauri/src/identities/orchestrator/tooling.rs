// [INPUT]: 内嵌 claude-relay.ps1 / claude-subagent.ps1、用户主目录 ~/.local/bin 与 ~/.claude/agents、Store 净室切号事务及可选启动工作目录。
// [OUTPUT]: 原生 relay_switch 切号（含防封交接文件路径 handoff_md_path / handoff_json_path、纯后台守护进程自动优雅挂起保活 Shell、1500ms 进程收敛轮询、切号成功后延后提交冷却/单向防回跳锁与 `rate_limited` 归因）、~/.local/bin 五件套包装脚本 + ~/.claude/agents/pro-pool-worker.md（Haiku 5.5 + low effort + PowerShell + 单行 bash）原子无 BOM LF 部署（零触碰 ~/.claude/settings.json）、以及脱离 Job Object 的 `-NoProfile` Windows Terminal / PowerShell 交互终端一键拉起。
// [POS]: orchestrator CLI 工具与主配置切号执行层；所有写盘经 private 边界并严格校验符号链接。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{
    config::{
        acquire_orchestrate_lock, load_config, save_config, truncate_display, DEFAULT_COOLDOWN_SEC,
        NO_RETURN_COOLDOWN_SEC, STRIP_SLOT_ENV_KEYS,
    },
    evaluator::{evaluate_pool, ResetCardAccountView},
};
use crate::{
    cleaner::{self, ClaudeProcess},
    identities::{private, store::Store, valid_id, Policy},
    progress::Reporter,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CLAUDE_RELAY_PS1: &str = include_str!("../../../../scripts/claude-relay.ps1");
const CLAUDE_SUBAGENT_PS1: &str = include_str!("../../../../scripts/claude-subagent.ps1");

#[derive(Clone, Debug, Serialize)]
pub struct RelaySwitchResult {
    pub schema: u8,
    pub ok: bool,
    pub switched: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_record_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_effective_rem: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soonest_reset_ts: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soonest_reset_eta_sec: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soonest_reset_name: Option<String>,
    pub awaiting_reset_accounts: Vec<ResetCardAccountView>,
    pub reset_card_accounts: Vec<ResetCardAccountView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff_md_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff_json_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct InstallWrappersResult {
    pub schema: u8,
    pub ok: bool,
    pub installed: bool,
    pub dir: String,
    pub files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LaunchRelayCliResult {
    pub schema: u8,
    pub ok: bool,
    pub terminal: String,
    pub cwd: String,
}

#[allow(clippy::too_many_arguments)]
#[cfg_attr(test, allow(dead_code))]
pub(super) fn poll_until_non_slot_stopped<F>(
    app_data_dir: &Path,
    initial_blocking: Vec<ClaudeProcess>,
    max_wait_ms: u64,
    step_ms: u64,
    mut fetch_procs: F,
) -> bool
where
    F: FnMut() -> Vec<ClaudeProcess>,
{
    if initial_blocking.is_empty() {
        return true;
    }
    let step = step_ms.max(1);
    let max_attempts = (max_wait_ms / step).max(1);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(max_wait_ms);
    for _ in 0..max_attempts {
        std::thread::sleep(std::time::Duration::from_millis(step));
        let remaining =
            cleaner::identity::filter_non_slot_processes(Some(app_data_dir), fetch_procs());
        if remaining.is_empty() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
    }
    false
}

pub(crate) fn relay_switch_in(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    strategy_override: Option<&str>,
    threshold_override: Option<u8>,
    rate_limited: Option<bool>,
    from_record_id: Option<&str>,
    now_sec: u64,
    procs: &[ClaudeProcess],
) -> RelaySwitchResult {
    let _lock = match acquire_orchestrate_lock(app_data_dir) {
        Ok(g) => g,
        Err(e) => {
            return RelaySwitchResult {
                schema: 1,
                ok: false,
                switched: false,
                from_record_id: None,
                from_name: None,
                target_id: None,
                target_name: None,
                target_effective_rem: None,
                reason: Some(e.clone()),
                error: Some(e),
                soonest_reset_ts: None,
                soonest_reset_eta_sec: None,
                soonest_reset_name: None,
                awaiting_reset_accounts: Vec::new(),
                reset_card_accounts: Vec::new(),
                handoff_md_path: None,
                handoff_json_path: None,
            }
        }
    };

    let non_slot_procs =
        cleaner::identity::filter_non_slot_processes(Some(app_data_dir), procs.to_vec());
    let effective_procs_vec: Vec<ClaudeProcess> = if !non_slot_procs.is_empty()
        && non_slot_procs.iter().all(|p| p.role().is_background())
    {
        let _ = cleaner::park_if_only_background_in(Some(app_data_dir));
        #[cfg(test)]
        {
            procs
                .iter()
                .filter(|p| !p.role().is_background())
                .cloned()
                .collect()
        }
        #[cfg(not(test))]
        {
            cleaner::identity::running_processes()
        }
    } else {
        procs.to_vec()
    };
    let procs = effective_procs_vec.as_slice();

    let mut cfg = load_config(app_data_dir);

    let pre_eval = match evaluate_pool(
        app_data_dir,
        vault,
        home,
        now_sec,
        procs,
        threshold_override,
        strategy_override,
    ) {
        Ok(ev) => ev,
        Err(e) => {
            return RelaySwitchResult {
                schema: 1,
                ok: false,
                switched: false,
                from_record_id: None,
                from_name: None,
                target_id: None,
                target_name: None,
                target_effective_rem: None,
                reason: Some(e.clone()),
                error: Some(e),
                soonest_reset_ts: None,
                soonest_reset_eta_sec: None,
                soonest_reset_name: None,
                awaiting_reset_accounts: Vec::new(),
                reset_card_accounts: Vec::new(),
                handoff_md_path: None,
                handoff_json_path: None,
            }
        }
    };

    let mut effective_from = from_record_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(pre_eval.active.as_str())
        .to_string();

    let outgoing_r5 = if valid_id(&effective_from) {
        pre_eval
            .accounts
            .iter()
            .find(|a| a.id == effective_from)
            .and_then(|a| a.quota_5h_reset_at)
            .filter(|&r5| r5 > now_sec)
    } else {
        let ledger_root = crate::identities::profile::read_ledger_root(vault);
        crate::identities::profile::read_live_with_ledger(home, vault, ledger_root.as_ref())
            .quota_5h_reset_at
            .filter(|&r5| r5 > now_sec)
    };

    let compute_cooldown_dur = |r5_opt: Option<u64>| -> u64 {
        let mut dur = DEFAULT_COOLDOWN_SEC;
        if let Some(r5) = r5_opt {
            let rem = r5.saturating_sub(now_sec);
            if (60..dur).contains(&rem) {
                dur = rem;
            }
        }
        dur
    };

    let pending_rate_limit_penalty = rate_limited == Some(true) && valid_id(&effective_from);

    let eval = match evaluate_pool(
        app_data_dir,
        vault,
        home,
        now_sec,
        procs,
        threshold_override,
        strategy_override,
    ) {
        Ok(ev) => ev,
        Err(e) => {
            return RelaySwitchResult {
                schema: 1,
                ok: false,
                switched: false,
                from_record_id: Some(effective_from),
                from_name: Some(pre_eval.active_name),
                target_id: None,
                target_name: None,
                target_effective_rem: None,
                reason: Some(e.clone()),
                error: Some(e),
                soonest_reset_ts: None,
                soonest_reset_eta_sec: None,
                soonest_reset_name: None,
                awaiting_reset_accounts: pre_eval.awaiting_reset_accounts,
                reset_card_accounts: pre_eval.reset_card_accounts,
                handoff_md_path: None,
                handoff_json_path: None,
            }
        }
    };

    if eval.recovery.is_some() {
        return RelaySwitchResult {
            schema: 1,
            ok: false,
            switched: false,
            from_record_id: Some(effective_from),
            from_name: Some(eval.active_name),
            target_id: None,
            target_name: None,
            target_effective_rem: None,
            reason: Some("relay.error.recoveryPending".into()),
            error: Some("请先恢复未完成的身份切换。".into()),
            soonest_reset_ts: None,
            soonest_reset_eta_sec: None,
            soonest_reset_name: None,
            awaiting_reset_accounts: eval.awaiting_reset_accounts,
            reset_card_accounts: eval.reset_card_accounts,
            handoff_md_path: None,
            handoff_json_path: None,
        };
    }

    let target_id_opt = eval
        .ranked_auto_targets
        .iter()
        .find(|id| !(pending_rate_limit_penalty && id.as_str() == effective_from.as_str()))
        .cloned();
    let Some(target_id) = target_id_opt else {
        let mut soonest: Option<(u64, String)> = None;
        for a in &eval.accounts {
            if a.excluded {
                continue;
            }
            for ts in [a.quota_5h_reset_at, a.quota_7d_reset_at]
                .into_iter()
                .flatten()
            {
                if ts > now_sec {
                    let take = soonest.as_ref().is_none_or(|(prev, _)| ts < *prev);
                    if take {
                        soonest = Some((ts, a.name.clone()));
                    }
                }
            }
        }
        return RelaySwitchResult {
            schema: 1,
            ok: true,
            switched: false,
            from_record_id: Some(effective_from),
            from_name: Some(eval.active_name),
            target_id: None,
            target_name: None,
            target_effective_rem: None,
            reason: Some("all_exhausted".into()),
            error: None,
            soonest_reset_ts: soonest.as_ref().map(|(ts, _)| *ts),
            soonest_reset_eta_sec: soonest
                .as_ref()
                .map(|(ts, _)| ts.saturating_sub(now_sec)),
            soonest_reset_name: soonest.map(|(_, name)| name),
            awaiting_reset_accounts: eval.awaiting_reset_accounts,
            reset_card_accounts: eval.reset_card_accounts,
            handoff_md_path: None,
            handoff_json_path: None,
        };
    };

    let target_acct = eval.accounts.iter().find(|a| a.id == target_id).cloned();
    let save_name = truncate_display(&eval.active_name, 64)
        .unwrap_or_else(|| "Claude Account".to_string());
    let mut store = match Store::open(vault, home) {
        Ok(s) => s,
        Err(e) => {
            return RelaySwitchResult {
                schema: 1,
                ok: false,
                switched: false,
                from_record_id: Some(effective_from),
                from_name: Some(eval.active_name),
                target_id: Some(target_id),
                target_name: target_acct.as_ref().map(|a| a.name.clone()),
                target_effective_rem: target_acct.as_ref().map(|a| a.effective_rem),
                reason: Some(e.clone()),
                error: Some(e),
                soonest_reset_ts: None,
                soonest_reset_eta_sec: None,
                soonest_reset_name: None,
                awaiting_reset_accounts: eval.awaiting_reset_accounts,
                reset_card_accounts: eval.reset_card_accounts,
                handoff_md_path: None,
                handoff_json_path: None,
            }
        }
    };

    let outgoing_unsaved_key = if !valid_id(&effective_from) {
        store.live_account_key()
    } else {
        None
    };

    let still_running = {
        let initial_blocking =
            cleaner::identity::filter_non_slot_processes(Some(app_data_dir), procs.to_vec());
        if initial_blocking.is_empty() {
            false
        } else {
            #[cfg(test)]
            {
                true
            }
            #[cfg(not(test))]
            {
                !poll_until_non_slot_stopped(
                    app_data_dir,
                    initial_blocking,
                    1500,
                    150,
                    cleaner::identity::running_processes,
                )
            }
        }
    };
    if still_running {
        let err_msg = "请先结束 Claude 进程，再切换身份。".to_string();
        return RelaySwitchResult {
            schema: 1,
            ok: false,
            switched: false,
            from_record_id: Some(effective_from),
            from_name: Some(eval.active_name),
            target_id: Some(target_id),
            target_name: target_acct.as_ref().map(|a| a.name.clone()),
            target_effective_rem: target_acct.as_ref().map(|a| a.effective_rem),
            reason: Some(err_msg.clone()),
            error: Some(err_msg),
            soonest_reset_ts: None,
            soonest_reset_eta_sec: None,
            soonest_reset_name: None,
            awaiting_reset_accounts: eval.awaiting_reset_accounts,
            reset_card_accounts: eval.reset_card_accounts,
            handoff_md_path: None,
            handoff_json_path: None,
        };
    }

    if let Err(e) = store.switch(
        &target_id,
        &save_name,
        &Policy::default(),
        &Reporter::channel(None),
    ) {
        return RelaySwitchResult {
            schema: 1,
            ok: false,
            switched: false,
            from_record_id: Some(effective_from),
            from_name: Some(eval.active_name),
            target_id: Some(target_id),
            target_name: target_acct.as_ref().map(|a| a.name.clone()),
            target_effective_rem: target_acct.as_ref().map(|a| a.effective_rem),
            reason: Some(e.clone()),
            error: Some(e),
            soonest_reset_ts: None,
            soonest_reset_eta_sec: None,
            soonest_reset_name: None,
            awaiting_reset_accounts: eval.awaiting_reset_accounts,
            reset_card_accounts: eval.reset_card_accounts,
            handoff_md_path: None,
            handoff_json_path: None,
        };
    }

    let (handoff_md_path, handoff_json_path) = match store.last_handoff.take() {
        Some((md, json)) => (
            Some(md.to_string_lossy().into_owned()),
            Some(json.to_string_lossy().into_owned()),
        ),
        None => (None, None),
    };

    let mut newly_archived_unsaved = false;
    if !valid_id(&effective_from) {
        if let Some(archived_id) = outgoing_unsaved_key
            .as_deref()
            .and_then(|k| store.db.by_account(k).ok().flatten())
            .map(|r| r.id)
            .filter(|id| valid_id(id) && id != &target_id)
        {
            effective_from = archived_id;
            newly_archived_unsaved = true;
            if let Some(cd_ts) = cfg.cooldown_until_sec.remove("current") {
                if cd_ts > now_sec {
                    cfg.cooldown_until_sec.insert(effective_from.clone(), cd_ts);
                }
            }
        }
    }

    let next_tick = cfg
        .rotation_tick
        .values()
        .copied()
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    cfg.rotation_tick.insert(target_id.clone(), next_tick);
    if (pending_rate_limit_penalty || newly_archived_unsaved) && rate_limited == Some(true) && valid_id(&effective_from) {
        let dur = compute_cooldown_dur(outgoing_r5);
        cfg.cooldown_until_sec
            .insert(effective_from.clone(), now_sec + dur);
        if cfg.rate_limit_mode == "sink_to_end" {
            let next_sink = cfg
                .sunk_order
                .values()
                .copied()
                .max()
                .unwrap_or(0)
                .saturating_add(1);
            cfg.sunk_order.insert(effective_from.clone(), next_sink);
        }
    } else if cfg.rate_limit_mode == "sink_to_end"
        && valid_id(&effective_from)
        && rate_limited != Some(true)
    {
        let next_sink = cfg
            .sunk_order
            .values()
            .copied()
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        cfg.sunk_order.insert(effective_from.clone(), next_sink);
    }
    if cfg.no_return_account_id.as_deref() == Some(target_id.as_str()) {
        cfg.no_return_account_id = None;
        cfg.no_return_until_sec = 0;
    }
    if valid_id(&effective_from) && effective_from != target_id {
        if let Some(r5) = outgoing_r5 {
            cfg.no_return_account_id = Some(effective_from.clone());
            cfg.no_return_until_sec = r5;
        } else if rate_limited == Some(true) {
            cfg.no_return_account_id = Some(effective_from.clone());
            cfg.no_return_until_sec = now_sec + NO_RETURN_COOLDOWN_SEC;
        }
    }
    let _ = save_config(app_data_dir, &cfg);

    let reason = if rate_limited == Some(true) {
        "rate_limited"
    } else if eval.preferred_return_target.as_deref() == Some(target_id.as_str()) {
        "preferred_recovered"
    } else {
        "threshold_reached"
    };

    RelaySwitchResult {
        schema: 1,
        ok: true,
        switched: true,
        from_record_id: Some(effective_from),
        from_name: Some(eval.active_name),
        target_id: Some(target_id),
        target_name: target_acct.as_ref().map(|a| a.name.clone()),
        target_effective_rem: target_acct.as_ref().map(|a| a.effective_rem),
        reason: Some(reason.into()),
        error: None,
        soonest_reset_ts: None,
        soonest_reset_eta_sec: None,
        soonest_reset_name: None,
        awaiting_reset_accounts: eval.awaiting_reset_accounts,
        reset_card_accounts: eval.reset_card_accounts,
        handoff_md_path,
        handoff_json_path,
    }
}

fn ensure_utf8_bom_lf(script: &str) -> Vec<u8> {
    let normalized = script.replace("\r\n", "\n");
    let body = normalized.strip_prefix('\u{FEFF}').unwrap_or(&normalized);
    let mut out = Vec::with_capacity(body.len() + 3);
    out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    out.extend_from_slice(body.as_bytes());
    out
}

fn ensure_utf8_nobom_lf(text: &str) -> Vec<u8> {
    let normalized = text.replace("\r\n", "\n");
    normalized
        .strip_prefix('\u{FEFF}')
        .unwrap_or(&normalized)
        .as_bytes()
        .to_vec()
}

fn cmd_shim_bytes(ps1_filename: &str) -> Vec<u8> {
    format!(
        "@echo off\r\n\
setlocal\r\n\
where pwsh.exe >nul 2>nul\r\n\
if %errorlevel%==0 (\r\n\
  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"%~dp0{ps1_filename}\" %*\r\n\
) else (\r\n\
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"%~dp0{ps1_filename}\" %*\r\n\
)\r\n\
exit /b %ERRORLEVEL%\r\n"
    )
    .into_bytes()
}

pub(super) fn pro_pool_worker_markdown() -> &'static str {
    "---\n\
name: pro-pool-worker\n\
description: Delegate scoped subtasks to an isolated secondary Claude Pro/Max slot via ~/.local/bin/claude-subagent.ps1 without switching ~/.claude.\n\
model: claude-haiku-5-5\n\
effort: low\n\
tools: PowerShell, Bash, Read, Grep, Glob\n\
---\n\
\n\
# Pro Pool Worker\n\
\n\
Run secondary-account subtasks in an isolated `CLAUDE_CONFIG_DIR` slot via `~/.local/bin/claude-subagent.ps1`.\n\
\n\
```bash\n\
pwsh -NoProfile -ExecutionPolicy Bypass -File \"$HOME/.local/bin/claude-subagent.ps1\" -PromptFile \"<path-to-task.md>\" -SessionTag \"<task-tag>\" -ReadOnly\n\
```\n\
\n\
Guidelines:\n\
- Before fanning out 3+ parallel subagents, run `pwsh -NoProfile -ExecutionPolicy Bypass -File \"$HOME/.local/bin/claude-subagent.ps1\" -Status` once to inspect `ready` slots and `Max Same-Exit Concurrency` (default 2), dispatching in waves of 2 to avoid `concurrency_capped` waits.\n\
- Omit `-AccountId` to let the pool auto-select and automatically fail over across healthy Pro slots on 429/auth errors.\n\
- Omit `-ReadOnly` only when the worker owns disjoint file edits.\n\
- Pass `-Resume <session-uuid>` from `[CL-SLOT-TRACE]` for follow-up turns on the same slot.\n"
}

fn install_pro_pool_worker_agent(home: &Path) -> Result<PathBuf, String> {
    let claude_dir = home.join(".claude");
    if let Ok(meta) = fs::symlink_metadata(&claude_dir) {
        if cleaner::linked(&meta) || !meta.is_dir() {
            return Err("relay.error.unsafeAgentPath".into());
        }
    }
    let agents_dir = claude_dir.join("agents");
    if let Ok(meta) = fs::symlink_metadata(&agents_dir) {
        if cleaner::linked(&meta) || !meta.is_dir() {
            return Err("relay.error.unsafeAgentPath".into());
        }
    }
    private::directory(&agents_dir)?;
    let agent_path = agents_dir.join("pro-pool-worker.md");
    if let Ok(meta) = fs::symlink_metadata(&agent_path) {
        if cleaner::linked(&meta) || meta.is_dir() {
            return Err("relay.error.unsafeAgentPath".into());
        }
    }
    let md_bytes = ensure_utf8_nobom_lf(pro_pool_worker_markdown());
    private::write(&agent_path, &md_bytes)?;
    Ok(agent_path)
}

pub(crate) fn install_wrappers_in(home: &Path) -> Result<InstallWrappersResult, String> {
    if let Ok(meta) = fs::symlink_metadata(home) {
        if cleaner::linked(&meta) {
            return Err("relay.error.homeUnavailable".into());
        }
    }
    let local_dir = home.join(".local");
    if let Ok(meta) = fs::symlink_metadata(&local_dir) {
        if cleaner::linked(&meta) || !meta.is_dir() {
            return Err("relay.error.homeUnavailable".into());
        }
    }
    let bin_dir = local_dir.join("bin");
    if let Ok(meta) = fs::symlink_metadata(&bin_dir) {
        if cleaner::linked(&meta) || !meta.is_dir() {
            return Err("relay.error.homeUnavailable".into());
        }
    }
    fs::create_dir_all(&bin_dir).map_err(|e| format!("创建 ~/.local/bin 失败: {e}"))?;

    let relay_ps1_bytes = ensure_utf8_bom_lf(CLAUDE_RELAY_PS1);
    let subagent_ps1_bytes = ensure_utf8_bom_lf(CLAUDE_SUBAGENT_PS1);
    let relay_cmd_bytes = cmd_shim_bytes("claude-relay.ps1");
    let cr_cmd_bytes = cmd_shim_bytes("claude-relay.ps1");
    let subagent_cmd_bytes = cmd_shim_bytes("claude-subagent.ps1");

    let items: [(&str, &[u8]); 5] = [
        ("claude-relay.ps1", &relay_ps1_bytes),
        ("claude-relay.cmd", &relay_cmd_bytes),
        ("cr.cmd", &cr_cmd_bytes),
        ("claude-subagent.ps1", &subagent_ps1_bytes),
        ("claude-subagent.cmd", &subagent_cmd_bytes),
    ];
    let mut written_files = Vec::with_capacity(items.len() + 1);
    for (name, bytes) in items {
        let dest = bin_dir.join(name);
        if let Ok(meta) = fs::symlink_metadata(&dest) {
            if cleaner::linked(&meta) {
                return Err("relay.error.unsafeAgentPath".into());
            }
        }
        if dest.exists() {
            cleaner::file_io::atomic_write(&dest, bytes, 0o755)
                .map_err(|e| format!("写入 {name} 失败: {e}"))?;
        } else {
            private::write(&dest, bytes).map_err(|e| format!("写入 {name} 失败: {e}"))?;
        }
        written_files.push(dest.to_string_lossy().into_owned());
    }

    let agent_path = install_pro_pool_worker_agent(home)?;
    let agent_path_str = agent_path.to_string_lossy().into_owned();
    written_files.push(agent_path_str.clone());

    Ok(InstallWrappersResult {
        schema: 1,
        ok: true,
        installed: true,
        dir: bin_dir.to_string_lossy().into_owned(),
        files: written_files,
        agent_path: Some(agent_path_str),
    })
}

pub(crate) fn validate_launch_cwd(home: &Path, cwd: Option<&str>) -> Result<PathBuf, String> {
    let raw = match cwd.map(str::trim).filter(|s| !s.is_empty()) {
        Some(path_str) => {
            if path_str.len() > 520 || path_str.chars().any(char::is_control) {
                return Err("relay.error.invalidLaunchCwd".into());
            }
            PathBuf::from(path_str)
        }
        None => home.to_path_buf(),
    };
    let meta = fs::metadata(&raw).map_err(|_| "relay.error.invalidLaunchCwd".to_string())?;
    if !meta.is_dir() {
        return Err("relay.error.invalidLaunchCwd".into());
    }
    dunce::canonicalize(&raw).map_err(|_| "relay.error.invalidLaunchCwd".into())
}

fn find_exe_on_path(exe_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(exe_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn scrub_child_env(cmd: &mut Command, bin_dir: &Path, _home: &Path) {
    for key in STRIP_SLOT_ENV_KEYS {
        cmd.env_remove(key);
    }
    for key in super::config::PROXY_ENV_KEYS_URL {
        cmd.env_remove(key);
    }
    cmd.env("DISABLE_TELEMETRY", "1");
    cmd.env("DISABLE_ERROR_REPORTING", "1");
    cmd.env("DO_NOT_TRACK", "1");
    cmd.env("NO_PROXY", "localhost,127.0.0.1,::1");
    cmd.env("no_proxy", "localhost,127.0.0.1,::1");
    let mut paths = vec![bin_dir.to_path_buf()];
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        cmd.env("PATH", joined);
    }
}

pub(crate) fn launch_relay_cli_in(
    home: &Path,
    cwd: Option<&str>,
    auto_continue: Option<bool>,
    extra_args: Option<&[String]>,
) -> Result<LaunchRelayCliResult, String> {
    let clean_cwd = validate_launch_cwd(home, cwd)?;
    let installed = install_wrappers_in(home)?;
    let bin_dir = PathBuf::from(&installed.dir);
    let relay_ps1 = bin_dir.join("claude-relay.ps1");

    let mut ps_args: Vec<String> = vec![
        "-NoProfile".into(),
        "-NoExit".into(),
        "-NoLogo".into(),
        "-ExecutionPolicy".into(),
        "Bypass".into(),
        "-File".into(),
        relay_ps1.to_string_lossy().into_owned(),
    ];
    match auto_continue {
        Some(true) => ps_args.push("-AutoContinue".into()),
        Some(false) => ps_args.push("-AutoContinue:$false".into()),
        None => {}
    }
    if let Some(args) = extra_args {
        for arg in args.iter().take(32) {
            if !arg.is_empty() && arg.len() <= 512 && !arg.chars().any(char::is_control) {
                ps_args.push(arg.clone());
            }
        }
    }

    let cwd_str = clean_cwd.to_string_lossy().into_owned();

    #[cfg(target_os = "windows")]
    {
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

        let ps_exe = find_exe_on_path("pwsh.exe")
            .unwrap_or_else(|| PathBuf::from("powershell.exe"));

        // Windows Terminal treats `;` as a multi-pane command delimiter; fall back to direct
        // console launch whenever `cwd_str` or forwarded args contain `;`.
        let wt_safe = !cwd_str.contains(';') && !ps_args.iter().any(|a| a.contains(';'));
        let wt_exe = if wt_safe {
            find_exe_on_path("wt.exe").or_else(|| {
                std::env::var_os("LOCALAPPDATA")
                    .map(PathBuf::from)
                    .map(|p| p.join("Microsoft/WindowsApps/wt.exe"))
                    .filter(|p| p.exists())
            })
        } else {
            None
        };

        if let Some(wt) = wt_exe {
            let mut cmd = Command::new(&wt);
            cmd.current_dir(&clean_cwd)
                .args(["-w", "0", "nt", "-d", &cwd_str, "--title", "Claude Relay"])
                .arg(&ps_exe)
                .args(&ps_args);
            scrub_child_env(&mut cmd, &bin_dir, home);
            if cmd.spawn().is_ok() {
                return Ok(LaunchRelayCliResult {
                    schema: 1,
                    ok: true,
                    terminal: "wt".into(),
                    cwd: cwd_str,
                });
            }
        }

        for shell_name in ["pwsh.exe", "powershell.exe"] {
            let shell_path = find_exe_on_path(shell_name)
                .unwrap_or_else(|| PathBuf::from(shell_name));
            for flags in [
                CREATE_NEW_CONSOLE | CREATE_BREAKAWAY_FROM_JOB,
                CREATE_NEW_CONSOLE,
            ] {
                let mut cmd = Command::new(&shell_path);
                cmd.current_dir(&clean_cwd)
                    .args(&ps_args)
                    .creation_flags(flags);
                scrub_child_env(&mut cmd, &bin_dir, home);
                if cmd.spawn().is_ok() {
                    return Ok(LaunchRelayCliResult {
                        schema: 1,
                        ok: true,
                        terminal: shell_name.trim_end_matches(".exe").to_string(),
                        cwd: cwd_str,
                    });
                }
            }
        }
        Err("relay.error.launchTerminalFailed".into())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("pwsh");
        cmd.current_dir(&clean_cwd).args(&ps_args);
        scrub_child_env(&mut cmd, &bin_dir, home);
        cmd.spawn()
            .map(|_| LaunchRelayCliResult {
                schema: 1,
                ok: true,
                terminal: "pwsh".into(),
                cwd: cwd_str,
            })
            .map_err(|_| "relay.error.launchTerminalFailed".into())
    }
}
