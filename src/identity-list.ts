/**
 * [INPUT]: 额度实际观测时间戳与当前时钟（毫秒）。
 * [OUTPUT]: 观测年龄分级（分钟/小时/天），非法或未来时间安全回退空。
 * [POS]: 身份管理纯函数辅助层；与原生保险库/展示层解耦。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

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
