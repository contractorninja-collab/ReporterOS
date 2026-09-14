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

test('creates one Change Location Web item per received SKU without creating sale work', () => {
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
  assert.deepEqual(location.items.map((item) => item.skuCode), ['SKU-FULL', 'SKU-PARTIAL'])

  const retry = db.createLocationChangeListForOutletTransfer(transferId, 'outlet-1', 'exec-1,exec-2')
  assert.equal(retry.created, false)
  assert.equal(retry.list.id, location.list.id)
  assert.equal(db.getAllMarkdownLists().filter((list) => list.kind === 'location_change').length, 1)

  assert.equal(db.getEcommerceSaleListBySourceTransfer(transferId), null)
})

test('creates one combined E-commerce checklist after every store claim is received', () => {
  const groupId = 'outlet-claim-group'
  db.insertOutletTransfer({
    id: 'claim-ring', groupId, fromShop: 'Ring Mall', status: 'received',
    items: [
      { skuCode: 'RING-ONLY', productName: 'Ring item', quantity: 2 },
      { skuCode: 'VILLAGE-ONLY', productName: 'Village item', quantity: 2 },
    ],
    item_statuses: {
      'RING-ONLY|One Size': { status: 'done', received: 2, missing: 0 },
      'VILLAGE-ONLY|One Size': { status: 'missing', received: 0, missing: 2, comment: 'No stock' },
    },
  })
  db.insertOutletTransfer({
    id: 'claim-village', groupId, fromShop: 'Village', status: 'received',
    items: [
      { skuCode: 'RING-ONLY', productName: 'Ring item', quantity: 2 },
      { skuCode: 'VILLAGE-ONLY', productName: 'Village item', quantity: 2 },
    ],
    item_statuses: {
      'RING-ONLY|One Size': { status: 'missing', received: 0, missing: 2, comment: 'No stock' },
      'VILLAGE-ONLY|One Size': { status: 'partial', received: 1, missing: 1, comment: 'One available' },
    },
  })

  const location = db.createLocationChangeListForOutletGroup(groupId, 'outlet-1', 'marketing-1')
  assert.equal(location.created, true)
  assert.deepEqual(location.items.map((item) => item.skuCode).sort(), ['RING-ONLY', 'VILLAGE-ONLY'])
  assert.equal(location.list.assignedTo, 'marketing-1')

  const retry = db.createLocationChangeListForOutletGroup(groupId, 'outlet-1', 'marketing-1')
  assert.equal(retry.created, false)
  assert.equal(retry.list.id, location.list.id)
})

test('removes obsolete automatic Outlet sale work and keeps the web-location checklist', () => {
  const transferId = 'outlet-web-location-transfer'
  db.insertSkus([{
    sku: 'SKU-FULL', size: 'M', product_name: 'Fully received product', quantity: 6,
    sold_quantity: 0, price_tag: 100, import_date: '2026-08-28T00:00:00.000Z',
  }])
  const sale = db.insertMarkdownList({
    id: 'obsolete-outlet-sale', kind: 'ecommerce_sale', sourceTransferId: transferId,
    title: 'E-commerce Outlet Sale - 28 Aug 2026', shop: 'E-commerce',
    items: [{ skuCode: 'SKU-FULL', salePct: 20, priceTag: 100 }],
  })
  db.applySaleToSkus(sale.id, sale.items)
  db.insertAssignment({ id: 'obsolete-sale-task', type: 'sale', skuCode: sale.id, assignedTo: 'exec-1' })
  db.insertNotification({ type: 'ecommerce_sale_created', title: 'E-commerce Sale Created', relatedId: sale.id })

  assert.equal(db.removeAutomaticEcommerceOutletSaleLists(), 1)
  assert.equal(db.getMarkdownListById(sale.id), null)
  assert.ok(db.getLocationChangeListBySourceTransfer(transferId))
  assert.equal(db.getAllAssignments().some((assignment) => assignment.skuCode === sale.id), false)
  assert.equal(db.getNotifications().some((notification) => notification.relatedId === sale.id), false)
  assert.equal(db.getAllSkus().find((row) => row.sku === 'SKU-FULL').sale_active, 0)
})

