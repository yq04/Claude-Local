// [INPUT]: vault/identity-vault、app_data_dir/smart_relay_v1.json、cli-slots/<32-hex>、默认 ~/.claude 与 ~/.claude.json、--orchestrate stdin JSON 及 Tauri 命令调用。
// [OUTPUT]: 模块化 SmartRelay 原生评估器、多路子代理隔离槽位获取/释放、--orchestrate 无头协议与 6 个 Tauri 命令（查询/保存/清除单个冷却/安装包装器+子代理定义/释放槽位/一键启动接力终端）。
// [POS]: 原生多路接力编排与子代理槽位隔离门面层；聚合 config/evaluator/slots/tooling 子模块，保持对外 API 简洁清晰。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
pub(crate) mod config;
pub(super) mod evaluator;
pub(super) mod slots;
#[cfg(test)]
mod tests;
pub(super) mod tooling;

pub use config::SmartRelayConfig;
pub(crate) use config::{acquire_orchestrate_lock, load_config, now_epoch_sec, save_config};
#[cfg(test)]
pub(crate) use config::validate_config_strict;

pub use evaluator::OrchestratorStateView;
pub(crate) use evaluator::{
    monitor_relay_snapshot_with_context, orchestrator_state_in,
    orchestrator_state_with_overrides_in,
};
// Single-purpose wrapper kept for regression tests / backwards compatibility.
#[cfg(test)]
pub(crate) use evaluator::monitor_relay_snapshot;
#[cfg(test)]
pub(crate) use evaluator::active_reset_cards;

pub use slots::SlotReleaseResult;
pub(crate) use slots::{
    derive_slot_anonymous_id, derive_slot_first_start_time, derive_slot_machine_id,
    derive_slot_user_id, live_slot_pids_in_dir, remove_idle_slot_dir, scrub_idle_slot_artifacts,
    slot_acquire_in, slot_lease_fresh_by_mtime, slot_pids_by_record, slot_release_in,
    slot_sessions_by_record,
};

pub use tooling::{InstallWrappersResult, LaunchRelayCliResult};
pub(crate) use tooling::{install_wrappers_in, launch_relay_cli_in};
#[cfg(test)]
pub(crate) use tooling::relay_switch_in;
#[cfg(test)]
pub(crate) use tooling::validate_launch_cwd;

use crate::cleaner::{identity, ClaudeProcess};
use config::{default_schema_one, ORCHESTRATE_STDIN_MAX_BYTES};
use serde::Deserialize;
use std::{
    io::{self, Read},
    path::Path,
};
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct CliRequest {
    #[serde(default = "default_schema_one")]
    schema: u8,
    op: String,
    #[serde(default)]
    strategy: Option<String>,
    #[serde(default, alias = "thresholdPct")]
    threshold_pct: Option<u8>,
    #[serde(default, alias = "rateLimited")]
    rate_limited: Option<bool>,
    #[serde(default, alias = "authError")]
    auth_error: Option<bool>,
    #[serde(default, alias = "retryAfterSec")]
    retry_after_sec: Option<u64>,
    #[serde(default, alias = "fromRecordId")]
    from_record_id: Option<String>,
    #[serde(default, alias = "recordId")]
    record_id: Option<String>,
    #[serde(default, alias = "accountId")]
    account_id: Option<String>,
    #[serde(default, alias = "sessionTag")]
    session_tag: Option<String>,
    #[serde(default)]
    proxy: Option<String>,
    #[serde(default, alias = "excludeRecordIds")]
    exclude_record_ids: Option<Vec<String>>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default, alias = "autoContinue")]
    auto_continue: Option<bool>,
    #[serde(default, alias = "extraArgs")]
    extra_args: Option<Vec<String>>,
    #[serde(default, alias = "handoffReason")]
    handoff_reason: Option<String>,
}

fn read_bounded_stdin() -> Result<Vec<u8>, String> {
    let mut buf = Vec::with_capacity(4096);
    let stdin = io::stdin();
    let mut handle = stdin.lock().take((ORCHESTRATE_STDIN_MAX_BYTES + 1) as u64);
    handle
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取标准输入失败: {e}"))?;
    if buf.len() > ORCHESTRATE_STDIN_MAX_BYTES {
        return Err("relay.error.stdinTooLarge".into());
    }
    Ok(buf)
}

