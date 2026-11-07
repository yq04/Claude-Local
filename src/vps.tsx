/**
 * [INPUT]: Claude 四个固定服务域名、用户触发的原生只读诊断、发行者固定的 iKuuu/Kookeey 推广链接与 AI 配置提示词及双语文案。
 * [OUTPUT]: 隐藏URL/邀请码的固定链接复制卡、按文字自适应的统一中性按钮、精简双语Agent提示词与真实复制反馈，以及服务连通性四态诊断。
 * [POS]: 固定链接随软件分享，不接受本机自定义覆盖或外部自动导航；仅在点击检测后发起连通性探测。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {Button} from 'cromma-ui';
import {Refresh, CheckTickCircle} from 'cromma-ui/pika';
import {useEffect, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {useI18n, type Locale} from './i18n';

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
    'Route Claude AND KYC/anti-fraud domains (claude.ai, claude.com, anthropic.com, clau.de, claude.app, claude.dev, claude.site, ant.dev, anthropic.dev, claudeusercontent.com, claudemcpcontent.com, datadoghq.com, browser-intake-us5-datadoghq.com, browser-intake-datadoghq.com, datadoghq.eu, ddog-gov.com, DOMAIN-KEYWORD:datadoghq, growthbook.io, storage.googleapis.com, withpersona.com, persona.com, persona.org, personacustomer.com, persona-cdn.com, stripe.com, stripe.network, stripecdn.com, stripe.global, paypal.com, paypalobjects.com, paypal-mktg.com, braintreegateway.com, braintree-api.com, hcaptcha.com, challenges.cloudflare.com, arkoselabs.com, funcaptcha.com, workos.com, authkit.app, sift.com, siftscience.com, sentry.io, intercom.io, intercomcdn.com, intercomassets.com, statsig.com, statsigapi.net, featuregates.org, prodregistryv2.org, openai.com, chatgpt.com, oaistatic.com, oaiusercontent.com, auth0.com, ipquery.io, ippure.com) plus remote DoH IPs (1.1.1.1/32, 1.0.0.1/32, 8.8.8.8/32, 8.8.4.4/32 with no-resolve) at highest priority through the exact same static residential exit, block 198.18.0.0/15 Fake-IP leaks, and keep localhost, 127.0.0.1, ::1 callbacks and private LAN CIDRs (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) direct.',
    'Harden DNS, IPv6, WebRTC & QUIC: disable IPv6 (ipv6: false and dns.ipv6: false to prevent dual-stack bypass on IPv4-only residential exits); enable sniffer (parse-pure-ip), dns.respect-rules, dns.direct-nameserver-follow-policy, proxy-server-nameserver, and IP-literal encrypted remote DoH (https://1.1.1.1/dns-query, https://8.8.8.8/dns-query) routed via the static residential exit while keeping geosite:cn,private on domestic DoH/system; enable tun.strict-route with private LAN route exclusions; and reject UDP 443 (QUIC) plus UDP 3478/19302/5349 and stun (WebRTC STUN/TURN).',
    'Add a dedicated local TCP-only 127.0.0.1:7899 listener (type: mixed, listen: 127.0.0.1, udp: false, allow-lan: false) bound to the static residential exit so Claude-Local Browser (socks5://127.0.0.1:7899) locks remote DNS and blocks non-proxied UDP.',
    'Reload the running core and refresh the subscription once to verify persistence, then verify that https://claude.ai/cdn-cgi/trace, https://withpersona.com/cdn-cgi/trace and https://1.1.1.1/cdn-cgi/trace return the exact same exit IP and country (with http=http/2). Report what remains unverified and provide troubleshooting and one-step rollback steps.',
    'If local tools are available, complete the setup and briefly report the result; otherwise provide only the necessary steps.',
  ] : [
    '我已准备 iKuuu 订阅和 Kookeey 美国静态住宅 SOCKS5。请用 Clash Verge Rev 为 Claude-Local、Claude Code 和 Claude 网页配置双跳链式代理与防关联防漏环境。',
    '目标链路：iKuuu 前置节点（优选多条低延迟节点组建自动测速/容灾组）→ Kookeey 静态住宅 SOCKS5 出口（纯 TCP，显式设置 udp: false）；缺少节点参数时先向我确认，并按已安装版本使用 dialer-proxy 或兼容方式建立链路。',
    '先检查并备份现有配置，将改动写入持久化全局扩展覆写（Merge.yaml）或扩展脚本（刷新订阅不丢失），保留其他订阅和分流规则，并在 config.yaml 与 Merge.yaml 中同步开启 tun.strict-route（防止主配置覆盖导致 TUN 严格路由失效）。',
    '将 Claude 及 KYC/风控关联域名（claude.ai、claude.com、anthropic.com、clau.de、claude.app、claude.dev、claude.site、ant.dev、anthropic.dev、claudeusercontent.com、claudemcpcontent.com、datadoghq.com、browser-intake-us5-datadoghq.com、browser-intake-datadoghq.com、datadoghq.eu、ddog-gov.com、DOMAIN-KEYWORD:datadoghq、growthbook.io、storage.googleapis.com、withpersona.com、persona.com、persona.org、personacustomer.com、persona-cdn.com、stripe.com、stripe.network、stripecdn.com、stripe.global、paypal.com、paypalobjects.com、paypal-mktg.com、braintreegateway.com、braintree-api.com、hcaptcha.com、challenges.cloudflare.com、arkoselabs.com、funcaptcha.com、workos.com、authkit.app、sift.com、siftscience.com、sentry.io、intercom.io、intercomcdn.com、intercomassets.com、statsig.com、statsigapi.net、featuregates.org、prodregistryv2.org、openai.com、chatgpt.com、oaistatic.com、oaiusercontent.com、auth0.com、ipquery.io、ippure.com）及远程 DoH 地址（1.1.1.1/32、1.0.0.1/32、8.8.8.8/32、8.8.4.4/32，no-resolve）最高优先级统一指向同一静态住宅出口，拦截 198.18.0.0/15 防 Fake-IP 漏出，并确保 localhost、127.0.0.1、::1 本地回调与私有内网网段（127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16）保持直连。',
    '防 DNS/IPv6/WebRTC 泄露与 QUIC 加固：显式关闭 IPv6（ipv6: false 与 dns.ipv6: false，防纯 IPv4 静态家宽下双栈 IPv6 旁路抢答），开启 sniffer（parse-pure-ip）、dns.respect-rules、dns.direct-nameserver-follow-policy 与 proxy-server-nameserver，海外域名使用经该静态家宽出口的纯 IP 加密远程 DoH（https://1.1.1.1/dns-query、https://8.8.8.8/dns-query）且 geosite:cn,private 走国内 DoH/system；开启 tun.strict-route 并排除私有内网路由，阻断 UDP 443（QUIC）与 UDP 3478/19302/5349 及 stun（WebRTC STUN/TURN 穿透）。',
    '配置绑定该静态家宽的本地纯 TCP 独立监听端口 127.0.0.1:7899（type: mixed、listen: 127.0.0.1、udp: false，保持顶层 allow-lan 关闭），供 Claude-Local 浏览环境（socks5://127.0.0.1:7899）锁死远程 DNS 并物理切断 UDP。',
    '重载运行内核并刷新一次订阅确认配置持久生效，实测验证 https://claude.ai/cdn-cgi/trace、https://withpersona.com/cdn-cgi/trace 与 https://1.1.1.1/cdn-cgi/trace 的出口 IP 和国家完全一致（http=http/2）；说明未验证项，并提供排障与一键回滚方法。',
    '能在本机操作时完成配置并简要说明结果，否则给出最少必要步骤。',
  ]).join('\n');
}

export function VpsPanel() {
  const {t, locale} = useI18n();
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

  const aiPrompt = buildAiProxyPrompt(locale);

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
      <header className="cleanup-title">
        <h1>{t('网络环境')}</h1>
      </header>

      <div className="network-sections">
        <div className="network-action-list">
          {/* iKuuu 前置专线 */}
          <article className="network-action-card" aria-labelledby="ikuuu-setup-title">
            <div className="network-action-row">
              <div className="network-action-main">
                <div className="network-action-head">
                  <span className="local-badge" aria-hidden="true">01</span>
                  <h2 id="ikuuu-setup-title">{t('准备前置专线（iKuuu）')}</h2>
                </div>
                <p className="network-action-desc">
                  {t('network.ikuuuDescription')}
                </p>
              </div>
              <div className="network-action-buttons">
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
            </div>
          </article>

          {/* Kookeey 美国静态家宽 */}
          <article className="network-action-card" aria-labelledby="kookeey-setup-title">
            <div className="network-action-row">
              <div className="network-action-main">
                <div className="network-action-head">
                  <span className="local-badge" aria-hidden="true">02</span>
                  <h2 id="kookeey-setup-title">{t('准备美国静态家宽（Kookeey）')}</h2>
                </div>
                <p className="network-action-desc">
                  {t('network.kookeeyDescription')}
                </p>
              </div>
              <div className="network-action-buttons">
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
            </div>
          </article>

          {/* 复制提示词交给 AI 自动配置 */}
          <article className="network-action-card" aria-labelledby="ai-setup-title">
            <div className="network-action-row">
              <div className="network-action-main">
                <div className="network-action-head">
                  <span className="local-badge" aria-hidden="true">03</span>
                  <h2 id="ai-setup-title">{t('复制提示词交给 AI 自动配置')}</h2>
                </div>
                <p className="network-action-desc">
                  {t('network.promptDescription')}
                </p>
              </div>
              <div className="network-action-buttons">
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
            </div>
          </article>
        </div>
        {(copiedId || copyError) && <p className={`network-copy-status${copyError ? ' error' : ''}`} role={copyError ? 'alert' : 'status'}>{copyError ? t('network.copyFailed') : t(copiedId === 'ai-prompt' ? '已复制提示词' : '已复制')}</p>}

        {/* Claude 服务连通性检测 */}
        <section className="domain-diagnostics" aria-labelledby="diagnostics-title" data-status={phase} aria-busy={diagnosing}>
          <div className="domain-diagnostics-header">
            <div className="network-action-head">
              <h2 id="diagnostics-title">{t('Claude 服务连通性')}</h2>
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
          <div className={`domain-outcome ${phase}`} role="status" aria-live="polite">
            <span className="domain-outcome-symbol" aria-hidden="true">
              {phase === 'passed' ? '✓' : phase === 'failed' ? '×' : phase === 'checking' ? '◌' : '·'}
            </span>
            <strong>{t(statusText)}</strong>
            {diagnostics && !diagnosticsError && <span>{t('已通过 {v0} / {v1} 项', {v0: passed, v1: claudeDomains.length})}</span>}
            {phase === 'idle' && <span>{t('network.idleOutcomeHint')}</span>}
            {diagnosticsError && <p>{t(diagnosticsError)}</p>}
          </div>
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
                        {item.ip}
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
    </section>
  );
}
