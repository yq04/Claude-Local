/**
 * [INPUT]: Synthetic local auth, historical server failures and native budgets.
 * [OUTPUT]: Distinct local-login/server-verification states and meaningful admission/countdown checks.
 * [POS]: Pure presentation regression; no credentials, native commands or network.
 */
import {expect, test} from 'bun:test';
import {defaultAccountWakeupRuntime, type NativeWakeupAccount} from './identity-online-quota';
import {formatWakeupWait, presentWakeupAccount, type WakeupPresentationInput} from './wakeup-presentation';

const now = 1_800_000_000_000;
const runtime = (): NativeWakeupAccount => ({...defaultAccountWakeupRuntime(), decision: '', capability: '', unknown: false, authBlocked: false, recoveryAllowed: false});
const input = (): WakeupPresentationInput => ({runtime: runtime(), authStatus: 'valid', expired: true, activeWindow: false, runningCli: false, excluded: false, weeklyBlocked: false, snapshotReady: true, storageError: false, nextGlobalAtMs: 0, nowMs: now});

test('local login is available while an old server auth failure awaits explicit verification', () => {
  const row = input();
  Object.assign(row.runtime!, {authBlocked: true, lastStatus: 'auth_required', backoffUntilMs: now + 6 * 3600_000});
  const view = presentWakeupAccount(row);
  expect(view.localAuthKey).toBe('wakeup.localAuth.available');
  expect(view.stateKey).toBe('wakeup.view.state.verify');
  expect(view.detailKey).toBe('wakeup.view.detail.verifyLocalLogin');
  expect(view.canRecover).toBe(true);
  expect(view.canWake).toBe(false);
  expect(view.waitUntilMs).toBeNull();
  row.runtime!.recoveryAllowed = true;
  row.runtime!.backoffUntilMs = null;
  expect(presentWakeupAccount(row)).toMatchObject({canWake: true, recoveryGranted: true, canRecover: false, stateKey: 'wakeup.view.state.recoveryReady'});
});

test('recovery never conceals rate limits, global spacing or an uncertain request', () => {
  const row = input();
  Object.assign(row.runtime!, {authBlocked: true, recoveryAllowed: true, lastStatus: 'rate_limited', backoffUntilMs: now + 2 * 3600_000});
  row.nextGlobalAtMs = now + 60_000;
  expect(presentWakeupAccount(row)).toMatchObject({canWake: false, stateKey: 'wakeup.view.state.cooling', waitUntilMs: now + 2 * 3600_000});
  row.runtime!.unknown = true;
  expect(presentWakeupAccount(row)).toMatchObject({block: 'outcome_unknown', canRecover: false, canWake: false});
  const t = (key: string, slots?: Record<string, string | number>) => `${key}:${JSON.stringify(slots)}`;
  expect(formatWakeupWait(9991, t)).toBe('wakeup.waitHoursMinutes:{"hours":2,"minutes":47}');
  expect(formatWakeupWait(7199, t)).toBe('wakeup.waitHoursMinutes:{"hours":2,"minutes":0}');
  expect(formatWakeupWait(61, t)).toBe('wakeup.waitMinutesSeconds:{"minutes":1,"seconds":1}');
});

test('a ready local account does not remain unknown when automatic dispatch is disabled', () => {
  const row = input();
  expect(presentWakeupAccount(row)).toMatchObject({stateKey: 'wakeup.view.state.ready', canWake: true});
  row.activeWindow = true; row.expired = false;
  expect(presentWakeupAccount(row)).toMatchObject({stateKey: 'wakeup.view.state.active', canWake: false});
  row.snapshotReady = false;
  expect(presentWakeupAccount(row)).toMatchObject({stateKey: 'wakeup.view.state.checking', canWake: false, canRecover: false});
  row.storageError = true;
  expect(presentWakeupAccount(row)).toMatchObject({stateKey: 'wakeup.view.state.unavailable', canWake: false, canRecover: false});
});
