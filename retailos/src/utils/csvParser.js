import Papa from 'papaparse'
import { ALL_SKU_FIELDS as FIELDS, CSV_FIELD_ALIASES } from './csvImportSpec.js'
import { normalizeGenderFromCsv } from './gender.js'
import { normalizeBarcodeValue } from './barcodeFormat.js'
import { normalizeCategory } from './category.js'

function parseSignedNumber(value) {
  if (value === null || value === undefined || value === '') return 0
  const str = String(value).trim()
  if (str.startsWith('(') && str.endsWith(')')) {
    return -(parseFloat(str.slice(1, -1).replace(/[^0-9.]/g, '')) || 0)
  }
  return parseFloat(str.replace(/[^0-9.-]/g, '')) || 0
}

function roundMoney(value) {
  const n = Number(value) || 0
  return Math.round(n * 100) / 100
}

export function normalizeReportingPriceSold(value) {
  const n = roundMoney(parseSignedNumber(value))
  return Object.is(n, -0) ? 0 : n
}

export function normalizeTransactionType(value) {
  const raw = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (!raw) return ''
  if (raw === 'SALE' || raw === 'SELL') return 'SALE'
  if (raw === 'RETURN' || raw === 'REFUND') return 'RETURN'
  return raw
}

export function classifyReportingMovement(row) {
  const explicitType = normalizeTransactionType(row?.transaction_type)
  if (explicitType === 'SALE') return 'SALE'
  if (explicitType === 'RETURN') return 'RETURN'
  const qty = Math.round(Number(row?.sold_quantity) || 0)
  if (qty < 0) return 'RETURN'
  if (qty > 0) return 'SALE'
  return 'UNKNOWN'
}

/**
 * Net line revenue: sign of the transaction is carried by price_sold; sold_quantity is magnitude (may be negative in CSV, use abs for the product).
 * @param {number|string|null|undefined} priceSold
 * @param {number|string|null|undefined} soldQuantity
 * @returns {number}
 */
export function lineRevenueFromSaleFields(priceSold, soldQuantity) {
  const price = Number(priceSold) || 0
  const qty = Number(soldQuantity) || 0
  const sign = price < 0 || qty < 0 ? -1 : 1
  return roundMoney(sign * Math.abs(price) * Math.abs(qty))
}

/**
 * Reporting CSV revenue: `price_sold` is the row's total sold/refunded money,
 * while `sold_quantity` is the unit count for that row. The unit average is
 * derived later as revenue / units.
 */
export function reportingLineRevenueFromRow(row) {
  const movement = classifyReportingMovement(row)
  const amount = Math.abs(Number(row?.price_sold) || 0)
  if (!amount) return 0
  return roundMoney(movement === 'RETURN' ? -amount : amount)
}

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

function cleanNumericInput(value) {
  if (value == null || value === '') return ''
  return String(value)
    .trim()
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, '')
}

function cleanTextInput(value) {
  if (value == null) return ''
  return String(value)
    .trim()
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, '')
}

/**
 * Σ(quantity × cost_price) for parsed intake rows — matches server investment after import.
 * @param {Array<{ quantity?: number, cost_price?: number }>} rows
 */
export function sumIntakeInvestmentPreview(rows) {
  if (!Array.isArray(rows)) return 0
  return rows.reduce((sum, r) => {
    const q = Number(r.quantity) || 0
    const c = Number(r.cost_price) || 0
    return sum + q * c
  }, 0)
}

function earlierImportDate(a, b) {
  const ta = a instanceof Date ? a.getTime() : new Date(a ?? 0).getTime()
  const tb = b instanceof Date ? b.getTime() : new Date(b ?? 0).getTime()
  if (Number.isNaN(ta)) return b
  if (Number.isNaN(tb)) return a
  return ta <= tb ? a : b
}

/**
 * SQLite has UNIQUE(sku, size); INSERT OR REPLACE keeps one row per key. CSV duplicate lines
 * must be merged so Σqty, investment, and weighted unit cost match what Product Lookup reads.
 * @param {Array<object>} rows Normalized sku rows (after mapRow / same shape as POST body)
 * @param {{ allowSignedSold?: boolean }} [options] — When true (reporting), negative sold_quantity is kept (returns).
 */
