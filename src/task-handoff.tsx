/**
 * [INPUT]: Explicit user-written task notes and the shared locale; no session, account or project-file reads.
 * [OUTPUT]: Editable handoff fields, a preview and a truthful copy action for starting a new conversation.
 * [POS]: Local task continuity aid; never rewrites or exports account-bound sessions, credentials or filesystem contents.
 * [PROTOCOL]: Update this header, both locales and src/CLAUDE.md when changing this workflow.
 */
import {useId, useState} from 'react';
import {Button, Disclosure, Input} from 'cromma-ui';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';

export function TaskHandoff() {
  const {t} = useI18n();
  const prefix = useId();
  const [notes, setNotes] = useState({goal:'', progress:'', next:'', constraints:''});
  const [status, setStatus] = useState<'copied'|'failed'|null>(null);
  const [busy, setBusy] = useState(false);
  const fields = ['goal','progress','next','constraints'] as const;
  const preview = ['# ' + t('handoff.title'), ...fields.map(field => '## ' + t('handoff.' + field) + '\n' + (notes[field].trim() || t('handoff.notFilled')))].join('\n\n');
  async function copy() {
    if (busy) return;
    setBusy(true);setStatus(null);
    try {
      await invoke('copy_result', {text:preview});
      setStatus('copied');
    } catch {
      setStatus('failed');
    } finally {
      setBusy(false);
    }
  }
  return <Disclosure className="help-details" summary={t('handoff.title')}>
    <div className="task-handoff">
      <p>{t('handoff.scope')}</p>
      {fields.map(field => <label key={field} htmlFor={prefix + field}>
        <span>{t('handoff.' + field)}</span>
        <Input id={prefix + field} maxLength={2000} value={notes[field]} onChange={event => {setNotes(old => ({...old,[field]:event.target.value}));setStatus(null);}} />
      </label>)}
      <pre className="task-handoff-preview" aria-label={t('handoff.preview')}>{preview}</pre>
      <p>{t('handoff.reviewHint')}</p>
      <div><Button variant="secondary" loading={busy} disabled={busy} onClick={() => void copy()}>{t('handoff.copy')}</Button><span role="status">{status ? t('handoff.' + status) : ''}</span></div>
    </div>
  </Disclosure>;
}
