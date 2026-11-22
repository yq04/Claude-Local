// [INPUT]: 主配置根目录 `.claude/settings(.local).json`、`.claude.json`、`.claude/.mcp.json` 与 `.claude/telemetry/1p_failed_events.*.json`。
// [OUTPUT]: Claude CLI 遥测护盾、HTTP 代理与 NO_PROXY 环回/绕行一致性和 MCP 供应链只读计数审计（CliSecurityAudit）。
// [POS]: risk_check 子模块：Claude CLI 配置与 MCP 安全边界只读扫描，与 src/risk-model.ts 语义 1:1 对齐。
// [PROTOCOL]: 变更时更新此头部，然后检查 risk_check/CLAUDE.md
use super::{config_source, CliSecurityAudit};

fn is_loopback_mcp_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    let rest = lower
        .strip_prefix("http://")
        .or_else(|| lower.strip_prefix("https://"))
        .or_else(|| lower.strip_prefix("ws://"))
        .or_else(|| lower.strip_prefix("wss://"))
        .unwrap_or("");
    if rest.is_empty() {
        return false;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = if authority.starts_with('[') {
        authority
            .split(']')
            .next()
            .map(|h| format!("{h}]"))
            .unwrap_or_default()
    } else {
        authority.split(':').next().unwrap_or("").to_string()
    };
    matches!(
        host.as_str(),
        "localhost" | "127.0.0.1" | "[::1]" | "::1" | "0.0.0.0"
    )
}

fn scan_mcp_servers_map(
    servers: &serde_json::Map<String, serde_json::Value>,
    audit: &mut CliSecurityAudit,
) {
    for server in servers.values() {
        let Some(obj) = server.as_object() else {
            continue;
        };
        let command = obj
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let url = obj
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let server_type = obj
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        // Parity with src/risk-model.ts::auditClaudeCliSecurityBoundary: any non-empty URL
        // or HTTP/SSE/WS transport is checked against the loopback boundary.
        let is_http_or_sse = url.starts_with("http://")
            || url.starts_with("https://")
            || url.starts_with("ws://")
            || url.starts_with("wss://")
            || matches!(server_type.as_str(), "sse" | "http" | "ws" | "websocket")
            || !url.is_empty();
        if is_http_or_sse && (url.is_empty() || !is_loopback_mcp_url(&url)) {
            audit.remote_http_mcp_count += 1;
        }
        let is_wsl_path =
            command.starts_with("\\\\wsl$") || command.starts_with("\\\\wsl.localhost");
        let file_name = command
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(command.as_str());
        let cmd_stem = file_name
            .strip_suffix(".cmd")
            .or_else(|| file_name.strip_suffix(".exe"))
            .or_else(|| file_name.strip_suffix(".bat"))
            .unwrap_or(file_name);
        // Bare npx/npm/etc. spawning is a Windows-specific shell/quoting risk (src/risk-model.ts `isWin`).
        if cfg!(target_os = "windows")
            && !is_http_or_sse
            && !is_wsl_path
            && matches!(cmd_stem, "npx" | "npm" | "pnpm" | "yarn" | "uvx" | "bunx")
        {
            audit.windows_bare_npx_count += 1;
        }
        let is_cmd_wrapped_npx = cmd_stem == "cmd"
            && obj
                .get("args")
                .and_then(|v| v.as_array())
                .is_some_and(|args| {
                    args.len() >= 2
                        && args[0]
                            .as_str()
                            .is_some_and(|a| a.trim().eq_ignore_ascii_case("/c"))
                        && args[1].as_str().is_some_and(|s| {
                            let sub = s.trim().to_ascii_lowercase();
                            let sub_name = sub.rsplit(['/', '\\']).next().unwrap_or(sub.as_str());
                            let sub_stem = sub_name
                                .strip_suffix(".cmd")
                                .or_else(|| sub_name.strip_suffix(".exe"))
                                .or_else(|| sub_name.strip_suffix(".bat"))
                                .unwrap_or(sub_name);
                            matches!(sub_stem, "npx" | "uvx" | "bunx")
                        })
                });
        let is_npx_family = matches!(cmd_stem, "npx" | "uvx" | "bunx") || is_cmd_wrapped_npx;
        if is_npx_family {
            let mut has_pinned = false;
            if let Some(args) = obj.get("args").and_then(|v| v.as_array()) {
                let start_idx = if is_cmd_wrapped_npx { 2 } else { 0 };
                for raw in args.iter().skip(start_idx).filter_map(|v| v.as_str()) {
                    let s = raw.trim();
                    if s.is_empty() || s.starts_with('-') {
                        continue;
                    }
                    let without_scope = s.strip_prefix('@').map_or(s, |rest| {
                        rest.find('/').map_or("", |idx| &rest[idx + 1..])
                    });
                    if let Some((pkg_name, ver)) = without_scope.rsplit_once('@') {
                        if !pkg_name.is_empty()
                            && !ver.is_empty()
                            && !ver.eq_ignore_ascii_case("latest")
                        {
                            has_pinned = true;
                        }
                    }
                    break;
                }
            }
            if !has_pinned {
                audit.unpinned_npx_count += 1;
            }
        }
    }
}

