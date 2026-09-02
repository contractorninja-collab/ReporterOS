import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'node:crypto'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import ExcelJS from 'exceljs'
import { SignJWT, jwtVerify } from 'jose'
import { fileURLToPath } from 'url'
import {
  getAllSkus, insertSkus, getShipmentMetaBySku,
  softDeleteSkuByCode, restoreSkuByCode, listBinnedSkus, purgeSkuByCode, purgeExpiredBinnedSkus,
  getImportHistory, insertImportRecord, deleteImportRecord,
  attachImportCsvFile, getImportCsvFileMeta, getLifetimeImportedBySku, getLifetimeImportCostBySku, getImportCostAudit, getProductNameReport, getDistinctSkuBrands,
  getAllUsers, getUsersPublicDirectory, updateUser, addUser, removeUser, regenerateUserPin,
  getUserRowByUserCode, verifyPin, getPublicUserById, toPublicUser,
  getAllAssignments, getAssignmentById, insertAssignment, insertAssignments, updateAssignment, updateSharedAssignment,
  getAllOutletTransfers, getOutletTransferById, insertOutletTransfer, updateOutletTransfer, deleteOutletTransfer,
  getAllStoreTransfers, getStoreTransferById, insertStoreTransferWorkflow,
  updateStoreTransfer, updateStoreTransferVerification, transitionStoreTransferPhase, deleteStoreTransfer,
  getAllMarkdownLists, getMarkdownListById, insertMarkdownList, updateMarkdownList, deleteMarkdownList,
  appendItemsToMarkdownList, applySaleToSkus, clearSaleForList,
  assignPendingUnassignedMarkdownListsForShift,
  toggleMarkdownListItemTagged,
  changeMarkdownListItemSalePct,
  removeMarkdownListItemFromSale,
  createEcommerceSaleListForOutletTransfer,
  createLocationChangeListForOutletTransfer,
  getAllSaleChangeReports, getSaleChangeReportById, saleChangeReportVisibleToUser,
  toggleSaleChangeItemMarked, discardSaleChangeReport, discardSaleChangeReportProduct,
  getAllSnapshots, insertSnapshot,
  getSoldQuantityMap, getSalesBySku, getSalesBySeasonSku, getSalesSummaryForSku, getSkuActivity, getSalesAggregatedByDay, getExchangePairs,
  replaceSalesEventsForReportingImport,
  getExecutiveBuyingReport, getBrandProductivityReport, getReturnsExchangeReport, getSizeCurveHealthReport, getMarkdownRiskReport,
  getCategoryProductivityReport, getMoversReport,
  getNotifications, getNotificationById, insertNotification, markNotificationRead,
  markNotificationsReadForViewer, notificationVisibleTo,
  clockIn, clockOut, getActiveShifts, getShiftHistory, getShiftById,
  getShiftSettings, saveShiftSetting, isShiftPlanner,
  listShiftPlans, getShiftPlanById, createShiftPlan, updateShiftPlan, removeShiftPlan,
  copyShiftPlanWeek, publishShiftPlanWeek, getShiftAttendanceOverview, getMonthlyAttendanceReport, evaluateShiftAttendance,
  createShiftCorrectionRequest, listShiftCorrectionRequests, reviewShiftCorrectionRequest,
  appendActivityLog, getActivityLog, backfillActivityLogFromLegacyIfEmpty, backfillMarkdownListItemAddedAt,
  getProductTypeLabels, getProductTypeLabel, upsertProductTypeLabel, normalizeProductType,
  correctSkuGender,
} from './src/data/db.js'
import * as salesEvents from './src/data/salesEvents.js'
import { markdownListVisibleToUser } from './src/utils/markdownAccess.js'
import { createSalesEventsRouter } from './src/server/routes/salesEventsRoutes.js'
import { pickPrimaryLanIp } from './pickLanIp.mjs'
import {
  buildReportingTemplateCsv,
  REPORTING_TEMPLATE_FILE_NAME,
  buildNewArrivalsTemplateCsv,
  NEW_ARRIVALS_TEMPLATE_FILE_NAME,
} from './src/utils/csvImportSpec.js'
import {
  parseCSVText,
  validateReportingRow,
  skuSizeKey,
  reportingLineRevenueFromRow,
  classifyReportingMovement,
} from './src/utils/csvParser.js'
import { detectImageExtension } from './src/utils/imageFormat.js'
import {
  STORE_TRANSFER_WORKFLOW_VERSION,
  buildVerificationEntry,
  getPhaseLines,
  isPhaseComplete,
  verificationTotals,
} from './src/utils/storeTransferVerification.js'
import {
  unavailableOutletSkuCodes,
  outletSkuLocationOwnership,
  outletSkuOwnership,
  receivedOutletTransferUnitsBySku,
  outletVerificationEntryError,
} from './src/utils/outletTransfers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}
loadEnvFile()

const DATA_DIR = process.env.DATA_DIR || __dirname
const PHOTOS_DIR = path.resolve(DATA_DIR, 'photos')
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true })
const IMPORT_ARCHIVE_DIR = path.resolve(DATA_DIR, 'imports')
if (!fs.existsSync(IMPORT_ARCHIVE_DIR)) fs.mkdirSync(IMPORT_ARCHIVE_DIR, { recursive: true })

const IS_PROD = process.env.NODE_ENV === 'production'
if (IS_PROD && !process.env.JWT_SECRET) {
  console.error('[security] JWT_SECRET must be set in production. Refusing to start.')
  process.exit(1)
}
const JWT_SECRET = process.env.JWT_SECRET || 'retailos-dev-secret-change-me'
if (!IS_PROD && !process.env.JWT_SECRET) {
  console.warn('[security] JWT_SECRET is not set — using dev default (unsafe for production)')
}
const jwtSecretKey = new TextEncoder().encode(JWT_SECRET)
const COOKIE_NAME = 'retailos_session'

const SAFE_SKU_PARAM = /^[A-Za-z0-9._-]{1,64}$/
const GENDER_LABELS = { M: 'Male', F: 'Female', K: 'Kids', U: 'Unisex' }
const destructiveRequestKeys = new Map()
const DESTRUCTIVE_KEY_TTL_MS = 15 * 60 * 1000

function assertSafeSku(sku) {
  if (!SAFE_SKU_PARAM.test(String(sku || ''))) {
    const err = new Error('Invalid SKU')
    err.statusCode = 400
    throw err
  }
}

function removeExistingPhotosForSku(skuCode) {
  let files
  try {
    files = fs.readdirSync(PHOTOS_DIR)
  } catch {
    return
  }
  for (const f of files) {
    if (path.basename(f, path.extname(f)) === skuCode) {
      try { fs.unlinkSync(path.join(PHOTOS_DIR, f)) } catch { /* ignore */ }
    }
  }
}

function writePhotoForSku(skuCode, buffer) {
  assertSafeSku(skuCode)
  const ext = detectImageExtension(buffer)
  if (!ext) {
    const err = new Error('Invalid or unsupported image (use JPEG, PNG, WebP, or AVIF)')
    err.statusCode = 400
    throw err
  }
  removeExistingPhotosForSku(skuCode)
  const dest = path.join(PHOTOS_DIR, `${skuCode}${ext}`)
  fs.writeFileSync(dest, buffer)
  return `${skuCode}${ext}`
}

function safeImportFileName(name) {
  const base = path.basename(String(name || 'import.csv'))
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  const withExt = base.toLowerCase().endsWith('.csv') ? base : `${base || 'import'}.csv`
  return withExt || 'import.csv'
}

function writeImportCsvFile(importId, originalName, content) {
  const id = String(importId || '').trim()
  if (!/^[A-Za-z0-9._-]{8,120}$/.test(id)) {
    const err = new Error('Invalid import id')
    err.statusCode = 400
    throw err
  }
  if (typeof content !== 'string' || content.length === 0) {
    const err = new Error('CSV content is required')
    err.statusCode = 400
    throw err
  }
  const safeName = safeImportFileName(originalName)
  const fileName = `${id}__${safeName}`
  const absPath = path.join(IMPORT_ARCHIVE_DIR, fileName)
  fs.writeFileSync(absPath, content, 'utf8')
  const stat = fs.statSync(absPath)
  return {
    fileName,
    filePath: path.relative(DATA_DIR, absPath).replace(/\\/g, '/'),
    fileSize: stat.size,
  }
}

/** YYYY-MM-DD in local time, matching the upload importer. */
function toIsoDateLocal(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function resolveArchivedImportPath(meta) {
  if (!meta?.csv_file_path) {
    const err = new Error('CSV file not archived for this import')
    err.statusCode = 404
    throw err
  }
  const absPath = path.resolve(DATA_DIR, meta.csv_file_path)
  const archiveRoot = path.resolve(IMPORT_ARCHIVE_DIR)
  if (!absPath.startsWith(`${archiveRoot}${path.sep}`)) {
    const err = new Error('Invalid archived CSV path')
    err.statusCode = 400
    throw err
  }
  if (!fs.existsSync(absPath)) {
    const err = new Error('Archived CSV file not found on disk')
    err.statusCode = 404
    throw err
  }
  return absPath
}

function findExistingSkuRow(existingMap, allSkus, sku, size) {
  const k = skuSizeKey(sku, size)
  if (existingMap.has(k)) return existingMap.get(k)
  const kEmpty = skuSizeKey(sku, '')
  if (existingMap.has(kEmpty)) return existingMap.get(kEmpty)
  const want = String(sku ?? '').trim()
  return allSkus.find((s) => String(s.sku ?? '').trim() === want) ?? null
}

function buildReportingReplayEvents(rows, importId, existingSkus) {
  const existingMap = new Map()
  const knownSkuCodes = new Set()
  for (const s of existingSkus) {
    existingMap.set(skuSizeKey(s.sku, s.size), s)
    if (s.sku) knownSkuCodes.add(String(s.sku))
  }

  const recognized = rows.filter((row) => knownSkuCodes.has(String(row.sku)))
  const skippedSkus = [...new Set(rows
    .filter((row) => !knownSkuCodes.has(String(row.sku)))
    .map((row) => String(row.sku || '').trim())
    .filter(Boolean))]

  const eventGroups = new Map()
  for (const row of recognized) {
    const eventDate = toIsoDateLocal(row.sale_date)
    if (!eventDate) continue
    const movement = classifyReportingMovement(row)
    const direction = movement === 'RETURN' ? 'RETURN' : movement === 'SALE' ? 'SALE' : 'UNKNOWN'
    const gk = `${skuSizeKey(row.sku, row.size)}|${eventDate}|${direction}`
    const unitsAbs = Math.abs(Math.round(Number(row.sold_quantity) || 0))
    const units = movement === 'RETURN' ? -unitsAbs : unitsAbs
    if (!eventGroups.has(gk)) {
      eventGroups.set(gk, {
        sku: row.sku,
        size: row.size ?? '',
        eventDate,
        units: 0,
        revenue: 0,
        grossSold: 0,
        grossReturned: 0,
      })
    }
    const eg = eventGroups.get(gk)
    if (movement === 'SALE') eg.grossSold += units
    else if (movement === 'RETURN') eg.grossReturned += unitsAbs
    eg.units += units
    eg.revenue += reportingLineRevenueFromRow(row)
  }

  const salesEvents = []
  for (const eg of eventGroups.values()) {
    if (eg.grossSold === 0 && eg.grossReturned === 0) continue
    const existing = findExistingSkuRow(existingMap, existingSkus, eg.sku, eg.size)
    const ppu = eg.units !== 0 && Math.abs(eg.revenue) > 1e-9 ? eg.revenue / eg.units : 0
    salesEvents.push({
      sku: eg.sku,
      product_name: existing?.product_name ?? '',
      size: eg.size ?? '',
      units_sold: eg.units,
      price_sold: ppu,
      revenue: eg.revenue,
      event_date: eg.eventDate,
      import_id: importId,
    })
  }

  return {
    recognized,
    skippedSkus,
    salesEvents,
  }
}

function reprocessArchivedReportingImport(importId) {
  const meta = getImportCsvFileMeta(importId)
  if (!meta) {
    const err = new Error('Import history record not found')
    err.statusCode = 404
    throw err
  }
  const absPath = resolveArchivedImportPath(meta)
  const csvText = fs.readFileSync(absPath, 'utf8')
  const parsedRows = parseCSVText(csvText)
  const reportingRows = parsedRows.filter((row) => validateReportingRow(row))
  if (reportingRows.length === 0) {
    const err = new Error('Archived file is not a valid reporting CSV')
    err.statusCode = 400
    throw err
  }

  const { recognized, skippedSkus, salesEvents } = buildReportingReplayEvents(
    reportingRows,
    meta.id,
    getAllSkus(),
  )
  const eventsWritten = salesEvents.length > 0
    ? replaceSalesEventsForReportingImport(salesEvents)
    : 0

  return {
    importId: meta.id,
    filename: meta.filename || meta.csv_file_name || 'import.csv',
    rowsParsed: parsedRows.length,
    rowsReportingValid: reportingRows.length,
    rowsRecognized: recognized.length,
    rowsStillSkipped: reportingRows.length - recognized.length,
    salesEventsWritten: eventsWritten,
    skippedSkus,
  }
}

const PRODUCT_TYPE_LABELS = ['tshirt', 'shorts', 'shoe', 'skirt', 'pants', 'hoodie', 'jacket', 'bag', 'dress', 'swimwear', 'other']

function getPhotoFileForSku(skuCode) {
  assertSafeSku(skuCode)
  const files = fs.readdirSync(PHOTOS_DIR)
  const match = files.find((f) => path.basename(f, path.extname(f)) === skuCode)
  if (!match) return null
  const absPath = path.join(PHOTOS_DIR, match)
  const stat = fs.statSync(absPath)
  return {
    absPath,
    fileName: match,
    ext: path.extname(match).toLowerCase(),
    signature: `${match}:${stat.size}:${Math.round(stat.mtimeMs)}`,
  }
}

function imageMimeFromExt(ext) {
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function fallbackProductTypeFromText(product = {}) {
  const hay = `${product.product_name || ''} ${product.category || ''} ${product.sku || ''}`.toLowerCase()
  if (/shoe|sneaker|trainer|slide|sandal|court|runner|boot|pace|barreda|adilette/.test(hay)) return 'shoe'
  if (/short|sho\b|sh\b/.test(hay)) return 'shorts'
  if (/skirt|\bski\b/.test(hay)) return 'skirt'
  if (/pant|trouser|jogger|legging|tight/.test(hay)) return 'pants'
  if (/hoodie|hoody|sweater|sweatshirt|crew|crw|fleece|ft hd/.test(hay)) return 'hoodie'
  if (/jacket|coat|track jacket|windbreaker|bomber|gilet|vest/.test(hay)) return 'jacket'
  if (/bag|backpack|bkpk/.test(hay)) return 'bag'
  if (/dress|\bdre\b/.test(hay)) return 'dress'
  if (/swim|breaker/.test(hay)) return 'swimwear'
  if (/tee|shirt|t-shirt|tshirt|top|polo|tank/.test(hay)) return 'tshirt'
  return 'other'
}

function productMetaBySku(skuCode) {
  const rows = getAllSkus().filter((s) => s.sku === skuCode)
  if (!rows.length) return { sku: skuCode }
  const pick = (key) => rows.find((r) => String(r[key] ?? '').trim())?.[key] || ''
  return {
    sku: skuCode,
    product_name: pick('product_name'),
    category: pick('category'),
    brand: pick('brand'),
    gender: pick('gender'),
  }
}

function parseProductTypeResponse(text) {
  const raw = String(text || '').trim()
  if (!raw) return { product_type: 'other', confidence: 0 }
  try {
    const parsed = JSON.parse(raw)
    return {
      product_type: normalizeProductType(parsed.product_type),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    }
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { product_type: 'other', confidence: 0 }
    const parsed = JSON.parse(match[0])
    return {
      product_type: normalizeProductType(parsed.product_type),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    }
  }
}

async function classifySkuPhoto(skuCode, options = {}) {
  assertSafeSku(skuCode)
  const product = productMetaBySku(skuCode)
  const photo = getPhotoFileForSku(skuCode)
  const cached = getProductTypeLabel(skuCode)
  if (!photo) {
    const label = upsertProductTypeLabel({
      sku: skuCode,
      product_type: fallbackProductTypeFromText(product),
      source: 'fallback',
      confidence: 0.35,
      photo_signature: '',
    })
    return { status: 'no_photo_fallback', label }
  }
  if (!options.force && cached?.photo_signature === photo.signature && cached.product_type) {
    return { status: 'cached', label: cached }
  }
  if (!process.env.OPENAI_API_KEY) {
    const label = cached || upsertProductTypeLabel({
      sku: skuCode,
      product_type: fallbackProductTypeFromText(product),
      source: 'fallback',
      confidence: 0.35,
      photo_signature: photo.signature,
    })
    return { status: 'missing_api_key', label }
  }

  const imageData = fs.readFileSync(photo.absPath).toString('base64')
  const model = process.env.OPENAI_VISION_MODEL || 'gpt-4.1-nano'
  const prompt = [
    'Classify this retail product photo into exactly one product_type.',
    `Allowed product_type values: ${PRODUCT_TYPE_LABELS.join(', ')}.`,
    'Use shoe for all footwear including sneakers, slides, sandals, and boots.',
    'Use tshirt for tees, shirts, polos, tanks, and tops.',
    'Return strict JSON only: {"product_type":"...", "confidence":0.0}.',
    `Known SKU metadata: ${JSON.stringify(product)}`,
  ].join('\n')
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 80,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'product_type_classification',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              product_type: { type: 'string', enum: PRODUCT_TYPE_LABELS },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['product_type', 'confidence'],
          },
        },
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${imageMimeFromExt(photo.ext)};base64,${imageData}`,
              detail: 'low',
            },
          },
        ],
      }],
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const err = new Error(`OpenAI classification failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ''}`)
    err.statusCode = response.status >= 500 ? 502 : 400
    throw err
  }
  const data = await response.json()
  const result = parseProductTypeResponse(data?.choices?.[0]?.message?.content)
  const label = upsertProductTypeLabel({
    sku: skuCode,
    product_type: result.confidence < 0.3 ? 'other' : result.product_type,
    source: 'ai',
    confidence: result.confidence,
    photo_signature: photo.signature,
  })
  return { status: 'classified', model, label }
}

const uploadPhotoMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
})

const uploadImportCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
})

function uploadImportCsvSingle(req, res, next) {
  uploadImportCsv.single('file')(req, res, (err) => {
    if (err) return safeImportError(res, err, req, err.statusCode || 400)
    next()
  })
}

function archiveImportCsv(req, importId, filename, csvText) {
  const meta = writeImportCsvFile(importId, filename, csvText)
  attachImportCsvFile(importId, meta)
  act(req.authUser, {
    category: 'inventory',
    action: 'csv_archived',
    entityType: 'import_batch',
    entityId: importId,
    summary: `Archived source CSV for import ${importId}`,
    meta,
  })
  return meta
}

function safeError(res, e, status = 500) {
  console.error(e)
  const code = typeof e.statusCode === 'number' ? e.statusCode : status
  const msg = code >= 500 && IS_PROD ? 'Internal server error' : (e?.message || 'Error')
  res.status(code).json({ error: msg })
}

function destructiveConfirmValue(action, target) {
  return `${action}:${String(target || '')}`
}

function pruneDestructiveRequestKeys(now = Date.now()) {
  for (const [key, ts] of destructiveRequestKeys.entries()) {
    if (now - ts > DESTRUCTIVE_KEY_TTL_MS) destructiveRequestKeys.delete(key)
  }
}

function readDestructiveConfirmation(req) {
  return req.get('x-destructive-confirm') || req.body?.confirmAction || req.query?.confirmAction || ''
}

function readIdempotencyKey(req) {
  return req.get('idempotency-key') || req.body?.idempotencyKey || ''
}

function requireDestructiveConfirmation(req, res, action, target) {
  const expected = destructiveConfirmValue(action, target)
  const provided = String(readDestructiveConfirmation(req))
  if (provided !== expected) {
    return res.status(400).json({
      error: 'Server-side confirmation required for this destructive action.',
      code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED',
      expectedConfirm: expected,
    })
  }
  const idempotencyKey = String(readIdempotencyKey(req)).trim()
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(idempotencyKey)) {
    return res.status(400).json({
      error: 'Idempotency key required for this destructive action.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })
  }
  pruneDestructiveRequestKeys()
  const replayKey = `${req.authUser?.id || 'unknown'}:${action}:${target}:${idempotencyKey}`
  if (destructiveRequestKeys.has(replayKey)) {
    return res.status(409).json({
      error: 'Duplicate destructive request blocked.',
      code: 'DESTRUCTIVE_REPLAY_BLOCKED',
    })
  }
  destructiveRequestKeys.set(replayKey, Date.now())
  return null
}

function makeErrorId() {
  return `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function classifyImportError(e, fallbackStatus = 500) {
  const status = typeof e?.statusCode === 'number' ? e.statusCode : fallbackStatus
  const raw = String(e?.message || '')
  const lower = raw.toLowerCase()
  if (status === 400 || status === 404 || status === 413) {
    if (lower.includes('invalid import id')) {
      return { status: 400, code: 'IMPORT_INVALID_ID', message: 'Import id is invalid.' }
    }
    if (lower.includes('csv content is required')) {
      return { status: 400, code: 'IMPORT_CSV_REQUIRED', message: 'CSV content is required.' }
    }
    if (lower.includes('not a valid reporting csv')) {
      return { status: 400, code: 'IMPORT_INVALID_REPORTING_CSV', message: 'Archived file is not a valid reporting CSV.' }
    }
    if (lower.includes('history record not found')) {
      return { status: 404, code: 'IMPORT_NOT_FOUND', message: 'Import history record was not found.' }
    }
    if (lower.includes('csv file not archived')) {
      return { status: 404, code: 'IMPORT_ARCHIVE_MISSING', message: 'No archived CSV is available for this import.' }
    }
    if (lower.includes('archived csv file not found')) {
      return { status: 404, code: 'IMPORT_ARCHIVE_FILE_MISSING', message: 'Archived CSV file is missing from storage.' }
    }
    if (lower.includes('invalid archived csv path')) {
      return { status: 400, code: 'IMPORT_ARCHIVE_INVALID', message: 'Archived CSV path is invalid.' }
    }
    if (e?.code === 'LIMIT_FILE_SIZE' || lower.includes('file too large') || lower.includes('too large')) {
      return { status: 413, code: 'IMPORT_FILE_TOO_LARGE', message: 'CSV file is too large.' }
    }
    return { status, code: 'IMPORT_BAD_REQUEST', message: raw || 'Import request is invalid.' }
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    code: 'IMPORT_INTERNAL_ERROR',
    message: 'Import failed due to a server error. Please try again or contact support with the error id.',
  }
}

