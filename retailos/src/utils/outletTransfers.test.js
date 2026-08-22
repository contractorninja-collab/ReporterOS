import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearOutletItemStatuses,
  findTodayPendingOutletTransfer,
  localDateKey,
  upsertOutletTransferItem,
  upsertOutletTransferItems,
} from './outletTransfers.js'

test('finds only today pending outlet transfer for the sending store', () => {
  const now = new Date(2026, 7, 22, 10, 0, 0)
  const today = new Date(2026, 7, 22, 8, 0, 0).toISOString()
  const yesterday = new Date(2026, 7, 21, 8, 0, 0).toISOString()
  const transfers = [
    { id: 'ring', status: 'pending', fromShop: 'Ring Mall', createdAt: today },
    { id: 'village-old', status: 'pending', fromShop: 'Village', createdAt: yesterday },
    { id: 'village', status: 'pending', fromShop: 'Village', createdAt: today },
  ]

  assert.equal(findTodayPendingOutletTransfer(transfers, ' village ', now)?.id, 'village')
  assert.equal(findTodayPendingOutletTransfer(transfers, 'Ring Mall', now)?.id, 'ring')
  assert.equal(findTodayPendingOutletTransfer(transfers, '', now), null)
  assert.equal(localDateKey(now), '2026-08-22')
})

test('re-adding a product refreshes it instead of duplicating it', () => {
  const first = { skuCode: 'SKU-1', quantity: 2 }
  const refreshed = { skuCode: 'SKU-1', quantity: 3 }
  const second = { skuCode: 'SKU-2', quantity: 1 }
  assert.deepEqual(upsertOutletTransferItem([first, second], refreshed), [refreshed, second])
  assert.deepEqual(upsertOutletTransferItem([first], second), [first, second])
  assert.deepEqual(
    upsertOutletTransferItems([first], [refreshed, second]),
    [refreshed, second],
  )
})

test('clears verification only for the refreshed product', () => {
  const statuses = {
    'SKU-1|41': { status: 'done' },
    'SKU-1|42': { status: 'partial' },
    'SKU-2|One Size': { status: 'done' },
  }
  assert.deepEqual(clearOutletItemStatuses(statuses, 'SKU-1'), {
    'SKU-2|One Size': { status: 'done' },
  })
})
