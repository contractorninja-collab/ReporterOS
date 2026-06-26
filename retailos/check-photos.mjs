import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, 'retailos.db')
const PHOTOS_DIR = path.resolve(__dirname, 'photos')

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })

const skuRows = db.prepare('SELECT sku, barcode FROM skus').all()
const skuSet = new Set()
const barcodeSet = new Set()
for (const r of skuRows) {
  if (r.sku) skuSet.add(String(r.sku).trim())
  if (r.barcode) barcodeSet.add(String(r.barcode).trim())
}

const files = fs.readdirSync(PHOTOS_DIR).filter((f) => {
  const ext = path.extname(f).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)
})

const unmatched = []
const matchedBySku = []
const matchedByBarcode = []

for (const f of files) {
  const base = path.basename(f, path.extname(f)).trim()
  if (skuSet.has(base)) {
    matchedBySku.push(base)
  } else if (barcodeSet.has(base)) {
    matchedByBarcode.push(base)
  } else {
    unmatched.push(f)
  }
}

console.log('===== PHOTO MATCH REPORT =====')
console.log(`Photos on disk        : ${files.length}`)
console.log(`Matched by SKU code   : ${matchedBySku.length}`)
console.log(`Matched by barcode    : ${matchedByBarcode.length}`)
console.log(`Unmatched (orphans)   : ${unmatched.length}`)
console.log(`Distinct SKUs in DB   : ${skuSet.size}`)
console.log(`Distinct barcodes     : ${barcodeSet.size}`)
console.log('')

if (unmatched.length) {
  console.log('===== UNMATCHED PHOTO FILES =====')
  for (const f of unmatched.sort()) console.log(f)
  const out = path.resolve(__dirname, 'unmatched-photos.txt')
  fs.writeFileSync(out, unmatched.sort().join('\n'), 'utf8')
  console.log('')
  console.log(`Wrote: ${out}`)
}

const skusWithoutPhoto = []
const photoBaseSet = new Set(files.map((f) => path.basename(f, path.extname(f)).trim()))
for (const r of skuRows) {
  const sku = String(r.sku || '').trim()
  const bc = String(r.barcode || '').trim()
  if (!sku) continue
  if (photoBaseSet.has(sku)) continue
  if (bc && photoBaseSet.has(bc)) continue
  skusWithoutPhoto.push({ sku, barcode: bc })
}

console.log('')
console.log(`SKUs in DB with NO photo on disk: ${skusWithoutPhoto.length}`)
if (skusWithoutPhoto.length) {
  const out2 = path.resolve(__dirname, 'skus-without-photo.csv')
  const lines = ['sku,barcode']
  for (const r of skusWithoutPhoto) lines.push(`${r.sku},${r.barcode}`)
  fs.writeFileSync(out2, lines.join('\n'), 'utf8')
  console.log(`Wrote: ${out2}`)
}

db.close()
