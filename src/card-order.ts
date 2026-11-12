/**
 * [INPUT]: Card rail item keys, localStorage persistence key, wheel scroll events, and pointer/keyboard drag events on `.identity-card-drag-handle`.
 * [OUTPUT]: Persisted custom card ordering (`orderItemsByIds`, `moveOrderId`, `clearStoredCardOrder`), `useHorizontalRailWheelScroll` spring wheel hook, and `useCardRailReorder` with cursor-locked drag offset, FLIP sibling transitions, and `resetCardOrder`.
 * [POS]: Shared card rail reordering and horizontal wheel-scroll controller for both CLI identity cards and browser warming cards.
 * [PROTOCOL]: Update this header and src/CLAUDE.md when changing card reordering behavior.
 */
import {useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject} from 'react';
import {useSpring} from 'cromma-ui';

export const IDENTITY_CARD_ORDER_STORAGE_KEY = 'claude-local.identity-card-order.v1';
export const WARMING_CARD_ORDER_STORAGE_KEY = 'claude-local.warming-card-order.v1';
export const CURRENT_IDENTITY_ORDER_TOKEN = '__current__';

export function readStoredCardOrder(storageKey: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

export function writeStoredCardOrder(storageKey: string, order: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(new Set(order))));
  } catch {
    // Ignore storage quota or private mode errors.
  }
}

export function clearStoredCardOrder(storageKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage quota or private mode errors.
  }
}

/**
 * Attaches spring-smoothed horizontal mouse-wheel scrolling to a `.identity-rail` container
 * while keeping native scrollbar, touch, and keyboard navigation intact.
 */
export function useHorizontalRailWheelScroll(
  railRef: RefObject<HTMLDivElement | null>,
  reduceMotion: boolean,
): void {
  const scrollSpring = useSpring(0, {stiffness: 170, damping: 25, mass: 0.8});
  const scrollTarget = useRef(0);

  useEffect(() => {
    const element = railRef.current;
    if (!element) return;
    const maximum = () => Math.max(0, element.scrollWidth - element.clientWidth);
    if (reduceMotion) {
      scrollTarget.current = element.scrollLeft;
      scrollSpring.jump(element.scrollLeft);
    }
    const unsubscribe = scrollSpring.on('change', value => {
      element.scrollLeft = Math.max(0, Math.min(maximum(), value));
    });
    function interrupt() {
      scrollTarget.current = element!.scrollLeft;
      scrollSpring.jump(element!.scrollLeft);
    }
    function scroll() {
      if (Math.abs(element!.scrollLeft - Math.max(0, Math.min(maximum(), scrollSpring.get()))) > 2) {
        interrupt();
      }
    }
    function wheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey) return;
      const amount = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const delta = amount * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? element!.clientWidth : 1);
      const next = Math.max(0, Math.min(maximum(), scrollTarget.current + delta));
      if (next === scrollTarget.current) return;
      event.preventDefault();
      scrollTarget.current = next;
      if (reduceMotion) scrollSpring.jump(next);
      else scrollSpring.set(next);
    }
    element.addEventListener('wheel', wheel, {passive: false});
    element.addEventListener('scroll', scroll, {passive: true});
    element.addEventListener('pointerdown', interrupt);
    return () => {
      unsubscribe();
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('scroll', scroll);
      element.removeEventListener('pointerdown', interrupt);
    };
  }, [railRef, scrollSpring, reduceMotion]);
}

/**
 * Orders items according to `storedOrder`. Any item whose ID is not yet in `storedOrder`
 * preserves its relative default position:
 * - If `pinFirstToken` is provided (e.g. `CURRENT_IDENTITY_ORDER_TOKEN`) and is not present
 *   in `storedOrder`, it defaults to the very front (index 0).
 * - Other unseen items appear after known items in their original relative order.
 */
export function orderItemsByIds<T>(
  items: readonly T[],
  getId: (item: T) => string,
  storedOrder: readonly string[],
  pinFirstToken?: string,
): T[] {
  if (items.length <= 1 || storedOrder.length === 0) {
    return [...items];
  }
  const indexMap = new Map<string, number>();
  storedOrder.forEach((id, idx) => {
    if (!indexMap.has(id)) indexMap.set(id, idx);
  });

  const pinnedFirst: T[] = [];
  const known: {item: T; rank: number}[] = [];
  const unknown: T[] = [];

  for (const item of items) {
    const id = getId(item);
    const rank = indexMap.get(id);
    if (rank !== undefined) {
      known.push({item, rank});
    } else if (pinFirstToken && id === pinFirstToken) {
      pinnedFirst.push(item);
    } else {
      unknown.push(item);
    }
  }

  known.sort((a, b) => a.rank - b.rank);
  return [...pinnedFirst, ...known.map(entry => entry.item), ...unknown];
}

