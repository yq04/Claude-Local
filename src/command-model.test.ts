import {expect, test} from 'bun:test';
import {clampActiveIndex, commandPaletteShortcutAction, filterCommandItems} from './command-model';

const items = [
  {id: 'quick', label: '快速配置'},
  {id: 'cleaner', label: '身份管理'},
  {id: 'handoff', label: '任务交接', keywords: ['next steps']},
];

test('command search is case-insensitive and includes explicit keywords', () => {
  expect(filterCommandItems(items, 'NEXT').map(item => item.id)).toEqual(['handoff']);
  expect(filterCommandItems(items, '身份').map(item => item.id)).toEqual(['cleaner']);
  expect(filterCommandItems(items, '').map(item => item.id)).toEqual(['quick', 'cleaner', 'handoff']);
});

test('active command selection stays within available results', () => {
  expect(clampActiveIndex(-1, 3)).toBe(0);
  expect(clampActiveIndex(4, 3)).toBe(2);
  expect(clampActiveIndex(0, 0)).toBe(-1);
});

test('palette shortcut respects modal, task, editable and IME gates while allowing close', () => {
  const base = {key: 'k', ctrlKey: true, metaKey: false, altKey: false, isComposing: false, paletteOpen: false, locked: false, dialogOpen: false, editableTarget: false};
  expect(commandPaletteShortcutAction(base)).toBe('open');
  expect(commandPaletteShortcutAction({...base, locked: true})).toBeNull();
  expect(commandPaletteShortcutAction({...base, dialogOpen: true})).toBeNull();
  expect(commandPaletteShortcutAction({...base, editableTarget: true})).toBeNull();
  expect(commandPaletteShortcutAction({...base, isComposing: true})).toBeNull();
  expect(commandPaletteShortcutAction({...base, keyCode: 229})).toBeNull();
  expect(commandPaletteShortcutAction({...base, paletteOpen: true, editableTarget: true})).toBe('close');
});
