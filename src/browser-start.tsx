/**
 * [INPUT]: 随机令牌回环服务上下文、浏览器原生 navigator/Intl/Permissions/WebRTC/WebGL 与实际 HTTPS 出口与服务备援目录与宿主界面语言。
 * [OUTPUT]: 单项未知黄色待测与已知冲突红叉；顶部身份工牌、紧凑实测起始页、ISP/ASN 纯净度与第三方防封深度联机体检中心（Ping0.cc / CheckCC / BrowserScan / IPHey），同步宿主双语及通讯/回报时间。
 * [POS]: 独立 Chromium 入口，复用工具箱控件；成功状态只由真实观测决定，不接入 Tauri 权限，不伪造地理位置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Button, MotionRoot, TooltipProvider } from 'cromma-ui';
import { useEffect, useState } from 'react';
import {setLocale,useI18n} from "./i18n";
import { createRoot } from 'react-dom/client';
import { classifyExitIsp, DEEP_VERIFY_SITES, type BrowserContext, type Report, type Exit } from './browser-model';
import { probeBrowserExit } from './browser-network';
import {verifyBrowser} from './browser-verification';
import browserLogo from '../assets/browser-logo.jpg';
import './index.css';
import './style.css';

async function api<T>(route: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(route, location.href), {
        signal: AbortSignal.timeout(3000),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("本地核验连接失败，请从Claude-Local重新打开浏览器。");
    return response.json();
}

async function probeWebRtcLeak(): Promise<{ ok: boolean; detail: string }> {
    if (typeof RTCPeerConnection === 'undefined') {
        return { ok: true, detail: 'WebRTC 已禁用（无泄漏）' };
    }
    return new Promise(resolve => {
        let settled = false;
        const leakedIps = new Set<string>();
        let pc: RTCPeerConnection | null = null;
        const finish = () => {
            if (settled) return;
            settled = true;
            try { pc?.close(); } catch { /* ignore */ }
            if (leakedIps.size > 0) {
                resolve({ ok: false, detail: `检出候选 IP：${[...leakedIps].slice(0, 2).join(', ')}` });
            } else {
                resolve({ ok: true, detail: '未检出公网/局域网 IP 泄漏' });
            }
        };
        const timer = setTimeout(finish, 300);
        try {
            pc = new RTCPeerConnection({ iceServers: [] });
            pc.createDataChannel('probe');
            pc.onicecandidate = event => {
                const cand = event.candidate?.candidate || '';
                if (!cand) {
                    clearTimeout(timer);
                    finish();
                    return;
                }
                const parts = cand.split(/\s+/);
                const addr = parts[4] || '';
                if (addr && !addr.endsWith('.local') && addr !== '127.0.0.1' && addr !== '::1' && addr !== '0.0.0.0') {
                    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(addr) || addr.includes(':')) {
                        leakedIps.add(addr);
                    }
                }
            };
            void pc.createOffer()
                .then(offer => pc?.setLocalDescription(offer))
                .catch(() => {
                    clearTimeout(timer);
                    finish();
                });
        } catch {
            clearTimeout(timer);
            finish();
        }
    });
}

function probeGraphics(): { ok: boolean; renderer: string } {
    try {
        const canvas2d = document.createElement('canvas');
        const ctx2d = canvas2d.getContext('2d');
        if (!ctx2d) return { ok: false, renderer: 'Canvas 2D 不可用' };
        const canvasGl = document.createElement('canvas');
        const gl = (canvasGl.getContext('webgl2') || canvasGl.getContext('webgl') || canvasGl.getContext('experimental-webgl')) as WebGLRenderingContext | null;
        if (!gl) return { ok: false, renderer: 'WebGL 不可用' };
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const rawRenderer = dbg
            ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
            : String(gl.getParameter(gl.RENDERER) || '');
        const renderer = rawRenderer.trim() || 'WebGL Hardware';
        const isSoftware = /swiftshader|llvmpipe|software\s*rasterizer|basic\s*render\s*driver/i.test(renderer);
        return { ok: !isSoftware, renderer: renderer.slice(0, 140) };
    } catch {
        return { ok: false, renderer: '图形接口异常' };
    }
}