function importErrorPayload(e, fallbackStatus = 500) {
  return classifyImportError(e, fallbackStatus)
}

function safeImportError(res, e, req, status = 500) {
  const id = makeErrorId()
  const payload = importErrorPayload(e, status)
  console.error('[import]', {
    id,
    method: req?.method,
    path: req?.path,
    status: payload.status,
    code: payload.code,
    userId: req?.authUser?.id,
    message: e?.message,
    stack: e?.stack,
  })
  res.status(payload.status).json({
    error: payload.message,
    code: payload.code,
    errorId: id,
  })
}

/** Append audit row; user from JWT (req.authUser). */
function act(user, payload) {
  appendActivityLog({
    actorUserId: user?.id ?? null,
    actorName: user?.name || 'Unknown',
    ...payload,
  })
}

function filterAssignments(rows, user) {
  if (user.role === 'executive') return rows
  return rows.filter((a) =>
    a.assignedTo === user.id ||
    a.assignedBy === user.id ||
    (a.shop && user.shop && a.shop === user.shop),
  )
}

function filterStoreTransfers(rows, user) {
  if (user.role === 'executive') return rows
  return rows.filter((t) => t.fromShop === user.shop || t.toShop === user.shop)
}

function filterShiftHistory(rows, user) {
  if (user.role === 'executive') return rows
  return rows.filter((s) => s.user_id === user.id || s.shop === user.shop)
}

function canManageShiftShop(user, shop) {
  return user.role === 'executive' || (user.shop === shop && isShiftPlanner(user.id, shop))
}

function assertCanManageShiftShop(user, shop) {
  if (!canManageShiftShop(user, shop)) {
    const error = new Error('You are not assigned to manage this shop schedule')
    error.statusCode = 403
    throw error
  }
}

function filterNotifications(rows, user) {
  const isExec = user.role === 'executive'
  const visible = rows.filter((n) => notificationVisibleTo(n, user.id, isExec))
  if (!isExec) return visible
  const seenShiftEvents = new Set()
  return visible.filter((notification) => {
    if (!String(notification.type || '').startsWith('shift_') || !notification.relatedId) return true
    const key = `${notification.type}:${notification.relatedId}`
    if (seenShiftEvents.has(key)) return false
    seenShiftEvents.add(key)
    return true
  })
}

function filterOutletTransfers(rows, user) {
  if (user.role === 'executive') return rows
  if (user.role === 'outlet') return rows
  return rows.filter(
    (t) => t.createdBy === user.id ||
      splitIdList(t.assignedTo).includes(user.id) ||
      (t.fromShop && user.shop && t.fromShop === user.shop),
  )
}

function assertSkusAvailableOutsideOutlet(items, excludeOutletTransferId = null) {
  const conflicts = unavailableOutletSkuCodes(
    items,
    getAllOutletTransfers(),
    getAllMarkdownLists(),
    excludeOutletTransferId,
  )
  if (conflicts.length === 0) return
  const shown = conflicts.slice(0, 5).join(', ')
  const extra = conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : ''
  const error = new Error(`${shown}${extra} ${conflicts.length === 1 ? 'is' : 'are'} already assigned to Outlet or an active Outlet transfer`)
  error.statusCode = 409
  throw error
}

function withOutletStockLocation(rows) {
  const transfers = getAllOutletTransfers()
  const reservations = outletSkuOwnership(transfers)
  const locations = outletSkuLocationOwnership(transfers, getAllMarkdownLists())
  const receivedUnits = receivedOutletTransferUnitsBySku(transfers)
  const catalogOnHand = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const skuCode = String(row?.sku ?? '').trim()
    if (!skuCode) continue
    const netUnits = (Number(row?.quantity) || 0) - (Number(row?.sold_quantity) || 0)
    catalogOnHand.set(skuCode, (catalogOnHand.get(skuCode) || 0) + netUnits)
  }
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const skuCode = String(row?.sku ?? '').trim()
    const reservation = reservations.get(skuCode)
    const location = locations.get(skuCode)
    if (!reservation && !location) return row
    const enriched = {
      ...row,
      outlet_transfer_reserved: Boolean(reservation),
      outlet_transfer_id: reservation?.transferId || location?.transferId || null,
      outlet_transfer_status: reservation?.status || null,
    }
    if (location) {
      enriched.stock_location = 'Outlet'
      enriched.outlet_location_source = location.source
      enriched.outlet_from_shop = location.fromShop || ''
      enriched.outlet_located_at = location.locatedAt || ''
      enriched.outlet_units_basis = location.source === 'outlet_transfer' ? 'received' : 'catalog_on_hand'
      enriched.outlet_units = location.source === 'outlet_transfer'
        ? (receivedUnits.get(skuCode) || 0)
        : Math.max(0, catalogOnHand.get(skuCode) || 0)
    }
    return enriched
  })
}

function assignmentVisibleToUser(row, user) {
  if (user.role === 'executive') return true
  return (
    row.assignedTo === user.id ||
    row.assignedBy === user.id ||
    (row.shop && user.shop && row.shop === user.shop)
  )
}

function outletTransferVisibleToUser(t, user) {
  if (user.role === 'executive') return true
  if (user.role === 'outlet') return true
  return t.createdBy === user.id ||
    splitIdList(t.assignedTo).includes(user.id) ||
    (t.fromShop && user.shop && t.fromShop === user.shop)
}

function outletTransferAssignedToUpdateAllowed(user, nextAssignedTo, fromShop) {
  if (user.role === 'executive') return true
  const ids = splitIdList(nextAssignedTo)
  if (ids.length === 0) return true
  if (!user.shop || !strEq(user.shop, fromShop)) return false
  const usersById = new Map(getAllUsers().map((candidate) => [candidate.id, candidate]))
  return ids.every((id) => {
    const target = usersById.get(id)
    return target?.role === 'manager' && strEq(target.shop, user.shop)
  })
}

