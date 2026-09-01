import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'retailos-outlet-web-location-'))
process.env.DATA_DIR = dataDir
const db = await import(`./db.js?outlet-web-location-test=${Date.now()}`)

after(() => {
  db.closeDatabaseForTests()
  delete process.env.DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})

test('creates one Change Location Web item per original SKU and keeps the sale list separate', () => {
  const transferId = 'outlet-web-location-transfer'
  db.insertOutletTransfer({
    id: transferId,
    createdBy: 'manager-1',
    fromShop: 'Ring Mall',
    status: 'received',
    receivedAt: '2026-08-28T10:00:00.000Z',
    items: [
      {
        skuCode: 'SKU-FULL',
        productName: 'Fully received product',
        sizeBreakdown: [{ size: 'M', qty: 2 }, { size: 'L', qty: 3 }],
      },
      {
        skuCode: 'SKU-MISSING',
        productName: 'Fully missing product',
        quantity: 5,
        sizes: 'One Size',
      },
      {
        skuCode: 'SKU-PARTIAL',
        productName: 'Partially received product',
        quantity: 4,
        sizes: '42',
      },
      {
        skuCode: 'SKU-FULL',
        productName: 'Duplicate SKU line',
        quantity: 1,
        sizes: 'XL',
      },
    ],
    item_statuses: {
      'SKU-FULL|M': { status: 'done', expected: 2, received: 2, missing: 0, comment: '' },
      'SKU-FULL|L': { status: 'done', expected: 3, received: 3, missing: 0, comment: '' },
      'SKU-FULL|XL': { status: 'done', expected: 1, received: 1, missing: 0, comment: '' },
      'SKU-MISSING|One Size': { status: 'missing', expected: 5, received: 0, missing: 5, comment: 'Box missing' },
      'SKU-PARTIAL|42': { status: 'partial', expected: 4, received: 1, missing: 3, comment: 'Three not found' },
    },
  })

  const location = db.createLocationChangeListForOutletTransfer(transferId, 'outlet-1', 'exec-1,exec-2')
  assert.equal(location.created, true)
  assert.equal(location.list.kind, 'location_change')
  assert.equal(location.list.title, 'Change Location Web')
  assert.equal(location.list.sourceTransferId, transferId)
  assert.deepEqual(location.items.map((item) => item.skuCode), ['SKU-FULL', 'SKU-MISSING', 'SKU-PARTIAL'])

  const retry = db.createLocationChangeListForOutletTransfer(transferId, 'outlet-1', 'exec-1,exec-2')
  assert.equal(retry.created, false)
  assert.equal(retry.list.id, location.list.id)
  assert.equal(db.getAllMarkdownLists().filter((list) => list.kind === 'location_change').length, 1)

  const sale = db.createEcommerceSaleListForOutletTransfer(transferId, 'outlet-1', 'exec-1,exec-2')
  assert.equal(sale.created, true)
  assert.equal(sale.list.kind, 'ecommerce_sale')
  assert.deepEqual(sale.items.map((item) => item.skuCode).sort(), ['SKU-FULL', 'SKU-PARTIAL'])
})

test('final marking completes the checklist and unmarking reopens it', () => {
  const list = db.getLocationChangeListBySourceTransfer('outlet-web-location-transfer')
  for (const item of list.items) {
    db.toggleMarkdownListItemTagged(list.id, item.skuCode, 'E-commerce', 'exec-1')
  }

  const completed = db.getMarkdownListById(list.id)
  assert.equal(completed.status, 'completed')
  assert.ok(completed.completedAt)

  const reopened = db.toggleMarkdownListItemTagged(list.id, 'SKU-MISSING', 'E-commerce', 'exec-2')
  assert.equal(reopened.status, 'pending')
  assert.equal(reopened.completedAt, null)
  assert.equal(reopened.item_statuses['SKU-MISSING'], undefined)

  const completedAgain = db.toggleMarkdownListItemTagged(list.id, 'SKU-MISSING', 'E-commerce', 'exec-2')
  assert.equal(completedAgain.status, 'completed')
  assert.ok(completedAgain.completedAt)
  assert.equal(completedAgain.item_statuses['SKU-MISSING']['E-commerce'].markedBy, 'exec-2')
})

test('deleting the transfer removes both linked lists and web-location notifications', () => {
  const transferId = 'outlet-web-location-transfer'
  db.insertNotification({
    type: 'outlet_web_location_ready',
    title: 'Change Location Web',
    message: 'Products need a website location update.',
    userId: 'exec-1',
    relatedId: transferId,
  })

  assert.equal(db.deleteOutletTransfer(transferId), 1)
  assert.equal(db.getLocationChangeListBySourceTransfer(transferId), null)
  assert.equal(db.getEcommerceSaleListBySourceTransfer(transferId), null)
  assert.equal(
    db.getNotifications().some((notification) => notification.type === 'outlet_web_location_ready' && notification.relatedId === transferId),
    false,
  )
})
