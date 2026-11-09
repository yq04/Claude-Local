/**
 * [INPUT]: Tauri 单次调用的有序进度流和清理、CLI 安装、系统和浏览器页面的操作结果与共享 YAML 文案。
 * [OUTPUT]: 本次活动状态、三段式净室切换胶囊摘要、真实阶段/数量与身份卡片下的事件驱动动画、默认收起的日志与完整关闭能力；未知总量无百分比，原始消息在呈现时翻译。
 * [POS]: 本地操作的观察层；调用通道隔离不同操作，不制造进度或改变清理范围。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Button, Panel, cn } from 'cromma-ui';
import { Refresh as ArrowClockwiseIcon } from 'cromma-ui/pika';
import { useEffect, useRef, useState } from 'react';
import {useI18n} from "./i18n";
import { Channel } from '@tauri-apps/api/core';
export type Progress = {
    stage: string;
    status: 'running' | 'ok' | 'warning' | 'error';
    message: string;
    current: number;
    total: number | null;
    elapsed_ms: number;
};
type Kind = 'scan' | 'clean' | 'stop' | 'system' | 'browser' | 'cli' | 'identity';
export type AuditHistoryItem = {
    id: number;
    kind: Kind;
    title: string;
    status: 'ok' | 'warning' | 'error';
    message: string;
    elapsed_ms: number;
    finishedAtMs: number;
};
export type Activity = {
    kind: Kind;
    title?: string;
    started: number;
    entries: Progress[];
    running: boolean;
    failed: boolean;
    warning?: boolean;
    history?: AuditHistoryItem[];
};
const labels: Record<string, string> = { delete:'直接删除',archive:'身份暂存',switch:'身份切换',identity:'身份管理',validate: '检查', clean: '逐项清理', verify: '复查', scan: '深度扫描', stop: '进程检查', system: '应用设置', browser: '浏览器操作', cli: 'CLI 安装', done: '结果' };
const phaseLabels:Record<string,string>={...labels,identity:'准备身份操作',stop:'结束 Claude 进程',archive:'压缩暂存',compress:'写入加密归档',verify_archive:'验证身份归档',clear:'清空当前工作区',credentials:'处理登录凭据',restore:'恢复目标身份',commit:'保存身份状态',rollback:'恢复原有状态'};

export type CleanroomMacroStage = {
    id: 'lock_guard' | 'cleanroom_vault' | 'exit_align';
    labelKey: string;
    status: 'pending' | 'running' | 'ok' | 'error';
};

export function summarizeCleanroomPipelineStages(entries: Progress[], running: boolean, failed: boolean): CleanroomMacroStage[] {
    const groupOf = (stage: string): CleanroomMacroStage['id'] => {
        if (stage === 'identity' || stage === 'validate' || stage === 'stop') return 'lock_guard';
        if (stage === 'commit' || stage === 'browser' || stage === 'done') return 'exit_align';
        return 'cleanroom_vault';
    };
    const seen: Record<CleanroomMacroStage['id'], Progress['status'] | null> = {
        lock_guard: null,
        cleanroom_vault: null,
        exit_align: null,
    };
    let activeGroup: CleanroomMacroStage['id'] = 'lock_guard';
    for (const e of entries) {
        const g = groupOf(e.stage);
        activeGroup = g;
        if (e.status === 'error') seen[g] = 'error';
        else if (seen[g] !== 'error') seen[g] = e.status;
    }
    const order: {id: CleanroomMacroStage['id']; labelKey: string}[] = [
        {id: 'lock_guard', labelKey: '① 进程与三锁校验'},
        {id: 'cleanroom_vault', labelKey: '② 账号缓存与遥测净室隔离'},
        {id: 'exit_align', labelKey: '③ 浏览器与出口对齐'},
    ];
    const activeIdx = order.findIndex(o => o.id === activeGroup);
    return order.map((item, idx) => {
        if (!running && !failed) return {...item, status: 'ok'};
        if (seen[item.id] === 'error' || (failed && idx === activeIdx)) return {...item, status: 'error'};
        if (running && idx === activeIdx) return {...item, status: 'running'};
        if (idx < activeIdx || seen[item.id] === 'ok') return {...item, status: 'ok'};
        return {...item, status: 'pending'};
    });
}

let auditHistorySeq = 0;
let sharedAuditHistory: AuditHistoryItem[] = [];

export function getAuditHistoryItems(): AuditHistoryItem[] {
    return sharedAuditHistory;
}

export function recordAuditHistoryItem(
    item: Omit<AuditHistoryItem, 'id' | 'finishedAtMs'>,
): AuditHistoryItem[] {
    const record: AuditHistoryItem = {
        ...item,
        id: ++auditHistorySeq,
        finishedAtMs: Date.now(),
    };
    sharedAuditHistory = [record, ...sharedAuditHistory].slice(0, 20);
    return sharedAuditHistory;
}

export function useCleanupActivity() {
    const [state, setState] = useState<Activity | null>(null);
    const sequence = useRef(0);
    const began = useRef(0);
    const historyRef = useRef<AuditHistoryItem[]>(sharedAuditHistory);
    function append(event: Progress, token = sequence.current) {
        if (token !== sequence.current)
            return;
        setState(old => {
            if (!old)
                return old;
            const entries = [...old.entries];
            const done = entries.at(-1)?.stage === 'done' ? entries.pop() : undefined;
            entries.push(event);
            if (done)
                entries.push(done);
            return { ...old, entries: entries.slice(-2000), warning: !old.running&&!old.failed&&entries.some(entry=>entry.status==='warning'||entry.status==='error') };
        });
    }
    function log(stage: string, status: Progress['status'], message: string, current = 0, total: number | null = null) {
        append({ stage, status, message, current, total, elapsed_ms: Math.round(performance.now() - began.current) });
    }
    function channel(remap?: string) {
        const token = sequence.current;
        return new Channel<Progress>(event => append({ ...event, stage: remap || event.stage, elapsed_ms: Math.round(performance.now() - began.current) }, token));
    }
    function start(kind: Kind, title?:string) {
        sequence.current++;
        began.current = performance.now();
        historyRef.current = sharedAuditHistory;
        setState({ kind, title, started: began.current, entries: [], running: true, failed: false, history: historyRef.current });
        log(kind === 'clean' ? 'validate' : kind, 'running', kind === 'clean' ? "已提交所选清单，等待快照核验。" : kind === 'scan' ? "开始扫描本地数据。" : kind === 'system' ? "开始应用电脑设置。" : kind === 'browser' ? "开始浏览器操作。" : kind === 'identity' ? "开始本地身份操作。" : kind === 'cli' ? "开始 Claude Code CLI 安装管理。" : "检查并结束已确认的 Claude 进程。");
        return channel();
    }
    function finish(success: boolean, message: string) {
        const elapsed_ms = Math.round(performance.now() - began.current);
        log('done', success ? 'ok' : 'error', message);
        setState(old => {
            if (!old) return old;
            const hasWarning = success && old.entries.some(entry => entry.status === 'warning' || entry.status === 'error');
            historyRef.current = recordAuditHistoryItem({
                kind: old.kind,
                title: old.title || (old.kind === 'identity' ? '身份操作记录' : '操作记录'),
                status: !success ? 'error' : hasWarning ? 'warning' : 'ok',
                message,
                elapsed_ms,
            });
            return { ...old, running: false, failed: !success, warning: hasWarning, history: historyRef.current };
        });
    }
    return { state, start, channel, log, finish };
}
export type ActivityController=ReturnType<typeof useCleanupActivity>;
export function IdentityOperationProgress({activity}:{activity:Activity|null}){
    return <CleanupActivity activity={activity} identity/>;
}
export function CleanupActivity({ activity,identity=false }: {
    activity: Activity | null;
    identity?:boolean;
}) {
    const {t}=useI18n();
    const [open, setOpen] = useState(false); const [dismissed, setDismissed] = useState(false);
    const [now, setNow] = useState(performance.now());
    const logBox = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const follow = useRef(true);
    useEffect(() => {
        if (!activity)
            return;
        setOpen(false); setDismissed(false);
        follow.current = true;
        if (identity || activity.kind === 'clean' || activity.kind === 'system')
            panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [activity?.started]);
    useEffect(() => {
        if (!activity?.running)
            return;
        const timer = setInterval(() => setNow(performance.now()), 200);
        return () => clearInterval(timer);
    }, [activity?.running]);
    useEffect(() => { if (follow.current && logBox.current)
        logBox.current.scrollTop = logBox.current.scrollHeight; }, [activity?.entries.length, open]);
    if (!activity || (!activity.running && dismissed))
        return null;
    const last = activity.entries.at(-1);
    const elapsed = activity.running ? Math.max(0, now - activity.started) : last?.elapsed_ms || 0;
    const lastStage = last?.stage === 'done' ? [...activity.entries].reverse().find(e => e.stage !== 'done')?.stage : last?.stage;
    const count = last?.total && last.stage !== 'done' ? `${last.current} / ${last.total}` : null;
    const determinate = activity.running && (identity || last?.stage === 'clean' || last?.stage === 'browser') && !!last?.total;
    const fraction = determinate ? Math.min(100, 100 * (last?.current || 0) / (last?.total || 1)) : 0;
    const steps:Progress[]=[];
    for(const entry of activity.entries){if(entry.stage==='done')continue;if(steps.at(-1)?.stage===entry.stage)steps[steps.length-1]=entry;else steps.push(entry);}
    const resolvedSteps = steps.map((step, index) =>
        step.status === 'running' && (!activity.failed && (!activity.running || index < steps.length - 1))
            ? { ...step, status: 'ok' as const }
            : step
    );
    const status=activity.running?'running':activity.failed?'error':activity.warning?'warning':'ok';
    const showSteps = identity && (activity.running || status !== 'ok' || resolvedSteps.length > 1);
    const macroStages = identity ? summarizeCleanroomPipelineStages(activity.entries, activity.running, activity.failed) : [];
    return <Panel flat ref={panel} data-status={status} className={cn('cleanup-activity',identity&&'identity-operation', activity.running && 'activity-running', activity.failed && 'activity-failed',activity.warning&&'activity-warning')} aria-label={t(identity?'当前操作进度':"操作活动日志")}>
    <div className="activity-header"><div>{activity.running ? <ArrowClockwiseIcon className="spin" size={17}/> : <span className="activity-result-symbol">{activity.failed||activity.warning ? '!' : '✓'}</span>}<strong>{activity.title?t(activity.title):activity.kind === 'clean' ? t("清理执行记录") : activity.kind === 'stop' ? t("进程操作记录") : activity.kind === 'system' ? t("电脑设置记录") : activity.kind === 'browser' ? t("浏览器操作记录") : activity.kind === 'identity' ? t("身份操作记录") : activity.kind === 'cli' ? t("CLI 安装记录") : t("扫描记录")}</strong><span className="activity-state">{activity.running ? t("运行中") : activity.failed ? t("已停止 · 请检查") : activity.warning?t('已完成 · 有提示'):t("已完成")}</span></div><div className="activity-header-actions"><time>{(elapsed / 1000).toFixed(1)} s</time><Button variant="ghost" size="small" type="button" className="activity-action-btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? t("收起日志") : t("展开日志")} [{activity.entries.length}]</Button>{!activity.running && <Button variant="ghost" size="small" type="button" className="activity-action-btn" data-activity-dismiss="" onClick={() => setDismissed(true)}>{t("关闭记录")}</Button>}</div></div>
    {identity && macroStages.length > 0 && <div className="cleanroom-macro-pipeline" aria-label={t('三段式净室切换管线')}>{macroStages.map(stage => <span key={stage.id} className={`cleanroom-macro-pill macro-${stage.status}`} data-macro-stage={stage.id} data-macro-status={stage.status}>{t(stage.labelKey)}</span>)}</div>}
    {showSteps&&<ol className="identity-operation-steps" aria-label={t('实际执行阶段')}>{resolvedSteps.map((step,index)=><li key={index} className={`identity-operation-step step-${step.status}${activity.running&&index===resolvedSteps.length-1?' step-current':''}`} data-stage={step.stage} data-status={step.status} aria-current={activity.running&&index===resolvedSteps.length-1?'step':undefined}><span className="identity-operation-dot" aria-hidden="true">{step.status==='ok'?'✓':step.status==='error'?'!':''}</span><span>{t(phaseLabels[step.stage]||step.stage)}</span>{step.total!==null&&<code>{step.current}/{step.total}</code>}</li>)}</ol>}
    <div className={`activity-progress ${activity.running && !determinate ? 'indeterminate' : ''}`} role="progressbar" aria-label={identity?t('当前阶段进度'):t(labels[lastStage || 'scan'] || "操作进度")} aria-valuetext={identity?(count||t(activity.running?'处理中，尚无总量':'操作已结束')):undefined} aria-valuemin={0} aria-valuemax={100} aria-valuenow={determinate ? Math.round(fraction) : !activity.running && !activity.failed ? 100 : undefined}><span style={determinate ? { width: `${fraction}%` } : !activity.running && !activity.failed ? { width: '100%' } : { width: 0 }}/></div>
    <div className="activity-current" role="status" aria-live="polite"><span>{t(last?.message || "准备中…")}{activity.running && <i className="activity-cursor">_</i>}</span>{count && <strong>{count}</strong>}</div>
    {open && <div className="activity-log" ref={logBox} role="log" aria-label={t("本次操作日志")} aria-live="off" onScroll={() => { const box = logBox.current; if (box)
        follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40; }}>{activity.entries.map((entry, i) => <div className={`log-line log-${entry.status}`} key={i}><time>+{(entry.elapsed_ms / 1000).toFixed(2)}s</time><span className="log-tag">{entry.status === 'running' ? 'RUN' : entry.status === 'ok' ? 'OK' : entry.status === 'warning' ? 'NOTE' : 'FAIL'}</span><span>{t(entry.message)}</span></div>)}</div>}
  </Panel>;
}
