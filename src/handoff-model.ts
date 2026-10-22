/**
 * [INPUT]: 有界的用户手填交接字段与当前界面语言的固定标题。
 * [OUTPUT]: 稳定 Markdown 预览及固定安全下载文件名，不读取项目或会话数据。
 * [POS]: 手工任务交接模板的纯格式化边界；字段只存在于调用方内存。
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
export const HANDOFF_FIELD_LIMIT = 2000;

export type HandoffFields = {
  task: string;
  goal: string;
  progress: string;
  next: string;
  verification: string;
  constraints: string;
};

export type HandoffLabels = Record<keyof HandoffFields, string>;

export const emptyHandoffFields = (): HandoffFields => ({task: '', goal: '', progress: '', next: '', verification: '', constraints: ''});

function safeBody(value: string, notFilled: string): string {
  const trimmed = value.slice(0, HANDOFF_FIELD_LIMIT).trim();
  if (!trimmed) return notFilled;
  return trimmed.split(/\r?\n/).map(line => line.replace(/^(\s*)(#{1,6})(\s+)/, '$1\\$2$3')).join('\n');
}

export function buildHandoffMarkdown(fields: HandoffFields, title: string, labels: HandoffLabels, notFilled: string): string {
  const sections = (Object.keys(labels) as (keyof HandoffFields)[]).map(field => `## ${labels[field]}\n\n${safeBody(fields[field], notFilled)}`);
  return `# ${title}\n\n${sections.join('\n\n')}`;
}

export const HANDOFF_DOWNLOAD_NAME = 'task-handoff.md';
