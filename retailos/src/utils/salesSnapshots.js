import { aggregateSkus } from './aggregateSkus'

/**
 * Build a snapshot object from the current SKU list.
 * Called after every import to record the state at that moment.
 */
export function buildSnapshot(rawSkus) {
  const products = aggregateSkus(rawSkus)
  const map = {}
  for (const p of products) {
    map[p.sku] = {
      soldQuantity: p.sold_quantity,
      quantity: p.quantity,
      priceSold: p.price_sold,
      priceTag: p.price_tag,
      category: p.category || '',
      gender: p.gender || '',
      productName: p.product_name || '',
      brand: p.brand || '',
    }
  }
  return { timestamp: new Date().toISOString(), products: map }
}

/**
 * Find the snapshot closest to (but not after) a given date.
 */
function findBracketSnapshot(snapshots, date) {
  const target = new Date(date).getTime()
  let best = null
  for (const s of snapshots) {
    const t = new Date(s.timestamp).getTime()
    if (t <= target && (!best || t > new Date(best.timestamp).getTime())) {
      best = s
    }
  }
  return best
}

/**
 * Compute per-SKU sales deltas between two dates.
 * Returns an array of { skuCode, productName, category, gender, brand, priceSold, delta, revenue }.
 */
export function computeSalesInPeriod(snapshots, startDate, endDate) {
  if (!snapshots.length) return []

  const sorted = [...snapshots].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  const startSnap = findBracketSnapshot(sorted, startDate)
  const endSnap = findBracketSnapshot(sorted, endDate)

  if (!endSnap) return []

  const results = []
  const endProducts = endSnap.products
  const startProducts = startSnap ? startSnap.products : {}

  for (const [skuCode, end] of Object.entries(endProducts)) {
    const start = startProducts[skuCode]
    const prevSold = start ? start.soldQuantity : 0
    const delta = end.soldQuantity - prevSold
    if (delta !== 0) {
      results.push({
        skuCode,
        productName: end.productName,
        category: end.category,
        gender: end.gender,
        brand: end.brand,
        priceSold: end.priceSold,
        priceTag: end.priceTag,
        quantity: end.quantity,
        soldQuantity: end.soldQuantity,
        delta,
        revenue: delta * (end.priceSold || 0),
      })
    }
  }
  return results
}

/**
 * Group sales data into time buckets (day | week | month).
 * Uses snapshot timestamps to distribute deltas across buckets.
 */
export function groupSalesByInterval(snapshots, startDate, endDate, interval = 'day') {
  if (!snapshots.length) return []

  const sorted = [...snapshots].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  const start = new Date(startDate)
  const end = new Date(endDate)

  const buckets = new Map()

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    const snapDate = new Date(curr.timestamp)
    if (snapDate < start || snapDate > end) continue

    const bucketKey = getBucketKey(snapDate, interval)
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { label: bucketKey, units: 0, revenue: 0 })
    }
    const bucket = buckets.get(bucketKey)

    for (const [sku, currData] of Object.entries(curr.products)) {
      const prevData = prev.products[sku]
      const prevSold = prevData ? prevData.soldQuantity : 0
      const delta = currData.soldQuantity - prevSold
      bucket.units += delta
      bucket.revenue += delta * (currData.priceSold || 0)
    }
  }

  if (buckets.size === 0) {
    const all = computeSalesInPeriod(snapshots, startDate, endDate)
    const totalUnits = all.reduce((s, r) => s + r.delta, 0)
    const totalRevenue = all.reduce((s, r) => s + r.revenue, 0)
    if (totalUnits > 0) {
      const key = getBucketKey(end, interval)
      buckets.set(key, { label: key, units: totalUnits, revenue: totalRevenue })
    }
  }

  return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label))
}

export function getBucketKey(date, interval) {
  const d = new Date(date)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')

  if (interval === 'month') return `${yyyy}-${mm}`
  if (interval === 'week') {
    const jan1 = new Date(yyyy, 0, 1)
    const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7)
    return `${yyyy}-W${String(week).padStart(2, '0')}`
  }
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Bucket daily sales_events aggregates (event_date, units, revenue) into chart intervals.
 * @param {Array<{ event_date: string, units: number, revenue: number }>} dailyRows
 */
export function groupEventDaysByInterval(dailyRows, startDate, endDate, interval = 'day') {
  if (!dailyRows?.length) return []
  const start = new Date(startDate).setHours(0, 0, 0, 0)
  const end = new Date(endDate).setHours(23, 59, 59, 999)
  const buckets = new Map()
  for (const r of dailyRows) {
    if (!r.event_date) continue
    const d = new Date(`${r.event_date}T12:00:00`)
    const t = d.getTime()
    if (t < start || t > end) continue
    const key = getBucketKey(d, interval)
    if (!buckets.has(key)) buckets.set(key, { label: key, units: 0, revenue: 0 })
    const b = buckets.get(key)
    b.units += Number(r.units) || 0
    b.revenue += Number(r.revenue) || 0
  }
  return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Pick the best interval for a date range.
 */
export function pickInterval(startDate, endDate) {
  const days = (new Date(endDate) - new Date(startDate)) / 86400000
  if (days <= 14) return 'day'
  if (days <= 90) return 'week'
  return 'month'
}

/**
 * Compute revenue total from sales data array.
 */
export function computeRevenueInPeriod(salesData) {
  return salesData.reduce((sum, r) => sum + r.revenue, 0)
}