export function mergeDuplicateSkuSizeRows(rows, options = {}) {
  const allowSignedSold = options.allowSignedSold === true
  if (!Array.isArray(rows) || rows.length === 0) return []
  const map = new Map()
  for (const r of rows) {
    const sku = String(r.sku ?? '').trim()
    const size = String(r.size ?? '').trim()
    const key = skuSizeKey(sku, size)
    const q = Math.max(0, Number(r.quantity) || 0)
    const c = Number(r.cost_price) || 0
    const lineInv = q * c
    const soldRaw = parseSignedNumber(r.sold_quantity)
    const sold = allowSignedSold ? soldRaw : Math.max(0, soldRaw)
    const tag = Number(r.price_tag) || 0
    const soldPrice = parseSignedNumber(r.price_sold)

    if (!map.has(key)) {
      map.set(key, {
        ...r,
        sku,
        size,
        quantity: q,
        sold_quantity: sold,
        cost_price: c,
        _inv: lineInv,
        _tagWt: q * tag,
        _soldWt: q * soldPrice,
      })
    } else {
      const ex = map.get(key)
      const prevQ = Number(ex.quantity) || 0
      ex.quantity = prevQ + q
      ex.sold_quantity = (Number(ex.sold_quantity) || 0) + sold
      ex._inv = (ex._inv || 0) + lineInv
      ex._tagWt = (ex._tagWt || 0) + q * tag
      ex._soldWt = (ex._soldWt || 0) + q * soldPrice
      if (ex.quantity > 0) {
        ex.cost_price = ex._inv / ex.quantity
      } else {
        const rCost = Number(r.cost_price) || 0
        const prevC = Number(ex.cost_price) || 0
        ex.cost_price = Math.max(rCost, prevC, 0) || 0
      }
      ex.import_date = earlierImportDate(ex.import_date, r.import_date)
      if (!String(ex.barcode ?? '').trim() && String(r.barcode ?? '').trim()) {
        ex.barcode = normalizeBarcodeValue(r.barcode)
      }
      if (!String(ex.product_name ?? '').trim() && String(r.product_name ?? '').trim()) {
        ex.product_name = r.product_name
      }
    }
  }
  return [...map.values()].map((ex) => {
    const q = Number(ex.quantity) || 0
    const inv = ex._inv != null ? ex._inv : q * (Number(ex.cost_price) || 0)
    const { _inv, _tagWt, _soldWt, ...rest } = ex
    const out = {
      ...rest,
      quantity: q,
      // When quantity is 0, weighted inventory cost is undefined — keep unit cost for COGS (Σ sold×cost in DB)
      cost_price: q > 0 ? inv / q : (Number(ex.cost_price) || 0),
      price_tag: q > 0 ? (_tagWt || 0) / q : Number(ex.price_tag) || 0,
      price_sold: q > 0 ? (_soldWt || 0) / q : Number(ex.price_sold) || 0,
    }
    out.id = generateId()
    out.barcode = normalizeBarcodeValue(out.barcode).trim()
    return out
  })
}

/**
 * Parse numeric cells from CSV. **Preferred / canonical format:** `110752.29` (dot decimal,
 * no thousand separators). Also accepts `110,752.29` (US thousands) and `110.752,29` / `110.752.29` (EU).
 *
 * Important: `String(110752.29)` can be `"110752.28999999999"`. A two-part split with a long
 * fractional segment must use `parseFloat(s)`, never strip the dot (that used to turn values
 * into ~11M).
 * @param {string|number|null|undefined} value
 * @returns {number}
 */
