/**
 * [INPUT]: Claude 四个固定服务域名、用户触发的原生只读诊断、发行者固定的 iKuuu/Kookeey 推广链接、AI 配置提示词、多端口 Clash YAML 生成器（buildMultiPortClashYaml）、隐私遮罩偏好、Pika 图标、env-pages.css 与双语文案。
 * [OUTPUT]: 顶部内联复制状态胶囊、四栏链式拓扑发丝遥测条、三列紧凑代理配置卡（徽章 + 角色标签 + 步骤脚注与单复制按钮）、只读多端口 Clash 配置生成入口及 Portaled `AppDialog` 弹窗（2-5 端口、起始端口、代理组名、纯复制 YAML）、支持隐私遮罩的 2×2 边线四域名连通性矩阵及含 Persona/Yoti/Sift/Hexagon 分流规则的双语 AI 配置提示词。
 * [POS]: 固定链接随软件分享，不接受本机自定义覆盖或外部自动导航；仅在点击检测后发起连通性探测；多端口生成器仅只读复制 YAML，不写入任何磁盘配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {Button, Input} from 'cromma-ui';
import {Refresh, CheckTickCircle, Share01, Server, Settings01, Globe} from 'cromma-ui/pika';
import {useEffect, useMemo, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {AppDialog} from './dialog';
import {useI18n, type Locale} from './i18n';
import {buildMultiPortClashYaml, maskIpAddress} from './risk-model';
import {usePreferences} from './settings-model';
import './env-pages.css';

export type DomainDiagnosis = {
  domain: string;
  ok: boolean;
  status_code: number | null;
  latency_ms: number | null;
  ip: string | null;
  message: string;
};

// Publisher-approved public referral links are bundled with every build, not user preferences.
export const IKUUU_REFERRAL_URL = 'https://ikuuu.top/auth/register?code=j6Vd';
export const KOOKEEY_REFERRAL_URL = 'https://www.kookeey.com/?aff=14151075';

const claudeDomains = ['claude.ai', 'api.anthropic.com', 'platform.claude.com', 'downloads.claude.ai'] as const;

const domainRoleKeys: Record<(typeof claudeDomains)[number], string> = {
  'claude.ai': 'network.role_claude_ai',
  'api.anthropic.com': 'network.role_api',
  'platform.claude.com': 'network.role_platform',
  'downloads.claude.ai': 'network.role_downloads',
};

export function buildAiProxyPrompt(locale: Locale = 'zh'): string {
  return (locale === 'en' ? [
    'I have an iKuuu subscription and a Kookeey US static residential SOCKS5 proxy. Help configure Clash Verge Rev with a two-hop proxy chain and anti-leak hardening for Claude-Local, Claude Code and Claude websites.',
    'Route: iKuuu transit node (prefer a multi-node auto-failover group) → Kookeey static residential SOCKS5 exit (TCP-only, udp: false). Ask me for any missing proxy parameters first, and use dialer-proxy or a compatible method supported by the installed version.',
    'Inspect and back up the current configuration first. Write changes into the persistent Global Extend Config (Merge.yaml) or Extend Script so subscription refreshes never overwrite them, preserve other subscriptions and routing rules, and synchronize tun.strict-route (true) in both config.yaml and Merge.yaml.',
    'Route Claude AND KYC/anti-fraud domains (claude.ai, claude.com, anthropic.com, clau.de, claude.app, claude.dev, claude.site, ant.dev, anthropic.dev, claudeusercontent.com, claudemcpcontent.com, datadoghq.com, browser-intake-us5-datadoghq.com, browser-intake-datadoghq.com, datadoghq.eu, ddog-gov.com, DOMAIN-KEYWORD:datadoghq, growthbook.io, storage.googleapis.com, withpersona.com, persona.com, persona.org, personacustomer.com, persona-cdn.com, yoti.com, stripe.com, stripe.network, stripecdn.com, stripe.global, paypal.com, paypalobjects.com, paypal-mktg.com, braintreegateway.com, braintree-api.com, hcaptcha.com, challenges.cloudflare.com, arkoselabs.com, funcaptcha.com, workos.com, authkit.app, sift.com, siftscience.com, hexagon-cdn.com, hexagon-analytics.com, sentry.io, intercom.io, intercomcdn.com, intercomassets.com, statsig.com, statsigapi.net, featuregates.org, prodregistryv2.org, openai.com, chatgpt.com, oaistatic.com, oaiusercontent.com, auth0.com, ipquery.io, ipinfo.io, ip.sb, geojs.io, ipwho.is, ippure.com) plus remote DoH IPs (1.1.1.1/32, 1.0.0.1/32, 8.8.8.8/32, 8.8.4.4/32 with no-resolve) at highest priority through the exact same static residential exit, block 198.18.0.0/15 Fake-IP leaks, and keep localhost, 127.0.0.1, ::1 callbacks and private LAN CIDRs (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) direct.',
    'Harden DNS, IPv6, WebRTC & QUIC: disable IPv6 (ipv6: false and dns.ipv6: false to prevent dual-stack bypass on IPv4-only residential exits); enable sniffer (parse-pure-ip), dns.respect-rules, dns.direct-nameserver-follow-policy, proxy-server-nameserver, and IP-literal encrypted remote DoH (https://1.1.1.1/dns-query, https://8.8.8.8/dns-query) routed via the static residential exit while keeping geosite:cn,private on domestic DoH/system; enable tun.strict-route with private LAN route exclusions; and reject UDP 443 (QUIC) plus UDP 3478/19302/5349 and stun (WebRTC STUN/TURN).',
    'Add a dedicated local TCP-only 127.0.0.1:7899 listener (type: mixed, listen: 127.0.0.1, udp: false, allow-lan: false) bound to the static residential exit so Claude-Local Browser (socks5://127.0.0.1:7899) locks remote DNS and blocks non-proxied UDP.',
    'Reload the running core and refresh the subscription once to verify persistence, then verify that https://claude.ai/cdn-cgi/trace, https://withpersona.com/cdn-cgi/trace and https://1.1.1.1/cdn-cgi/trace return the exact same exit IP and country (with http=http/2). Report what remains unverified and provide troubleshooting and one-step rollback steps.',
    'If local tools are available, complete the setup and briefly report the result; otherwise provide only the necessary steps.',
  ] : [
    '我已准备 iKuuu 订阅和 Kookeey 美国静态住宅 SOCKS5。请用 Clash Verge Rev 为 Claude-Local、Claude Code 和 Claude 网页配置双跳链式代理与防关联防漏环境。',
    '目标链路：iKuuu 前置节点（优选多条低延迟节点组建自动测速/容灾组）→ Kookeey 静态住宅 SOCKS5 出口（纯 TCP，显式设置 udp: false）；缺少节点参数时先向我确认，并按已安装版本使用 dialer-proxy 或兼容方式建立链路。',
    '先检查并备份现有配置，将改动写入持久化全局扩展覆写（Merge.yaml）或扩展脚本（刷新订阅不丢失），保留其他订阅和分流规则，并在 config.yaml 与 Merge.yaml 中同步开启 tun.strict-route（防止主配置覆盖导致 TUN 严格路由失效）。',
    '将 Claude 及 KYC/风控关联域名（claude.ai、claude.com、anthropic.com、clau.de、claude.app、claude.dev、claude.site、ant.dev、anthropic.dev、claudeusercontent.com、claudemcpcontent.com、datadoghq.com、browser-intake-us5-datadoghq.com、browser-intake-datadoghq.com、datadoghq.eu、ddog-gov.com、DOMAIN-KEYWORD:datadoghq、growthbook.io、storage.googleapis.com、withpersona.com、persona.com、persona.org、personacustomer.com、persona-cdn.com、yoti.com、stripe.com、stripe.network、stripecdn.com、stripe.global、paypal.com、paypalobjects.com、paypal-mktg.com、braintreegateway.com、braintree-api.com、hcaptcha.com、challenges.cloudflare.com、arkoselabs.com、funcaptcha.com、workos.com、authkit.app、sift.com、siftscience.com、hexagon-cdn.com、hexagon-analytics.com、sentry.io、intercom.io、intercomcdn.com、intercomassets.com、statsig.com、statsigapi.net、featuregates.org、prodregistryv2.org、openai.com、chatgpt.com、oaistatic.com、oaiusercontent.com、auth0.com、ipquery.io、ipinfo.io、ip.sb、geojs.io、ipwho.is、ippure.com）及远程 DoH 地址（1.1.1.1/32、1.0.0.1/32、8.8.8.8/32、8.8.4.4/32，no-resolve）最高优先级统一指向同一静态住宅出口，拦截 198.18.0.0/15 防 Fake-IP 漏出，并确保 localhost、127.0.0.1、::1 本地回调与私有内网网段（127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16）保持直连。',
    '防 DNS/IPv6/WebRTC 泄露与 QUIC 加固：显式关闭 IPv6（ipv6: false 与 dns.ipv6: false，防纯 IPv4 静态家宽下双栈 IPv6 旁路抢答），开启 sniffer（parse-pure-ip）、dns.respect-rules、dns.direct-nameserver-follow-policy 与 proxy-server-nameserver，海外域名使用经该静态家宽出口的纯 IP 加密远程 DoH（https://1.1.1.1/dns-query、https://8.8.8.8/dns-query）且 geosite:cn,private 走国内 DoH/system；开启 tun.strict-route 并排除私有内网路由，阻断 UDP 443（QUIC）与 UDP 3478/19302/5349 及 stun（WebRTC STUN/TURN 穿透）。',
    '配置绑定该静态家宽的本地纯 TCP 独立监听端口 127.0.0.1:7899（type: mixed、listen: 127.0.0.1、udp: false，保持顶层 allow-lan 关闭），供 Claude-Local 浏览环境（socks5://127.0.0.1:7899）锁死远程 DNS 并物理切断 UDP。',
    '重载运行内核并刷新一次订阅确认配置持久生效，实测验证 https://claude.ai/cdn-cgi/trace、https://withpersona.com/cdn-cgi/trace 与 https://1.1.1.1/cdn-cgi/trace 的出口 IP 和国家完全一致（http=http/2）；说明未验证项，并提供排障与一键回滚方法。',
    '能在本机操作时完成配置并简要说明结果，否则给出最少必要步骤。',
  ]).join('\n');
}

export function VpsPanel() {
  const {t, locale} = useI18n();
  const {privacyMask} = usePreferences();
  const [copiedId, setCopiedId] = useState('');
  const [copyingId, setCopyingId] = useState('');
  const [copyError, setCopyError] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  // 原有 Claude 四域名连通性诊断状态
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DomainDiagnosis[] | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState('');
  const results = claudeDomains.map(domain => diagnostics?.find(item => item.domain === domain));
  const passed = results.filter(item => item?.ok).length;
  const phase = diagnosing ? 'checking' : diagnosticsError ? 'failed' : diagnostics ? (passed === claudeDomains.length ? 'passed' : 'failed') : 'idle';
  const statusText = phase === 'checking' ? '检测中' : phase === 'passed' ? '检测成功' : phase === 'failed' ? '检测失败' : '待检测';
  const hop4Detail = phase === 'idle'
    ? t('network.hop4IdleDetail')
    : diagnostics && !diagnosticsError
      ? t('已通过 {v0} / {v1} 项', {v0: passed, v1: claudeDomains.length})
      : diagnosticsError
        ? t(diagnosticsError)
        : t('检测中');

  const aiPrompt = buildAiProxyPrompt(locale);
  const [multiPortOpen, setMultiPortOpen] = useState(false);
  const [multiPortCount, setMultiPortCount] = useState(2);
  const [multiPortStartInput, setMultiPortStartInput] = useState('7899');
  const [multiPortGroups, setMultiPortGroups] = useState<string[]>([
    'Claude-Exit-1',
    'Claude-Exit-2',
    'Claude-Exit-3',
    'Claude-Exit-4',
    'Claude-Exit-5',
  ]);
  const multiPortSnippet = useMemo(
    () =>
      buildMultiPortClashYaml({
        count: multiPortCount,
        startPort: Number(multiPortStartInput),
        groupNames: multiPortGroups,
      }),
    [multiPortCount, multiPortStartInput, multiPortGroups],
  );

  async function copyText(id: string, value: string) {
    if (copyingId) return;
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
      copyTimer.current = window.setTimeout(() => setCopiedId(''), 1800);
    } catch {
      setCopyError(true);
    } finally {
      setCopyingId('');
    }
  }

  async function runDiagnostics() {
    if (diagnosing) return;
    setDiagnosing(true);
    setDiagnostics(null);
    setDiagnosticsError('');
    try {
      const results = await invoke<DomainDiagnosis[]>('network_diagnose_domains');
      if (!Array.isArray(results)) throw new Error('检测结果无效，请重试。');
      setDiagnostics(results);
      if (claudeDomains.some(domain => !results.some(item => item.domain === domain))) setDiagnosticsError('部分检测未返回结果，请重试。');
    } catch (e) {
      setDiagnosticsError(String(e));
    } finally {
      setDiagnosing(false);
    }
  }

  return (
    <section className="system-page network-page">
      <header className="cleanup-title network-header">
        <h1>{t('网络环境')}</h1>
        {(copiedId || copyError) && (
          <p className={`network-copy-status${copyError ? ' error' : ''}`} role={copyError ? 'alert' : 'status'}>
            {copyError ? t('network.copyFailed') : t(copiedId === 'ai-prompt' ? '已复制提示词' : '已复制')}
          </p>
        )}
      </header>

      <div className="network-sections">
        <section className="settings-card env-telemetry-strip network-overview-strip" aria-label={t('network.setupGroupTitle')}>
          <div className="env-telemetry-cell">
            <div className="env-telemetry-head">
              <span className="env-status-dot" aria-hidden="true" />
              <span className="env-telemetry-label">{t('network.hop1Label')}</span>
            </div>
            <strong title={t('network.hop1Value')}>{t('network.hop1Value')}</strong>
            <small title={t('network.hop1Detail')}>{t('network.hop1Detail')}</small>
          </div>
          <div className="env-telemetry-cell">
            <div className="env-telemetry-head">
              <span className="env-status-dot" aria-hidden="true" />
              <span className="env-telemetry-label">{t('network.hop2Label')}</span>
            </div>
            <strong title={t('network.hop2Value')}>{t('network.hop2Value')}</strong>
            <small title={t('network.hop2Detail')}>{t('network.hop2Detail')}</small>
          </div>
          <div className="env-telemetry-cell">
            <div className="env-telemetry-head">
              <span className="env-status-dot" aria-hidden="true" />
              <span className="env-telemetry-label">{t('network.hop3Label')}</span>
            </div>
            <strong title={t('network.hop3Value')}>{t('network.hop3Value')}</strong>
            <small title={t('network.hop3Detail')}>{t('network.hop3Detail')}</small>
          </div>
          <div className="env-telemetry-cell">
            <div className="env-telemetry-head">
              <span className={`env-status-dot ${phase === 'passed' ? 'is-ready' : phase === 'failed' ? 'is-failed' : phase === 'checking' ? 'is-pending' : ''}`} aria-hidden="true" />
              <span className="env-telemetry-label">{t('network.hop4Label')}</span>
            </div>
            <strong title={t(statusText)}>{t(statusText)}</strong>
            <small title={hop4Detail}>{hop4Detail}</small>
          </div>
        </section>

        <div className="settings-group-heading">
          <span className="settings-group-bar" aria-hidden="true" />
          <h2>{t('network.setupGroupTitle')}</h2>
        </div>

        <div className="network-action-list">
          {/* iKuuu 前置专线 */}
          <article className="settings-card network-action-card" aria-labelledby="ikuuu-setup-title">
            <div className="network-card-top">
              <span className="settings-icon-badge" aria-hidden="true"><Share01 size={16} /></span>
              <span className="settings-meta-pill network-card-role">{t('代理环境')}</span>
            </div>
            <div className="network-action-main">
              <h2 id="ikuuu-setup-title">{t('准备前置专线（iKuuu）')}</h2>
              <p className="network-action-desc">
                {t('network.ikuuuDescription')}
              </p>
            </div>
            <div className="network-action-buttons">
              <span className="network-step-tag">{t('network.step1Tag')}</span>
              <Button
                variant="secondary"
                size="small"
                disabled={copyingId !== ''}
                leftIcon={copiedId === 'ikuuu-url' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                onClick={() => void copyText('ikuuu-url', IKUUU_REFERRAL_URL)}
              >
                {t('network.copyLink')}
              </Button>
            </div>
          </article>

          {/* Kookeey 美国静态家宽 */}
          <article className="settings-card network-action-card" aria-labelledby="kookeey-setup-title">
            <div className="network-card-top">
              <span className="settings-icon-badge" aria-hidden="true"><Server size={16} /></span>
              <span className="settings-meta-pill network-card-role">{t('原生美区 ISP · SOCKS5')}</span>
            </div>
            <div className="network-action-main">
              <h2 id="kookeey-setup-title">{t('准备美国静态家宽（Kookeey）')}</h2>
              <p className="network-action-desc">
                {t('network.kookeeyDescription')}
              </p>
            </div>
            <div className="network-action-buttons">
              <span className="network-step-tag">{t('network.step2Tag')}</span>
              <Button
                variant="secondary"
                size="small"
                disabled={copyingId !== ''}
                leftIcon={copiedId === 'kookeey-url' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                onClick={() => void copyText('kookeey-url', KOOKEEY_REFERRAL_URL)}
              >
                {t('network.copyLink')}
              </Button>
            </div>
          </article>

          {/* 复制提示词交给 AI 自动配置 */}
          <article className="settings-card network-action-card" aria-labelledby="ai-setup-title">
            <div className="network-card-top">
              <span className="settings-icon-badge" aria-hidden="true"><Settings01 size={16} /></span>
              <span className="settings-meta-pill network-card-role">{t('Clash Verge 链式分流')}</span>
            </div>
            <div className="network-action-main">
              <h2 id="ai-setup-title">{t('复制提示词交给 AI 自动配置')}</h2>
              <p className="network-action-desc">
                {t('network.promptDescription')}
              </p>
            </div>
            <div className="network-action-buttons">
              <span className="network-step-tag">{t('network.step3Tag')}</span>
              <Button
                variant="secondary"
                size="small"
                disabled={copyingId !== ''}
                leftIcon={copiedId === 'ai-prompt' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
                onClick={() => void copyText('ai-prompt', aiPrompt)}
              >
                {t('network.copyPrompt')}
              </Button>
            </div>
          </article>
        </div>

        <section className="settings-card network-multiport-card" aria-labelledby="multiport-setup-title">
          <div className="network-multiport-copy">
            <span className="settings-icon-badge" aria-hidden="true"><Settings01 size={16} /></span>
            <div>
              <h2 id="multiport-setup-title">{t('network.multiPortTitle')}</h2>
              <p>{t('network.multiPortDesc')}</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="small"
            data-open-multiport-generator
            onClick={() => setMultiPortOpen(true)}
          >
            {t('network.multiPortOpen')}
          </Button>
        </section>

        <div className="settings-group-heading">
          <span className="settings-group-bar" aria-hidden="true" />
          <h2>{t('network.probeGroupTitle')}</h2>
        </div>

        {/* Claude 服务连通性检测 */}
        <section className="settings-card domain-diagnostics" aria-labelledby="diagnostics-title" data-status={phase} aria-busy={diagnosing}>
          <div className="domain-diagnostics-header">
            <div className="domain-diagnostics-title-row">
              <span className="settings-icon-badge" aria-hidden="true"><Globe size={16} /></span>
              <div className="domain-diagnostics-head">
                <h2 id="diagnostics-title">{t('Claude 服务连通性')}</h2>
                <p className="domain-diagnostics-subtitle">{t('仅在点击后检测服务连通性；结果不代表账号可用或已验证公网出口。')}</p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="small"
              disabled={diagnosing}
              leftIcon={<Refresh aria-hidden size={15} className={diagnosing ? 'spin' : ''} />}
              onClick={() => void runDiagnostics()}
            >
              {diagnosing ? t('检测中') : phase === 'idle' ? t('开始检测') : t('重新检测')}
            </Button>
          </div>
          {phase !== 'idle' && (
            <div className={`domain-outcome ${phase}`} role="status" aria-live="polite">
              <span className="domain-outcome-symbol" aria-hidden="true">
                {phase === 'passed' ? '✓' : phase === 'failed' ? '×' : '◌'}
              </span>
              <strong>{t(statusText)}</strong>
              {diagnostics && !diagnosticsError && <span>{t('已通过 {v0} / {v1} 项', {v0: passed, v1: claudeDomains.length})}</span>}
              {diagnosticsError && <p>{t(diagnosticsError)}</p>}
            </div>
          )}
          <ul className="domain-diagnostics-list">
            {claudeDomains.map((domain, index) => {
              const item = results[index];
              const status = diagnosing ? 'checking' : item ? (item.ok ? 'passed' : 'failed') : phase === 'failed' ? 'failed' : 'idle';
              return (
                <li key={domain} className={`domain-diagnostics-item ${status}`}>
                  <div className="domain-item-info">
                    <div className="domain-name-row">
                      <span className="domain-name">{domain}</span>
                      <span className="domain-role">{t(domainRoleKeys[domain])}</span>
                    </div>
                    {item && (
                      <span className="domain-detail">
                        {item.status_code ? `HTTP ${item.status_code} · ` : ''}
                        {t(item.message)}
                      </span>
                    )}
                    {item?.ip && (
                      <span className="domain-ip" title={t('连接对端，不代表出口 IP')}>
                        {maskIpAddress(item.ip, privacyMask)}
                      </span>
                    )}
                  </div>
                  <div className="domain-item-status">
                    {item?.latency_ms != null && <span className="domain-latency">{item.latency_ms} ms</span>}
                    <span className={`domain-badge ${status}`}>
                      <span aria-hidden="true">{status === 'passed' ? '✓' : status === 'failed' ? '×' : status === 'checking' ? '◌' : '·'}</span>
                      {t(status === 'checking' ? '检测中' : item ? (item.ok ? '检测成功' : '检测失败') : phase === 'failed' ? '未完成' : '待检测')}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <AppDialog
        open={multiPortOpen}
        onOpenChange={setMultiPortOpen}
        width={620}
        className="network-multiport-dialog"
        title={t('network.multiPortTitle')}
        description={t('network.multiPortDialogDesc')}
        footer={
          <>
            <Button variant="secondary" size="small" onClick={() => setMultiPortOpen(false)}>
              {t('关闭')}
            </Button>
            <Button
              variant="primary"
              size="small"
              data-copy-multiport-yaml
              disabled={copyingId !== ''}
              leftIcon={copiedId === 'multiport-yaml' ? <CheckTickCircle size={14} aria-hidden /> : undefined}
              onClick={() => void copyText('multiport-yaml', multiPortSnippet.yaml)}
            >
              {copiedId === 'multiport-yaml' ? t('已复制') : t('network.multiPortCopyYaml')}
            </Button>
          </>
        }
      >
        <div className="network-multiport-form">
          <div className="network-multiport-controls">
            <div className="network-multiport-field">
              <span>{t('network.multiPortCountLabel')}</span>
              <div className="network-multiport-count-row" role="group" aria-label={t('network.multiPortCountLabel')}>
                {[2, 3, 4, 5].map(countOption => (
                  <Button
                    key={countOption}
                    size="small"
                    variant={multiPortCount === countOption ? 'primary' : 'secondary'}
                    data-multiport-count={countOption}
                    onClick={() => setMultiPortCount(countOption)}
                  >
                    {countOption}
                  </Button>
                ))}
              </div>
            </div>
            <label className="network-multiport-field" htmlFor="multiport-start-port">
              <span>{t('network.multiPortStartLabel')}</span>
              <Input
                id="multiport-start-port"
                type="number"
                min={1024}
                max={65530}
                value={multiPortStartInput}
                onChange={e => setMultiPortStartInput(e.currentTarget.value)}
              />
            </label>
          </div>
          <div className="network-multiport-groups">
            {multiPortSnippet.ports.map((port, idx) => (
              <label key={port} className="network-multiport-group-row" htmlFor={`multiport-group-${idx}`}>
                <code>127.0.0.1:{port}</code>
                <Input
                  id={`multiport-group-${idx}`}
                  value={multiPortGroups[idx] ?? `Claude-Exit-${idx + 1}`}
                  placeholder={`Claude-Exit-${idx + 1}`}
                  onChange={e => {
                    const nextVal = e.currentTarget.value;
                    setMultiPortGroups(prev => {
                      const next = [...prev];
                      next[idx] = nextVal;
                      return next;
                    });
                  }}
                />
              </label>
            ))}
          </div>
          <p className="system-hint">{t('network.multiPortReadonlyNote')}</p>
          <pre className="network-multiport-yaml" data-multiport-yaml-preview>
            {multiPortSnippet.yaml}
          </pre>
        </div>
      </AppDialog>
    </section>
  );
}
