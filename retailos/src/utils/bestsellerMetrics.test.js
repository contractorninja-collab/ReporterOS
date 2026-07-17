import test from 'node:test'
import assert from 'node:assert/strict'
import { enrichBestsellerProducts } from './bestsellerMetrics.js'

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