export function moveOrderId(ids: readonly string[], fromId: string, toId: string): string[] {
  const fromIndex = ids.indexOf(fromId);
  const toIndex = ids.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return [...ids];
  }
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

type ActiveDragState = {
  id: string;
  pointerId: number;
  anchorClientX: number;
  lastClientX: number;
  offsetX: number;
  tiltDeg: number;
  moved: boolean;
};

export function useCardRailReorder<T>({
  storageKey,
  items,
  getId,
  pinFirstToken,
  disabled = false,
}: {
  storageKey: string;
  items: readonly T[];
  getId: (item: T) => string;
  pinFirstToken?: string;
  disabled?: boolean;
}) {
  const [storedOrder, setStoredOrder] = useState<string[]>(() => readStoredCardOrder(storageKey));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [dragTiltDeg, setDragTiltDeg] = useState(0);

  const railRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ActiveDragState | null>(null);
  const prevPositionsRef = useRef<Map<string, number>>(new Map());
  const pendingFlipRef = useRef(false);
  const animationsRef = useRef<Map<string, Animation>>(new Map());

  const orderedItems = orderItemsByIds(items, getId, storedOrder, pinFirstToken);
  const orderedIdsRef = useRef<string[]>([]);
  orderedIdsRef.current = orderedItems.map(getId);

  const captureCardPositions = useCallback(() => {
    const rail = railRef.current;
    const map = new Map<string, number>();
    if (!rail) return map;
    const nodes = rail.querySelectorAll<HTMLElement>('[data-reorder-card-id]');
    nodes.forEach(node => {
      const id = node.getAttribute('data-reorder-card-id');
      if (id) {
        // Measure layout left without active drag translation
        const rect = node.getBoundingClientRect();
        const currentDragOffset =
          dragRef.current && dragRef.current.id === id ? dragRef.current.offsetX : 0;
        map.set(id, rect.left - currentDragOffset);
      }
    });
    return map;
  }, []);

  const commitOrder = useCallback(
    (nextIds: string[]) => {
      prevPositionsRef.current = captureCardPositions();
      pendingFlipRef.current = true;
      setStoredOrder(nextIds);
      writeStoredCardOrder(storageKey, nextIds);
    },
    [captureCardPositions, storageKey],
  );

  // FLIP layout effect: smoothly animate sibling cards when slots swap, and keep the dragged card locked to the pointer.
  useLayoutEffect(() => {
    if (!pendingFlipRef.current) return;
    pendingFlipRef.current = false;
    const rail = railRef.current;
    if (!rail) return;
    const prevMap = prevPositionsRef.current;
    if (prevMap.size === 0) return;

    const reduceMotion =
      typeof document !== 'undefined' &&
      (document.documentElement.getAttribute('data-reduce-motion') === 'true' ||
        (typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));

    const nodes = rail.querySelectorAll<HTMLElement>('[data-reorder-card-id]');
    nodes.forEach(node => {
      const id = node.getAttribute('data-reorder-card-id');
      if (!id) return;
      const prevLeft = prevMap.get(id);
      if (prevLeft === undefined) return;

      if (dragRef.current && dragRef.current.id === id) {
        // Adjust anchorClientX by the layout delta so the dragged card stays locked under the cursor
        const rect = node.getBoundingClientRect();
        const layoutLeftNow = rect.left - dragRef.current.offsetX;
        const layoutShift = layoutLeftNow - prevLeft;
        if (Math.abs(layoutShift) > 0.5) {
          dragRef.current.anchorClientX += layoutShift;
          const nextOffset = dragRef.current.lastClientX - dragRef.current.anchorClientX;
          dragRef.current.offsetX = nextOffset;
          setDragOffsetX(nextOffset);
        }
        return;
      }

      if (reduceMotion || typeof node.animate !== 'function') return;

      const rect = node.getBoundingClientRect();
      const deltaX = prevLeft - rect.left;
      if (Math.abs(deltaX) < 1) return;

      animationsRef.current.get(id)?.cancel();
      const anim = node.animate(
        [
          {transform: `translate3d(${deltaX}px, 0, 0)`},
          {transform: 'translate3d(0, 0, 0)'},
        ],
        {
          duration: 240,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      );
      animationsRef.current.set(id, anim);
      anim.onfinish = () => {
        if (animationsRef.current.get(id) === anim) {
          animationsRef.current.delete(id);
        }
      };
    });
  }, [orderedItems]);

  useEffect(() => {
    if (!draggingId) return;

    const handlePointerMove = (event: PointerEvent) => {
      const active = dragRef.current;
      if (!active || event.pointerId !== active.pointerId) return;

      const dx = event.clientX - active.anchorClientX;
      const velocity = event.clientX - active.lastClientX;
      active.lastClientX = event.clientX;

      if (!active.moved && Math.abs(dx) < 3) {
        return;
      }
      active.moved = true;
      active.offsetX = dx;
      const tilt = Math.max(-2, Math.min(2, velocity * 0.14));
      active.tiltDeg = tilt;
      setDragOffsetX(dx);
      setDragTiltDeg(tilt);

      const rail = railRef.current;
      if (!rail) return;

      // Auto-scroll rail when dragging near horizontal edges
      const railRect = rail.getBoundingClientRect();
      const edgeZone = 42;
      if (event.clientX < railRect.left + edgeZone && rail.scrollLeft > 0) {
        const step = Math.min(14, rail.scrollLeft);
        rail.scrollLeft -= step;
        active.anchorClientX -= step;
      } else if (
        event.clientX > railRect.right - edgeZone &&
        rail.scrollLeft < rail.scrollWidth - rail.clientWidth
      ) {
        const maxScroll = rail.scrollWidth - rail.clientWidth - rail.scrollLeft;
        const step = Math.min(14, maxScroll);
        rail.scrollLeft += step;
        active.anchorClientX += step;
      }

      // Check if dragged card's visual center crossed a neighbor card's midpoint
      const currentIds = orderedIdsRef.current;
      const currentIndex = currentIds.indexOf(active.id);
      if (currentIndex < 0) return;

      const cardNodes = Array.from(rail.querySelectorAll<HTMLElement>('[data-reorder-card-id]'));
      const draggedNode = cardNodes.find(
        n => n.getAttribute('data-reorder-card-id') === active.id,
      );
      if (!draggedNode) return;
      const draggedRect = draggedNode.getBoundingClientRect();
      const draggedCenter = draggedRect.left + draggedRect.width / 2;

      let targetIndex = currentIndex;
      for (let i = 0; i < cardNodes.length; i++) {
        if (i === currentIndex) continue;
        const siblingNode = cardNodes[i];
        const siblingId = siblingNode.getAttribute('data-reorder-card-id');
        if (!siblingId) continue;
        const rect = siblingNode.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        if (i < currentIndex && draggedCenter < center - 4) {
          targetIndex = Math.min(targetIndex, i);
        } else if (i > currentIndex && draggedCenter > center + 4) {
          targetIndex = Math.max(targetIndex, i);
        }
      }

      if (targetIndex !== currentIndex) {
        const targetId = currentIds[targetIndex];
        if (targetId) {
          const nextOrder = moveOrderId(currentIds, active.id, targetId);
          commitOrder(nextOrder);
        }
      }
    };

    const finishDrag = (event: PointerEvent) => {
      const active = dragRef.current;
      if (!active || event.pointerId !== active.pointerId) return;
      dragRef.current = null;
      setDraggingId(null);
      setDragOffsetX(0);
      setDragTiltDeg(0);
    };

    window.addEventListener('pointermove', handlePointerMove, {passive: true});
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [commitOrder, draggingId]);

  const startCardDrag = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      if (disabled || orderedIdsRef.current.length <= 1) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic pointer events in tests may not support setPointerCapture
      }
      dragRef.current = {
        id,
        pointerId: event.pointerId,
        anchorClientX: event.clientX,
        lastClientX: event.clientX,
        offsetX: 0,
        tiltDeg: 0,
        moved: false,
      };
      setDraggingId(id);
      setDragOffsetX(0);
      setDragTiltDeg(0);
    },
    [disabled],
  );

  const handleCardKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLElement>) => {
      if (disabled || orderedIdsRef.current.length <= 1) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      const currentIds = orderedIdsRef.current;
      const idx = currentIds.indexOf(id);
      if (idx < 0) return;
      const nextIdx = event.key === 'ArrowLeft' ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= currentIds.length) return;
      const targetId = currentIds[nextIdx];
      if (!targetId) return;
      commitOrder(moveOrderId(currentIds, id, targetId));
    },
    [commitOrder, disabled],
  );

  const resetCardOrder = useCallback(() => {
    if (storedOrder.length === 0) return;
    prevPositionsRef.current = captureCardPositions();
    pendingFlipRef.current = true;
    setStoredOrder([]);
    clearStoredCardOrder(storageKey);
  }, [captureCardPositions, storageKey, storedOrder.length]);

  return {
    railRef,
    orderedItems,
    hasCustomOrder: storedOrder.length > 0,
    resetCardOrder,
    draggingId,
    dragOffsetX,
    dragTiltDeg,
    startCardDrag,
    handleCardKeyDown,
  };
}
