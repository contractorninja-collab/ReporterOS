import Papa from 'papaparse'
import { ALL_SKU_FIELDS as FIELDS } from './csvImportSpec.js'

/**
 * Pick delimiter from first non-empty line (Excel EU often uses `;`, tabs from paste).
 */
export function sniffDelimiterFromText(sample) {
  const line = String(sample)
    .split(/\r\n|\n|\r/)
    .find((l) => l.trim().length) || ''
  if (!line) return ','
  const sem = (line.match(/;/g) || []).length
  const comma = (line.match(/,/g) || []).length
  const tab = (line.match(/\t/g) || []).length
  const max = Math.max(sem, comma, tab)
  if (max === 0) return ','
  if (sem === max && sem >= 2) return ';'
  if (tab === max && tab >= 2) return '\t'
  return ','
}

function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Normalize CSV header to canonical field name.
 * Handles "Product Name", "product_name", "product-name", etc.
 */
function normalizeHeader(header) {
  return String(header || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * Parse date string to Date object.
 * Supports: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, ISO 8601
 */
function parseImportDate(value) {
  if (!value) return new Date()
  const str = String(value).trim()
  if (!str) return new Date()

  let parsed = new Date(str)
  if (!Number.isNaN(parsed.getTime())) return parsed

  const parts = str.split(/[/-]/)
  if (parts.length === 3) {
    const [a, b, c] = parts.map((p) => parseInt(p, 10))
    if (a > 12) parsed = new Date(c, b - 1, a)
    else parsed = new Date(c, a - 1, b)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  return new Date()
}

/**
 * Map raw CSV row to clean SKU object.
 */
function mapRow(row, headerMap) {
  const get = (field) => {
    const col = headerMap[field]
    const val = col != null ? row[col] : ''
    return typeof val === 'string' ? val : String(val ?? '')
  }

  const priceSold = parseFloat(get('price_sold')) || 0
  const priceTag = parseFloat(get('price_tag')) || 0
  const costPrice = parseFloat(get('cost_price')) || 0
  const quantity = parseInt(get('quantity'), 10) || 0
  const soldQuantity = parseInt(get('sold_quantity'), 10) || 0

  return {
    id: generateId(),
    barcode: get('barcode').trim(),
    sku: get('sku').trim(),
    product_name: get('product_name').trim(),
    size: get('size').trim(),
    price_sold: priceSold,
    price_tag: priceTag,
    cost_price: costPrice,
    quantity,
    sold_quantity: soldQuantity,
    import_date: parseImportDate(get('import_date')),
    gender: get('gender').trim(),
    season: get('season').trim(),
    category: get('category').trim(),
    brand: get('brand').trim(),
  }
}

/**
 * Validate that a row has the minimum required fields for New Arrivals Intake.
 * Required: barcode, sku, product_name, import_date, quantity
 */
export function validateRow(row) {
  if (!row || typeof row !== 'object') return false
  const barcode = (row.barcode ?? '').toString().trim()
  const sku = (row.sku ?? '').toString().trim()
  const productName = (row.product_name ?? '').toString().trim()
  const importDate = row.import_date
  const quantity = row.quantity
  const qty = typeof quantity === 'number' ? quantity : parseInt(quantity, 10)
  const hasValidDate =
    importDate instanceof Date
      ? !Number.isNaN(importDate.getTime())
      : importDate != null && String(importDate).trim() !== ''
  return (
    barcode !== '' &&
    sku !== '' &&
    productName !== '' &&
    hasValidDate &&
    !Number.isNaN(qty) &&
    qty >= 0
  )
}

/**
 * Validate a Reporting Import row (lighter requirements).
 * Required: barcode, sku, quantity >= 0
 */
export function validateReportingRow(row) {
  if (!row || typeof row !== 'object') return false
  const barcode = (row.barcode ?? '').toString().trim()
  const sku = (row.sku ?? '').toString().trim()
  const quantity = row.quantity
  const qty = typeof quantity === 'number' ? quantity : parseInt(quantity, 10)
  return barcode !== '' && sku !== '' && !Number.isNaN(qty) && qty >= 0
}

/**
 * Parse CSV file and return array of clean SKU objects.
 * @param {File} file - Browser File object (from drag-drop or input)
 * @returns {Promise<Array>} Array of clean SKU objects
 */
export async function parseCSV(file) {
  const headBytes = Math.min(16384, file.size || 16384)
  const sample = await file.slice(0, headBytes).text()
  const delimiter = sniffDelimiterFromText(sample)

  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      delimiter,
      complete: (results) => {
        if (results.errors.length > 0) {
          const first = results.errors[0]
          if (first.type === 'Quotes') {
            reject(new Error(`CSV parse error: ${first.message}`))
            return
          }
        }

        const rawRows = results.data
        if (!rawRows?.length) {
          resolve([])
          return
        }

        const rawHeaders = results.meta.fields || Object.keys(rawRows[0] || {})
        const headerMap = {}
        const normalized = rawHeaders.map((h) => normalizeHeader(h))
        FIELDS.forEach((field) => {
          const idx = normalized.indexOf(field)
          if (idx >= 0) headerMap[field] = rawHeaders[idx]
        })

        if (!headerMap.barcode || !headerMap.sku) {
          const found = rawHeaders.filter(Boolean).join(', ') || '(none)'
          reject(
            new Error(
              `CSV must include barcode and sku columns (exact names, first row). Found: ${found}. Use Download template or save as comma-separated CSV.`,
            ),
          )
          return
        }

        const skus = rawRows
          .map((row) => mapRow(row, headerMap))
          .filter((sku) => sku.barcode.trim() !== '' && sku.sku.trim() !== '')

        resolve(skus)
      },
      error: (err) => reject(err),
    })
  })
}
