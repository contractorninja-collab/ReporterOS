export const DISCOUNTS = [10, 20, 30, 40, 50, 60, 70]

export function salePriceOf(priceTag, pct) {
  const p = Number(priceTag) || 0
  return Math.round(p * (1 - pct / 100) * 100) / 100
}

export function localDateKey(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
