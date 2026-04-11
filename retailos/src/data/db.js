import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../..')
const dbPath = path.resolve(DATA_DIR, 'retailos.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')

function uid() { return crypto.randomUUID() }

const BCRYPT_ROUNDS = 10

/** @param {string} plain */
export function hashPin(plain) {
  return bcrypt.hashSync(String(plain), BCRYPT_ROUNDS)
}

/**
 * @param {string} plain
 * @param {string|null|undefined} stored — bcrypt hash or legacy plaintext (migrated on startup)
 */
export function verifyPin(plain, stored) {
  if (stored == null || stored === '') return false
  if (typeof stored === 'string' && stored.startsWith('$2')) {
    return bcrypt.compareSync(String(plain), stored)
  }
  return String(plain) === String(stored)
}

function migratePlaintextPinsToBcrypt() {
  const rows = db.prepare('SELECT id, pin FROM users WHERE pin IS NOT NULL AND pin != \'\'').all()
  for (const r of rows) {
    if (typeof r.pin === 'string' && r.pin.startsWith('$2')) continue
    const hash = hashPin(r.pin)
    db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(hash, r.id)
  }
}

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS skus (
    id TEXT PRIMARY KEY,
    barcode TEXT,
    sku TEXT NOT NULL,
    product_name TEXT,
    size TEXT,
    price_sold REAL,
    price_tag REAL,
    quantity INTEGER,
    sold_quantity INTEGER,
    import_date TEXT,
    gender TEXT,
    season TEXT,
    category TEXT,
    brand TEXT,
    _importId TEXT,
    UNIQUE(sku, size)
  );

  CREATE TABLE IF NOT EXISTS import_history (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    sku_count INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    shop TEXT,
    pin TEXT
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    type TEXT,
    skuCode TEXT,
    productName TEXT,
    assignedTo TEXT,
    assignedBy TEXT,
    shop TEXT,
    status TEXT DEFAULT 'pending',
    note TEXT,
    createdAt TEXT,
    completedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS outlet_transfers (
    id TEXT PRIMARY KEY,
    items TEXT,
    createdBy TEXT,
    createdAt TEXT,
    status TEXT DEFAULT 'pending',
    receivedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS store_transfers (
    id TEXT PRIMARY KEY,
    items TEXT,
    fromShop TEXT,
    toShop TEXT,
    createdBy TEXT,
    createdAt TEXT,
    status TEXT DEFAULT 'pending',
    receivedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS sales_snapshots (
    id TEXT PRIMARY KEY,
    timestamp TEXT,
    products TEXT
  );

  CREATE TABLE IF NOT EXISTS import_lines (
    id TEXT PRIMARY KEY,
    import_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    size TEXT,
    barcode TEXT,
    product_name TEXT,
    gender TEXT,
    quantity_added INTEGER NOT NULL,
    imported_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sales_events (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL,
    product_name TEXT,
    size TEXT,
    units_sold INTEGER NOT NULL,
    price_sold REAL,
    revenue REAL,
    event_date TEXT NOT NULL,
    import_id TEXT,
    created_at TEXT
  );
`)

// ── Migrations ───────────────────────────────────────────────────────────────
function safeAddColumn(table, column, type) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch { /* column already exists */ }
}
safeAddColumn('outlet_transfers', 'assignedTo', 'TEXT')
safeAddColumn('outlet_transfers', 'note', 'TEXT')
safeAddColumn('store_transfers', 'assignedTo', 'TEXT')
safeAddColumn('store_transfers', 'note', 'TEXT')
safeAddColumn('skus', 'cost_price', 'REAL')
safeAddColumn('users', 'user_code', 'TEXT')
safeAddColumn('store_transfers', 'item_statuses', 'TEXT')

// Rename legacy shops: Shop 1 → Ring Mall, Shop 2 → Village
;(function migrateRetailShopNames() {
  const pairs = [
    ['Shop 1', 'Ring Mall'],
    ['Shop 2', 'Village'],
  ]
  for (const [oldS, newS] of pairs) {
    try {
      db.prepare('UPDATE users SET shop = ? WHERE shop = ?').run(newS, oldS)
      db.prepare('UPDATE assignments SET shop = ? WHERE shop = ?').run(newS, oldS)
      db.prepare('UPDATE store_transfers SET fromShop = ? WHERE fromShop = ?').run(newS, oldS)
      db.prepare('UPDATE store_transfers SET toShop = ? WHERE toShop = ?').run(newS, oldS)
      db.prepare('UPDATE shifts SET shop = ? WHERE shop = ?').run(newS, oldS)
      db.prepare('UPDATE users SET name = REPLACE(name, ?, ?) WHERE name LIKE ?').run(oldS, newS, `%${oldS}%`)
    } catch { /* ignore */ }
  }
})()

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT,
    title TEXT,
    message TEXT,
    userId TEXT,
    relatedId TEXT,
    read INTEGER DEFAULT 0,
    createdAt TEXT
  );
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT,
    shop TEXT,
    clock_in TEXT NOT NULL,
    clock_out TEXT,
    duration_min INTEGER
  );
`)

// Seed default users if the table is empty
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
if (userCount === 0) {
  const defaultUsers = [
    { id: 'u-mgr-s1a', name: 'Manager 1 – Ring Mall', role: 'manager', shop: 'Ring Mall', pin: '1111', user_code: '10001' },
    { id: 'u-mgr-s1b', name: 'Manager 2 – Ring Mall', role: 'manager', shop: 'Ring Mall', pin: '1112', user_code: '10002' },
    { id: 'u-mgr-s2a', name: 'Manager 1 – Village', role: 'manager', shop: 'Village', pin: '2221', user_code: '20001' },
    { id: 'u-mgr-s2b', name: 'Manager 2 – Village', role: 'manager', shop: 'Village', pin: '2222', user_code: '20002' },
    { id: 'u-ceo', name: 'CEO', role: 'executive', shop: null, pin: '9001', user_code: '90001' },
    { id: 'u-coo', name: 'COO', role: 'executive', shop: null, pin: '9002', user_code: '90002' },
    { id: 'u-cto', name: 'CTO', role: 'executive', shop: null, pin: '9003', user_code: '90003' },
    { id: 'u-outlet', name: 'Outlet Manager', role: 'outlet', shop: 'Outlet', pin: '8001', user_code: '80001' },
  ]
  const ins = db.prepare('INSERT INTO users (id, name, role, shop, pin, user_code) VALUES (@id, @name, @role, @shop, @pin, @user_code)')
  const tx = db.transaction(() => { for (const u of defaultUsers) ins.run(u) })
  tx()
}

migratePlaintextPinsToBcrypt()

// ── SKUs ────────────────────────────────────────────────────────────────────

function toSku(row) {
  if (!row) return null
  return {
    id: row.id, barcode: row.barcode, sku: row.sku, product_name: row.product_name,
    size: row.size, price_sold: row.price_sold, price_tag: row.price_tag ?? 0,
    cost_price: row.cost_price ?? 0,
    quantity: row.quantity, sold_quantity: row.sold_quantity, import_date: row.import_date,
    gender: row.gender, season: row.season, category: row.category, brand: row.brand,
    _importId: row._importId,
  }
}

export function getAllSkus() {
  return db.prepare('SELECT * FROM skus').all().map(toSku)
}

const insertImportLine = db.prepare(`
  INSERT INTO import_lines (id, import_id, sku, size, barcode, product_name, gender, quantity_added, imported_at)
  VALUES (@id, @import_id, @sku, @size, @barcode, @product_name, @gender, @quantity_added, @imported_at)
`)

export function insertSkus(skusArray) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO skus (id, barcode, sku, product_name, size, price_sold, price_tag, cost_price, quantity, sold_quantity, import_date, gender, season, category, brand, _importId)
    VALUES (@id, @barcode, @sku, @product_name, @size, @price_sold, @price_tag, @cost_price, @quantity, @sold_quantity, @import_date, @gender, @season, @category, @brand, @_importId)
  `)
  const tx = db.transaction((items) => {
    for (const s of items) {
      const importDate = s.import_date instanceof Date ? s.import_date.toISOString()
        : (typeof s.import_date === 'string' ? s.import_date : null)
      const rowId = s.id || uid()
      insert.run({
        id: rowId, barcode: s.barcode ?? '', sku: s.sku ?? '', product_name: s.product_name ?? '',
        size: s.size ?? '', price_sold: s.price_sold ?? 0, price_tag: s.price_tag ?? 0,
        cost_price: s.cost_price ?? 0,
        quantity: s.quantity ?? 0, sold_quantity: s.sold_quantity ?? 0, import_date: importDate,
        gender: s.gender ?? '', season: s.season ?? '', category: s.category ?? '', brand: s.brand ?? '',
        _importId: s._importId ?? null,
      })
      if (s._importId) {
        const qty = Number(s.quantity) || 0
        insertImportLine.run({
          id: uid(),
          import_id: s._importId,
          sku: s.sku ?? '',
          size: s.size ?? '',
          barcode: s.barcode ?? '',
          product_name: s.product_name ?? '',
          gender: s.gender ?? '',
          quantity_added: qty,
          imported_at: importDate || new Date().toISOString(),
        })
      }
    }
  })
  tx(skusArray)
  return skusArray.length
}

export function deleteSkusByImport(importId) {
  db.prepare('DELETE FROM import_lines WHERE import_id = ?').run(importId)
  return db.prepare('DELETE FROM skus WHERE _importId = ?').run(importId).changes
}

// ── Import history ──────────────────────────────────────────────────────────

export function getImportHistory() {
  return db.prepare('SELECT * FROM import_history ORDER BY imported_at DESC').all().map((r) => ({
    id: r.id, filename: r.filename, date: r.imported_at, count: r.sku_count,
  }))
}

export function insertImportRecord(record) {
  const id = record.id || uid()
  const date = record.date || record.imported_at || new Date().toISOString()
  db.prepare('INSERT INTO import_history (id, filename, imported_at, sku_count) VALUES (?, ?, ?, ?)')
    .run(id, record.filename ?? '', date, record.count ?? record.sku_count ?? 0)
  return { id, filename: record.filename, date, count: record.count ?? record.sku_count }
}

export function deleteImportRecord(importId) {
  deleteSkusByImport(importId)
  return db.prepare('DELETE FROM import_history WHERE id = ?').run(importId).changes
}

// ── Import lines / product reports ──────────────────────────────────────────

/** Map sku code -> lifetime quantity imported (sum of all import_lines) */
export function getLifetimeImportedBySku() {
  const rows = db.prepare(`
    SELECT sku, COALESCE(SUM(quantity_added), 0) AS total
    FROM import_lines
    GROUP BY sku
  `).all()
  const map = {}
  for (const r of rows) map[r.sku] = r.total
  return map
}

function normalizeGenderBucket(g) {
  const x = String(g || '').toUpperCase().trim().slice(0, 1)
  if (x === 'F') return 'Women'
  if (x === 'K') return 'Kids'
  return 'Men'
}

/**
 * Product name substring report: aggregated rows per SKU code + timeline + totals.
 * @param {string} q — trimmed search; empty returns structure for "all" from client overview
 */
export function getProductNameReport(q) {
  const needle = (q || '').trim().toLowerCase()
  const skuRows = needle
    ? db.prepare(`
        SELECT DISTINCT sku FROM skus
        WHERE LOWER(COALESCE(product_name, '')) LIKE '%' || ? || '%'
      `).all(needle)
    : db.prepare(`SELECT DISTINCT sku FROM skus`).all()
  const skuCodes = skuRows.map((r) => r.sku).filter(Boolean)
  const emptyTotals = { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalProfit: 0, avgRoi: 0, totalInvestment: 0 }
  const emptyGender = () => ({ stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0 })
  if (!skuCodes.length) {
    return {
      query: q,
      rows: [],
      totals: emptyTotals,
      byGender: { Men: emptyGender(), Women: emptyGender(), Kids: emptyGender() },
      timeline: [],
    }
  }

  const placeholders = skuCodes.map(() => '?').join(',')
  const agg = db.prepare(`
    SELECT sku,
      MAX(product_name) AS product_name,
      MAX(gender) AS gender,
      SUM(quantity) AS quantity,
      SUM(sold_quantity) AS sold_quantity,
      MIN(import_date) AS first_import_date,
      MAX(import_date) AS last_import_date,
      GROUP_CONCAT(DISTINCT size) AS sizes,
      SUM(sold_quantity * COALESCE(cost_price, 0)) AS cogs,
      SUM(sold_quantity * COALESCE(price_sold, 0)) AS total_revenue,
      SUM(quantity * COALESCE(cost_price, 0)) AS total_investment
    FROM skus WHERE sku IN (${placeholders})
    GROUP BY sku
  `).all(...skuCodes)

  const rows = agg.map((r) => {
    const cogs = r.cogs || 0
    const totalRevenue = r.total_revenue || 0
    const profit = totalRevenue - cogs
    const roi = cogs > 0 ? (profit / cogs) * 100 : 0
    const qty = r.quantity || 0
    const soldQty = r.sold_quantity || 0
    return {
      sku: r.sku,
      product_name: r.product_name,
      gender: r.gender,
      genderBucket: normalizeGenderBucket(r.gender),
      stock: qty,
      remaining: Math.max(0, qty - soldQty),
      sold: soldQty,
      totalInvestment: r.total_investment || 0,
      first_import_date: r.first_import_date,
      last_import_date: r.last_import_date,
      sizes: r.sizes,
      cogs,
      totalRevenue,
      profit,
      roi,
      avgTicket: soldQty > 0 ? totalRevenue / soldQty : 0,
    }
  })

  let stock = 0
  let remaining = 0
  let sold = 0
  let cogs = 0
  let totalRevenue = 0
  let totalInvestment = 0
  const emptyBucket = () => ({ stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0 })
  const byGender = { Men: emptyBucket(), Women: emptyBucket(), Kids: emptyBucket() }
  for (const row of rows) {
    stock += row.stock
    remaining += row.remaining
    sold += row.sold
    cogs += row.cogs
    totalRevenue += row.totalRevenue
    totalInvestment += row.totalInvestment
    const b = byGender[row.genderBucket] || byGender.Men
    b.stock += row.stock
    b.remaining += row.remaining
    b.sold += row.sold
    b.cogs += row.cogs
    b.totalRevenue += row.totalRevenue
    b.totalInvestment += row.totalInvestment
  }

  const timelineRows = db.prepare(`
    SELECT il.import_id,
      COALESCE(SUM(il.quantity_added), 0) AS units,
      MIN(il.imported_at) AS imported_at
    FROM import_lines il
    WHERE il.sku IN (${placeholders})
    GROUP BY il.import_id
    ORDER BY imported_at DESC
  `).all(...skuCodes)

  const history = db.prepare('SELECT id, filename, imported_at FROM import_history').all()
  const histById = {}
  for (const h of history) histById[h.id] = h

  const timeline = timelineRows.map((t) => {
    const h = histById[t.import_id]
    return {
      importId: t.import_id,
      filename: h?.filename ?? '—',
      importedAt: t.imported_at,
      unitsAdded: t.units,
    }
  })

  const totalProfit = totalRevenue - cogs
  const avgRoi = cogs > 0 ? (totalProfit / cogs) * 100 : 0

  return {
    query: q,
    rows,
    totals: { stock, remaining, sold, cogs, totalRevenue, totalProfit, avgRoi, totalInvestment },
    byGender,
    timeline,
  }
}

// ── Users ───────────────────────────────────────────────────────────────────

/** Safe for API responses — never includes PIN. */
export function toPublicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    shop: row.shop,
    user_code: row.user_code,
  }
}

export function getAllUsers() {
  return db.prepare('SELECT id, name, role, shop, user_code FROM users ORDER BY name COLLATE NOCASE').all()
}

/** Full row including pin hash — server login only. */
export function getUserRowByUserCode(code) {
  if (code == null || code === '') return null
  return db.prepare('SELECT * FROM users WHERE user_code = ?').get(String(code))
}

export function getPublicUserById(id) {
  if (!id) return null
  const row = db.prepare('SELECT id, name, role, shop, user_code FROM users WHERE id = ?').get(id)
  return row || null
}

export function updateUser(id, changes) {
  const fields = []
  const values = {}
  for (const [k, v] of Object.entries(changes)) {
    if (k === 'pin') {
      if (v === undefined || v === null || v === '') continue
      fields.push('pin = @pin')
      values.pin = typeof v === 'string' && v.startsWith('$2') ? v : hashPin(v)
      continue
    }
    if (['name', 'role', 'shop', 'user_code'].includes(k)) {
      fields.push(`${k} = @${k}`)
      values[k] = v
    }
  }
  if (!fields.length) return null
  values.id = id
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = @id`).run(values)
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  return toPublicUser(row)
}

export function addUser(user) {
  const id = user.id || uid()
  const pinPlain = user.pin ?? '0000'
  const pinStored = typeof pinPlain === 'string' && pinPlain.startsWith('$2') ? pinPlain : hashPin(pinPlain)
  db.prepare('INSERT INTO users (id, name, role, shop, pin, user_code) VALUES (@id, @name, @role, @shop, @pin, @user_code)')
    .run({ id, name: user.name ?? '', role: user.role ?? 'manager', shop: user.shop ?? null, pin: pinStored, user_code: user.user_code ?? null })
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  return toPublicUser(row)
}

export function removeUser(userId) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes
}

