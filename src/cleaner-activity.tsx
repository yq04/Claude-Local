/**
 * [INPUT]: Tauri 单次调用的有序进度流和清理、CLI 安装、系统和浏览器页面的操作结果与共享 YAML 文案。
 * [OUTPUT]: 本次活动状态、受控显隐的三段式净室切换胶囊摘要（summarizeCleanroomPipelineStages：仅切换/恢复显示且按真实事件输出 pending/running/ok/warning/error/skipped）、保留单调原生 elapsed_ms 与局部 (current/total) 的日志及身份卡片下的事件驱动动画；未知总量无百分比，原始消息在呈现时翻译。
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
export type Activity = {
    kind: Kind;
    title?: string;
    started: number;
    entries: Progress[];
    running: boolean;
    failed: boolean;
    warning?: boolean;
};
const labels: Record<string, string> = { delete:'直接删除',archive:'身份暂存',switch:'身份切换',identity:'身份管理',validate: '检查', clean: '逐项清理', verify: '复查', scan: '深度扫描', stop: '进程检查', system: '应用设置', browser: '浏览器操作', cli: 'CLI 安装', done: '结果' };
const phaseLabels:Record<string,string>={...labels,identity:'准备身份操作',stop:'结束 Claude 进程',archive:'压缩暂存',compress:'写入加密归档',verify_archive:'验证身份归档',clear:'清空当前工作区',credentials:'处理登录凭据',restore:'恢复目标身份',cleanroom:'净室隔离与指纹对齐',commit:'保存身份状态',rollback:'恢复原有状态'};

export type CleanroomMacroStageStatus = 'pending' | 'running' | 'ok' | 'warning' | 'error' | 'skipped';
export type CleanroomMacroStage = {
    id: 'lock_guard' | 'cleanroom_vault' | 'exit_align';
    labelKey: string;
    status: CleanroomMacroStageStatus;
};

const LOCK_GUARD_STAGES = new Set(['stop', 'validate']);
const CLEANROOM_VAULT_STAGES = new Set([
    'archive',
    'compress',
    'verify_archive',
    'clear',
    'credentials',
    'restore',
    'cleanroom',
    'commit',
    'verify',
    'rollback',
    'write',
]);
const CLEANROOM_COMPLETION_STAGES = new Set(['cleanroom', 'commit', 'verify']);

export function summarizeCleanroomPipelineStages(entries: Progress[], running: boolean, failed: boolean): CleanroomMacroStage[] {
    const nonDoneEntries = entries.filter(entry => entry.stage !== 'done');
    const lastNonDone = nonDoneEntries.at(-1);

    // 1. lock_guard (① 进程与快照校验)
    const lockEvents = nonDoneEntries.filter(entry => LOCK_GUARD_STAGES.has(entry.stage));
    const latestLock = lockEvents.at(-1);
    let lockStatus: CleanroomMacroStageStatus;
    if (lockEvents.length === 0) {
        lockStatus = running ? 'pending' : 'skipped';
    } else if (lockEvents.some(entry => entry.status === 'error')) {
        lockStatus = 'error';
    } else if (lockEvents.some(entry => entry.status === 'warning')) {
        lockStatus = 'warning';
    } else if (failed && lastNonDone && LOCK_GUARD_STAGES.has(lastNonDone.stage)) {
        lockStatus = 'error';
    } else if (running && lastNonDone && LOCK_GUARD_STAGES.has(lastNonDone.stage)) {
        lockStatus = 'running';
    } else if (latestLock?.status === 'ok') {
        lockStatus = 'ok';
    } else {
        lockStatus = running ? 'running' : 'pending';
    }

    // 2. cleanroom_vault (② 归档切换与净室隔离)
    const vaultEvents = nonDoneEntries.filter(entry => CLEANROOM_VAULT_STAGES.has(entry.stage));
    const latestVault = vaultEvents.at(-1);
    const vaultSucceeded = vaultEvents.some(
        entry => CLEANROOM_COMPLETION_STAGES.has(entry.stage) && entry.status === 'ok',
    );
    let vaultStatus: CleanroomMacroStageStatus;
    if (vaultEvents.length === 0) {
        vaultStatus = running ? 'pending' : 'skipped';
    } else if (vaultEvents.some(entry => entry.stage === 'rollback' || entry.status === 'error')) {
        vaultStatus = 'error';
    } else if (failed && lastNonDone && CLEANROOM_VAULT_STAGES.has(lastNonDone.stage)) {
        vaultStatus = 'error';
    } else if (vaultEvents.some(entry => entry.status === 'warning')) {
        vaultStatus = 'warning';
    } else if (
        running &&
        (latestVault?.status === 'running' ||
            (lastNonDone && CLEANROOM_VAULT_STAGES.has(lastNonDone.stage)) ||
            !vaultSucceeded)
    ) {
        vaultStatus = 'running';
    } else if (vaultSucceeded && latestVault?.status === 'ok') {
        vaultStatus = 'ok';
    } else {
        vaultStatus = running ? 'running' : 'pending';
    }

    // 3. exit_align (③ 浏览器联动对齐)
    let commitIdx = -1;
    for (let i = nonDoneEntries.length - 1; i >= 0; i--) {
        if (nonDoneEntries[i].stage === 'commit') {
            commitIdx = i;
            break;
        }
    }
    const allBrowserEvents = nonDoneEntries.filter(entry => entry.stage === 'browser');
    const postCommitBrowserEvents =
        commitIdx >= 0 ? nonDoneEntries.slice(commitIdx + 1).filter(entry => entry.stage === 'browser') : [];
    const browserEvents = postCommitBrowserEvents.length > 0 ? postCommitBrowserEvents : allBrowserEvents;
    const latestBrowser = browserEvents.at(-1);
    let exitStatus: CleanroomMacroStageStatus;
    if (browserEvents.length === 0) {
        exitStatus = running ? 'pending' : 'skipped';
    } else if (browserEvents.some(entry => entry.status === 'error')) {
        exitStatus = 'error';
    } else if (browserEvents.some(entry => entry.status === 'warning')) {
        exitStatus = 'warning';
    } else if (failed && lastNonDone?.stage === 'browser') {
        exitStatus = 'error';
    } else if (running && (latestBrowser?.status === 'running' || lastNonDone?.stage === 'browser')) {
        exitStatus = 'running';
    } else if (commitIdx === -1 && running) {
        exitStatus = 'pending';
    } else if (latestBrowser?.status === 'ok') {
        exitStatus = 'ok';
    } else {
        exitStatus = running ? 'running' : 'pending';
    }

    return [
        {id: 'lock_guard', labelKey: '① 进程与快照校验', status: lockStatus},
        {id: 'cleanroom_vault', labelKey: '② 归档切换与净室隔离', status: vaultStatus},
        {id: 'exit_align', labelKey: '③ 浏览器联动对齐', status: exitStatus},
    ];
}

export function useCleanupActivity() {
    const [state, setState] = useState<Activity | null>(null);
    const sequence = useRef(0);
    const began = useRef(0);
    const maxElapsedRef = useRef(0);
    function append(event: Progress, token = sequence.current) {
        if (token !== sequence.current)
            return;
        const rawElapsed = typeof event.elapsed_ms === 'number' && Number.isFinite(event.elapsed_ms) && event.elapsed_ms > 0
            ? Math.round(event.elapsed_ms)
            : Math.round(performance.now() - began.current);
        const elapsed_ms = Math.max(maxElapsedRef.current, rawElapsed);
        maxElapsedRef.current = elapsed_ms;
        const normalizedEvent: Progress = { ...event, elapsed_ms };
        setState(old => {
            if (!old)
                return old;
            const entries = [...old.entries];
            const done = entries.at(-1)?.stage === 'done' ? entries.pop() : undefined;
            entries.push(normalizedEvent);
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
        return new Channel<Progress>(event => append({
            ...event,
            stage: remap || event.stage,
            elapsed_ms: typeof event.elapsed_ms === 'number' && Number.isFinite(event.elapsed_ms) && event.elapsed_ms > 0
                ? event.elapsed_ms
                : Math.round(performance.now() - began.current),
        }, token));
    }
    function start(kind: Kind, title?:string) {
        sequence.current++;
        began.current = performance.now();
        maxElapsedRef.current = 0;
        setState({ kind, title, started: began.current, entries: [], running: true, failed: false });
        log(kind === 'clean' ? 'validate' : kind, 'running', kind === 'clean' ? "已提交所选清单，等待快照核验。" : kind === 'scan' ? "开始扫描本地数据。" : kind === 'system' ? "开始应用电脑设置。" : kind === 'browser' ? "开始浏览器操作。" : kind === 'identity' ? "开始本地身份操作。" : kind === 'cli' ? "开始 Claude Code CLI 安装管理。" : "检查并结束已确认的 Claude 进程。");
        return channel();
    }
    function finish(success: boolean, message: string) {
        log('done', success ? 'ok' : 'error', message);
        setState(old => {
            if (!old) return old;
            const hasWarning = success && old.entries.some(entry => entry.status === 'warning' || entry.status === 'error');
            return { ...old, running: false, failed: !success, warning: hasWarning };
        });
    }
    return { state, start, channel, log, finish };
}
export type ActivityController=ReturnType<typeof useCleanupActivity>;
export function IdentityOperationProgress({activity,showCleanroomBar=false}:{activity:Activity|null;showCleanroomBar?:boolean}){
    return <CleanupActivity activity={activity} identity showCleanroomBar={showCleanroomBar}/>;
}
export function CleanupActivity({ activity,identity=false,showCleanroomBar=false }: {
    activity: Activity | null;
    identity?:boolean;
    showCleanroomBar?:boolean;
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
        if (identity || activity.kind === 'clean' || activity.kind === 'system') {
            const smooth = typeof document === 'undefined' || document.documentElement.dataset.reduceMotion !== 'true';
            panel.current?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
        }
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
    const macroStages = identity && showCleanroomBar ? summarizeCleanroomPipelineStages(activity.entries, activity.running, activity.failed) : [];
    return <Panel flat ref={panel} data-status={status} className={cn('cleanup-activity',identity&&'identity-operation', activity.running && 'activity-running', activity.failed && 'activity-failed',activity.warning&&'activity-warning')} aria-label={t(identity?'当前操作进度':"操作活动日志")}>
    <div className="activity-header"><div>{activity.running ? <ArrowClockwiseIcon className="spin" size={17}/> : <span className="activity-result-symbol">{activity.failed||activity.warning ? '!' : '✓'}</span>}<strong>{activity.title?t(activity.title):activity.kind === 'clean' ? t("清理执行记录") : activity.kind === 'stop' ? t("进程操作记录") : activity.kind === 'system' ? t("电脑设置记录") : activity.kind === 'browser' ? t("浏览器操作记录") : activity.kind === 'identity' ? t("身份操作记录") : activity.kind === 'cli' ? t("CLI 安装记录") : t("扫描记录")}</strong><span className="activity-state">{activity.running ? t("运行中") : activity.failed ? t("已停止 · 请检查") : activity.warning?t('已完成 · 有提示'):t("已完成")}</span></div><div className="activity-header-actions"><time>{(elapsed / 1000).toFixed(1)} s</time><Button variant="ghost" size="small" type="button" className="activity-action-btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? t("收起日志") : t("展开日志")} [{activity.entries.length}]</Button>{!activity.running && <Button variant="ghost" size="small" type="button" className="activity-action-btn" data-activity-dismiss="" onClick={() => setDismissed(true)}>{t("关闭记录")}</Button>}</div></div>
    {identity && showCleanroomBar && macroStages.length > 0 && <div className="cleanroom-macro-pipeline" aria-label={t('三段式净室切换管线')}>{macroStages.map(stage => <span key={stage.id} className={`cleanroom-macro-pill macro-${stage.status}`} data-macro-stage={stage.id} data-macro-status={stage.status}>{t(stage.labelKey)}</span>)}</div>}
    {showSteps&&<ol className="identity-operation-steps" aria-label={t('实际执行阶段')}>{resolvedSteps.map((step,index)=><li key={index} className={`identity-operation-step step-${step.status}${activity.running&&index===resolvedSteps.length-1?' step-current':''}`} data-stage={step.stage} data-status={step.status} aria-current={activity.running&&index===resolvedSteps.length-1?'step':undefined}><span className="identity-operation-dot" aria-hidden="true">{step.status==='ok'?'✓':step.status==='error'||step.status==='warning'?'!':''}</span><span>{t(phaseLabels[step.stage]||step.stage)}</span>{step.total!==null&&<code>{step.current}/{step.total}</code>}</li>)}</ol>}
    <div className={`activity-progress ${activity.running && !determinate ? 'indeterminate' : ''}`} role="progressbar" aria-label={identity?t('当前阶段进度'):t(labels[lastStage || 'scan'] || "操作进度")} aria-valuetext={identity?(count||t(activity.running?'处理中，尚无总量':'操作已结束')):undefined} aria-valuemin={0} aria-valuemax={100} aria-valuenow={determinate ? Math.round(fraction) : !activity.running && !activity.failed ? 100 : undefined}><span style={determinate ? { width: `${fraction}%` } : !activity.running && !activity.failed ? { width: '100%' } : { width: 0 }}/></div>
    <div className="activity-current" role="status" aria-live="polite"><span>{t(last?.message || "准备中…")}{activity.running && <i className="activity-cursor">_</i>}</span>{count && <strong>{count}</strong>}</div>
    {open && <div className="activity-log" ref={logBox} role="log" aria-label={t("本次操作日志")} aria-live="off" onScroll={() => { const box = logBox.current; if (box)
        follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40; }}>{activity.entries.map((entry, i) => <div className={`log-line log-${entry.status}`} key={i}><time>+{(entry.elapsed_ms / 1000).toFixed(2)}s</time><span className="log-tag">{entry.status === 'running' ? 'RUN' : entry.status === 'ok' ? 'OK' : entry.status === 'warning' ? 'NOTE' : 'FAIL'}</span><span>{t(entry.message)}{entry.total !== null && entry.total > 0 ? ` (${entry.current}/${entry.total})` : ''}</span></div>)}</div>}
  </Panel>;
}
