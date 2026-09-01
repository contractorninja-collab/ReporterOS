import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMarkdownListCSV } from './markdownCsv.js'

test('exports list, completion, and per-lane markdown timestamps', () => {
  const csv = buildMarkdownListCSV({
    kind: 'sale',
    createdAt: '2026-06-19T09:28:50.499Z',
    completedAt: '2026-06-19T09:29:11.578Z',
    items: [{
      skuCode: 'SKU-1', addedAt: '2026-06-19T09:29:02.186Z', productName: 'Test product', brand: 'Brand', category: 'Footwear',
      gender: 'M', season: 'SS26', priceTag: 100, salePct: 30, extraSalePct: 20,
      salePrice: 56, sizes: '42',
    }],
    item_statuses: {
      'SKU-1': {
        'Ring Mall': { status: 'tagged', markedAt: '2026-06-19T09:29:07.706Z' },
      },
    },
  })
  const [header, row] = csv.split('\n')

  assert.match(header, /^List Created At \(UTC\),List Completed At \(UTC\),SKU,SKU Added At \(UTC\)/)
  assert.match(header, /Ring Mall Tagged At \(UTC\)/)
  assert.match(row, /^2026-06-19T09:28:50\.499Z,2026-06-19T09:29:11\.578Z,SKU-1,2026-06-19T09:29:02\.186Z/)
  assert.match(row, /Yes,2026-06-19T09:29:07\.706Z/)
})
