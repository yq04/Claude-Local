/**
 * [INPUT]: 原生只读环境快照（risk_inspect_local_env 含 CLI 遥测护盾/MCP 供应链审计与 Mihomo Sift/Hexagon/Telemetry 规则标志 has_sift_rules / has_telemetry_rules）、用户触发的三路边缘一致性探针（risk_probe_consistency）、隐私遮罩偏好与双语文案。
 * [OUTPUT]: 四模块单层工作台布局：安全态势与四栏紧凑去重遥测条（含 Datadog/遥测 `[data-risk-telemetry-rules]` 与 Sift/Hexagon `[data-risk-sift-rules]` 分流规则对齐指示）、带分组标头的双层三列静态/动态核验矩阵与 strict-route 闭环修复向导、移动端 3+2 徽章去折叠扫码桥接（含贴边分隔独立提示框）及 6 步前置飞行清单（含 PayPal 站点清理直达助手）。
 * [POS]: 风控验证主页面；零上游凭据读取、零临时口令落盘、严格拦截非 RFC1918 内网暴露，所有修复通过可审计 AI 提示词或用户显式下载完成。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {Button, Input} from 'cromma-ui';
import {CheckTickCircle, Refresh} from 'cromma-ui/pika';
import {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {usePageRefresh} from './app-events';
import {AppDialog} from './dialog';
import {useI18n} from './i18n';
import type {Page} from './navigation';
import {encodeQrMatrix, renderQrSvgPath} from './qrcode-svg';
import {
  buildClaudeCliAntiLeakSettingsJson,
  buildCloseLanBridgePrompt,
  buildDesktopDnsFixPrompt,
  buildDesktopMihomoAntiLeakYaml,
  buildMihomoStrictRouteSnippet,
  buildMobileBridgeConfig,
  buildShadowrocketSocksQrUri,
  buildShadowrocketUniversalAntiLeakConf,
  buildStandaloneMobilePrompt,
  DEFAULT_DEDICATED_LISTENER_PORT,
  evaluateRiskChecks,
  compareProbeExits,
  isCliMcpBoundarySafe,
  isCliSecurityShieldOk,
  isCurrentRiskProbe,
  generateBridgeCredentials,
  isValidBridgePort,
  isValidRfc1918Ipv4,
  maskIpAddress,
  parsePortInput,
  resolveRiskBanner,
  type ConsistencyProbeReport,
  type LocalRiskSnapshot,
  type MobileBridgeMode,
  type MobileClientId,
  type RiskCheckStatus,
} from './risk-model';
import {maskDisplayName, usePreferences} from './settings-model';
import './risk-verification.css';

const MOBILE_CLIENTS: readonly {id: MobileClientId; label: string}[] = [
  {id: 'shadowrocket', label: 'Shadowrocket (iOS)'},
  {id: 'clash-mi', label: 'Clash Mi / FlClash'},
  {id: 'stash', label: 'Stash (iOS)'},
  {id: 'sing-box', label: 'sing-box / NekoBox'},
];

const CHECKLIST_STEP_IDS = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'] as const;
const MATRIX_COPY_IDS = new Set(['desktop-fix', 'desktop-yaml', 'cli-settings-json']);
const MOBILE_COPY_IDS = new Set([
  'open-bridge',
  'socks-uri',
  'mobile-cfg',
  'close-bridge',
  'standalone-mobile',
  'sr-antileak',
]);

function statusSymbol(status: RiskCheckStatus): string {
  if (status === 'ok') return '✓';
  if (status === 'warn') return '!';
  if (status === 'fail') return '×';
  return '·';
}

function stripHeadingIndexPrefix(title: string): string {
  return title.replace(/^(?:[①②③④⑤⑥]|\d+[.)、])\s*/, '');
}

function stripTelemetryPrefix(text: string): string {
  const stripped = text.replace(/^[^:：]+[:：]\s*/, '').trim();
  return stripped ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : text;
}

function tryBridgeCredentials(): ReturnType<typeof generateBridgeCredentials> | null {
  try {
    return generateBridgeCredentials();
  } catch {
    return null;
  }
}

