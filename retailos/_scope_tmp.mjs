import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const db = new Database('retailos.db', { readonly: true })

// Replicate the derived per-(sku,size) average from sales_events
const ev = db.prepare(`
  SELECT sku, size, SUM(units_sold) units, SUM(revenue) revenue
  FROM sales_events GROUP BY sku, size
`).all()
const avg = new Map()
for (const r of ev) {
  const u = Number(r.units) || 0
  if (u <= 0) continue
  avg.set(`${r.sku}\u0000${String(r.size ?? '').trim()}`, Math.round((Number(r.revenue) || 0) / u * 100) / 100)
}

const skus = db.prepare('SELECT sku, size, sold_quantity, price_sold FROM skus WHERE deleted_at IS NULL').all()
let sizeRowsWithSales = 0, sizeRowsCorrected = 0
const correctedProducts = new Set()
for (const s of skus) {
  const d = avg.get(`${s.sku}\u0000${String(s.size ?? '').trim()}`)
  if (d != null && d > 0) {
    sizeRowsWithSales++
    if (Math.abs((Number(s.price_sold) || 0) - d) > 0.01) {
      sizeRowsCorrected++
      correctedProducts.add(s.sku)
    }
  }
}
console.log('Size rows that have sales in ledger:', sizeRowsWithSales)
console.log('Size rows whose stored price_sold was wrong (now corrected):', sizeRowsCorrected)
console.log('Distinct products affected by the correction:', correctedProducts.size)
db.close()