// ── Assignments ─────────────────────────────────────────────────────────────

export function getAllAssignments() {
  return db.prepare('SELECT * FROM assignments ORDER BY createdAt DESC').all()
}

export function insertAssignment(a) {
  const id = a.id || uid()
  const createdAt = a.createdAt || new Date().toISOString()
  db.prepare(`INSERT INTO assignments (id, type, skuCode, productName, assignedTo, assignedBy, shop, status, note, createdAt, completedAt)
    VALUES (@id, @type, @skuCode, @productName, @assignedTo, @assignedBy, @shop, @status, @note, @createdAt, @completedAt)`)
    .run({ id, type: a.type ?? '', skuCode: a.skuCode ?? '', productName: a.productName ?? '',
      assignedTo: a.assignedTo ?? '', assignedBy: a.assignedBy ?? '', shop: a.shop ?? '',
      status: a.status ?? 'pending', note: a.note ?? '', createdAt, completedAt: a.completedAt ?? null })
  return { ...a, id, createdAt, completedAt: a.completedAt ?? null }
}

export function updateAssignment(id, changes) {
  const fields = []
  const values = { id }
  for (const [k, v] of Object.entries(changes)) {
    if (['status', 'completedAt', 'note'].includes(k)) {
      fields.push(`${k} = @${k}`)
      values[k] = v
    }
  }
  if (!fields.length) return null
  db.prepare(`UPDATE assignments SET ${fields.join(', ')} WHERE id = @id`).run(values)
  return db.prepare('SELECT * FROM assignments WHERE id = ?').get(id)
}

