// [INPUT]: app_data_dir/smart_relay_v1.json、~/.claude/settings(.local).json 代理配置与 .orchestrate.lock 跨进程锁文件。
// [OUTPUT]: SmartRelayConfig 序列化/反序列化（默认 spentThresholdPct=98 支持 80/85/90/95/98/100、默认 maxSameExitConcurrency=1 且兼容 1..=5、含跨切号持久化的 defaultCliModel / defaultCliEffort / relayHandoffMode，兼容旧版 sunkOrder/rotationTick 零编译告警）、严格/宽容配置归一化、HTTP 代理严格校验与转换、子代理环境净化键表及跨进程文件锁守卫。
// [POS]: orchestrator 配置、常量与跨进程互斥基础设施层；纯本地私有文件读写，不发起网络请求。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::super::private;
use crate::cleaner;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    path::Path,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(not(target_os = "windows"))]
use std::{io, path::PathBuf};
#[cfg(target_os = "windows")]
use std::os::windows::fs::OpenOptionsExt;

pub(crate) const SMART_RELAY_FILE: &str = "smart_relay_v1.json";
pub(crate) const SMART_RELAY_MAX_BYTES: usize = 128 * 1024;
pub(super) const ORCHESTRATE_LOCK_FILE: &str = ".orchestrate.lock";
pub(super) const ORCHESTRATE_LOCK_TIMEOUT_MS: u64 = 15_000;
pub(super) const ORCHESTRATE_STDIN_MAX_BYTES: usize = 128 * 1024;
pub(super) const CLI_SLOTS_DIR: &str = "cli-slots";
pub(super) const SLOT_LEASE_FILE: &str = ".slot-lease.json";
pub(super) const SLOT_MANIFEST_FILE: &str = ".slot-manifest.json";
pub(super) const SLOT_DRIFTED_FILE: &str = ".slot-drifted";
pub(super) const SLOT_PACING_FILE: &str = "slot_pacing_v1.json";
pub(super) const ACTIVE_LEASE_STARTUP_WINDOW_SEC: u64 = 60;
pub(super) const GRANT_EXPIRING_SOON_SEC: u64 = 72 * 3600;
pub(super) const DEFAULT_COOLDOWN_SEC: u64 = 900;
pub(super) const NO_RETURN_COOLDOWN_SEC: u64 = 300;
pub(super) const MAX_SLOT_JSON_BYTES: u64 = 16 * 1024 * 1024;
pub(super) const MAX_SESSION_JSON_BYTES: u64 = 64 * 1024;
pub(super) const MAX_COPY_DEPTH: usize = 8;
pub(super) const MAX_COPY_FILES: usize = 2048;
pub(super) const MAX_COPY_BYTES: u64 = 32 * 1024 * 1024;

pub(super) const VALID_STRATEGIES: &[&str] = &[
    "smart",
    "reset_harvest",
    "pace",
    "least_used",
    "ordered",
    "rotate",
];
pub(super) const VALID_RATE_LIMIT_MODES: &[&str] = &["keep_position", "sink_to_end"];
pub(super) const VALID_AFFINITY_MODES: &[&str] = &["auto", "session", "manual"];
pub(super) const VALID_SPENT_THRESHOLDS: &[u8] = &[80, 85, 90, 95, 98, 100];
pub(super) const VALID_RETURN_THRESHOLDS: &[u8] = &[80, 85, 90];
pub(super) const VALID_RELAY_HANDOFF_MODES: &[&str] = &["clean_handoff", "fork_resume"];
pub(super) const VALID_DEFAULT_CLI_MODELS: &[&str] = &[
    "",
    "claude-opus-5-5",
    "claude-fable-5-2",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "opus",
    "fable",
    "sonnet",
    "haiku",
    "opusplan",
    "best",
    "opus[1m]",
    "sonnet[1m]",
    "fable[1m]",
];
pub(super) const VALID_DEFAULT_CLI_EFFORTS: &[&str] = &[
    "",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
];

pub(super) const PROXY_ENV_KEYS_URL: &[&str] = &[
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
    "GRPC_PROXY",
    "grpc_proxy",
];

pub(super) const STRIP_SLOT_ENV_KEYS: &[&str] = &[
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
    "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_GATEWAY",
    "CLAUDE_CODE_SIMPLE",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
];

