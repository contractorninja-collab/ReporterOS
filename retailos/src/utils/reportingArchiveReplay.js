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

function comparableSkuCode(value) {
  const code = String(value || '').trim().toUpperCase()
  const match = code.match(/^0*(\d+)(.*)$/)
  return match ? `${Number(match[1])}${match[2]}` : code
}

function canonicalSkuAliases(existingSkus) {
  const aliases = new Map()
  for (const row of existingSkus || []) {
    const sku = String(row?.sku || '').trim()
    if (!sku) continue
    const key = comparableSkuCode(sku)
    if (!aliases.has(key)) aliases.set(key, sku)
    else if (aliases.get(key) !== sku) aliases.set(key, null)
  }
  return aliases
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

function hasValidReportingDate(row) {
  const value = row?.sale_date
  return Boolean(
    value instanceof Date &&
    !Number.isNaN(value.getTime()) &&
    value.getFullYear() >= 2000 &&
    value.getFullYear() <= 2100
  )
}

/**
 * A damaged Excel export can be an almost-exact copy of a corrected file while
 * still containing one legitimate extra row. Remove only the overlapping rows
 * from the damaged copy, leaving the extra row available for replay.
 */
function removeRowsCoveredByCorrectedFiles(sources) {
  const output = (sources || []).map((source) => ({ ...source, rows: [...(source.rows || [])] }))
  const validSourcesBySignature = new Map()
  for (let sourceIndex = 0; sourceIndex < output.length; sourceIndex += 1) {
    for (const row of output[sourceIndex].rows) {
      if (!hasValidReportingDate(row) || hasMalformedReportingDate(row)) continue
      const signature = reportingRowContentSignature(row)
      if (!validSourcesBySignature.has(signature)) validSourcesBySignature.set(signature, [])
      validSourcesBySignature.get(signature).push(sourceIndex)
    }
  }

  const skippedByPair = new Map()
  for (let sourceIndex = 0; sourceIndex < output.length; sourceIndex += 1) {
    const damaged = output[sourceIndex]
    const malformedCount = damaged.rows.filter(hasMalformedReportingDate).length
    if (malformedCount === 0) continue
    const badlyDamagedFile = malformedCount >= Math.max(2, Math.ceil(damaged.rows.length / 2))
    damaged.rows = damaged.rows.filter((row) => {
      const matches = validSourcesBySignature.get(reportingRowContentSignature(row)) || []
      const correctedIndex = matches.find((index) => index !== sourceIndex)
      if (correctedIndex == null) return true
      if (!badlyDamagedFile && !hasMalformedReportingDate(row)) return true
      const pairKey = `${sourceIndex}|${correctedIndex}`
      skippedByPair.set(pairKey, (skippedByPair.get(pairKey) || 0) + 1)
      return false
    })
  }

  const skippedCorrectedRows = [...skippedByPair].map(([key, rows]) => {
    const [damagedIndex, correctedIndex] = key.split('|').map(Number)
    return {
      filename: output[damagedIndex].filename || output[damagedIndex].importId || 'reporting.csv',
      correctedBy: output[correctedIndex].filename || output[correctedIndex].importId || 'reporting.csv',
      rows,
    }
  })
  return { sources: output, skippedCorrectedRows }
}

/**
 * Net units sold for a size cannot exceed the units ever received for that
 * size. Returns are included before this check, so a returned item can be sold
 * again. If the final net still exceeds stock, trim only the latest sale rows.
 */
function capReportingRowsToInventory(rows, existingSkus) {
  const capacityByKey = new Map()
  for (const item of existingSkus || []) {
    const key = skuSizeKey(item?.sku, item?.size)
    const quantity = Math.max(0, Math.round(Number(item?.quantity) || 0))
    capacityByKey.set(key, (capacityByKey.get(key) || 0) + quantity)
  }

  const accepted = []
  const cappedRows = []
  const rowsByKey = new Map()
  for (const row of rows || []) {
    const key = skuSizeKey(row.sku, row.size)
    if (!rowsByKey.has(key)) rowsByKey.set(key, [])
    rowsByKey.get(key).push(row)
  }

  for (const [key, keyRows] of rowsByKey) {
    const capacity = capacityByKey.get(key) || 0
    let overflow = capacity > 0
      ? Math.max(0, keyRows.reduce((sum, row) => sum + row.unitsSold, 0) - capacity)
      : 0
    const newestFirst = [...keyRows].sort((a, b) => (
      String(b.eventDate).localeCompare(String(a.eventDate)) ||
      String(b.importedAt || '').localeCompare(String(a.importedAt || '')) ||
      String(b.filename || '').localeCompare(String(a.filename || '')) ||
      Number(b.row || 0) - Number(a.row || 0)
    ))

    for (const row of newestFirst) {
      if (overflow <= 0 || row.unitsSold <= 0) {
        accepted.push(row)
        continue
      }
      const excludedUnits = Math.min(row.unitsSold, overflow)
      const acceptedUnits = row.unitsSold - excludedUnits
      overflow -= excludedUnits
      cappedRows.push({ ...row, acceptedUnits, excludedUnits, stockCapacity: capacity })
      if (acceptedUnits > 0) {
        const ratio = acceptedUnits / row.unitsSold
        accepted.push({ ...row, unitsSold: acceptedUnits, revenue: row.revenue * ratio })
      }
    }
  }

  return {
    rows: accepted.sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate))),
    cappedRows,
  }
}

