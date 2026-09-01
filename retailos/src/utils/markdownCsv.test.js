import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMarkdownListCSV } from './markdownCsv.js'

test('exports list, SKU addition, completion, and per-lane dates without times', () => {
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

  assert.match(header, /^List Created Date,List Completed Date,SKU,SKU Added Date/)
  assert.match(header, /Ring Mall Tagged Date/)
  assert.match(row, /^2026-06-19,2026-06-19,SKU-1,2026-06-19/)
  assert.match(row, /Yes,2026-06-19/)
  assert.doesNotMatch(row, /T\d{2}:\d{2}/)
})