pub(super) fn default_schema_one() -> u8 {
    1
}
fn default_strategy() -> String {
    "smart".into()
}
fn default_rate_limit_mode() -> String {
    "keep_position".into()
}
fn default_affinity_mode() -> String {
    "auto".into()
}
fn default_spent_threshold_pct() -> u8 {
    98
}
fn default_return_to_preferred() -> bool {
    true
}
fn default_preferred_return_threshold_pct() -> u8 {
    90
}
fn default_max_same_exit_concurrency() -> u8 {
    1
}
fn default_relay_handoff_mode() -> String {
    "clean_handoff".into()
}

fn de_sunk_order<'de, D>(deserializer: D) -> Result<BTreeMap<String, u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum SunkOrderCompat {
        Map(BTreeMap<String, u64>),
        Legacy(Vec<String>),
    }
    Ok(match SunkOrderCompat::deserialize(deserializer)? {
        SunkOrderCompat::Map(m) => m,
        SunkOrderCompat::Legacy(list) => list
            .into_iter()
            .enumerate()
            .map(|(idx, id)| (id, (idx + 1) as u64))
            .collect(),
    })
}

fn de_rotation_tick<'de, D>(deserializer: D) -> Result<BTreeMap<String, u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum RotationTickCompat {
        Map(BTreeMap<String, u64>),
        Legacy(serde::de::IgnoredAny),
    }
    Ok(match RotationTickCompat::deserialize(deserializer)? {
        RotationTickCompat::Map(m) => m,
        RotationTickCompat::Legacy(_) => BTreeMap::new(),
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SmartRelayConfig {
    pub schema: u8,
    pub enabled: bool,
    pub strategy: String,
    pub rate_limit_mode: String,
    pub affinity_mode: String,
    pub spent_threshold_pct: u8,
    pub return_to_preferred: bool,
    pub preferred_return_threshold_pct: u8,
    pub auto_continue_on_relay: bool,
    pub max_same_exit_concurrency: u8,
    #[serde(default, alias = "default_cli_model")]
    pub default_cli_model: String,
    #[serde(default, alias = "default_cli_effort")]
    pub default_cli_effort: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_account_id: Option<String>,
    pub excluded_account_ids: Vec<String>,
    pub slot_proxies: BTreeMap<String, String>,
    #[serde(deserialize_with = "de_sunk_order")]
    pub sunk_order: BTreeMap<String, u64>,
    #[serde(deserialize_with = "de_rotation_tick")]
    pub rotation_tick: BTreeMap<String, u64>,
    pub cooldown_until_sec: BTreeMap<String, u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_return_account_id: Option<String>,
    pub no_return_until_sec: u64,
    #[serde(default = "default_relay_handoff_mode", alias = "relay_handoff_mode")]
    pub relay_handoff_mode: String,
}

impl Default for SmartRelayConfig {
    fn default() -> Self {
        Self {
            schema: default_schema_one(),
            enabled: false,
            strategy: default_strategy(),
            rate_limit_mode: default_rate_limit_mode(),
            affinity_mode: default_affinity_mode(),
            spent_threshold_pct: default_spent_threshold_pct(),
            return_to_preferred: default_return_to_preferred(),
            preferred_return_threshold_pct: default_preferred_return_threshold_pct(),
            auto_continue_on_relay: false,
            max_same_exit_concurrency: default_max_same_exit_concurrency(),
            default_cli_model: String::new(),
            default_cli_effort: String::new(),
            preferred_account_id: None,
            excluded_account_ids: Vec::new(),
            slot_proxies: BTreeMap::new(),
            sunk_order: BTreeMap::new(),
            rotation_tick: BTreeMap::new(),
            cooldown_until_sec: BTreeMap::new(),
            no_return_account_id: None,
            no_return_until_sec: 0,
            relay_handoff_mode: default_relay_handoff_mode(),
        }
    }
}

pub(crate) fn now_epoch_sec() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub(super) fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

pub(super) fn truncate_display(s: &str, max_chars: usize) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut out = String::new();
    for (idx, ch) in trimmed.chars().enumerate() {
        if idx >= max_chars {
            break;
        }
        if !ch.is_control() {
            out.push(ch);
        }
    }
    (!out.is_empty()).then_some(out)
}

pub(super) fn safe_real_dir(path: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return false;
    };
    !cleaner::linked(&meta) && meta.is_dir() && private::safe(path).is_ok()
}

