function normalizedShop(value) {
  return String(value ?? '').trim().toLocaleLowerCase()
}

function normalizedSku(value) {
  return String(value ?? '').trim()
}

const OUTLET_STATUS_PRIORITY = {
  pending: 1,
  completed: 2,
  received: 3,
}

const OUTLET_MARKDOWN_LANES = ['Ring Mall', 'Village', 'E-commerce']

/**
 * Every open or received Outlet transfer reserves its SKUs against another
 * transfer. Official Outlet location is calculated separately below.
 */
export function outletSkuOwnership(transfers, excludeTransferId = null) {
  const ownership = new Map()
  for (const transfer of Array.isArray(transfers) ? transfers : []) {
    if (!transfer || String(transfer.id) === String(excludeTransferId ?? '')) continue
    for (const item of Array.isArray(transfer.items) ? transfer.items : []) {
      const skuCode = normalizedSku(item?.skuCode ?? item?.sku)
      if (!skuCode) continue
      const current = ownership.get(skuCode)
      const nextPriority = OUTLET_STATUS_PRIORITY[transfer.status] || 0
      const currentPriority = OUTLET_STATUS_PRIORITY[current?.status] || 0
      if (!current || nextPriority >= currentPriority) {
        ownership.set(skuCode, {
          skuCode,
          transferId: transfer.id,
          status: transfer.status || 'pending',
          fromShop: transfer.fromShop || '',
        })
      }
    }
  }
  return ownership
}

export function markdownListHasAllOutletConfirmations(list) {
  if ((list?.kind || 'sale') !== 'sale' || !(list?.items || []).length) return false
  const statuses = list.item_statuses || {}
  return list.items.every((item) => OUTLET_MARKDOWN_LANES.every((lane) => (
    statuses?.[item?.skuCode]?.[lane]?.status === 'tagged'
  )))
}

/** A SKU becomes Outlet stock after receipt or full three-lane Markdown confirmation. */
export function outletSkuLocationOwnership(transfers, markdownLists = []) {
  const ownership = new Map()
  for (const transfer of Array.isArray(transfers) ? transfers : []) {
    if (transfer?.status !== 'received') continue
    for (const item of Array.isArray(transfer.items) ? transfer.items : []) {
      const skuCode = normalizedSku(item?.skuCode ?? item?.sku)
      if (!skuCode) continue
      ownership.set(skuCode, {
        skuCode,
        source: 'outlet_transfer',
        transferId: transfer.id,
        status: 'received',
        fromShop: transfer.fromShop || '',
      })
    }
  }
  for (const list of Array.isArray(markdownLists) ? markdownLists : []) {
    if (!markdownListHasAllOutletConfirmations(list)) continue
    for (const item of Array.isArray(list.items) ? list.items : []) {
      const skuCode = normalizedSku(item?.skuCode ?? item?.sku)
      if (!skuCode || ownership.has(skuCode)) continue
      ownership.set(skuCode, {
        skuCode,
        source: 'markdown_list',
        markdownListId: list.id,
        status: list.status || 'completed',
      })
    }
  }
  return ownership
}

export function outletSkuConflictCodes(items, transfers, excludeTransferId = null) {
  const ownership = outletSkuOwnership(transfers, excludeTransferId)
  return [...new Set((Array.isArray(items) ? items : [])
    .map((item) => normalizedSku(item?.skuCode ?? item?.sku))
    .filter((skuCode) => skuCode && ownership.has(skuCode)))]
}

export function unavailableOutletSkuCodes(items, transfers, markdownLists = [], excludeTransferId = null) {
  const reserved = outletSkuOwnership(transfers, excludeTransferId)
  const located = outletSkuLocationOwnership(transfers, markdownLists)
  return [...new Set((Array.isArray(items) ? items : [])
    .map((item) => normalizedSku(item?.skuCode ?? item?.sku))
    .filter((skuCode) => skuCode && (reserved.has(skuCode) || located.has(skuCode))))]
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

export function outletShortageDraftError({ expected, missing, comment }) {
  const expectedQty = Number(expected)
  if (!Number.isInteger(expectedQty) || expectedQty < 1) return 'This transfer quantity is invalid.'
  if (missing === '' || missing == null) return 'Enter how many units are missing.'
  const missingQty = Number(missing)
  if (!Number.isInteger(missingQty) || missingQty < 1 || missingQty > expectedQty) {
    return `Enter a whole number from 1 to ${expectedQty}.`
  }
  if (!String(comment || '').trim()) return 'Explain why the units are missing.'
  return ''
}

export function buildOutletVerificationEntry({ expected, missing = 0, comment = '' }) {
  const expectedQty = Number(expected)
  const missingQty = Number(missing)
  const receivedQty = expectedQty - missingQty
  return {
    status: missingQty === 0 ? 'done' : receivedQty === 0 ? 'missing' : 'partial',
    received: receivedQty,
    missing: missingQty,
    expected: expectedQty,
    comment: missingQty > 0 ? String(comment || '').trim() : '',
  }
}

export function outletVerificationEntryError(entry, expected) {
  if (!entry || !['done', 'partial', 'missing'].includes(entry.status)) {
    return 'This line has not been verified.'
  }
  const expectedQty = Number(expected)
  const receivedQty = Number(entry.received)
  const missingQty = Number(entry.missing)
  if (
    !Number.isInteger(expectedQty) || expectedQty < 0 ||
    !Number.isInteger(receivedQty) || receivedQty < 0 ||
    !Number.isInteger(missingQty) || missingQty < 0 ||
    receivedQty + missingQty !== expectedQty
  ) {
    return 'Confirmed and missing quantities must account for the full transfer quantity.'
  }
  if (entry.status === 'done' && (receivedQty !== expectedQty || missingQty !== 0)) {
    return 'A confirmed line cannot contain missing units.'
  }
  if (entry.status === 'partial' && (receivedQty <= 0 || missingQty <= 0)) {
    return 'A partial line must contain both confirmed and missing units.'
  }
  if (entry.status === 'missing' && (receivedQty !== 0 || missingQty !== expectedQty)) {
    return 'A missing line must mark the full quantity as missing.'
  }
  if (missingQty > 0 && !String(entry.comment || '').trim()) {
    return 'Explain why the units are missing.'
  }
  return ''
}