function splitIdList(value) {
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

function outletTransferUserRole(t, user) {
  if (user.role === 'executive') return { executive: true, sender: true, outlet: true }
  return {
    executive: false,
    sender: t.createdBy === user.id ||
      splitIdList(t.assignedTo).includes(user.id) ||
      (t.fromShop && user.shop && t.fromShop === user.shop),
    outlet: user.role === 'outlet',
  }
}

function outletTransferAllVerified(row, statuses) {
  const expected = flattenStoreTransferItems(row.items)
  if (!expected.length) return false
  return expected.every((line) => {
    return !outletVerificationEntryError(statuses?.[line.key], line.qty)
  })
}

function validateOutletTransferItemStatuses(row, statuses) {
  validateStoreTransferItemStatuses(row, statuses)
  const expected = new Map(flattenStoreTransferItems(row.items).map((line) => [line.key, line.qty]))
  for (const [key, entry] of Object.entries(statuses)) {
    const lineQty = Math.max(0, Number(expected.get(key)) || 0)
    const status = entry.status == null ? '' : String(entry.status)
    const received = entry.received == null ? lineQty : Number(entry.received)
    const missing = entry.missing == null ? 0 : Number(entry.missing)
    if (!Number.isInteger(received) || !Number.isInteger(missing)) {
      const err = new Error('Outlet receipt quantities must be whole numbers')
      err.statusCode = 400
      throw err
    }
    if (status && received + missing !== lineQty) {
      const err = new Error('Confirmed and missing quantities must account for the full transfer quantity')
      err.statusCode = 400
      throw err
    }
    if (
      (status === 'done' && (received !== lineQty || missing !== 0)) ||
      (status === 'partial' && (received <= 0 || missing <= 0)) ||
      (status === 'missing' && (received !== 0 || missing !== lineQty))
    ) {
      const err = new Error('Outlet item status does not match its confirmed and missing quantities')
      err.statusCode = 400
      throw err
    }
  }
}

function validateOutletTransferUpdate(row, user, changes) {
  const roles = outletTransferUserRole(row, user)
  const has = (k) => Object.prototype.hasOwnProperty.call(changes || {}, k)
  const current = String(row.status || 'pending')
  const nextStatus = has('status') ? String(changes.status || '') : current

  if (has('items')) {
    if ((!roles.sender && !roles.executive) || current !== 'pending') {
      const err = new Error('Only the sending shop can add products before verification is completed')
      err.statusCode = 403
      throw err
    }
    if (!Array.isArray(changes.items)) {
      const err = new Error('items must be an array')
      err.statusCode = 400
      throw err
    }
  }

  if (has('item_statuses')) {
    if (!roles.sender && !roles.executive) {
      const err = new Error('Only the sending shop can verify outlet transfer items')
      err.statusCode = 403
      throw err
    }
    if (current !== 'pending') {
      const err = new Error('Outlet transfer items can only be verified before Outlet receipt')
      err.statusCode = 403
      throw err
    }
    validateOutletTransferItemStatuses(row, changes.item_statuses)
  }

  if (has('status') && !strEq(changes.status, row.status)) {
    if (nextStatus === 'completed') {
      if (!roles.sender && !roles.executive) {
        const err = new Error('Only the sending shop can complete outlet transfer verification')
        err.statusCode = 403
        throw err
      }
      const statuses = has('item_statuses') ? changes.item_statuses : (row.item_statuses || {})
      if (!outletTransferAllVerified(row, statuses)) {
        const err = new Error('All outlet transfer items must be verified before completion')
        err.statusCode = 400
        throw err
      }
      return null
    }

    if (nextStatus === 'received') {
      if (!roles.outlet && !roles.executive) {
        const err = new Error('Only Outlet can confirm outlet transfer receipt')
        err.statusCode = 403
        throw err
      }
      if (current !== 'completed') {
        const err = new Error('Outlet transfer must be completed before receipt')
        err.statusCode = 403
        throw err
      }
      return null
    }

    const err = new Error('Invalid outlet transfer status transition')
    err.statusCode = 403
    throw err
  }

  return null
}

function outletAutoSaleTargets() {
  return getAllUsers()
    .filter((u) => u.role === 'marketing' || u.role === 'executive')
    .map((u) => u.id)
    .filter(Boolean)
}

function createOutletEcommerceSaleIfNeeded(transferId, actor) {
  const targets = outletAutoSaleTargets()
  const result = createEcommerceSaleListForOutletTransfer(
    transferId,
    actor?.id || '',
    targets.length ? targets.join(',') : null,
  )
  if (!result?.created || !result.list) return result

  const totalUnits = (result.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  const summary = `E-commerce 20% sale created from outlet transfer (${result.items.length} products, ${totalUnits} units)`
  for (const uid of targets) {
    insertAssignment({
      type: 'sale',
      skuCode: result.list.id,
      productName: `Sale list: ${result.list.title}`,
      assignedTo: uid,
      assignedBy: actor?.id || '',
      shop: 'E-commerce',
      status: 'pending',
      note: `${result.items.length} products - auto-created from Outlet confirmation`,
    })
    insertNotification({
      type: 'ecommerce_sale_created',
      title: 'E-commerce Sale Created',
      message: `${actor?.name || 'Outlet'} confirmed an outlet transfer. ${summary}.`,
      userId: uid,
      relatedId: result.list.id,
    })
  }
  act(actor, {
    category: 'markdown',
    action: 'ecommerce_sale_created',
    entityType: 'markdown_list',
    entityId: result.list.id,
    summary,
    meta: { sourceTransferId: transferId, products: result.items.length, units: totalUnits },
  })
  return result
}

function outletWebLocationTargets() {
  return getAllUsers()
    .filter((u) => u.role === 'executive')
    .map((u) => u.id)
    .filter(Boolean)
}

function createOutletWebLocationIfNeeded(transferId, actor) {
  const targets = outletWebLocationTargets()
  const result = createLocationChangeListForOutletTransfer(
    transferId,
    actor?.id || '',
    targets.length ? targets.join(',') : null,
  )
  if (!result?.created || !result.list) return result

  for (const userId of targets) {
    insertNotification({
      type: 'outlet_web_location_ready',
      title: 'Change Location Web',
      message: `${actor?.name || 'Outlet'} confirmed an Outlet transfer. ${result.items.length} product${result.items.length === 1 ? '' : 's'} need a website location update.`,
      userId,
      relatedId: transferId,
    })
  }
  act(actor, {
    category: 'transfer_outlet',
    action: 'web_location_checklist_created',
    entityType: 'markdown_list',
    entityId: result.list.id,
    summary: `Change Location Web checklist created (${result.items.length} products)`,
    meta: { sourceTransferId: transferId, products: result.items.length },
  })
  return result
}

function storeTransferVisibleToUser(t, user) {
  if (user.role === 'executive') return true
  return (
    t.fromShop === user.shop ||
    t.toShop === user.shop ||
    t.createdBy === user.id ||
    splitIdList(t.assignedTo).includes(user.id) ||
    splitIdList(t.receiverAssignedTo).includes(user.id)
  )
}

function storeTransferUserRole(t, user) {
  if (user.role === 'executive') return { executive: true, sender: true, receiver: true }
  const shop = user.shop ?? ''
  return {
    executive: false,
    sender: (shop && t.fromShop === shop) || t.createdBy === user.id,
    receiver: shop && t.toShop === shop,
  }
}

function isTwoPhaseStoreTransfer(row) {
  return Number(row?.workflow_version) >= STORE_TRANSFER_WORKFLOW_VERSION
}

function assertStoreTransferPhaseAccess(row, user, phase) {
  const roles = storeTransferUserRole(row, user)
  const allowed = phase === 'send' ? roles.sender : roles.receiver
  if (!allowed && !roles.executive) {
    const err = new Error(`Only the ${phase === 'send' ? 'sending' : 'receiving'} shop can verify this transfer`)
    err.statusCode = 403
    throw err
  }
}

function destinationTransferRecipients(row) {
  const onShift = getActiveShifts()
    .filter((shift) => strEq(shift.shop, row.toShop))
    .map((shift) => shift.user_id)
    .filter(Boolean)
  if (onShift.length) return [...new Set(onShift)]
  return getAllUsers()
    .filter((user) => user.role === 'manager' && strEq(user.shop, row.toShop))
    .map((user) => user.id)
    .filter(Boolean)
}

function transferSummary(row) {
  const products = Array.isArray(row.items) ? row.items.length : 0
  const units = (row.items || []).reduce((sum, item) => sum + (Number(item.totalQty ?? item.quantity) || 0), 0)
  return { products, units }
}

function flattenStoreTransferItems(items) {
  const lines = []
  for (const it of Array.isArray(items) ? items : []) {
    if (Array.isArray(it?.sizeBreakdown) && it.sizeBreakdown.length > 0) {
      for (const sb of it.sizeBreakdown) {
        lines.push({
          key: `${String(it.skuCode ?? '')}|${String(sb.size ?? '')}`,
          qty: Number(sb.qty) || 0,
        })
      }
      continue
    }
    const sizes = String(it?.sizes || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (sizes.length > 0) {
      const perSize = Math.ceil((Number(it.totalQty ?? it.quantity) || 0) / sizes.length)
      for (const size of sizes) lines.push({ key: `${String(it.skuCode ?? '')}|${size}`, qty: perSize })
    } else {
      lines.push({
        key: `${String(it?.skuCode ?? '')}|One Size`,
        qty: Number(it?.totalQty ?? it?.quantity) || 0,
      })
    }
  }
  return lines
}

function validateStoreTransferItemStatuses(row, statuses) {
  if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) {
    const err = new Error('item_statuses must be an object')
    err.statusCode = 400
    throw err
  }
  const expected = new Map(flattenStoreTransferItems(row.items).map((line) => [line.key, line.qty]))
  const allowedStatuses = new Set(['', 'done', 'missing', 'partial'])
  for (const [key, entry] of Object.entries(statuses)) {
    if (!expected.has(key)) {
      const err = new Error('item_statuses contains a product that is not in this transfer')
      err.statusCode = 400
      throw err
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      const err = new Error('item_statuses entries must be objects')
      err.statusCode = 400
      throw err
    }
    const lineQty = Math.max(0, Number(expected.get(key)) || 0)
    const status = entry.status == null ? '' : String(entry.status)
    if (!allowedStatuses.has(status)) {
      const err = new Error('Invalid item status')
      err.statusCode = 400
      throw err
    }
    const received = entry.received == null ? lineQty : Number(entry.received)
    const missing = entry.missing == null ? 0 : Number(entry.missing)
    if (!Number.isFinite(received) || !Number.isFinite(missing) || received < 0 || missing < 0) {
      const err = new Error('Receipt quantities must be valid non-negative numbers')
      err.statusCode = 400
      throw err
    }
    if (received > lineQty || missing > lineQty || received + missing > lineQty) {
      const err = new Error('Receipt quantities cannot exceed the transfer quantity')
      err.statusCode = 400
      throw err
    }
  }
}

function storeTransferAllVerified(row, statuses) {
  const expected = flattenStoreTransferItems(row.items)
  if (!expected.length) return false
  return expected.every((line) => {
    const entry = statuses?.[line.key]
    if (entry?.status === 'done') return true
    return entry?.status === 'missing' && String(entry.comment || '').trim().length > 0
  })
}

function validateStoreTransferUpdate(row, user, changes) {
  if (user.role === 'executive') {
    if (Object.prototype.hasOwnProperty.call(changes || {}, 'item_statuses')) {
      validateStoreTransferItemStatuses(row, changes.item_statuses)
    }
    if (changes?.status === 'completed') {
      const statuses = Object.prototype.hasOwnProperty.call(changes, 'item_statuses') ? changes.item_statuses : (row.item_statuses || {})
      if (!storeTransferAllVerified(row, statuses)) {
        const err = new Error('Every SKU must be marked done or not in stock with an explanation')
        err.statusCode = 400
        throw err
      }
    }
    return null
  }
  const roles = storeTransferUserRole(row, user)
  const has = (k) => Object.prototype.hasOwnProperty.call(changes || {}, k)
  const nextStatus = has('status') ? String(changes.status || '') : String(row.status || 'pending')

  if (has('items')) {
    if (!roles.sender || String(row.status || 'pending') !== 'pending') {
      const err = new Error('Only the sending shop can edit items before receipt starts')
      err.statusCode = 403
      throw err
    }
    if (!Array.isArray(changes.items)) {
      const err = new Error('items must be an array')
      err.statusCode = 400
      throw err
    }
  }

  if (has('receivedAt')) {
    if (!roles.receiver) {
      const err = new Error('Only the receiving shop can mark a transfer received')
      err.statusCode = 403
      throw err
    }
  }

  if (has('item_statuses')) {
    if (!roles.receiver) {
      const err = new Error('Only an assigned manager or the receiving shop can verify transfer items')
      err.statusCode = 403
      throw err
    }
    if (!(String(row.status || 'pending') === 'pending' || String(row.status || 'pending') === 'in_progress' || nextStatus === 'completed')) {
      const err = new Error('Transfer items can only be verified before completion')
      err.statusCode = 403
      throw err
    }
    validateStoreTransferItemStatuses(row, changes.item_statuses)
  }

  if (has('status') && !strEq(changes.status, row.status)) {
    const current = String(row.status || 'pending')
    if (!roles.receiver) {
      const err = new Error('Only the receiving shop can update transfer status')
      err.statusCode = 403
      throw err
    }
    const allowed =
      (current === 'pending' && nextStatus === 'in_progress') ||
      (current === 'pending' && nextStatus === 'completed') ||
      (current === 'in_progress' && nextStatus === 'completed')
    if (!allowed) {
      const err = new Error('Invalid store transfer status transition')
      err.statusCode = 403
      throw err
    }
    if (nextStatus === 'completed') {
      const statuses = has('item_statuses') ? changes.item_statuses : (row.item_statuses || {})
      if (!storeTransferAllVerified(row, statuses)) {
        const err = new Error('Every SKU must be marked done or not in stock with an explanation')
        err.statusCode = 400
        throw err
      }
    }
  }

  return null
}

function strEq(a, b) {
  return (a == null ? '' : String(a)) === (b == null ? '' : String(b))
}

function notificationCreateAllowed(auth, body) {
  if (auth.role === 'executive') return true
  const uid = body.userId
  if (uid === 'all' || uid === 'executives' || uid === auth.id) return true
  const target = getPublicUserById(uid)
  if (!target) return false
  if (strEq(target.shop, auth.shop)) return true
  if (
    (body.type === 'transfer_missing_items' || body.type === 'transfer_received') &&
    body.relatedId
  ) {
    const st = getStoreTransferById(body.relatedId)
    if (st && storeTransferVisibleToUser(st, auth) && uid === st.createdBy) return true
    const ot = getOutletTransferById(body.relatedId)
    if (ot && outletTransferVisibleToUser(ot, auth) && uid === ot.createdBy) return true
  }
  if (body.type === 'transfer_created' && body.relatedId) {
    const st = getStoreTransferById(body.relatedId)
    if (st && (st.createdBy === auth.id || storeTransferVisibleToUser(st, auth))) return true
    const ot = getOutletTransferById(body.relatedId)
    if (ot && (ot.createdBy === auth.id || outletTransferVisibleToUser(ot, auth))) return true
  }
  if (body.type === 'alert_assigned') {
    if (auth.role === 'outlet' && target.role === 'manager') return true
    if (auth.role === 'manager' && target.role === 'outlet') return true
  }
  return false
}

const corsAllowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  jwtVerify(token, jwtSecretKey)
    .then(({ payload }) => {
      const user = getPublicUserById(payload.sub)
      if (!user) return res.status(401).json({ error: 'Unauthorized' })
      req.authUser = user
      next()
    })
    .catch(() => res.status(401).json({ error: 'Unauthorized' }))
}

function requireExecutive(req, res, next) {
  if (req.authUser.role !== 'executive') {
    return res.status(403).json({ error: 'Executive access required' })
  }
  next()
}

function requireManagerOrExecutive(req, res, next) {
  if (req.authUser?.role !== 'executive' && req.authUser?.role !== 'manager') {
    return res.status(403).json({ error: 'Manager or executive access required' })
  }
  next()
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function activityCsv(activity) {
  const lines = [
    ['RetailOS', 'Product Sales Card'],
    ['SKU', activity.sku],
    ['Generated', new Date().toISOString()],
    [],
    ['Event Type', 'Date', 'SKU', 'Product', 'Size', 'Barcode', 'Quantity', 'Signed Quantity', 'Unit Price', 'Amount', 'Running Stock', 'Source File', 'Import ID', 'Order ID', 'Exchange Group ID'],
    ...activity.events.map((e) => [e.eventType, e.eventDate, e.sku, e.productName, e.size, e.barcode, e.quantity, e.signedQuantity, e.unitPrice, e.amount, e.runningStock, e.sourceFile, e.importId, e.orderId, e.exchangeGroupId]),
  ]
  return '\uFEFF' + lines.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

async function activityXlsx(activity) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'RetailOS'
  const sheet = workbook.addWorksheet('Product Sales Card', { views: [{ state: 'frozen', ySplit: 5 }] })
  sheet.mergeCells('A1:O1'); sheet.getCell('A1').value = 'RetailOS — Product Sales Card'; sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }; sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } }
  sheet.addRow(['SKU', activity.sku]); sheet.addRow(['Generated', new Date().toISOString()]); sheet.addRow([])
  const headers = ['Event Type', 'Date', 'SKU', 'Product', 'Size', 'Barcode', 'Quantity', 'Signed Quantity', 'Unit Price', 'Amount', 'Running Stock', 'Source File', 'Import ID', 'Order ID', 'Exchange Group ID']
  const headerRow = sheet.addRow(headers)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }; headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
  activity.events.forEach((e) => sheet.addRow([e.eventType, e.eventDate, e.sku, e.productName, e.size, e.barcode, e.quantity, e.signedQuantity, e.unitPrice, e.amount, e.runningStock, e.sourceFile, e.importId, e.orderId, e.exchangeGroupId]))
  sheet.autoFilter = { from: 'A5', to: `O${sheet.rowCount}` }
  sheet.columns.forEach((c) => { c.width = Math.min(Math.max((c.header || '').length + 3, 12), 28) })
  ;[9, 10].forEach((index) => sheet.getColumn(index).numFmt = '#,##0.00')
  return workbook.xlsx.writeBuffer()
}

function attendanceReportTime(iso, timeZone) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

function attendanceReportStatus(row) {
  const labels = {
    completed: 'Completed', active: 'Active', scheduled: 'Scheduled', no_show: 'No-show',
    day_off: 'Day off', unscheduled: 'Unscheduled', active_unscheduled: 'Active · unscheduled',
  }
  return labels[row.status] || row.status
}

const attendanceSummaryColumns = [
  ['Shop', 'shop'], ['Employee', 'user_name'], ['Scheduled', 'scheduled_periods'],
  ['Due', 'attendance_due'], ['Attended', 'attended_periods'], ['Attendance %', 'attendance_rate'],
  ['Late', 'late_count'], ['Late Minutes', 'late_minutes'], ['No-shows', 'no_show_count'],
  ['Early Departures', 'early_departure_count'], ['Early Minutes', 'early_departure_minutes'],
  ['Overruns', 'overrun_count'], ['Overrun Minutes', 'overrun_minutes'],
  ['Unscheduled', 'unscheduled_count'], ['Days Off', 'day_off_count'], ['Worked Hours', 'worked_hours'],
]

function attendanceSummaryValues(summary) {
  return { ...summary, worked_hours: Math.round((summary.worked_minutes / 60) * 100) / 100 }
}