pub(crate) fn orchestrate_handle_json_in(
    stdin_bytes: &[u8],
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    now_sec: u64,
    procs: &[ClaudeProcess],
) -> (i32, String) {
    let err_json = |code: i32, reason: &str, msg: &str| -> (i32, String) {
        let payload = serde_json::json!({
            "schema": 1,
            "ok": false,
            "status": "error",
            "reason": reason,
            "error": msg,
        });
        (code, payload.to_string())
    };

    if stdin_bytes.len() > ORCHESTRATE_STDIN_MAX_BYTES {
        return err_json(2, "relay.error.stdinTooLarge", "stdin payload exceeds 128 KiB");
    }
    let req: CliRequest = match serde_json::from_slice(stdin_bytes) {
        Ok(r) => r,
        Err(e) => {
            return err_json(
                2,
                "relay.error.invalidRequest",
                &format!("invalid json: {e}"),
            )
        }
    };
    if req.schema != 1 {
        return err_json(2, "relay.error.invalidSchema", "unsupported schema version");
    }

    match req.op.as_str() {
        "status" => match orchestrator_state_with_overrides_in(
            app_data_dir,
            vault,
            home,
            now_sec,
            procs,
            req.threshold_pct,
            req.strategy.as_deref(),
        ) {
            Ok(state) => match serde_json::to_string(&state) {
                Ok(s) => (0, s),
                Err(e) => err_json(1, "relay.error.serializeFailed", &e.to_string()),
            },
            Err(e) => err_json(1, &e, &e),
        },
        "relay_switch" => {
            let res = tooling::relay_switch_with_reason_in(
                app_data_dir,
                vault,
                home,
                req.strategy.as_deref(),
                req.threshold_pct,
                req.rate_limited,
                req.from_record_id.as_deref(),
                req.handoff_reason.as_deref(),
                now_sec,
                procs,
            );
            let exit = if res.ok { 0 } else { 1 };
            match serde_json::to_string(&res) {
                Ok(s) => (exit, s),
                Err(e) => err_json(1, "relay.error.serializeFailed", &e.to_string()),
            }
        }
        "slot_acquire" => {
            let selector = req.record_id.as_deref().or(req.account_id.as_deref());
            let res = slot_acquire_in(
                app_data_dir,
                vault,
                home,
                selector,
                req.session_tag.as_deref(),
                req.proxy.as_deref(),
                req.exclude_record_ids.as_deref(),
                now_sec,
                procs,
            );
            match serde_json::to_string(&res) {
                Ok(s) => (0, s),
                Err(e) => err_json(1, "relay.error.serializeFailed", &e.to_string()),
            }
        }
        "slot_release" => {
            let Some(selector) = req.record_id.as_deref().or(req.account_id.as_deref()) else {
                return err_json(2, "relay.error.missingRecordId", "record_id is required");
            };
            match slot_release_in(
                app_data_dir,
                vault,
                home,
                selector,
                req.rate_limited,
                req.auth_error,
                req.retry_after_sec,
                now_sec,
                procs,
            ) {
                Ok(res) => match serde_json::to_string(&res) {
                    Ok(s) => (0, s),
                    Err(e) => err_json(1, "relay.error.serializeFailed", &e.to_string()),
                },
                Err(e) => err_json(1, &e, &e),
            }
        }
        "install_wrappers" => match install_wrappers_in(home) {
            Ok(res) => match serde_json::to_string(&res) {
                Ok(s) => (0, s),
                Err(e) => err_json(1, "relay.error.serializeFailed", &e.to_string()),
            },
            Err(e) => err_json(1, &e, &e),
        },
        "launch_relay_cli" => match launch_relay_cli_in(
            home,
            req.cwd.as_deref(),
            req.auto_continue,
            req.extra_args.as_deref(),
        ) {
            Ok(res) => match serde_json::to_string(&res) {
                Ok(s) => (0, s),
                Err(e) => err_json(1, "relay.error.serializeFailed", &e.to_string()),
            },
            Err(e) => err_json(1, &e, &e),
        },
        _ => err_json(2, "relay.error.unknownOp", "unknown orchestrator op"),
    }
}

