/**
 * Canonical storage: M, F, K, U.
 * Intake CSV: only Male, Female, Kids, Unisex (case-insensitive) — no other spellings.
 * Reports: bucket Men | Women | Kids | Unisex | Unspecified (legacy/invalid values).
 */

function normalizeGenderCell(raw) {
  return String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .normalize('NFKC')
    .trim()
    .replace(/\u00A0/g, ' ')
}

/**
 * New Arrivals CSV: accept **only** Male, Female, Kids, Unisex (case-insensitive).
 * @returns {''|'M'|'F'|'K'|'U'} empty string if invalid/missing
 */
export function normalizeGenderFromCsv(raw) {
  const s = normalizeGenderCell(raw).toLowerCase()
  if (!s) return ''
  if (s === 'male') return 'M'
  if (s === 'female') return 'F'
  if (s === 'kids') return 'K'
  if (s === 'unisex') return 'U'
  return ''
}

/**
 * Map DB / display value → report bucket. Accepts only M/F/K/U or Male/Female/Kids/Unisex.
 * Anything else → Unspecified (does not default to Men).
 * @param {string|null|undefined} g
 * @returns {'Men'|'Women'|'Kids'|'Unisex'|'Unspecified'}
 */
export function genderBucketKey(g) {
  const raw = normalizeGenderCell(g)
  if (!raw) return 'Unspecified'
  const low = raw.toLowerCase()
  if (low === 'm' || low === 'male') return 'Men'
  if (low === 'f' || low === 'female') return 'Women'
  if (low === 'k' || low === 'kids') return 'Kids'
  if (low === 'u' || low === 'unisex') return 'Unisex'
  return 'Unspecified'
}

/**
 * Single-letter filter code for dashboard tiles (M | F | K | U).
 * Unspecified → U so it is not counted as Men.
 * @param {string} g
 */
export function normalizeGenderCodeForFilter(g) {
  const b = genderBucketKey(g)
  if (b === 'Men') return 'M'
  if (b === 'Women') return 'F'
  if (b === 'Kids') return 'K'
  if (b === 'Unisex') return 'U'
  return 'U'
}

/** Single-letter display M / F / K / U (matches legacy dashboard chips). */
export function genderShortLabel(g) {
  return normalizeGenderCodeForFilter(g)
}

/**
 * Sum stock / sold / financials by gender bucket from **raw** per-size rows.
 */
export function accumulateReportByGender(rows) {
  const emptyBucket = () => ({
    stock: 0,
    remaining: 0,
    sold: 0,
    cogs: 0,
    totalRevenue: 0,
    totalInvestment: 0,
    imported: 0,
  })
  const byGender = {
    Men: emptyBucket(),
    Women: emptyBucket(),
    Kids: emptyBucket(),
    Unisex: emptyBucket(),
    Unspecified: emptyBucket(),
  }
  for (const r of rows) {
    const bucket = genderBucketKey(r.gender)
    const b = byGender[bucket] || byGender.Unspecified
    const qty = Number(r.quantity) || 0
    const soldQty = Number(r.sold_quantity) || 0
    const cost = Number(r.cost_price) || 0
    const priceSold = Number(r.price_sold) || 0
    b.stock += qty
    b.remaining += Math.max(0, qty - soldQty)
    b.sold += soldQty
    b.cogs += soldQty * cost
    b.totalRevenue += priceSold * Math.abs(soldQty)
    b.totalInvestment += qty * cost
  }
  return byGender
}

/**
 * Lifetime units from import_lines → `.imported` per bucket.
 */
export function mergeImportedUnitsIntoBuckets(byGender, lineRows) {
  const keys = ['Men', 'Women', 'Kids', 'Unisex', 'Unspecified']
  const importedByBucket = { Men: 0, Women: 0, Kids: 0, Unisex: 0, Unspecified: 0 }
  for (const r of lineRows) {
    const b = genderBucketKey(r.gender)
    importedByBucket[b] += Number(r.units) || 0
  }
  const totalImp = keys.reduce((s, k) => s + importedByBucket[k], 0)
  for (const k of keys) {
    byGender[k].imported = totalImp > 0 ? importedByBucket[k] : byGender[k].stock
  }
}

/**
 * Per SKU: bucket with largest qty wins; tie-break order Men → Women → Kids → Unisex → Unspecified.
 * @returns {Map<string, string>} sku → M | F | K | U | '' (empty if only Unspecified)
 */
export function dominantGenderBySku(skuCodes, rawRows) {
  const want = new Set(skuCodes)
  const order = ['Men', 'Women', 'Kids', 'Unisex', 'Unspecified']
  const letter = { Men: 'M', Women: 'F', Kids: 'K', Unisex: 'U', Unspecified: '' }
  /** @type {Map<string, Map<string, number>>} */
  const bySkuBucket = new Map()

  for (const r of rawRows) {
    const sku = r.sku
    if (!sku || !want.has(sku)) continue
    const b = genderBucketKey(r.gender)
    const q = Number(r.quantity) || 0
    const inner = bySkuBucket.get(sku) || new Map()
    inner.set(b, (inner.get(b) || 0) + q)
    bySkuBucket.set(sku, inner)
  }

  /** @type {Map<string, string>} */
  const out = new Map()
  for (const sku of skuCodes) {
    const m = bySkuBucket.get(sku)
    if (!m || m.size === 0) continue
    let bestBucket = 'Men'
    let bestQ = -1
    for (const bucket of order) {
      const q = m.get(bucket) || 0
      if (q > bestQ) {
        bestQ = q
        bestBucket = bucket
      }
    }
    const ch = letter[bestBucket] ?? ''
    out.set(sku, ch)
  }
  return out
}