test('final marking completes the checklist and unmarking reopens it', () => {
  const list = db.getLocationChangeListBySourceTransfer('outlet-web-location-transfer')
  for (const item of list.items) {
    db.toggleMarkdownListItemTagged(list.id, item.skuCode, 'E-commerce', 'exec-1')
  }

  const completed = db.getMarkdownListById(list.id)
  assert.equal(completed.status, 'completed')
  assert.ok(completed.completedAt)

  const reopened = db.toggleMarkdownListItemTagged(list.id, 'SKU-PARTIAL', 'E-commerce', 'exec-2')
  assert.equal(reopened.status, 'pending')
  assert.equal(reopened.completedAt, null)
  assert.equal(reopened.item_statuses['SKU-PARTIAL'], undefined)

  const completedAgain = db.toggleMarkdownListItemTagged(list.id, 'SKU-PARTIAL', 'E-commerce', 'exec-2')
  assert.equal(completedAgain.status, 'completed')
  assert.ok(completedAgain.completedAt)
  assert.equal(completedAgain.item_statuses['SKU-PARTIAL']['E-commerce'].markedBy, 'exec-2')
})

test('deleting the transfer removes its web-location checklist and notifications', () => {
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

test('startup preserves August 27 transfers and repairs existing website work without losing receipt history', () => {
  const transfer = db.insertOutletTransfer({
    id: 'real-aug27-transfer', createdAt: '2026-08-27T10:00:00.000Z',
    fromShop: 'Ring Mall', status: 'received', receivedAt: '2026-08-28T10:00:00.000Z',
    items: [{ skuCode: 'RECEIVED', quantity: 2 }, { skuCode: 'MISSING', quantity: 3 }],
    item_statuses: {
      'RECEIVED|One Size': { status: 'done', received: 2, missing: 0 },
      'MISSING|One Size': { status: 'missing', received: 0, missing: 3, comment: 'Not sent' },
    },
  })
  const marked = { 'E-commerce': { status: 'tagged', markedBy: 'exec-1', markedAt: '2026-08-28T11:00:00.000Z' } }
  const list = db.insertMarkdownList({
    id: 'old-web-checklist', kind: 'location_change', sourceTransferId: transfer.id,
    items: [{ skuCode: 'RECEIVED' }, { skuCode: 'MISSING' }],
    item_statuses: { RECEIVED: marked }, status: 'pending',
  })
  const sale = db.insertMarkdownList({ id: 'ordinary-sale', items: [{ skuCode: 'MISSING' }], kind: 'sale' })
  const result = db.runStartupDataBackfills()
  assert.deepEqual(result.failed, [])
  assert.equal(db.getOutletTransferById(transfer.id).items.length, 2)
  assert.equal(db.getOutletTransferById(transfer.id).createdAt, transfer.createdAt)
  const repaired = db.getMarkdownListById(list.id)
  assert.deepEqual(repaired.items.map((item) => item.skuCode), ['RECEIVED'])
  assert.deepEqual(repaired.item_statuses.RECEIVED, marked)
  assert.equal(repaired.status, 'completed')
  assert.equal(db.getMarkdownListById(sale.id).items.length, 1)
  assert.equal(db.repairOutletWebLocationLists(), 0)
})

test('all-missing and unreceived transfers do not create website location work', () => {
  for (const status of ['pending', 'completed', 'received']) {
    const transfer = db.insertOutletTransfer({
      id: `no-location-${status}`, status,
      items: [{ skuCode: 'MISSING', quantity: 3 }],
      item_statuses: { 'MISSING|One Size': { status: 'missing', received: 0, missing: 3 } },
    })
    assert.equal(db.createLocationChangeListForOutletTransfer(transfer.id).list, null)
  }
})