pub fn headless(args: &[String]) -> Option<i32> {
    if !args.iter().skip(1).any(|a| a == "--orchestrate") {
        return None;
    }
    let stdin_bytes = match read_bounded_stdin() {
        Ok(b) => b,
        Err(reason) => {
            println!(
                "{}",
                serde_json::json!({
                    "schema": 1,
                    "ok": false,
                    "status": "error",
                    "reason": reason,
                    "error": reason,
                })
            );
            return Some(2);
        }
    };
    let Some(app_data_dir) = identity::app_data_dir() else {
        println!(
            "{}",
            serde_json::json!({
                "schema": 1,
                "ok": false,
                "status": "error",
                "reason": "relay.error.appDataUnavailable",
                "error": "app data dir unavailable",
            })
        );
        return Some(1);
    };
    let vault = app_data_dir.join("identity-vault");
    let home = match identity::root() {
        Ok(h) => h,
        Err(e) => {
            println!(
                "{}",
                serde_json::json!({
                    "schema": 1,
                    "ok": false,
                    "status": "error",
                    "reason": "relay.error.homeUnavailable",
                    "error": e,
                })
            );
            return Some(1);
        }
    };
    let procs = identity::running_processes();
    let (code, output) = orchestrate_handle_json_in(
        &stdin_bytes,
        &app_data_dir,
        &vault,
        &home,
        now_epoch_sec(),
        &procs,
    );
    println!("{output}");
    Some(code)
}

#[tauri::command]
pub async fn identities_orchestrator_state(
    app: tauri::AppHandle,
) -> Result<OrchestratorStateView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "relay.error.appDataUnavailable".to_string())?;
        let vault = app_dir.join("identity-vault");
        let home = identity::root()?;
        let procs = identity::running_processes();
        orchestrator_state_in(&app_dir, &vault, &home, now_epoch_sec(), &procs)
    })
    .await
    .map_err(|_| "编排状态读取被中断。".to_string())?
}

pub(crate) fn merge_config_preserving_runtime(
    disk: &SmartRelayConfig,
    mut incoming: SmartRelayConfig,
    now_sec: u64,
) -> SmartRelayConfig {
    let disk_max_tick = disk.rotation_tick.values().copied().max().unwrap_or(0);
    let inc_max_tick = incoming.rotation_tick.values().copied().max().unwrap_or(0);
    let disk_has_newer_rotations = disk_max_tick > inc_max_tick;

    for (k, &disk_tick) in &disk.rotation_tick {
        if k == "current" {
            continue;
        }
        incoming
            .rotation_tick
            .entry(k.clone())
            .and_modify(|inc| *inc = (*inc).max(disk_tick))
            .or_insert(disk_tick);
    }
    for (k, &disk_sunk) in &disk.sunk_order {
        if k == "current" {
            continue;
        }
        incoming
            .sunk_order
            .entry(k.clone())
            .and_modify(|inc| *inc = (*inc).max(disk_sunk))
            .or_insert(disk_sunk);
    }
    incoming.cooldown_until_sec.remove("current");
    incoming.rotation_tick.remove("current");
    incoming.sunk_order.remove("current");
    if disk_has_newer_rotations {
        for (k, &disk_ts) in &disk.cooldown_until_sec {
            if k != "current" && disk_ts > now_sec {
                incoming
                    .cooldown_until_sec
                    .entry(k.clone())
                    .and_modify(|inc| *inc = (*inc).max(disk_ts))
                    .or_insert(disk_ts);
            }
        }
        if disk.no_return_account_id.is_some() && disk.no_return_until_sec > now_sec {
            incoming.no_return_account_id = disk.no_return_account_id.clone();
            incoming.no_return_until_sec = disk.no_return_until_sec;
        }
    } else {
        for (k, inc_ts) in incoming.cooldown_until_sec.iter_mut() {
            if let Some(&disk_ts) = disk.cooldown_until_sec.get(k) {
                if disk_ts > now_sec && *inc_ts < disk_ts {
                    *inc_ts = disk_ts;
                }
            }
        }
    }
    incoming
}