/// Parity with `src/risk-model.ts::normalizeHttpProxyHostPort`: normalizes IPv6/localhost
/// loopback forms (`localhost`, `[::1]`, bare `::1`) to `127.0.0.1:<port>`.
fn normalize_http_proxy_host_port(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized_storage;
    let candidate = if let Some((prefix, rest)) = trimmed.split_once("::1:") {
        let digit_count = rest.chars().take_while(|c| c.is_ascii_digit()).count();
        if !prefix.contains('[') && digit_count > 0 {
            let (digits, tail) = rest.split_at(digit_count);
            normalized_storage = format!("{prefix}[::1]:{digits}{tail}");
            normalized_storage.as_str()
        } else {
            trimmed
        }
    } else {
        trimmed
    };
    let url = reqwest::Url::parse(candidate).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host_raw = url.host_str()?.trim_matches(['[', ']']);
    if host_raw.is_empty() {
        return None;
    }
    let host = if host_raw.eq_ignore_ascii_case("localhost") || host_raw == "::1" {
        "127.0.0.1".to_string()
    } else {
        host_raw.to_ascii_lowercase()
    };
    let port = url.port_or_known_default()?;
    if port == 0 {
        return None;
    }
    Some(format!("{host}:{port}"))
}

/// Parity with `src/risk-model.ts::isSafeNoProxyValue`: requires explicit loopback coverage
/// (`localhost` AND `127.0.0.1`/`127.0.0.0/8`) while blocking `*` and Claude/Datadog bypasses.
fn is_safe_no_proxy_value(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    let mut has_entry = false;
    let mut has_localhost = false;
    let mut has_loopback_ip = false;
    for part in trimmed.split(',') {
        let token = part.trim().to_ascii_lowercase();
        if token.is_empty() {
            continue;
        }
        has_entry = true;
        if token == "*" {
            return false;
        }
        let host_part = if token.starts_with('[') {
            token.split(']').next().unwrap_or("").trim_start_matches('[')
        } else {
            token.split(':').next().unwrap_or("")
        };
        let clean = host_part.trim_start_matches("*.").trim_start_matches('.');
        if clean == "localhost" {
            has_localhost = true;
        } else if matches!(clean, "127.0.0.1" | "127.0.0.0/8") {
            has_loopback_ip = true;
        }
        for protected in [
            "claude.ai",
            "anthropic.com",
            "claude.com",
            "claudeusercontent.com",
            "claudemcpclient.com",
            "claudemcpcontent.com",
            "claudepages.dev",
            "claude.site",
            "claude.app",
            "claude.dev",
            "claude.new",
            "claudestudio.com",
            "ant.dev",
            "antspace.dev",
            "anthropic.dev",
            "anthropic.team",
            "clau.de",
            "datadoghq.com",
        ] {
            if clean == protected || clean.ends_with(&format!(".{protected}")) {
                return false;
            }
        }
    }
    has_entry && has_localhost && has_loopback_ip
}

