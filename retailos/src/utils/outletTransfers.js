function normalizedShop(value) {
  return String(value ?? '').trim().toLocaleLowerCase()
}

export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function findTodayPendingOutletTransfer(transfers, fromShop, now = new Date()) {
  const source = normalizedShop(fromShop)
  if (!source) return null
  const today = localDateKey(now)
  return (Array.isArray(transfers) ? transfers : []).find((transfer) => (
    transfer?.status === 'pending' &&
    normalizedShop(transfer.fromShop) === source &&
    localDateKey(transfer.createdAt) === today
  )) || null
}

/** A product can only appear once in a daily store batch. Re-adding refreshes its stock quantities. */
export function upsertOutletTransferItem(items, item) {
  const rows = Array.isArray(items) ? items : []
  const skuCode = String(item?.skuCode ?? '').trim()
  const index = rows.findIndex((row) => String(row?.skuCode ?? '').trim() === skuCode)
  if (index < 0) return [...rows, item]
  return rows.map((row, rowIndex) => (rowIndex === index ? item : row))
}

export function upsertOutletTransferItems(items, additions) {
  return (Array.isArray(additions) ? additions : []).reduce(
    (rows, item) => upsertOutletTransferItem(rows, item),
    Array.isArray(items) ? items : [],
  )
}

export function clearOutletItemStatuses(statuses, skuCode) {
  const prefix = `${String(skuCode ?? '').trim()}|`
  return Object.fromEntries(
    Object.entries(statuses && typeof statuses === 'object' ? statuses : {})
      .filter(([key]) => !key.startsWith(prefix)),
  )
}
