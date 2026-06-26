import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, 'retailos.db')
const PHOTOS_DIR = path.resolve(__dirname, 'photos')
const OUT_PATH = path.resolve(__dirname, 'photo-match-report.xlsx')

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })

const skuRows = db.prepare(`
  SELECT sku, barcode, brand, product_name, gender, category
  FROM skus
`).all()

const skuMeta = new Map()
const skuSet = new Set()
const barcodeSet = new Set()
for (const r of skuRows) {
  const sku = String(r.sku || '').trim()
  const bc = String(r.barcode || '').trim()
  if (sku) {
    skuSet.add(sku)
    if (!skuMeta.has(sku)) skuMeta.set(sku, r)
  }
  if (bc) barcodeSet.add(bc)
}

const files = fs.readdirSync(PHOTOS_DIR).filter((f) => {
  const ext = path.extname(f).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)
})

const unmatched = []
const matched = []

for (const f of files) {
  const base = path.basename(f, path.extname(f)).trim()
  const ext = path.extname(f).slice(1).toLowerCase()
  if (skuSet.has(base)) {
    const meta = skuMeta.get(base) || {}
    matched.push({
      File: f,
      'SKU code': base,
      Extension: ext,
      Brand: meta.brand || '',
      'Product name': meta.product_name || '',
      Gender: meta.gender || '',
      Category: meta.category || '',
    })
  } else if (barcodeSet.has(base)) {
    matched.push({
      File: f,
      'SKU code': '(barcode)',
      Extension: ext,
      Brand: '',
      'Product name': '',
      Gender: '',
      Category: '',
    })
  } else {
    const stats = fs.statSync(path.join(PHOTOS_DIR, f))
    const sizeKb = Math.round((stats.size / 1024) * 10) / 10
    unmatched.push({
      'Photo file': f,
      'SKU code (from filename)': base,
      Extension: ext,
      'Size (KB)': sizeKb,
      'Last modified': stats.mtime.toISOString().slice(0, 10),
    })
  }
}

const photoBaseSet = new Set(files.map((f) => path.basename(f, path.extname(f)).trim()))
const skusWithoutPhoto = []
for (const r of skuRows) {
  const sku = String(r.sku || '').trim()
  const bc = String(r.barcode || '').trim()
  if (!sku) continue
  if (photoBaseSet.has(sku)) continue
  if (bc && photoBaseSet.has(bc)) continue
  skusWithoutPhoto.push({
    SKU: sku,
    Barcode: bc,
    Brand: r.brand || '',
    'Product name': r.product_name || '',
    Gender: r.gender || '',
    Category: r.category || '',
  })
}

const summary = [
  { Metric: 'Photos on disk',         Value: files.length },
  { Metric: 'Matched by SKU code',    Value: matched.filter((m) => m['SKU code'] !== '(barcode)').length },
  { Metric: 'Matched by barcode',     Value: matched.filter((m) => m['SKU code'] === '(barcode)').length },
  { Metric: 'Unmatched (orphans)',    Value: unmatched.length },
  { Metric: 'Distinct SKUs in DB',    Value: skuSet.size },
  { Metric: 'Distinct barcodes',      Value: barcodeSet.size },
  { Metric: 'SKUs in DB with no photo', Value: skusWithoutPhoto.length },
  { Metric: 'Report generated',       Value: new Date().toISOString().replace('T', ' ').slice(0, 19) },
]

unmatched.sort((a, b) => a['Photo file'].localeCompare(b['Photo file']))
skusWithoutPhoto.sort((a, b) => a.SKU.localeCompare(b.SKU))
matched.sort((a, b) => a['SKU code'].localeCompare(b['SKU code']))

const wb = XLSX.utils.book_new()

const wsSummary = XLSX.utils.json_to_sheet(summary)
wsSummary['!cols'] = [{ wch: 32 }, { wch: 24 }]
XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

const wsUnmatched = XLSX.utils.json_to_sheet(unmatched)
wsUnmatched['!cols'] = [{ wch: 28 }, { wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 14 }]
XLSX.utils.book_append_sheet(wb, wsUnmatched, 'Unmatched photos')

const wsNoPhoto = XLSX.utils.json_to_sheet(skusWithoutPhoto)
wsNoPhoto['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 40 }, { wch: 10 }, { wch: 14 }]
XLSX.utils.book_append_sheet(wb, wsNoPhoto, 'SKUs without photo')

const wsMatched = XLSX.utils.json_to_sheet(matched)
wsMatched['!cols'] = [{ wch: 26 }, { wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 40 }, { wch: 10 }, { wch: 14 }]
XLSX.utils.book_append_sheet(wb, wsMatched, 'Matched photos')

XLSX.writeFile(wb, OUT_PATH)
console.log(`Wrote: ${OUT_PATH}`)
console.log(`Sheets: Summary, Unmatched photos (${unmatched.length}), SKUs without photo (${skusWithoutPhoto.length}), Matched photos (${matched.length})`)

db.close()
