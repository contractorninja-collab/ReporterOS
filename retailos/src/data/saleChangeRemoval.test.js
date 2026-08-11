import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'retailos-sale-removal-'))
process.env.DATA_DIR = dataDir
const db = await import(`./db.js?sale-removal-test=${Date.now()}`)

after(() => {
  db.closeDatabaseForTests()
  delete process.env.DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})

test('removing a sale item records its prior sale and actor, and discard restores it', () => {
  const skuCode = 'SALE-REMOVE-001'
  db.insertSkus([{
    sku: skuCode,
    size: 'M',
    product_name: 'Removal Test Product',
    brand: 'TEST BRAND',
    category: 'Apparel',
    quantity: 4,
    sold_quantity: 0,
    price_tag: 100,
    import_date: '2026-08-11T00:00:00.000Z',
  }])

  const saleItem = {
    skuCode,
    productName: 'Removal Test Product',
    brand: 'TEST BRAND',
    category: 'Apparel',
    priceTag: 100,
    salePct: 30,
    extraSalePct: 20,
    salePrice: 56,
    sizes: 'M',
  }
  const list = db.insertMarkdownList({
    id: 'sale-removal-list',
    title: 'SS26 Weekend Sale',
    shop: 'Ring Mall',
    createdBy: 'u-ceo',
    assignedTo: 'u-mgr-s1a',
    items: [saleItem],
  })
  db.applySaleToSkus(list.id, [saleItem])

  const result = db.removeMarkdownListItemFromSale(list.id, skuCode, 'u-coo')
  assert.equal(result.list.items.length, 0)
  assert.equal(result.report.createdBy, 'u-coo')
  assert.equal(result.report.listTitle, 'SS26 Weekend Sale')
  assert.deepEqual(result.report.changes[0], {
    changeType: 'removed',
    skuCode,
    productName: 'Removal Test Product',
    brand: 'TEST BRAND',
    sizes: 'M',
    priceTag: 100,
    oldSalePct: 30,
    newSalePct: 0,
    oldExtraSalePct: 20,
    newExtraSalePct: 0,
    oldSalePrice: 56,
    newSalePrice: 0,
    changedBy: 'u-coo',
    removedFromListId: list.id,
    removedFromListTitle: 'SS26 Weekend Sale',
    previousItem: saleItem,
  })

  const removedSku = db.getAllSkus().find((row) => row.sku === skuCode)
  assert.equal(removedSku.sale_active, 0)
  assert.equal(removedSku.sale_list_id, null)

  const restored = db.discardSaleChangeReportProduct(result.report.id, skuCode)
  assert.equal(restored.report, null)
  assert.equal(restored.list.items.length, 1)
  assert.equal(restored.list.items[0].salePct, 30)
  assert.equal(restored.list.items[0].extraSalePct, 20)

  const restoredSku = db.getAllSkus().find((row) => row.sku === skuCode)
  assert.equal(restoredSku.sale_active, 1)
  assert.equal(restoredSku.sale_percent, 30)
  assert.equal(restoredSku.sale_extra_percent, 20)
  assert.equal(restoredSku.sale_list_id, list.id)
})
