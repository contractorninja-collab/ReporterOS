/**
 * Canonical product categories: Footwear, Apparel, Accessories.
 * CSV imports have historically used inconsistent spellings/casing
 * (FOOTWEAR, FTW, APP, ACC, ...). This normalizer folds known variants
 * into one canonical name so reports, filters, and catalog pages stay unified.
 * Unknown values (e.g. "Other", blank) are preserved as-is (only cleaned).
 */

function cleanCategoryCell(raw) {
  return String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .normalize('NFKC')
    .replace(/\u00A0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** lowercased variant -> canonical display name */
const CATEGORY_ALIASES = {
  footwear: 'Footwear',
  ftw: 'Footwear',
  apparel: 'Apparel',
  app: 'Apparel',
  accessories: 'Accessories',
  accessory: 'Accessories',
  acc: 'Accessories',
}

/**
 * Map any raw category string to its canonical name.
 * @param {string|null|undefined} raw
 * @returns {string} canonical category, or the cleaned original if unknown
 */
export function normalizeCategory(raw) {
  const cleaned = cleanCategoryCell(raw)
  if (!cleaned) return cleaned
  return CATEGORY_ALIASES[cleaned.toLowerCase()] || cleaned
}
