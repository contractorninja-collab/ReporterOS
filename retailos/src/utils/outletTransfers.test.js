import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOutletVerificationEntry,
  clearOutletItemStatuses,
  findTodayPendingOutletTransfer,
  localDateKey,
  outletShortageDraftError,
  outletSkuConflictCodes,
  outletSkuOwnership,
  outletVerificationEntryError,
  upsertOutletTransferItem,
  upsertOutletTransferItems,
} from './outletTransfers.js'

test('treats every SKU in an Outlet transfer as Outlet-owned at every stage', () => {
  const transfers = [
    { id: 'pending', status: 'pending', fromShop: 'Ring Mall', items: [{ skuCode: 'SKU-1' }] },
    { id: 'completed', status: 'completed', fromShop: 'Village', items: [{ skuCode: 'SKU-2' }] },
    { id: 'received', status: 'received', fromShop: 'Ring Mall', items: [{ skuCode: 'SKU-3' }] },
  ]
  const ownership = outletSkuOwnership(transfers)

  assert.equal(ownership.get('SKU-1')?.status, 'pending')
  assert.equal(ownership.get('SKU-2')?.status, 'completed')
  assert.equal(ownership.get('SKU-3')?.status, 'received')
  assert.deepEqual(outletSkuConflictCodes(
    [{ skuCode: 'SKU-1' }, { skuCode: 'SKU-1' }, { skuCode: 'SKU-4' }],
    transfers,
  ), ['SKU-1'])
})

test('can exclude the transfer being edited while still detecting other Outlet ownership', () => {
  const transfers = [
    { id: 'current', status: 'pending', items: [{ skuCode: 'SKU-1' }, { skuCode: 'SKU-2' }] },
    { id: 'other', status: 'received', items: [{ skuCode: 'SKU-2' }] },
  ]

  assert.deepEqual(
    outletSkuConflictCodes([{ skuCode: 'SKU-1' }, { skuCode: 'SKU-2' }], transfers, 'current'),
    ['SKU-2'],
  )
})

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

test('builds full, partial, and fully missing outlet verification entries', () => {
  assert.deepEqual(buildOutletVerificationEntry({ expected: 5 }), {
    status: 'done', received: 5, missing: 0, expected: 5, comment: '',
  })
  assert.deepEqual(buildOutletVerificationEntry({ expected: 5, missing: 1, comment: '  Not on shelf  ' }), {
    status: 'partial', received: 4, missing: 1, expected: 5, comment: 'Not on shelf',
  })
  assert.deepEqual(buildOutletVerificationEntry({ expected: 5, missing: 5, comment: 'Box not delivered' }), {
    status: 'missing', received: 0, missing: 5, expected: 5, comment: 'Box not delivered',
  })
})

test('validates outlet shortage drafts', () => {
  assert.equal(outletShortageDraftError({ expected: 5, missing: '', comment: 'Lost' }), 'Enter how many units are missing.')
  assert.match(outletShortageDraftError({ expected: 5, missing: 0, comment: 'Lost' }), /1 to 5/)
  assert.match(outletShortageDraftError({ expected: 5, missing: 1.5, comment: 'Lost' }), /whole number/)
  assert.match(outletShortageDraftError({ expected: 5, missing: 6, comment: 'Lost' }), /1 to 5/)
  assert.equal(outletShortageDraftError({ expected: 5, missing: 1, comment: ' ' }), 'Explain why the units are missing.')
  assert.equal(outletShortageDraftError({ expected: 5, missing: 1, comment: 'Not found' }), '')
})

test('requires exact quantities, matching statuses, and shortage reasons', () => {
  assert.equal(outletVerificationEntryError(
    buildOutletVerificationEntry({ expected: 5, missing: 1, comment: 'Not found' }), 5,
  ), '')
  assert.match(outletVerificationEntryError({ status: 'partial', received: 4, missing: 0, comment: 'Not found' }, 5), /account/)
  assert.match(outletVerificationEntryError({ status: 'done', received: 4, missing: 1, comment: '' }, 5), /confirmed line/)
  assert.match(outletVerificationEntryError({ status: 'partial', received: 4, missing: 1, comment: '' }, 5), /Explain/)
  assert.match(outletVerificationEntryError({ status: 'missing', received: 1, missing: 4, comment: 'Lost' }, 5), /missing line/)
})
