/**
 * Aggregate per-size SKU rows into one object per product code.
 * Raw rows with the same `sku` field but different `size` values
 * are merged: quantity and sold_quantity are summed, import_date
 * uses the earliest value, sizes are collected into an array.
 *
 * @param {import('../store/useStore').Sku[]} skus
 * @returns {Array<import('../store/useStore').Sku & { sizes: string[], _rowCount: number }>}
 */
export function aggregateSkus(skus) {
  if (!Array.isArray(skus)) return []
  const map = new Map()

  for (const row of skus) {
    const key = row.sku
    const existing = map.get(key)

    const rowQty = Number(row.quantity) || 0
    const rowSold = Number(row.sold_quantity) || 0
    const rowPriceSold = Number(row.price_sold) || 0
    const rowCostPrice = Number(row.cost_price) || 0

    if (!existing) {
      map.set(key, {
        ...row,
        id: row.sku,
        quantity: rowQty,
        sold_quantity: rowSold,
        price_sold: rowPriceSold,
        price_tag: Number(row.price_tag) || 0,
        cost_price: rowCostPrice,
        sizes: row.size ? [row.size] : [],
        _rowCount: 1,
        _salesRevenue: rowSold * rowPriceSold,
        _salesCogs: rowSold * rowCostPrice,
        _totalInvestment: rowQty * rowCostPrice,
      })
    } else {
      existing.quantity += rowQty
      existing.sold_quantity += rowSold
      existing._salesRevenue += rowSold * rowPriceSold
      existing._salesCogs += rowSold * rowCostPrice
      existing._totalInvestment += rowQty * rowCostPrice

      const rowDate = row.import_date instanceof Date
        ? row.import_date
        : new Date(row.import_date)
      const existDate = existing.import_date instanceof Date
        ? existing.import_date
        : new Date(existing.import_date)

      if (!isNaN(rowDate.getTime()) && rowDate < existDate) {
        existing.import_date = row.import_date
      }

      if (row.size && !existing.sizes.includes(row.size)) {
        existing.sizes.push(row.size)
      }
      existing._rowCount++
    }
  }

  for (const agg of map.values()) {
    agg.size = agg.sizes.join(', ')
    agg.avg_price_sold = agg.sold_quantity > 0
      ? Math.round((agg._salesRevenue / agg.sold_quantity) * 100) / 100
      : 0
  }

  return [...map.values()]
}
