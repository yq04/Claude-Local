/**
 * [INPUT]: 原生只读环境快照（risk_inspect_local_env）、用户触发的三路边缘一致性探针（risk_probe_consistency）、隐私遮罩偏好与双语文案。
 * [OUTPUT]: 明确所选浏览器范围的六项配置与HTTP出口诊断、Mihomo strict-route 闭环修复向导、过期结果隔离；桥接安全随机源缺失时局部停用。
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
  buildCloseLanBridgePrompt,
  buildDesktopDnsFixPrompt,
  buildMihomoStrictRouteSnippet,
  buildMobileBridgeConfig,
  buildShadowrocketSocksQrUri,
  buildShadowrocketUniversalAntiLeakConf,
  buildStandaloneMobilePrompt,
  DEFAULT_DEDICATED_LISTENER_PORT,
  evaluateRiskChecks,
  compareProbeExits,
  isCurrentRiskProbe,
  generateBridgeCredentials,
  isValidBridgePort,
  isValidRfc1918Ipv4,
  maskIpAddress,
  parsePortInput,
  summarizeRiskChecks,
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

function statusSymbol(status: RiskCheckStatus): string {
  if (status === 'ok') return '✓';
  if (status === 'warn') return '!';
  if (status === 'fail') return '×';
  return '·';
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

  // 独立模式下纯内存小火箭静态家宽离线生码字段（绝不落盘、不发网络、组件卸载即销毁）
  const [srHost, setSrHost] = useState('');
  const [srPort, setSrPort] = useState('');
  const [srUser, setSrUser] = useState('');
  const [srPass, setSrPass] = useState('');
  const [showSrConfText, setShowSrConfText] = useState(false);

  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [strictRouteGuideOpen, setStrictRouteGuideOpen] = useState(false);
  const [copiedId, setCopiedId] = useState('');
  const [copyingId, setCopyingId] = useState('');
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
  const overallStatus = useMemo(() => summarizeRiskChecks(checks), [checks]);
  const comparison = probe ? compareProbeExits(probe) : 'unknown';

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

  const auditTitleKey =
    overallStatus === 'ok'
      ? 'risk.auditStatus.okTitle'
      : overallStatus === 'fail'
        ? 'risk.auditStatus.failTitle'
        : overallStatus === 'warn'
          ? 'risk.auditStatus.warnTitle'
          : 'risk.auditStatus.pendingTitle';

  const auditDescKey =
    overallStatus === 'ok'
      ? 'risk.auditStatus.okDesc'
      : overallStatus === 'fail'
        ? 'risk.auditStatus.failDesc'
        : overallStatus === 'warn'
          ? 'risk.auditStatus.warnDesc'
          : 'risk.auditStatus.pendingDesc';

  return (
    <section className="system-page risk-page">
      <header className="cleanup-title risk-header">
        <h1>{t('风控验证')}</h1>
        <div className="risk-header-actions">
          <Button
            variant="secondary"
            size="small"
            loading={inspecting}
            disabled={probing}
            leftIcon={<Refresh size={14} aria-hidden="true" />}
            onClick={() => void refreshLocalSnapshot()}
          >
            {t('risk.refreshEnv')}
          </Button>
          <Button
            variant="secondary"
            size="small"
            loading={probing}
            disabled={inspecting}
            leftIcon={<Refresh size={14} className={probing ? 'spin' : ''} aria-hidden="true" />}
            onClick={() => void runConsistencyProbe()}
          >
            {probing ? t('risk.probing') : probe ? t('risk.reprobe') : t('risk.startProbe')}
          </Button>
        </div>
      </header>

      <div className="risk-content">
        {/* 第一部分：电脑 DNS 泄露与 KYC 跨域一致性诊断 */}
        <div className="settings-group-heading">
          <span className="settings-group-bar" aria-hidden="true" />
          <h2>{t('risk.section.auditTitle')}</h2>
        </div>

        <section className="settings-card risk-card" aria-busy={inspecting || probing}>
          <div className="risk-audit-banner" data-status={overallStatus} role="status" aria-live="polite">
            <div className="risk-banner-main">
              <span className="risk-status-dot" data-status={overallStatus} aria-hidden="true">
                {statusSymbol(overallStatus)}
              </span>
              <div className="risk-banner-copy">
                <strong>{t(auditTitleKey)}</strong>
                <span>{t(auditDescKey)}</span>
              </div>
            </div>

            {probe && (
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
                      : comparison === 'different_country' ? t('risk.compare.splitLeak') : t('risk.compare.unknown')}
                </span>
                <span className="risk-trace-chip">
                  <strong>withpersona.com</strong>
                  <span>{probe.persona.country || '—'}</span>
                  <small>{maskIpAddress(probe.persona.ip, privacyMask)}</small>
                </span>
              </div>
            )}
          </div>

          <p className="risk-audit-scope">{t('risk.audit.scope')}</p>
          <p className="risk-audit-scope" data-browser-owner-scope>{t('risk.browserOwnerScope')}</p>
          {local?.browser_identity && <p className="risk-audit-scope" data-risk-browser-identity={local.browser_identity.status}>
            {t(local.browser_identity.status === 'warming' ? 'browser.verificationWarmingOwner' : 'browser.verificationOwner', {name: maskDisplayName(local.browser_identity.name, local.browser_identity.email, privacyMask)})}
          </p>}
          {local && <p className="risk-audit-scope">{t(local.mihomo.config_source === 'running_core' && local.mihomo.config_source_status === 'confirmed' ? 'risk.audit.runningSource' : local.mihomo.config_source === 'candidate_file' ? 'risk.audit.candidateSource' : 'risk.audit.unknownSource')}</p>}

          {(inspectError || probeError) && (
            <div role="alert" className="system-feedback error">
              <p>{t(probeError || inspectError)}</p>
            </div>
          )}

          <div className="risk-checks-grid">
            {checks.map(item => (
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
                disabled={copyingId !== ''}
                leftIcon={copiedId === 'desktop-fix' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                onClick={() => void copyText('desktop-fix', desktopFixPrompt)}
              >
                {t('risk.action.copyDesktopFix')}
              </Button>
            </div>
          </div>
        </section>

        {/* 第二部分：手机扫码 KYC 同源家宽桥接与多客户端配置 */}
        <div className="settings-group-heading">
          <span className="settings-group-bar" aria-hidden="true" />
          <h2>{t('risk.section.mobileTitle')}</h2>
        </div>

        <section className="settings-card risk-card">
          <div className="settings-meta-pills">
            <span className="settings-meta-pill ok">{t('risk.security.pillRfc1918')}</span>
            <span className="settings-meta-pill ok">{t('risk.security.pillZeroSecret')}</span>
            <span className="settings-meta-pill">{t('risk.security.pillMemoryToken')}</span>
            <span className="settings-meta-pill">{t('risk.security.pillOfflineQr')}</span>
            <span className="settings-meta-pill">{t('risk.security.pillQuicBlock')}</span>
          </div>

          {publicOrNoLan && (
            <div className="risk-callout" role="note">
              <strong>{t('risk.mobile.publicWanBadge')}</strong>
              <span>{t('risk.mobile.publicWanNotice')}</span>
            </div>
          )}

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
                      <span className="local-badge" aria-hidden="true">01</span>
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
                      <span className="local-badge" aria-hidden="true">02</span>
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
                      <span className="local-badge" aria-hidden="true">03</span>
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
              <p>{t('risk.mobile.srChainIntro')}</p>
              <div className="risk-standalone-grid">
                <div className="risk-bridge-form">
                  <ol className="risk-sr-guide-list">
                    {(['srStep1', 'srStep2', 'srStep3', 'srStep4'] as const).map((key, idx) => (
                      <li key={key} className="risk-sr-guide-step">
                        <span className="local-badge" aria-hidden="true">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <div className="risk-sr-guide-copy">
                          <strong>{t(`risk.mobile.${key}Title`)}</strong>
                          <span>{t(`risk.mobile.${key}Desc`)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="risk-action-group">
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={copyingId !== ''}
                      leftIcon={copiedId === 'sr-antileak' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                      onClick={() => void copyText('sr-antileak', srAntiLeakConf.configText)}
                    >
                      {t('risk.action.copySrAntiLeakConf')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() =>
                        downloadTextFile(srAntiLeakConf.filename, srAntiLeakConf.configText)
                      }
                    >
                      {t('risk.action.downloadMobileConfig')}
                    </Button>
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
                  {showSrConfText && (
                    <pre className="risk-conf-preview" tabIndex={0}>
                      {srAntiLeakConf.configText}
                    </pre>
                  )}
                  <div className="risk-callout" role="note">
                    <strong>{t('risk.mobile.srSwitchModeBadge')}</strong>
                    <span>{t('risk.mobile.srSwitchModeNote')}</span>
                  </div>
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
                        onChange={e => setSrHost(e.target.value)}
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
                    <p className="risk-qr-caption">{t('risk.mobile.srQrPrivacyHint')}</p>
                  </div>
                </aside>
              </div>
            </div>
          ) : (
            <div className="risk-standalone-box">
              <p>{t('risk.mobile.standaloneDesc')}</p>
              <div className="risk-remediation-bar">
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

          {(copiedId || copyError) && (
            <p className={`risk-copy-feedback${copyError ? ' error' : ''}`} role={copyError ? 'alert' : 'status'}>
              {copyError ? t('network.copyFailed') : t('risk.feedback.copied')}
            </p>
          )}
        </section>

        {/* 第三部分：KYC 实拍前 6 步安全飞行清单 */}
        <div className="settings-group-heading">
          <span className="settings-group-bar" aria-hidden="true" />
          <h2>{t('risk.section.checklistTitle')}</h2>
        </div>

        <section className="settings-card risk-card">
          <div className="risk-checklist-head">
            <div className="risk-callout">
              <strong>{t('risk.checklist.antiEmulatorBadge')}</strong>
              <span>{t('risk.checklist.antiEmulatorNote')}</span>
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

          <ol className="risk-checklist-list">
            {CHECKLIST_STEP_IDS.map((stepId, index) => {
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
                      <strong>
                        {`${String(index + 1).padStart(2, '0')} · ${t(`risk.checklist.${stepId}Title`)}`}
                      </strong>
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
