/**
 * [INPUT]: Local authentication metadata, native wakeup evidence and the current quota window.
 * [OUTPUT]: One short account state, one explanation and truthful manual/recovery admission hints.
 * [POS]: Read-only presentation; a local login never clears server auth, rate limits or unknown requests.
 * [PROTOCOL]: Keep bilingual wakeup.view/localAuth/wait keys and src/CLAUDE.md aligned.
 */
import type {NativeWakeupAccount, OnlineQuotaReason} from './identity-online-quota';

type Translator = (key: string, slots?: Record<string, string | number>) => string;
export function formatWakeupWait(seconds: number, t: Translator): string {
  const remaining = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  if (remaining >= 3600) { const minutes = Math.ceil(remaining / 60); return t('wakeup.waitHoursMinutes', {hours: Math.floor(minutes / 60), minutes: minutes % 60}); }
  if (remaining >= 60) return t('wakeup.waitMinutesSeconds', {minutes: Math.floor(remaining / 60), seconds: remaining % 60});
  return t('wakeup.retryIn', {seconds: remaining});
}

export interface WakeupPresentationInput {
  runtime?: NativeWakeupAccount;
  authStatus?: string | null;
  expired: boolean;
  activeWindow: boolean;
  runningCli: boolean;
  excluded: boolean;
  weeklyBlocked: boolean;
  snapshotReady: boolean;
  storageError: boolean;
  nextGlobalAtMs: number;
  nowMs: number;
}

export function presentWakeupAccount(input: WakeupPresentationInput) {
  const a = input.runtime;
  const localReady = input.authStatus === 'valid';
  const localNeedsUpdate = input.authStatus === 'expired' || input.authStatus === 'refresh_needed';
  const needsVerification = Boolean(a?.authBlocked || a?.capability === 'auth_required' || localNeedsUpdate);
  const granted = Boolean(a?.recoveryAllowed);
  const running = a?.decision === 'running';
  const unknown = Boolean(a?.unknown) && !running;
  // An explicit recovery can release a known auth-only account delay. Display
  // the global/rate-limit budget separately instead of an unavoidable 6h wait.
  const authOnlyDelay = Boolean(a?.authBlocked && a.lastStatus === 'auth_required' && !granted);
  const waitUntilMs = Math.max(input.nextGlobalAtMs, authOnlyDelay ? 0 : a?.backoffUntilMs ?? 0);
  const waiting = waitUntilMs > input.nowMs;
  let block: OnlineQuotaReason | null = null;
  if (!input.snapshotReady || input.storageError) block = 'scheduler_unavailable';
  else if (running) block = 'scheduler_busy';
  else if (unknown) block = 'outcome_unknown';
  else if (input.excluded) block = 'disabled_by_user';
  else if (input.runningCli) block = 'cli_active';
  else if (input.weeklyBlocked) block = 'low_7d_quota';
  else if (a?.capability === 'transport_unsupported') block = 'capability_blocked';
  else if (needsVerification && !granted) block = 'auth_required';
  else if (waiting) block = 'backoff_cooldown';
  else if (!input.expired) block = 'not_expired';

  let state = 'ready';
  let detail = 'ready';
  let tone: 'ok' | 'warn' | 'muted' = 'ok';
  if (input.storageError) { state = detail = 'unavailable'; tone = 'warn'; }
  else if (!input.snapshotReady) { state = detail = 'checking'; tone = 'muted'; }
  else if (running) { state = detail = 'running'; tone = 'muted'; }
  else if (unknown) { state = detail = 'unknown'; tone = 'warn'; }
  else if (input.excluded) { state = detail = 'paused'; tone = 'muted'; }
  else if (input.runningCli) { state = detail = 'cliActive'; }
  else if (input.weeklyBlocked) { state = detail = 'weekly'; tone = 'muted'; }
  else if (a?.capability === 'transport_unsupported') { state = detail = 'unsupported'; tone = 'warn'; }
  else if (needsVerification && !granted) { state = 'verify'; detail = localReady ? 'verifyLocalLogin' : 'verifyLogin'; tone = 'warn'; }
  else if (waiting) { state = detail = 'cooling'; tone = 'muted'; }
  else if (input.activeWindow) { state = detail = 'active'; }
  else if (granted) { state = detail = 'recoveryReady'; }
  else if (a?.decision === 'standby_idle') { state = detail = 'standby'; tone = 'muted'; }
  else if (a?.decision === 'scheduled') { state = detail = 'scheduled'; tone = 'muted'; }
  else if (!input.expired) { state = detail = 'noWindow'; tone = 'muted'; }
  return {
    stateKey: `wakeup.view.state.${state}`,
    detailKey: `wakeup.view.detail.${detail}`,
    localAuthKey: localReady ? 'wakeup.localAuth.available' : localNeedsUpdate ? 'wakeup.localAuth.needsUpdate' : 'wakeup.localAuth.unknown',
    tone, block,
    waitUntilMs: waiting ? waitUntilMs : null,
    canWake: input.expired && block === null,
    canRecover: needsVerification && !unknown && !running && !granted && input.snapshotReady && !input.storageError,
    showRecovery: needsVerification || granted,
    recoveryGranted: granted,
    scheduledAtMs: a?.scheduledAtMs ?? null,
  };
}
