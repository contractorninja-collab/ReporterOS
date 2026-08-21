export function enrichBestsellerProducts(products, salesData) {
  return products.map((product) => {
    const event = salesData[product.sku]
    if (!event) {
      return {
        ...product,
        _periodSold: 0,
        _periodRevenue: 0,
        netRevenue: 0,
        returnsCount: 0,
      }
    }

    return {
      ...product,
      _periodSold: event.sold_qty ?? 0,
      _periodRevenue: event.revenue ?? 0,
      netRevenue: event.revenue ?? 0,
      returnsCount: event.return_units ?? 0,
    }
  })
}

/**
 * Match the population used by the Bestsellers ranking: a SKU contributes to
 * period totals only when its signed sales-event quantity is positive. This
 * keeps return-only SKUs out of both the ranking and any KPI that describes
 * that ranking population.
 */
export function summarizeBestsellerSalesRows(rows) {
  const values = Array.isArray(rows) ? rows : Object.values(rows || {})
  return values.reduce((totals, row) => {
    const units = Number(row?.sold_qty) || 0
    if (units <= 0) return totals
    totals.units += units
    totals.revenue += Number(row?.revenue) || 0
    totals.returnUnits += Number(row?.return_units) || 0
    return totals
  }, { units: 0, revenue: 0, returnUnits: 0 })
}

/** Index mutually exclusive season/SKU rows for the product-level ranking. */
export function indexBestsellerSalesRows(rows) {
  const map = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const units = Number(row?.sold_qty) || 0
    if (!row?.sku || units <= 0) continue
    if (!map[row.sku]) map[row.sku] = { sku: row.sku, sold_qty: 0, revenue: 0, return_units: 0 }
    map[row.sku].sold_qty += units
    map[row.sku].revenue += Number(row.revenue) || 0
    map[row.sku].return_units += Number(row.return_units) || 0
  }
  return map
}
