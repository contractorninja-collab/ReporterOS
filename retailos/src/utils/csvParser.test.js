import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCSVText,
  parseReportingSaleDate,
  reportingSaleDateWasRepaired,
  validateReportingRow,
} from './csvParser.js'

test('repairs an accidental leading minus on a reporting date', () => {
  const parsed = parseReportingSaleDate('-15.07.2026')

  assert.ok(parsed instanceof Date)
  assert.equal(parsed.getFullYear(), 2026)
  assert.equal(parsed.getMonth(), 6)
  assert.equal(parsed.getDate(), 15)
  assert.equal(reportingSaleDateWasRepaired('-15.07.2026'), true)
})

test('keeps an XL return and L replacement sale valid in the same import', () => {
  const rows = parseCSVText([
    'barcode,sku,size,price_sold,sold_quantity,sale_date,transaction_type',
    '8054795356387,182959-20014,XL,-24,-1,-15.07.2026,RETURN',
    '8054795356400,182959-20014,L,24.01,1,15.07.2026,SALE',
  ].join('\n'))

  assert.equal(rows.length, 2)
  assert.equal(rows.every(validateReportingRow), true)
  assert.equal(rows[0].sale_date_repaired, true)
  assert.equal(rows[0].sold_quantity, -1)
  assert.equal(rows[0].transaction_type, 'RETURN')
  assert.equal(rows[1].sale_date_repaired, false)
  assert.equal(rows[1].sold_quantity, 1)
  assert.equal(rows[1].transaction_type, 'SALE')
})

test('still rejects unrelated invalid reporting dates', () => {
  const [row] = parseCSVText([
    'barcode,sku,size,price_sold,sold_quantity,sale_date,transaction_type',
    '8054795356387,182959-20014,XL,-24,-1,not-a-date,RETURN',
  ].join('\n'))

  assert.equal(row.sale_date, null)
  assert.equal(row.sale_date_repaired, false)
  assert.equal(validateReportingRow(row), false)
})
