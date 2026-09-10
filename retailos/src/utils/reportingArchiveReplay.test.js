import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCSVText } from './csvParser.js'
import {
  buildReportingArchiveReplay,
  changedSkuTotals,
  preserveCurrentSalesWhenArchiveIsLower,
  repairReportingRowsFromFile,
} from './reportingArchiveReplay.js'

const header = 'barcode,sku,size,price_sold,sold_quantity,sale_date,transaction_type'
const csv = (...lines) => parseCSVText([header, ...lines].join('\n'))

test('repairs an Excel-filled year series only when the file has one clear date anchor', () => {
  const rows = csv(
    '4070032553450,ANCHOR,BV,20,1,26.08.2026,SALE',
    '4070032553450,091180-15,BV,32,1,26.08.127478,SALE',
  )
  const result = repairReportingRowsFromFile(rows)
  assert.equal(result.repaired.length, 1)
  assert.equal(result.repaired[0].sku, '091180-15')
  assert.equal(result.repaired[0].repairedDate, '2026-08-26')
})

test('does not guess a malformed date when a file contains more than one valid sales day', () => {
  const rows = csv(
    '1,A,M,10,1,25.08.2026,SALE',
    '2,B,M,10,1,26.08.2026,SALE',
    '3,C,M,10,1,26.08.99999,SALE',
  )
  const result = repairReportingRowsFromFile(rows)
  assert.equal(result.repaired.length, 0)
  assert.equal(result.rows[2].sale_date, null)
})

test('builds one replay across files and sums legitimate same-day sales', () => {
  const sources = [
    { filename: 'one.csv', hash: 'one', rows: csv('1,SKU-1,M,10,1,26.08.2026,SALE') },
    { filename: 'two.csv', hash: 'two', rows: csv('1,SKU-1,M,20,2,26.08.2026,SALE') },
  ]
  const result = buildReportingArchiveReplay(sources, [{ sku: 'SKU-1', size: 'M', product_name: 'Product' }])
  assert.equal(result.salesEvents.length, 1)
  assert.equal(result.salesEvents[0].units_sold, 3)
  assert.equal(result.salesEvents[0].revenue, 30)
})

test('skips exact duplicate files before replaying their rows', () => {
  const rows = csv('1,SKU-1,M,10,1,26.08.2026,SALE')
  const result = buildReportingArchiveReplay([
    { filename: 'first.csv', hash: 'same', rows },
    { filename: 'copy.csv', hash: 'same', rows },
  ], [{ sku: 'SKU-1', size: 'M' }])
  assert.equal(result.salesEvents[0].units_sold, 1)
  assert.deepEqual(result.skippedDuplicateFiles, ['copy.csv'])
})

test('keeps a corrected file and skips its Excel-corrupted copy', () => {
  const corrected = csv(
    '4070032553450,091180-15,X,32,1,26.08.2026,SALE',
    '4067980000001,OTHER,M,20,1,26.08.2026,SALE',
  )
  const corruptedCopy = csv(
    '4.07003E+12,091180-15,X,32,1,26.08.127478,SALE',
    '4.06798E+12,OTHER,M,20,1,26.08.129302,SALE',
  )
  const result = buildReportingArchiveReplay([
    { filename: 'corrected.csv', hash: 'corrected', rows: corrected },
    { filename: 'corrupted-copy.csv', hash: 'corrupt', rows: corruptedCopy },
  ], [{ sku: '091180-15', size: 'X' }, { sku: 'OTHER', size: 'M' }])
  assert.equal(result.salesEvents.find((row) => row.sku === '091180-15').units_sold, 1)
  assert.deepEqual(result.skippedCorrectedCopies, ['corrupted-copy.csv'])
  assert.equal(result.repairedRows.length, 0)
})

test('removes corrected overlap but keeps a legitimate extra row from the damaged file', () => {
  const corrected = csv(
    '1,A,M,10,1,26.08.2026,SALE',
    '2,B,M,10,1,26.08.2026,SALE',
    '3,C,M,10,1,26.08.2026,SALE',
    '4,D,M,10,1,26.08.2026,SALE',
    '5,091180-15,BV,32,1,26.08.2026,SALE',
  )
  const damagedWithExtra = csv(
    '1,A,M,10,1,26.08.2026,SALE',
    '2,B,M,10,1,26.08.1622,SALE',
    '3,C,M,10,1,26.08.3446,SALE',
    '4,D,M,10,1,26.08.5270,SALE',
    '5,091180-15,BV,32,1,26.08.127478,SALE',
    '6,EXTRA,M,15,1,27.08.2026,SALE',
  )
  const known = ['A', 'B', 'C', 'D', '091180-15', 'EXTRA'].map((sku) => ({ sku, size: sku === '091180-15' ? 'BV' : 'M' }))
  const result = buildReportingArchiveReplay([
    { filename: 'corrected.csv', hash: 'corrected', rows: corrected },
    { filename: 'damaged-with-extra.csv', hash: 'damaged', rows: damagedWithExtra },
  ], known)
  assert.equal(result.salesEvents.find((row) => row.sku === '091180-15').units_sold, 1)
  assert.equal(result.salesEvents.find((row) => row.sku === 'EXTRA').units_sold, 1)
  assert.deepEqual(result.skippedCorrectedRows, [{
    filename: 'damaged-with-extra.csv', correctedBy: 'corrected.csv', rows: 5,
  }])
})

