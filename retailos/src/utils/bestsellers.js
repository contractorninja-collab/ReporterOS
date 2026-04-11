/**
 * Bestseller Logic — Section 4 of CURSOR_CONTEXT.md
 * bestseller_score = sold_in_last_30_days / quantity * 100
 *
 * Note: CSV has cumulative sold_quantity only. Using total sell-through as
 * bestseller_score proxy until time-series sales data is available.
 */
export function getBestsellerScore(sku) {
  const qty = sku.quantity || 0
  if (qty <= 0) return 0
  const sold = sku.sold_quantity || 0
  return Math.min(100, (sold / qty) * 100)
}

/**
 * Rank SKUs by bestseller score (highest first).
 */
export function rankBySellThrough(skus) {
  return [...skus]
    .map((sku) => ({ sku, score: getBestsellerScore(sku) }))
    .sort((a, b) => b.score - a.score)
    .map(({ sku, score }) => ({ ...sku, bestseller_score: score }))
}
