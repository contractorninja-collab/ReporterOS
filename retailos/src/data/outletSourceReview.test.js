import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { buildOutletSourceReview, buildOutletInventory } from '../utils/outletHub.js'

const dataDir = mkdtempSync(join(tmpdir(), 'retailos-outlet-review-'))
process.env.DATA_DIR = dataDir
process.env.RETAILOS_SKIP_STARTUP_BACKFILLS = '1'
const db = await import('./db.js')
after(() => {
  db.closeDatabaseForTests()
  delete process.env.DATA_DIR
  delete process.env.RETAILOS_SKIP_STARTUP_BACKFILLS
  assert.ok(resolve(dataDir).startsWith(resolve(tmpdir()) + sep))
  rmSync(dataDir, { recursive: true, force: true })
})

function sale(id, codes = ['FN3514-077', '180676-D1245', 'JP5924']) {
  return db.insertMarkdownList({
    id, title: 'August markdown', kind: 'sale', status: 'completed', createdAt: '2026-08-27T10:00:00Z',
    items: codes.map((skuCode) => ({ skuCode, productName: skuCode, salePct: 20 })),
    item_statuses: Object.fromEntries(codes.map((code) => [code, Object.fromEntries(
      ['Ring Mall', 'Village', 'E-commerce'].map((shop) => [shop, { status: 'tagged', markedBy: 'staff' }]),
    )])),
  })
}

const source = sale('legacy-source')
const received = db.insertOutletTransfer({ id: 'real-transfer', status: 'received', items: [{ skuCode: 'JP5924', quantity: 1 }] })
db.insertMarkdownList({ id: 'unconfirmed-sale', items: [{ skuCode: 'OTHER' }] })
db.insertImportRecord({ id: 'review-import', filename: 'review.csv', date: '2026-08-01T00:00:00Z', count: 1, totalUnits: 6 })
db.insertSkus([{
  id: 'review-product', barcode: 'review-product', sku: 'FN3514-077', product_name: 'Nike shorts', size: 'M',
  quantity: 6, sold_quantity: 0, price_sold: 0, price_tag: 40, cost_price: 20,
  import_date: '2026-08-01T00:00:00Z', season: 'SS26', gender: 'M', category: 'Apparel', brand: 'Nike', _importId: 'review-import',
}])
db.applySaleToSkus(source.id, source.items)

test('captures historic markdown sources once and never flags later normal markdown work', () => {
  assert.equal(db.captureLegacyOutletSourcesForReview(), 1)
  assert.equal(db.getMarkdownListById(source.id).outlet_legacy_review, 1)
  assert.equal(db.getMarkdownListById('unconfirmed-sale').outlet_legacy_review, 0)
  const later = sale('new-normal-sale', ['NEW'])
  assert.equal(db.captureLegacyOutletSourcesForReview(), 0)
  assert.equal(db.getMarkdownListById(later.id).outlet_legacy_review, 0)
})

test('review exposes the actual source and excludes SKUs backed by a received transfer', () => {
  const groups = buildOutletSourceReview({ skus: db.getAllSkus(), transfers: [received], markdownLists: db.getAllMarkdownLists() })
  assert.equal(groups.length, 1)
  assert.equal(groups[0].id, source.id)
  assert.deepEqual(groups[0].items.map((item) => item.sku), ['FN3514-077', '180676-D1245'])
  assert.deepEqual(buildOutletInventory({ skus: db.getAllSkus(), transfers: [received], markdownLists: db.getAllMarkdownLists() }).map((row) => row.sku), ['JP5924'])
})

test('removal persists, records the actor, and preserves stock, prices, markdown work and real transfers', () => {
  const before = db.getMarkdownListById(source.id)
  const stockBefore = db.getAllSkus()
  const removed = db.removeIncorrectOutletEntry(source.id, 'executive-1')
  assert.equal(removed.removed, true)
  assert.ok(removed.list.outlet_review_removed_at)
  assert.equal(removed.list.outlet_review_removed_by, 'executive-1')
  assert.deepEqual(removed.list.items, before.items)
  assert.deepEqual(removed.list.item_statuses, before.item_statuses)
  assert.equal(removed.list.status, before.status)
  assert.deepEqual(db.getAllSkus(), stockBefore)
  assert.equal(db.getOutletTransferById(received.id).items.length, 1)
  assert.deepEqual(buildOutletSourceReview({ skus: stockBefore, transfers: [received], markdownLists: db.getAllMarkdownLists() }), [])
  const retry = db.removeIncorrectOutletEntry(source.id, 'executive-2')
  assert.equal(retry.removed, false)
  assert.equal(retry.list.outlet_review_removed_by, 'executive-1')
})

test('the review-removal action cannot delete ordinary markdown lists or real transfers', () => {
  assert.throws(() => db.removeIncorrectOutletEntry('new-normal-sale', 'executive-1'), { statusCode: 409 })
  assert.throws(() => db.removeIncorrectOutletEntry(received.id, 'executive-1'), { statusCode: 404 })
  assert.ok(db.getMarkdownListById('new-normal-sale'))
  assert.ok(db.getOutletTransferById(received.id))
})