function monthlyAttendanceCsv(report) {
  const metrics = [
    ['Attendance rate', report.summary.attendance_rate == null ? '' : `${report.summary.attendance_rate}%`],
    ['Scheduled periods', report.summary.scheduled_periods], ['Attendance due', report.summary.attendance_due],
    ['Attended periods', report.summary.attended_periods], ['Late arrivals', report.summary.late_count],
    ['Late minutes', report.summary.late_minutes], ['No-shows', report.summary.no_show_count],
    ['Early departures', report.summary.early_departure_count], ['Overruns', report.summary.overrun_count],
    ['Unscheduled clock-ins', report.summary.unscheduled_count], ['Days off', report.summary.day_off_count],
    ['Worked hours', Math.round((report.summary.worked_minutes / 60) * 100) / 100],
  ]
  const detailHeaders = ['Date', 'Shop', 'Employee', 'Planned', 'Actual In', 'Actual Out', 'Worked Hours', 'Status', 'Exceptions', 'Late Minutes', 'Early Minutes', 'Overrun Minutes']
  const lines = [
    ['RetailOS', 'Monthly Attendance Report'], ['Month', report.month_label],
    ['Timezone', report.timezone], ['Generated', report.generated_at], [],
    ['Monthly summary'], ['Metric', 'Value'], ...metrics, [],
    ['Employee summary'], attendanceSummaryColumns.map(([label]) => label),
    ...report.employee_summaries.map((summary) => {
      const values = attendanceSummaryValues(summary)
      return attendanceSummaryColumns.map(([, key]) => values[key] ?? '')
    }), [], ['Attendance details'], detailHeaders,
    ...report.rows.map((row) => [
      row.date, row.shop, row.user_name,
      row.plan_type === 'shift' ? `${row.planned_start}–${row.planned_end}` : row.plan_type === 'day_off' ? 'Day off' : '',
      attendanceReportTime(row.actual_clock_in, report.timezone), attendanceReportTime(row.actual_clock_out, report.timezone),
      Math.round((row.worked_minutes / 60) * 100) / 100, attendanceReportStatus(row), row.flags.join('; '),
      row.late_minutes, row.early_departure_minutes, row.overrun_minutes,
    ]),
  ]
  return '\uFEFF' + lines.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

function styleAttendanceHeader(row, color = 'FF6D3CF5') {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
  row.alignment = { vertical: 'middle' }
}

function fitAttendanceColumns(sheet, minimum = 11, maximum = 26) {
  sheet.columns.forEach((column) => {
    let width = minimum
    column.eachCell?.({ includeEmpty: true }, (cell) => { width = Math.max(width, String(cell.value ?? '').length + 2) })
    column.width = Math.min(width, maximum)
  })
}

async function monthlyAttendanceXlsx(report) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'RetailOS'
  workbook.created = new Date()
  const overview = workbook.addWorksheet('Overview', { views: [{ state: 'frozen', ySplit: 5 }] })
  overview.mergeCells('A1:D1'); overview.getCell('A1').value = 'RetailOS — Monthly Attendance Report'
  overview.getCell('A1').font = { bold: true, size: 17, color: { argb: 'FFFFFFFF' } }
  overview.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF171226' } }
  overview.getCell('A1').alignment = { vertical: 'middle' }; overview.getRow(1).height = 27
  overview.addRow(['Month', report.month_label]); overview.addRow(['Timezone', report.timezone]); overview.addRow(['Generated', report.generated_at]); overview.addRow([])
  const overviewHeader = overview.addRow(['Metric', 'Value']); styleAttendanceHeader(overviewHeader)
  ;[
    ['Attendance rate', report.summary.attendance_rate == null ? '—' : `${report.summary.attendance_rate}%`],
    ['Scheduled periods', report.summary.scheduled_periods], ['Attendance due', report.summary.attendance_due],
    ['Attended periods', report.summary.attended_periods], ['Late arrivals', report.summary.late_count],
    ['Late minutes', report.summary.late_minutes], ['No-shows', report.summary.no_show_count],
    ['Early departures', report.summary.early_departure_count], ['Early minutes', report.summary.early_departure_minutes],
    ['Overruns', report.summary.overrun_count], ['Overrun minutes', report.summary.overrun_minutes],
    ['Unscheduled clock-ins', report.summary.unscheduled_count], ['Days off', report.summary.day_off_count],
    ['Worked hours', Math.round((report.summary.worked_minutes / 60) * 100) / 100],
  ].forEach((row) => overview.addRow(row))
  fitAttendanceColumns(overview, 16, 34)

  const employees = workbook.addWorksheet('Employee Summary', { views: [{ state: 'frozen', ySplit: 1 }] })
  const employeeHeader = employees.addRow(attendanceSummaryColumns.map(([label]) => label)); styleAttendanceHeader(employeeHeader)
  report.employee_summaries.forEach((summary) => {
    const values = attendanceSummaryValues(summary)
    employees.addRow(attendanceSummaryColumns.map(([, key]) => values[key] ?? ''))
  })
  employees.autoFilter = { from: 'A1', to: `P${Math.max(1, employees.rowCount)}` }
  fitAttendanceColumns(employees)

  const details = workbook.addWorksheet('Attendance Details', { views: [{ state: 'frozen', ySplit: 1 }] })
  const detailHeaders = ['Date', 'Shop', 'Employee', 'Planned', 'Actual In', 'Actual Out', 'Worked Hours', 'Status', 'Exceptions', 'Late Minutes', 'Early Minutes', 'Overrun Minutes']
  const detailHeader = details.addRow(detailHeaders); styleAttendanceHeader(detailHeader, 'FF0F988C')
  report.rows.forEach((row) => details.addRow([
    row.date, row.shop, row.user_name,
    row.plan_type === 'shift' ? `${row.planned_start}–${row.planned_end}` : row.plan_type === 'day_off' ? 'Day off' : '',
    attendanceReportTime(row.actual_clock_in, report.timezone), attendanceReportTime(row.actual_clock_out, report.timezone),
    Math.round((row.worked_minutes / 60) * 100) / 100, attendanceReportStatus(row), row.flags.join('; '),
    row.late_minutes, row.early_departure_minutes, row.overrun_minutes,
  ]))
  details.autoFilter = { from: 'A1', to: `L${Math.max(1, details.rowCount)}` }
  fitAttendanceColumns(details)
  return workbook.xlsx.writeBuffer()
}

function apiAuthGate(req, res, next) {
  if (!req.path.startsWith('/api')) return next()
  if (req.path === '/api/health') return next()
  if (req.path === '/api/templates/reporting.csv') return next()
  if (req.path === '/api/templates/new-arrivals.csv') return next()
  if (req.path === '/api/auth/login' && req.method === 'POST') return next()
  if (req.path === '/api/auth/logout' && req.method === 'POST') return next()
  return requireAuth(req, res, next)
}

const app = express()
const PORT = process.env.PORT || 3001

// nginx reverse proxy sends X-Forwarded-*; required for rate-limit behind nginx
app.set('trust proxy', 1)

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
app.use(cors({
  credentials: true,
  origin: IS_PROD
    ? (origin, cb) => {
        if (!origin) return cb(null, true)
        if (corsAllowedOrigins.length && corsAllowedOrigins.includes(origin)) {
          return cb(null, true)
        }
        return cb(null, false)
      }
    : true,
}))
app.use(cookieParser())
app.use(express.json({ limit: '50mb' }))

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Upload too large. Raise nginx client_max_body_size (e.g. 50m) and proxy_read_timeout on the server.',
    })
  }
  next(err)
})

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
})
const apiSoftLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => (
    req.path === '/health' ||
    req.path === '/templates/reporting.csv' ||
    req.path === '/templates/new-arrivals.csv'
  ),
})
app.use('/api', apiSoftLimiter)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/templates/reporting.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${REPORTING_TEMPLATE_FILE_NAME}"`)
  res.send(buildReportingTemplateCsv())
})

app.get('/api/templates/new-arrivals.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${NEW_ARRIVALS_TEMPLATE_FILE_NAME}"`)
  res.send(buildNewArrivalsTemplateCsv())
})

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const code = req.body?.user_code ?? req.body?.userCode
    const pin = req.body?.pin
    const row = getUserRowByUserCode(code)
    if (!row || !verifyPin(pin, row.pin)) {
      return res.status(401).json({ error: 'Invalid code or PIN' })
    }
    const user = toPublicUser(row)
    const token = await new SignJWT({
      sub: row.id,
      role: row.role,
      shop: row.shop || '',
      name: row.name,
      user_code: row.user_code,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(jwtSecretKey)

    const secure = IS_PROD || process.env.COOKIE_SECURE === '1'
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure,
    })
    res.json({ user })
  } catch (e) {
    safeError(res, e)
  }
})

app.use(apiAuthGate)

app.get('/api/activity-log', requireExecutive, (req, res) => {
  try {
    res.json(getActivityLog({
      limit: req.query.limit,
      offset: req.query.offset,
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      since: typeof req.query.since === 'string' ? req.query.since : undefined,
      until: typeof req.query.until === 'string' ? req.query.until : undefined,
    }))
  } catch (e) { safeImportError(res, e, req) }
})

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.authUser })
})

app.post('/api/auth/logout', (req, res) => {
  const secure = IS_PROD || process.env.COOKIE_SECURE === '1'
  res.clearCookie(COOKIE_NAME, { path: '/', secure, sameSite: 'lax' })
  res.json({ ok: true })
})

// ── SKUs ────────────────────────────────────────────────────────────────────

app.get('/api/skus', (req, res) => {
  try {
    try { purgeExpiredBinnedSkus() } catch { /* ignore */ }
    res.json(withOutletStockLocation(getAllSkus()))
  } catch (e) { safeError(res, e) }
})

