import {expect, test} from 'bun:test'
import {filterAndSortIdentities, formatObservationAge, quotaObservationAge} from './identity-list'

const rows = [
  {id:'a',name:'Alpha',saved_at:20,email:'hidden@example.test'},
  {id:'b',name:'Beta',saved_at:30,email:'visible@example.test'},
  {id:'c',name:'Gamma',saved_at:10,email:null},
]

test('privacy mode searches visible aliases only; email search is opt-in', () => {
  expect(filterAndSortIdentities(rows, 'hidden@', 'original', true)).toEqual([])
  expect(filterAndSortIdentities(rows, 'visible@', 'original', false).map(row => row.id)).toEqual(['b'])
})

test('sort modes are stable and preserve input order for ties', () => {
  expect(filterAndSortIdentities(rows, '', 'saved', true).map(row => row.id)).toEqual(['b','a','c'])
  expect(filterAndSortIdentities(rows, '', 'name', true).map(row => row.id)).toEqual(['a','b','c'])
  expect(filterAndSortIdentities(rows, '', 'original', true).map(row => row.id)).toEqual(['a','b','c'])
})

test('privacy filtering and name sorting use rendered aliases even when the saved label is an email', () => {
  const privateRow = {id:'private',name:'hidden@example.test',visibleName:'hid***@example.test',saved_at:40,email:'hidden@example.test'}
  const publicRow = {id:'public',name:'Visible label',visibleName:'Visible label',saved_at:30,email:'x@example.test'}
  expect(filterAndSortIdentities([privateRow,publicRow], 'hidden', 'original', true).map(row => row.id)).toEqual([])
  expect(filterAndSortIdentities([privateRow,publicRow], 'hid***', 'original', true).map(row => row.id)).toEqual(['private'])
  expect(filterAndSortIdentities([privateRow,publicRow], '', 'name', true).map(row => row.id)).toEqual(['private','public'])
})

test('observation age rejects absent, invalid and future timestamps', () => {
  expect(quotaObservationAge(null, 100_000)).toBeNull()
  expect(quotaObservationAge(101_000, 100_000)).toBeNull()
  expect(quotaObservationAge(40_000, 100_000)).toBe(1)
  expect(formatObservationAge(2_880)).toEqual({unit:'days',value:2})
})
