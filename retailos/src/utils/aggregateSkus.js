import { lineRevenueFromSaleFields } from './csvParser.js'

/**
 * Aggregate per-size SKU rows into one object per product code.
 * Raw rows with the same `sku` field but different `size` values
 * are merged: quantity and sold_quantity are summed;
 * `import_date` uses the earliest value (lifecycle / first arrival);
 * `last_import_date` uses the latest value (reorders / last shipment);
 * sizes are collected into an array.
 *
 * @param {import('../store/useStore').Sku[]} skus
 * @param {Record<string, object>|null|undefined} [shipmentMetaBySku]
 * @returns {Array<import('../store/useStore').Sku & {
 *   sizes: string[],
 *   _rowCount: number,
 *   last_import_date?: string|Date,
 *   _signedRevenue?: number,
 *   returnsCount?: number,
 *   netRevenue?: number,
 *   isOverReturned?: boolean,
 * }>}
 */
export function aggregateSkus(skus, shipmentMetaBySku = null) {
  if (!Array.isArray(skus)) return []
  const map = new Map()

  const fillIfEmpty = (cur, val) => {
    const t = String(val ?? '').trim()
    if (!t || t === '—') return cur
    const c = String(cur ?? '').trim()
    if (!c || c === '—') return val
    return cur
  }

  for (const row of skus) {
    const key = row.sku
    const existing = map.get(key)

    const rowQty = Number(row.quantity) || 0
    const rowSold = Number(row.sold_quantity) || 0
    const rowPriceSold = Number(row.price_sold) || 0
    const rowCostPrice = Number(row.cost_price) || 0

    if (!existing) {
      const lineRev = lineRevenueFromSaleFields(rowPriceSold, rowSold)
      const lineReturn = rowSold < 0 || rowPriceSold < 0
      const rowLast = row.last_import_date ?? row.import_date
      map.set(key, {
        ...row,
        last_import_date: rowLast,
        id: row.sku,
        quantity: rowQty,
        sold_quantity: rowSold,
        price_sold: rowPriceSold,
        price_tag: Number(row.price_tag) || 0,
        cost_price: rowCostPrice,
        sizes: row.size ? [row.size] : [],
        _rowCount: 1,
        _signedRevenue: lineRev,
        returnsCount: lineReturn ? 1 : 0,
        _salesCogs: rowSold * rowCostPrice,
        _totalInvestment: rowQty * rowCostPrice,
      })
    } else {
      existing.quantity += rowQty
      existing.sold_quantity += rowSold
      existing._signedRevenue = (Number(existing._signedRevenue) || 0) + lineRevenueFromSaleFields(rowPriceSold, rowSold)
      existing.returnsCount = (Number(existing.returnsCount) || 0) + (rowSold < 0 || rowPriceSold < 0 ? 1 : 0)
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

      const rowLast = row.last_import_date ?? row.import_date
      const rowLastDate = rowLast instanceof Date ? rowLast : new Date(rowLast)
      const lastExist = existing.last_import_date instanceof Date
        ? existing.last_import_date
        : new Date(existing.last_import_date)
      if (!isNaN(rowLastDate.getTime()) && (isNaN(lastExist.getTime()) || rowLastDate > lastExist)) {
        existing.last_import_date = rowLast
      }

      if (row.size && !existing.sizes.includes(row.size)) {
        existing.sizes.push(row.size)
      }
      existing._rowCount++
      // First row may lack category/brand while later size rows have them — Bestsellers filters need a filled category.
      existing.category = fillIfEmpty(existing.category, row.category)
      existing.brand = fillIfEmpty(existing.brand, row.brand)
      existing.gender = fillIfEmpty(existing.gender, row.gender)
      existing.season = fillIfEmpty(existing.season, row.season)
      existing.product_name = fillIfEmpty(existing.product_name, row.product_name)
    }
  }

  for (const agg of map.values()) {
    agg.size = agg.sizes.join(', ')
    const signed = Number(agg._signedRevenue) || 0
    const netQty = Number(agg.sold_quantity) || 0
    agg.netRevenue = Math.max(0, signed)
    agg.isOverReturned = signed < 0
    agg._salesRevenue = agg.netRevenue
    agg.avg_price_sold = netQty !== 0
      ? Math.round((signed / netQty) * 100) / 100
      : 0

    if (shipmentMetaBySku) {
      const meta = shipmentMetaBySku[agg.sku]
      if (meta) {
        if (meta.first_arrival_date) agg.import_date = meta.first_arrival_date
        if (meta.last_shipment_date) agg.last_import_date = meta.last_shipment_date
        agg.first_arrival_date = meta.first_arrival_date ?? agg.import_date
        agg.last_shipment_date = meta.last_shipment_date ?? agg.last_import_date
        agg.current_season = meta.current_season ?? agg.season
        agg.current_season_first_shipment = meta.current_season_first_shipment ?? null
        agg.current_season_last_shipment = meta.current_season_last_shipment ?? null
        agg.prior_same_season_shipment = meta.prior_same_season_shipment ?? null
        agg.has_prior_season_carryover = Boolean(meta.has_prior_season_carryover)
        agg.shipment_count = meta.shipment_count ?? 0
        agg.lifecycle_import_date = meta.current_season_first_shipment ?? agg.import_date
      }
    }
    if (!agg.lifecycle_import_date) {
      agg.lifecycle_import_date = agg.import_date
    }
  }

  return [...map.values()]
}
