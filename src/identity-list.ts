/**
 * [INPUT]: Saved identity metadata plus the alias already rendered under the active privacy preference.
 * [OUTPUT]: Searchable/sortable local list copies; source records and IDs remain untouched.
 * [POS]: Identity workbench list model; hidden account fields are never consulted for aliases.
 * [PROTOCOL]: Keep identity privacy filtering and ordering aligned with identities.tsx.
 */
export type IdentityListRow = { id: string; name: string; visibleName?: string; saved_at: number; email?: string | null }

export function filterAndSortIdentities<T extends IdentityListRow>(rows: readonly T[], query: string, sort: 'saved' | 'name' | 'original', privacyMask: boolean): T[] {
  const needle = query.trim().toLocaleLowerCase()
  const alias = (row: T) => row.visibleName ?? row.name
  const filtered = rows.filter(row => !needle || alias(row).toLocaleLowerCase().includes(needle) || (!privacyMask && !!row.email && row.email.toLocaleLowerCase().includes(needle)))
  return filtered.map((row, index) => ({row, index})).sort((a, b) => {
    if (sort === 'name') return alias(a.row).localeCompare(alias(b.row)) || a.index - b.index
    if (sort === 'saved') return b.row.saved_at - a.row.saved_at || a.index - b.index
    return a.index - b.index
  }).map(item => item.row)
}

export function quotaObservationAge(observedAtMs: number | null | undefined, nowMs: number) {
  if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs) || observedAtMs <= 0) return null
  const ageMs = nowMs - observedAtMs
  if (ageMs < 0) return null
  return Math.floor(ageMs / 60_000)
}

export function formatObservationAge(ageMinutes: number | null) {
  if (ageMinutes == null) return null
  if (ageMinutes < 60) return {unit: 'minutes' as const, value: ageMinutes}
  const hours = Math.floor(ageMinutes / 60)
  if (hours < 48) return {unit: 'hours' as const, value: hours}
  return {unit: 'days' as const, value: Math.floor(hours / 24)}
}
