import {
  classifyReportingMovement,
  reportingLineRevenueFromRow,
  skuSizeKey,
  validateReportingRow,
} from './csvParser.js'

function isoDateLocal(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateParts(value) {
  const match = String(value ?? '').trim().match(/^-?(\d{1,2})\.(\d{1,2})\.(\d+)$/)
  if (!match) return null
  return { day: Number(match[1]), month: Number(match[2]), yearText: match[3] }
}

function rowCanBeRepairedFromAnchor(row, anchor) {
  if (!row || !anchor) return false
  const barcode = String(row.barcode ?? '').trim()
  const sku = String(row.sku ?? '').trim()
  const qty = Number(row.sold_quantity)
  if (!barcode || !sku || !Number.isFinite(qty)) return false
  const parts = dateParts(row._source_sale_date)
  return Boolean(
    parts &&
    parts.day === anchor.getDate() &&
    parts.month === anchor.getMonth() + 1 &&
    Number(parts.yearText) !== anchor.getFullYear()
  )
}

/**
 * Some Excel exports filled the year as a numeric series (202, 1622, 3446, ...)
 * while every line kept the same day/month. If a file has one unambiguous valid
 * date, recover only the malformed lines with that same day/month.
 */
export function repairReportingRowsFromFile(rows) {
  const input = Array.isArray(rows) ? rows : []
  const validDates = input
    .map((row) => row?.sale_date)
    .filter((value) => (
      value instanceof Date &&
      !Number.isNaN(value.getTime()) &&
      value.getFullYear() >= 2000 &&
      value.getFullYear() <= 2100
    ))
  const validDays = new Map(validDates.map((value) => [isoDateLocal(value), value]))
  const anchor = validDays.size === 1 ? [...validDays.values()][0] : null
  const repaired = []
  const output = input.map((row, index) => {
    if (!rowCanBeRepairedFromAnchor(row, anchor)) return row
    const fixed = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
    repaired.push({
      row: Number(row._source_row) || index + 2,
      sku: String(row.sku || '').trim(),
      originalDate: String(row._source_sale_date || '').trim(),
      repairedDate: isoDateLocal(fixed),
    })
    return { ...row, sale_date: fixed, sale_date_repaired: true }
  })
  return { rows: output, repaired }
}

function existingSkuLookup(existingSkus) {
  const exact = new Map()
  const bySku = new Map()
  for (const row of existingSkus || []) {
    exact.set(skuSizeKey(row.sku, row.size), row)
    if (!bySku.has(String(row.sku || '').trim())) bySku.set(String(row.sku || '').trim(), row)
  }
  return { exact, bySku }
}

function reportingRowContentSignature(row) {
  const date = dateParts(row?._source_sale_date)
  const dayMonth = date ? `${date.day}.${date.month}` : isoDateLocal(row?.sale_date)?.slice(5) || ''
  return [
    String(row?.sku || '').trim(),
    String(row?.size || '').trim().toLowerCase(),
    Number(row?.price_sold || 0).toFixed(4),
    Number(row?.sold_quantity || 0),
    classifyReportingMovement(row),
    dayMonth,
  ].join('|')
}

/** Detect a corrected re-export even when Excel changed barcodes or date years. */
function reportingFileContentSignature(rows) {
  return (rows || []).map(reportingRowContentSignature).sort().join('\n')
}

function hasMalformedReportingDate(row) {
  const raw = dateParts(row?._source_sale_date)
  if (!raw) return false
  const year = Number(raw.yearText)
  return !Number.isInteger(year) || year < 2000 || year > 2100
}

function signatureCounts(rows) {
  const counts = new Map()
  for (const row of rows || []) {
    const signature = reportingRowContentSignature(row)
    counts.set(signature, (counts.get(signature) || 0) + 1)
  }
  return counts
}

function matchingRowCount(rows, counts) {
  const remaining = new Map(counts)
  let matches = 0
  for (const row of rows || []) {
    const signature = reportingRowContentSignature(row)
    const available = remaining.get(signature) || 0
    if (available <= 0) continue
    remaining.set(signature, available - 1)
    matches += 1
  }
  return matches
}

/**
 * A damaged Excel export can be an almost-exact copy of a corrected file while
 * still containing one legitimate extra row. Remove only the overlapping rows
 * from the damaged copy, leaving the extra row available for replay.
 */
function removeRowsCoveredByCorrectedFiles(sources) {
  const output = (sources || []).map((source) => ({ ...source, rows: [...(source.rows || [])] }))
  const skippedCorrectedRows = []

  for (let damagedIndex = 0; damagedIndex < output.length; damagedIndex += 1) {
    const damaged = output[damagedIndex]
    const malformedCount = damaged.rows.filter(hasMalformedReportingDate).length
    if (malformedCount === 0 || damaged.rows.length < 2) continue

    let best = null
    for (let correctedIndex = 0; correctedIndex < output.length; correctedIndex += 1) {
      if (correctedIndex === damagedIndex) continue
      const corrected = output[correctedIndex]
      if (corrected.rows.length < 2) continue
      const correctedMalformed = corrected.rows.filter(hasMalformedReportingDate).length
      if (correctedMalformed >= malformedCount) continue
      const counts = signatureCounts(corrected.rows)
      const matches = matchingRowCount(damaged.rows, counts)
      const smallerFileSize = Math.min(damaged.rows.length, corrected.rows.length)
      const overlap = smallerFileSize > 0 ? matches / smallerFileSize : 0
      if (overlap < 0.8 || (best && matches <= best.matches)) continue
      best = { corrected, counts, matches }
    }
    if (!best) continue

    const remaining = new Map(best.counts)
    damaged.rows = damaged.rows.filter((row) => {
      const signature = reportingRowContentSignature(row)
      const available = remaining.get(signature) || 0
      if (available <= 0) return true
      remaining.set(signature, available - 1)
      return false
    })
    skippedCorrectedRows.push({
      filename: damaged.filename || damaged.importId || 'reporting.csv',
      correctedBy: best.corrected.filename || best.corrected.importId || 'reporting.csv',
      rows: best.matches,
    })
  }

  return { sources: output, skippedCorrectedRows }
}

/** Build one canonical replay from every unique archived reporting file. */
export function buildReportingArchiveReplay(sources, existingSkus) {
  const known = new Set((existingSkus || []).map((row) => String(row.sku || '').trim()).filter(Boolean))
  const lookup = existingSkuLookup(existingSkus)
  const seenHashes = new Set()
  const seenContentSignatures = new Set()
  const groups = new Map()
  const invalidRows = []
  const repairedRows = []
  const skippedDuplicateFiles = []
  const skippedCorrectedCopies = []
  const correctedCoverage = removeRowsCoveredByCorrectedFiles(sources)
  const skippedCorrectedRows = correctedCoverage.skippedCorrectedRows
  const skippedSkus = new Set()
  const processedSources = []
  let rowsParsed = 0
  let rowsRecognized = 0

  for (const source of correctedCoverage.sources) {
    if ((source.rows || []).length === 0) {
      skippedCorrectedCopies.push(source.filename || source.importId || 'reporting.csv')
      continue
    }
    if (source.hash && seenHashes.has(source.hash)) {
      skippedDuplicateFiles.push(source.filename || source.importId || 'reporting.csv')
      continue
    }
    if (source.hash) seenHashes.add(source.hash)
    const contentSignature = reportingFileContentSignature(source.rows)
    if (contentSignature && seenContentSignatures.has(contentSignature)) {
      skippedCorrectedCopies.push(source.filename || source.importId || 'reporting.csv')
      continue
    }
    if (contentSignature) seenContentSignatures.add(contentSignature)
    processedSources.push(source)
    const repairedFile = repairReportingRowsFromFile(source.rows)
    repairedRows.push(...repairedFile.repaired.map((item) => ({ ...item, filename: source.filename })))
    rowsParsed += repairedFile.rows.length

    for (let index = 0; index < repairedFile.rows.length; index += 1) {
      const row = repairedFile.rows[index]
      if (!validateReportingRow(row)) {
        invalidRows.push({
          filename: source.filename || 'reporting.csv',
          row: Number(row?._source_row) || index + 2,
          sku: String(row?.sku || '').trim(),
          saleDate: String(row?._source_sale_date || '').trim(),
          reason: 'Invalid barcode, quantity, or sale date',
        })
        continue
      }
      const sku = String(row.sku || '').trim()
      if (!known.has(sku)) {
        skippedSkus.add(sku)
        continue
      }
      const eventDate = isoDateLocal(row.sale_date)
      const movement = classifyReportingMovement(row)
      if (!eventDate || movement === 'UNKNOWN') continue
      rowsRecognized += 1
      const direction = movement === 'RETURN' ? 'RETURN' : 'SALE'
      const key = `${skuSizeKey(sku, row.size)}|${eventDate}|${direction}`
      if (!groups.has(key)) {
        groups.set(key, {
          sku,
          size: row.size ?? '',
          event_date: eventDate,
          units_sold: 0,
          revenue: 0,
          import_id: 'archive-replay',
        })
      }
      const group = groups.get(key)
      const magnitude = Math.abs(Math.round(Number(row.sold_quantity) || 0))
      group.units_sold += movement === 'RETURN' ? -magnitude : magnitude
      group.revenue += reportingLineRevenueFromRow(row)
    }
  }

  const salesEvents = [...groups.values()].map((event) => {
    const template = lookup.exact.get(skuSizeKey(event.sku, event.size)) || lookup.bySku.get(event.sku) || {}
    return {
      ...event,
      product_name: template.product_name || '',
      price_sold: event.units_sold !== 0 ? event.revenue / event.units_sold : 0,
    }
  })

  return {
    salesEvents,
    processedSources,
    rowsParsed,
    rowsRecognized,
    invalidRows,
    repairedRows,
    skippedSkus: [...skippedSkus].filter(Boolean).sort(),
    skippedDuplicateFiles,
    skippedCorrectedCopies,
    skippedCorrectedRows,
  }
}

export function salesTotalsBySku(events) {
  const totals = new Map()
  for (const event of events || []) {
    const sku = String(event?.sku || '').trim()
    if (!sku) continue
    totals.set(sku, (totals.get(sku) || 0) + (Number(event.units_sold) || 0))
  }
  return totals
}

export function changedSkuTotals(beforeTotals, afterEvents) {
  const afterTotals = salesTotalsBySku(afterEvents)
  const changed = []
  for (const [sku, archiveSold] of afterTotals) {
    const currentSold = Number(beforeTotals?.get?.(sku)) || 0
    if (Math.abs(archiveSold - currentSold) < 1e-9) continue
    changed.push({ sku, currentSold, archiveSold, difference: archiveSold - currentSold })
  }
  return changed.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.sku.localeCompare(b.sku))
}
