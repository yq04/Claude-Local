// [INPUT]: Onboarding contracts and fault navigation route metadata in bilingual catalogs.
// [OUTPUT]: Pure catalog and presentation model contract assertions; does not execute live clipboard or native navigation.
// [POS]: Focused contract tests for CLI first-use and residue fault navigation strings.
// [PROTOCOL]: Keep tests fast, pure and independent.
import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';

const zh = parse(readFileSync('src/locales/zh.yaml', 'utf8'));
const en = parse(readFileSync('src/locales/en.yaml', 'utf8'));

test('CLI missing, recheck and installation guidance keys exist in both locales', () => {
  const requiredCliKeys = [
    'cli.installGuide',
    'cli.installCommand',
    'cli.copyInstall',
    'cli.copiedInstall',
    'cli.copyFailed',
    'cli.recheck',
    'cli.officialWindows',
  ];
  for (const key of requiredCliKeys) {
    expect(zh[key]).toBeDefined();
    expect(en[key]).toBeDefined();
    expect(zh[key].length).toBeGreaterThan(0);
    expect(en[key].length).toBeGreaterThan(0);
  }
});

test('fault navigation card keys and troubleshooting help exist in both locales', () => {
  const requiredFaultKeys = [
    'quick.troubleshootCard',
    'quick.troubleshootHint',
    'quick.troubleshootAction',
    '排障与缓存清理',
    'identitySafety.troubleshootHelp',
  ];
  for (const key of requiredFaultKeys) {
    expect(zh[key]).toBeDefined();
    expect(en[key]).toBeDefined();
    expect(zh[key].length).toBeGreaterThan(0);
    expect(en[key].length).toBeGreaterThan(0);
  }
});

test('browser transition descriptions truthfully reflect reopen vs closed behavior', () => {
  expect(zh['运行中的关联浏览器会自动重开，未启动则保持关闭；请先保存网页任务。']).toContain('未启动则保持关闭');
  expect(en['运行中的关联浏览器会自动重开，未启动则保持关闭；请先保存网页任务。']).toContain('closed');
  expect(zh['运行中的浏览器会自动重开，未启动则保持关闭；请先保存网页任务。']).toContain('未启动则保持关闭');
  expect(en['运行中的浏览器会自动重开，未启动则保持关闭；请先保存网页任务。']).toContain('closed');
});

test('unsupported proxy description accurately restricts to unauthenticated HTTP CONNECT only', () => {
  expect(zh['quotaOnline.reason.unsupportedProxy']).toContain('http://');
  expect(zh['quotaOnline.reason.unsupportedProxy']).toContain('CONNECT');
  expect(zh['quotaOnline.reason.unsupportedProxy']).toContain('暂不支持');
  expect(en['quotaOnline.reason.unsupportedProxy']).toContain('http://');
  expect(en['quotaOnline.reason.unsupportedProxy']).toContain('CONNECT');
  expect(en['quotaOnline.reason.unsupportedProxy']).toContain('not supported');

  expect(zh['quotaOnline.status.notRun']).toBe('本次尚未执行查询');
});
