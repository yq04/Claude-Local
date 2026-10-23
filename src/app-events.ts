/**
 * [INPUT]: Local application event dispatches and current React callbacks.
 * [OUTPUT]: Stable page-refresh listener, fault navigation and identity-review request contract.
 * [POS]: Frontend-only coordination events; no native commands or persistence.
 * [PROTOCOL]: Keep shell and page owners on this shared event contract.
 */
import { useEffect, useRef } from 'react'

export const APP_REFRESH_EVENT = 'claude-local:refresh'
export const FAULT_NAVIGATE_EVENT = 'claude-local:fault-navigate'

export type IdentityReviewRequest = {
  identityId: string
  requestId: number
}

export function usePageRefresh(callback: () => void): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const listener = () => callbackRef.current()
    window.addEventListener(APP_REFRESH_EVENT, listener)
    return () => window.removeEventListener(APP_REFRESH_EVENT, listener)
  }, [])
}
