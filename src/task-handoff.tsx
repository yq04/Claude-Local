/**
 * [INPUT]: Explicit user-written bounded task notes, shared locale and a controlled dialog state; no session/account/project reads.
 * [OUTPUT]: Six editable in-memory fields, a Markdown preview, copy feedback and an explicit fixed-name Markdown download.
 * [POS]: Local handoff aid; never reads or rewrites sessions, credentials, account data or project files.
 * [PROTOCOL]: Update this header, both locales and src/CLAUDE.md when changing this workflow.
 */
import {useEffect, useId, useRef, useState} from 'react';
import {Button, Input, Textarea} from 'cromma-ui';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';
import {AppDialog} from './dialog';
import {buildHandoffMarkdown, emptyHandoffFields, HANDOFF_DOWNLOAD_NAME, HANDOFF_FIELD_LIMIT, type HandoffFields} from './handoff-model';

const fields = ['task', 'goal', 'progress', 'next', 'verification', 'constraints'] as const;

export function TaskHandoff({open: controlledOpen, onOpenChange}: {open?: boolean; onOpenChange?: (open: boolean) => void} = {}) {
  const {t} = useI18n();
  const prefix = useId();
  const firstField = useRef<HTMLInputElement>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const changeOpen = onOpenChange ?? setLocalOpen;
  const [notes, setNotes] = useState<HandoffFields>(emptyHandoffFields);
  const [status, setStatus] = useState<'copied'|'downloaded'|'failed'|null>(null);
  const [busy, setBusy] = useState(false);
  const preview = buildHandoffMarkdown(notes, t('handoff.title'), Object.fromEntries(fields.map(field => [field, t('handoff.' + field)])) as Record<keyof HandoffFields, string>, t('handoff.notFilled'));

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => firstField.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  async function copy() {
    if (busy) return;
    setBusy(true);setStatus(null);
    try {
      try {
        await invoke('copy_result', {text: preview});
      } catch {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(preview);
      }
      setStatus('copied');
    } catch {
      setStatus('failed');
    } finally {
      setBusy(false);
    }
  }
  function download() {
    setStatus(null);
    try {
      const url = URL.createObjectURL(new Blob([preview], {type: 'text/markdown;charset=utf-8'}));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = HANDOFF_DOWNLOAD_NAME;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('downloaded');
    } catch {
      setStatus('failed');
    }
  }

  return <>
    {controlledOpen === undefined && <Button variant="secondary" size="small" onClick={() => changeOpen(true)}>{t('handoff.title')}</Button>}
    <AppDialog open={open} onOpenChange={changeOpen} title={t('handoff.title')} description={t('handoff.scope')} width={720} className="task-handoff-dialog">
      <div className="task-handoff">
        <div className="task-handoff-fields">
          {fields.map((field, index) => <label key={field} htmlFor={prefix + field}>
            <span>{t('handoff.' + field)}</span>
            {field === 'task'
              ? <Input ref={firstField} id={prefix + field} maxLength={HANDOFF_FIELD_LIMIT} value={notes[field]} onChange={event => {setNotes(old => ({...old, [field]: event.target.value}));setStatus(null);}} />
              : <Textarea id={prefix + field} rows={index === 1 || index === 2 ? 3 : 2} maxLength={HANDOFF_FIELD_LIMIT} value={notes[field]} onChange={event => {setNotes(old => ({...old, [field]: event.target.value}));setStatus(null);}} />}
          </label>)}
        </div>
        <p>{t('handoff.reviewHint')}</p>
        <pre className="task-handoff-preview" aria-label={t('handoff.preview')}>{preview}</pre>
        <div className="task-handoff-actions">
          <Button variant="secondary" size="small" loading={busy} disabled={busy} onClick={() => void copy()}>{t('handoff.copy')}</Button>
          <Button variant="secondary" size="small" disabled={busy} onClick={download}>{t('handoff.download')}</Button>
          <span role={status === 'failed' ? 'alert' : 'status'}>{status ? t('handoff.' + status) : ''}</span>
        </div>
      </div>
    </AppDialog>
  </>;
}