test('restores all ten sales for 091180-15 including the recoverable damaged line', () => {
  const sources = []
  for (let day = 17; day <= 25; day += 1) {
    sources.push({
      filename: `day-${day}.csv`,
      hash: `day-${day}`,
      rows: csv(`4070032553450,091180-15,BV,32,1,${day}.08.2026,SALE`),
    })
  }
  sources.push({
    filename: 'damaged.csv',
    hash: 'damaged',
    rows: csv(
      '1,ANCHOR,BV,10,1,26.08.2026,SALE',
      '4.07003E+12,091180-15,BV,32,1,26.08.127478,SALE',
    ),
  })
  const result = buildReportingArchiveReplay(sources, [
    { sku: '091180-15', size: 'BV', product_name: 'Puma Plus Backpack' },
    { sku: 'ANCHOR', size: 'BV' },
  ])
  const event = result.salesEvents.filter((row) => row.sku === '091180-15')
  assert.equal(event.reduce((sum, row) => sum + row.units_sold, 0), 10)
  assert.equal(result.repairedRows.length, 1)
  assert.equal(result.invalidRows.length, 0)
})

test('excludes a late archive sale that would exceed imported stock', () => {
  const sources = []
  for (let day = 17; day <= 27; day += 1) {
    sources.push({
      filename: day === 27 ? 'RetailOS_Reporting_Import_Template _55_.csv' : `day-${day}.csv`,
      importedAt: `2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`,
      hash: `day-${day}`,
      rows: csv(`4070032553450,091180-15,X,32,1,${day}.08.2026,SALE`),
    })
  }
  const result = buildReportingArchiveReplay(sources, [
    { sku: '091180-15', size: 'BV', quantity: 10, product_name: 'Puma Plus Backpack' },
  ], { inventoryBySku: { '091180-15': 10 } })
  const total = result.salesEvents.reduce((sum, row) => sum + row.units_sold, 0)
  assert.equal(total, 10)
  assert.equal(result.sourceRows.length, 10)
  assert.equal(result.cappedRows.length, 1)
  assert.equal(result.cappedRows[0].eventDate, '2026-08-27')
  assert.equal(result.cappedRows[0].excludedUnits, 1)
})

test('reports SKU totals that will change', () => {
  const before = new Map([['SKU-1', 1], ['SKU-2', 2]])
  const changed = changedSkuTotals(before, [
    { sku: 'SKU-1', units_sold: 4 },
    { sku: 'SKU-2', units_sold: 2 },
  ])
  assert.deepEqual(changed, [{ sku: 'SKU-1', currentSold: 1, archiveSold: 4, difference: 3 }])
})

test('keeps trusted current sales when an archive has a lower total', () => {
  const before = new Map([['LOWER', 5], ['HIGHER', 1], ['SAME', 2]])
  const protectedReplay = preserveCurrentSalesWhenArchiveIsLower([
    { sku: 'LOWER', units_sold: 3 },
    { sku: 'HIGHER', units_sold: 4 },
    { sku: 'SAME', units_sold: 2 },
  ], before)

  assert.deepEqual(protectedReplay.salesEvents, [
    { sku: 'HIGHER', units_sold: 4 },
    { sku: 'SAME', units_sold: 2 },
  ])
  assert.deepEqual(protectedReplay.preservedCurrentSkus, [{
    sku: 'LOWER', currentSold: 5, archiveSold: 3, difference: -2,
  }])
  assert.deepEqual(changedSkuTotals(before, protectedReplay.salesEvents), [{
    sku: 'HIGHER', currentSold: 1, archiveSold: 4, difference: 3,
  }])
})

test('returns the accepted archive rows used to calculate each SKU total', () => {
  const result = buildReportingArchiveReplay([
    {
      importId: 'import-1',
      filename: 'day.csv',
      hash: 'day',
      orphaned: true,
      rows: csv('1,SKU-1,M,25,2,26.08.2026,SALE'),
    },
  ], [{ sku: 'SKU-1', size: 'M' }])

  assert.deepEqual(result.sourceRows, [{
    sku: 'SKU-1',
    size: 'M',
    filename: 'day.csv',
    importId: 'import-1',
    importedAt: '',
    orphaned: true,
    row: 2,
    eventDate: '2026-08-26',
    sourceSaleDate: '26.08.2026',
    unitsSold: 2,
    priceSold: 25,
    revenue: 25,
    movement: 'SALE',
    repaired: false,
    sourceSku: 'SKU-1',
  }])
})

test('matches a shortened leading-zero return before checking stock capacity', () => {
  const result = buildReportingArchiveReplay([
    {
      filename: 'sales.csv',
      hash: 'sales',
      rows: csv('1,091180-15,X,320,10,26.08.2026,SALE'),
    },
    {
      filename: 'returns.csv',
      hash: 'returns',
      rows: csv('1,91180-15,X,-32,-1,26.08.2026,RETURN'),
    },
    {
      filename: 'resale.csv',
      hash: 'resale',
      rows: csv('1,091180-15,X,32,1,27.08.2026,SALE'),
    },
  ], [{ sku: '091180-15', size: 'X', quantity: 10 }], { inventoryBySku: { '091180-15': 10 } })

  assert.equal(result.salesEvents.reduce((sum, row) => sum + row.units_sold, 0), 10)
  assert.equal(result.cappedRows.length, 0)
  assert.deepEqual(result.normalizedSkuRows, [{
    filename: 'returns.csv', row: 2, sourceSku: '91180-15', sku: '091180-15',
  }])
  assert.equal(result.sourceRows.find((row) => row.movement === 'RETURN').unitsSold, -1)
})
