import test from 'node:test'
import assert from 'node:assert/strict'
import { filterProductsByActiveSeason } from './seasons.js'

const products = [
  {
    sku: 'FW26-REAL',
    season: 'FW26',
    active_season: 'FW26',
    active_season_has_shipment: true,
  },
  {
    sku: 'SS26-CARRYOVER',
    season: 'SS26',
    active_season: 'FW26',
    active_season_has_shipment: false,
  },
  { sku: 'SS26-REAL', season: 'SS26' },
]

test('catalog product filtering updates to the selected shipment-aware season', () => {
  assert.deepEqual(
    filterProductsByActiveSeason(products, 'FW26').map((row) => row.sku),
    ['FW26-REAL'],
  )
  assert.deepEqual(
    filterProductsByActiveSeason(products, 'SS26').map((row) => row.sku),
    ['SS26-CARRYOVER', 'SS26-REAL'],
  )
})

test('catalog product filtering keeps every product for All seasons', () => {
  assert.equal(filterProductsByActiveSeason(products, 'All').length, 3)
})
