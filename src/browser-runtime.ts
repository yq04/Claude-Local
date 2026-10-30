/**
 * [INPUT]: Lightweight native current-slot process/window samples and the selected browser slot.
 * [OUTPUT]: Slot-scoped running/closed/unknown presentation; selection never implies a running browser.
 * [POS]: Pure browser runtime boundary; no profiles, credentials, account reads or mutations.
 * [PROTOCOL]: Update this header and src/CLAUDE.md when changing the contract.
 */
export type BrowserRuntime = {slot: string; running: boolean | null; window_open: boolean | null};
export type BrowserRuntimeStatus = 'running' | 'closed' | 'unknown';

export function browserRuntimeStatus(runtime: BrowserRuntime | null, selectedSlot: string | null | undefined): BrowserRuntimeStatus {
  if (!runtime || !selectedSlot || runtime.slot !== selectedSlot) return 'unknown';
  // Native Windows failures null both fields; other platforms expose only process liveness.
  const open = typeof runtime.window_open === 'boolean' ? runtime.window_open : runtime.running;
  return open === true ? 'running' : open === false ? 'closed' : 'unknown';
}