// ── Outlet transfers ────────────────────────────────────────────────────────

export function getAllOutletTransfers() {
  return db.prepare('SELECT * FROM outlet_transfers ORDER BY createdAt DESC').all().map((r) => ({
    ...r, items: JSON.parse(r.items || '[]'),
  }))
}

export function insertOutletTransfer(t) {
  const id = t.id || uid()
  const createdAt = t.createdAt || new Date().toISOString()
  db.prepare(`INSERT INTO outlet_transfers (id, items, createdBy, createdAt, status, receivedAt, assignedTo, note)
    VALUES (@id, @items, @createdBy, @createdAt, @status, @receivedAt, @assignedTo, @note)`)
    .run({ id, items: JSON.stringify(t.items || []), createdBy: t.createdBy ?? '',
      createdAt, status: t.status ?? 'pending', receivedAt: t.receivedAt ?? null,
      assignedTo: t.assignedTo ?? null, note: t.note ?? null })
  return { ...t, id, createdAt, receivedAt: t.receivedAt ?? null, items: t.items || [] }
}

export function updateOutletTransfer(id, changes) {
  const fields = []
  const values = { id }
  for (const [k, v] of Object.entries(changes)) {
    if (['status', 'receivedAt', 'items', 'assignedTo', 'note'].includes(k)) {
      fields.push(`${k} = @${k}`)
      values[k] = k === 'items' ? JSON.stringify(v) : v
    }
  }
  if (!fields.length) return null
  db.prepare(`UPDATE outlet_transfers SET ${fields.join(', ')} WHERE id = @id`).run(values)
  const row = db.prepare('SELECT * FROM outlet_transfers WHERE id = ?').get(id)
  return row ? { ...row, items: JSON.parse(row.items || '[]') } : null
}