pub(super) fn safe_record_key(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn dedup_clean_ids(ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for raw in ids {
        let trimmed = raw.trim();
        if safe_record_key(trimmed) && seen.insert(trimmed.to_string()) {
            out.push(trimmed.to_string());
        }
    }
    out
}

fn sanitize_record_map(map: BTreeMap<String, u64>) -> BTreeMap<String, u64> {
    let mut out = BTreeMap::new();
    for (k, v) in map {
        let key = k.trim();
        if safe_record_key(key) {
            out.insert(key.to_string(), v);
            if out.len() >= 256 {
                break;
            }
        }
    }
    out
}

fn parse_host_port(authority: &str) -> Option<(String, u16)> {
    if authority.is_empty()
        || authority.chars().any(|c| {
            c.is_control() || c.is_whitespace() || matches!(c, '@' | '/' | '?' | '#' | '\\')
        })
    {
        return None;
    }
    if let Some(rest) = authority.strip_prefix('[') {
        let close = rest.find(']')?;
        let inner = &rest[..close];
        if inner.is_empty()
            || !inner
                .chars()
                .all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.')
        {
            return None;
        }
        let port_part = rest[close + 1..].strip_prefix(':')?;
        if port_part.is_empty() || !port_part.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let port = port_part.parse::<u16>().ok()?;
        if port == 0 {
            return None;
        }
        return Some((format!("[{}]", inner.to_ascii_lowercase()), port));
    }
    let (host, port_part) = authority.rsplit_once(':')?;
    if host.is_empty()
        || host.contains(':')
        || host.contains('[')
        || host.contains(']')
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return None;
    }
    if port_part.is_empty() || !port_part.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let port = port_part.parse::<u16>().ok()?;
    if port == 0 {
        return None;
    }
    Some((host.to_ascii_lowercase(), port))
}

pub(crate) fn validate_http_proxy(raw: &str) -> Result<String, String> {
    if raw.chars().any(char::is_control) {
        return Err("relay.error.invalidSlotProxy".into());
    }
    let trimmed = raw.trim();
    if trimmed.len() < 8 {
        return Err("relay.error.invalidSlotProxy".into());
    }
    let lower_prefix = trimmed[..7].to_ascii_lowercase();
    if lower_prefix != "http://" {
        return Err("relay.error.invalidSlotProxy".into());
    }
    let rest = trimmed[7..].trim_end_matches('/');
    let Some((host, port)) = parse_host_port(rest) else {
        return Err("relay.error.invalidSlotProxy".into());
    };
    Ok(format!("http://{host}:{port}"))
}

pub(crate) fn normalize_proxy_to_http(raw: &str) -> Option<String> {
    if raw.chars().any(char::is_control) {
        return None;
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let authority = if let Some(idx) = trimmed.find("://") {
        let scheme = trimmed[..idx].to_ascii_lowercase();
        if !matches!(
            scheme.as_str(),
            "http" | "https" | "socks5" | "socks5h" | "socks4" | "socks4a"
        ) {
            return None;
        }
        &trimmed[idx + 3..]
    } else {
        trimmed
    };
    let clean_auth = authority.trim_end_matches('/');
    let (host, port) = parse_host_port(clean_auth)?;
    Some(format!("http://{host}:{port}"))
}

pub(crate) fn exit_key(proxy: Option<&str>) -> String {
    match proxy.and_then(normalize_proxy_to_http) {
        Some(url) => url
            .strip_prefix("http://")
            .unwrap_or(&url)
            .to_ascii_lowercase(),
        None => "__direct__".into(),
    }
}

pub(crate) fn validate_config_strict(mut cfg: SmartRelayConfig) -> Result<SmartRelayConfig, String> {
    if cfg.schema != 1 {
        return Err("relay.error.invalidSchema".into());
    }
    if !VALID_STRATEGIES.contains(&cfg.strategy.as_str()) {
        return Err("relay.error.invalidStrategy".into());
    }
    if !VALID_RATE_LIMIT_MODES.contains(&cfg.rate_limit_mode.as_str()) {
        return Err("relay.error.invalidRateLimitMode".into());
    }
    if !VALID_AFFINITY_MODES.contains(&cfg.affinity_mode.as_str()) {
        return Err("relay.error.invalidAffinityMode".into());
    }
    if !VALID_SPENT_THRESHOLDS.contains(&cfg.spent_threshold_pct) {
        return Err("relay.error.invalidThreshold".into());
    }
    if !VALID_RETURN_THRESHOLDS.contains(&cfg.preferred_return_threshold_pct) {
        return Err("relay.error.invalidReturnThreshold".into());
    }
    if !(1..=5).contains(&cfg.max_same_exit_concurrency) {
        return Err("relay.error.invalidConcurrency".into());
    }
    cfg.relay_handoff_mode = cfg.relay_handoff_mode.trim().to_ascii_lowercase();
    if !VALID_RELAY_HANDOFF_MODES.contains(&cfg.relay_handoff_mode.as_str()) {
        return Err("relay.error.invalidRequest".into());
    }
    cfg.default_cli_model = cfg.default_cli_model.trim().to_ascii_lowercase();
    if !VALID_DEFAULT_CLI_MODELS.contains(&cfg.default_cli_model.as_str()) {
        return Err("relay.error.invalidCliModel".into());
    }
    cfg.default_cli_effort = cfg.default_cli_effort.trim().to_ascii_lowercase();
    if !VALID_DEFAULT_CLI_EFFORTS.contains(&cfg.default_cli_effort.as_str()) {
        return Err("relay.error.invalidCliEffort".into());
    }
    cfg.preferred_account_id = cfg
        .preferred_account_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "current")
        .map(|s| {
            if safe_record_key(s) {
                Ok(s.to_string())
            } else {
                Err("relay.error.invalidAccountId".to_string())
            }
        })
        .transpose()?;
    cfg.no_return_account_id = cfg
        .no_return_account_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "current" && safe_record_key(s))
        .map(str::to_string);
    cfg.excluded_account_ids = dedup_clean_ids(cfg.excluded_account_ids);
    cfg.sunk_order = sanitize_record_map(cfg.sunk_order);
    cfg.rotation_tick = sanitize_record_map(cfg.rotation_tick);
    cfg.cooldown_until_sec = sanitize_record_map(cfg.cooldown_until_sec);

    let mut clean_proxies = BTreeMap::new();
    for (k, v) in cfg.slot_proxies {
        let key = k.trim();
        if !safe_record_key(key) {
            return Err("relay.error.invalidSlotProxy".into());
        }
        if v.chars().any(char::is_control) {
            return Err("relay.error.invalidSlotProxy".into());
        }
        if v.trim().is_empty() {
            continue;
        }
        let validated = validate_http_proxy(&v)?;
        clean_proxies.insert(key.to_string(), validated);
    }
    cfg.slot_proxies = clean_proxies;
    Ok(cfg)
}

