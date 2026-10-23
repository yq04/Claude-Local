// [INPUT]: Synthetic attribution configs, account fixtures and privacy flags.
// [OUTPUT]: Masked labels, scope previews, DST hour detectors and IANA timezone format regressions.
// [POS]: Pure attribution model unit tests; no live database, tauri IPC or credential files.
// [PROTOCOL]: Keep unit tests fast, pure and independent.
import {expect, test} from 'bun:test';
import {formatTimezoneContext, getDstDayType, maskAccountLabel, previewAttributionScope} from './usage-attribution';

test('maskAccountLabel masks email when privacyMask is true and leaves name intact when false', () => {
  const account = {id: 'acc1', name: 'Primary Account', email: 'alice@example.com'};
  expect(maskAccountLabel(account, false)).toBe('Primary Account');
  expect(maskAccountLabel(account, true)).toBe('Primary Account (al***@example.com)');

  const shortEmail = {id: 'acc2', name: 'Dev', email: 'me@example.org'};
  expect(maskAccountLabel(shortEmail, true)).toBe('Dev (m***@example.org)');

  const noEmail = {id: 'acc3', name: 'Local Account', email: null};
  expect(maskAccountLabel(noEmail, true)).toBe('Local Account');

  // Synthetic cases: email as name, single-char local part, and empty local part
  const emailAsName = {id: 'acc4', name: 'bob@example.com', email: 'bob@example.com'};
  expect(maskAccountLabel(emailAsName, true)).toBe('b***@example.com');

  const emailAsNameNoEmail = {id: 'acc5', name: 'carol@example.com', email: null};
  expect(maskAccountLabel(emailAsNameNoEmail, true)).toBe('ca***@example.com');

  const singleCharLocal = {id: 'acc6', name: 'Dev X', email: 'x@example.org'};
  expect(maskAccountLabel(singleCharLocal, true)).toBe('Dev X (*@example.org)');

  const emptyLocal = {id: 'acc7', name: 'Broken', email: '@example.org'};
  expect(maskAccountLabel(emptyLocal, true)).toBe('Broken (***@example.org)');
});

test('previewAttributionScope calculates target scope and reports current fallback status', () => {
  const accounts = [
    {id: '0192e2b3aaaa70008000000000000001', name: 'Work'},
    {id: '0192e2b3bbbb70008000000000000002', name: 'Personal'},
  ];
  const config = {
    fallback_account_id: '0192e2b3aaaa70008000000000000001',
    fallback_account_name: 'Work',
    unassigned_requests: 12,
    unassigned_tokens: 34567,
  };

  const previewWork = previewAttributionScope(config, '0192e2b3aaaa70008000000000000001', accounts);
  expect(previewWork).toEqual({
    targetId: '0192e2b3aaaa70008000000000000001',
    targetName: 'Work',
    requests: 12,
    tokens: 34567,
    isCurrent: true,
  });

  const previewPersonal = previewAttributionScope(config, '0192e2b3bbbb70008000000000000002', accounts);
  expect(previewPersonal).toEqual({
    targetId: '0192e2b3bbbb70008000000000000002',
    targetName: 'Personal',
    requests: 12,
    tokens: 34567,
    isCurrent: false,
  });

  expect(previewAttributionScope(config, 'nonexistent', accounts)).toBeNull();
  expect(previewAttributionScope(undefined, '0192e2b3aaaa70008000000000000001', accounts)).toBeNull();
});

test('getDstDayType identifies 23h and 25h real-hourly days and ignores normal 24h days', () => {
  const makeSlots = (count: number) =>
    Array.from({length: count}, (_, i) => ({
      day: '2026-11-01T' + String(i).padStart(2, '0') + ':00',
      start_at: 1000 + i * 3600,
      end_at: 1000 + (i + 1) * 3600,
    }));

  expect(getDstDayType(makeSlots(24))).toBeNull();
  expect(getDstDayType(makeSlots(23))).toBe('23h');
  expect(getDstDayType(makeSlots(25))).toBe('25h');
  expect(getDstDayType([{day: '2026-10-23'}])).toBeNull();
});

test('formatTimezoneContext formats IANA timezone and falls back to UTC offset', () => {
  const fixedDate = new Date(2026, 6, 15, 12, 0, 0); // July (EDT)
  const ny = formatTimezoneContext('America/New_York', fixedDate);
  expect(ny).toContain('America/New_York');

  const offsetResult = formatTimezoneContext(undefined, fixedDate);
  expect(offsetResult).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
});
