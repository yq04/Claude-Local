/**
 * [INPUT]: Pure ordering helpers in `src/card-order.ts`.
 * [OUTPUT]: Unit test assertions for default pinning, custom order persistence, and slot swapping.
 * [POS]: Fast Bun unit test for card rail reordering logic.
 * [PROTOCOL]: Update this header and src/CLAUDE.md when changing card reordering tests.
 */
import {describe, expect, test} from 'bun:test';
import {
  clearStoredCardOrder,
  CURRENT_IDENTITY_ORDER_TOKEN,
  findPointerReorderTargetId,
  moveOrderId,
  orderItemsByIds,
  readStoredCardOrder,
  writeStoredCardOrder,
} from './card-order';

describe('card-order helpers', () => {
  test('preserves default order when storedOrder is empty', () => {
    const items = [{id: CURRENT_IDENTITY_ORDER_TOKEN}, {id: 'a'}, {id: 'b'}, {id: 'c'}];
    expect(orderItemsByIds(items, i => i.id, [], CURRENT_IDENTITY_ORDER_TOKEN)).toEqual(items);
  });

  test('pins CURRENT_IDENTITY_ORDER_TOKEN first when only saved cards were reordered', () => {
    const items = [{id: CURRENT_IDENTITY_ORDER_TOKEN}, {id: 'a'}, {id: 'b'}, {id: 'c'}];
    const ordered = orderItemsByIds(
      items,
      i => i.id,
      ['c', 'a', 'b'],
      CURRENT_IDENTITY_ORDER_TOKEN,
    );
    expect(ordered.map(i => i.id)).toEqual([CURRENT_IDENTITY_ORDER_TOKEN, 'c', 'a', 'b']);
  });

  test('allows CURRENT_IDENTITY_ORDER_TOKEN to be moved to any slot when explicitly reordered', () => {
    const items = [{id: CURRENT_IDENTITY_ORDER_TOKEN}, {id: 'a'}, {id: 'b'}, {id: 'c'}];
    const ordered = orderItemsByIds(
      items,
      i => i.id,
      ['a', 'b', CURRENT_IDENTITY_ORDER_TOKEN, 'c'],
      CURRENT_IDENTITY_ORDER_TOKEN,
    );
    expect(ordered.map(i => i.id)).toEqual(['a', 'b', CURRENT_IDENTITY_ORDER_TOKEN, 'c']);
  });

  test('moveOrderId swaps card positions cleanly without mutating input', () => {
    const initial = ['a', 'b', 'c', 'd'];
    expect(moveOrderId(initial, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveOrderId(initial, 'd', 'a')).toEqual(['d', 'a', 'b', 'c']);
    expect(initial).toEqual(['a', 'b', 'c', 'd']);
  });

  test('clearStoredCardOrder removes persisted custom order cleanly', () => {
    const store = new Map<string, string>();
    const prevWindow = (globalThis as {window?: unknown}).window;
    (globalThis as {window?: unknown}).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    };
    try {
      const key = 'test.card.order';
      writeStoredCardOrder(key, ['c', 'a', 'b']);
      expect(readStoredCardOrder(key)).toEqual(['c', 'a', 'b']);
      clearStoredCardOrder(key);
      expect(readStoredCardOrder(key)).toEqual([]);
    } finally {
      (globalThis as {window?: unknown}).window = prevWindow;
    }
  });

  test('findPointerReorderTargetId resolves visible neighbors under filters and ignores other gridWrap rows', () => {
    // Filtered subset: full order is [__current__, a, b, c], visible is [__current__, c]; dragging c left of __current__
    const filteredVisible = [
      {id: CURRENT_IDENTITY_ORDER_TOKEN, left: 100, width: 166, top: 20, height: 286},
      {id: 'c', left: 60, width: 166, top: 16, height: 286},
    ];
    const targetFiltered = findPointerReorderTargetId(filteredVisible, 'c');
    expect(targetFiltered).toBe(CURRENT_IDENTITY_ORDER_TOKEN);
    expect(moveOrderId([CURRENT_IDENTITY_ORDER_TOKEN, 'a', 'b', 'c'], 'c', targetFiltered!)).toEqual([
      'c',
      CURRENT_IDENTITY_ORDER_TOKEN,
      'a',
      'b',
    ]);

    // Multi-row gridWrap: row 1 has [a, b, c] at top=20, row 2 has [d, e] at top=316; dragging d slightly on row 2 must NOT swap with row 1's c (left=392)!
    const wrappedVisible = [
      {id: 'a', left: 20, width: 166, top: 20, height: 286},
      {id: 'b', left: 206, width: 166, top: 20, height: 286},
      {id: 'c', left: 392, width: 166, top: 20, height: 286},
      {id: 'd', left: 230, width: 166, top: 312, height: 286},
      {id: 'e', left: 206, width: 166, top: 316, height: 286},
    ];
    expect(findPointerReorderTargetId(wrappedVisible, 'd')).toBe('e');
  });
});
