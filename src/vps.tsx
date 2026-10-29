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
export const IKUUU_REFERRAL_URL = 'https://ikuuu.top/auth/register?code=uXqM';
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
    'I have an iKuuu subscription and a Kookeey US static residential SOCKS5 proxy. Help configure Clash Verge Rev for Claude-Local, Claude Code and Claude websites.',
    'Route: iKuuu transit node → Kookeey residential exit. Ask me for any missing proxy parameters.',
    'Inspect and back up the current configuration first. Preserve other subscriptions and routing rules, and use dialer-proxy or a compatible method supported by the installed version.',
    'Route Claude AND KYC/anti-fraud domains (claude.ai, anthropic.com, clau.de, withpersona.com, persona-cdn.com, stripe.com, hcaptcha.com, challenges.cloudflare.com, arkoselabs.com, sift.com, sentry.io, ipquery.io) through the exact same static residential exit while keeping localhost, 127.0.0.1 and ::1 callbacks direct.',
    'Harden DNS & QUIC: enable dns.respect-rules, proxy-server-nameserver, encrypted remote DoH for non-CN/Claude/Persona domains, and tun.strict-route; reject UDP 443 QUIC for TCP-only SOCKS5 exits, and add a local 127.0.0.1:7899 listener bound to the residential exit for Claude-Local Browser (socks5://127.0.0.1:7899).',
    'Verify that https://claude.ai/cdn-cgi/trace and https://withpersona.com/cdn-cgi/trace return the exact same exit IP and country. Report what remains unverified and provide troubleshooting and rollback steps.',
    'If local tools are available, complete the setup and briefly report the result; otherwise provide only the necessary steps.',
  ] : [
    '我已准备 iKuuu 订阅和 Kookeey 美国静态住宅 SOCKS5。请用 Clash Verge Rev 为 Claude-Local、Claude Code 和 Claude 网页配置双跳代理。',
    '目标链路：iKuuu 前置节点 → Kookeey 住宅出口；缺少节点参数时先向我确认。',
    '先检查并备份现有配置，保留其他订阅和分流规则，按已安装版本使用 dialer-proxy 或兼容方式建立链路。',
    '将 Claude 及 KYC/风控关联域名（claude.ai、anthropic.com、clau.de、withpersona.com、persona-cdn.com、stripe.com、hcaptcha.com、challenges.cloudflare.com、arkoselabs.com、sift.com、sentry.io、ipquery.io）统一指向同一静态住宅出口，并确保 localhost、127.0.0.1、::1 本地回调保持直连。',
    '防 DNS 泄露与 QUIC 加固：开启 dns.respect-rules、proxy-server-nameserver、海外加密远程 DoH 与 tun.strict-route，针对纯 TCP 家宽阻断 UDP 443（QUIC），并配置绑定该静态家宽的本地独立监听端口 127.0.0.1:7899 供 Claude-Local 浏览环境（socks5://127.0.0.1:7899）锁定远程 DNS。',
    '实测验证 https://claude.ai/cdn-cgi/trace 与 https://withpersona.com/cdn-cgi/trace 的出口 IP 和国家完全一致；说明未验证项，并提供排障与回滚方法。',
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