// ── Store transfers ─────────────────────────────────────────────────────────

export function getAllStoreTransfers() {
  return db.prepare('SELECT * FROM store_transfers ORDER BY createdAt DESC').all().map((r) => ({
    ...r, items: JSON.parse(r.items || '[]'), item_statuses: JSON.parse(r.item_statuses || '{}'),
  }))
}

export function insertStoreTransfer(t) {
  const id = t.id || uid()
  const createdAt = t.createdAt || new Date().toISOString()
  db.prepare(`INSERT INTO store_transfers (id, items, fromShop, toShop, createdBy, createdAt, status, receivedAt, assignedTo, note)
    VALUES (@id, @items, @fromShop, @toShop, @createdBy, @createdAt, @status, @receivedAt, @assignedTo, @note)`)
    .run({ id, items: JSON.stringify(t.items || []), fromShop: t.fromShop ?? '', toShop: t.toShop ?? '',
      createdBy: t.createdBy ?? '', createdAt, status: t.status ?? 'pending', receivedAt: t.receivedAt ?? null,
      assignedTo: t.assignedTo ?? null, note: t.note ?? null })
  return { ...t, id, createdAt, receivedAt: t.receivedAt ?? null, items: t.items || [] }
}

export function updateStoreTransfer(id, changes) {
  const ALLOWED = ['status', 'receivedAt', 'items', 'assignedTo', 'note', 'item_statuses']
  const buildUpdate = (keys) => {
    const fields = []
    const values = { id }
    for (const k of keys) {
      const v = changes[k]
      if (v === undefined) continue
      fields.push(`${k} = @${k}`)
      values[k] = (k === 'items' || k === 'item_statuses') ? JSON.stringify(v) : v
    }
    return { fields, values }
  }
  const keysPresent = Object.keys(changes).filter((k) => ALLOWED.includes(k))
  if (!keysPresent.length) return null
  const { fields, values } = buildUpdate(keysPresent)
  try {
    db.prepare(`UPDATE store_transfers SET ${fields.join(', ')} WHERE id = @id`).run(values)
  } catch (e) {
    const fallbackKeys = keysPresent.filter((k) => k !== 'item_statuses')
    if (fallbackKeys.length) {
      const fb = buildUpdate(fallbackKeys)
      db.prepare(`UPDATE store_transfers SET ${fb.fields.join(', ')} WHERE id = @id`).run(fb.values)
    }
  }
  const row = db.prepare('SELECT * FROM store_transfers WHERE id = ?').get(id)
  return row ? { ...row, items: JSON.parse(row.items || '[]'), item_statuses: JSON.parse(row.item_statuses || '{}') } : null
}

