// [INPUT]: 当前绑定浏览器快照、本机网卡、当前用户已知代理内核的只读配置投影、Claude CLI 只读遥测/MCP 安全边界与手动触发的三路 trace。
// [OUTPUT]: 带配置来源/解析不确定性的 DNS、Mihomo 规则分段优先级（prepend/main/append-rules + RFC1918 免误报）与 Persona/Yoti KYC 及 Sift+Hexagon 组合分流规则一致性结构诊断、本机 TUN/明文 DNS 布尔状态、CLI 遥测护盾/代理回环与 NO_PROXY 一致性/MCP 供应链计数（与 src/risk-model.ts 语义对齐）、同上下文的遮罩浏览器归属、安全内网候选与绑定上下文一致（socks5h 远程 DNS + 多信号北美/全球家宽 ISP 与机房 ASN 识别及 IPQuery 回退）的跨域出口结果。
// [POS]: 风控验证原生只读边界门面；保持 `crate::risk_check::*` 公开类型/函数与 `#[tauri::command]` 宏路径不变，绝不读取或输出任何代理密码、节点域名、订阅地址或账号凭据。
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md 与 ./CLAUDE.md
use serde::{Deserialize, Serialize};

mod cli;
#[path = "../risk_config_source.rs"]
mod config_source;
mod mihomo;
mod probe;
mod system_net;
#[cfg(test)]
mod tests;

pub use cli::audit_claude_cli_security_dir;
#[cfg_attr(not(test), allow(unused_imports))]
pub use mihomo::audit_mihomo_yaml_structure;
pub use probe::parse_browser_dns_guard;
#[allow(unused_imports)]
pub use probe::parse_cloudflare_trace;
pub(crate) use probe::probe_consistency_urls;
pub use system_net::is_valid_rfc1918_lan_ipv4;
#[cfg_attr(not(test), allow(unused_imports))]
pub use system_net::parse_windows_ipconfig_utf8;
pub(crate) use system_net::system_tun_and_dns_status;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct BrowserDnsGuard {
    pub proxy_configured: bool,
    pub proxy_scheme: Option<String>,
    pub proxy_local_port: Option<u16>,
    pub remote_dns_locked: bool,
    pub target_country: Option<String>,
    pub target_timezone: String,
    pub target_language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct MihomoAudit {
    pub detected: bool,
    pub config_source: Option<String>,
    pub config_source_status: Option<String>,
    pub dns_projection_complete: bool,
    pub dns_has_encrypted_resolver: bool,
    pub dns_has_domestic_encrypted: bool,
    pub client_kind: Option<String>,
    pub mixed_port: Option<u16>,
    pub allow_lan: Option<bool>,
    pub tun_enabled: Option<bool>,
    pub tun_strict_route: Option<bool>,
    pub dns_enabled: Option<bool>,
    pub dns_enhanced_mode: Option<String>,
    pub dns_respect_rules: Option<bool>,
    pub dns_has_remote_doh: bool,
    pub dns_has_domestic_plain: bool,
    pub dns_has_nameserver_policy: bool,
    pub has_claude_rules: bool,
    pub has_persona_rules: bool,
    #[serde(default)]
    pub has_sift_rules: bool,
    #[serde(default)]
    pub has_telemetry_rules: bool,
    pub has_quic_reject: bool,
    pub has_geoip_cn: bool,
    pub dedicated_listener_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CliSecurityAudit {
    pub settings_present: bool,
    pub telemetry_shield_active: bool,
    #[serde(default)]
    pub nonessential_traffic_blocked: bool,
    pub proxy_env_complete: bool,
    pub socks5_in_cli_env: bool,
    pub has_custom_hooks_or_helpers: bool,
    #[serde(default)]
    pub non_english_language: bool,
    pub unpinned_npx_count: usize,
    pub remote_http_mcp_count: usize,
    pub windows_bare_npx_count: usize,
    pub pending_failed_telemetry_files: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct SystemNetworkAudit {
    pub tun_adapter_active: bool,
    pub secondary_plaintext_dns_active: bool,
    pub lan_ipv4_candidates: Vec<String>,
    pub public_wan_detected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RiskBrowserIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LocalRiskSnapshot {
    pub context_id: Option<String>,
    #[serde(default)]
    pub browser_identity: Option<RiskBrowserIdentity>,
    pub browser: BrowserDnsGuard,
    pub mihomo: MihomoAudit,
    pub system: SystemNetworkAudit,
    #[serde(default)]
    pub cli_security: Option<CliSecurityAudit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TraceEndpointResult {
    pub domain: String,
    pub ok: bool,
    pub country: Option<String>,
    pub colo: Option<String>,
    pub ip: Option<String>,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ConsistencyProbeReport {
    pub context_id: Option<String>,
    pub claude: TraceEndpointResult,
    pub persona: TraceEndpointResult,
    pub unlisted_dns: TraceEndpointResult,
    pub exit_isp: Option<crate::browser::network::Exit>,
    pub same_country: Option<bool>,
    pub same_exit_ip: Option<bool>,
    pub unlisted_same_country: Option<bool>,
}

#[tauri::command]
pub async fn risk_inspect_local_env(app: tauri::AppHandle) -> Result<LocalRiskSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = crate::browser::current_risk_browser_context(&app);
        let expected = ctx.clone();
        let browser_identity =
            crate::browser::risk_browser_identity(&app, &ctx.context_id).map(|identity| {
                RiskBrowserIdentity {
                    name: identity.name,
                    email: identity.email,
                    status: identity.status.to_string(),
                }
            });
        let browser = parse_browser_dns_guard(
            &ctx.configured_proxy,
            ctx.target_country,
            ctx.target_timezone,
            ctx.target_language,
        );
        let mihomo = mihomo::inspect_local_mihomo();
        let system = system_net::inspect_system_network();
        let cli_security = cli::inspect_local_cli_security();
        if expected != crate::browser::current_risk_browser_context(&app) {
            return Err("risk_context_changed".to_string());
        }
        Ok(LocalRiskSnapshot {
            context_id: ctx.context_id,
            browser_identity,
            browser,
            mihomo,
            system,
            cli_security,
        })
    })
    .await
    .map_err(|_| "风控环境读取被中断。".to_string())?
}

#[tauri::command]
pub async fn risk_probe_consistency(
    app: tauri::AppHandle,
) -> Result<ConsistencyProbeReport, String> {
    let before_app = app.clone();
    let context = tauri::async_runtime::spawn_blocking(move || {
        crate::browser::current_risk_browser_context(&before_app)
    })
    .await
    .map_err(|_| "risk_context_unavailable".to_string())?;
    if context.context_id.is_none() {
        return Err("risk_context_unavailable".into());
    }

    let mut report = probe_consistency_urls(
        &context.effective_proxy,
        "https://claude.ai/cdn-cgi/trace",
        "https://withpersona.com/cdn-cgi/trace",
        "https://cloudflare-dns.com/cdn-cgi/trace",
        true,
    )
    .await;
    let after = tauri::async_runtime::spawn_blocking(move || {
        crate::browser::current_risk_browser_context(&app)
    })
    .await
    .map_err(|_| "risk_context_unavailable".to_string())?;
    if context != after {
        return Err("risk_context_changed".into());
    }
    report.context_id = context.context_id;
    Ok(report)
}
