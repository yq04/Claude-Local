/**
 * [INPUT]: Selected browser slot, visible-page lifecycle and read-only browser_runtime_read IPC.
 * [OUTPUT]: Three-second runtime samples with no overlapping requests or late/old-slot updates.
 * [POS]: Shared desktop runtime hook; never refreshes identities, profile caches or OAuth usage.
 * [PROTOCOL]: Update this header and src/CLAUDE.md when changing polling or invalidation.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {browserRuntimeStatus, type BrowserRuntime} from './browser-runtime';

export function useBrowserRuntime(selectedSlot: string | null | undefined, enabled = true) {
  const [sample, setSample] = useState<BrowserRuntime | null>(null);
  const inFlight = useRef(false), generation = useRef(0), queued = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const invalidate = useCallback(() => { generation.current++; setSample(null); }, []);

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    generation.current++;
    setSample(null);
    const visible = () => live && enabled && !!selectedSlot && document.visibilityState !== 'hidden';
    const clearTimer = () => { window.clearTimeout(timer); timer = undefined; };
    const schedule = () => { clearTimer(); if (visible()) timer = window.setTimeout(poll, 3000); };
    async function poll() {
      clearTimer();
      if (!visible()) return;
      if (inFlight.current) { queued.current = true; return; }
      inFlight.current = true;
      queued.current = false;
      const version = generation.current;
      try {
        const next = await invoke<BrowserRuntime>('browser_runtime_read');
        if (visible() && version === generation.current) setSample(next?.slot === selectedSlot ? next : null);
      } catch {
        if (visible() && version === generation.current) setSample(null);
      } finally {
        inFlight.current = false;
        if (queued.current) { queued.current = false; refreshRef.current(); }
        else if (live) schedule();
      }
    }
    const trigger = () => { if (visible()) void poll(); };
    const visibility = () => {
      clearTimer();
      generation.current++;
      setSample(null);
      if (visible()) trigger();
    };
    refreshRef.current = trigger;
    window.addEventListener('focus', trigger);
    document.addEventListener('visibilitychange', visibility);
    trigger();
    return () => {
      live = false;
      generation.current++;
      clearTimer();
      refreshRef.current = () => {};
      window.removeEventListener('focus', trigger);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [selectedSlot, enabled]);

  const runtime = enabled && sample?.slot === selectedSlot ? sample : null;
  return {runtime, status: browserRuntimeStatus(runtime, selectedSlot), refresh, invalidate};
}
