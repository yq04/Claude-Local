/**
 * [INPUT]: 用户键入的命令查询、受限页面枚举与已保存身份的可见标签。
 * [OUTPUT]: 纯函数筛选命令面板项目与跳过禁用项的键盘索引计算，不读取持久化状态或执行动作。
 * [POS]: 命令面板交互模型；身份搜索只使用调用方已按隐私偏好脱敏的标签。
 * [PROTOCOL]: Update this header and src/CLAUDE.md with changes.
 */
export type CommandItem = {id: string; label: string; keywords?: readonly string[]; disabled?: boolean};

export function filterCommandItems<T extends CommandItem>(items: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...items];
  return items.filter(item => [item.label, ...(item.keywords ?? [])].some(value => value.toLocaleLowerCase().includes(needle)));
}

export function clampActiveIndex(index: number, length: number): number {
  if (!length) return -1;
  return Math.max(0, Math.min(length - 1, index));
}

export function firstEnabledCommandIndex<T extends {disabled?: boolean}>(items: readonly T[]): number {
  for (let i = 0; i < items.length; i++) {
    if (!items[i]?.disabled) return i;
  }
  return -1;
}

export function lastEnabledCommandIndex<T extends {disabled?: boolean}>(items: readonly T[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i]?.disabled) return i;
  }
  return -1;
}

export function stepEnabledCommandIndex<T extends {disabled?: boolean}>(
  items: readonly T[],
  current: number,
  delta: 1 | -1,
): number {
  if (!items.length) return -1;
  const start = current < 0 ? (delta > 0 ? 0 : items.length - 1) : current + delta;
  for (let i = start; i >= 0 && i < items.length; i += delta) {
    if (!items[i]?.disabled) return i;
  }
  if (current >= 0 && current < items.length && !items[current]?.disabled) {
    return current;
  }
  return delta > 0 ? firstEnabledCommandIndex(items) : lastEnabledCommandIndex(items);
}

export function commandPaletteShortcutAction(state: {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean; keyCode?: number;
  paletteOpen: boolean; locked: boolean; dialogOpen: boolean; editableTarget: boolean;
}): 'open'|'close'|null {
  if (!(state.ctrlKey || state.metaKey) || state.altKey || state.key.toLowerCase() !== 'k' || state.isComposing || state.keyCode === 229) return null;
  if (state.paletteOpen) return 'close';
  return state.locked || state.dialogOpen || state.editableTarget ? null : 'open';
}