export function parseFlexibleNumber(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0

  let s = cleanNumericInput(value).replace(/\u00A0/g, '').replace(/€/gi, '').replace(/\s/g, '')
  if (!s || s === '-') return 0

  let sign = 1
  if (s.startsWith('-')) {
    sign = -1
    s = s.slice(1)
  }
  if (!s) return 0

  // Excel may export numbers as scientific-notation text.
  if (/^(?:\d+\.?\d*|\d*\.?\d+)[eE][-+]?\d+$/.test(s)) {
    const n = Number(s)
    return Number.isFinite(n) ? sign * n : 0
  }

  // Mixed `110,752.29` (US) vs `110.752,29` (EU)
  if (s.includes(',') && s.includes('.')) {
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(/,/g, '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',')
    if (parts.length === 2 && parts[1].length <= 2 && /^\d+$/.test(parts[1])) {
      s = parts[0].replace(/\./g, '') + '.' + parts[1]
    } else {
      s = s.replace(/,/g, '')
    }
  }

  const dotCount = (s.match(/\./g) || []).length

  /** @type {number|undefined} */
  let n
  if (dotCount === 0) {
    n = parseFloat(s)
    return Number.isFinite(n) ? sign * n : 0
  }
  // Exactly one `.`: canonical `110752.29` (decimal) OR EU thousands `110.752` / `1.234` (no cents).
  if (dotCount === 1) {
    const [a, b] = s.split('.')
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) {
      n = parseFloat(s)
      return Number.isFinite(n) ? sign * n : 0
    }
    // 1–2 digits after dot → currency decimals (also matches float tails `…999999`)
    if (b.length === 1 || b.length === 2) {
      n = parseFloat(s)
      return Number.isFinite(n) ? sign * n : 0
    }
    // Three digits after dot: `110752.290` is a decimal; `110.752` is EU thousands.
    if (b.length === 3) {
      if (a === '0' || a === '') {
        n = parseFloat(s)
        return Number.isFinite(n) ? sign * n : 0
      }
      if (a.length > 3) {
        n = parseFloat(s)
        return Number.isFinite(n) ? sign * n : 0
      }
      if (a.length === 2) {
        n = parseFloat(s)
        return Number.isFinite(n) ? sign * n : 0
      }
      // `110.752` or `1.234` → 110752 / 1234
      n = parseFloat(a + b)
      return Number.isFinite(n) ? sign * n : 0
    }
    n = parseFloat(s)
    return Number.isFinite(n) ? sign * n : 0
  }

  // Multiple `.` e.g. `110.752.29` (EU thousands + cents) — do not treat as three-part "float"
  const parts = s.split('.')
  const last = parts[parts.length - 1]
  if (
    parts.length >= 2
    && last.length >= 1
    && last.length <= 2
    && /^\d+$/.test(last)
    && parts.slice(0, -1).every((p) => p !== '' && /^\d+$/.test(p))
  ) {
    const intStr = parts.slice(0, -1).join('')
    n = parseFloat(`${intStr}.${last}`)
    return Number.isFinite(n) ? sign * n : 0
  }

  n = parseFloat(s.replace(/\./g, ''))
  return Number.isFinite(n) ? sign * n : 0
}

/**
 * Normalize CSV header to canonical field name.
 * Handles "Product Name", "product_name", "product-name", etc.
 */