function Start() {
    const {t,locale}=useI18n();
    const [context, setContext] = useState<BrowserContext | null>(null), [report, setReport] = useState<Report | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [linked, setLinked] = useState(false), [reportedAt, setReportedAt] = useState(0);
    const [copiedSite, setCopiedSite] = useState('');

    async function copySite(id: string, url: string) {
        try {
            await navigator.clipboard.writeText(url);
            setCopiedSite(id);
            setTimeout(() => setCopiedSite(prev => (prev === id ? '' : prev)), 1800);
        } catch { /* ignore */ }
    }

    async function measure() {
        setBusy(true);
        setError('');
        setReport(null);
        setReportedAt(0);
        try {
            const context = await api<BrowserContext>('context');
            setContext(context);setLocale(context.ui_language);
            setLinked(true);
            const ua = (navigator as Navigator & {
                userAgentData?: {
                    getHighEntropyValues: (keys: string[]) => Promise<{
                        platformVersion?: string;
                        uaFullVersion?: string;
                    }>;
                };
            }).userAgentData;
            const [high, permission, webrtc] = await Promise.all([
                ua?.getHighEntropyValues(['platformVersion', 'uaFullVersion']).catch(() => null),
                navigator.permissions.query({ name: 'geolocation' }).then(x => x.state).catch(() => 'unknown'),
                probeWebRtcLeak(),
            ]);
            const graphics = probeGraphics();
            let exit: Exit | null = null, networkError = '';
            try {
                exit = await probeBrowserExit(context.exit_services);
            }
            catch (e) {
                networkError = e instanceof Error ? e.message : String(e);
            }
            const observed: Report = {
                language: navigator.language,
                languages: [...navigator.languages],
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                platform: navigator.platform,
                cores: navigator.hardwareConcurrency,
                user_agent: navigator.userAgent,
                platform_version: high?.platformVersion || '',
                browser_version: high?.uaFullVersion || navigator.userAgent.match(/(?:Chrome|Chromium)\/([\d.]+)/)?.[1] || '',
                geolocation: permission,
                exit,
                error: networkError,
                webrtc_ok: webrtc.ok,
                webrtc_detail: webrtc.detail,
                webdriver: Boolean(navigator.webdriver),
                graphics_ok: graphics.ok,
                webgl_renderer: graphics.renderer,
            };
            await api('report', observed);
            setReport(observed);
            setReportedAt(Date.now());
            setLinked(true);
        }
        catch (e) {
            setLinked(false);
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    }
    useEffect(() => { void measure(); let live = true; const timer = setInterval(() => { void api<BrowserContext>('context').then(next => { if (live) {
        setContext(next);setLocale(next.ui_language);
        setLinked(true);
    } }).catch(() => { if (live)
        setLinked(false); }); }, 10000); return () => { live = false; clearInterval(timer); }; }, []);
    const isStale = !!reportedAt && (Date.now() - reportedAt > 10 * 60 * 1000);
    const result=verifyBrowser(context,report,linked,error,busy,reportedAt);
    const {phase,checks,problems}=result;
    const title=phase==='checking'?'检测中':phase==='passed'?'检测通过':'检测未通过';
    const identity=context?.identity;
    const identityName=identity?.name||t(identity?.status==='empty'?'空身份':identity?.status==='unlinked'?'通用浏览器资料':'当前身份');
    const identityStatus=!context&&busy?'正在读取身份':!linked?'主应用未连接':!identity?'身份待核对':identity.status==='unlinked'?'未联动':identity.status==='mismatch'?'身份待同步':identity.status==='unknown'?'身份待核对':'身份已联动';
    const identityReady=linked&&!!identity?.linked&&['linked','draft','empty'].includes(identity.status);
    const ispKind = classifyExitIsp(report?.exit);

    return <div className={`browser-verification-page is-${phase}`} data-verification={phase}>
     <main className="browser-start">
      <header className="verification-brand"><div><img src={browserLogo} width={28} height={28} alt=""/><strong>Claude-Local Browser</strong></div><span>Chromium {context?.engine_version||'—'}</span></header>
      <section className={`verification-identity${identityReady?' linked':''}`} aria-label={t('浏览器身份')} data-identity={identity?.status||'unknown'}>
       <div className="verification-identity-avatar" aria-hidden="true">{identity?.status==='empty'?'∅':Array.from(identityName)[0]?.toUpperCase()||'?'}</div>
       <div className="verification-identity-account"><span>Claude · {t('本地身份')}</span><h2>{identityName}</h2><div>{identity?.email&&identity.email!==identityName&&<span>{identity.email}</span>}{identity?.organization&&<span>{identity.organization}</span>}</div></div>
       <span className={`verification-identity-state${identity?.status==='mismatch'||identity?.status==='unknown'?' attention':''}`} role="status">{t(identityStatus)}</span>
      </section>
      <section className="verification-banner" aria-labelledby="verification-title" aria-busy={busy}>
       <div className="verification-signal" aria-hidden="true"><i/><i/><svg viewBox="0 0 96 96"><circle cx="48" cy="48" r="44" fill="currentColor"/>{phase==='passed'?<path d="m27 49 14 14 28-31"/>:phase==='failed'?<path d="m34 34 28 28m0-28L34 62"/>:<><path d="M48 27v23"/><circle cx="48" cy="65" r="3" fill="white" stroke="none"/></>}</svg></div>
       <div className="verification-title" aria-live="polite"><span>{t('浏览器环境')}</span><h1 id="verification-title">{t(title)}</h1>{!busy&&<span>{t('已通过 {v0} / {v1} 项',{v0:checks.filter(check=>check.ok).length,v1:checks.length})}</span>}</div>
       <Button variant="secondary" loading={busy} disabled={busy} onClick={()=>void measure()}>{t('重新实测')}</Button>
      </section>
      <div className="landing-section-band" aria-hidden="true"/>
      {phase==='failed'&&problems.length>0&&<section className="verification-reasons" aria-labelledby="verification-reasons-title"><h2 id="verification-reasons-title">{t('未通过原因')}</h2><ul>{problems.map(problem=><li key={problem}>{t(problem)}</li>)}</ul></section>}
      {checks.length>0&&<section className="verification-results" aria-label={t('逐项检测结果')}>{checks.map(check=><article className={`verification-check ${check.ok==null?'pending':check.ok?'ok':'failed'}`} key={check.label}><header><h2>{t(check.label)}</h2><span aria-label={t(check.ok==null?'尚未核验':check.ok?'检测通过':'检测未通过')}>{check.ok==null?'—':check.ok?'✓':'×'}</span></header><strong>{t(check.actual)}</strong>{!check.ok&&<p>{t('目标：{v0}',{v0:t(check.expected)})}</p>}</article>)}</section>}
      {phase==='checking'&&<div className="verification-loading" role="status">{t('正在读取浏览器与网络…')}</div>}
      {report?.exit&&(
       <section className="verification-network">
        <div><span>{t('出口 IP')}</span><strong>{report.exit.ip}</strong></div>
        <div><span>{t('国家 / 城市')}</span><strong>{report.exit.country} / {report.exit.city||'—'}</strong></div>
        <div><span>{t('browserVerify.ispAndAsn')}</span><strong>{[report.exit.asn, report.exit.isp].filter(Boolean).join(' · ') || '—'}</strong></div>
        <div><span>{t('browserVerify.ipAttribute')}</span><strong>{ispKind === 'hosting' ? t('browserVerify.ispHosting') : t('browserVerify.ispResidential')}</strong></div>
       </section>
      )}
      <section className="verification-deep-hub" aria-label={t('browserVerify.hubTitle')}>
       <header className="verification-deep-head">
        <h2>{t('browserVerify.hubTitle')}</h2>
        <span>{t('browserVerify.hubSubtitle')}</span>
       </header>
       <div className="verification-deep-grid">
        {DEEP_VERIFY_SITES.map(site => (
         <article className="verification-deep-card" key={site.id}>
          <div className="verification-deep-title">
           <strong>{site.name}</strong>
           <code>{site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</code>
          </div>
          <p>{t(site.focusKey)}</p>
          <small>{t(site.passRuleKey)}</small>
          <div className="verification-deep-actions">
           <Button size="small" variant="secondary" onClick={() => window.open(site.url, '_blank', 'noopener,noreferrer')}>{t('browserVerify.openSite')}</Button>
           <Button size="small" variant="ghost" onClick={() => void copySite(site.id, site.url)}>{copiedSite === site.id ? t('browserVerify.copiedUrl') : t('browserVerify.copyUrl')}</Button>
          </div>
         </article>
        ))}
       </div>
      </section>
      <footer className="verification-footer"><span className={linked?'connected':'disconnected'}>{t(linked?'已连接 Claude-Local':'主应用未连接')}</span><time>{reportedAt ? (isStale ? (t('browserSafety.staleResult', { v0: new Date(reportedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US') }) || `结果已过时（>10分钟）· 测于 ${new Date(reportedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US')}`) : t('结果回传成功 {v0}', { v0: new Date(reportedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US') })) : t('等待检测回传')}</time></footer>
     </main>
    </div>;

}
createRoot(document.getElementById('app')!).render(<MotionRoot><TooltipProvider><Start /></TooltipProvider></MotionRoot>);
