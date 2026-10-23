/**
 * [INPUT]: Backup inspection state, reviewed file path, explicit confirmation and an injected native-command caller.
 * [OUTPUT]: Path-bound inspection/restore actions and truthful verified-vs-rescue presentation keys.
 * [POS]: Pure workflow boundary shared by the backup settings UI and fake-IPC tests; performs no filesystem access.
 * [PROTOCOL]: Keep path invalidation and native command arguments aligned with backup-panel.tsx.
 */
export type BackupInspection = {
  saved_identities: number;
  archives: number;
  bytes: number;
  verified: boolean;
  rescue_copy: boolean;
  recovery_pending: boolean;
  diagnostics: string[];
};

export type BackupReceipt = {
  path: string;
  saved_identities: number;
  archives: number;
  bytes?: number;
  verified?: boolean;
  rescue_copy?: boolean;
  active_vault_changed?: boolean;
};

export type BackupInvoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export function inspectionPresentation(inspection: BackupInspection | null) {
  return inspection?.rescue_copy
    ? ({noticeKey: 'rescueVerified', confirmationKey: 'restoreConfirmRescue', actionKey: 'rescueRestoreAction'} as const)
    : ({noticeKey: 'verified', confirmationKey: 'restoreConfirmVerified', actionKey: 'restoreAction'} as const);
}

export function canRestoreInspection(
  inspection: BackupInspection | null,
  inspectedPath: string,
  inputPath: string,
  confirmed: boolean,
  passphrase: string,
) {
  return Boolean(
    inspection
      && (inspection.verified || inspection.rescue_copy)
      && inspectedPath
      && inspectedPath === inputPath.trim()
      && confirmed
      && passphrase,
  );
}

export async function inspectBackupRequest(
  path: string,
  passphrase: string,
  isCurrent: () => boolean,
  invoke: BackupInvoke,
) {
  const inspection = await invoke<BackupInspection>('identities_backup_inspect', {path, passphrase});
  return isCurrent() ? {inspection, path} : null;
}

export async function restoreBackupRequest(
  inspection: BackupInspection | null,
  inspectedPath: string,
  inputPath: string,
  confirmed: boolean,
  passphrase: string,
  invoke: BackupInvoke,
) {
  if (!canRestoreInspection(inspection, inspectedPath, inputPath, confirmed, passphrase)) return null;
  return invoke<BackupReceipt>('identities_backup_restore_new', {path: inspectedPath, passphrase});
}