fn normalize_config_lenient(mut cfg: SmartRelayConfig) -> SmartRelayConfig {
    cfg.schema = 1;
    if !VALID_STRATEGIES.contains(&cfg.strategy.as_str()) {
        cfg.strategy = default_strategy();
    }
    if !VALID_RATE_LIMIT_MODES.contains(&cfg.rate_limit_mode.as_str()) {
        cfg.rate_limit_mode = default_rate_limit_mode();
    }
    if !VALID_AFFINITY_MODES.contains(&cfg.affinity_mode.as_str()) {
        cfg.affinity_mode = default_affinity_mode();
    }
    if !VALID_SPENT_THRESHOLDS.contains(&cfg.spent_threshold_pct) {
        cfg.spent_threshold_pct = default_spent_threshold_pct();
    }
    if !VALID_RETURN_THRESHOLDS.contains(&cfg.preferred_return_threshold_pct) {
        cfg.preferred_return_threshold_pct = default_preferred_return_threshold_pct();
    }
    cfg.max_same_exit_concurrency = cfg.max_same_exit_concurrency.clamp(1, 5);
    cfg.relay_handoff_mode = cfg.relay_handoff_mode.trim().to_ascii_lowercase();
    if !VALID_RELAY_HANDOFF_MODES.contains(&cfg.relay_handoff_mode.as_str()) {
        cfg.relay_handoff_mode = default_relay_handoff_mode();
    }
    cfg.default_cli_model = cfg.default_cli_model.trim().to_ascii_lowercase();
    if !VALID_DEFAULT_CLI_MODELS.contains(&cfg.default_cli_model.as_str()) {
        cfg.default_cli_model.clear();
    }
    cfg.default_cli_effort = cfg.default_cli_effort.trim().to_ascii_lowercase();
    if !VALID_DEFAULT_CLI_EFFORTS.contains(&cfg.default_cli_effort.as_str()) {
        cfg.default_cli_effort.clear();
    }
    cfg.preferred_account_id = cfg
        .preferred_account_id
        .as_deref()
        .map(str::trim)
        .filter(|s| safe_record_key(s) && *s != "current")
        .map(str::to_string);
    cfg.no_return_account_id = cfg
        .no_return_account_id
        .as_deref()
        .map(str::trim)
        .filter(|s| safe_record_key(s) && *s != "current")
        .map(str::to_string);
    cfg.excluded_account_ids = dedup_clean_ids(cfg.excluded_account_ids);
    cfg.sunk_order = sanitize_record_map(cfg.sunk_order);
    cfg.rotation_tick = sanitize_record_map(cfg.rotation_tick);
    cfg.cooldown_until_sec = sanitize_record_map(cfg.cooldown_until_sec);
    let mut clean_proxies = BTreeMap::new();
    for (k, v) in cfg.slot_proxies {
        let key = k.trim();
        if safe_record_key(key) {
            if let Ok(valid) = validate_http_proxy(&v) {
                clean_proxies.insert(key.to_string(), valid);
            }
        }
    }
    cfg.slot_proxies = clean_proxies;
    cfg
}

