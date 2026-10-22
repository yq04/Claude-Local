import {expect, test} from 'bun:test';
import {buildHandoffMarkdown, emptyHandoffFields, HANDOFF_DOWNLOAD_NAME, HANDOFF_FIELD_LIMIT} from './handoff-model';

const labels = {task: 'Task', goal: 'Goal', progress: 'Progress', next: 'Next', verification: 'Verification', constraints: 'Constraints'};

test('handoff template includes all bounded fields and truthful placeholders', () => {
  const fields = {...emptyHandoffFields(), task: 'Ship palette', progress: 'Changed files only'};
  const markdown = buildHandoffMarkdown(fields, 'Task handoff', labels, 'To be filled in');
  expect(markdown).toContain('## Verification\n\nTo be filled in');
  expect(markdown).toContain('## Progress\n\nChanged files only');
  expect(markdown).toContain('## Constraints');
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
  expect(markdown.split('## Task\n\n')[1].split('\n\n##')[0].length).toBe(HANDOFF_FIELD_LIMIT);
});
