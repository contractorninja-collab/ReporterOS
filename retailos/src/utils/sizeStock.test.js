import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileSizeStock } from './sizeStock.js'

test('marks size stock unreliable when size rows overstate the canonical total', () => {
  const result = reconcileSizeStock([
    { size: '30', qty: 2, sold: 0, remaining: 2 },
    { size: '32', qty: 3, sold: 2, remaining: 1 },
  ], 1)

  assert.equal(result.sizeTotal, 3)
  assert.equal(result.totalStock, 1)
  assert.equal(result.isReliable, false)
})

test('keeps a reconciled size breakdown available', () => {
  const result = reconcileSizeStock([
    { size: '30', qty: 2, sold: 2, remaining: 0 },
    { size: '32', qty: 3, sold: 2, remaining: 1 },
  ], 1)

  assert.equal(result.isReliable, true)
  assert.deepEqual(result.rows.map((row) => row.remaining), [0, 1])
})
