import test from 'node:test'
import assert from 'node:assert/strict'
import { clearedSessionData } from './storeHelpers.js'

test('sign-out clears every server-backed role-scoped cache', () => {
  const cleared = clearedSessionData()

  for (const key of [
    'skus', 'importHistory', 'users', 'assignments', 'outletTransfers', 'storeTransfers',
    'markdownLists', 'saleChangeReports', 'salesSnapshots', 'notifications', 'activeShifts',
    'weeklySales',
  ]) {
    assert.deepEqual(cleared[key], [], `${key} should be cleared`)
  }
  for (const key of ['photoMap', 'skuImportTotals', 'shipmentMeta']) {
    assert.deepEqual(cleared[key], {}, `${key} should be cleared`)
  }
  assert.equal(cleared.activeUser, null)
  assert.equal(cleared.myShift, null)
  assert.equal(cleared.unreadCount, 0)
  assert.equal(cleared.photoCount, 0)
  assert.equal(cleared.excludeOutletAnalytics, false)
})
