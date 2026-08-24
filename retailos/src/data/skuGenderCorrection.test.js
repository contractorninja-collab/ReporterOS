import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-gender-correction-'))
process.env.DATA_DIR = dataDir
const db = await import('./db.js')

function importedSku({ id, importId, size, quantity, gender = 'K' }) {
  return {
    id,
    barcode: id,
    sku: 'SKU-GENDER-1',
    product_name: 'Gender correction test product',
    size,
    price_sold: 0,
    price_tag: 100,
    cost_price: 40,
    quantity,
    sold_quantity: 0,
    import_date: '2026-08-01T00:00:00.000Z',
    gender,
    season: 'FW26',
    category: 'Apparel',
    brand: 'Test Brand',
    _importId: importId,
  }
}

test('corrects every size and intake line, then protects the correction from later imports', () => {
  db.insertImportRecord({ id: 'import-gender-1', filename: 'first.csv', date: '2026-08-01T00:00:00.000Z', count: 2, totalUnits: 5 })
  db.insertSkus([
    importedSku({ id: 'gender-s', importId: 'import-gender-1', size: 'S', quantity: 2 }),
    importedSku({ id: 'gender-m', importId: 'import-gender-1', size: 'M', quantity: 3 }),
  ])

  const correction = db.correctSkuGender('SKU-GENDER-1', 'F', { id: 'manager-1', name: 'Manager' })
  assert.deepEqual(correction.previous_genders, ['K'])
  assert.equal(correction.gender, 'F')
  assert.equal(correction.skuRowsUpdated, 2)
  assert.equal(correction.importLineRowsUpdated, 2)
  assert.ok(db.getAllSkus().filter((row) => row.sku === 'SKU-GENDER-1').every((row) => row.gender === 'F'))

  db.insertImportRecord({ id: 'import-gender-2', filename: 'later.csv', date: '2026-08-15T00:00:00.000Z', count: 1, totalUnits: 4 })
  db.insertSkus([
    importedSku({ id: 'gender-l', importId: 'import-gender-2', size: 'L', quantity: 4, gender: 'K' }),
  ])

  const catalogRows = db.getAllSkus().filter((row) => row.sku === 'SKU-GENDER-1')
  assert.equal(catalogRows.length, 3)
  assert.ok(catalogRows.every((row) => row.gender === 'F'))

  const report = db.getProductNameReport('SKU-GENDER-1')
  assert.equal(report.rows[0].gender, 'F')
  assert.equal(report.rows[0].genderBucket, 'Women')
  assert.equal(report.byGender.Women.imported, 9)
  assert.equal(report.byGender.Kids.imported, 0)
})

test('rejects invalid gender values and unknown SKUs', () => {
  assert.throws(() => db.correctSkuGender('SKU-GENDER-1', 'Female'), /must be M, F, K, or U/)
  assert.throws(() => db.correctSkuGender('MISSING-SKU', 'F'), /SKU not found/)
})

test.after(() => {
  db.closeDatabaseForTests()
  fs.rmSync(dataDir, { recursive: true, force: true })
})
