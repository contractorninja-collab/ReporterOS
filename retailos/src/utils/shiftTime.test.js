import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SHIFT_TIME_ZONE, addShiftDays, shiftDateKey, shiftLocalToIso, shiftWeekStart,
} from './shiftTime.js'

test('uses Kosovo business time and Monday-based weeks', () => {
  assert.equal(SHIFT_TIME_ZONE, 'Europe/Belgrade')
  assert.equal(shiftWeekStart('2026-08-11'), '2026-08-10')
  assert.equal(addShiftDays('2026-08-31', 1), '2026-09-01')
})

test('converts winter and summer Kosovo wall-clock times to ISO instants', () => {
  assert.equal(shiftLocalToIso('2026-01-15', '09:00'), '2026-01-15T08:00:00.000Z')
  assert.equal(shiftLocalToIso('2026-07-15', '09:00'), '2026-07-15T07:00:00.000Z')
  assert.equal(shiftDateKey('2026-07-15T22:30:00.000Z'), '2026-07-16')
})
