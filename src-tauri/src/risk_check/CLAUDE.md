# risk_check/
风控验证原生只读核验包（仅扫描配置布尔/端口/规则结构与受限三路出口 trace，零凭据/代理密码/节点域名提取）。
> L3 | 父级: ../CLAUDE.md
mod.rs: 对外公开结构体（`BrowserDnsGuard`、`MihomoAudit`、`CliSecurityAudit`、`SystemNetworkAudit`、`RiskBrowserIdentity`、`LocalRiskSnapshot`、`TraceEndpointResult`、`ConsistencyProbeReport`）、`#[tauri::command]`（`risk_inspect_local_env` 与 `risk_probe_consistency`）及 `crate::risk_check::*` 门面重导出（含 `../risk_config_source.rs` 发现模块）。
mihomo.rs: Mihomo/Clash YAML 布尔/端口/DNS 投影与按生效顺序（`prepend-rules` -> `rules` -> `append-rules`，豁免 RFC1918 CIDR）的 Claude / Persona / Yoti / Sift+Hexagon / Datadog 分流对齐结构诊断，显式跳过 `proxies` / `authentication` / `secret` 等敏感段落。
system_net.rs: Windows `ipconfig /all` UTF-8（中英双语字段）与非 Windows 内核 UDP 回退的 RFC1918 私有局域网候选过滤（排除校园网大内网/WSL/Hyper-V/Fake-IP/公网 WAN）及供 `browser/kill_switch.rs` 复用的 `system_tun_and_dns_status`。
cli.rs: `.claude/settings(.local).json`、`.claude.json`、`.claude/.mcp.json` 与 `1p_failed_events.*.json` 的遥测护盾、HTTP 代理与 `NO_PROXY` 环回一致性及 MCP 供应链只读计数审计（`audit_claude_cli_security_dir`，与 `src/risk-model.ts` 对齐）。
probe.rs: `parse_browser_dns_guard`（对齐 `browser::config::proxy`，覆盖 `http`/`https`/`socks5`/`socks5h` 显式代理远端 DNS 锁定）、`parse_cloudflare_trace` 及经冻结代理并发探测 `claude.ai`、`withpersona.com` 与 `cloudflare-dns.com` trace 的 `probe_consistency_urls`（含同 IP 校验与 IPQuery 回退）。
tests.rs: 合成 Mihomo YAML、中英文 ipconfig 样本、临时 CLI 目录与回环 mock trace HTTP 服务的离线单元测试回归（`#[cfg(test)]`）。
[PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