app.put('/api/skus/:code/gender', requireManagerOrExecutive, (req, res) => {
  try {
    assertSafeSku(req.params.code)
    const result = correctSkuGender(req.params.code, req.body?.gender, req.authUser)
    const previousGenderLabel = result.previous_genders.length
      ? result.previous_genders.map((value) => GENDER_LABELS[value] || value).join(', ')
      : 'Unspecified'
    const nextGenderLabel = GENDER_LABELS[result.gender] || result.gender
    act(req.authUser, {
      category: 'inventory',
      action: 'sku_gender_corrected',
      entityType: 'sku',
      entityId: req.params.code,
      summary: `Changed gender for SKU ${req.params.code} from ${previousGenderLabel} to ${nextGenderLabel}`,
      meta: {
        previous_genders: result.previous_genders,
        gender: result.gender,
        sku_rows_updated: result.skuRowsUpdated,
        import_line_rows_updated: result.importLineRowsUpdated,
      },
    })
    res.json(result)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.get('/api/skus/bin', requireExecutive, (req, res) => {
  try {
    const purged = purgeExpiredBinnedSkus()
    res.json({ items: listBinnedSkus(), autoPurgedCodes: purged.purgedCodes })
  } catch (e) { safeError(res, e) }
})

app.delete('/api/skus/:code', requireExecutive, (req, res) => {
  try {
    assertSafeSku(req.params.code)
    const result = softDeleteSkuByCode(req.params.code, req.authUser)
    if (!result.skuRowsUpdated) return res.status(404).json({ error: 'SKU not found or already binned' })
    act(req.authUser, {
      category: 'inventory',
      action: 'binned',
      entityType: 'sku',
      entityId: req.params.code,
      summary: `SKU ${req.params.code} moved to recycle bin`,
      meta: { skuRowsUpdated: result.skuRowsUpdated },
    })
    res.json({ ok: true, skuRowsUpdated: result.skuRowsUpdated })
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.post('/api/skus/:code/restore', requireExecutive, (req, res) => {
  try {
    assertSafeSku(req.params.code)
    const result = restoreSkuByCode(req.params.code)
    if (!result.skuRowsUpdated) return res.status(404).json({ error: 'No binned SKU rows found' })
    act(req.authUser, {
      category: 'inventory',
      action: 'restored',
      entityType: 'sku',
      entityId: req.params.code,
      summary: `SKU ${req.params.code} restored from recycle bin`,
      meta: { skuRowsUpdated: result.skuRowsUpdated },
    })
    res.json({ ok: true, skuRowsUpdated: result.skuRowsUpdated })
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.delete('/api/skus/:code/purge', requireExecutive, (req, res) => {
  try {
    assertSafeSku(req.params.code)
    const blocked = requireDestructiveConfirmation(req, res, 'purge-sku', req.params.code)
    if (blocked) return
    const result = purgeSkuByCode(req.params.code)
    if (!result.skuRowsDeleted) return res.status(404).json({ error: 'SKU not found' })
    act(req.authUser, {
      category: 'inventory',
      action: 'purged',
      entityType: 'sku',
      entityId: req.params.code,
      summary: `SKU ${req.params.code} permanently deleted`,
      meta: { skuRowsDeleted: result.skuRowsDeleted },
    })
    res.json({ ok: true, skuRowsDeleted: result.skuRowsDeleted })
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.post('/api/skus', requireExecutive, (req, res) => {
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' })
    const result = insertSkus(req.body)
    const added = typeof result === 'object' ? result.count : result
    const seasonRollover = typeof result === 'object' ? result.seasonRollover : null
    act(req.authUser, {
      category: 'inventory',
      action: 'bulk_upsert',
      entityType: 'sku',
      entityId: null,
      summary: `SKU bulk upsert — ${req.body.length} rows`,
      meta: { count: req.body.length, seasonRollover },
    })
    res.json({ added, seasonRollover })
  } catch (e) { safeImportError(res, e, req) }
})

app.get('/api/shipment-meta', (req, res) => {
  try { res.json(getShipmentMetaBySku()) }
  catch (e) { safeError(res, e) }
})

app.delete('/api/skus/import/:importId', requireExecutive, (req, res) => {
  try {
    const blocked = requireDestructiveConfirmation(req, res, 'delete-import', req.params.importId)
    if (blocked) return
    const result = deleteImportRecord(req.params.importId)
    for (const code of result.fullyRemovedSkuCodes) {
      removeExistingPhotosForSku(code)
    }
    act(req.authUser, {
      category: 'inventory',
      action: 'delete_by_import',
      entityType: 'import_batch',
      entityId: req.params.importId,
      summary: `Removed SKUs for import batch ${req.params.importId}`,
      meta: {
        skuRowsDeleted: result.skuRowsDeleted,
        importHistoryDeleted: result.importHistoryDeleted,
        fullyRemovedSkuCodes: result.fullyRemovedSkuCodes,
        salesEventsDeleted: result.salesEventsDeleted,
        salesEventsAdjusted: result.salesEventsAdjusted,
      },
    })
    res.json({
      deleted: result.importHistoryDeleted,
      skuRowsDeleted: result.skuRowsDeleted,
      fullyRemovedSkuCodes: result.fullyRemovedSkuCodes,
      salesEventsDeleted: result.salesEventsDeleted,
      salesEventsAdjusted: result.salesEventsAdjusted,
    })
  } catch (e) { safeError(res, e) }
})

app.get('/api/sku-import-totals', (req, res) => {
  try {
    const season = typeof req.query.season === 'string' && req.query.season ? req.query.season : undefined
    res.json(getLifetimeImportedBySku({ season }))
  }
  catch (e) { safeError(res, e) }
})

app.get('/api/sku-import-cost-totals', (req, res) => {
  try {
    const season = typeof req.query.season === 'string' && req.query.season ? req.query.season : undefined
    res.json(getLifetimeImportCostBySku({ season }))
  }
  catch (e) { safeError(res, e) }
})

app.get('/api/import-cost-audit', (req, res) => {
  try {
    res.json(getImportCostAudit({
      importId: typeof req.query.importId === 'string' ? req.query.importId : '',
      expectedTotal: req.query.expectedTotal,
    }))
  } catch (e) { safeError(res, e) }
})

app.post('/api/import-files', requireExecutive, uploadImportCsvSingle, (req, res) => {
  try {
    const importId = String(req.body?.importId || '').trim()
    const filename = String(req.body?.filename || req.file?.originalname || 'import.csv')
    let csvText
    if (req.file?.buffer) {
      csvText = req.file.buffer.toString('utf8')
    } else {
      csvText = req.body?.csvText
    }
    const meta = archiveImportCsv(req, importId, filename, csvText)
    res.json(meta)
  } catch (e) { safeImportError(res, e, req) }
})

app.get('/api/import-files/:importId/download', requireExecutive, (req, res) => {
  try {
    const meta = getImportCsvFileMeta(req.params.importId)
    if (!meta?.csv_file_path) {
      const err = new Error('CSV file not archived for this import')
      err.statusCode = 404
      throw err
    }

    const absPath = path.resolve(DATA_DIR, meta.csv_file_path)
    const archiveRoot = path.resolve(IMPORT_ARCHIVE_DIR)
    if (!absPath.startsWith(`${archiveRoot}${path.sep}`)) {
      const err = new Error('Invalid archived CSV path')
      err.statusCode = 400
      throw err
    }
    if (!fs.existsSync(absPath)) {
      const err = new Error('Archived CSV file not found on disk')
      err.statusCode = 404
      throw err
    }

    res.download(absPath, meta.filename || meta.csv_file_name || 'import.csv', (err) => {
      if (err && !res.headersSent) safeImportError(res, err, req)
    })
  } catch (e) { safeImportError(res, e, req) }
})

app.get('/api/product-report', (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const season = typeof req.query.season === 'string' && req.query.season ? req.query.season : undefined
    const outletSkuCodes = [...outletSkuLocationOwnership(
      getAllOutletTransfers(),
      getAllMarkdownLists(),
    ).keys()]
    res.json(getProductNameReport(q, { season, excludeSkuCodes: outletSkuCodes }))
  } catch (e) { safeError(res, e) }
})

app.get('/api/sku-brands', (req, res) => {
  try { res.json(getDistinctSkuBrands()) } catch (e) { safeError(res, e) }
})

app.get('/api/product-type-labels', (req, res) => {
  try { res.json(getProductTypeLabels()) } catch (e) { safeError(res, e) }
})

app.post('/api/product-type-labels/classify-bulk', requireExecutive, async (req, res) => {
  try {
    const force = req.body?.force === true
    const limit = Math.max(1, Math.min(25, Number(req.body?.limit) || 10))
    const requested = Array.isArray(req.body?.skus) ? req.body.skus.map((x) => String(x || '').trim()).filter(Boolean) : []
    const photoSkus = fs.readdirSync(PHOTOS_DIR)
      .map((f) => path.basename(f, path.extname(f)))
      .filter((code) => SAFE_SKU_PARAM.test(code))
    const allSkus = requested.length ? requested : photoSkus
    const results = []
    for (const sku of allSkus) {
      if (results.length >= limit) break
      const photo = getPhotoFileForSku(sku)
      const cached = getProductTypeLabel(sku)
      if (!force && cached?.product_type && (!photo || cached.photo_signature === photo.signature)) continue
      results.push(await classifySkuPhoto(sku, { force }))
    }
    act(req.authUser, {
      category: 'photo',
      action: 'product_type_classified_bulk',
      entityType: 'product_type_labels',
      entityId: 'bulk',
      summary: `Classified ${results.length} product type label(s)`,
      meta: { count: results.length, force },
    })
    res.json({
      status: process.env.OPENAI_API_KEY ? 'ok' : 'missing_api_key',
      processed: results.length,
      results,
      labels: getProductTypeLabels(),
    })
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.post('/api/product-type-labels/:skuCode', requireExecutive, async (req, res) => {
  try {
    const result = await classifySkuPhoto(req.params.skuCode, { force: req.body?.force === true })
    act(req.authUser, {
      category: 'photo',
      action: 'product_type_classified',
      entityType: 'sku',
      entityId: req.params.skuCode,
      summary: `Classified product type for ${req.params.skuCode}`,
      meta: { status: result.status, product_type: result.label?.product_type, source: result.label?.source },
    })
    res.json(result)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.put('/api/product-type-labels/:skuCode', requireExecutive, (req, res) => {
  try {
    assertSafeSku(req.params.skuCode)
    const label = upsertProductTypeLabel({
      sku: req.params.skuCode,
      product_type: req.body?.product_type,
      source: 'manual',
      confidence: 1,
      photo_signature: getProductTypeLabel(req.params.skuCode)?.photo_signature || '',
    })
    act(req.authUser, {
      category: 'photo',
      action: 'product_type_manual',
      entityType: 'sku',
      entityId: req.params.skuCode,
      summary: `Manually set product type for ${req.params.skuCode}`,
      meta: { product_type: label?.product_type },
    })
    res.json(label)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

function reportQuery(req) {
  return {
    since: typeof req.query.since === 'string' && req.query.since ? req.query.since : undefined,
    until: typeof req.query.until === 'string' && req.query.until ? req.query.until : undefined,
    season: typeof req.query.season === 'string' && req.query.season ? req.query.season : undefined,
  }
}

app.get('/api/reports/executive-buying', requireExecutive, (req, res) => {
  try { res.json(getExecutiveBuyingReport(reportQuery(req))) } catch (e) { safeError(res, e) }
})

app.get('/api/reports/brand-productivity', requireExecutive, (req, res) => {
  try { res.json(getBrandProductivityReport(reportQuery(req))) } catch (e) { safeError(res, e) }
})

app.get('/api/reports/returns-exchanges', requireExecutive, (req, res) => {
  try { res.json(getReturnsExchangeReport(reportQuery(req))) } catch (e) { safeError(res, e) }
})

app.get('/api/reports/size-curve-health', requireExecutive, (req, res) => {
  try { res.json(getSizeCurveHealthReport(reportQuery(req))) } catch (e) { safeError(res, e) }
})

app.get('/api/reports/markdown-risk', requireExecutive, (req, res) => {
  try { res.json(getMarkdownRiskReport(reportQuery(req))) } catch (e) { safeError(res, e) }
})

app.get('/api/reports/category-productivity', requireExecutive, (req, res) => {
  try { res.json(getCategoryProductivityReport(reportQuery(req))) } catch (e) { safeError(res, e) }
})

app.get('/api/reports/movers', requireExecutive, (req, res) => {
  try { res.json(getMoversReport(reportQuery(req))) } catch (e) { safeError(res, e) }
})

// ── Import history ──────────────────────────────────────────────────────────

app.get('/api/import-history', (req, res) => {
  try { res.json(getImportHistory()) }
  catch (e) { safeError(res, e) }
})

app.post('/api/import-history', requireExecutive, (req, res) => {
  try {
    const rec = insertImportRecord({
      ...req.body,
      imported_by_user_id: req.authUser.id,
      imported_by_name: req.authUser.name,
    })
    act(req.authUser, {
      category: 'import',
      action: 'recorded',
      entityType: 'import_batch',
      entityId: rec.id,
      summary: `Import recorded: ${rec.filename || 'file'} — ${rec.count} rows, ${rec.totalUnits ?? 0} units`,
      meta: { filename: rec.filename, count: rec.count, totalUnits: rec.totalUnits ?? 0 },
    })
    res.json(rec)
  } catch (e) { safeImportError(res, e, req) }
})

app.post('/api/import-history/reprocess-reporting', requireExecutive, (req, res) => {
  try {
    const archived = getImportHistory().filter((h) => h.csvFilePath)
    const results = []
    const skipped = []
    for (const h of archived) {
      try {
        results.push(reprocessArchivedReportingImport(h.id))
      } catch (e) {
        if (e?.statusCode === 400) {
          const safe = importErrorPayload(e, e.statusCode)
          skipped.push({ importId: h.id, filename: h.filename, reason: safe.message, code: safe.code })
          continue
        }
        throw e
      }
    }
    const totals = results.reduce((acc, r) => {
      acc.rowsParsed += r.rowsParsed
      acc.rowsRecognized += r.rowsRecognized
      acc.rowsStillSkipped += r.rowsStillSkipped
      acc.salesEventsWritten += r.salesEventsWritten
      for (const sku of r.skippedSkus) acc.skippedSkus.add(sku)
      return acc
    }, {
      rowsParsed: 0,
      rowsRecognized: 0,
      rowsStillSkipped: 0,
      salesEventsWritten: 0,
      skippedSkus: new Set(),
    })
    const payload = {
      processed: results.length,
      skippedImports: skipped,
      totals: {
        ...totals,
        skippedSkus: [...totals.skippedSkus],
      },
      results,
    }
    act(req.authUser, {
      category: 'import',
      action: 'reprocessed_reporting_bulk',
      entityType: 'import_batch',
      entityId: 'bulk',
      summary: `Reprocessed ${results.length} archived reporting import(s)`,
      meta: { processed: results.length, skippedImports: skipped.length, totals: payload.totals },
    })
    res.json(payload)
  } catch (e) { safeImportError(res, e, req, e.statusCode || 500) }
})

app.post('/api/import-history/:id/reprocess-reporting', requireExecutive, (req, res) => {
  try {
    const result = reprocessArchivedReportingImport(req.params.id)
    act(req.authUser, {
      category: 'import',
      action: 'reprocessed_reporting',
      entityType: 'import_batch',
      entityId: req.params.id,
      summary: `Reprocessed reporting import ${result.filename}`,
      meta: result,
    })
    res.json(result)
  } catch (e) { safeImportError(res, e, req, e.statusCode || 500) }
})

app.delete('/api/import-history/:id', requireExecutive, (req, res) => {
  try {
    const blocked = requireDestructiveConfirmation(req, res, 'delete-import', req.params.id)
    if (blocked) return
    const result = deleteImportRecord(req.params.id)
    for (const code of result.fullyRemovedSkuCodes) {
      removeExistingPhotosForSku(code)
    }
    act(req.authUser, {
      category: 'import',
      action: 'deleted',
      entityType: 'import_batch',
      entityId: req.params.id,
      summary: `Deleted import batch ${req.params.id} and its SKUs`,
      meta: {
        importHistoryDeleted: result.importHistoryDeleted,
        skuRowsDeleted: result.skuRowsDeleted,
        fullyRemovedSkuCodes: result.fullyRemovedSkuCodes,
        salesEventsDeleted: result.salesEventsDeleted,
        salesEventsAdjusted: result.salesEventsAdjusted,
      },
    })
    res.json({
      deleted: result.importHistoryDeleted,
      skuRowsDeleted: result.skuRowsDeleted,
      fullyRemovedSkuCodes: result.fullyRemovedSkuCodes,
      salesEventsDeleted: result.salesEventsDeleted,
      salesEventsAdjusted: result.salesEventsAdjusted,
    })
  } catch (e) { safeImportError(res, e, req) }
})

// ── Users ───────────────────────────────────────────────────────────────────

app.get('/api/users', (req, res) => {
  try {
    if (req.authUser.role === 'executive') {
      return res.json(getAllUsers())
    }
    const rows = getUsersPublicDirectory()
    res.json(rows.map((r) => ({ ...r, user_code: null })))
  } catch (e) { safeError(res, e) }
})

app.post('/api/users', requireExecutive, (req, res) => {
  try {
    const u = addUser(req.body)
    act(req.authUser, {
      category: 'user',
      action: 'created',
      entityType: 'user',
      entityId: u.id,
      summary: `User created: ${u.name} (${u.role})`,
      meta: { role: u.role, shop: u.shop },
    })
    res.json(u)
  } catch (e) { safeError(res, e) }
})

app.put('/api/users/:id', requireExecutive, (req, res) => {
  try {
    const updated = updateUser(req.params.id, req.body)
    if (!updated) return res.status(404).json({ error: 'User not found or no valid fields' })
    act(req.authUser, {
      category: 'user',
      action: 'updated',
      entityType: 'user',
      entityId: req.params.id,
      summary: `User updated: ${updated.name}`,
      meta: { fields: Object.keys(req.body || {}) },
    })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

app.post('/api/users/:id/regenerate-pin', requireExecutive, (req, res) => {
  try {
    const updated = regenerateUserPin(req.params.id)
    if (!updated) return res.status(404).json({ error: 'User not found' })
    act(req.authUser, {
      category: 'user',
      action: 'pin_regenerated',
      entityType: 'user',
      entityId: req.params.id,
      summary: `PIN regenerated: ${updated.name}`,
      meta: { user_code: updated.user_code },
    })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

app.delete('/api/users/:id', requireExecutive, (req, res) => {
  try {
    const blocked = requireDestructiveConfirmation(req, res, 'delete-user', req.params.id)
    if (blocked) return
    const changes = removeUser(req.params.id)
    act(req.authUser, {
      category: 'user',
      action: 'deleted',
      entityType: 'user',
      entityId: req.params.id,
      summary: `User deleted: ${req.params.id}`,
      meta: { deleted: changes },
    })
    res.json({ deleted: changes })
  } catch (e) { safeError(res, e) }
})

// ── Assignments ─────────────────────────────────────────────────────────────

app.get('/api/assignments', (req, res) => {
  try {
    res.json(filterAssignments(getAllAssignments(), req.authUser))
  } catch (e) { safeError(res, e) }
})

function normalizeAssignmentPayload(raw, u) {
  const body = { ...raw, assignedBy: u.id }
  if (u.role !== 'executive') {
    body.shop = u.shop ?? ''
    const toId = body.assignedTo
    if (!toId || String(toId).trim() === '') {
      const err = new Error('assignedTo is required')
      err.statusCode = 400
      throw err
    }
    const assignee = getPublicUserById(toId)
    if (!assignee) {
      const err = new Error('Invalid assignee')
      err.statusCode = 400
      throw err
    }
    if ((assignee.shop ?? '') !== (u.shop ?? '')) {
      const err = new Error('Assignee must be in your shop')
      err.statusCode = 403
      throw err
    }
  }
  return body
}

app.post('/api/assignments', (req, res) => {
  try {
    const u = req.authUser
    const body = normalizeAssignmentPayload(req.body, u)
    const created = insertAssignment(body)
    act(u, {
      category: 'assignment',
      action: 'created',
      entityType: 'assignment',
      entityId: created.id,
      summary: `${created.type || 'Task'}: ${(created.productName || created.skuCode || '').slice(0, 72)}`,
      meta: { type: created.type, skuCode: created.skuCode, shop: created.shop },
    })
    res.json(created)
  } catch (e) { safeError(res, e) }
})

const ASSIGNMENTS_BULK_MAX = 25000

app.post('/api/assignments/bulk', (req, res) => {
  try {
    const u = req.authUser
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' })
    if (req.body.length > ASSIGNMENTS_BULK_MAX) {
      return res.status(400).json({ error: `At most ${ASSIGNMENTS_BULK_MAX} assignments per request` })
    }
    const normalized = []
    for (const raw of req.body) {
      normalized.push(normalizeAssignmentPayload(raw, u))
    }
    const created = insertAssignments(normalized)
    act(u, {
      category: 'assignment',
      action: 'bulk_created',
      entityType: 'assignment',
      entityId: null,
      summary: `Bulk assignments: ${created.length} created`,
      meta: { count: created.length },
    })
    res.json({ count: created.length })
  } catch (e) { safeError(res, e) }
})

app.post('/api/assignments/complete-photo-tasks', (req, res) => {
  try {
    const u = req.authUser
    const skuCodes = Array.isArray(req.body?.skuCodes)
      ? [...new Set(req.body.skuCodes.map((x) => String(x ?? '').trim()).filter(Boolean))]
      : []
    if (skuCodes.length === 0) return res.json({ count: 0 })
    const skuSet = new Set(skuCodes)
    const now = new Date().toISOString()
    const rows = getAllAssignments().filter((row) => (
      row.type === 'photo_needed' &&
      row.status === 'pending' &&
      skuSet.has(String(row.skuCode ?? '').trim()) &&
      assignmentVisibleToUser(row, u)
    ))
    let count = 0
    for (const row of rows) {
      if (updateAssignment(row.id, { status: 'done', completedAt: now })) count++
    }
    if (count > 0) {
      act(u, {
        category: 'assignment',
        action: 'bulk_completed',
        entityType: 'assignment',
        entityId: null,
        summary: `Photo tasks completed: ${count}`,
        meta: { count, skuCount: skuCodes.length },
      })
    }
    res.json({ count })
  } catch (e) { safeError(res, e) }
})

app.put('/api/assignments/:id', (req, res) => {
  try {
    const row = getAssignmentById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!assignmentVisibleToUser(row, req.authUser)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if ((row.type === 'store_transfer_send' || row.type === 'store_transfer_receive') && req.body?.status && req.body.status !== row.status) {
      return res.status(409).json({ error: 'Complete this task from the transfer size checklist' })
    }
    const patch = { ...req.body }
    if (patch.status === 'done') {
      patch.completedAt = new Date().toISOString()
      patch.completedBy = req.authUser.id
    } else if (patch.status === 'pending' || patch.status === 'in_progress') {
      patch.completedAt = null
      patch.completedBy = null
    } else {
      delete patch.completedBy
    }
    const linkedAssignments = updateSharedAssignment(req.params.id, patch)
    const updated = linkedAssignments.find((assignment) => assignment.id === req.params.id)
    if (!updated) return res.status(404).json({ error: 'Not found' })
    const statusChanged = req.body?.status != null && req.body.status !== row.status
    act(req.authUser, {
      category: 'assignment',
      action: statusChanged ? 'status_changed' : 'updated',
      entityType: 'assignment',
      entityId: req.params.id,
      summary: statusChanged
        ? `Assignment ${req.params.id}: status → ${updated.status}${updated.status === 'done' ? ` by ${req.authUser.name}` : ''}`
        : `Assignment updated: ${req.params.id}`,
      meta: { patch, previousStatus: row.status, status: updated.status, linkedCount: linkedAssignments.length },
    })
    res.json({ assignment: updated, linkedAssignments })
  } catch (e) { safeError(res, e) }
})

// ── Outlet transfers ────────────────────────────────────────────────────────

app.get('/api/outlet-transfers', (req, res) => {
  try {
    res.json(filterOutletTransfers(getAllOutletTransfers(), req.authUser))
  } catch (e) { safeError(res, e) }
})

app.post('/api/outlet-transfers', (req, res) => {
  try {
    const u = req.authUser
    const body = { ...req.body, createdBy: u.id }
    if (u.role !== 'executive' && u.shop) body.fromShop = u.shop
    if (u.role !== 'executive') {
      const at = body.assignedTo
      if (!outletTransferAssignedToUpdateAllowed(u, at, body.fromShop)) {
        return res.status(403).json({ error: 'Outlet transfers can only be assigned within the sending store' })
      }
    }
    assertSkusAvailableOutsideOutlet(body.items)
    const t = insertOutletTransfer(body)
    const n = Array.isArray(t.items) ? t.items.length : 0
    act(u, {
      category: 'transfer_outlet',
      action: 'created',
      entityType: 'outlet_transfer',
      entityId: t.id,
      summary: `Outlet transfer created (${n} items)`,
      meta: { status: t.status },
    })
    res.json(t)
  } catch (e) { safeError(res, e) }
})

app.put('/api/outlet-transfers/:id', (req, res) => {
  try {
    const row = getOutletTransferById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!outletTransferVisibleToUser(row, req.authUser)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, 'assignedTo') &&
      !strEq(req.body.assignedTo, row.assignedTo) &&
      !outletTransferAssignedToUpdateAllowed(req.authUser, req.body.assignedTo, row.fromShop)
    ) {
      return res.status(403).json({ error: 'Outlet transfers can only be assigned within the sending store' })
    }
    validateOutletTransferUpdate(row, req.authUser, req.body || {})
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'items')) {
      assertSkusAvailableOutsideOutlet(req.body.items, row.id)
    }
    const updated = updateOutletTransfer(req.params.id, req.body)
    if (!updated) return res.status(404).json({ error: 'Not found' })
    const ensureReceiptArtifacts = req.body?.status === 'received' && (row.status === 'completed' || row.status === 'received')
    const ecommerceSale = ensureReceiptArtifacts
      ? createOutletEcommerceSaleIfNeeded(req.params.id, req.authUser)
      : null
    const locationChange = ensureReceiptArtifacts
      ? createOutletWebLocationIfNeeded(req.params.id, req.authUser)
      : null
    act(req.authUser, {
      category: 'transfer_outlet',
      action: 'updated',
      entityType: 'outlet_transfer',
      entityId: req.params.id,
      summary: `Outlet transfer updated — ${updated.status || row.status}`,
      meta: { patch: req.body, status: updated.status },
    })
    const visibleLocationChange = req.authUser.role === 'executive' ? locationChange : null
    res.json(ecommerceSale || visibleLocationChange
      ? { transfer: updated, ecommerceSale, ...(visibleLocationChange ? { locationChange: visibleLocationChange } : {}) }
      : updated)
  } catch (e) { safeError(res, e) }
})

app.delete('/api/outlet-transfers/:id', (req, res) => {
  try {
    const row = getOutletTransferById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!outletTransferVisibleToUser(row, req.authUser)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (req.authUser.role !== 'executive') {
      return res.status(403).json({ error: 'Only an executive can delete this transfer' })
    }
    const n = Array.isArray(row.items) ? row.items.length : 0
    const status = row.status || 'pending'
    const deleted = deleteOutletTransfer(req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Not found' })
    act(req.authUser, {
      category: 'transfer_outlet',
      action: status === 'received' ? 'deleted_confirmed' : 'discarded',
      entityType: 'outlet_transfer',
      entityId: req.params.id,
      summary: `${status === 'received' ? 'Deleted confirmed' : 'Discarded'} outlet transfer (${n} items)`,
      meta: {
        status,
        products: n,
        removedLinkedEcommerceSale: status === 'received',
        removedLinkedWebLocationChecklist: status === 'received',
      },
    })
    res.json({ ok: true })
  } catch (e) { safeError(res, e) }
})

// ── Store transfers ─────────────────────────────────────────────────────────

app.get('/api/store-transfers', (req, res) => {
  try {
    res.json(filterStoreTransfers(getAllStoreTransfers(), req.authUser))
  } catch (e) { safeError(res, e) }
})

app.post('/api/store-transfers', (req, res) => {
  try {
    const u = req.authUser
    const body = {
      ...req.body,
      createdBy: u.id,
      status: 'pending',
      workflow_version: STORE_TRANSFER_WORKFLOW_VERSION,
      send_item_statuses: {},
      item_statuses: {},
      sentAt: null,
      sentBy: null,
      receivedAt: null,
      receivedBy: null,
      receiverAssignedTo: null,
    }
    body.id = String(body.id || crypto.randomUUID())
    assertSkusAvailableOutsideOutlet(body.items)
    if (u.role !== 'executive') {
      const shop = u.shop ?? ''
      if (!shop) {
        return res.status(403).json({ error: 'Shop required for store transfers' })
      }
      const { fromShop, toShop } = body
      if (fromShop !== shop && toShop !== shop) {
        return res.status(403).json({ error: 'Transfer must involve your shop' })
      }
    }
    const assigneeIds = splitIdList(body.assignedTo)
    for (const assigneeId of assigneeIds) {
      const assignee = getPublicUserById(assigneeId)
      if (!assignee || assignee.role !== 'manager' || !strEq(assignee.shop, body.fromShop)) {
        return res.status(400).json({ error: 'Assignee must be a manager from the sending shop' })
      }
    }
    const { products, units } = transferSummary(body)
    const assignments = assigneeIds.map((assignedTo) => ({
      type: 'store_transfer_send',
      skuCode: body.id,
      productName: `Send transfer to ${body.toShop}: ${products} product${products === 1 ? '' : 's'}`,
      assignedTo,
      assignedBy: u.id,
      shop: body.fromShop,
      status: 'pending',
      note: body.note ? `${units} units — ${body.note}` : `${units} units to ${body.toShop}`,
    }))
    const notifications = assigneeIds.map((userId) => ({
      type: 'store_transfer_send_ready',
      title: 'Transfer Ready to Send',
      message: `${u.name || 'A colleague'} prepared ${units} units for ${body.toShop}. Confirm every size before sending.`,
      userId,
      relatedId: body.id,
    }))
    const t = insertStoreTransferWorkflow(body, assignments, notifications)
    const n = Array.isArray(t.items) ? t.items.length : 0
    act(u, {
      category: 'transfer_store',
      action: 'created',
      entityType: 'store_transfer',
      entityId: t.id,
      summary: `Store transfer ${t.fromShop || '?'} → ${t.toShop || '?'} (${n} items)`,
      meta: { fromShop: t.fromShop, toShop: t.toShop, status: t.status },
    })
    res.json(t)
  } catch (e) { safeError(res, e) }
})

app.patch('/api/store-transfers/:id/verification', (req, res) => {
  try {
    const row = getStoreTransferById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!isTwoPhaseStoreTransfer(row)) return res.status(409).json({ error: 'Legacy transfers use the original verification workflow' })
    if (!storeTransferVisibleToUser(row, req.authUser)) return res.status(403).json({ error: 'Forbidden' })

    const phase = req.body?.phase === 'receive' ? 'receive' : req.body?.phase === 'send' ? 'send' : ''
    if (!phase) return res.status(400).json({ error: 'phase must be send or receive' })
    assertStoreTransferPhaseAccess(row, req.authUser, phase)
    const requiredStatus = phase === 'send' ? 'pending' : 'sent'
    if (row.status !== requiredStatus) {
      return res.status(409).json({ error: `This transfer is no longer open for ${phase} verification` })
    }

    const key = String(req.body?.key || '').trim()
    const line = getPhaseLines(row, phase).find((candidate) => candidate.key === key)
    if (!line) return res.status(400).json({ error: 'That SKU and size are not in this transfer' })
    if (phase === 'receive' && line.expected === 0) {
      return res.status(400).json({ error: 'Nothing was sent for this size' })
    }
    const confirmed = Number(req.body?.confirmed)
    if (!Number.isInteger(confirmed) || confirmed < 0 || confirmed > line.expected) {
      return res.status(400).json({ error: `Confirmed quantity must be a whole number from 0 to ${line.expected}` })
    }
    const comment = String(req.body?.comment || '').trim()
    if (confirmed < line.expected && !comment) {
      return res.status(400).json({ error: 'Explain the missing quantity for this size' })
    }
    if (comment.length > 1000) return res.status(400).json({ error: 'Reason must be 1000 characters or fewer' })

    const entry = buildVerificationEntry({
      expected: line.expected,
      confirmed,
      comment,
      updatedBy: req.authUser.id,
      updatedAt: new Date().toISOString(),
      phase,
    })
    const updated = updateStoreTransferVerification(row.id, phase, key, entry)
    act(req.authUser, {
      category: 'transfer_store', action: `${phase}_size_verified`, entityType: 'store_transfer', entityId: row.id,
      summary: `${phase === 'send' ? 'Sending' : 'Receiving'} verified ${key}: ${confirmed}/${line.expected}`,
      meta: { phase, key, expected: line.expected, confirmed, status: entry.status },
    })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

app.post('/api/store-transfers/:id/mark-sent', (req, res) => {
  try {
    const row = getStoreTransferById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!isTwoPhaseStoreTransfer(row)) return res.status(409).json({ error: 'Legacy transfers use the original workflow' })
    assertStoreTransferPhaseAccess(row, req.authUser, 'send')
    if (row.status === 'sent' || row.status === 'received') return res.json(row)
    if (row.status !== 'pending') return res.status(409).json({ error: 'Transfer cannot be marked sent from its current status' })
    if (!isPhaseComplete(row, 'send', row.send_item_statuses || {})) {
      return res.status(400).json({ error: 'Confirm every size and explain each shortage before sending' })
    }

    const recipientIds = destinationTransferRecipients(row)
    const totals = verificationTotals(row, 'send', row.send_item_statuses || {})
    const assignments = recipientIds.map((assignedTo) => ({
      type: 'store_transfer_receive', skuCode: row.id,
      productName: `Receive transfer from ${row.fromShop}: ${totals.confirmed} units`,
      assignedTo, assignedBy: req.authUser.id, shop: row.toShop, status: 'pending',
      note: `${totals.confirmed} units sent${totals.missing ? ` · ${totals.missing} not sent` : ''}`,
    }))
    const notifications = recipientIds.map((userId) => ({
      type: 'store_transfer_receive_ready', title: 'Incoming Transfer Ready',
      message: `${row.fromShop} sent ${totals.confirmed} units. Confirm every received size.`,
      userId, relatedId: row.id,
    }))
    const updated = transitionStoreTransferPhase(row.id, {
      phase: 'send', actorId: req.authUser.id, receiverAssignedTo: recipientIds.join(',') || null,
      assignments, notifications,
    })
    act(req.authUser, {
      category: 'transfer_store', action: 'sent', entityType: 'store_transfer', entityId: row.id,
      summary: `Store transfer sent ${row.fromShop} → ${row.toShop} (${totals.confirmed} units)`,
      meta: { ...totals, recipientIds },
    })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

app.post('/api/store-transfers/:id/mark-received', (req, res) => {
  try {
    const row = getStoreTransferById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!isTwoPhaseStoreTransfer(row)) return res.status(409).json({ error: 'Legacy transfers use the original workflow' })
    assertStoreTransferPhaseAccess(row, req.authUser, 'receive')
    if (row.status === 'received') return res.json(row)
    if (row.status !== 'sent') return res.status(409).json({ error: 'Transfer must be sent before it can be received' })
    if (!isPhaseComplete(row, 'receive', row.item_statuses || {})) {
      return res.status(400).json({ error: 'Confirm every shipped size and explain each shortage before receiving' })
    }

    const totals = verificationTotals(row, 'receive', row.item_statuses || {})
    const senderIds = [...new Set([row.createdBy, row.sentBy, ...splitIdList(row.assignedTo)].filter(Boolean))]
    const notifications = senderIds.map((userId) => ({
      type: 'store_transfer_received', title: 'Transfer Received',
      message: `${row.toShop} received ${totals.confirmed}/${totals.expected} units from ${row.fromShop}.`,
      userId, relatedId: row.id,
    }))
    notifications.push({
      type: totals.missing ? 'store_transfer_issue' : 'store_transfer_received',
      title: totals.missing ? 'Transfer Discrepancy' : 'Transfer Received',
      message: totals.missing
        ? `${row.toShop} reported ${totals.missing} missing unit${totals.missing === 1 ? '' : 's'} from ${row.fromShop}.`
        : `${row.toShop} received all ${totals.confirmed} shipped units from ${row.fromShop}.`,
      userId: 'executives', relatedId: row.id,
    })
    const updated = transitionStoreTransferPhase(row.id, {
      phase: 'receive', actorId: req.authUser.id, notifications,
    })
    act(req.authUser, {
      category: 'transfer_store', action: 'received', entityType: 'store_transfer', entityId: row.id,
      summary: `Store transfer received at ${row.toShop} (${totals.confirmed}/${totals.expected} units)`,
      meta: totals,
    })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

app.put('/api/store-transfers/:id', (req, res) => {
  try {
    const row = getStoreTransferById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!storeTransferVisibleToUser(row, req.authUser)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (isTwoPhaseStoreTransfer(row)) {
      const reserved = ['status', 'item_statuses', 'send_item_statuses', 'sentAt', 'sentBy', 'receivedAt', 'receivedBy', 'receiverAssignedTo']
      if (reserved.some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key))) {
        return res.status(409).json({ error: 'Use the transfer verification workflow to update this transfer' })
      }
    }
    validateStoreTransferUpdate(row, req.authUser, req.body || {})
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'items')) {
      assertSkusAvailableOutsideOutlet(req.body.items)
    }
    const updated = updateStoreTransfer(req.params.id, req.body)
    if (!updated) return res.status(404).json({ error: 'Not found' })
    act(req.authUser, {
      category: 'transfer_store',
      action: 'updated',
      entityType: 'store_transfer',
      entityId: req.params.id,
      summary: `Store transfer updated — ${updated.status || row.status}`,
      meta: { patch: req.body, status: updated.status },
    })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

app.delete('/api/store-transfers/:id', (req, res) => {
  try {
    const row = getStoreTransferById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!storeTransferVisibleToUser(row, req.authUser)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (isTwoPhaseStoreTransfer(row) && req.authUser.role !== 'executive') {
      return res.status(403).json({ error: 'Only an executive can discard or delete a two-phase transfer' })
    }
    const n = Array.isArray(row.items) ? row.items.length : 0
    const status = row.status || 'pending'
    const deleted = deleteStoreTransfer(req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Not found' })
    act(req.authUser, {
      category: 'transfer_store',
      action: status === 'completed' || status === 'received' ? 'deleted_confirmed' : 'discarded',
      entityType: 'store_transfer',
      entityId: req.params.id,
      summary: `${status === 'completed' || status === 'received' ? 'Deleted confirmed' : 'Discarded'} store transfer ${row.fromShop || '?'} → ${row.toShop || '?'} (${n} items)`,
      meta: { fromShop: row.fromShop, toShop: row.toShop, status, products: n },
    })
    res.json({ ok: true })
  } catch (e) { safeError(res, e) }
})

// ── Markdown / sale lists ───────────────────────────────────────────────────

const MARKDOWN_LANES = ['Ring Mall', 'Village', 'E-commerce']

function markdownLaneForUser(user, requestedLane) {
  const lane = String(requestedLane || '').trim()
  if (user.role === 'executive') {
    if (!lane) return ''
    return MARKDOWN_LANES.includes(lane) ? lane : ''
  }
  if (user.role === 'marketing') return 'E-commerce'
  if (user.role === 'manager' && (user.shop === 'Ring Mall' || user.shop === 'Village')) return user.shop
  return ''
}

function saleChangeShopForUser(user, requestedShop) {
  const shop = String(requestedShop || '').trim()
  if (user.role === 'executive') {
    if (!shop) return ''
    return MARKDOWN_LANES.includes(shop) ? shop : ''
  }
  if (user.role === 'marketing') return 'E-commerce'
  if (user.role === 'manager' && (user.shop === 'Ring Mall' || user.shop === 'Village')) return user.shop
  return ''
}

app.get('/api/markdown-lists', (req, res) => {
  try {
    if (req.authUser?.role !== 'executive') {
      const activeShift = getActiveShifts().some((s) => s.user_id === req.authUser.id)
      if (activeShift) {
        assignPendingUnassignedMarkdownListsForShift(req.authUser)
      }
    }
    res.json(getAllMarkdownLists().filter((l) => markdownListVisibleToUser(l, req.authUser)))
  } catch (e) { safeError(res, e) }
})

app.post('/api/markdown-lists', (req, res) => {
  try {
    const u = req.authUser
    if (req.body?.kind === 'location_change') {
      return res.status(400).json({ error: 'Change Location Web checklists are created automatically from Outlet transfers' })
    }
    if (u.role !== 'executive' && u.role !== 'manager') {
      return res.status(403).json({ error: 'Manager or executive access required' })
    }
    const body = { ...req.body, createdBy: u.id }
    if (u.role !== 'executive') body.shop = u.shop ?? ''
    const list = insertMarkdownList(body)
    // Removal lists track taking sale tags OFF — they never flag SKUs as on sale.
    if (list.kind !== 'removal') applySaleToSkus(list.id, list.items)
    const n = Array.isArray(list.items) ? list.items.length : 0
    act(u, {
      category: 'markdown',
      action: 'created',
      entityType: 'markdown_list',
      entityId: list.id,
      summary: `${list.kind === 'removal' ? 'Sale removal list' : 'Sale list'} "${list.title || 'Untitled'}" (${n} products)`,
      meta: { status: list.status, products: n, kind: list.kind },
    })
    res.json(list)
  } catch (e) { safeError(res, e) }
})

app.put('/api/markdown-lists/:id', (req, res) => {
  try {
    const u = req.authUser
    const row = getMarkdownListById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!markdownListVisibleToUser(row, u)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (row.kind === 'location_change') {
      return res.status(403).json({ error: 'Use the Mark action from the Outlet transfer' })
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'item_statuses') && u.role !== 'executive') {
      return res.status(403).json({ error: 'Use the lane mark endpoint to update markdown progress' })
    }

    let updated
    if (req.body.items !== undefined) {
      if (u.role !== 'executive' && u.role !== 'manager') {
        return res.status(403).json({ error: 'Manager or executive access required' })
      }
      const incoming = Array.isArray(req.body.items) ? req.body.items : []
      const existing = row.items || []
      const existingSkuCodes = new Set(existing.map((item) => String(item?.skuCode || '')))
      const skuCodesAdded = incoming
        .map((item) => String(item?.skuCode || '').trim())
        .filter((skuCode) => skuCode && !existingSkuCodes.has(skuCode))
      const newOrUpdated = incoming.filter((it) => {
        const prev = existing.find((e) => e.skuCode === it.skuCode)
        return !prev ||
          prev.salePct !== it.salePct ||
          Number(prev.extraSalePct || 0) !== Number(it.extraSalePct || 0) ||
          prev.salePrice !== it.salePrice
      })
      updated = appendItemsToMarkdownList(req.params.id, incoming)
      act(u, {
        category: 'markdown',
        action: 'items_added',
        entityType: 'markdown_list',
        entityId: req.params.id,
        summary: `Added ${newOrUpdated.length} product(s) to sale list "${row.title || 'Untitled'}"`,
        meta: {
          added: skuCodesAdded.length,
          updated: Math.max(0, newOrUpdated.length - skuCodesAdded.length),
          total: (updated.items || []).length,
          skuCodesAdded,
        },
      })
      res.json(updated)
      return
    }

    updated = updateMarkdownList(req.params.id, req.body)
    // Ending a sale clears the SALE flag from its SKUs (list is kept for history).
    if (req.body.status === 'ended' && row.status !== 'ended') {
      clearSaleForList(req.params.id)
    }
    act(u, {
      category: 'markdown',
      action: 'updated',
      entityType: 'markdown_list',
      entityId: req.params.id,
      summary: `Sale list updated — ${updated?.status || row.status}`,
      meta: { patch: req.body, status: updated?.status },
    })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

app.delete('/api/markdown-lists/:id', (req, res) => {
  try {
    const u = req.authUser
    const row = getMarkdownListById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (u.role !== 'executive' && u.role !== 'manager') {
      return res.status(403).json({ error: 'Manager or executive access required' })
    }
    if (!markdownListVisibleToUser(row, u)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (row.kind === 'location_change') {
      return res.status(403).json({ error: 'Delete the linked Outlet transfer to remove this checklist' })
    }
    deleteMarkdownList(req.params.id)
    act(u, {
      category: 'markdown',
      action: 'deleted',
      entityType: 'markdown_list',
      entityId: req.params.id,
      summary: `Sale list "${row.title || 'Untitled'}" deleted — sale cleared`,
      meta: { products: Array.isArray(row.items) ? row.items.length : 0 },
    })
    res.json({ ok: true })
  } catch (e) { safeError(res, e) }
})

app.patch('/api/markdown-lists/:id/items/:skuCode/tagged', (req, res) => {
  try {
    const u = req.authUser
    const row = getMarkdownListById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!markdownListVisibleToUser(row, u)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (row.kind === 'location_change' && u.role !== 'executive') {
      return res.status(403).json({ error: 'Executive access required' })
    }
    const lane = row.kind === 'location_change'
      ? 'E-commerce'
      : markdownLaneForUser(u, req.body?.lane)
    if (!lane) return res.status(403).json({ error: 'No markdown lane available for this user' })
    if ((row.kind === 'ecommerce_sale' || row.kind === 'location_change') && lane !== 'E-commerce') {
      return res.status(403).json({ error: 'This sale list is E-commerce only' })
    }
    const skuCode = decodeURIComponent(req.params.skuCode || '')
    const updated = toggleMarkdownListItemTagged(req.params.id, skuCode, lane, u.id)
    const isTagged = updated.item_statuses?.[skuCode]?.[lane]?.status === 'tagged'
    const isLocationChange = row.kind === 'location_change'
    act(u, {
      category: isLocationChange ? 'transfer_outlet' : 'markdown',
      action: isLocationChange
        ? (isTagged ? 'web_location_marked' : 'web_location_unmarked')
        : (isTagged ? 'sale_item_tagged' : 'sale_item_untagged'),
      entityType: 'markdown_list',
      entityId: req.params.id,
      summary: isLocationChange
        ? `${isTagged ? 'Website location changed' : 'Website location mark cleared'} — ${skuCode}`
        : isTagged
          ? `Sale tag marked at ${lane} — ${skuCode}`
          : `Sale tag mark cleared at ${lane} — ${skuCode}`,
      meta: { listId: req.params.id, sourceTransferId: row.sourceTransferId || null, skuCode, lane },
    })
    res.json(updated)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.patch('/api/markdown-lists/:id/items/:skuCode/sale-pct', (req, res) => {
  try {
    const u = req.authUser
    if (u.role !== 'executive' && u.role !== 'manager') {
      return res.status(403).json({ error: 'Manager or executive access required' })
    }
    const row = getMarkdownListById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!markdownListVisibleToUser(row, u)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (row.kind === 'location_change') {
      return res.status(403).json({ error: 'Website location checklists do not support sale changes' })
    }
    const salePct = Number(req.body?.salePct)
    if (!salePct || salePct <= 0) return res.status(400).json({ error: 'salePct required' })
    const rawExtraSalePct = Number(req.body?.extraSalePct || 0)
    if (![0, 20].includes(rawExtraSalePct)) {
      return res.status(400).json({ error: 'extraSalePct must be 0 or 20' })
    }
    const extraSalePct = rawExtraSalePct
    const skuCode = decodeURIComponent(req.params.skuCode || '')
    const result = changeMarkdownListItemSalePct(req.params.id, skuCode, salePct, extraSalePct, u.id)
    const ch = result.report?.changes?.[0]
    act(u, {
      category: 'markdown',
      action: 'sale_pct_changed',
      entityType: 'sale_change_report',
      entityId: result.report?.id,
      summary: ch
        ? `Sale discount changed on "${row.title || 'Sale list'}" — ${ch.productName || ch.skuCode} -${ch.oldSalePct}%${ch.oldExtraSalePct === 20 ? ' + Extra 20%' : ''} → -${ch.newSalePct}%${ch.newExtraSalePct === 20 ? ' + Extra 20%' : ''}`
        : `Sale % changed on "${row.title || 'Sale list'}"`,
      meta: { listId: req.params.id, skuCode, reportId: result.report?.id },
    })
    res.json(result)
  } catch (e) { safeError(res, e) }
})

app.delete('/api/markdown-lists/:id/items/:skuCode', (req, res) => {
  try {
    const u = req.authUser
    if (u.role !== 'executive') {
      return res.status(403).json({ error: 'Executive access required' })
    }
    const row = getMarkdownListById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!markdownListVisibleToUser(row, u)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (row.kind === 'location_change') {
      return res.status(403).json({ error: 'Website location checklist products cannot be removed' })
    }
    const skuCode = decodeURIComponent(req.params.skuCode || '')
    const result = removeMarkdownListItemFromSale(req.params.id, skuCode, u.id)
    const change = result.report?.changes?.[0]
    act(u, {
      category: 'markdown',
      action: 'sale_item_removed',
      entityType: 'sale_change_report',
      entityId: result.report?.id,
      summary: `Removed ${result.item?.productName || skuCode} from sale list "${row.title || 'Sale list'}" (was -${change?.oldSalePct || 0}%${change?.oldExtraSalePct === 20 ? ' + Extra 20%' : ''})`,
      meta: { listId: req.params.id, skuCode, reportId: result.report?.id },
    })
    res.json(result)
  } catch (e) { safeError(res, e) }
})

app.get('/api/sale-change-reports', (req, res) => {
  try {
    res.json(getAllSaleChangeReports().filter((r) => saleChangeReportVisibleToUser(r, req.authUser)))
  } catch (e) { safeError(res, e) }
})

app.get('/api/sale-change-reports/:id', (req, res) => {
  try {
    const row = getSaleChangeReportById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!saleChangeReportVisibleToUser(row, req.authUser)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    res.json(row)
  } catch (e) { safeError(res, e) }
})

app.patch('/api/sale-change-reports/:id/items/:skuCode/marked', (req, res) => {
  try {
    const u = req.authUser
    const row = getSaleChangeReportById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!saleChangeReportVisibleToUser(row, u)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const skuCode = decodeURIComponent(req.params.skuCode || '')
    const shop = saleChangeShopForUser(u, req.body?.shop)
    if (!shop) return res.status(403).json({ error: 'No sale change lane available for this user' })
    const updated = toggleSaleChangeItemMarked(req.params.id, skuCode, u.id, shop)
    const marked = updated.item_statuses?.[skuCode]?.[shop]?.status === 'marked'
    const change = (row.changes || []).find((item) => item.skuCode === skuCode)
    const isRemoval = change?.changeType === 'removed'
    act(u, {
      category: 'markdown',
      action: marked ? 'sale_change_marked' : 'sale_change_unmarked',
      entityType: 'sale_change_report',
      entityId: req.params.id,
      summary: isRemoval
        ? (marked
            ? `Sale tag removal completed at ${shop} on change report — ${skuCode}`
            : `Sale tag removal reopened at ${shop} on change report — ${skuCode}`)
        : (marked
            ? `Sale tag marked down at ${shop} on change report — ${skuCode}`
            : `Sale tag mark-down cleared at ${shop} on change report — ${skuCode}`),
      meta: { listId: row.listId, skuCode, reportId: req.params.id, shop },
    })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

app.delete('/api/sale-change-reports/:id', requireExecutive, (req, res) => {
  try {
    const report = getSaleChangeReportById(req.params.id)
    if (!report) return res.status(404).json({ error: 'Change report not found' })
    const result = discardSaleChangeReport(req.params.id)
    act(req.authUser, {
      category: 'sale_change_report',
      action: 'discarded',
      entityType: 'sale_change_report',
      entityId: req.params.id,
      summary: 'Discarded sale change report — ' + (report.listTitle || report.listId),
      meta: { listId: report.listId, changeCount: report.changes?.length || 0 },
    })
    res.json(result)
  } catch (e) { safeError(res, e) }
})

app.delete('/api/sale-change-reports/:id/items/:skuCode', requireExecutive, (req, res) => {
  try {
    const report = getSaleChangeReportById(req.params.id)
    if (!report) return res.status(404).json({ error: 'Change report not found' })
    const result = discardSaleChangeReportProduct(req.params.id, req.params.skuCode)
    act(req.authUser, {
      category: 'sale_change_report',
      action: 'discarded_product',
      entityType: 'sale_change_report',
      entityId: req.params.id,
      summary: 'Discarded sale change for ' + req.params.skuCode + ' — ' + (report.listTitle || report.listId),
      meta: { listId: report.listId, skuCode: req.params.skuCode },
    })
    res.json(result)
  } catch (e) { safeError(res, e) }
})

// ── Sales snapshots ─────────────────────────────────────────────────────────

app.get('/api/snapshots', (req, res) => {
  try { res.json(getAllSnapshots()) }
  catch (e) { safeError(res, e) }
})

app.post('/api/snapshots', requireExecutive, (req, res) => {
  try {
    const s = insertSnapshot(req.body)
    const nk = s.products && typeof s.products === 'object' ? Object.keys(s.products).length : 0
    act(req.authUser, {
      category: 'sales_snapshot',
      action: 'created',
      entityType: 'snapshot',
      entityId: s.id,
      summary: `Sales snapshot — ${nk} product keys`,
      meta: { productKeys: nk },
    })
    res.json(s)
  } catch (e) { safeError(res, e) }
})

// ── Sales events ─────────────────────────────────────────────────────────────

app.get('/api/skus/sold-map', (req, res) => {
  try { res.json(getSoldQuantityMap()) }
  catch (e) { safeError(res, e) }
})

app.get('/api/sales/by-sku', (req, res) => {
  try {
    const since = req.query.since || '1970-01-01'
    const until = req.query.until || undefined
    const season = typeof req.query.season === 'string' && req.query.season ? req.query.season : undefined
    res.json(getSalesBySku(since, until, season))
  } catch (e) { safeError(res, e) }
})

app.get('/api/sales/by-season-sku', (req, res) => {
  try {
    const since = req.query.since || '1970-01-01'
    const until = req.query.until || undefined
    const season = typeof req.query.season === 'string' && req.query.season ? req.query.season : undefined
    res.json(getSalesBySeasonSku(since, until, season))
  } catch (e) { safeError(res, e) }
})

app.get('/api/sales/summary/:sku', (req, res) => {
  try {
    const season = typeof req.query.season === 'string' && req.query.season ? req.query.season : undefined
    res.json(getSalesSummaryForSku(req.params.sku || '', { season }))
  } catch (e) { safeError(res, e) }
})

app.get('/api/skus/:sku/activity', requireManagerOrExecutive, (req, res) => {
  try {
    assertSafeSku(req.params.sku)
    res.json(getSkuActivity(req.params.sku, { since: req.query.since, until: req.query.until }))
  } catch (e) { safeError(res, e) }
})

app.get('/api/skus/:sku/activity.csv', requireManagerOrExecutive, (req, res) => {
  try {
    assertSafeSku(req.params.sku)
    const activity = getSkuActivity(req.params.sku, { since: req.query.since, until: req.query.until })
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="RetailOS_Product_Sales_Card_${req.params.sku}.csv"`)
    res.send(activityCsv(activity))
  } catch (e) { safeError(res, e) }
})

app.get('/api/skus/:sku/activity.xlsx', requireManagerOrExecutive, async (req, res) => {
  try {
    assertSafeSku(req.params.sku)
    const activity = getSkuActivity(req.params.sku, { since: req.query.since, until: req.query.until })
    const buffer = await activityXlsx(activity)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="RetailOS_Product_Sales_Card_${req.params.sku}.xlsx"`)
    res.send(Buffer.from(buffer))
  } catch (e) { safeError(res, e) }
})

app.get('/api/sales/by-day', (req, res) => {
  try {
    const since = req.query.since || '1970-01-01'
    const until = req.query.until || undefined
    const season = typeof req.query.season === 'string' && req.query.season ? req.query.season : undefined
    res.json(getSalesAggregatedByDay(since, until, season))
  } catch (e) { safeError(res, e) }
})

app.get('/api/sales/exchanges', (req, res) => {
  try {
    const since = req.query.since || undefined
    const until = req.query.until || undefined
    res.json(getExchangePairs(since, until))
  } catch (e) { safeError(res, e) }
})

app.use('/api', createSalesEventsRouter({
  requireExecutive,
  requireDestructiveConfirmation,
  safeError,
  safeImportError,
  act,
  salesEvents,
}))

// ── Photos ──────────────────────────────────────────────────────────────────

app.get('/api/photos', (req, res) => {
  try {
    const files = fs.readdirSync(PHOTOS_DIR)
    const skuCodes = files.map((f) => path.basename(f, path.extname(f)))
    res.json(skuCodes)
  } catch (e) { safeError(res, e) }
})

app.get('/api/photos/:skuCode', (req, res) => {
  try {
    assertSafeSku(req.params.skuCode)
    const files = fs.readdirSync(PHOTOS_DIR)
    const match = files.find((f) => path.basename(f, path.extname(f)) === req.params.skuCode)
    if (!match) return res.status(404).json({ error: 'Photo not found' })
    if (path.extname(match).toLowerCase() === '.avif') res.type('avif')
    res.sendFile(path.join(PHOTOS_DIR, match))
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.post('/api/photos/:skuCode', requireExecutive, uploadPhotoMem.single('photo'), (req, res) => {
  try {
    assertSafeSku(req.params.skuCode)
    if (!req.file?.buffer) return res.status(400).json({ error: 'No file uploaded' })
    const filename = writePhotoForSku(req.params.skuCode, req.file.buffer)
    act(req.authUser, {
      category: 'photo',
      action: 'uploaded',
      entityType: 'sku_photo',
      entityId: req.params.skuCode,
      summary: `Photo uploaded for SKU ${req.params.skuCode}`,
      meta: { filename },
    })
    res.json({ skuCode: req.params.skuCode, filename })
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.delete('/api/photos/:skuCode', requireExecutive, (req, res) => {
  try {
    assertSafeSku(req.params.skuCode)
    const files = fs.readdirSync(PHOTOS_DIR)
    const match = files.find((f) => path.basename(f, path.extname(f)) === req.params.skuCode)
    if (match) fs.unlinkSync(path.join(PHOTOS_DIR, match))
    if (match) {
      act(req.authUser, {
        category: 'photo',
        action: 'deleted',
        entityType: 'sku_photo',
        entityId: req.params.skuCode,
        summary: `Photo removed for SKU ${req.params.skuCode}`,
        meta: { filename: match },
      })
    }
    res.json({ deleted: !!match })
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

// ── Shifts ──────────────────────────────────────────────────────────────────

app.get('/api/shifts/active', (req, res) => {
  try {
    res.json(getActiveShifts())
  } catch (e) { safeError(res, e) }
})

app.get('/api/shifts/history', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7
    const all = getShiftHistory(days)
    res.json(filterShiftHistory(all, req.authUser))
  } catch (e) { safeError(res, e) }
})

app.get('/api/shifts/overview', (req, res) => {
  try {
    const requestedShop = String(req.query.shop || '')
    const shop = req.authUser.role === 'executive' ? requestedShop : (req.authUser.shop || '')
    res.json(getShiftAttendanceOverview(req.query.date ? String(req.query.date) : undefined, shop))
  } catch (e) { safeError(res, e) }
})

function monthlyAttendanceFilters(query) {
  return {
    month: String(query.month || ''),
    shop: String(query.shop || ''),
    userId: String(query.userId || ''),
  }
}

app.get('/api/shifts/monthly-report', requireExecutive, (req, res) => {
  try {
    res.json(getMonthlyAttendanceReport(monthlyAttendanceFilters(req.query)))
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.get('/api/shifts/monthly-report.csv', requireExecutive, (req, res) => {
  try {
    const report = getMonthlyAttendanceReport(monthlyAttendanceFilters(req.query))
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="RetailOS_Attendance_${report.month}.csv"`)
    res.send(monthlyAttendanceCsv(report))
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.get('/api/shifts/monthly-report.xlsx', requireExecutive, async (req, res) => {
  try {
    const report = getMonthlyAttendanceReport(monthlyAttendanceFilters(req.query))
    const buffer = await monthlyAttendanceXlsx(report)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="RetailOS_Attendance_${report.month}.xlsx"`)
    res.send(Buffer.from(buffer))
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.get('/api/shift-plans', (req, res) => {
  try {
    const requestedShop = String(req.query.shop || '')
    const weekStart = String(req.query.weekStart || '')
    if (req.authUser.role === 'executive') {
      return res.json(listShiftPlans({ weekStart, shop: requestedShop }))
    }
    const shop = req.authUser.shop || ''
    const canManage = isShiftPlanner(req.authUser.id, shop)
    res.json(listShiftPlans({ weekStart, shop, userId: canManage ? '' : req.authUser.id }))
  } catch (e) { safeError(res, e) }
})

app.post('/api/shift-plans', (req, res) => {
  try {
    const shop = String(req.body.shop || '')
    assertCanManageShiftShop(req.authUser, shop)
    const target = getPublicUserById(req.body.user_id)
    if (!target) return res.status(400).json({ error: 'Scheduled user not found' })
    if (req.authUser.role !== 'executive' && (target.shop !== shop || shop !== req.authUser.shop)) {
      return res.status(403).json({ error: 'Only executives can schedule users across shops' })
    }
    const plan = createShiftPlan(req.body, req.authUser.id)
    act(req.authUser, {
      category: 'shift', action: 'plan_created', entityType: 'shift_plan', entityId: plan.id,
      summary: plan.plan_type === 'day_off'
        ? `Marked ${plan.user_name} as day off at ${plan.shop} on ${plan.shift_date}`
        : `Planned ${plan.user_name} at ${plan.shop} on ${plan.shift_date}, ${plan.start_time}–${plan.end_time}`,
      meta: plan,
    })
    res.json(plan)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.put('/api/shift-plans/:id', (req, res) => {
  try {
    const current = getShiftPlanById(req.params.id)
    if (!current) return res.status(404).json({ error: 'Planned shift not found' })
    assertCanManageShiftShop(req.authUser, current.shop)
    const targetShop = String(req.body.shop || current.shop)
    const target = getPublicUserById(req.body.user_id || current.user_id)
    if (!target) return res.status(400).json({ error: 'Scheduled user not found' })
    if (req.authUser.role !== 'executive' && (targetShop !== current.shop || target.shop !== current.shop)) {
      return res.status(403).json({ error: 'Only executives can move shifts across shops' })
    }
    const plan = updateShiftPlan(req.params.id, req.body, req.authUser.id)
    if (current.status === 'published') {
      insertNotification({
        type: 'shift_schedule', title: 'Published shift updated',
        message: plan.plan_type === 'day_off'
          ? `${plan.shift_date}: Day off at ${plan.shop}`
          : `${plan.shift_date}: ${plan.start_time}–${plan.end_time} at ${plan.shop}`,
        userId: plan.user_id, relatedId: plan.id,
      })
    }
    act(req.authUser, {
      category: 'shift', action: 'plan_updated', entityType: 'shift_plan', entityId: plan.id,
      summary: `Updated ${plan.user_name}'s planned shift on ${plan.shift_date}`,
      meta: { before: current, after: plan },
    })
    res.json(plan)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.delete('/api/shift-plans/:id', (req, res) => {
  try {
    const current = getShiftPlanById(req.params.id)
    if (!current) return res.status(404).json({ error: 'Planned shift not found' })
    assertCanManageShiftShop(req.authUser, current.shop)
    const removed = removeShiftPlan(req.params.id, req.authUser.id)
    if (current.status === 'published') {
      insertNotification({
        type: 'shift_schedule', title: current.plan_type === 'day_off' ? 'Published day off removed' : 'Published shift cancelled',
        message: current.plan_type === 'day_off'
          ? `${current.shift_date}: Day off removed at ${current.shop}`
          : `${current.shift_date}: ${current.start_time}–${current.end_time} at ${current.shop}`,
        userId: current.user_id, relatedId: current.id,
      })
    }
    act(req.authUser, {
      category: 'shift', action: 'plan_cancelled', entityType: 'shift_plan', entityId: current.id,
      summary: `Cancelled ${current.user_name}'s planned shift on ${current.shift_date}`,
      meta: current,
    })
    res.json(removed)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.post('/api/shift-plans/copy-week', (req, res) => {
  try {
    const shop = String(req.body.shop || '')
    assertCanManageShiftShop(req.authUser, shop)
    const plans = copyShiftPlanWeek(shop, req.body.sourceWeekStart, req.body.targetWeekStart, req.authUser.id)
    act(req.authUser, {
      category: 'shift', action: 'week_copied', entityType: 'shift_schedule', entityId: `${shop}:${req.body.targetWeekStart}`,
      summary: `Copied ${plans.length} planned shift(s) into ${shop}'s week of ${req.body.targetWeekStart}`,
      meta: { shop, sourceWeekStart: req.body.sourceWeekStart, targetWeekStart: req.body.targetWeekStart },
    })
    res.json(plans)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.post('/api/shift-plans/publish', (req, res) => {
  try {
    const shop = String(req.body.shop || '')
    assertCanManageShiftShop(req.authUser, shop)
    const plans = publishShiftPlanWeek(shop, req.body.weekStart, req.authUser.id)
    for (const plan of plans) {
      insertNotification({
        type: 'shift_schedule', title: 'Shift schedule published',
        message: plan.plan_type === 'day_off'
          ? `${plan.shift_date}: Day off at ${plan.shop}`
          : `${plan.shift_date}: ${plan.start_time}–${plan.end_time} at ${plan.shop}`,
        userId: plan.user_id, relatedId: plan.id,
      })
    }
    act(req.authUser, {
      category: 'shift', action: 'week_published', entityType: 'shift_schedule', entityId: `${shop}:${req.body.weekStart}`,
      summary: `Published ${plans.length} planned shift(s) for ${shop}`,
      meta: { shop, weekStart: req.body.weekStart, count: plans.length },
    })
    res.json(plans)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.get('/api/shift-settings', (req, res) => {
  try {
    if (req.authUser.role === 'executive') return res.json(getShiftSettings())
    res.json(getShiftSettings(req.authUser.shop || ''))
  } catch (e) { safeError(res, e) }
})

app.put('/api/shift-settings/:shop', requireExecutive, (req, res) => {
  try {
    const settings = saveShiftSetting(decodeURIComponent(req.params.shop), req.body, req.authUser.id)
    act(req.authUser, {
      category: 'shift', action: 'settings_updated', entityType: 'shift_settings', entityId: settings.shop,
      summary: `Updated Shift Board settings for ${settings.shop}`,
      meta: settings,
    })
    res.json(settings)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.get('/api/shift-corrections', (req, res) => {
  try {
    res.json(listShiftCorrectionRequests(req.authUser.role === 'executive' ? '' : req.authUser.id))
  } catch (e) { safeError(res, e) }
})

app.post('/api/shift-corrections', (req, res) => {
  try {
    if (req.authUser.role === 'executive') return res.status(403).json({ error: 'Executives review correction requests' })
    const correction = createShiftCorrectionRequest(req.body, req.authUser)
    act(req.authUser, {
      category: 'shift', action: 'correction_requested', entityType: 'shift_correction', entityId: correction.id,
      summary: `Requested a correction for shift ${correction.shift_id}`,
      meta: correction,
    })
    res.json(correction)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.put('/api/shift-corrections/:id/review', requireExecutive, (req, res) => {
  try {
    const correction = reviewShiftCorrectionRequest(req.params.id, req.body.decision, req.authUser, req.body.reviewNote)
    act(req.authUser, {
      category: 'shift', action: `correction_${correction.status}`, entityType: 'shift_correction', entityId: correction.id,
      summary: `${correction.status === 'approved' ? 'Approved' : 'Rejected'} ${correction.requested_by_name}'s shift correction`,
      meta: correction,
    })
    res.json(correction)
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.post('/api/shifts/clock-in', (req, res) => {
  try {
    if (req.authUser.role === 'executive') return res.status(403).json({ error: 'Executives do not clock in' })
    const id = String(req.body.id || crypto.randomUUID())
    const result = clockIn(id, req.authUser)
    const claimedMarkdownLists = assignPendingUnassignedMarkdownListsForShift({
      id: req.authUser.id,
      name: req.authUser.name,
      shop: result.shop || req.authUser.shop,
    })
    act(req.authUser, {
      category: 'shift',
      action: 'clock_in',
      entityType: 'shift',
      entityId: result.id,
      summary: `Clock in${result.shop ? ` @ ${result.shop}` : ''}`,
      meta: { shop: result.shop, plannedShiftId: result.planned_shift_id, attendanceFlags: result.attendance_flags, claimedMarkdownLists: claimedMarkdownLists.length },
    })
    res.json({ ...result, claimedMarkdownLists })
  } catch (e) { safeError(res, e) }
})

app.put('/api/shifts/:id/clock-out', (req, res) => {
  try {
    const row = getShiftById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Shift not found' })
    if (row.user_id !== req.authUser.id && req.authUser.role !== 'executive') {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const result = clockOut(req.params.id, 'manual')
    if (!result) return res.status(404).json({ error: 'Shift not found' })
    act(req.authUser, {
      category: 'shift',
      action: 'clock_out',
      entityType: 'shift',
      entityId: req.params.id,
      summary: `Clock out${result.duration_min != null ? ` (${result.duration_min} min)` : ''}`,
      meta: { durationMin: result.duration_min, forUserId: row.user_id, attendanceFlags: result.attendance_flags, reason: result.clock_out_reason },
    })
    res.json(result)
  } catch (e) { safeError(res, e) }
})

// ── Notifications ──────────────────────────────────────────────────────────

app.get('/api/notifications', (req, res) => {
  try {
    const rows = filterNotifications(getNotifications(), req.authUser)
    res.json(rows)
  } catch (e) { safeError(res, e) }
})

app.post('/api/notifications', (req, res) => {
  try {
    if (!notificationCreateAllowed(req.authUser, req.body || {})) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const n = insertNotification(req.body)
    res.json(n)
  } catch (e) { safeError(res, e) }
})

app.put('/api/notifications/read-all', (req, res) => {
  try {
    const n = markNotificationsReadForViewer(
      req.authUser.id,
      req.authUser.role === 'executive',
    )
    res.json({ ok: true, marked: n })
  } catch (e) { safeError(res, e) }
})

app.put('/api/notifications/:id/read', (req, res) => {
  try {
    const row = getNotificationById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!notificationVisibleTo(row, req.authUser.id, req.authUser.role === 'executive')) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    markNotificationRead(req.params.id)
    res.json({ ok: true })
  } catch (e) { safeError(res, e) }
})

// ── Serve frontend (production) ─────────────────────────────────────────────

const distDir = path.resolve(__dirname, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('/{*splat}', (req, res) => {
    // Never return the SPA HTML for a missing hashed JS/CSS asset. Browsers
    // report that HTML response as a misleading dynamic-import failure.
    if (req.path.startsWith('/assets/')) {
      return res.status(404).type('text').send('Asset not found')
    }
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const LISTEN_HOST = process.env.LISTEN_HOST || '0.0.0.0'
const server = app.listen(PORT, LISTEN_HOST, () => {
  if (IS_PROD) {
    // Production: one concise line. Avoid LAN/dev guidance and local paths.
    console.log(`intelRetail API listening on ${LISTEN_HOST}:${PORT} (production)`)
  } else {
    // Development: keep the LAN/Vite/firewall hints and local paths that help on a dev LAN.
    const lan = pickPrimaryLanIp()
    console.log(`intelRetail API — http://localhost:${PORT}`)
    console.log(`intelRetail API — http://${lan}:${PORT}  ← same host both PCs use on this LAN (override: RETAILOS_LAN_IP)`)
    console.log(`LAN app:  With Vite (npm run dev:full) use one URL on every PC:  http://${lan}:5173`)
    console.log('          If the other PC cannot connect, allow Node.js through Windows Firewall (Private).')
    console.log(`Database: ${path.resolve(DATA_DIR, 'retailos.db')}`)
    console.log(`Photos:   ${PHOTOS_DIR}`)
    console.log(`Imports:  ${IMPORT_ARCHIVE_DIR}`)
  }
  try {
    fs.accessSync(IMPORT_ARCHIVE_DIR, fs.constants.W_OK)
  } catch {
    console.error(`[import] WARNING: imports directory is not writable: ${IMPORT_ARCHIVE_DIR}`)
  }
  try {
    const bf = backfillActivityLogFromLegacyIfEmpty()
    if (!bf.skipped) console.log(`[activity-log] Backfilled ${bf.inserted} legacy event(s)`)
    const itemTimestampCount = backfillMarkdownListItemAddedAt()
    if (itemTimestampCount) console.log(`[markdown] Backfilled SKU added timestamps on ${itemTimestampCount} list(s)`)
  } catch (e) {
    console.error('[activity-log] Backfill failed:', e.message)
  }
  try {
    const r = purgeExpiredBinnedSkus()
    if (r.purgedCodes.length) {
      console.log(`[recycle-bin] Auto-purged ${r.purgedCodes.length} expired SKU code(s): ${r.purgedCodes.join(', ')}`)
    }
  } catch (e) {
    console.error('[recycle-bin] Auto-purge failed:', e.message)
  }
  setInterval(() => {
    try {
      const r = purgeExpiredBinnedSkus()
      if (r.purgedCodes.length) {
        console.log(`[recycle-bin] Auto-purged ${r.purgedCodes.length} expired SKU code(s): ${r.purgedCodes.join(', ')}`)
      }
    } catch (e) {
      console.error('[recycle-bin] Auto-purge failed:', e.message)
    }
  }, 24 * 60 * 60 * 1000)
  try {
    evaluateShiftAttendance()
  } catch (e) {
    console.error('[shift-board] Attendance evaluation failed:', e.message)
  }
  setInterval(() => {
    try {
      evaluateShiftAttendance()
    } catch (e) {
      console.error('[shift-board] Attendance evaluation failed:', e.message)
    }
  }, 60 * 1000)
  if (IS_PROD && corsAllowedOrigins.length === 0) {
    console.warn('[security] CORS_ORIGINS is empty — browser clients with an Origin header will be blocked. Set CORS_ORIGINS to your HTTPS site(s), comma-separated.')
  }
  if (!IS_PROD && LISTEN_HOST !== '0.0.0.0') {
    console.log(`Listen:   ${LISTEN_HOST} (set LISTEN_HOST=0.0.0.0 for all interfaces)`)
  }
})

server.on('error', (err) => {
  console.error('Server failed to start:', err.message)
  process.exit(1)
})
