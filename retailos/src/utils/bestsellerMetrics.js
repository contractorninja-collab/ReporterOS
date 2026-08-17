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
