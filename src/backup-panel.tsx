/**
 * [INPUT]: 固定 app_data_dir 预览、用户显式输入的备份文件路径/口令与原生加密备份命令。
 * [OUTPUT]: 身份保险库加密导出、备份检查与新私有恢复副本回执；每次操作结束清除口令输入。
 * [POS]: 软件设置的数据管理区；只处理身份索引、主密钥和引用归档，不自动导出或接管当前身份。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect, useRef, useState} from 'react';
import {Button, Switch} from 'cromma-ui';
import {invoke} from '@tauri-apps/api/core';
import type {Locale} from './i18n';
import {canRestoreInspection, inspectionPresentation, inspectBackupRequest, restoreBackupRequest, type BackupInspection as Inspection, type BackupReceipt as Receipt} from './backup-panel-workflow';
import './backup-panel.css';

type Location = {app_data_dir: string; vault_available: boolean};
type Preview = {valid: boolean; rescue_available: boolean; saved_identities: number; archives: number; estimated_bytes: number; recovery_pending: boolean; diagnostics: string[]};

const copy = {
  title: {zh: '身份备份与恢复', en: 'Identity backup and recovery'},
  intro: {zh: '仅打包身份索引、保险库主密钥和已保存身份归档。不会包含浏览器资料、Claude 设置或尚未保存的当前身份内容。备份与恢复均由你手动启动。', en: 'Includes only the identity index, vault master key, and saved identity archives. Browser data, Claude settings, and unsaved current identity content are excluded. You start each action manually.'},
  location: {zh: '产品资料目录', en: 'Product data folder'},
  copyLocation: {zh: '复制资料目录', en: 'Copy data folder'},
  openLocation: {zh: '在文件资源管理器中打开', en: 'Open in File Explorer'},
  noVault: {zh: '身份保险库尚未创建。打开身份管理页后会按需建立。', en: 'The identity vault has not been created. Open Identity Management to create it when needed.'},
  preview: {zh: '重新读取预览', en: 'Refresh preview'},
  identities: {zh: '已保存身份', en: 'Saved identities'},
  archives: {zh: '引用归档', en: 'Referenced archives'},
  size: {zh: '大约大小', en: 'Estimated size'},
  pending: {zh: '检测到未完成的身份恢复状态。普通备份暂停；如需保留排障证据，请明确选择加密救援副本。', en: 'An unfinished identity recovery state was detected. Regular backup is paused. Choose an encrypted rescue copy to preserve troubleshooting evidence.'},
  invalid: {zh: '常规备份预检未通过。请先查看诊断标记；可读的保险库文件仍可作为加密救援证据保存。', en: 'The regular backup precheck failed. Review the diagnostic flags. Readable vault files can still be preserved as encrypted rescue evidence.'},
  rescue: {zh: '创建加密救援副本（包含当前恢复状态）', en: 'Create encrypted rescue copy (includes recovery state)'},
  export: {zh: '创建加密备份', en: 'Create encrypted backup'},
  exportPath: {zh: '新备份文件的完整路径', en: 'Full path for the new backup file'},
  pathHelp: {zh: '先在文件资源管理器中选择目标文件夹，再输入一个尚不存在的文件名。应用不会覆盖现有文件。', en: 'Choose a folder in File Explorer, then enter a new filename. The app will not overwrite an existing file.'},
  passphrase: {zh: '备份口令（至少 12 个字符）', en: 'Backup passphrase (at least 12 characters)'},
  confirm: {zh: '再次输入口令', en: 'Confirm passphrase'},
  create: {zh: '加密并保存', en: 'Encrypt and save'},
  restore: {zh: '检查备份并恢复副本', en: 'Inspect backup and restore a copy'},
  inputPath: {zh: '已有加密备份的完整路径', en: 'Full path to an encrypted backup'},
  inspect: {zh: '检查口令与备份完整性', en: 'Check passphrase and backup integrity'},
  inspectPass: {zh: '备份口令', en: 'Backup passphrase'},
  restorePass: {zh: '再次输入口令以恢复', en: 'Re-enter passphrase to restore'},
  restoreConfirmVerified: {zh: '我了解这会创建一份独立的已验证副本，不会替换当前身份库。', en: 'I understand this creates a separate verified copy and does not replace the active identity.'},
  restoreConfirmRescue: {zh: '我了解这只会暂存未验证的救援证据，不会验证、导入或替换当前身份库。', en: 'I understand this only stages unverified rescue evidence; it does not validate, import, or replace the active identity vault.'},
  restoreAction: {zh: '创建新的恢复副本', en: 'Create new recovery copy'},
  rescueRestoreAction: {zh: '暂存救援证据副本', en: 'Stage rescue evidence copy'},
  verified: {zh: '备份已通过口令认证、清单哈希、SQLite 完整性、身份/归档数量和归档认证检查。', en: 'Passphrase authentication, manifest hashes, SQLite integrity, identity/archive counts, and archive authentication all passed.'},
  rescueVerified: {zh: '救援副本已通过口令认证和证据文件哈希检查；SQLite 或主密钥可能未通过常规验证。', en: 'The rescue copy passed passphrase authentication and evidence-file hash checks; SQLite or the master key may not pass regular validation.'},
  recoveryFlag: {zh: '副本保留了未完成恢复标记；请先查看身份管理页的恢复状态。', en: 'The copy preserves an unfinished recovery marker. Review recovery status in Identity Management.'},
  result: {zh: '操作完成', en: 'Operation complete'},
  error: {zh: '操作未完成。原始保险库和备份源会保留。', en: 'The operation did not complete. The original vault and backup source are preserved.'},
  busy: {zh: '正在处理加密备份…', en: 'Processing encrypted backup…'},
  copied: {zh: '已复制资料目录', en: 'Data folder copied'},
  targetResult: {zh: '新副本位置', en: 'New copy location'},
  evidenceOnly: {zh: '这是隔离的救援证据副本，不是已验证身份库，也不会合并为当前身份。', en: 'This is an isolated rescue evidence copy, not a verified identity vault, and it will not be merged into the active identity.'},
  scope: {zh: '范围：身份 SQLite 索引、主密钥和身份归档。未保存的当前 Claude CLI 身份状态及浏览器资料不会包含在内。', en: 'Scope: identity SQLite index, master key, and identity archives. Unsaved current Claude CLI state and browser profiles are excluded.'},
  bytes: {zh: '备份文件大小', en: 'Backup file size'},
  noInspection: {zh: '先完成备份检查，再创建恢复副本。', en: 'Inspect the backup before creating a recovery copy.'},
  confirmed: {zh: '请确认恢复范围。', en: 'Confirm the recovery scope.'},
} satisfies Record<string, Record<Locale, string>>;

function formatBytes(value: number, locale: Locale) {
  if (!Number.isFinite(value) || value < 0) return '—';
  const units = locale === 'en' ? ['B', 'KB', 'MB', 'GB', 'TB'] : ['字节', 'KB', 'MB', 'GB', 'TB'];
  let amount = value, index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
  return `${index ? amount.toFixed(1) : Math.round(amount)} ${units[index]}`;
}
function flagLabel(flag: string, locale: Locale) {
  const labels: Record<string, [string, string]> = {
    vault_missing: ['身份保险库缺失', 'Vault folder is missing'],
    database_missing: ['SQLite 索引缺失', 'SQLite index is missing'],
    database_unreadable: ['SQLite 索引不可读', 'SQLite index is unreadable'],
    database_unverified: ['SQLite 索引未通过完整性检查', 'SQLite index did not pass integrity checks'],
    catalog_unverified: ['身份索引或归档映射无法验证', 'Identity catalog or archive mapping could not be verified'],
    master_key_missing: ['主密钥缺失', 'Master key is missing'],
    master_key_unreadable: ['主密钥不可读', 'Master key is unreadable'],
    master_key_invalid: ['主密钥长度无效', 'Master key length is invalid'],
    archive_unreadable: ['归档不可读', 'An archive is unreadable'],
    no_readable_evidence: ['没有可读证据文件', 'No readable evidence files'],
    recovery_pending: ['存在未完成恢复标记', 'Unfinished recovery marker is present'],
    database_sidecar_present: ['存在 SQLite sidecar；常规快照会使用 SQLite backup API', 'SQLite sidecars are present; regular snapshots use SQLite’s backup API'],
  };
  const label = labels[flag];
  return label ? label[locale === 'en' ? 1 : 0] : (locale === 'en' ? 'Additional integrity issue' : '其他完整性问题');
}

export function BackupPanel({locale}: {locale: Locale}) {
  const text = (key: keyof typeof copy) => copy[key][locale];
  const [location, setLocation] = useState<Location | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [exportPath, setExportPath] = useState('');
  const [inputPath, setInputPath] = useState('');
  const [exportPass, setExportPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [inspectPass, setInspectPass] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [rescueMode, setRescueMode] = useState(false);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspectionPath, setInspectionPath] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const inspectionRevision = useRef(0);

  async function refresh() {
    setError('');
    try {
      const found = await invoke<Location>('identities_backup_location');
      setLocation(found);
      if (found.vault_available) setPreview(await invoke<Preview>('identities_backup_preview'));
      else setPreview(null);
    } catch (cause) { setError(String(cause)); }
  }
  useEffect(() => { void refresh(); }, []);

  async function exportBackup() {
    if (!exportPath.trim() || exportPass.length < 12 || exportPass !== confirmPass) return;
    setBusy(true); setError(''); setReceipt(null); setNotice('');
    try {
      const saved = await invoke<Receipt>('identities_backup_export', {path: exportPath.trim(), passphrase: exportPass, confirmation: confirmPass, rescueMode});
      setReceipt(saved); setNotice(text('result')); await refresh();
    } catch (cause) { setError(`${text('error')} ${String(cause)}`); }
    finally { setExportPass(''); setConfirmPass(''); setBusy(false); }
  }
  async function inspectBackup() {
    if (!inputPath.trim() || !inspectPass) return;
    const requestedPath = inputPath.trim();
    const revision = ++inspectionRevision.current;
    setBusy(true); setError(''); setInspection(null); setReceipt(null); setNotice(''); setRestoreConfirmed(false);
    setInspectionPath('');
    try {
      const result = await inspectBackupRequest(requestedPath, inspectPass, () => revision === inspectionRevision.current, invoke);
      if (!result) return;
      setInspection(result.inspection); setInspectionPath(result.path); setNotice(text(inspectionPresentation(result.inspection).noticeKey));
    } catch (cause) {
      if (revision === inspectionRevision.current) setError(`${text('error')} ${String(cause)}`);
    } finally {
      if (revision === inspectionRevision.current) {setInspectPass('');setBusy(false);}
    }
  }
  async function restoreCopy() {
    if (!canRestoreInspection(inspection, inspectionPath, inputPath, restoreConfirmed, restorePass)) return;
    setBusy(true); setError(''); setReceipt(null); setNotice('');
    try {
      const restored = await restoreBackupRequest(inspection, inspectionPath, inputPath, restoreConfirmed, restorePass, invoke);
      if (!restored) return;
      setReceipt(restored); setNotice(text('result'));
    } catch (cause) { setError(`${text('error')} ${String(cause)}`); }
    finally { setRestorePass(''); setBusy(false); }
  }
  const presentation = inspectionPresentation(inspection);

  return (
    <section className="settings-group backup-panel">
      <div className="settings-group-heading"><span className="settings-group-bar" aria-hidden="true"/><h2>{text('title')}</h2></div>
      <div className="settings-card backup-card">
        <p>{text('intro')}</p>
        <div className="backup-location">
          <strong>{text('location')}</strong>
          {location ? <code>{location.app_data_dir}</code> : <span>—</span>}
          {location?.vault_available ? null : <span>{text('noVault')}</span>}
          {location && <div className="backup-location-actions"><Button size="small" variant="secondary" disabled={busy} onClick={() => void invoke('identities_backup_open_location').catch(cause => setError(String(cause)))}>{text('openLocation')}</Button><Button size="small" variant="secondary" disabled={busy} onClick={() => void invoke('copy_result', {text: location.app_data_dir}).then(() => setNotice(text('copied'))).catch(cause => setError(String(cause)))}>{text('copyLocation')}</Button></div>}
        </div>
        <Button size="small" variant="secondary" disabled={busy} onClick={() => void refresh()}>{text('preview')}</Button>
        {preview && <div className="backup-preview" aria-live="polite">
          <span><strong>{preview.saved_identities}</strong>{text('identities')}</span><span><strong>{preview.archives}</strong>{text('archives')}</span><span><strong>{formatBytes(preview.estimated_bytes, locale)}</strong>{text('size')}</span>
        </div>}
        <div className="backup-note">{text('scope')}</div>
        {preview?.recovery_pending && <div className="system-feedback error" role="status">{text('pending')}</div>}
        {preview && !preview.valid && !preview.recovery_pending && <div className="system-feedback error" role="status">{text('invalid')}</div>}
        {preview?.diagnostics.length ? <div className="backup-diagnostics" role="status"><strong>{locale === 'en' ? 'Read-only diagnostic flags' : '只读诊断标记'}</strong><span>{preview.diagnostics.map(flag => flagLabel(flag, locale)).join(' · ')}</span></div> : null}
        <div className="backup-form">
          <h3>{text('export')}</h3>
          <label>{text('exportPath')}<input value={exportPath} onChange={event => setExportPath(event.target.value)} autoComplete="off" spellCheck={false} /></label>
          <p>{text('pathHelp')}</p>
          <label>{text('passphrase')}<input type="password" value={exportPass} onChange={event => setExportPass(event.target.value)} autoComplete="new-password" /></label>
          <label>{text('confirm')}<input type="password" value={confirmPass} onChange={event => setConfirmPass(event.target.value)} autoComplete="new-password" /></label>
          {preview && <div className="backup-rescue-toggle"><Switch aria-label={text('rescue')} checked={rescueMode} onCheckedChange={setRescueMode} /><span>{text('rescue')}</span></div>}
          <Button variant="secondary" disabled={busy || !preview || !preview.rescue_available || !exportPath.trim() || exportPass.length < 12 || exportPass !== confirmPass || (!preview.valid && !rescueMode)} onClick={() => void exportBackup()}>{busy ? text('busy') : text('create')}</Button>
        </div>
        <div className="backup-form">
          <h3>{text('restore')}</h3>
          <label>{text('inputPath')}<input value={inputPath} onChange={event => {inspectionRevision.current++;setInputPath(event.target.value);setInspectPass('');setRestorePass('');setInspection(null);setInspectionPath('');setRestoreConfirmed(false);setReceipt(null);setNotice('');setError('');setBusy(false);}} autoComplete="off" spellCheck={false} /></label>
          <label>{text('inspectPass')}<input type="password" value={inspectPass} onChange={event => setInspectPass(event.target.value)} autoComplete="current-password" /></label>
          <Button variant="secondary" disabled={busy || !inputPath.trim() || !inspectPass} onClick={() => void inspectBackup()}>{text('inspect')}</Button>
          {inspection && (inspection.verified || inspection.rescue_copy) && inspectionPath === inputPath.trim() && <div className="backup-inspection" role="status">
            <strong>{inspection.rescue_copy ? text('rescueVerified') : text('verified')}</strong>
            <span>{inspection.saved_identities} {text('identities')} · {inspection.archives} {text('archives')} · {formatBytes(inspection.bytes, locale)}</span>
            {inspection.recovery_pending && <span>{text('recoveryFlag')}</span>}
            {inspection.rescue_copy && <span>{inspection.diagnostics.map(flag => flagLabel(flag, locale)).join(' · ')}</span>}
            <label className="backup-rescue-toggle"><Switch aria-label={text(presentation.confirmationKey)} checked={restoreConfirmed} onCheckedChange={setRestoreConfirmed} /><span>{text(presentation.confirmationKey)}</span></label>
            <label>{text('restorePass')}<input type="password" value={restorePass} onChange={event => setRestorePass(event.target.value)} autoComplete="new-password" /></label>
            <Button variant="secondary" disabled={busy || !canRestoreInspection(inspection, inspectionPath, inputPath, restoreConfirmed, restorePass)} onClick={() => void restoreCopy()}>{text(presentation.actionKey)}</Button>
          </div>}
        </div>
        {busy && <p role="status">{text('busy')}</p>}
        {error && <p className="system-feedback error" role="alert">{error}</p>}
        {notice && <p className="system-feedback" role="status">{notice}</p>}
        {receipt && <div className="backup-receipt"><strong>{text('targetResult')}</strong><code>{receipt.path}</code>{receipt.bytes !== undefined && <span>{text('bytes')}: {formatBytes(receipt.bytes, locale)}</span>}{receipt.active_vault_changed === false && !receipt.rescue_copy && <strong>{locale === 'en' ? 'Verified copy created; active vault was not changed.' : '已创建已验证副本；当前身份库未更改。'}</strong>}</div>}
        {(receipt?.rescue_copy || inspection?.rescue_copy) && <div className="backup-note">{text('evidenceOnly')}</div>}
      </div>
    </section>
  );
}
