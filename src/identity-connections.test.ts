/**
 * [INPUT]: Synthetic quota targets, outcomes and a process-local history model.
 * [OUTPUT]: Web recovery queue, precise browser failure, CLI separation, subset validation and remount retention checks.
 * [POS]: No Tauri IPC, network, browser, credentials or real identity data.
 * [PROTOCOL]: Keep coverage aligned with src/CLAUDE.md and Phase 5.
 */
import {expect, test} from 'bun:test';
import {
  ConnectionHistory,
  connectionIssueFor,
  describeConnectionIssue,
  isValidQuotaTargetSubset,
  type ConnectionOutcome,
} from './identity-connections';
import type {OnlineQuotaResult, QuotaBatchTarget} from './identity-online-quota';

const target = (account_id: string, fingerprint: string): QuotaBatchTarget => ({account_id, expected_identity: fingerprint.repeat(64)});
const result = (status: OnlineQuotaResult['status'], extra: Partial<OnlineQuotaResult> = {}): OnlineQuotaResult => ({status, ...extra});

test('central queue separates successful accounts from login and route remedies', () => {
  const inventory = [target('a', 'a'), target('b', 'b'), target('c', 'c'), target('d', 'd')];
  const outcomes: ConnectionOutcome[] = [
    {target: inventory[0], result: result('updated', {updated_windows: ['5h'], source: 'oauth'})},
    {target: inventory[1], result: result('cached')},
    {target: inventory[2], result: result('auth_required')},
    {target: inventory[3], result: result('route_unavailable', {reason: 'unsupported_proxy'})},
  ];
  const history = new ConnectionHistory();
  history.merge(inventory, outcomes, inventory);
  const issues = history.matching(inventory).filter(item => connectionIssueFor(item.result));
  expect(issues.map(item => connectionIssueFor(item.result))).toEqual(['login', 'route']);
  expect(history.matching(inventory)).toHaveLength(4);
});

test('valid frozen subset retry preserves successes and failures over panel remounts and OAuth cooldown', () => {
  const inventory = [target('a', 'a'), target('b', 'b'), target('c', 'c'), target('d', 'd')];
  const first = [
    {target: inventory[0], result: result('updated', {updated_windows: ['7d']})},
    {target: inventory[1], result: result('auth_required')},
    {target: inventory[2], result: result('route_unavailable', {reason: 'route_changed'})},
    {target: inventory[3], result: result('cached')},
  ];
  const history = new ConnectionHistory();
  history.merge(inventory, first, inventory);
  const retrySubset = [inventory[1], inventory[2]];
  expect(isValidQuotaTargetSubset(retrySubset, inventory)).toBe(true);
  history.merge(retrySubset, [
    {target: inventory[1], result: result('cooldown', {reason: 'auth_required', retry_scope: 'oauth'})},
  ], inventory);

  // A new panel reads the same in-memory source and keeps all original successes plus retry outcomes.
  const remounted = history.matching(inventory);
  expect(remounted.map(item => item.target.account_id).sort()).toEqual(['a', 'b', 'c', 'd']);
  expect(remounted.find(item => item.target.account_id === 'a')?.result.status).toBe('updated');
  expect(remounted.find(item => item.target.account_id === 'b')?.result.status).toBe('cooldown');
  expect(remounted.find(item => item.target.account_id === 'c')?.result.reason).toBe('route_changed');
  expect(remounted.find(item => item.target.account_id === 'd')?.result.status).toBe('cached');
  expect(connectionIssueFor(remounted.find(item => item.target.account_id === 'b')!.result)).toBe('login');
});

test('subset rejects stale fingerprints, unknown accounts and duplicate account IDs', () => {
  const inventory = [target('a', 'a'), target('b', 'b')];
  expect(isValidQuotaTargetSubset([target('a', 'f')], inventory)).toBe(false);
  expect(isValidQuotaTargetSubset([target('outside', 'c')], inventory)).toBe(false);
  expect(isValidQuotaTargetSubset([inventory[0], inventory[0]], inventory)).toBe(false);
});

test('runtime and transient failures remain actionable without opening a browser', () => {
  expect(connectionIssueFor(result('rate_limited', {retry_scope: 'all'}))).toBe('wait');
  expect(connectionIssueFor(result('cooldown', {retry_scope: 'all'}))).toBe('wait');
  expect(connectionIssueFor(result('unavailable', {runtime_stage: 'probe', runtime_reason: 'missing_dependency'}))).toBe('retry');
  expect(connectionIssueFor(result('network_error'))).toBe('retry');
  expect(connectionIssueFor(result('deadline_exceeded'))).toBe('retry');
  expect(connectionIssueFor(result('cached'))).toBeNull();
});

test('browser failure explains web access and only real quota updates resolve it; wakeup stays separate', () => {
  const inventory = [target('a', 'a')];
  const history = new ConnectionHistory();
  const denied = result('auth_required', {browser_fallback_status: 'web_access_denied'});
  expect(connectionIssueFor(denied)).toBe('browser');
  expect(describeConnectionIssue(denied, 0, key => key)).toBe('quotaOnline.browserFallback.web_access_denied');
  history.merge(inventory, [{target: inventory[0], result: denied}], inventory);
  history.merge(inventory, [{target: inventory[0], result: result('updated', {source: 'browser', updated_windows: []})}], inventory);
  expect(connectionIssueFor(history.snapshot()[0].result)).toBe('browser');
  history.merge(inventory, [{target: inventory[0], result: result('updated', {source: 'browser', updated_windows: ['5h']})}], inventory);
  expect(connectionIssueFor(history.snapshot()[0].result)).toBeNull();
  history.merge(inventory, [{target: inventory[0], result: result('auth_required', {stage: 'scheduler', reason: 'auth_required'})}], inventory);
  expect(connectionIssueFor(history.snapshot()[0].result)).toBeNull();
});
