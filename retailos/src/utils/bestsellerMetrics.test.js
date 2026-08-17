import test from 'node:test'
import assert from 'node:assert/strict'
import { enrichBestsellerProducts, summarizeBestsellerSalesRows } from './bestsellerMetrics.js'

test('adds period return units and net revenue to a bestseller product', () => {
  const [product] = enrichBestsellerProducts(
    [{ sku: '182959-20014', product_name: 'Diadora T-Shirt Run Valley' }],
    {
      '182959-20014': {
        sold_qty: 1,
        revenue: 24.01,
        return_units: 1,
      },
    },
  )

  assert.equal(product._periodSold, 1)
  assert.equal(product._periodRevenue, 24.01)
  assert.equal(product.netRevenue, 24.01)
  assert.equal(product.returnsCount, 1)
})

test('summarizes the same positive signed SKU rows used by Bestsellers', () => {
  const totals = summarizeBestsellerSalesRows([
    { sku: 'FW26-A', sold_qty: 40, revenue: 2000, return_units: 2 },
    { sku: 'FW26-B', sold_qty: 4, revenue: 180, return_units: 0 },
    { sku: 'SS26-RETURN', sold_qty: -6, revenue: -300, return_units: 6 },
    { sku: 'EVEN-EXCHANGE', sold_qty: 0, revenue: 0, return_units: 1 },
  ])

  assert.deepEqual(totals, {
    units: 44,
    revenue: 2180,
    returnUnits: 2,
  })
})

test('accepts the Bestsellers sales map shape', () => {
  const totals = summarizeBestsellerSalesRows({
    A: { sold_qty: 3, revenue: 120, return_units: 1 },
    B: { sold_qty: -1, revenue: -40, return_units: 1 },
  })

  assert.deepEqual(totals, { units: 3, revenue: 120, returnUnits: 1 })
})
