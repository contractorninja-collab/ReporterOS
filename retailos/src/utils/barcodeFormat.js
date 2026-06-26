/**
 * EAN/UPC barcodes must stay as plain digits. Excel and JSON sometimes produce
 * scientific notation (e.g. 1.20E+12) as strings or numbers — expand to integer digits.
 */
export function normalizeBarcodeValue(val) {
  if (val == null || val === '') return ''
  if (typeof val === 'number' && Number.isFinite(val)) {
    return String(Math.round(val))
  }
  const s = String(val).trim()
  if (!s) return ''
  if (/^[-+]?[\d.]+e[-+]?\d+$/i.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) return String(Math.round(n))
  }
  return s
}
