import { flattenTransferLines } from './storeTransferVerification.js'

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

/** Identifies the old markdown rule for review only; never establishes physical ownership. */
export function isLegacyOutletMarkdownSource(list) {
  if ((list?.kind || 'sale') !== 'sale' || !Array.isArray(list.items) || !list.items.length) return false
  return list.items.every((item) => ['Ring Mall', 'Village', 'E-commerce'].every((shop) => (
    list.item_statuses?.[item?.skuCode]?.[shop]?.status === 'tagged'
  )))
}

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
      if (transfer.status === 'received' && outletTransferItemReceivedQuantity(transfer, item) <= 0) continue
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

export function outletTransferItemExpectedQuantity(item) {
  if (Array.isArray(item?.sizeBreakdown) && item.sizeBreakdown.length) {
    return item.sizeBreakdown.reduce((sum, line) => sum + (Number(line?.qty) || 0), 0)
  }
  return Number(item?.totalQty ?? item?.quantity) || 0
}

function savedReceivedQuantity(saved, expected) {
  if (saved?.status === 'missing') return 0
  if (saved?.received == null || saved.received === '') {
    if (saved?.missing != null && saved.missing !== '') {
      const missing = Number(saved.missing)
      return Number.isInteger(missing) && missing >= 0 && missing <= expected ? expected - missing : 0
    }
    return !saved || saved.status === 'done' ? expected : 0
  }
  const value = Number(saved.received)
  return Number.isInteger(value) && value >= 0 && value <= expected ? value : 0
}

/** Preserve legacy receipts, but never turn a recorded shortage into received stock. */
export function outletTransferItemReceivedQuantity(transfer, item) {
  const statuses = transfer?.item_statuses || {}
  const skuCode = normalizedSku(item?.skuCode ?? item?.sku)
  const expected = outletTransferItemExpectedQuantity(item)
  const received = flattenTransferLines([{ ...item, skuCode }]).reduce((sum, line) => (
    sum + savedReceivedQuantity(statuses[line.key], line.expected)
  ), 0)
  return Math.max(0, Math.min(expected, received))
}

export function receivedOutletTransferUnitsBySku(transfers) {
  const units = new Map()
  for (const transfer of Array.isArray(transfers) ? transfers : []) {
    if (transfer?.status !== 'received') continue
    for (const item of Array.isArray(transfer.items) ? transfer.items : []) {
      const skuCode = normalizedSku(item?.skuCode ?? item?.sku)
      if (!skuCode) continue
      units.set(skuCode, (units.get(skuCode) || 0) + outletTransferItemReceivedQuantity(transfer, item))
    }
  }
  return units
}

/** Physical Outlet stock requires a received transfer with at least one received unit. */
export function outletSkuLocationOwnership(transfers) {
  const ownership = new Map()
  for (const transfer of Array.isArray(transfers) ? transfers : []) {
    if (transfer?.status !== 'received') continue
    for (const item of Array.isArray(transfer.items) ? transfer.items : []) {
      const skuCode = normalizedSku(item?.skuCode ?? item?.sku)
      if (!skuCode || outletTransferItemReceivedQuantity(transfer, item) <= 0) continue
      const current = ownership.get(skuCode)
      const locatedAt = transfer.receivedAt || transfer.completedAt || transfer.createdAt || ''
      if (current && (Date.parse(current.locatedAt) || 0) >= (Date.parse(locatedAt) || 0)) continue
      ownership.set(skuCode, {
        skuCode,
        source: 'outlet_transfer',
        transferId: transfer.id,
        status: 'received',
        fromShop: transfer.fromShop || '',
        locatedAt,
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
  void markdownLists // Retained for call compatibility; Markdown lists do not establish physical ownership.
  const reserved = outletSkuOwnership(transfers, excludeTransferId)
  const located = outletSkuLocationOwnership(transfers)
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

/** Group store-specific children into the single Outlet operation an executive created. */
export function groupOutletTransfersForExecutive(transfers) {
  const groups = new Map()
  for (const transfer of Array.isArray(transfers) ? transfers : []) {
    const groupId = String(transfer?.groupId || '').trim()
    const key = groupId ? `group:${groupId}` : String(transfer?.id || '')
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        groupId: groupId || null,
        isGroup: Boolean(groupId),
        batches: [],
        createdAt: transfer?.createdAt || '',
        createdBy: transfer?.createdBy || '',
        note: transfer?.note || null,
      })
    }
    groups.get(key).batches.push(transfer)
  }
  return [...groups.values()]
}

/** Progress counts verification as the first half and Outlet receipt as the second half. */
export function outletTransferGroupProgress(transfers) {
  let totalLines = 0
  let verifiedLines = 0
  let receivedLines = 0
  for (const transfer of Array.isArray(transfers) ? transfers : []) {
    const lines = flattenTransferLines(transfer?.items || [])
    totalLines += lines.length
    if (transfer?.status === 'completed' || transfer?.status === 'received') {
      verifiedLines += lines.length
    } else {
      verifiedLines += lines.filter((line) => (
        !outletVerificationEntryError(transfer?.item_statuses?.[line.key], line.qty)
      )).length
    }
    if (transfer?.status === 'received') receivedLines += lines.length
  }
  const totalSteps = totalLines * 2
  const completedSteps = verifiedLines + receivedLines
  return {
    totalLines,
    verifiedLines,
    receivedLines,
    percent: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
  }
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