export function normalizeHeader(header) {
  return String(header || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * Sale date for Reporting Import. Prefer **DD.MM.YY** / DD.MM.YYYY (day.month.year).
 * Also accepts YYYY-MM-DD. Invalid or empty → null.
 */
export function parseReportingSaleDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const str = String(value).trim()
  if (!str) return null

  const dot = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
  if (dot) {
    const d = parseInt(dot[1], 10)
    const m = parseInt(dot[2], 10) - 1
    let y = parseInt(dot[3], 10)
    if (y < 100) y += 2000
    const dt = new Date(y, m, d)
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null
    return dt
  }

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const y = parseInt(iso[1], 10)
    const m = parseInt(iso[2], 10) - 1
    const d = parseInt(iso[3], 10)
    const dt = new Date(y, m, d)
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null
    return dt
  }

  return null
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
 * Stable key for matching intake rows to reporting: same sku + same normalized size
 * (empty or whitespace-only size matches blank size in DB).
 * @param {string} sku
 * @param {string|number|undefined|null} size
 * @returns {string}
 */
export function skuSizeKey(sku, size) {
  return `${String(sku ?? '').trim()}|${String(size ?? '').trim()}`
}

/**
 * Map raw CSV row to clean SKU object.
 */
function mapRow(row, headerMap) {
  const getRaw = (field) => {
    const col = headerMap[field]
    if (col == null) return ''
    return row[col]
  }
  const get = (field) => {
    const val = getRaw(field)
    return typeof val === 'string' ? val : String(val ?? '')
  }

  const priceSold = normalizeReportingPriceSold(get('price_sold'))
  const priceTag = parseFlexibleNumber(get('price_tag'))
  const quantity = Math.max(0, Math.round(parseFlexibleNumber(get('quantity'))))
  const soldFromCsv = parseSignedNumber(get('sold_quantity'))
  const soldQuantity = Number.isFinite(soldFromCsv) ? Math.round(soldFromCsv) : 0

  let costPrice = parseFlexibleNumber(get('cost_price'))
  const lineTotal = parseFlexibleNumber(get('line_total'))
  if (lineTotal > 0 && quantity > 0) {
    costPrice = Math.round((lineTotal / quantity) * 10000) / 10000
  }

  const mapped = {
    id: generateId(),
    barcode: normalizeBarcodeValue(getRaw('barcode')).trim(),
    sku: get('sku').trim(),
    product_name: get('product_name').trim(),
    size: get('size').trim(),
    price_sold: priceSold,
    price_tag: priceTag,
    cost_price: costPrice,
    quantity,
    sold_quantity: soldQuantity,
    import_date: parseImportDate(get('import_date')),
    gender: normalizeGenderFromCsv(get('gender')),
    season: get('season').trim(),
    category: normalizeCategory(get('category')),
    brand: get('brand').trim(),
    sale_date: parseReportingSaleDate(get('sale_date')),
    transaction_type: normalizeTransactionType(get('transaction_type')),
  }
  mapped.transaction_type = classifyReportingMovement(mapped)
  return mapped
}

/**
 * Validate that a row has the minimum required fields for New Arrivals Intake.
 * Required: barcode, sku, product_name, import_date, quantity
 */
export function validateRow(row) {
  if (!row || typeof row !== 'object') return false
  const barcode = normalizeBarcodeValue(row.barcode).trim()
  const sku = (row.sku ?? '').toString().trim()
  const productName = (row.product_name ?? '').toString().trim()
  const importDate = row.import_date
  const quantity = row.quantity
  const qty = typeof quantity === 'number' ? quantity : parseInt(quantity, 10)
  const hasValidDate =
    importDate instanceof Date
      ? !Number.isNaN(importDate.getTime())
      : importDate != null && String(importDate).trim() !== ''
  const g = (row.gender ?? '').toString().trim()
  const validGender = g === 'M' || g === 'F' || g === 'K' || g === 'U'
  return (
    barcode !== '' &&
    sku !== '' &&
    productName !== '' &&
    hasValidDate &&
    !Number.isNaN(qty) &&
    qty >= 0 &&
    validGender
  )
}

/**
 * Validate a Reporting Import row (lighter requirements).
 * Required: barcode, sku, sold_quantity (integer; negative = customer return, adds to stock), sale_date.
 */
export function validateReportingRow(row) {
  if (!row || typeof row !== 'object') return false
  const barcode = normalizeBarcodeValue(row.barcode).trim()
  const sku = (row.sku ?? '').toString().trim()
  const soldQty = row.sold_quantity
  const sq = typeof soldQty === 'number' ? soldQty : parseSignedNumber(soldQty)
  const sd = row.sale_date
  const dateOk = sd instanceof Date && !Number.isNaN(sd.getTime())
  return barcode !== '' && sku !== '' && Number.isFinite(sq) && !Number.isNaN(sq) && dateOk
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
      dynamicTyping: false,
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
          let idx = normalized.indexOf(field)
          if (idx < 0 && CSV_FIELD_ALIASES[field]) {
            for (const al of CSV_FIELD_ALIASES[field]) {
              idx = normalized.indexOf(al)
              if (idx >= 0) break
            }
          }
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

export function parseCSVText(csvText) {
  const text = String(csvText || '')
  const delimiter = sniffDelimiterFromText(text.slice(0, 16384))

  const results = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter,
    dynamicTyping: false,
  })

  if (results.errors.length > 0) {
    const first = results.errors[0]
    if (first.type === 'Quotes') {
      throw new Error(`CSV parse error: ${first.message}`)
    }
  }

  const rawRows = results.data
  if (!rawRows?.length) return []

  const rawHeaders = results.meta.fields || Object.keys(rawRows[0] || {})
  const headerMap = {}
  const normalized = rawHeaders.map((h) => normalizeHeader(h))
  FIELDS.forEach((field) => {
    let idx = normalized.indexOf(field)
    if (idx < 0 && CSV_FIELD_ALIASES[field]) {
      for (const al of CSV_FIELD_ALIASES[field]) {
        idx = normalized.indexOf(al)
        if (idx >= 0) break
      }
    }
    if (idx >= 0) headerMap[field] = rawHeaders[idx]
  })

  if (!headerMap.barcode || !headerMap.sku) {
    const found = rawHeaders.filter(Boolean).join(', ') || '(none)'
    throw new Error(
      `CSV must include barcode and sku columns (exact names, first row). Found: ${found}. Use Download template or save as comma-separated CSV.`,
    )
  }

  return rawRows
    .map((row) => mapRow(row, headerMap))
    .filter((sku) => sku.barcode.trim() !== '' && sku.sku.trim() !== '')
}
