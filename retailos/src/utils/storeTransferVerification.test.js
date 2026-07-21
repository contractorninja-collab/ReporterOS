import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVerificationEntry,
  flattenTransferLines,
  getPhaseLines,
  isPhaseComplete,
  transferLineKey,
  verificationEntryError,
} from './storeTransferVerification.js'

const transfer = {
  items: [{ skuCode: 'SKU-1', productName: 'Runner', sizeBreakdown: [{ size: '41', qty: 3 }, { size: '42', qty: 1 }] }],
}

test('flattens size quantities into deterministic keys', () => {
  assert.deepEqual(flattenTransferLines(transfer.items), [
    { key: 'SKU-1|41', skuCode: 'SKU-1', productName: 'Runner', size: '41', expected: 3 },
    { key: 'SKU-1|42', skuCode: 'SKU-1', productName: 'Runner', size: '42', expected: 1 },
  ])
  assert.equal(transferLineKey(' SKU-1 ', ''), 'SKU-1|One Size')
})

test('builds full, partial, and zero confirmations', () => {
  assert.equal(buildVerificationEntry({ expected: 3, confirmed: 3 }).status, 'done')
  assert.deepEqual(
    buildVerificationEntry({ expected: 3, confirmed: 2, comment: 'One damaged', updatedBy: 'u1', updatedAt: 'now' }),
    { expected: 3, confirmed: 2, missing: 1, status: 'partial', comment: 'One damaged', updatedBy: 'u1', updatedAt: 'now' },
  )
  assert.equal(buildVerificationEntry({ expected: 3, confirmed: 0, comment: 'Not found' }).status, 'missing')
})

test('requires a reason for every short size', () => {
  const partial = buildVerificationEntry({ expected: 3, confirmed: 2 })
  assert.equal(verificationEntryError(partial, 3), 'Explain the missing quantity.')
  assert.equal(verificationEntryError({ ...partial, comment: 'Short stock' }, 3), '')
  assert.equal(verificationEntryError(null, 3), 'This size has not been confirmed.')
})

test('receiver expectations use actual sent quantities and skip zero-sent sizes', () => {
  const sent = {
    'SKU-1|41': buildVerificationEntry({ expected: 3, confirmed: 2, comment: 'One missing' }),
    'SKU-1|42': buildVerificationEntry({ expected: 1, confirmed: 0, comment: 'Not available' }),
  }
  const receiving = { ...transfer, send_item_statuses: sent }
  assert.deepEqual(getPhaseLines(receiving, 'receive').map((line) => line.expected), [2, 0])
  const received = {
    'SKU-1|41': buildVerificationEntry({ expected: 2, confirmed: 2, phase: 'receive' }),
  }
  assert.equal(isPhaseComplete(receiving, 'receive', received), true)
})

test('all applicable lines must be explicitly resolved', () => {
  const statuses = {
    'SKU-1|41': buildVerificationEntry({ expected: 3, confirmed: 3 }),
    'SKU-1|42': buildVerificationEntry({ expected: 1, confirmed: 0, comment: 'Not found' }),
  }
  assert.equal(isPhaseComplete(transfer, 'send', statuses), true)
  assert.equal(isPhaseComplete(transfer, 'send', { 'SKU-1|41': statuses['SKU-1|41'] }), false)
})
