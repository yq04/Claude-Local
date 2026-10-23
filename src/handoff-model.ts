/**
 * [INPUT]: 有界的用户手填交接字段与当前界面语言的固定标题。
 * [OUTPUT]: 稳定 Markdown 预览、双语往返模板解析与安全下载文件名，不读取项目或会话数据。
 * [POS]: 手工任务交接模板的纯格式化与严格解析边界；字段只存在于调用方内存。
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
export const HANDOFF_FIELD_LIMIT = 2000;
export const HANDOFF_MAX_FILE_BYTES = 64 * 1024;
export const HANDOFF_DOWNLOAD_NAME = 'task-handoff.md';
export const HANDOFF_VERSION_MARKER = '<!-- claude-local:task-handoff:v1 -->';

export const HANDOFF_FIELDS = [
  'task',
  'goal',
  'progress',
  'next',
  'verification',
  'constraints',
] as const;

export type HandoffFieldKey = typeof HANDOFF_FIELDS[number];

export type HandoffFields = {
  task: string;
  goal: string;
  progress: string;
  next: string;
  verification: string;
  constraints: string;
};

export type HandoffLabels = Record<keyof HandoffFields, string>;

export const emptyHandoffFields = (): HandoffFields => ({
  task: '',
  goal: '',
  progress: '',
  next: '',
  verification: '',
  constraints: '',
});

export function isDraftNonEmpty(fields: HandoffFields): boolean {
  return HANDOFF_FIELDS.some(field => typeof fields[field] === 'string' && fields[field].trim().length > 0);
}

function safeBody(value: string, notFilled: string): string {
  const trimmed = value.slice(0, HANDOFF_FIELD_LIMIT).trim();
  if (!trimmed) return notFilled;
  return trimmed.split(/\r?\n/).map(line => line.replace(/^(\s*)(#{1,6})(\s+)/, '$1\\$2$3')).join('\n');
}

export function buildHandoffMarkdown(fields: HandoffFields, title: string, labels: HandoffLabels, notFilled: string): string {
  const sections = HANDOFF_FIELDS.map(
    field => `## ${labels[field]} <!-- handoff:${field} -->\n\n${safeBody(fields[field], notFilled)}`
  );
  return `${HANDOFF_VERSION_MARKER}\n# ${title}\n\n${sections.join('\n\n')}`;
}

const PLACEHOLDERS = [
  'To be filled in',
  '待补充',
  '待填写',
];

const LEGACY_LABEL_MAP: Record<string, HandoffFieldKey> = {
  task: 'task',
  'handoff.task': 'task',
  goal: 'goal',
  'handoff.goal': 'goal',
  progress: 'progress',
  'current progress and verification': 'progress',
  'handoff.progress': 'progress',
  next: 'next',
  'next steps': 'next',
  'handoff.next': 'next',
  verification: 'verification',
  'verification and unchecked items': 'verification',
  'handoff.verification': 'verification',
  constraints: 'constraints',
  'constraints and decisions': 'constraints',
  'handoff.constraints': 'constraints',
  '任务': 'task',
  '目标': 'goal',
  '当前进展与验证状态': 'progress',
  '下一步': 'next',
  '验证状态与未覆盖项': 'verification',
  '约束与已定决策': 'constraints',
};

function unescapeBody(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || PLACEHOLDERS.includes(trimmed)) {
    return '';
  }
  return trimmed
    .split(/\r?\n/)
    .map(line => line.replace(/^(\s*)\\(#{1,6}\s+)/, '$1$2'))
    .join('\n');
}

export type ParseHandoffSuccess = {
  ok: true;
  fields: HandoffFields;
  version: 'v1' | 'legacy';
};

export type ParseHandoffFailure = {
  ok: false;
  errorKey:
    | 'fileTooLarge'
    | 'emptyFile'
    | 'unknownTemplate'
    | 'unsupportedVersion'
    | 'duplicateField'
    | 'oversizeField'
    | 'malformed';
  detail?: string;
};

export type ParseHandoffResult = ParseHandoffSuccess | ParseHandoffFailure;

export function parseHandoffMarkdown(content: string): ParseHandoffResult {
  if (typeof content !== 'string') {
    return { ok: false, errorKey: 'malformed' };
  }

  const byteLength = new TextEncoder().encode(content).length;
  if (byteLength > HANDOFF_MAX_FILE_BYTES) {
    return { ok: false, errorKey: 'fileTooLarge' };
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, errorKey: 'emptyFile' };
  }

  let version: 'v1' | 'legacy' = 'legacy';
  if (content.includes('<!-- claude-local:task-handoff:')) {
    if (content.includes(HANDOFF_VERSION_MARKER)) {
      version = 'v1';
    } else {
      return { ok: false, errorKey: 'unsupportedVersion' };
    }
  }

  const lines = content.split(/\r?\n/);
  const seenFields = new Set<HandoffFieldKey>();
  const parsedFields: HandoffFields = emptyHandoffFields();

  let currentField: HandoffFieldKey | null = null;
  let currentLines: string[] = [];

  const flushField = (): ParseHandoffFailure | null => {
    if (!currentField) return null;
    const body = unescapeBody(currentLines.join('\n'));
    if (body.length > HANDOFF_FIELD_LIMIT) {
      return { ok: false, errorKey: 'oversizeField', detail: currentField };
    }
    parsedFields[currentField] = body;
    currentLines = [];
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^##\s+(.*?)\s*$/);
    if (headingMatch) {
      const headingText = headingMatch[1].trim();
      const markerMatch = headingText.match(/<!--\s*handoff:([a-z_]+)\s*-->/);
      let matchedField: HandoffFieldKey | null = null;

      if (markerMatch) {
        const key = markerMatch[1];
        if (HANDOFF_FIELDS.includes(key as HandoffFieldKey)) {
          matchedField = key as HandoffFieldKey;
        } else {
          return { ok: false, errorKey: 'malformed', detail: key };
        }
      } else {
        const cleanLabel = headingText.replace(/<!--.*?-->/g, '').trim();
        const lowerLabel = cleanLabel.toLowerCase();
        if (LEGACY_LABEL_MAP[cleanLabel]) {
          matchedField = LEGACY_LABEL_MAP[cleanLabel];
        } else if (LEGACY_LABEL_MAP[lowerLabel]) {
          matchedField = LEGACY_LABEL_MAP[lowerLabel];
        } else {
          return { ok: false, errorKey: 'unknownTemplate', detail: headingText };
        }
      }

      if (seenFields.has(matchedField)) {
        return { ok: false, errorKey: 'duplicateField', detail: matchedField };
      }

      const flushErr = flushField();
      if (flushErr) return flushErr;

      seenFields.add(matchedField);
      currentField = matchedField;
    } else if (currentField) {
      currentLines.push(line);
    }
  }

  const flushErr = flushField();
  if (flushErr) return flushErr;

  if (seenFields.size === 0) {
    return { ok: false, errorKey: 'unknownTemplate' };
  }

  return { ok: true, fields: parsedFields, version };
}
