/**
 * [INPUT]: Frozen account/fingerprint quota outcomes and explicit user actions.
 * [OUTPUT]: A centralized, account-bound connection and route-repair queue with a unified subset retry.
 * [POS]: Identity recovery UI and in-memory history; never reads credentials or selects global CLI/browser state.
 * [PROTOCOL]: Keep bilingual additions in p5-i18n.json and tests synthetic-only.
 */
import {Button} from 'cromma-ui';
import {formatOnlineQuotaStatus, type OnlineQuotaResult, type QuotaBatchTarget} from './identity-online-quota';

export interface ConnectionOutcome {
  target: QuotaBatchTarget;
  result: OnlineQuotaResult;
}

export type ConnectionIssue = 'login' | 'route' | 'wait' | 'retry';

export function isValidQuotaTargetSubset(
  subset: QuotaBatchTarget[],
  inventory: QuotaBatchTarget[]
): boolean {
  if (subset.length === 0) return false;
  const seen = new Set<string>();
  return subset.every(target => {
    if (!target || !/^[0-9a-f]{64}$/i.test(target.expected_identity) || seen.has(target.account_id)) return false;
    seen.add(target.account_id);
    return inventory.some(current => current.account_id === target.account_id &&
      current.expected_identity.toLowerCase() === target.expected_identity.toLowerCase());
  });
}

export function connectionIssueFor(result: OnlineQuotaResult): ConnectionIssue | null {
  if (result.status === 'auth_required' || result.reason === 'auth_required' ||
      (result.status === 'cooldown' && result.retry_scope === 'oauth')) return 'login';
  if (result.status === 'route_unavailable' || result.reason === 'unsupported_proxy' || result.reason === 'route_changed') return 'route';
  if (result.status === 'cooldown' || result.status === 'rate_limited') return 'wait';
  if (result.runtime_reason || ['network_error', 'unavailable', 'invalid_response', 'deadline_exceeded'].includes(result.status)) return 'retry';
  return null;
}

export function describeConnectionIssue(
  result: OnlineQuotaResult,
  nowMs: number,
  t: (key: string, slots?: Record<string, string | number>) => string
): string {
  const issue = connectionIssueFor(result);
  const status = formatOnlineQuotaStatus(result, nowMs, t).message;
  if (issue === 'login') return `${t('quotaOnline.connection.login')} ${status}`;
  if (issue === 'route') return `${status} ${t('quotaOnline.connection.routeHelp')}`;
  if (issue === 'wait') return `${status} ${t('quotaOnline.connection.waitHelp')}`;
  if (issue === 'retry') return `${status} ${t('quotaOnline.connection.retryHelp')}`;
  return status;
}

export function mergeConnectionOutcomes(
  previous: ConnectionOutcome[],
  batchTargets: QuotaBatchTarget[],
  incoming: ConnectionOutcome[],
  currentInventory: QuotaBatchTarget[]
): ConnectionOutcome[] {
  if (!isValidQuotaTargetSubset(batchTargets, currentInventory)) return previous;
  const batchById = new Map(batchTargets.map(target => [target.account_id, target]));
  const next = new Map(previous.map(item => [item.target.account_id, item]));
  for (const item of incoming) {
    const frozen = batchById.get(item.target.account_id);
    if (!frozen || frozen.expected_identity.toLowerCase() !== item.target.expected_identity.toLowerCase()) continue;
    if (!currentInventory.some(target => target.account_id === frozen.account_id &&
        target.expected_identity.toLowerCase() === frozen.expected_identity.toLowerCase())) continue;
    // Cancellation and queue omissions carry no new account evidence; keep the prior outcome.
    if (item.result.status === 'cancelled' || item.result.status === 'not_run') continue;
    next.set(item.target.account_id, {target: {...frozen}, result: item.result});
  }
  return Array.from(next.values()).filter(item => currentInventory.some(target =>
    target.account_id === item.target.account_id &&
    target.expected_identity.toLowerCase() === item.target.expected_identity.toLowerCase()));
}

/** Process-local history survives IdentityPanel unmount/remount without persisting account metadata. */
export class ConnectionHistory {
  private outcomes: ConnectionOutcome[] = [];

  snapshot(): ConnectionOutcome[] {
    return this.outcomes.map(item => ({target: {...item.target}, result: {...item.result}}));
  }

  merge(batchTargets: QuotaBatchTarget[], incoming: ConnectionOutcome[], inventory: QuotaBatchTarget[]): void {
    this.outcomes = mergeConnectionOutcomes(this.outcomes, batchTargets, incoming, inventory).slice(-256);
  }

  matching(inventory: QuotaBatchTarget[]): ConnectionOutcome[] {
    return this.snapshot().filter(item => inventory.some(target =>
      target.account_id === item.target.account_id &&
      target.expected_identity.toLowerCase() === item.target.expected_identity.toLowerCase()));
  }
}

export const connectionHistory = new ConnectionHistory();

export interface IdentityConnectionItem extends ConnectionOutcome {
  label: string;
}

export function IdentityConnections({
  items,
  busy,
  t,
  onOpen,
  onRetry,
}: {
  items: IdentityConnectionItem[];
  busy: boolean;
  t: (key: string, slots?: Record<string, string | number>) => string;
  onOpen: (target: QuotaBatchTarget) => void;
  onRetry: (targets: QuotaBatchTarget[]) => void;
}) {
  const pending = items.filter(item => connectionIssueFor(item.result));
  if (pending.length === 0) return null;
  return (
    <section className="identity-connection-queue" aria-labelledby="identity-connection-title">
      <div className="identity-connection-heading">
        <div>
          <h3 id="identity-connection-title">{t('quotaOnline.connectionQueue')}</h3>
          <p>{t('quotaOnline.connectionQueueHint', {count: pending.length})}</p>
        </div>
        {pending.length > 0 && (
          <Button variant="secondary" size="small" disabled={busy} loading={busy}
            onClick={() => onRetry(pending.map(item => item.target))}>
            {t('quotaOnline.retryPending', {count: pending.length})}
          </Button>
        )}
      </div>
      <ul>
        {pending.map(item => {
          const issue = connectionIssueFor(item.result);
          return (
            <li key={item.target.account_id} data-connection-issue={issue ?? 'resolved'}>
              <span className="identity-connection-account">{item.label}</span>
              <span>{describeConnectionIssue(item.result, Date.now(), t)}</span>
              {issue === 'login' && (
                <Button variant="secondary" size="small" disabled={busy}
                  onClick={() => onOpen(item.target)}>
                  {t('quotaOnline.openAccountBrowser')}
                </Button>
              )}
              {issue === 'route' && <span>{t('quotaOnline.connection.routeHelp')}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
