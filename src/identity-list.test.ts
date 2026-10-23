import {expect, test} from 'bun:test'
import {formatObservationAge, quotaObservationAge} from './identity-list'

test('observation age rejects absent, invalid and future timestamps', () => {
  expect(quotaObservationAge(null, 100_000)).toBeNull()
  expect(quotaObservationAge(101_000, 100_000)).toBeNull()
  expect(quotaObservationAge(40_000, 100_000)).toBe(1)
  expect(formatObservationAge(2_880)).toEqual({unit:'days',value:2})
})