/** Build one canonical replay from every unique archived reporting file. */
export function buildReportingArchiveReplay(sources, existingSkus) {
  const known = new Set((existingSkus || []).map((row) => String(row.sku || '').trim()).filter(Boolean))
  const aliases = canonicalSkuAliases(existingSkus)
  const lookup = existingSkuLookup(existingSkus)
  const seenHashes = new Set()
  const seenContentSignatures = new Set()
  const invalidRows = []
  const repairedRows = []
  const skippedDuplicateFiles = []
  const skippedCorrectedCopies = []
  const correctedCoverage = removeRowsCoveredByCorrectedFiles(sources)
  const skippedCorrectedRows = correctedCoverage.skippedCorrectedRows
  const sourceRows = []
  const normalizedSkuRows = []
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
      const sourceSku = String(row.sku || '').trim()
      const sku = known.has(sourceSku) ? sourceSku : aliases.get(comparableSkuCode(sourceSku))
      if (!sku) {
        skippedSkus.add(sourceSku)
        continue
      }
      if (sku !== sourceSku) {
        normalizedSkuRows.push({
          filename: source.filename || source.importId || 'reporting.csv',
          row: Number(row?._source_row) || index + 2,
          sourceSku,
          sku,
        })
      }
      const eventDate = isoDateLocal(row.sale_date)
      const movement = classifyReportingMovement(row)
      if (!eventDate || movement === 'UNKNOWN') continue
      rowsRecognized += 1
      const magnitude = Math.abs(Math.round(Number(row.sold_quantity) || 0))
      const unitsSold = movement === 'RETURN' ? -magnitude : magnitude
      const revenue = reportingLineRevenueFromRow(row)
      sourceRows.push({
        sku,
        size: String(row.size ?? '').trim(),
        filename: source.filename || source.importId || 'reporting.csv',
        importId: source.importId || '',
        importedAt: source.importedAt || '',
        orphaned: source.orphaned === true,
        row: Number(row?._source_row) || index + 2,
        eventDate,
        sourceSaleDate: String(row?._source_sale_date || '').trim(),
        unitsSold,
        priceSold: Number(row.price_sold) || 0,
        revenue,
        movement,
        repaired: row.sale_date_repaired === true,
        sourceSku,
      })
    }
  }

  const capped = capReportingRowsToInventory(sourceRows, existingSkus)
  const acceptedSourceRows = capped.rows
  const groups = new Map()
  for (const row of acceptedSourceRows) {
    const direction = row.movement === 'RETURN' ? 'RETURN' : 'SALE'
    const key = `${skuSizeKey(row.sku, row.size)}|${row.eventDate}|${direction}`
    if (!groups.has(key)) {
      groups.set(key, {
        sku: row.sku,
        size: row.size,
        event_date: row.eventDate,
        units_sold: 0,
        revenue: 0,
        import_id: 'archive-replay',
      })
    }
    const group = groups.get(key)
    group.units_sold += row.unitsSold
    group.revenue += row.revenue
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
    sourceRows: acceptedSourceRows,
    cappedRows: capped.cappedRows,
    normalizedSkuRows,
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