fn is_english_language_pref(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    s.is_empty()
        || s == "en"
        || s.starts_with("en-")
        || s.starts_with("en_")
        || s.starts_with("english")
}

fn inspect_settings_object(
    settings: &serde_json::Map<String, serde_json::Value>,
    merged_env: &mut serde_json::Map<String, serde_json::Value>,
    audit: &mut CliSecurityAudit,
) {
    for key in ["hooks", "apiKeyHelper", "awsAuthRefresh", "otelHeadersHelper"] {
        if match settings.get(key) {
            Some(serde_json::Value::String(s)) => !s.trim().is_empty(),
            Some(serde_json::Value::Object(m)) => !m.is_empty(),
            Some(serde_json::Value::Array(a)) => !a.is_empty(),
            _ => false,
        } {
            audit.has_custom_hooks_or_helpers = true;
        }
    }
    if settings
        .get("skipDangerousModePermissionPrompt")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        || settings
            .get("dangerouslySkipPermissions")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        || settings
            .get("permissions")
            .and_then(|v| v.get("allow"))
            .and_then(|v| v.as_array())
            .is_some_and(|allow| {
                allow.iter().any(|item| {
                    item.as_str().is_some_and(|s| {
                        let t = s.trim();
                        t.eq_ignore_ascii_case("Bash(*)") || t.eq_ignore_ascii_case("Bash")
                    })
                })
            })
    {
        audit.has_custom_hooks_or_helpers = true;
    }
    if let Some(env) = settings.get("env").and_then(|v| v.as_object()) {
        for (k, v) in env {
            merged_env.insert(k.clone(), v.clone());
        }
    }
    if let Some(mcp) = settings.get("mcpServers").and_then(|v| v.as_object()) {
        scan_mcp_servers_map(mcp, audit);
    }
}

