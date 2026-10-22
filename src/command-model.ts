/**
 * [INPUT]: 用户键入的命令查询、受限页面枚举与已保存身份的可见标签。
 * [OUTPUT]: 纯函数筛选命令面板项目，不读取持久化状态或执行动作。
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

export function commandPaletteShortcutAction(state: {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean; keyCode?: number;
  paletteOpen: boolean; locked: boolean; dialogOpen: boolean; editableTarget: boolean;
}): 'open'|'close'|null {
  if (!(state.ctrlKey || state.metaKey) || state.altKey || state.key.toLowerCase() !== 'k' || state.isComposing || state.keyCode === 229) return null;
  if (state.paletteOpen) return 'close';
  return state.locked || state.dialogOpen || state.editableTarget ? null : 'open';
}
