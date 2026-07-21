export const STORE_TRANSFER_WORKFLOW_VERSION = 2

export function transferLineKey(skuCode, size) {
  return `${String(skuCode ?? '').trim()}|${String(size ?? '').trim() || 'One Size'}`
}

export function flattenTransferLines(items) {
  const lines = []
  for (const item of Array.isArray(items) ? items : []) {
    const skuCode = String(item?.skuCode ?? '').trim()
    const productName = String(item?.productName ?? '').trim()
    if (Array.isArray(item?.sizeBreakdown) && item.sizeBreakdown.length > 0) {
      for (const sizeLine of item.sizeBreakdown) {
        const size = String(sizeLine?.size ?? '').trim() || 'One Size'
        const expected = Math.max(0, Number(sizeLine?.qty) || 0)
        lines.push({ key: transferLineKey(skuCode, size), skuCode, productName, size, expected })
      }
      continue
    }

    const sizes = String(item?.sizes || '').split(',').map((size) => size.trim()).filter(Boolean)
    const total = Math.max(0, Number(item?.totalQty ?? item?.quantity) || 0)
    if (sizes.length > 0) {
      const perSize = Math.ceil(total / sizes.length)
      for (const size of sizes) {
        lines.push({ key: transferLineKey(skuCode, size), skuCode, productName, size, expected: perSize })
      }
    } else {
      lines.push({ key: transferLineKey(skuCode, 'One Size'), skuCode, productName, size: 'One Size', expected: total })
    }
  }
  return lines
}

export function getPhaseLines(transfer, phase) {
  const planned = flattenTransferLines(transfer?.items)
  if (phase !== 'receive') return planned
  const sent = transfer?.send_item_statuses || {}
  return planned.map((line) => ({
    ...line,
    planned: line.expected,
    expected: Math.max(0, Number(sent[line.key]?.confirmed) || 0),
  }))
}

export function deriveVerificationStatus(expected, confirmed) {
  const expectedQty = Math.max(0, Number(expected) || 0)
  const confirmedQty = Math.max(0, Number(confirmed) || 0)
  if (confirmedQty >= expectedQty) return 'done'
  if (confirmedQty === 0) return 'missing'
  return 'partial'
}

export function buildVerificationEntry({ expected, confirmed, comment, updatedBy, updatedAt, phase }) {
  const expectedQty = Math.max(0, Number(expected) || 0)
  const confirmedQty = Math.max(0, Math.min(expectedQty, Number(confirmed) || 0))
  const entry = {
    expected: expectedQty,
    confirmed: confirmedQty,
    missing: expectedQty - confirmedQty,
    status: deriveVerificationStatus(expectedQty, confirmedQty),
    comment: String(comment || '').trim(),
    updatedBy: updatedBy || '',
    updatedAt: updatedAt || new Date().toISOString(),
  }
  if (phase === 'receive') entry.received = confirmedQty
  return entry
}

export function verificationEntryError(entry, expected) {
  if (!entry || !['done', 'partial', 'missing'].includes(entry.status)) return 'This size has not been confirmed.'
  const expectedQty = Math.max(0, Number(expected) || 0)
  const confirmed = Number(entry.confirmed ?? entry.received)
  if (!Number.isFinite(confirmed) || confirmed < 0 || confirmed > expectedQty) return 'Confirmed quantity is invalid.'
  if (confirmed < expectedQty && !String(entry.comment || '').trim()) return 'Explain the missing quantity.'
  return ''
}

export function isPhaseComplete(transfer, phase, statuses) {
  const applicable = getPhaseLines(transfer, phase).filter((line) => phase !== 'receive' || line.expected > 0)
  return applicable.length > 0 && applicable.every((line) => !verificationEntryError(statuses?.[line.key], line.expected))
}

export function verificationTotals(transfer, phase, statuses) {
  const lines = getPhaseLines(transfer, phase)
  return lines.reduce((totals, line) => {
    const entry = statuses?.[line.key]
    const confirmed = Math.max(0, Number(entry?.confirmed ?? entry?.received) || 0)
    totals.lines += phase === 'receive' && line.expected === 0 ? 0 : 1
    totals.resolved += entry && !verificationEntryError(entry, line.expected) ? 1 : 0
    totals.expected += line.expected
    totals.confirmed += confirmed
    totals.missing += Math.max(0, line.expected - confirmed)
    if (entry?.status === 'partial' || entry?.status === 'missing') totals.issues += 1
    return totals
  }, { lines: 0, resolved: 0, expected: 0, confirmed: 0, missing: 0, issues: 0 })
}
