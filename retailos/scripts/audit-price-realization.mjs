/**
 * audit-price-realization.mjs
 *
 * Read-only diagnostic. Compares each catalog SKU size row's stored `price_sold`
 * against the average selling price derived from the append-only `sales_events`
 * ledger (revenue / units, per sku+size). Reports how many size rows have ledger
 * sales, how many have a stored `price_sold` that drifts from the ledger average
 * by more than €0.01, and how many distinct products are affected.
 *
 * This mirrors the self-heal logic in `getAllSkus()` (src/data/db.js) so you can
 * see how much price drift exists before/after an import without changing data.
 *
 * SAFETY: opens the database in read-only mode and never writes. It only prints
 * a summary to stdout.
 *
 * Usage (from the retailos directory):
 *   node scripts/audit-price-realization.mjs
 *
 * Optional env:
 *   DATA_DIR   Directory containing retailos.db (defaults to the retailos root,
 *              matching src/data/db.js). Example:
 *                DATA_DIR=/var/lib/retailos node scripts/audit-price-realization.mjs
 */

import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..')
const DB_PATH = path.resolve(DATA_DIR, 'retailos.db')

const PRICE_DRIFT_TOLERANCE = 0.01

function sizeKey(sku, size) {
  return `${sku}\u0000${String(size ?? '').trim()}`
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })

try {
  // Replicate the derived per-(sku,size) average from sales_events.
  const ledgerRows = db.prepare(`
    SELECT sku, size, SUM(units_sold) AS units, SUM(revenue) AS revenue
    FROM sales_events
    GROUP BY sku, size
  `).all()

  const avgBySize = new Map()
  for (const r of ledgerRows) {
    const units = Number(r.units) || 0
    if (units <= 0) continue
    const avg = Math.round(((Number(r.revenue) || 0) / units) * 100) / 100
    avgBySize.set(sizeKey(r.sku, r.size), avg)
  }

  const skuRows = db.prepare(
    'SELECT sku, size, sold_quantity, price_sold FROM skus WHERE deleted_at IS NULL',
  ).all()

  let sizeRowsWithSales = 0
  let sizeRowsDrifted = 0
  const driftedProducts = new Set()
  for (const s of skuRows) {
    const derived = avgBySize.get(sizeKey(s.sku, s.size))
    if (derived != null && derived > 0) {
      sizeRowsWithSales++
      if (Math.abs((Number(s.price_sold) || 0) - derived) > PRICE_DRIFT_TOLERANCE) {
        sizeRowsDrifted++
        driftedProducts.add(s.sku)
      }
    }
  }

  console.log(`Database: ${DB_PATH}`)
  console.log('Size rows that have sales in ledger:', sizeRowsWithSales)
  console.log('Size rows whose stored price_sold drifts from the ledger:', sizeRowsDrifted)
  console.log('Distinct products affected by the drift:', driftedProducts.size)
} finally {
  db.close()
}