pub(crate) fn clear_cooldown_in(
    app_data_dir: &Path,
    vault: &Path,
    home: &Path,
    id: &str,
    now_sec: u64,
    procs: &[ClaudeProcess],
) -> Result<OrchestratorStateView, String> {
    let clean_id = id.trim();
    if clean_id == "current" || !config::safe_record_key(clean_id) {
        return Err("relay.error.invalidAccountId".into());
    }
    {
        let _lock = acquire_orchestrate_lock(app_data_dir)?;
        let mut cfg = config::load_config(app_data_dir);
        cfg.cooldown_until_sec.remove(clean_id);
        cfg.cooldown_until_sec.remove("current");
        if cfg.no_return_account_id.as_deref() == Some(clean_id) {
            cfg.no_return_account_id = None;
            cfg.no_return_until_sec = 0;
        }
        let next_tick = cfg
            .rotation_tick
            .values()
            .copied()
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        cfg.rotation_tick.insert(clean_id.to_string(), next_tick);
        config::save_config(app_data_dir, &cfg)?;
    }
    orchestrator_state_in(app_data_dir, vault, home, now_sec, procs)
}

#[tauri::command]
pub async fn identities_orchestrator_clear_cooldown(
    app: tauri::AppHandle,
    id: String,
) -> Result<OrchestratorStateView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "relay.error.appDataUnavailable".to_string())?;
        let vault = app_dir.join("identity-vault");
        let home = identity::root()?;
        let procs = identity::running_processes();
        clear_cooldown_in(&app_dir, &vault, &home, &id, now_epoch_sec(), &procs)
    })
    .await
    .map_err(|_| "冷却清除被中断。".to_string())?
}

#[tauri::command]
pub async fn identities_orchestrator_configure(
    app: tauri::AppHandle,
    config: SmartRelayConfig,
) -> Result<OrchestratorStateView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "relay.error.appDataUnavailable".to_string())?;
        let validated = config::validate_config_strict(config)?;
        let now_sec = now_epoch_sec();
        {
            let _lock = acquire_orchestrate_lock(&app_dir)?;
            let disk = config::load_config(&app_dir);
            let merged = merge_config_preserving_runtime(&disk, validated, now_sec);
            config::save_config(&app_dir, &merged)?;
        }
        let vault = app_dir.join("identity-vault");
        let home = identity::root()?;
        let procs = identity::running_processes();
        orchestrator_state_in(&app_dir, &vault, &home, now_sec, &procs)
    })
    .await
    .map_err(|_| "编排配置保存被中断。".to_string())?
}

#[tauri::command]
pub async fn identities_install_cli_wrappers() -> Result<InstallWrappersResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = identity::root()?;
        install_wrappers_in(&home)
    })
    .await
    .map_err(|_| "CLI 包装脚本安装被中断。".to_string())?
}

#[tauri::command]
pub async fn identities_release_cli_slot(
    app: tauri::AppHandle,
    record_id: String,
) -> Result<SlotReleaseResult, String> {
    let cleaner = app.state::<crate::cleaner::Cleaner>();
    cleaner.enter()?;
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let app_dir = worker
            .path()
            .app_data_dir()
            .map_err(|_| "relay.error.appDataUnavailable".to_string())?;
        let vault = app_dir.join("identity-vault");
        let home = identity::root()?;
        let procs = identity::running_processes();
        slot_release_in(
            &app_dir,
            &vault,
            &home,
            &record_id,
            None,
            None,
            None,
            now_epoch_sec(),
            &procs,
        )
    })
    .await
    .map_err(|_| "槽位释放被中断。".to_string())
    .and_then(|r| r);
    cleaner.leave();
    result
}

#[tauri::command]
pub async fn identities_launch_relay_cli(
    cwd: Option<String>,
    auto_continue: Option<bool>,
) -> Result<LaunchRelayCliResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = identity::root()?;
        launch_relay_cli_in(&home, cwd.as_deref(), auto_continue, None)
    })
    .await
    .map_err(|_| "relay.error.launchTerminalFailed".to_string())?
}
