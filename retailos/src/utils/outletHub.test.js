import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOutletInventory, outletWebChecklistProgress, receivedTransferUnitsBySku } from './outletHub.js'

const transfers = [{
  id: 'received-1',
  status: 'received',
  fromShop: 'Ring Mall',
  items: [
    { skuCode: 'SKU-1', sizeBreakdown: [{ size: 'M', qty: 3 }, { size: 'L', qty: 2 }] },
    { skuCode: 'SKU-2', quantity: 2, sizes: 'One Size' },
  ],
  item_statuses: {
    'SKU-1|M': { status: 'partial', received: 2, missing: 1, expected: 3, comment: 'Missing' },
    'SKU-1|L': { status: 'done', received: 2, missing: 0, expected: 2, comment: '' },
    'SKU-2|One Size': { status: 'missing', received: 0, missing: 2, expected: 2, comment: 'Not found' },
  },
}]

test('counts verified received units without inflating shortages', () => {
  const units = receivedTransferUnitsBySku(transfers)
  assert.equal(units.get('SKU-1'), 4)
  assert.equal(units.get('SKU-2'), 0)
})

test('builds Outlet inventory across seasons and keeps missing products traceable', () => {
  const inventory = buildOutletInventory({
    skus: [
      { sku: 'SKU-1', size: 'M', quantity: 3, sold_quantity: 0, season: 'SS26', product_name: 'One' },
      { sku: 'SKU-1', size: 'L', quantity: 2, sold_quantity: 0, season: 'FW26', product_name: 'One' },
      { sku: 'SKU-2', quantity: 2, sold_quantity: 0, season: 'FW25', product_name: 'Two' },
    ],
    shipmentMeta: {},
    transfers,
    markdownLists: [],
  })

  assert.deepEqual(inventory.map((item) => item.sku), ['SKU-1', 'SKU-2'])
  assert.equal(inventory[0].outletUnits, 4)
  assert.equal(inventory[0].size, 'M, L')
  assert.equal(inventory[1].outletUnits, 0)
})

test('summarizes Change Location Web work', () => {
  const progress = outletWebChecklistProgress([{
    id: 'web-1',
    kind: 'location_change',
    items: [{ skuCode: 'A' }, { skuCode: 'B' }],
    item_statuses: { A: { 'E-commerce': { status: 'tagged' } } },
  }, { id: 'sale-1', kind: 'sale', items: [{ skuCode: 'X' }] }])

  assert.equal(progress.lists.length, 1)
  assert.equal(progress.markedItems, 1)
  assert.equal(progress.remainingItems, 1)
  assert.equal(progress.pendingLists, 1)
})
