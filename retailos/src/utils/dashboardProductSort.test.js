import test from 'node:test'
import assert from 'node:assert/strict'
import { sortDashboardProducts } from './dashboardProductSort.js'

const products = [
  { sku: 'B-2', product_name: 'Beta', last_shipment_date: '2026-07-18', price_tag: 80 },
  { sku: 'A-1', product_name: 'Alpha', last_import_date: '2026-07-20', price_tag: 120 },
  { sku: 'C-3', product_name: 'Charlie', import_date: '2026-07-10', price_tag: 40 },
]

test('sorts dashboard products by newest and oldest latest-shipment date', () => {
  assert.deepEqual(sortDashboardProducts(products, 'newest').map((p) => p.sku), ['A-1', 'B-2', 'C-3'])
  assert.deepEqual(sortDashboardProducts(products, 'oldest').map((p) => p.sku), ['C-3', 'B-2', 'A-1'])
})

test('falls back through invalid or missing shipment fields', () => {
  const rows = [
    { sku: 'FALLBACK', product_name: 'Fallback', last_shipment_date: 'invalid', last_import_date: '2026-07-15' },
    { sku: 'LATEST', product_name: 'Latest', last_shipment_date: '2026-07-16' },
    { sku: 'MISSING', product_name: 'Missing' },
  ]
  assert.deepEqual(sortDashboardProducts(rows, 'newest').map((p) => p.sku), ['LATEST', 'FALLBACK', 'MISSING'])
  assert.deepEqual(sortDashboardProducts(rows, 'oldest').map((p) => p.sku), ['FALLBACK', 'LATEST', 'MISSING'])
})

test('sorts by tag price and always places missing or zero prices last', () => {
  const rows = [
    ...products,
    { sku: 'ZERO', product_name: 'Zero', price_tag: 0 },
    { sku: 'MISSING', product_name: 'Missing' },
  ]
  assert.deepEqual(sortDashboardProducts(rows, 'cheapest').map((p) => p.sku), ['C-3', 'B-2', 'A-1', 'MISSING', 'ZERO'])
  assert.deepEqual(sortDashboardProducts(rows, 'expensive').map((p) => p.sku), ['A-1', 'B-2', 'C-3', 'MISSING', 'ZERO'])
})

test('breaks equal values by product name and then SKU without mutating input', () => {
  const rows = [
    { sku: 'A-10', product_name: 'Same', price_tag: 50 },
    { sku: 'A-2', product_name: 'Same', price_tag: 50 },
    { sku: 'B-1', product_name: 'Earlier', price_tag: 50 },
  ]
  const sorted = sortDashboardProducts(rows, 'cheapest')
  assert.deepEqual(sorted.map((p) => p.sku), ['B-1', 'A-2', 'A-10'])
  assert.deepEqual(rows.map((p) => p.sku), ['A-10', 'A-2', 'B-1'])
})
