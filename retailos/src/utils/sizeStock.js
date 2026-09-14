function wholeStock(value) {
  return Math.max(0, Math.round(Number(value) || 0))
}

/**
 * Size quantities are trustworthy only when they add up to the canonical SKU
 * stock total. A mismatch means one or more sales could not be assigned to a
 * catalog size, so displaying the raw per-size figures would overstate stock.
 */
export function reconcileSizeStock(rows, totalStock) {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    qty: wholeStock(row?.qty),
    sold: wholeStock(row?.sold),
    remaining: wholeStock(row?.remaining),
  }))
  const canonicalTotal = wholeStock(totalStock)
  const sizeTotal = normalizedRows.reduce((sum, row) => sum + row.remaining, 0)
  return {
    rows: normalizedRows,
    totalStock: canonicalTotal,
    sizeTotal,
    isReliable: sizeTotal === canonicalTotal,
  }
}
