import {expect, test} from 'bun:test';
import {
  buildHandoffMarkdown,
  emptyHandoffFields,
  HANDOFF_DOWNLOAD_NAME,
  HANDOFF_FIELD_LIMIT,
  HANDOFF_MAX_FILE_BYTES,
  HANDOFF_VERSION_MARKER,
  isDraftNonEmpty,
  parseHandoffMarkdown,
  type HandoffFields,
} from './handoff-model';

const labels = {task: 'Task', goal: 'Goal', progress: 'Progress', next: 'Next', verification: 'Verification', constraints: 'Constraints'};
const zhLabels = {task: '任务', goal: '目标', progress: '当前进展与验证状态', next: '下一步', verification: '验证状态与未覆盖项', constraints: '约束与已定决策'};

test('handoff template includes all bounded fields and truthful placeholders', () => {
  const fields = {...emptyHandoffFields(), task: 'Ship palette', progress: 'Changed files only'};
  const markdown = buildHandoffMarkdown(fields, 'Task handoff', labels, 'To be filled in');
  expect(markdown).toContain(HANDOFF_VERSION_MARKER);
  expect(markdown).toContain('## Verification <!-- handoff:verification -->\n\nTo be filled in');
  expect(markdown).toContain('## Progress <!-- handoff:progress -->\n\nChanged files only');
  expect(markdown).toContain('## Constraints <!-- handoff:constraints -->');
});

test('multiline user headings cannot become template section headings and download name is fixed', () => {
  const fields = {...emptyHandoffFields(), goal: 'First line\n## Forged section'};
  const markdown = buildHandoffMarkdown(fields, 'Task handoff', labels, 'To be filled in');
  expect(markdown).toContain('First line\n\\## Forged section');
  expect(HANDOFF_DOWNLOAD_NAME).toBe('task-handoff.md');
});

test('field model applies a per-field output limit', () => {
  const fields = {...emptyHandoffFields(), task: 'x'.repeat(HANDOFF_FIELD_LIMIT + 20)};
  const markdown = buildHandoffMarkdown(fields, 'Task handoff', labels, 'To be filled in');
  expect(markdown.split('## Task <!-- handoff:task -->\n\n')[1].split('\n\n##')[0].length).toBe(HANDOFF_FIELD_LIMIT);
});

test('roundtrip preserves all fields stably across english and chinese exports', () => {
  const initial: HandoffFields = {
    task: 'Upgrade quota pipeline',
    goal: 'Eliminate flaky background polls',
    progress: 'Phase 0 through 4 complete\nVerified in pwsh7',
    next: 'Integrate handoff import review',
    verification: 'Synthetic tests green',
    constraints: 'No network access; 64KiB cap',
  };

  const enMarkdown = buildHandoffMarkdown(initial, 'Task handoff template', labels, 'To be filled in');
  const parsedEn = parseHandoffMarkdown(enMarkdown);
  expect(parsedEn.ok).toBe(true);
  if (parsedEn.ok) {
    expect(parsedEn.version).toBe('v1');
    expect(parsedEn.fields).toEqual(initial);
  }

  const zhMarkdown = buildHandoffMarkdown(initial, '任务交接模板', zhLabels, '待补充');
  const parsedZh = parseHandoffMarkdown(zhMarkdown);
  expect(parsedZh.ok).toBe(true);
  if (parsedZh.ok) {
    expect(parsedZh.version).toBe('v1');
    expect(parsedZh.fields).toEqual(initial);
  }
});

test('roundtrip restores unescaped headings and maps truthful placeholders to empty fields', () => {
  const initial: HandoffFields = {
    ...emptyHandoffFields(),
    task: '## Heading in task\n### Subheading',
    goal: 'Goal note',
  };
  const exported = buildHandoffMarkdown(initial, 'Handoff', labels, 'To be filled in');
  const parsed = parseHandoffMarkdown(exported);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(parsed.fields.task).toBe('## Heading in task\n### Subheading');
    expect(parsed.fields.goal).toBe('Goal note');
    expect(parsed.fields.progress).toBe('');
    expect(parsed.fields.next).toBe('');
    expect(parsed.fields.verification).toBe('');
    expect(parsed.fields.constraints).toBe('');
  }
});

test('handoff export and import preserve literal backslashes before Markdown headings', () => {
  const initial = {...emptyHandoffFields(), next: String.raw`\## Keep the literal escape
\\### Keep both escapes
  \# Indented escaped heading`};
  const parsed = parseHandoffMarkdown(buildHandoffMarkdown(initial, 'Handoff', labels, 'To be filled in'));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.fields.next).toBe(initial.next);
});

