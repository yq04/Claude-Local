// [INPUT]: Synthetic aggregate snapshots with hostile spreadsheet text and Markdown summary payloads.
// [OUTPUT]: Privacy/formula/TSV escaping and Markdown summary export regressions.
// [POS]: Pure export contract tests; no live account data or clipboard access.
// [PROTOCOL]: Keep export scope limited to current aggregate data.
import {expect, test} from 'bun:test';
import {buildUsageTsv, formatUsageMarkdownSummary} from './usage-export';
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

test('formatUsageMarkdownSummary formats clean bilingual Markdown and masks emails when privacyMask is true', () => {
  const totals = {
    ...emptyUsage(),
    total_tokens: 12_340_000,
    input_tokens: 800_000,
    output_tokens: 440_000,
    cache_creation_tokens: 1_100_000,
    cache_read_tokens: 10_000_000,
    requests: 250,
  };
  const snapshot: UsageSnapshot = {
    generated_at: 1_800_000_000,
    tracking_since: 1_790_000_000,
    totals,
    unattributed: emptyUsage(),
    accounts: [{id: 'acc-1', name: 'alice.smith@example.com', email: 'alice.smith@example.com', current: true, totals}],
    daily: [],
    models: [
      {model: 'claude-opus-4-7', totals: {...totals, total_tokens: 9_000_000}},
      {model: 'claude-sonnet-4-6', totals: {...totals, total_tokens: 3_340_000}},
    ],
    warnings: [],
  };

  const maskedZh = formatUsageMarkdownSummary(snapshot, {
    period: 'week',
    periodLabel: '7 天',
    rangeLabel: '2026年10月25日 – 2026年10月31日',
    accountId: 'acc-1',
    accountLabel: 'alice.smith@example.com',
    accountIsAll: false,
    timezone: 'America/Los_Angeles',
    privacyMask: true,
    locale: 'zh',
  });

  expect(maskedZh).toContain('### Claude-Local 用量统计简报');
  expect(maskedZh).not.toContain('alice.smith@example.com');
  expect(maskedZh).toContain('ali***@example.com');
  expect(maskedZh).toContain('**单次均值**：49.4K tok/次');
  expect(maskedZh).toContain('/次）');
  expect(maskedZh).toContain('claude-opus-4-7');
  expect(maskedZh).toContain('claude-sonnet-4-6');
  expect(maskedZh).toContain('| 模型 | Token | 占比 | 等效花费 |');

  const unmaskedEn = formatUsageMarkdownSummary(snapshot, {
    period: 'week',
    periodLabel: '7 days',
    rangeLabel: 'Oct 25, 2026 – Oct 31, 2026',
    accountId: 'acc-1',
    accountLabel: 'alice.smith@example.com',
    accountIsAll: false,
    timezone: 'America/Los_Angeles',
    privacyMask: false,
    locale: 'en',
  });

  expect(unmaskedEn).toContain('### Claude-Local Usage Summary');
  expect(unmaskedEn).toContain('alice.smith@example.com');
  expect(unmaskedEn).toContain('**Avg/Req**: 49.4K tok/req');
  expect(unmaskedEn).toContain('/req)');
  expect(unmaskedEn).toContain('| Model | Tokens | Share | Est. Cost |');
});

test('TSV export includes estimated_cost_usd and cache_savings_usd in summary and accounts sections', () => {
  const totals = {
    ...emptyUsage(),
    input_tokens: 1_000_000,
    output_tokens: 500_000,
    cache_creation_tokens: 2_000_000,
    cache_read_tokens: 10_000_000,
    total_tokens: 13_500_000,
    requests: 100,
  };
  const snapshot: UsageSnapshot = {
    generated_at: 1_800_000_000,
    tracking_since: 1_790_000_000,
    totals,
    unattributed: emptyUsage(),
    accounts: [
      {
        id: 'acc-1',
        name: 'alice.smith@example.com',
        email: 'alice.smith@example.com',
        current: true,
        totals,
      },
    ],
    daily: [],
    models: [{model: 'claude-opus-5-5', totals}],
    warnings: [],
  };
  const labels = {
    metadata: 'metadata',
    summary: '# summary',
    daily: '# daily',
    time: 'time',
    total: 'total',
    input: 'input',
    output: 'output',
    cacheWrite: 'cacheWrite',
    cacheRead: 'cacheRead',
    requests: 'requests',
    account: 'account',
    period: 'period',
    timezone: 'timezone',
    generated: 'generated',
    coverage: 'coverage',
  };
  const tsv = buildUsageTsv({
    snapshot,
    period: 'week',
    periodLabel: '7 days',
    accountLabel: 'All',
    accountIsAll: true,
    timezone: 'UTC',
    privacy: true,
    days: [],
    generatedLabel: 'now',
    coverageLabel: 'scope',
    productLabel: 'Claude-Local',
    labels,
  });

  expect(tsv).toContain('requests\testimated_cost_usd\tcache_savings_usd');
  expect(tsv).toContain('100\t26.0000\t38.0000');
  expect(tsv).toContain('# accounts\taccount\ttotal\tinput\toutput\tcacheWrite\tcacheRead\trequests\testimated_cost_usd\tcache_savings_usd');
  expect(tsv).toContain('# accounts\tali***@example.com\t13500000\t1000000\t500000\t2000000\t10000000\t100\t26.0000\t38.0000');
  expect(tsv).not.toContain('alice.smith@example.com');
});
