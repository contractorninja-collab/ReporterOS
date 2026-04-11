import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import os from 'os'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { SignJWT, jwtVerify } from 'jose'
import { fileURLToPath } from 'url'
import {
  getAllSkus, insertSkus, deleteSkusByImport,
  getImportHistory, insertImportRecord, deleteImportRecord,
  getLifetimeImportedBySku, getProductNameReport,
  getAllUsers, updateUser, addUser, removeUser,
  getUserRowByUserCode, verifyPin, getPublicUserById, toPublicUser,
  getAllAssignments, insertAssignment, updateAssignment,
  getAllOutletTransfers, insertOutletTransfer, updateOutletTransfer,
  getAllStoreTransfers, insertStoreTransfer, updateStoreTransfer,
  getAllSnapshots, insertSnapshot,
  getSoldQuantityMap, getSalesBySku, insertSalesEvents, getWeeklySales,
  getNotifications, getNotificationById, insertNotification, markNotificationRead,
  markNotificationsReadForViewer, notificationVisibleTo,
  clockIn, clockOut, getActiveShifts, getShiftHistory, getShiftById,
} from './src/data/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || __dirname
const PHOTOS_DIR = path.resolve(DATA_DIR, 'photos')
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true })

const IS_PROD = process.env.NODE_ENV === 'production'
const JWT_SECRET = process.env.JWT_SECRET || 'retailos-dev-secret-change-me'
if (!process.env.JWT_SECRET) {
  console.warn('[security] JWT_SECRET is not set — required for production')
}
const jwtSecretKey = new TextEncoder().encode(JWT_SECRET)
const COOKIE_NAME = 'retailos_session'

const SAFE_SKU_PARAM = /^[A-Za-z0-9._-]{1,64}$/

function assertSafeSku(sku) {
  if (!SAFE_SKU_PARAM.test(String(sku || ''))) {
    const err = new Error('Invalid SKU')
    err.statusCode = 400
    throw err
  }
}

function detectImageExt(buffer) {
  if (!buffer || buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return '.png'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp'
  return null
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
  const ext = detectImageExt(buffer)
  if (!ext) {
    const err = new Error('Invalid or unsupported image (use JPEG, PNG, or WebP)')
    err.statusCode = 400
    throw err
  }
  removeExistingPhotosForSku(skuCode)
  const dest = path.join(PHOTOS_DIR, `${skuCode}${ext}`)
  fs.writeFileSync(dest, buffer)
  return `${skuCode}${ext}`
}

const uploadPhotoMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
})

function safeError(res, e, status = 500) {
  console.error(e)
  const code = typeof e.statusCode === 'number' ? e.statusCode : status
  const msg = code >= 500 && IS_PROD ? 'Internal server error' : (e?.message || 'Error')
  res.status(code).json({ error: msg })
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

function filterNotifications(rows, user) {
  const isExec = user.role === 'executive'
  return rows.filter((n) => notificationVisibleTo(n, user.id, isExec))
}

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

function apiAuthGate(req, res, next) {
  if (!req.path.startsWith('/api')) return next()
  if (req.path === '/api/health') return next()
  if (req.path === '/api/auth/login' && req.method === 'POST') return next()
  if (req.path === '/api/auth/logout' && req.method === 'POST') return next()
  return requireAuth(req, res, next)
}

const app = express()
const PORT = process.env.PORT || 3001

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
app.use(cors({ origin: true, credentials: true }))
app.use(cookieParser())
app.use(express.json({ limit: '20mb' }))

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
})
const apiSoftLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api', apiSoftLimiter)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
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
  try { res.json(getAllSkus()) }
  catch (e) { safeError(res, e) }
})

app.post('/api/skus', requireExecutive, (req, res) => {
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' })
    insertSkus(req.body)
    res.json({ added: req.body.length })
  } catch (e) { safeError(res, e) }
})

app.delete('/api/skus/import/:importId', requireExecutive, (req, res) => {
  try {
    const changes = deleteSkusByImport(req.params.importId)
    res.json({ deleted: changes })
  } catch (e) { safeError(res, e) }
})

app.get('/api/sku-import-totals', (req, res) => {
  try { res.json(getLifetimeImportedBySku()) }
  catch (e) { safeError(res, e) }
})

app.get('/api/product-report', (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    res.json(getProductNameReport(q))
  } catch (e) { safeError(res, e) }
})

// ── Import history ──────────────────────────────────────────────────────────

app.get('/api/import-history', (req, res) => {
  try { res.json(getImportHistory()) }
  catch (e) { safeError(res, e) }
})

app.post('/api/import-history', requireExecutive, (req, res) => {
  try { res.json(insertImportRecord(req.body)) }
  catch (e) { safeError(res, e) }
})

app.delete('/api/import-history/:id', requireExecutive, (req, res) => {
  try {
    const changes = deleteImportRecord(req.params.id)
    res.json({ deleted: changes })
  } catch (e) { safeError(res, e) }
})

// ── Users ───────────────────────────────────────────────────────────────────

app.get('/api/users', (req, res) => {
  try { res.json(getAllUsers()) }
  catch (e) { safeError(res, e) }
})

app.post('/api/users', requireExecutive, (req, res) => {
  try { res.json(addUser(req.body)) }
  catch (e) { safeError(res, e) }
})