pub(crate) fn load_config(app_data_dir: &Path) -> SmartRelayConfig {
    let path = app_data_dir.join(SMART_RELAY_FILE);
    let Some(val) = read_safe_value(&path, SMART_RELAY_MAX_BYTES as u64) else {
        return SmartRelayConfig::default();
    };
    serde_json::from_value::<SmartRelayConfig>(val)
        .map(normalize_config_lenient)
        .unwrap_or_default()
}

pub(crate) fn save_config(app_data_dir: &Path, cfg: &SmartRelayConfig) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(cfg).map_err(|_| "relay.error.serializeFailed".to_string())?;
    if bytes.len() > SMART_RELAY_MAX_BYTES {
        return Err("relay.error.configTooLarge".into());
    }
    private::directory(app_data_dir)?;
    private::write(&app_data_dir.join(SMART_RELAY_FILE), &bytes)
}

pub(super) fn read_safe_value(path: &Path, max_bytes: u64) -> Option<Value> {
    let meta = fs::symlink_metadata(path).ok()?;
    if cleaner::linked(&meta) || !meta.is_file() || meta.len() > max_bytes {
        return None;
    }
    private::safe(path).ok()?;
    let bytes = fs::read(path).ok()?;
    if bytes.len() as u64 > max_bytes {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

pub(super) fn read_settings_http_proxy(settings_path: &Path) -> Option<String> {
    let val = read_safe_value(settings_path, 2 * 1024 * 1024)?;
    let env = val.get("env").and_then(Value::as_object)?;
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Some(raw) = env.get(key).and_then(Value::as_str) {
            if let Some(norm) = normalize_proxy_to_http(raw) {
                return Some(norm);
            }
        }
    }
    None
}

pub(crate) fn read_claude_dir_http_proxy(claude_dir: &Path) -> Option<String> {
    read_settings_http_proxy(&claude_dir.join("settings.local.json"))
        .or_else(|| read_settings_http_proxy(&claude_dir.join("settings.json")))
}

pub(crate) struct OrchestrateLockGuard {
    _file: Option<File>,
    #[cfg(not(target_os = "windows"))]
    lock_path: PathBuf,
}

impl Drop for OrchestrateLockGuard {
    fn drop(&mut self) {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = fs::remove_file(&self.lock_path);
        }
    }
}

pub(crate) fn acquire_orchestrate_lock(app_data_dir: &Path) -> Result<OrchestrateLockGuard, String> {
    private::directory(app_data_dir)?;
    let lock_path = app_data_dir.join(ORCHESTRATE_LOCK_FILE);
    if let Ok(meta) = fs::symlink_metadata(&lock_path) {
        if cleaner::linked(&meta) {
            return Err("relay.error.unsafeLockPath".into());
        }
    }
    let deadline = Instant::now() + Duration::from_millis(ORCHESTRATE_LOCK_TIMEOUT_MS);

    #[cfg(target_os = "windows")]
    loop {
        match fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .share_mode(0)
            .open(&lock_path)
        {
            Ok(file) => return Ok(OrchestrateLockGuard { _file: Some(file) }),
            Err(err) if matches!(err.raw_os_error(), Some(5 | 32 | 33)) => {
                if Instant::now() >= deadline {
                    return Err("relay.error.lockTimeout".into());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(err) => return Err(format!("编排锁获取失败: {err}")),
        }
    }

    #[cfg(not(target_os = "windows"))]
    loop {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(file) => {
                return Ok(OrchestrateLockGuard {
                    _file: Some(file),
                    lock_path,
                });
            }
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
                if let Ok(meta) = fs::symlink_metadata(&lock_path) {
                    let stale = meta
                        .modified()
                        .ok()
                        .and_then(|m| SystemTime::now().duration_since(m).ok())
                        .is_some_and(|d| d.as_secs() > 60);
                    if stale && !cleaner::linked(&meta) {
                        let _ = fs::remove_file(&lock_path);
                        continue;
                    }
                }
                if Instant::now() >= deadline {
                    return Err("relay.error.lockTimeout".into());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(err) => return Err(format!("编排锁获取失败: {err}")),
        }
    }
}
