// [INPUT]: Synthetic aggregate snapshots with hostile spreadsheet text.
// [OUTPUT]: Privacy/formula/TSV escaping export regressions.
// [POS]: Pure export contract tests; no live account data or clipboard access.
// [PROTOCOL]: Keep export scope limited to current aggregate data.
import {expect, test} from 'bun:test';
import {buildUsageTsv} from './usage-export';
import {emptyUsage, type UsageSnapshot} from './usage-model';

test('TSV export carries aggregates while escaping cells and neutralizing formula prefixes', () => {
  const totals = {...emptyUsage(), total_tokens: 20, requests: 2};
  const snapshot: UsageSnapshot = {generated_at: 1_800_000_000, tracking_since: 1_700_000_000, totals, unattributed: emptyUsage(), accounts: [], daily: [], models: [], warnings: []};
  const labels = Object.fromEntries(['metadata','summary','daily','time','total','input','output','cacheWrite','cacheRead','requests','account','period','timezone','generated','coverage'].map(key => [key, key])) as never;
  const scoped = {...snapshot, unattributed: {...emptyUsage(), total_tokens: 987654, reasoning_tokens: 123456}};
  const text = buildUsageTsv({snapshot: scoped, period: 'today', periodLabel: 'today', accountLabel: '=private@example.test', accountIsAll: false, timezone: 'America/New_York', privacy: true, days: [{day: '2026-11-01T01:00-04:00', start_at: 1, end_at: 2, totals}, {day: 'FUTURE_SLOT_SENTINEL', future: true, totals: {...emptyUsage(), total_tokens: 654321}}], generatedLabel: 'now', coverageLabel: '=coverage', productLabel: 'Claude-Local', labels});
  expect(text).toContain("'=coverage");
  expect(text).toContain('2026-11-01T01:00-04:00');
  expect(text).toContain('20');
  expect(text).not.toContain('private@example.test');
  expect(text).not.toContain('987654');
  expect(text).not.toContain('123456');
  expect(text).not.toContain('FUTURE_SLOT_SENTINEL');
  expect(text).not.toContain('654321');
});

test('TSV quotes tabs, newlines and quotes in fields', () => {
  const totals = emptyUsage();
  const snapshot: UsageSnapshot = {generated_at: 1, tracking_since: null, totals, unattributed: totals, accounts: [], daily: [], models: [], warnings: []};
  const labels = Object.fromEntries(['metadata','summary','daily','time','total','input','output','cacheWrite','cacheRead','requests','account','period','timezone','generated','coverage'].map(key => [key, 'x'])) as never;
  const text = buildUsageTsv({snapshot, period: 'today', periodLabel: 'today', accountLabel: 'all', accountIsAll: true, timezone: 'UTC', privacy: false, days: [], generatedLabel: 'a\tb"c\nd', coverageLabel: 'x', productLabel: 'x', labels});
  expect(text).toContain('"a\tb""c\nd"');
});

test('recorded activity and ordinary account scopes preserve privacy and missing legacy values', () => {
  const totals = {...emptyUsage(), requests: 12, sessions: 3};
  const snapshot: UsageSnapshot = {generated_at: 1, tracking_since: null, totals, unattributed: totals, accounts: [], daily: [], models: [], warnings: [], activity: {sessions: 3, active_days: 2}};
  const labels = {metadata:'metadata', summary:'summary', daily:'daily', time:'time', total:'total', input:'input', output:'output', cacheWrite:'cacheWrite', cacheRead:'cacheRead', requests:'requests', sessions:'sessions', activeDays:'activeDays', account:'account', period:'period', timezone:'timezone', generated:'generated', coverage:'coverage'};
  const options = {snapshot, period: 'all' as const, periodLabel: 'all', accountLabel: 'Alpha workspace', accountIsAll: false, timezone: 'UTC', privacy: false, days: [], generatedLabel: 'now', coverageLabel: 'scope', productLabel: 'x', labels};
  const exported = buildUsageTsv(options);
  expect(exported).toContain('requests\tsessions\tactiveDays');
  expect(exported).toContain('Alpha workspace\t0\t0\t0\t0\t0\t12\t3\t2');
  expect(buildUsageTsv({...options, privacy: true})).not.toContain('Alpha workspace');
  const legacy = buildUsageTsv({...options, snapshot: {...snapshot, totals: {...emptyUsage(), requests: 12}, activity: undefined}});
  expect(legacy).toContain('Alpha workspace\t0\t0\t0\t0\t0\t12\t\t');
});