app.put('/api/users/:id', requireExecutive, (req, res) => {
  try {
    const updated = updateUser(req.params.id, req.body)
    if (!updated) return res.status(404).json({ error: 'User not found or no valid fields' })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

app.delete('/api/users/:id', requireExecutive, (req, res) => {
  try {
    const changes = removeUser(req.params.id)
    res.json({ deleted: changes })
  } catch (e) { safeError(res, e) }
})

// ── Assignments ─────────────────────────────────────────────────────────────

app.get('/api/assignments', (req, res) => {
  try {
    res.json(filterAssignments(getAllAssignments(), req.authUser))
  } catch (e) { safeError(res, e) }
})

app.post('/api/assignments', (req, res) => {
  try { res.json(insertAssignment(req.body)) }
  catch (e) { safeError(res, e) }
})

app.put('/api/assignments/:id', (req, res) => {
  try {
    const updated = updateAssignment(req.params.id, req.body)
    if (!updated) return res.status(404).json({ error: 'Not found' })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

// ── Outlet transfers ────────────────────────────────────────────────────────

app.get('/api/outlet-transfers', (req, res) => {
  try { res.json(getAllOutletTransfers()) }
  catch (e) { safeError(res, e) }
})

app.post('/api/outlet-transfers', (req, res) => {
  try { res.json(insertOutletTransfer(req.body)) }
  catch (e) { safeError(res, e) }
})

app.put('/api/outlet-transfers/:id', (req, res) => {
  try {
    const updated = updateOutletTransfer(req.params.id, req.body)
    if (!updated) return res.status(404).json({ error: 'Not found' })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

// ── Store transfers ─────────────────────────────────────────────────────────

app.get('/api/store-transfers', (req, res) => {
  try {
    res.json(filterStoreTransfers(getAllStoreTransfers(), req.authUser))
  } catch (e) { safeError(res, e) }
})

app.post('/api/store-transfers', (req, res) => {
  try { res.json(insertStoreTransfer(req.body)) }
  catch (e) { safeError(res, e) }
})

app.put('/api/store-transfers/:id', (req, res) => {
  try {
    const updated = updateStoreTransfer(req.params.id, req.body)
    if (!updated) return res.status(404).json({ error: 'Not found' })
    res.json(updated)
  } catch (e) { safeError(res, e) }
})

// ── Sales snapshots ─────────────────────────────────────────────────────────

app.get('/api/snapshots', (req, res) => {
  try { res.json(getAllSnapshots()) }
  catch (e) { safeError(res, e) }
})

app.post('/api/snapshots', requireExecutive, (req, res) => {
  try { res.json(insertSnapshot(req.body)) }
  catch (e) { safeError(res, e) }
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
    res.json(getSalesBySku(since, until))
  } catch (e) { safeError(res, e) }
})

app.post('/api/sales-events', requireExecutive, (req, res) => {
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' })
    const count = insertSalesEvents(req.body)
    res.json({ inserted: count })
  } catch (e) { safeError(res, e) }
})

app.get('/api/sales/weekly', (req, res) => {
  try {
    const weeks = parseInt(req.query.weeks, 10) || 8
    res.json(getWeeklySales(weeks))
  } catch (e) { safeError(res, e) }
})

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
    res.sendFile(path.join(PHOTOS_DIR, match))
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.post('/api/photos/:skuCode', uploadPhotoMem.single('photo'), (req, res) => {
  try {
    assertSafeSku(req.params.skuCode)
    if (!req.file?.buffer) return res.status(400).json({ error: 'No file uploaded' })
    const filename = writePhotoForSku(req.params.skuCode, req.file.buffer)
    res.json({ skuCode: req.params.skuCode, filename })
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

app.delete('/api/photos/:skuCode', (req, res) => {
  try {
    assertSafeSku(req.params.skuCode)
    const files = fs.readdirSync(PHOTOS_DIR)
    const match = files.find((f) => path.basename(f, path.extname(f)) === req.params.skuCode)
    if (match) fs.unlinkSync(path.join(PHOTOS_DIR, match))
    res.json({ deleted: !!match })
  } catch (e) { safeError(res, e, e.statusCode || 500) }
})

// ── Shifts ──────────────────────────────────────────────────────────────────

app.get('/api/shifts/active', (req, res) => {
  try {
    let rows = getActiveShifts()
    if (req.authUser.role !== 'executive') {
      rows = rows.filter((s) => s.shop === req.authUser.shop)
    }
    res.json(rows)
  } catch (e) { safeError(res, e) }
})

app.get('/api/shifts/history', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7
    const all = getShiftHistory(days)
    res.json(filterShiftHistory(all, req.authUser))
  } catch (e) { safeError(res, e) }
})

app.post('/api/shifts/clock-in', (req, res) => {
  try {
    const { id, userId, userName, shop } = req.body
    if (userId !== req.authUser.id) {
      return res.status(403).json({ error: 'Can only clock in as yourself' })
    }
    const result = clockIn(id, userId, userName, shop)
    res.json(result)
  } catch (e) { safeError(res, e) }
})

app.put('/api/shifts/:id/clock-out', (req, res) => {
  try {
    const row = getShiftById(req.params.id)
    if (!row) return res.status(404).json({ error: 'Shift not found' })
    if (row.user_id !== req.authUser.id && req.authUser.role !== 'executive') {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const result = clockOut(req.params.id)
    if (!result) return res.status(404).json({ error: 'Shift not found' })
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
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

function lanIpv4Addresses() {
  const out = []
  for (const nets of Object.values(os.networkInterfaces())) {
    if (!nets) continue
    for (const n of nets) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address)
    }
  }
  return out
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`intelRetail API — http://localhost:${PORT}`)
  for (const ip of lanIpv4Addresses()) {
    console.log(`intelRetail API — http://${ip}:${PORT}`)
  }
  console.log(`Database: ${path.resolve(DATA_DIR, 'retailos.db')}`)
  console.log(`Photos:   ${PHOTOS_DIR}`)
})

server.on('error', (err) => {
  console.error('Server failed to start:', err.message)
  process.exit(1)
})