export function RiskVerificationPanel({onNavigate}: {onNavigate?: (page: Page) => void}) {
  const {t, locale} = useI18n();
  const {privacyMask} = usePreferences();
  const ipInputId = useId();
  const portInputId = useId();
  const srHostId = useId();
  const srPortId = useId();
  const srUserId = useId();
  const srPassId = useId();

  const [local, setLocal] = useState<LocalRiskSnapshot | null>(null);
  const [inspecting, setInspecting] = useState(true);
  const [inspectError, setInspectError] = useState('');

  const [probe, setProbe] = useState<ConsistencyProbeReport | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState('');

  const [bridgeMode, setBridgeMode] = useState<MobileBridgeMode>('lan');
  const [modeTouched, setModeTouched] = useState(false);
  const [client, setClient] = useState<MobileClientId>('shadowrocket');
  const [lanIp, setLanIp] = useState('');
  const [lanIpTouched, setLanIpTouched] = useState(false);
  const [portInput, setPortInput] = useState(String(DEFAULT_DEDICATED_LISTENER_PORT));
  const [portTouched, setPortTouched] = useState(false);
  const [creds, setCreds] = useState(tryBridgeCredentials);

  // In-memory Shadowrocket static residential QR fields (never persisted or transmitted)
  const [srHost, setSrHost] = useState('');
  const [srPort, setSrPort] = useState('');
  const [srUser, setSrUser] = useState('');
  const [srPass, setSrPass] = useState('');
  const [showSrConfText, setShowSrConfText] = useState(false);

  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [strictRouteGuideOpen, setStrictRouteGuideOpen] = useState(false);
  const [copiedId, setCopiedId] = useState('');
  const [copyingId, setCopyingId] = useState('');
  const [copyAttemptId, setCopyAttemptId] = useState('');
  const [copyError, setCopyError] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  const live = useRef(false);
  const request = useRef(0);
  const operationBusy = useRef(false);
  const contextInvalidated = useRef(false);
  const touched = useRef({lanIpTouched, portTouched, modeTouched});
  touched.current = {lanIpTouched, portTouched, modeTouched};

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const refreshLocalSnapshot = useCallback(async () => {
    if (operationBusy.current) return;
    operationBusy.current = true;
    contextInvalidated.current = false;
    const id = ++request.current;
    const current = () => live.current && request.current === id && !contextInvalidated.current;
    setInspecting(true);
    setInspectError('');
    setLocal(null);
    setProbe(null);
    setProbeError('');
    try {
      const snap = await invoke<LocalRiskSnapshot>('risk_inspect_local_env');
      if (!current()) return;
      setLocal(snap);
      if (!touched.current.lanIpTouched) {
        setLanIp(snap.system.lan_ipv4_candidates[0] ?? '');
      }
      if (!touched.current.portTouched && snap.mihomo.dedicated_listener_port) {
        setPortInput(String(snap.mihomo.dedicated_listener_port));
      }
      if (!touched.current.modeTouched) {
        const shouldStandalone =
          snap.system.lan_ipv4_candidates.length === 0 || snap.system.public_wan_detected;
        setBridgeMode(shouldStandalone ? 'standalone' : 'lan');
      }
    } catch (err) {
      if (current()) setInspectError(err instanceof Error ? err.message : String(err));
    } finally {
      if (request.current === id) operationBusy.current = false;
      if (live.current && request.current === id) {
        setInspecting(false);
        if (contextInvalidated.current) void refreshLocalSnapshot();
      }
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void refreshLocalSnapshot();
    const revalidate = () => {
      setProbe(null);
      if (operationBusy.current) {
        contextInvalidated.current = true;
        setLocal(null);
      } else void refreshLocalSnapshot();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        setProbe(null);
        if (operationBusy.current) contextInvalidated.current = true;
      } else revalidate();
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      live.current = false;
      request.current++;
      operationBusy.current = false;
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [refreshLocalSnapshot]);

  usePageRefresh(() => {
    if (!inspecting && !probing) {
      void refreshLocalSnapshot();
    }
  });

  async function runConsistencyProbe() {
    if (operationBusy.current) return;
    operationBusy.current = true;
    contextInvalidated.current = false;
    const id = ++request.current;
    const current = () => live.current && request.current === id && !contextInvalidated.current;
    setProbing(true);
    setProbeError('');
    setProbe(null);
    setLocal(null);
    setInspectError('');
    try {
      const before = await invoke<LocalRiskSnapshot>('risk_inspect_local_env');
      if (!current()) return;
      const freshProbe = await invoke<ConsistencyProbeReport>('risk_probe_consistency');
      if (!current()) return;
      const freshLocal = await invoke<LocalRiskSnapshot>('risk_inspect_local_env');
      if (!current()) return;
      setLocal(freshLocal);
      if (!isCurrentRiskProbe(before, freshProbe) || !isCurrentRiskProbe(freshLocal, freshProbe)) {
        setProbeError('risk.contextChanged');
        return;
      }
      setProbe(freshProbe);
    } catch (err) {
      if (current()) setProbeError(err instanceof Error ? err.message : String(err));
    } finally {
      if (request.current === id) operationBusy.current = false;
      if (live.current && request.current === id) {
        setProbing(false);
        if (contextInvalidated.current) void refreshLocalSnapshot();
      }
    }
  }

  async function copyText(id: string, value: string) {
    if (copyingId || !value) return;
    window.clearTimeout(copyTimer.current);
    setCopiedId('');
    setCopyError(false);
    setCopyAttemptId(id);
    setCopyingId(id);
    try {
      try {
        await invoke('copy_result', {text: value});
      } catch {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
      }
      setCopiedId(id);
      copyTimer.current = window.setTimeout(() => setCopiedId(''), 2000);
    } catch {
      setCopyError(true);
    } finally {
      setCopyingId('');
    }
  }

  function downloadTextFile(filename: string, content: string) {
    const blob = new Blob([content], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const parsedPort = parsePortInput(portInput);
  const validPort = isValidBridgePort(parsedPort);
  const safePort = validPort ? parsedPort : DEFAULT_DEDICATED_LISTENER_PORT;
  const validLanIp = isValidRfc1918Ipv4(lanIp);

  const checks = useMemo(
    () => evaluateRiskChecks(local, probe, privacyMask),
    [local, probe, privacyMask],
  );
  const staticChecks = useMemo(
    () => checks.filter(item => item.id === 'browser_dns_lock' || item.id === 'mihomo_dns_leak' || item.id === 'kyc_routing_rules'),
    [checks],
  );
  const probeChecks = useMemo(
    () => checks.filter(item => item.id === 'claude_exit' || item.id === 'persona_consistency' || item.id === 'exit_isp_kind'),
    [checks],
  );
  const staticPassed = staticChecks.filter(item => item.status === 'ok').length;
  const probePassed = probeChecks.filter(item => item.status === 'ok').length;
  const banner = useMemo(() => resolveRiskBanner(local, probe, checks), [local, probe, checks]);
  const bannerStatus = banner.status;
  const comparison = probe ? compareProbeExits(probe) : 'unknown';
  const cliSec = local?.cli_security ?? null;
  const cliShieldOk = isCliSecurityShieldOk(cliSec);
  const cliMcpOk = isCliMcpBoundarySafe(cliSec);

  const bridgeArtifact = useMemo(() => {
    if (!creds || !validLanIp || !validPort) return null;
    return buildMobileBridgeConfig({
      client,
      lanIp,
      port: parsedPort,
      username: creds.username,
      password: creds.password,
    });
  }, [client, creds, lanIp, parsedPort, validLanIp, validPort]);

  const qrSvg = useMemo(() => {
    if (!bridgeArtifact) return null;
    try {
      return renderQrSvgPath(encodeQrMatrix(bridgeArtifact.qrUri), 2);
    } catch {
      return null;
    }
  }, [bridgeArtifact]);

  const targetTimezone = local?.browser.target_timezone || 'America/Los_Angeles';
  const desktopFixPrompt = useMemo(
    () =>
      buildDesktopDnsFixPrompt({
        locale,
        dedicatedPort: safePort,
        enableLanBridge: false,
        clientKind: local?.mihomo.client_kind,
        targetTimezone,
      }),
    [local?.mihomo.client_kind, locale, safePort, targetTimezone],
  );

  const openLanBridgePrompt = useMemo(
    () =>
      creds ? buildDesktopDnsFixPrompt({
        locale,
        dedicatedPort: safePort,
        enableLanBridge: true,
        lanUsername: creds.username,
        lanPassword: creds.password,
        clientKind: local?.mihomo.client_kind,
        targetTimezone,
      }) : '',
    [creds, local?.mihomo.client_kind, locale, safePort, targetTimezone],
  );

  const closeLanBridgePrompt = useMemo(
    () => buildCloseLanBridgePrompt(safePort, locale),
    [locale, safePort],
  );

  const standaloneMobilePrompt = useMemo(
    () => buildStandaloneMobilePrompt({client, targetTimezone, locale}),
    [client, locale, targetTimezone],
  );

  const srAntiLeakConf = useMemo(() => buildShadowrocketUniversalAntiLeakConf(), []);
  const desktopYaml = useMemo(() => buildDesktopMihomoAntiLeakYaml(safePort), [safePort]);
  const cliSettingsJson = useMemo(() => buildClaudeCliAntiLeakSettingsJson(safePort), [safePort]);
  const [showDesktopYamlPreview, setShowDesktopYamlPreview] = useState(false);
  const [showCliSettingsPreview, setShowCliSettingsPreview] = useState(false);
  const srStandaloneUri = useMemo(() => {
    const p = parsePortInput(srPort);
    return buildShadowrocketSocksQrUri({
      host: srHost,
      port: p,
      username: srUser,
      password: srPass,
      remarks: 'US-Static-Residential',
    });
  }, [srHost, srPass, srPort, srUser]);

  const srStandaloneQrSvg = useMemo(() => {
    if (!srStandaloneUri) return null;
    try {
      return renderQrSvgPath(encodeQrMatrix(srStandaloneUri), 2);
    } catch {
      return null;
    }
  }, [srStandaloneUri]);

  const completedSteps = CHECKLIST_STEP_IDS.filter(id => checkedSteps[id]).length;
  const publicOrNoLan = Boolean(
    local && (local.system.public_wan_detected || local.system.lan_ipv4_candidates.length === 0),
  );

  const auditTitleKey = banner.titleKey;
  const auditDescKey = banner.descKey;

  const browserDotClass = local?.browser_identity
    ? local.browser_identity.status === 'warming'
      ? 'is-warming'
      : 'is-ready'
    : '';
  const browserDisplayName = local?.browser_identity
    ? maskDisplayName(local.browser_identity.name, local.browser_identity.email, privacyMask) || t('risk.telemetry.uninspected')
    : t('risk.telemetry.uninspected');
  const coreDotClass =
    local?.mihomo.config_source === 'running_core' && local.mihomo.config_source_status === 'confirmed'
      ? 'is-ready'
      : local
        ? 'is-pending'
        : '';
  const coreSourceValue = local
    ? t(
        local.mihomo.config_source === 'running_core' && local.mihomo.config_source_status === 'confirmed'
          ? 'risk.audit.runningSource'
          : local.mihomo.config_source === 'candidate_file'
            ? 'risk.audit.candidateSource'
            : 'risk.audit.unknownSource',
      )
    : t('risk.telemetry.uninspected');
  const cliDotClass = !cliSec ? '' : cliShieldOk ? 'is-ready' : 'is-pending';
  const mcpDotClass = !cliSec ? '' : cliMcpOk ? 'is-ready' : 'is-pending';
  const cliShieldFull = cliSec
    ? t(cliShieldOk ? 'risk.cliSecurity.shieldOk' : 'risk.cliSecurity.shieldWarn')
    : t('risk.telemetry.uninspected');
  const unpinnedMcpCount = cliSec ? Math.max(cliSec.unpinned_npx_count, cliSec.windows_bare_npx_count) : 0;
  const remoteMcpCount = cliSec ? cliSec.remote_http_mcp_count : 0;
  const mcpAuditFull = !cliSec
    ? t('risk.telemetry.uninspected')
    : cliMcpOk
      ? t('risk.cliSecurity.mcpOk')
      : unpinnedMcpCount === 0 && remoteMcpCount === 0 && cliSec.has_custom_hooks_or_helpers
        ? t('risk.cliSecurity.mcpCustomHooks')
        : t('risk.cliSecurity.mcpWarn', {
            unpinned: unpinnedMcpCount,
            remote: remoteMcpCount,
          });

  const showMatrixFeedback =
    (copiedId !== '' && MATRIX_COPY_IDS.has(copiedId)) ||
    (copyError && MATRIX_COPY_IDS.has(copyAttemptId));
  const showMobileFeedback =
    (copiedId !== '' && MOBILE_COPY_IDS.has(copiedId)) ||
    (copyError && MOBILE_COPY_IDS.has(copyAttemptId));
  const showChecklistError = copyError && copyAttemptId === 'paypal-cookie-url';
  const showDialogError =
    copyError && (copyAttemptId === 'strict-route-snippet' || copyAttemptId === 'desktop-fix');

  return (
    <section className="system-page risk-page">
      <header className="cleanup-title risk-header">
        <h1>{t('风控验证')}</h1>
        <div className="risk-header-actions">
          <Button
            variant="secondary"
            size="small"
            loading={probing || inspecting}
            disabled={inspecting || probing}
            leftIcon={<Refresh size={14} className={probing || inspecting ? 'spin' : ''} aria-hidden="true" />}
            onClick={() => void runConsistencyProbe()}
          >
            {probing ? t('risk.probing') : probe ? t('risk.reprobe') : t('risk.startProbe')}
          </Button>
        </div>
      </header>

      <div className="risk-content">
        {/* Module 1: Security Posture & 4-Column Telemetry Card */}
        <section className="settings-card risk-posture-card" aria-busy={inspecting || probing}>
          <div className="risk-audit-banner" data-audit-banner={bannerStatus} data-status={bannerStatus} role="status" aria-live="polite">
            <div className="risk-banner-main">
              <span className="risk-status-dot" data-status={bannerStatus} aria-hidden="true">
                {statusSymbol(bannerStatus)}
              </span>
              <div className="risk-banner-copy">
                <strong>{t(auditTitleKey)}</strong>
                <span>{t(auditDescKey)}</span>
              </div>
            </div>

            {probe ? (
              <div className="risk-trace-compare">
                <span className="risk-trace-chip">
                  <strong>claude.ai</strong>
                  <span>{probe.claude.country || '—'}</span>
                  <small>{maskIpAddress(probe.claude.ip, privacyMask)}</small>
                </span>
                <span
                  className={`risk-trace-verdict ${comparison === 'same_ip' ? 'ok' : comparison === 'different_country' ? 'fail' : 'pending'}`}
                >
                  {comparison === 'same_ip'
                    ? t('risk.compare.sameIp')
                    : comparison === 'same_country'
                      ? t('risk.compare.sameCountryDiffIp')
                      : comparison === 'different_country'
                        ? t('risk.compare.splitLeak')
                        : t('risk.compare.unknown')}
                </span>
                <span className="risk-trace-chip">
                  <strong>withpersona.com</strong>
                  <span>{probe.persona.country || '—'}</span>
                  <small>{maskIpAddress(probe.persona.ip, privacyMask)}</small>
                </span>
              </div>
            ) : (
              <div className="risk-banner-pills">
                <span className={`settings-meta-pill${staticPassed === staticChecks.length ? ' ok' : ''}`}>
                  {t('risk.group.staticProgress', {passed: staticPassed, total: staticChecks.length})}
                </span>
                <span className="settings-meta-pill">{t('risk.group.probeWaiting')}</span>
              </div>
            )}
          </div>

          <div className="risk-telemetry-strip">
            <div className="risk-telemetry-cell">
              <div className="risk-telemetry-head">
                <span className={`risk-telemetry-dot${browserDotClass ? ` ${browserDotClass}` : ''}`} aria-hidden="true" />
                <span className="risk-telemetry-label">{t('risk.telemetry.browserLabel')}</span>
              </div>
              <strong data-risk-browser-identity={local?.browser_identity?.status} title={browserDisplayName}>
                {browserDisplayName}
              </strong>
              <small data-browser-owner-scope title={t('risk.browserOwnerScope')}>
                {t('risk.browserOwnerScope')}
              </small>
            </div>

            <div className="risk-telemetry-cell">
              <div className="risk-telemetry-head">
                <span className={`risk-telemetry-dot${coreDotClass ? ` ${coreDotClass}` : ''}`} aria-hidden="true" />
                <span className="risk-telemetry-label">{t('risk.telemetry.coreLabel')}</span>
              </div>
              <strong title={coreSourceValue}>{local ? stripTelemetryPrefix(coreSourceValue) : coreSourceValue}</strong>
              {local?.mihomo.has_telemetry_rules ? (
                <small className="is-ok" data-risk-telemetry-rules="ok" title={t('risk.cliSecurity.telemetryRulesOk')}>
                  {t('risk.cliSecurity.telemetryRulesOk')}
                </small>
              ) : local?.mihomo.detected &&
                local.mihomo.config_source === 'running_core' &&
                local.mihomo.config_source_status === 'confirmed' &&
                local.mihomo.has_telemetry_rules === false ? (
                <small
                  className="is-warn"
                  data-risk-telemetry-rules="missing"
                  title={t('risk.cliSecurity.telemetryRulesMissing')}
                >
                  {t('risk.cliSecurity.telemetryRulesMissing')}
                </small>
              ) : (
                <small title={t('risk.telemetry.telemetryPending')}>{t('risk.telemetry.telemetryPending')}</small>
              )}
              {local?.mihomo.detected && typeof local.mihomo.has_sift_rules === 'boolean' && (
                <small
                  className={local.mihomo.has_sift_rules ? 'is-ok' : 'is-warn'}
                  data-risk-sift-rules={local.mihomo.has_sift_rules ? 'ok' : 'missing'}
                  title={local.mihomo.has_sift_rules ? t('risk.cliSecurity.siftRulesOk') : t('risk.cliSecurity.siftRulesMissing')}
                >
                  {local.mihomo.has_sift_rules ? t('risk.cliSecurity.siftRulesOk') : t('risk.cliSecurity.siftRulesMissing')}
                </small>
              )}
            </div>

            <div className="risk-telemetry-cell">
              <div className="risk-telemetry-head">
                <span className={`risk-telemetry-dot${cliDotClass ? ` ${cliDotClass}` : ''}`} aria-hidden="true" />
                <span className="risk-telemetry-label">{t('risk.telemetry.cliLabel')}</span>
              </div>
              <strong
                data-risk-cli-shield={cliSec ? (cliShieldOk ? 'ok' : 'warn') : undefined}
                title={cliSec && !cliShieldOk ? `${cliShieldFull} — ${t('risk.cliSecurity.shieldWarnHint')}` : cliShieldFull}
              >
                {cliSec ? stripTelemetryPrefix(cliShieldFull) : cliShieldFull}
              </strong>
              <div className="risk-cell-tags">
                {cliSec?.nonessential_traffic_blocked && (
                  <span
                    className="risk-inline-warn"
                    data-risk-cli-nonessential="blocked"
                    title={t('risk.cliSecurity.nonessentialBlockedHint')}
                  >
                    {t('risk.cliSecurity.nonessentialBlockedWarn')}
                  </span>
                )}
                {cliSec?.socks5_in_cli_env ? (
                  <span
                    className="risk-inline-warn"
                    data-risk-cli-proxy="socks5"
                    title={t('risk.cliSecurity.socks5Hint')}
                  >
                    {t('risk.cliSecurity.socks5Warn')}
                  </span>
                ) : cliSec && !cliSec.proxy_env_complete ? (
                  <span
                    className="risk-inline-warn"
                    data-risk-cli-proxy="incomplete"
                    title={t('risk.cliSecurity.proxyEnvIncompleteHint')}
                  >
                    {t('risk.cliSecurity.proxyEnvIncompleteWarn')}
                  </span>
                ) : cliSec ? (
                  <small className="is-ok" title={t('risk.telemetry.cliProxyReady')}>{t('risk.telemetry.cliProxyReady')}</small>
                ) : (
                  <small>—</small>
                )}
              </div>
              {cliSec?.non_english_language && (
                <small data-risk-cli-language="non-english" title={t('risk.cliSecurity.languageWarnHint')}>
                  {t('risk.cliSecurity.languageWarnHint')}
                </small>
              )}
            </div>

            <div className="risk-telemetry-cell">
              <div className="risk-telemetry-head">
                <span className={`risk-telemetry-dot${mcpDotClass ? ` ${mcpDotClass}` : ''}`} aria-hidden="true" />
                <span className="risk-telemetry-label">{t('risk.telemetry.mcpLabel')}</span>
              </div>
              <strong data-risk-mcp-audit={cliSec ? (cliMcpOk ? 'ok' : 'warn') : undefined} title={mcpAuditFull}>
                {cliSec ? stripTelemetryPrefix(mcpAuditFull) : mcpAuditFull}
              </strong>
              <small title={t('risk.telemetry.mcpDetail')}>{t('risk.telemetry.mcpDetail')}</small>
            </div>
          </div>

          <div className="risk-scope-footer">
            <strong>{t('risk.workflow.whyTitle')}</strong>
            <span>{t('risk.workflow.whyDesc')}</span>
          </div>

          {(inspectError || probeError) && (
            <div role="alert" className="system-feedback error risk-inline-alert">
              <p>{t(probeError || inspectError)}</p>
            </div>
          )}
        </section>

        {/* Module 2: Unified 2-Tier Edge-to-Edge 3-Column Hairline Matrix */}
        <div className="settings-group-heading risk-group-heading">
          <div className="risk-group-title-wrap">
            <span className="settings-group-bar" aria-hidden="true" />
            <h2>{t('risk.section.auditTitle')}</h2>
          </div>
        </div>

        <section className="settings-card risk-matrix-card">
          <div className="risk-matrix-head" data-audit-group="static">
            <strong className="risk-subhead-title">{stripHeadingIndexPrefix(t('risk.group.staticTitle'))}</strong>
            <span className={`settings-meta-pill${staticPassed === staticChecks.length ? ' ok' : ''}`}>
              {t('risk.group.staticProgress', {passed: staticPassed, total: staticChecks.length})}
            </span>
          </div>
          <div className="risk-checks-grid risk-grid-3">
            {staticChecks.map(item => (
              <article key={item.id} className="risk-check-item" data-status={item.status}>
                <span className="risk-status-dot" data-status={item.status} aria-hidden="true">
                  {statusSymbol(item.status)}
                </span>
                <div className="risk-check-body">
                  <strong>{t(item.titleKey)}</strong>
                  <p>{t(item.summaryKey, item.summaryParams)}</p>
                  {item.detailKeys?.map(key => <p key={key}>{t(key, item.summaryParams)}</p>)}
                </div>
              </article>
            ))}
          </div>

          <div className="risk-matrix-head" data-audit-group="probe">
            <strong className="risk-subhead-title">{stripHeadingIndexPrefix(t('risk.group.probeTitle'))}</strong>
            <span className={`settings-meta-pill${probe && probePassed === probeChecks.length ? ' ok' : ''}`}>
              {probe ? t('risk.group.probeProgress', {passed: probePassed, total: probeChecks.length}) : t('risk.group.probeWaiting')}
            </span>
          </div>
          <div className="risk-checks-grid risk-grid-3">
            {probeChecks.map(item => (
              <article key={item.id} className="risk-check-item" data-status={item.status}>
                <span className="risk-status-dot" data-status={item.status} aria-hidden="true">
                  {statusSymbol(item.status)}
                </span>
                <div className="risk-check-body">
                  <strong>{t(item.titleKey)}</strong>
                  <p>{t(item.summaryKey, item.summaryParams)}</p>
                  {item.detailKeys?.map(key => <p key={key}>{t(key, item.summaryParams)}</p>)}
                </div>
              </article>
            ))}
          </div>

          <div className="risk-remediation-bar">
            <p>{t('risk.audit.remediationHint')}</p>
            <div className="risk-action-group">
              {local && !local.browser.remote_dns_locked && onNavigate && (
                <Button variant="secondary" size="small" onClick={() => onNavigate('browser')}>
                  {t('risk.action.openBrowserSettings')}
                </Button>
              )}
              {local?.mihomo.tun_enabled === true && local?.mihomo.tun_strict_route === false && (
                <Button
                  variant="secondary"
                  size="small"
                  data-open-strict-route-guide
                  onClick={() => setStrictRouteGuideOpen(true)}
                >
                  {t('risk.action.openStrictRouteGuide')}
                </Button>
              )}
              <Button
                variant="secondary"
                size="small"
                onClick={() => setShowDesktopYamlPreview(prev => !prev)}
              >
                {showDesktopYamlPreview ? t('risk.action.hideDesktopYaml') : t('risk.action.showDesktopYaml')}
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={() => setShowCliSettingsPreview(prev => !prev)}
              >
                {showCliSettingsPreview ? t('risk.action.hideCliSettingsJson') : t('risk.action.showCliSettingsJson')}
              </Button>
              <Button
                variant="secondary"
                size="small"
                disabled={copyingId !== ''}
                leftIcon={copiedId === 'desktop-fix' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                onClick={() => void copyText('desktop-fix', desktopFixPrompt)}
              >
                {t('risk.action.copyDesktopFix')}
              </Button>
            </div>
          </div>

          {showMatrixFeedback && (
            <p className={`risk-copy-feedback${copyError ? ' error' : ''}`} role={copyError ? 'alert' : 'status'}>
              {copyError ? t('network.copyFailed') : t('risk.feedback.copied')}
            </p>
          )}

          {showDesktopYamlPreview && (
            <div className="risk-conf-preview-wrap">
              <div className="risk-conf-preview-head">
                <strong>{desktopYaml.filename}</strong>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={copyingId !== ''}
                  leftIcon={copiedId === 'desktop-yaml' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                  onClick={() => void copyText('desktop-yaml', desktopYaml.configText)}
                >
                  {t('risk.action.copyDesktopYaml')}
                </Button>
              </div>
              <pre className="risk-conf-preview">{desktopYaml.configText}</pre>
            </div>
          )}

          {showCliSettingsPreview && (
            <div className="risk-conf-preview-wrap">
              <div className="risk-conf-preview-head">
                <strong>{cliSettingsJson.filename}</strong>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={copyingId !== ''}
                  leftIcon={copiedId === 'cli-settings-json' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                  onClick={() => void copyText('cli-settings-json', cliSettingsJson.configText)}
                >
                  {t('risk.action.copyCliSettingsJson')}
                </Button>
              </div>
              <p className="risk-remediation-hint">{t('risk.audit.cliSettingsMergeHint')}</p>
              <pre className="risk-conf-preview">{cliSettingsJson.configText}</pre>
            </div>
          )}
        </section>

        {/* Module 3: Mobile KYC Residential Bridge */}
        <div className="settings-group-heading risk-group-heading">
          <div className="risk-group-title-wrap">
            <span className="settings-group-bar" aria-hidden="true" />
            <h2>{t('risk.section.mobileTitle')}</h2>
          </div>
          <div className="settings-meta-pills">
            <span className="settings-meta-pill ok">{t('risk.security.pillRfc1918')}</span>
            <span className="settings-meta-pill ok">{t('risk.security.pillZeroSecret')}</span>
            <span className="settings-meta-pill">{t('risk.security.pillQuicBlock')}</span>
          </div>
        </div>

        <section className="settings-card risk-mobile-card">
          <div className="risk-mobile-head">
            <p className="risk-mobile-intro">{t('risk.mobile.whenWhyDesc')}</p>
            <div className="risk-toolbar-row">
              <div className="risk-pill-tabs" role="tablist" aria-label={t('risk.mobile.modeLabel')}>
                <button
                  type="button"
                  role="tab"
                  className="risk-pill-tab"
                  aria-selected={bridgeMode === 'lan'}
                  onClick={() => {
                    setModeTouched(true);
                    setBridgeMode('lan');
                  }}
                >
                  {t('risk.mobile.modeLan')}
                </button>
                <button
                  type="button"
                  role="tab"
                  className="risk-pill-tab"
                  aria-selected={bridgeMode === 'standalone'}
                  onClick={() => {
                    setModeTouched(true);
                    setBridgeMode('standalone');
                  }}
                >
                  {t('risk.mobile.modeStandalone')}
                </button>
              </div>

              <div className="risk-pill-tabs" role="tablist" aria-label={t('risk.mobile.clientLabel')}>
                {MOBILE_CLIENTS.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    className="risk-pill-tab"
                    aria-selected={client === item.id}
                    onClick={() => setClient(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {publicOrNoLan && (
            <div className="risk-callout risk-callout-flush" role="note">
              <strong>{t('risk.mobile.publicWanBadge')}</strong>
              <span>{t('risk.mobile.publicWanNotice')}</span>
            </div>
          )}

          {bridgeMode === 'lan' ? (
            <div className="risk-bridge-grid">
              <div className="risk-bridge-form">
                <div className="risk-field-row">
                  <div className="risk-field">
                    <label htmlFor={ipInputId}>{t('risk.mobile.lanIpLabel')}</label>
                    <Input
                      id={ipInputId}
                      value={lanIp}
                      placeholder="192.168.1.10"
                      autoComplete="off"
                      onChange={event => {
                        setLanIpTouched(true);
                        setLanIp(event.target.value);
                      }}
                    />
                    {local && local.system.lan_ipv4_candidates.length > 0 && (
                      <div className="risk-ip-candidates">
                        {local.system.lan_ipv4_candidates.map(candidate => (
                          <button
                            key={candidate}
                            type="button"
                            className="risk-ip-chip"
                            data-active={lanIp.trim() === candidate}
                            onClick={() => {
                              setLanIpTouched(true);
                              setLanIp(candidate);
                            }}
                          >
                            {maskIpAddress(candidate, privacyMask)}
                          </button>
                        ))}
                      </div>
                    )}
                    {!validLanIp && (
                      <span className="risk-field-error">{t('risk.mobile.invalidRfc1918')}</span>
                    )}
                  </div>

                  <div className="risk-field">
                    <label htmlFor={portInputId}>{t('risk.mobile.portLabel')}</label>
                    <Input
                      id={portInputId}
                      value={portInput}
                      placeholder="7899"
                      autoComplete="off"
                      onChange={event => {
                        setPortTouched(true);
                        setPortInput(event.target.value);
                      }}
                    />
                    {!validPort && (
                      <span className="risk-field-error">{t('risk.mobile.invalidPort')}</span>
                    )}
                  </div>
                </div>

                <div className="risk-cred-box">
                  <div className="risk-cred-tokens">
                    <span>{t('risk.mobile.ephemeralCreds')}</span>
                    <code>{creds?.username || '—'}</code>
                    <code>{creds ? (privacyMask ? '••••••••••••' : creds.password) : '—'}</code>
                  </div>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => setCreds(tryBridgeCredentials())}
                  >
                    {t('risk.action.rotateCreds')}
                  </Button>
                </div>

                {!creds && <p className="risk-field-error" role="alert">{t('risk_secure_random_unavailable')}</p>}

                <div className="risk-step-actions">
                  <div className="risk-step-line">
                    <span className="risk-step-label">
                      <span>{t('risk.mobile.lanStep1')}</span>
                    </span>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={copyingId !== '' || !validPort || !creds}
                      leftIcon={copiedId === 'open-bridge' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                      onClick={() => void copyText('open-bridge', openLanBridgePrompt)}
                    >
                      {t('risk.action.copyOpenBridgePrompt')}
                    </Button>
                  </div>

                  <div className="risk-step-line">
                    <span className="risk-step-label">
                      <span>{t('risk.mobile.lanStep2')}</span>
                    </span>
                    <div className="risk-action-group">
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={!bridgeArtifact || copyingId !== ''}
                        leftIcon={copiedId === 'socks-uri' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                        onClick={() => bridgeArtifact && void copyText('socks-uri', bridgeArtifact.qrUri)}
                      >
                        {t('risk.action.copySocksUri')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={!bridgeArtifact || copyingId !== ''}
                        leftIcon={copiedId === 'mobile-cfg' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                        onClick={() => bridgeArtifact && void copyText('mobile-cfg', bridgeArtifact.configText)}
                      >
                        {t('risk.action.copyMobileConfig')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={!bridgeArtifact}
                        onClick={() =>
                          bridgeArtifact &&
                          downloadTextFile(bridgeArtifact.filename, bridgeArtifact.configText)
                        }
                      >
                        {t('risk.action.downloadMobileConfig')}
                      </Button>
                    </div>
                  </div>

                  <div className="risk-step-line">
                    <span className="risk-step-label">
                      <span>{t('risk.mobile.lanStep3')}</span>
                    </span>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={copyingId !== ''}
                      leftIcon={copiedId === 'close-bridge' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                      onClick={() => void copyText('close-bridge', closeLanBridgePrompt)}
                    >
                      {t('risk.action.copyCloseBridgePrompt')}
                    </Button>
                  </div>
                </div>
              </div>

              <aside className="risk-qr-panel" aria-label={t('risk.mobile.qrPanelLabel')}>
                {qrSvg ? (
                  <div className="risk-qr-frame">
                    <svg
                      viewBox={`0 0 ${qrSvg.viewBoxSize} ${qrSvg.viewBoxSize}`}
                      shapeRendering="crispEdges"
                      role="img"
                      aria-label={t('risk.mobile.qrAlt')}
                    >
                      <rect width={qrSvg.viewBoxSize} height={qrSvg.viewBoxSize} fill="#ffffff" />
                      <path d={qrSvg.path} fill="#141413" />
                    </svg>
                  </div>
                ) : (
                  <div className="risk-qr-empty">{t('risk.mobile.qrNeedValidLan')}</div>
                )}
                <div className="settings-meta-pills risk-qr-pills">
                  <span className="settings-meta-pill">{t('risk.security.pillMemoryToken')}</span>
                  <span className="settings-meta-pill">{t('risk.security.pillOfflineQr')}</span>
                </div>
                <p className="risk-qr-caption">
                  {t(
                    client === 'shadowrocket'
                      ? 'risk.mobile.qrHintShadowrocket'
                      : 'risk.mobile.qrHintTunProfile',
                  )}
                </p>
              </aside>
            </div>
          ) : client === 'shadowrocket' ? (
            <div className="risk-standalone-box">
              <p className="risk-standalone-intro">{t('risk.mobile.srChainIntro')}</p>
              <div className="risk-standalone-grid">
                <div className="risk-standalone-steps">
                  <ol className="risk-sr-guide-list">
                    {(['srStep1', 'srStep2', 'srStep3', 'srStep4'] as const).map(key => (
                      <li key={key} className="risk-sr-guide-step">
                        <div className="risk-sr-guide-copy">
                          <strong>{t(`risk.mobile.${key}Title`)}</strong>
                          <span>{t(`risk.mobile.${key}Desc`)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                <aside className="risk-ephemeral-qr-card" aria-label={t('risk.mobile.srQrTitle')}>
                  <div className="risk-ephemeral-qr-head">
                    <strong>{t('risk.mobile.srQrTitle')}</strong>
                    {(srHost || srPort || srUser || srPass) && (
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => {
                          setSrHost('');
                          setSrPort('');
                          setSrUser('');
                          setSrPass('');
                        }}
                      >
                        {t('risk.action.clearMemoryInput')}
                      </Button>
                    )}
                  </div>
                  <div className="risk-mini-fields">
                    <div className="risk-field">
                      <label htmlFor={srHostId}>{t('risk.mobile.srHostLabel')}</label>
                      <Input
                        id={srHostId}
                        value={srHost}
                        placeholder="us.example.net"
                        autoComplete="off"
                        onChange={e => {
                          const raw = e.target.value.trim();
                          const urlMatch = raw.match(/^(?:socks5h?:\/\/)?([^:@\s]+):([^@\s]+)@([^:\s/]+):(\d{1,5})$/i);
                          if (urlMatch) {
                            setSrUser(urlMatch[1]);
                            setSrPass(urlMatch[2]);
                            setSrHost(urlMatch[3]);
                            setSrPort(urlMatch[4]);
                            return;
                          }
                          const quadMatch = raw.match(/^([^:\s]+):(\d{1,5}):([^:\s]+):(\S+)$/);
                          if (quadMatch) {
                            setSrHost(quadMatch[1]);
                            setSrPort(quadMatch[2]);
                            setSrUser(quadMatch[3]);
                            setSrPass(quadMatch[4]);
                            return;
                          }
                          const hostPortMatch = raw.match(/^([^:\s]+):(\d{1,5})$/);
                          if (hostPortMatch) {
                            setSrHost(hostPortMatch[1]);
                            setSrPort(hostPortMatch[2]);
                            return;
                          }
                          setSrHost(e.target.value);
                        }}
                      />
                    </div>
                    <div className="risk-field">
                      <label htmlFor={srPortId}>{t('risk.mobile.srPortLabel')}</label>
                      <Input
                        id={srPortId}
                        value={srPort}
                        placeholder="1080"
                        autoComplete="off"
                        onChange={e => setSrPort(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="risk-mini-fields">
                    <div className="risk-field">
                      <label htmlFor={srUserId}>{t('risk.mobile.srUserLabel')}</label>
                      <Input
                        id={srUserId}
                        value={srUser}
                        placeholder="username"
                        autoComplete="off"
                        onChange={e => setSrUser(e.target.value)}
                      />
                    </div>
                    <div className="risk-field">
                      <label htmlFor={srPassId}>{t('risk.mobile.srPassLabel')}</label>
                      <Input
                        id={srPassId}
                        type={privacyMask ? 'password' : 'text'}
                        value={srPass}
                        placeholder="password"
                        autoComplete="off"
                        onChange={e => setSrPass(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="risk-qr-center">
                    {srStandaloneQrSvg ? (
                      <div className="risk-qr-frame">
                        <svg
                          viewBox={`0 0 ${srStandaloneQrSvg.viewBoxSize} ${srStandaloneQrSvg.viewBoxSize}`}
                          shapeRendering="crispEdges"
                          role="img"
                          aria-label={t('risk.mobile.qrAlt')}
                        >
                          <rect
                            width={srStandaloneQrSvg.viewBoxSize}
                            height={srStandaloneQrSvg.viewBoxSize}
                            fill="#ffffff"
                          />
                          <path d={srStandaloneQrSvg.path} fill="#141413" />
                        </svg>
                      </div>
                    ) : (
                      <div className="risk-qr-empty">{t('risk.mobile.srQrPlaceholder')}</div>
                    )}
                    <div className="settings-meta-pills risk-qr-pills">
                      <span className="settings-meta-pill">{t('risk.security.pillOfflineQr')}</span>
                    </div>
                    <p className="risk-qr-caption">{t('risk.mobile.srQrPrivacyHint')}</p>
                  </div>
                </aside>
              </div>

              <div className="risk-standalone-footer">
                <div className="risk-standalone-footer-bar">
                  <div className="risk-callout risk-callout-inline" role="note">
                    <strong>{t('risk.mobile.srSwitchModeBadge')}</strong>
                    <span>{t('risk.mobile.srSwitchModeNote')}</span>
                  </div>
                  <div className="risk-action-group">
                    <Button
                      variant="secondary"
                      size="small"
                      aria-expanded={showSrConfText}
                      onClick={() => setShowSrConfText(prev => !prev)}
                    >
                      {showSrConfText ? t('risk.action.hideSrConfText') : t('risk.action.showSrConfText')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={copyingId !== ''}
                      leftIcon={
                        copiedId === 'standalone-mobile' ? <CheckTickCircle size={14} aria-hidden /> : undefined
                      }
                      onClick={() => void copyText('standalone-mobile', standaloneMobilePrompt)}
                    >
                      {t('risk.action.copyStandalonePrompt')}
                    </Button>
                  </div>
                </div>
                {showSrConfText && (
                  <div className="risk-conf-preview-wrap">
                    <div className="risk-conf-preview-head">
                      <span>{srAntiLeakConf.filename}</span>
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={copyingId !== ''}
                        leftIcon={copiedId === 'sr-antileak' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                        onClick={() => void copyText('sr-antileak', srAntiLeakConf.configText)}
                      >
                        {t('risk.action.copySrAntiLeakConf')}
                      </Button>
                    </div>
                    <pre className="risk-conf-preview" tabIndex={0}>
                      {srAntiLeakConf.configText}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="risk-standalone-box is-compact">
              <p>{t('risk.mobile.standaloneDesc')}</p>
              <div className="risk-standalone-compact-bar">
                <p>{t('risk.mobile.standaloneRuleSummary')}</p>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={copyingId !== ''}
                  leftIcon={copiedId === 'standalone-mobile' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                  onClick={() => void copyText('standalone-mobile', standaloneMobilePrompt)}
                >
                  {t('risk.action.copyStandalonePrompt')}
                </Button>
              </div>
            </div>
          )}

          {showMobileFeedback && (
            <p className={`risk-copy-feedback${copyError ? ' error' : ''}`} role={copyError ? 'alert' : 'status'}>
              {copyError ? t('network.copyFailed') : t('risk.feedback.copied')}
            </p>
          )}
        </section>

        {/* Module 4: 6-Step Pre-KYC Flight Checklist */}
        <div className="settings-group-heading risk-group-heading">
          <div className="risk-group-title-wrap">
            <span className="settings-group-bar" aria-hidden="true" />
            <h2>{t('risk.section.checklistTitle')}</h2>
          </div>
          <div className="risk-action-group">
            <span className={`settings-meta-pill${completedSteps === CHECKLIST_STEP_IDS.length ? ' ok' : ''}`}>
              {t('risk.checklist.progress', {done: completedSteps, total: CHECKLIST_STEP_IDS.length})}
            </span>
            {completedSteps > 0 && (
              <Button variant="secondary" size="small" onClick={() => setCheckedSteps({})}>
                {t('risk.action.resetChecklist')}
              </Button>
            )}
          </div>
        </div>

        <section className="settings-card risk-checklist-card">
          <div className="risk-checklist-banners">
            <div className="risk-checklist-banner-cell">
              <div className="risk-checklist-banner-copy">
                <strong>{t('risk.checklist.antiEmulatorBadge')}</strong>
                <span>{t('risk.checklist.antiEmulatorNote')}</span>
              </div>
            </div>

            <div className="risk-checklist-banner-cell is-action" data-paypal-cookie-helper>
              <div className="risk-checklist-banner-copy">
                <strong>{t('risk.checklist.paypalCookieBadge')}</strong>
                <span>{t('risk.checklist.paypalCookieNote')}</span>
              </div>
              <Button
                variant="secondary"
                size="small"
                data-copy-paypal-clear-url
                disabled={copyingId !== ''}
                leftIcon={copiedId === 'paypal-cookie-url' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                onClick={() =>
                  void copyText(
                    'paypal-cookie-url',
                    'chrome://settings/content/all?searchSubpage=paypal.com',
                  )
                }
              >
                {copiedId === 'paypal-cookie-url' ? t('已复制') : t('risk.action.copyPaypalClearUrl')}
              </Button>
            </div>
          </div>

          {showChecklistError && (
            <p className="risk-copy-feedback error" role="alert">
              {t('network.copyFailed')}
            </p>
          )}

          <ol className="risk-checklist-list">
            {CHECKLIST_STEP_IDS.map(stepId => {
              const checked = Boolean(checkedSteps[stepId]);
              return (
                <li key={stepId} className="risk-checklist-item" data-checked={checked}>
                  <label className="risk-checklist-label">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={event =>
                        setCheckedSteps(prev => ({...prev, [stepId]: event.target.checked}))
                      }
                    />
                    <span className="risk-checklist-copy">
                      <strong>{t(`risk.checklist.${stepId}Title`)}</strong>
                      <span>
                        {t(`risk.checklist.${stepId}Desc`, {
                          timezone: targetTimezone,
                          port: safePort,
                        })}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <AppDialog
        open={strictRouteGuideOpen}
        onOpenChange={setStrictRouteGuideOpen}
        title={t('risk.strictRouteGuide.title')}
        description={t('risk.strictRouteGuide.subtitle')}
        width={620}
        footer={
          <>
            <Button variant="secondary" data-dialog-cancel onClick={() => setStrictRouteGuideOpen(false)}>
              {t('取消')}
            </Button>
            <Button
              variant="secondary"
              data-reverify-strict-route
              disabled={inspecting || probing}
              loading={inspecting}
              leftIcon={<Refresh size={14} className={inspecting ? 'spin' : ''} aria-hidden />}
              onClick={() => void refreshLocalSnapshot()}
            >
              {t('risk.strictRouteGuide.reverify')}
            </Button>
          </>
        }
      >
        <div className="risk-strict-route-guide" data-strict-route-guide>
          <div className="risk-callout">
            <strong>{t('risk.strictRouteGuide.whyNotEnoughTitle')}</strong>
            <span>{t('risk.strictRouteGuide.whyNotEnough')}</span>
          </div>
          <ol className="risk-strict-route-steps">
            <li>{t('risk.strictRouteGuide.step1')}</li>
            <li>{t('risk.strictRouteGuide.step2')}</li>
            <li>{t('risk.strictRouteGuide.step3')}</li>
          </ol>
          <pre className="risk-conf-preview" data-strict-route-snippet>
            {buildMihomoStrictRouteSnippet()}
          </pre>
          <div className="risk-action-group">
            <Button
              variant="secondary"
              size="small"
              data-copy-strict-route-snippet
              disabled={copyingId !== ''}
              leftIcon={copiedId === 'strict-route-snippet' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
              onClick={() => void copyText('strict-route-snippet', buildMihomoStrictRouteSnippet())}
            >
              {t('risk.strictRouteGuide.copySnippet')}
            </Button>
            <Button
              variant="secondary"
              size="small"
              disabled={copyingId !== ''}
              leftIcon={copiedId === 'desktop-fix' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
              onClick={() => void copyText('desktop-fix', desktopFixPrompt)}
            >
              {t('risk.action.copyDesktopFix')}
            </Button>
          </div>
          {showDialogError && (
            <p className="risk-copy-feedback error" role="alert">
              {t('network.copyFailed')}
            </p>
          )}
          <p
            className={`risk-strict-route-status ${local?.mihomo.tun_strict_route === true ? 'ok' : 'warn'}`}
            data-strict-route-live-status={local?.mihomo.tun_strict_route === true ? 'ok' : 'pending'}
          >
            {t(
              local?.mihomo.tun_strict_route === true
                ? 'risk.strictRouteGuide.verifiedOk'
                : 'risk.strictRouteGuide.verifiedPending',
            )}
          </p>
        </div>
      </AppDialog>
    </section>
  );
}
