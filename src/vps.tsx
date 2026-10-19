/**
 * [INPUT]: Claude 四个固定服务域名、用户触发的原生只读诊断与共享双语文案。
 * [OUTPUT]: 服务连通性四态、汇总成功/失败、真实连接对端和逐域失败原因。
 * [POS]: 独立本地网络诊断页；仅点击后发起探测，不打开外部资源或提供安装/购买引导。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {Button} from 'cromma-ui';
import {Refresh} from 'cromma-ui/pika';
import {useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';

export type DomainDiagnosis = {
    domain: string;
    ok: boolean;
    status_code: number | null;
    latency_ms: number | null;
    ip: string | null;
    message: string;
};

const claudeDomains=['claude.ai','api.anthropic.com','platform.claude.com','downloads.claude.ai'] as const;
export function VpsPanel() {
    const {t}=useI18n();
    const [diagnosing,setDiagnosing]=useState(false);
    const [diagnostics,setDiagnostics]=useState<DomainDiagnosis[]|null>(null);
    const [diagnosticsError,setDiagnosticsError]=useState('');
    const results=claudeDomains.map(domain=>diagnostics?.find(item=>item.domain===domain));
    const passed=results.filter(item=>item?.ok).length;
    const phase=diagnosing?'checking':diagnosticsError?'failed':diagnostics?(passed===claudeDomains.length?'passed':'failed'):'idle';
    const statusText=phase==='checking'?'检测中':phase==='passed'?'检测成功':phase==='failed'?'检测失败':'待检测';

    async function runDiagnostics() {
        if(diagnosing)return;
        setDiagnosing(true);
        setDiagnostics(null);
        setDiagnosticsError('');
        try {
            const results = await invoke<DomainDiagnosis[]>('network_diagnose_domains');
            if(!Array.isArray(results))throw new Error('检测结果无效，请重试。');
            setDiagnostics(results);
            if(claudeDomains.some(domain=>!results.some(item=>item.domain===domain)))setDiagnosticsError('部分检测未返回结果，请重试。');
        } catch (e) {
            setDiagnosticsError(String(e));
        } finally {
            setDiagnosing(false);
        }
    }

    return <section className="system-page network-page"><div className="cleanup-title"><h1>{t('网络环境')}</h1></div>
        <section className="domain-diagnostics" aria-labelledby="diagnostics-title" data-status={phase} aria-busy={diagnosing}>
            <div className="domain-diagnostics-header">
                <h2 id="diagnostics-title">{t('Claude 服务连通性')}</h2>
                <Button variant="secondary" size="small" disabled={diagnosing} leftIcon={<Refresh aria-hidden size={15} className={diagnosing?'spin':''}/>} onClick={()=>void runDiagnostics()}>{diagnosing?t('检测中'):phase==='idle'?t('开始检测'):t('重新检测')}</Button>
            </div>
            <p className="system-hint">{t('仅在点击后检测服务连通性；结果不代表账号可用或已验证公网出口。')}</p>
            <div className={`domain-outcome ${phase}`} role="status" aria-live="polite">
                <span className="domain-outcome-symbol" aria-hidden="true">{phase==='passed'?'✓':phase==='failed'?'×':phase==='checking'?'◌':'·'}</span>
                <strong>{t(statusText)}</strong>
                {diagnostics&&!diagnosticsError&&<span>{t('已通过 {v0} / {v1} 项',{v0:passed,v1:claudeDomains.length})}</span>}
                {diagnosticsError&&<p>{t(diagnosticsError)}</p>}
            </div>
            <ul className="domain-diagnostics-list">{claudeDomains.map((domain,index)=>{
                const item=results[index];
                const status=diagnosing?'checking':item?item.ok?'passed':'failed':phase==='failed'?'failed':'idle';
                return <li key={domain} className={`domain-diagnostics-item ${status}`}>
                    <div className="domain-item-info"><span className="domain-name">{domain}</span>{item&&<span className="domain-detail">{item.status_code?`HTTP ${item.status_code} · `:''}{t(item.message)}</span>}{item?.ip&&<span className="domain-ip" title={t('连接对端，不代表出口 IP')}>{item.ip}</span>}</div>
                    <div className="domain-item-status">{item?.latency_ms!=null&&<span className="domain-latency">{item.latency_ms} ms</span>}<span className={`domain-badge ${status}`}><span aria-hidden="true">{status==='passed'?'✓':status==='failed'?'×':status==='checking'?'◌':'·'}</span>{t(status==='checking'?'检测中':item?item.ok?'检测成功':'检测失败':phase==='failed'?'未完成':'待检测')}</span></div>
                </li>;
            })}</ul>
        </section>
    </section>;
}