// ── Sales snapshots ─────────────────────────────────────────────────────────

export function getAllSnapshots() {
  return db.prepare('SELECT * FROM sales_snapshots ORDER BY timestamp ASC').all().map((r) => ({
    id: r.id, timestamp: r.timestamp, products: JSON.parse(r.products || '{}'),
  }))
}

export function insertSnapshot(snap) {
  const id = snap.id || uid()
  const timestamp = snap.timestamp || new Date().toISOString()
  db.prepare('INSERT INTO sales_snapshots (id, timestamp, products) VALUES (?, ?, ?)')
    .run(id, timestamp, JSON.stringify(snap.products || {}))
  return { id, timestamp, products: snap.products || {} }
}

// ── Sales events ─────────────────────────────────────────────────────────────

/**
 * Returns { "sku|size": sold_quantity } map for all current SKUs.
 * Used to compute deltas when a reporting CSV is imported.
 */
export function getSoldQuantityMap() {
  const rows = db.prepare('SELECT sku, size, sold_quantity FROM skus').all()
  const map = {}
  for (const r of rows) map[`${r.sku}|${r.size ?? ''}`] = r.sold_quantity ?? 0
  return map
}

export function getSalesBySku(sinceDate, untilDate) {
  const params = [sinceDate || '1970-01-01']
  let where = 'event_date >= ?'
  if (untilDate) { where += ' AND event_date <= ?'; params.push(untilDate) }
  return db.prepare(`
    SELECT sku,
           SUM(units_sold) AS sold_qty,
           SUM(revenue) AS revenue
    FROM sales_events
    WHERE ${where}
    GROUP BY sku
  `).all(...params)
}