/// 纯只读审计 Claude CLI 遥测护盾、代理环境变量协议、自定义 Hook/Helper 与 MCP 供应链边界（零秘密提取）。
pub fn audit_claude_cli_security_dir(root: &std::path::Path) -> CliSecurityAudit {
    let mut audit = CliSecurityAudit::default();
    let claude_dir = root.join(".claude");
    let mut merged_env = serde_json::Map::new();

    let mut effective_language: Option<String> = None;
    for settings_name in ["settings.json", "settings.local.json"] {
        let settings_path = claude_dir.join(settings_name);
        if let Some(raw) = config_source::read_bounded_utf8(&settings_path, 512 * 1024) {
            if let Ok(serde_json::Value::Object(settings)) = serde_json::from_str(&raw) {
                audit.settings_present = true;
                if let Some(lang_val) = settings.get("language") {
                    effective_language = lang_val.as_str().map(|s| s.trim().to_string());
                }
                inspect_settings_object(&settings, &mut merged_env, &mut audit);
            }
        }
    }

    if audit.settings_present {
        if let Some(ref lang) = effective_language {
            if !is_english_language_pref(lang) {
                audit.non_english_language = true;
            }
        }
        let truthy = |k: &str| match merged_env.get(k) {
            Some(serde_json::Value::Bool(b)) => *b,
            Some(serde_json::Value::Number(n)) => n.as_i64() == Some(1),
            Some(serde_json::Value::String(s)) => {
                matches!(s.trim().to_ascii_lowercase().as_str(), "1" | "true")
            }
            _ => false,
        };
        audit.nonessential_traffic_blocked = truthy("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC");
        audit.telemetry_shield_active = truthy("DISABLE_TELEMETRY")
            && truthy("DISABLE_ERROR_REPORTING")
            && truthy("DO_NOT_TRACK")
            && !audit.nonessential_traffic_blocked;

        let str_val = |k: &str| {
            merged_env
                .get(k)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .unwrap_or("")
        };
        let canonical_pairs = [
            ("HTTP_PROXY", "http_proxy"),
            ("HTTPS_PROXY", "https_proxy"),
            ("ALL_PROXY", "all_proxy"),
            ("GRPC_PROXY", "grpc_proxy"),
        ];
        audit.socks5_in_cli_env = canonical_pairs.iter().any(|(upper, lower)| {
            str_val(upper).to_ascii_lowercase().starts_with("socks")
                || str_val(lower).to_ascii_lowercase().starts_with("socks")
        });
        let mut shared_endpoint: Option<String> = None;
        let mut all_pairs_http = true;
        for (upper, lower) in canonical_pairs {
            let has_u = merged_env.contains_key(upper);
            let has_l = merged_env.contains_key(lower);
            if !has_u && !has_l {
                all_pairs_http = false;
                break;
            }
            for (present, raw) in [(has_u, str_val(upper)), (has_l, str_val(lower))] {
                if !present {
                    continue;
                }
                if raw.to_ascii_lowercase().starts_with("socks") {
                    all_pairs_http = false;
                    break;
                }
                let Some(ep) = normalize_http_proxy_host_port(raw) else {
                    all_pairs_http = false;
                    break;
                };
                match &shared_endpoint {
                    None => shared_endpoint = Some(ep),
                    Some(prev) if prev != &ep => {
                        all_pairs_http = false;
                        break;
                    }
                    Some(_) => {}
                }
            }
            if !all_pairs_http {
                break;
            }
        }
        let has_np_u = merged_env.contains_key("NO_PROXY");
        let has_np_l = merged_env.contains_key("no_proxy");
        let no_proxy_ok = (has_np_u || has_np_l)
            && (!has_np_u || is_safe_no_proxy_value(str_val("NO_PROXY")))
            && (!has_np_l || is_safe_no_proxy_value(str_val("no_proxy")));
        audit.proxy_env_complete = all_pairs_http && no_proxy_ok && !audit.socks5_in_cli_env;
    }

    for mcp_path in [root.join(".claude.json"), claude_dir.join(".mcp.json")] {
        if let Some(raw) = config_source::read_bounded_utf8(&mcp_path, 1024 * 1024) {
            if let Ok(serde_json::Value::Object(doc)) = serde_json::from_str(&raw) {
                if let Some(mcp) = doc.get("mcpServers").and_then(|v| v.as_object()) {
                    scan_mcp_servers_map(mcp, &mut audit);
                }
                if let Some(projects) = doc.get("projects").and_then(|v| v.as_object()) {
                    let mut seen_proj_paths = std::collections::HashSet::new();
                    for (proj_key, proj) in projects.iter().take(256) {
                        let norm_key = proj_key
                            .trim()
                            .replace('/', "\\")
                            .trim_end_matches('\\')
                            .to_ascii_lowercase();
                        if !seen_proj_paths.insert(norm_key) {
                            continue;
                        }
                        if let Some(proj_mcp) = proj
                            .as_object()
                            .and_then(|o| o.get("mcpServers"))
                            .and_then(|v| v.as_object())
                        {
                            scan_mcp_servers_map(proj_mcp, &mut audit);
                        }
                    }
                }
            }
        }
    }

    if let Ok(entries) = std::fs::read_dir(claude_dir.join("telemetry")) {
        for entry in entries.flatten().take(256) {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with("1p_failed_events.") && name.ends_with(".json") {
                    audit.pending_failed_telemetry_files += 1;
                }
            }
        }
    }

    audit
}

pub(super) fn inspect_local_cli_security() -> Option<CliSecurityAudit> {
    let home = crate::cleaner::identity::root().ok()?;
    Some(audit_claude_cli_security_dir(&home))
}
