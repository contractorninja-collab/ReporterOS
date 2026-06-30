import {
  parseCSV,
  validateRow,
  validateReportingRow,
  skuSizeKey,
  classifyReportingMovement,
  reportingLineRevenueFromRow,
} from '../utils/csvParser.js'

function postProgress(id, phase, progress, detail = '') {
  self.postMessage({
    type: 'progress',
    id,
    phase,
    progress,
    detail,
  })
}

function validationErrorForIntake(row, index) {
  const g = (row.gender ?? '').toString().trim()
  const genderOk = g === 'M' || g === 'F' || g === 'K' || g === 'U'
  return {
    row: index + 1,
    sku: row.sku || '(blank)',
    reason: genderOk
      ? 'Missing required fields (barcode, sku, product_name, import_date, quantity)'
      : 'gender must be exactly Male, Female, Kids, or Unisex (no other values)',
  }
}

function validationErrorForReporting(row, index) {
  return {
    row: index + 1,
    sku: row.sku || '(blank)',
    reason: 'Missing or invalid fields (barcode, sku, sold_quantity, sale_date as DD.MM.YY)',
  }
}

function validateRows(rows, mode, id) {
  const errors = []
  const isReporting = mode === 'reporting'
  const total = rows.length || 1
  const stride = Math.max(500, Math.floor(total / 20))
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const valid = isReporting ? validateReportingRow(row) : validateRow(row)
    if (!valid) {
      errors.push(isReporting
        ? validationErrorForReporting(row, i)
        : validationErrorForIntake(row, i))
    }
    if (i > 0 && i % stride === 0) {
      postProgress(id, 'validating', 50 + Math.round((i / total) * 35), `Validated ${i.toLocaleString()} rows`)
    }
  }
  return errors
}

