export const DASHBOARD_PRODUCT_SORT_OPTIONS = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'cheapest', label: 'Cheapest' },
  { key: 'expensive', label: 'Most expensive' },
]

function productLabelCompare(a, b) {
  const byName = String(a?.product_name ?? '').localeCompare(
    String(b?.product_name ?? ''),
    undefined,
    { sensitivity: 'base', numeric: true },
  )
  if (byName !== 0) return byName
  return String(a?.sku ?? '').localeCompare(String(b?.sku ?? ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  })
}

function latestShipmentTime(product) {
  const candidates = [
    product?.last_shipment_date,
    product?.last_import_date,
    product?.import_date,
  ]
  for (const value of candidates) {
    if (value == null || value === '') continue
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
    if (Number.isFinite(time)) return time
  }
  return null
}

function tagPrice(product) {
  const price = Number(product?.price_tag)
  return Number.isFinite(price) && price > 0 ? price : null
}

function comparePresentValues(a, b, direction) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return direction * (a - b)
}

export function compareDashboardProducts(a, b, sortKey = 'newest') {
  let result = 0
  switch (sortKey) {
    case 'oldest':
      result = comparePresentValues(latestShipmentTime(a), latestShipmentTime(b), 1)
      break
    case 'cheapest':
      result = comparePresentValues(tagPrice(a), tagPrice(b), 1)
      break
    case 'expensive':
      result = comparePresentValues(tagPrice(a), tagPrice(b), -1)
      break
    case 'newest':
    default:
      result = comparePresentValues(latestShipmentTime(a), latestShipmentTime(b), -1)
      break
  }
  return result || productLabelCompare(a, b)
}

export function sortDashboardProducts(products, sortKey = 'newest') {
  if (!Array.isArray(products)) return []
  return [...products].sort((a, b) => compareDashboardProducts(a, b, sortKey))
}