export function insertSalesEvents(events) {
  const ins = db.prepare(`
    INSERT INTO sales_events (id, sku, product_name, size, units_sold, price_sold, revenue, event_date, import_id, created_at)
    VALUES (@id, @sku, @product_name, @size, @units_sold, @price_sold, @revenue, @event_date, @import_id, @created_at)
  `)
  const tx = db.transaction((items) => {
    for (const e of items) {
      ins.run({
        id: e.id || uid(),
        sku: e.sku ?? '',
        product_name: e.product_name ?? '',
        size: e.size ?? '',
        units_sold: e.units_sold ?? 0,
        price_sold: e.price_sold ?? 0,
        revenue: e.revenue ?? 0,
        event_date: e.event_date ?? new Date().toISOString().slice(0, 10),
        import_id: e.import_id ?? null,
        created_at: e.created_at ?? new Date().toISOString(),
      })
    }
  })
  tx(events)
  return events.length
}

// ── Notifications ──────────────────────────────────────────────────────────

const NOTIF_RETENTION_DAYS = 7

function purgeOldNotifications() {
  const cutoff = new Date(Date.now() - NOTIF_RETENTION_DAYS * 86400000).toISOString()
  db.prepare('DELETE FROM notifications WHERE createdAt < ?').run(cutoff)
}