function toIsoDateLocal(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function findExistingSkuRow(existingMap, allSkus, sku, size) {
  const key = skuSizeKey(sku, size)
  if (existingMap.has(key)) return existingMap.get(key)
  const emptyKey = skuSizeKey(sku, '')
  if (existingMap.has(emptyKey)) return existingMap.get(emptyKey)
  const wanted = String(sku ?? '').trim()
  return allSkus.find((row) => String(row.sku ?? '').trim() === wanted) || null
}

function buildReportingPlan({ rows, existingSkus, reportingImportId }, id) {
  const knownSkuCodes = new Set(existingSkus.map((row) => row.sku))
  const existingMap = new Map()
  for (const sku of existingSkus) {
    existingMap.set(skuSizeKey(sku.sku, sku.size), sku)
  }

  const recognized = []
  const skippedSkusSet = new Set()
  const stride = Math.max(500, Math.floor((rows.length || 1) / 20))
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (knownSkuCodes.has(row.sku)) {
      recognized.push(row)
    } else {
      skippedSkusSet.add(row.sku)
    }
    if (i > 0 && i % stride === 0) {
      postProgress(id, 'grouping', 10 + Math.round((i / rows.length) * 20), `Matched ${i.toLocaleString()} rows`)
    }
  }

  const bySkuSize = new Map()
  const eventGroups = new Map()
  const groupStride = Math.max(500, Math.floor((recognized.length || 1) / 20))
  for (let i = 0; i < recognized.length; i += 1) {
    const row = recognized[i]
    const key = skuSizeKey(row.sku, row.size)
    const movement = classifyReportingMovement(row)
    const unitsAbs = Math.abs(Math.round(Number(row.sold_quantity) || 0))
    const units = movement === 'RETURN' ? -unitsAbs : unitsAbs
    if (!bySkuSize.has(key)) bySkuSize.set(key, { rows: [], increment: 0, revenue: 0 })
    const bucket = bySkuSize.get(key)
    bucket.rows.push(row)
    bucket.increment += units
    bucket.revenue += reportingLineRevenueFromRow(row)

    const eventDate = row.sale_date instanceof Date ? toIsoDateLocal(row.sale_date) : null
    if (eventDate) {
      const direction = movement === 'RETURN' ? 'RETURN' : movement === 'SALE' ? 'SALE' : 'UNKNOWN'
      const groupKey = `${key}|${eventDate}|${direction}`
      if (!eventGroups.has(groupKey)) {
        eventGroups.set(groupKey, {
          sku: row.sku,
          size: row.size ?? '',
          eventDate,
          units: 0,
          revenue: 0,
          grossSold: 0,
          grossReturned: 0,
        })
      }
      const eventGroup = eventGroups.get(groupKey)
      if (movement === 'SALE') eventGroup.grossSold += units
      else if (movement === 'RETURN') eventGroup.grossReturned += unitsAbs
      eventGroup.units += units
      eventGroup.revenue += reportingLineRevenueFromRow(row)
    }

    if (i > 0 && i % groupStride === 0) {
      postProgress(id, 'grouping', 30 + Math.round((i / recognized.length) * 50), `Grouped ${i.toLocaleString()} recognized rows`)
    }
  }

  const mergedSkus = []
  for (const [key, { increment, revenue, rows: groupRows }] of bySkuSize) {
    const pipe = key.indexOf('|')
    const sku = key.slice(0, pipe)
    const size = key.slice(pipe + 1)
    const existing = findExistingSkuRow(existingMap, existingSkus, sku, size)
    const firstRow = groupRows[0]
    const oldSold = Number(existing?.sold_quantity) || 0
    const fromBatch = increment !== 0 && Math.abs(revenue) > 1e-9 ? revenue / increment : null
    const avgPrice = fromBatch != null
      ? fromBatch
      : (Number(firstRow?.price_sold) || Number(existing?.price_sold) || 0)
    mergedSkus.push({
      ...firstRow,
      sku,
      size,
      product_name: existing?.product_name || '',
      price_sold: avgPrice,
      price_tag: existing?.price_tag ?? 0,
      cost_price: existing?.cost_price ?? 0,
      import_date: existing?.import_date || firstRow.import_date || new Date().toISOString(),
      quantity: existing?.quantity ?? 0,
      sold_quantity: oldSold + increment,
      gender: existing?.gender || '',
      season: existing?.season || '',
      category: existing?.category || '',
      brand: existing?.brand || '',
      barcode: existing?.barcode || firstRow.barcode,
    })
  }

  const salesEvents = []
  for (const eventGroup of eventGroups.values()) {
    if (eventGroup.grossSold === 0 && eventGroup.grossReturned === 0) continue
    const existing = findExistingSkuRow(existingMap, existingSkus, eventGroup.sku, eventGroup.size)
    const pricePerUnit =
      eventGroup.units !== 0 && Math.abs(eventGroup.revenue) > 1e-9
        ? eventGroup.revenue / eventGroup.units
        : 0
    salesEvents.push({
      sku: eventGroup.sku,
      product_name: existing?.product_name ?? '',
      size: eventGroup.size ?? '',
      units_sold: eventGroup.units,
      price_sold: pricePerUnit,
      revenue: eventGroup.revenue,
      event_date: eventGroup.eventDate,
      import_id: reportingImportId,
    })
  }

  return {
    mergedSkus,
    salesEvents,
    skippedCount: rows.length - recognized.length,
    skippedSkus: [...skippedSkusSet],
    recognizedCount: recognized.length,
    reportingNetUnits: recognized.reduce((sum, row) => sum + (Number(row.sold_quantity) || 0), 0),
  }
}

self.onmessage = async (event) => {
  const { id, task, payload } = event.data || {}
  try {
    if (task === 'parse') {
      postProgress(id, 'reading', 5, 'Reading CSV file')
      const rows = await parseCSV(payload.file)
      postProgress(id, 'parsing', 45, `Parsed ${rows.length.toLocaleString()} rows`)
      const validationErrors = validateRows(rows, payload.mode, id)
      postProgress(id, 'complete', 100, `Ready ${rows.length.toLocaleString()} rows`)
      self.postMessage({ type: 'result', id, result: { rows, validationErrors } })
      return
    }

    if (task === 'buildReportingPlan') {
      postProgress(id, 'grouping', 5, 'Matching reporting rows')
      const result = buildReportingPlan(payload, id)
      postProgress(id, 'complete', 100, `Grouped ${result.recognizedCount.toLocaleString()} recognized rows`)
      self.postMessage({ type: 'result', id, result })
      return
    }

    throw new Error(`Unknown import worker task: ${task}`)
  } catch (err) {
    self.postMessage({
      type: 'error',
      id,
      error: err?.message || 'CSV worker failed',
    })
  }
}
