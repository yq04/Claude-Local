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
});