export function getNotifications() {
  purgeOldNotifications()
  const cutoff = new Date(Date.now() - NOTIF_RETENTION_DAYS * 86400000).toISOString()
  return db.prepare(
    `SELECT * FROM notifications WHERE createdAt >= ? ORDER BY createdAt DESC LIMIT 200`
  ).all(cutoff)
}

export function insertNotification(n) {
  const id = n.id || uid()
  const createdAt = n.createdAt || new Date().toISOString()
  db.prepare(`INSERT OR IGNORE INTO notifications (id, type, title, message, userId, relatedId, read, createdAt)
    VALUES (@id, @type, @title, @message, @userId, @relatedId, @read, @createdAt)`)
    .run({ id, type: n.type ?? '', title: n.title ?? '', message: n.message ?? '',
      userId: n.userId ?? 'all', relatedId: n.relatedId ?? null, read: 0, createdAt })
  return { id, type: n.type, title: n.title, message: n.message, userId: n.userId, relatedId: n.relatedId, read: 0, createdAt }
}

export function getNotificationById(id) {
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(id)
}

export function markNotificationRead(id) {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id)
}

export function markAllNotificationsRead() {
  db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run()
}

/**
 * Mark read only notifications visible to this viewer (executive = all unread).
 * @param {string} userId
 * @param {boolean} isExecutive
 */
