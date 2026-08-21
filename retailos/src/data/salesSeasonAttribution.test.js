import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'retailos-sales-season-'))
process.env.DATA_DIR = dataDir
const db = await import(`./db.js?sales-season-test=${Date.now()}`)

after(() => {
  db.closeDatabaseForTests()
  delete process.env.DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})

function addIntake({ id, sku, season, date }) {
  db.insertImportRecord({ id, filename: `${season}.csv`, date, count: 1, totalUnits: 100 })
  db.insertSkus([{
    sku,
    size: 'M',
    product_name: `${sku} product`,
    category: 'Apparel',
    brand: 'TEST',
    season,
    quantity: 100,
    sold_quantity: 0,
    price_tag: 100,
    import_date: date,
    _importId: id,
  }])
}

test('sales move exclusively to the latest intake season and All remains additive', () => {
  addIntake({ id: 'ss-shared', sku: 'SHARED', season: 'SS26', date: '2026-01-10T00:00:00.000Z' })
  addIntake({ id: 'ss-only', sku: 'SS-ONLY', season: 'SS26', date: '2026-01-10T00:00:00.000Z' })
  addIntake({ id: 'fw-shared', sku: 'SHARED', season: 'FW26', date: '2026-08-01T00:00:00.000Z' })
  addIntake({ id: 'fw-only', sku: 'FW-ONLY', season: 'FW26', date: '2026-08-01T00:00:00.000Z' })

  db.insertSalesEvents([
    { sku: 'SHARED', size: 'M', units_sold: 2, revenue: 80, event_date: '2026-07-15' },
    { sku: 'SS-ONLY', size: 'M', units_sold: 20, revenue: 820, event_date: '2026-08-16' },
    { sku: 'SHARED', size: 'M', units_sold: 4, revenue: 169, event_date: '2026-08-16' },
    { sku: 'FW-ONLY', size: 'M', units_sold: 15, revenue: 600, event_date: '2026-08-16' },
  ])

  const all = db.getSalesBySeasonSku('2026-01-01', '2026-08-16', 'All')
  const ss26 = db.getSalesBySeasonSku('2026-01-01', '2026-08-16', 'SS26')
  const fw26 = db.getSalesBySeasonSku('2026-01-01', '2026-08-16', 'FW26')
  const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0)

  assert.equal(sum(ss26, 'sold_qty'), 22)
  assert.equal(sum(ss26, 'revenue'), 900)
  assert.equal(sum(fw26, 'sold_qty'), 19)
  assert.equal(sum(fw26, 'revenue'), 769)
  assert.equal(sum(all, 'sold_qty'), 41)
  assert.equal(sum(all, 'revenue'), 1669)
  assert.equal(sum(all, 'sold_qty'), sum(ss26, 'sold_qty') + sum(fw26, 'sold_qty'))
  assert.equal(sum(all, 'revenue'), sum(ss26, 'revenue') + sum(fw26, 'revenue'))

  assert.deepEqual(db.getSalesBySku('2026-08-16', '2026-08-16', 'SS26').map((row) => row.sku), ['SS-ONLY'])
  assert.deepEqual(
    db.getSalesBySku('2026-08-16', '2026-08-16', 'FW26').map((row) => row.sku).sort(),
    ['FW-ONLY', 'SHARED'],
  )
})
