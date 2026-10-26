/**
 * [INPUT]: Backup panel restore workflow helpers and a synthetic IPC responder.
 * [OUTPUT]: Verified/rescue restore flow, preserved success with cleanup diagnostics and stale inspection path coverage.
 * [POS]: Isolated UI workflow test; does not mount Tauri, access the filesystem, or launch the product.
 * [PROTOCOL]: Keep scenarios aligned with the visible inspection/confirmation controls in backup-panel.tsx.
 */
import {expect, test} from 'bun:test';
import {
  canRestoreInspection,
  inspectionPresentation,
  inspectBackupRequest,
  restoreBackupRequest,
  type BackupInspection,
  type BackupInvoke,
} from './backup-panel-workflow';

const rescueInspection: BackupInspection = {
  saved_identities: 0,
  archives: 2,
  bytes: 1200,
  verified: false,
  rescue_copy: true,
  recovery_pending: true,
  diagnostics: ['database_unverified'],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}

test('rescue inspection tells the truth, requires confirmation, and stages the reviewed path', async () => {
  const calls: Array<{command: string; args: Record<string, unknown>}> = [];
  const fakeIpc: BackupInvoke = async <T>(command: string, args: Record<string, unknown>) => {
    calls.push({command, args});
    if (command === 'identities_backup_inspect') return rescueInspection as T;
    if (command === 'identities_backup_restore_new') return {path: '/isolated/rescue-evidence'} as T;
    throw new Error(`Unexpected command: ${command}`);
  };

  const inspected = await inspectBackupRequest('/backup/rescue.clbak', 'synthetic-passphrase', () => true, fakeIpc);
  expect(inspected?.path).toBe('/backup/rescue.clbak');
  expect(inspectionPresentation(inspected!.inspection)).toEqual({
    noticeKey: 'rescueVerified',
    confirmationKey: 'restoreConfirmRescue',
    actionKey: 'rescueRestoreAction',
  });
  expect(canRestoreInspection(inspected!.inspection, inspected!.path, inspected!.path, false, 'restore-pass')).toBe(false);
  expect(await restoreBackupRequest(inspected!.inspection, inspected!.path, inspected!.path, false, 'restore-pass', fakeIpc)).toBeNull();
  expect(calls).toHaveLength(1);

  await restoreBackupRequest(inspected!.inspection, inspected!.path, inspected!.path, true, 'restore-pass', fakeIpc);
  expect(calls[1]).toEqual({
    command: 'identities_backup_restore_new',
    args: {path: '/backup/rescue.clbak', passphrase: 'restore-pass'},
  });
});

test('verified backup uses verified copy wording and input edits invalidate old and pending inspections', async () => {
  const calls: Array<{command: string; args: Record<string, unknown>}> = [];
  const verified: BackupInspection = {...rescueInspection, verified: true, rescue_copy: false, recovery_pending: false};
  const fakeIpc: BackupInvoke = async <T>(command: string, args: Record<string, unknown>) => {
    calls.push({command, args});
    if (command === 'identities_backup_restore_new') return {path: '/isolated/verified-copy', verified: true, diagnostics: ['staging_cleanup_failed']} as T;
    return verified as T;
  };
  const inspected = await inspectBackupRequest('/backup/verified.clbak', 'passphrase', () => true, fakeIpc);
  expect(inspectionPresentation(inspected!.inspection)).toEqual({
    noticeKey: 'verified',
    confirmationKey: 'restoreConfirmVerified',
    actionKey: 'restoreAction',
  });
  expect(canRestoreInspection(inspected!.inspection, inspected!.path, '/backup/other.clbak', true, 'restore-pass')).toBe(false);
  expect(await restoreBackupRequest(inspected!.inspection, inspected!.path, '/backup/other.clbak', true, 'restore-pass', fakeIpc)).toBeNull();
  expect(calls).toHaveLength(1);
  const restored = await restoreBackupRequest(inspected!.inspection, inspected!.path, inspected!.path, true, 'restore-pass', fakeIpc);
  expect(restored).toMatchObject({verified: true, diagnostics: ['staging_cleanup_failed']});
  expect(calls[1].args.path).toBe('/backup/verified.clbak');

  const waiting = deferred<BackupInspection>();
  let revision = 0;
  const requestRevision = revision;
  const pending = inspectBackupRequest('/backup/old.clbak', 'passphrase', () => revision === requestRevision, async <T>() => waiting.promise as Promise<T>);
  revision++;
  waiting.resolve(rescueInspection);
  expect(await pending).toBeNull();
});