export function markNotificationsReadForViewer(userId, isExecutive) {
  const rows = getNotifications()
  let n = 0
  for (const row of rows) {
    if (row.read) continue
    if (!notificationVisibleTo(row, userId, isExecutive)) continue
    markNotificationRead(row.id)
    n++
  }
  return n
}

/**
 * @param {{ userId?: string, type?: string }} n
 */
export function notificationVisibleTo(n, userId, isExecutive) {
  if (isExecutive) return true
  if (n.userId === 'executives') return false
  if (
    n.type === 'alert_assigned' &&
    n.userId &&
    n.userId !== 'all' &&
    userId &&
    n.userId !== userId
  ) {
    return false
  }
  return true
}

// ── Shifts ──────────────────────────────────────────────────────────────────

const MAX_SHIFT_HOURS = 14

function autoClockOutStale() {
  const cutoff = new Date(Date.now() - MAX_SHIFT_HOURS * 3600000).toISOString()
  const stale = db.prepare('SELECT id, clock_in FROM shifts WHERE clock_out IS NULL AND clock_in < ?').all(cutoff)
  const upd = db.prepare('UPDATE shifts SET clock_out = ?, duration_min = ? WHERE id = ?')
  for (const s of stale) {
    const start = new Date(s.clock_in)
    const end = new Date(start.getTime() + MAX_SHIFT_HOURS * 3600000)
    upd.run(end.toISOString(), MAX_SHIFT_HOURS * 60, s.id)
  }
  return stale.length
}

export function clockIn(id, userId, userName, shop) {
  autoClockOutStale()
  const existing = db.prepare('SELECT id FROM shifts WHERE user_id = ? AND clock_out IS NULL').get(userId)
  if (existing) return existing
  const clockInTime = new Date().toISOString()
  db.prepare('INSERT INTO shifts (id, user_id, user_name, shop, clock_in) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, userName ?? '', shop ?? '', clockInTime)
  return { id, user_id: userId, user_name: userName, shop, clock_in: clockInTime, clock_out: null, duration_min: null }
}

export function getShiftById(shiftId) {
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId)
}

export function clockOut(shiftId) {
  const row = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId)
  if (!row || row.clock_out) return row
  const now = new Date()
  const durationMin = Math.round((now.getTime() - new Date(row.clock_in).getTime()) / 60000)
  db.prepare('UPDATE shifts SET clock_out = ?, duration_min = ? WHERE id = ?')
    .run(now.toISOString(), durationMin, shiftId)
  return { ...row, clock_out: now.toISOString(), duration_min: durationMin }
}

export function getActiveShifts() {
  autoClockOutStale()
  return db.prepare('SELECT * FROM shifts WHERE clock_out IS NULL ORDER BY clock_in ASC').all()
}

export function getShiftHistory(days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  return db.prepare('SELECT * FROM shifts WHERE clock_in >= ? ORDER BY clock_in DESC LIMIT 500').all(since)
}

/**
 * Weekly sales aggregation for the last N weeks.
 * Groups sales_events by ISO week number and returns totals.
 */
export function getWeeklySales(weeksBack = 8) {
  const rows = db.prepare(`
    SELECT
      strftime('%Y-W%W', event_date) AS week,
      MIN(event_date) AS week_start,
      SUM(units_sold) AS totalUnits,
      SUM(revenue) AS totalRevenue
    FROM sales_events
    WHERE event_date >= date('now', ? || ' days')
    GROUP BY week
    ORDER BY week ASC
  `).all(`-${weeksBack * 7}`)

  return rows.map((r) => {
    const start = new Date(r.week_start)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    return {
      week: r.week,
      weekLabel: `${fmt(start)} – ${fmt(end)}`,
      totalUnits: r.totalUnits ?? 0,
      totalRevenue: r.totalRevenue ?? 0,
    }
  })
}