test('strict parse rejects empty content and oversized files', () => {
  expect(parseHandoffMarkdown('')).toEqual({ok: false, errorKey: 'emptyFile'});
  expect(parseHandoffMarkdown('   \n\t  ')).toEqual({ok: false, errorKey: 'emptyFile'});

  const huge = 'a'.repeat(HANDOFF_MAX_FILE_BYTES + 1);
  expect(parseHandoffMarkdown(huge)).toEqual({ok: false, errorKey: 'fileTooLarge'});
});

test('strict parse rejects unsupported template versions', () => {
  const unsupported = `<!-- claude-local:task-handoff:v2 -->\n# Task handoff\n\n## Task <!-- handoff:task -->\n\nDo work`;
  expect(parseHandoffMarkdown(unsupported)).toEqual({ok: false, errorKey: 'unsupportedVersion'});
});

test('strict parse rejects duplicate fields in template', () => {
  const duplicate = `${HANDOFF_VERSION_MARKER}\n# Title\n\n## Task <!-- handoff:task -->\n\nFirst\n\n## Task <!-- handoff:task -->\n\nSecond`;
  expect(parseHandoffMarkdown(duplicate)).toEqual({ok: false, errorKey: 'duplicateField', detail: 'task'});
});

test('strict parse rejects fields exceeding 2000 characters', () => {
  const oversizeContent = 'y'.repeat(HANDOFF_FIELD_LIMIT + 1);
  const template = `${HANDOFF_VERSION_MARKER}\n# Title\n\n## Task <!-- handoff:task -->\n\n${oversizeContent}`;
  expect(parseHandoffMarkdown(template)).toEqual({ok: false, errorKey: 'oversizeField', detail: 'task'});
});

test('strict parse rejects arbitrary unknown markdown without recognized sections', () => {
  const readme = `# My Project\n\n## Installation\n\nRun npm install\n\n## Usage\n\nRun npm start`;
  expect(parseHandoffMarkdown(readme).ok).toBe(false);
  expect(parseHandoffMarkdown(readme)).toEqual({ok: false, errorKey: 'unknownTemplate', detail: 'Installation'});
});

test('legacy export without version markers parses correctly from known english and chinese labels', () => {
  const legacyEn = `# Task handoff template\n\n## Task\n\nLegacy task\n\n## Goal\n\nLegacy goal\n\n## Current progress and verification\n\nLegacy progress\n\n## Next steps\n\nLegacy next\n\n## Verification and unchecked items\n\nTo be filled in\n\n## Constraints and decisions\n\nLegacy constraints`;
  const parsedEn = parseHandoffMarkdown(legacyEn);
  expect(parsedEn.ok).toBe(true);
  if (parsedEn.ok) {
    expect(parsedEn.version).toBe('legacy');
    expect(parsedEn.fields.task).toBe('Legacy task');
    expect(parsedEn.fields.goal).toBe('Legacy goal');
    expect(parsedEn.fields.progress).toBe('Legacy progress');
    expect(parsedEn.fields.next).toBe('Legacy next');
    expect(parsedEn.fields.verification).toBe('');
    expect(parsedEn.fields.constraints).toBe('Legacy constraints');
  }

  const legacyZh = `# 任务交接模板\n\n## 任务\n\n旧版任务\n\n## 目标\n\n旧版目标\n\n## 当前进展与验证状态\n\n旧版进度\n\n## 下一步\n\n旧版下一步\n\n## 验证状态与未覆盖项\n\n待补充\n\n## 约束与已定决策\n\n旧版约束`;
  const parsedZh = parseHandoffMarkdown(legacyZh);
  expect(parsedZh.ok).toBe(true);
  if (parsedZh.ok) {
    expect(parsedZh.version).toBe('legacy');
    expect(parsedZh.fields.task).toBe('旧版任务');
    expect(parsedZh.fields.goal).toBe('旧版目标');
    expect(parsedZh.fields.progress).toBe('旧版进度');
    expect(parsedZh.fields.next).toBe('旧版下一步');
    expect(parsedZh.fields.verification).toBe('');
    expect(parsedZh.fields.constraints).toBe('旧版约束');
  }
});

test('isDraftNonEmpty detects whether any field has non-whitespace content', () => {
  expect(isDraftNonEmpty(emptyHandoffFields())).toBe(false);
  expect(isDraftNonEmpty({...emptyHandoffFields(), task: '   '})).toBe(false);
  expect(isDraftNonEmpty({...emptyHandoffFields(), goal: 'Real goal'})).toBe(true);
});
