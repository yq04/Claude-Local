/**
 * [INPUT]: Explicit user-written bounded task notes, optional user-selected Markdown file, shared locale and a controlled dialog state; no session/account/project reads.
 * [OUTPUT]: Six editable in-memory fields, a Markdown preview, copy feedback, explicit Markdown download and safe user file load with plain text review/confirmation.
 * [POS]: Local handoff aid; never reads or rewrites sessions, credentials, account data or project files.
 * [PROTOCOL]: Update this header, both locales and src/CLAUDE.md when changing this workflow.
 */
import {useEffect, useId, useRef, useState} from 'react';
import {Button, Input, Textarea} from 'cromma-ui';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';
import {AppDialog} from './dialog';
import {
  buildHandoffMarkdown,
  emptyHandoffFields,
  HANDOFF_DOWNLOAD_NAME,
  HANDOFF_FIELD_LIMIT,
  HANDOFF_MAX_FILE_BYTES,
  isDraftNonEmpty,
  parseHandoffMarkdown,
  type HandoffFields,
} from './handoff-model';

const fields = ['task', 'goal', 'progress', 'next', 'verification', 'constraints'] as const;

function formatHandoffStatus(status: string | null, t: (k: string) => string): string {
  if (!status) return '';
  const direct = t('handoff.' + status);
  if (direct !== 'handoff.' + status) return direct;
  const errorDirect = t('handoff.error.' + status);
  if (errorDirect !== 'handoff.error.' + status) return errorDirect;

  const fallbacks: Record<string, string> = {
    copied: '交接内容已复制',
    downloaded: '交接内容已下载',
    loaded: '交接内容已载入',
    failed: '复制失败，请重试',
    fileTooLarge: '文件过大，交接文件最大限制为 64 KiB',
    emptyFile: '所选文件为空',
    unknownTemplate: '不支持的文件格式，仅支持由 Claude-Local 导出的交接模板',
    unsupportedVersion: '不支持的交接模板版本',
    duplicateField: '交接模板格式损坏：存在重复字段',
    oversizeField: '交接字段超出 2000 字符限制',
    malformed: '交接模板格式错误，无法解析',
    readFailed: '读取文件失败，请重试',
  };
  return fallbacks[status] || status;
}

const isErrorStatus = (s: string | null): boolean =>
  s === 'failed' ||
  s === 'fileTooLarge' ||
  s === 'emptyFile' ||
  s === 'unknownTemplate' ||
  s === 'unsupportedVersion' ||
  s === 'duplicateField' ||
  s === 'oversizeField' ||
  s === 'malformed' ||
  s === 'readFailed';

export function TaskHandoff({open: controlledOpen, onOpenChange}: {open?: boolean; onOpenChange?: (open: boolean) => void} = {}) {
  const {t} = useI18n();
  const prefix = useId();
  const firstField = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const changeOpen = onOpenChange ?? setLocalOpen;
  const [notes, setNotes] = useState<HandoffFields>(emptyHandoffFields);
  const [status, setStatus] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    fields: HandoffFields;
    fileName: string;
    previewText: string;
  } | null>(null);

  const currentLabels = Object.fromEntries(
    fields.map(field => [field, t('handoff.' + field) || field])
  ) as Record<keyof HandoffFields, string>;
  const preview = buildHandoffMarkdown(notes, t('handoff.title') || 'Task handoff template', currentLabels, t('handoff.notFilled') || 'To be filled in');

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

  function triggerLoad() {
    setStatus(null);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > HANDOFF_MAX_FILE_BYTES) {
      setStatus('fileTooLarge');
      return;
    }

    let textContent = '';
    try {
      textContent = await file.text();
    } catch {
      setStatus('readFailed');
      return;
    }

    const parsed = parseHandoffMarkdown(textContent);
    if (!parsed.ok) {
      setStatus(parsed.errorKey);
      return;
    }

    const importPreview = buildHandoffMarkdown(
      parsed.fields,
      t('handoff.title') || 'Task handoff template',
      currentLabels,
      t('handoff.notFilled') || 'To be filled in'
    );

    if (isDraftNonEmpty(notes)) {
      setPendingImport({
        fields: parsed.fields,
        fileName: file.name,
        previewText: importPreview,
      });
    } else {
      setNotes(parsed.fields);
      setStatus('loaded');
    }
  }

  function confirmImport() {
    if (!pendingImport) return;
    setNotes(pendingImport.fields);
    setPendingImport(null);
    setStatus('loaded');
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
          <Button variant="secondary" size="small" disabled={busy} onClick={triggerLoad}>{t('handoff.load') || '载入 Markdown'}</Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,text/markdown"
            style={{display: 'none'}}
            aria-label={t('handoff.load') || '载入 Markdown'}
            data-testid="handoff-file-input"
            onChange={e => void handleFileSelected(e)}
          />
          <span role={isErrorStatus(status) ? 'alert' : 'status'}>{formatHandoffStatus(status, t)}</span>
        </div>
      </div>
    </AppDialog>
    <AppDialog
      alert
      open={pendingImport !== null}
      onOpenChange={openState => {
        if (!openState) setPendingImport(null);
      }}
      title={t('handoff.importConfirmTitle') || '确认替换当前交接草稿'}
      description={t('handoff.importConfirmDesc') || '当前草稿包含未保存的手填内容。载入新文件将覆盖现有内容，此操作不可撤销。请核对下方预览：'}
      width={640}
      className="task-handoff-dialog task-handoff-confirm-dialog"
      footer={
        <>
          <Button
            variant="secondary"
            size="small"
            data-dialog-cancel
            onClick={() => setPendingImport(null)}
          >
            {t('handoff.cancel') || '取消'}
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={confirmImport}
          >
            {t('handoff.confirmReplace') || '确认替换'}
          </Button>
        </>
      }
    >
      <div className="task-handoff" style={{gap: '8px'}}>
        <p><strong>{pendingImport?.fileName}</strong></p>
        <pre className="task-handoff-preview" aria-label={t('handoff.preview')}>
          {pendingImport?.previewText}
        </pre>
      </div>
    </AppDialog>
  </>;
}
