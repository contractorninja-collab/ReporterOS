import Database from 'better-sqlite3'
import { normalizeBarcodeValue } from '../utils/barcodeFormat.js'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import {
  genderBucketKey,
  dominantGenderBySku,
} from '../utils/gender.js'
import { aggregateSkus } from '../utils/aggregateSkus.js'
import { getDaysInStore, getSellThrough } from '../utils/lifecycle.js'
import { normalizeCategory } from '../utils/category.js'
import { salePriceOf } from '../utils/saleList.js'
import { normalizeSeasonInput, isEarlierSeason, compareSeasons } from '../utils/seasons.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../..')
const dbPath = path.resolve(DATA_DIR, 'retailos.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
// WAL + NORMAL is the recommended durable-but-fast combo: writers don't fsync on
// every commit, which keeps large import transactions from stalling the single
// Node thread. busy_timeout lets a read that lands mid-import wait for the lock
// instead of throwing SQLITE_BUSY (which surfaced as "internal server error").
db.pragma('synchronous = NORMAL')
db.pragma('busy_timeout = 10000')

function uid() { return crypto.randomUUID() }

function roundMoney(value) {
  const n = Number(value) || 0
  return Math.round(n * 100) / 100
}

function logJsonRecovery(context, reason) {
  const table = context?.table || 'unknown_table'
  const column = context?.column || 'unknown_column'
  const id = context?.id != null && context.id !== '' ? ` id=${context.id}` : ''
  console.warn(`[db] Recovered malformed JSON in ${table}.${column}${id}: ${reason}`)
}

function safeJsonParse(value, fallback, context = {}) {
  if (value == null || value === '') return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (err) {
    logJsonRecovery(context, err?.message || 'parse failed')
    return fallback
  }
}

function safeJsonArray(value, context = {}) {
  const parsed = safeJsonParse(value, [], context)
  if (Array.isArray(parsed)) return parsed
  logJsonRecovery(context, `expected array, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`)
  return []
}

function safeJsonObject(value, context = {}) {
  const parsed = safeJsonParse(value, {}, context)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  logJsonRecovery(context, `expected object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`)
  return {}
}

const BCRYPT_ROUNDS = 10

/** @param {string} plain */
export function hashPin(plain) {
  return bcrypt.hashSync(String(plain), BCRYPT_ROUNDS)
}

/**
 * @param {string} plain
 * @param {string|null|undefined} stored — bcrypt hash; legacy plaintext is migrated on startup
 */
export function verifyPin(plain, stored) {
  if (stored == null || stored === '') return false
  if (typeof stored === 'string' && stored.startsWith('$2')) {
    return bcrypt.compareSync(String(plain), stored)
  }
  return false
}

function migratePlaintextPinsToBcrypt() {
  const rows = db.prepare('SELECT id, pin, pin_plain FROM users').all()
  for (const r of rows) {
    const existing = String(r.pin || '')
    if (existing.startsWith('$2')) continue
    const legacyPlain = existing || String(r.pin_plain || '')
    if (!legacyPlain) continue
    const hash = hashPin(legacyPlain)
    db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(hash, r.id)
  }
}

function clearStoredPlaintextPins() {
  try {
    db.prepare("UPDATE users SET pin_plain = NULL WHERE pin_plain IS NOT NULL AND pin_plain != ''").run()
  } catch {
    /* legacy column may not exist yet */
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
    unit_cost REAL,
    line_investment REAL,
    price_tag REAL,
    category TEXT,
    brand TEXT,
    season TEXT,
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
    order_id TEXT,
    exchange_group_id TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS inventory_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    sku TEXT NOT NULL,
    product_name TEXT,
    barcode TEXT,
    size TEXT,
    quantity INTEGER NOT NULL,
    signed_quantity INTEGER NOT NULL,
    unit_price REAL,
    revenue REAL,
    event_date TEXT NOT NULL,
    source_kind TEXT,
    source_ref TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS product_type_labels (
    sku TEXT PRIMARY KEY,
    product_type TEXT,
    source TEXT,
    confidence REAL,
    photo_signature TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS markdown_lists (
    id TEXT PRIMARY KEY,
    title TEXT,
    items TEXT,
    item_statuses TEXT,
    shop TEXT,
    createdBy TEXT,
    assignedTo TEXT,
    createdAt TEXT,
    status TEXT DEFAULT 'pending',
    completedAt TEXT,
    note TEXT
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
safeAddColumn('skus', 'deleted_at', 'TEXT')
safeAddColumn('skus', 'deleted_by', 'TEXT')
safeAddColumn('users', 'user_code', 'TEXT')
safeAddColumn('users', 'pin_plain', 'TEXT')
safeAddColumn('store_transfers', 'item_statuses', 'TEXT')
safeAddColumn('import_history', 'imported_by_user_id', 'TEXT')
safeAddColumn('import_history', 'imported_by_name', 'TEXT')
safeAddColumn('import_history', 'total_units', 'INTEGER')
safeAddColumn('import_history', 'csv_file_name', 'TEXT')
safeAddColumn('import_history', 'csv_file_path', 'TEXT')
safeAddColumn('import_history', 'csv_file_size', 'INTEGER')
safeAddColumn('sales_events', 'order_id', 'TEXT')
safeAddColumn('sales_events', 'exchange_group_id', 'TEXT')
safeAddColumn('inventory_events', 'revenue', 'REAL')
safeAddColumn('inventory_events', 'source_kind', 'TEXT')
safeAddColumn('inventory_events', 'source_ref', 'TEXT')
safeAddColumn('import_lines', 'unit_cost', 'REAL')
safeAddColumn('import_lines', 'line_investment', 'REAL')
safeAddColumn('import_lines', 'price_tag', 'REAL')
safeAddColumn('import_lines', 'category', 'TEXT')
safeAddColumn('import_lines', 'brand', 'TEXT')
safeAddColumn('import_lines', 'season', 'TEXT')
safeAddColumn('skus', 'last_import_date', 'TEXT')

db.exec(`
  CREATE TABLE IF NOT EXISTS season_starts (
    season TEXT PRIMARY KEY,
    started_at TEXT NOT NULL
  )
`)
safeAddColumn('product_type_labels', 'source', 'TEXT')
safeAddColumn('product_type_labels', 'confidence', 'REAL')
safeAddColumn('product_type_labels', 'photo_signature', 'TEXT')
safeAddColumn('product_type_labels', 'updated_at', 'TEXT')
safeAddColumn('skus', 'sale_percent', 'INTEGER')
safeAddColumn('skus', 'sale_active', 'INTEGER DEFAULT 0')
safeAddColumn('skus', 'sale_list_id', 'TEXT')
safeAddColumn('markdown_lists', 'kind', 'TEXT')
safeAddColumn('sale_change_reports', 'item_statuses', 'TEXT')

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`)

function getSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function randomPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0')
}

function nextUserCode() {
  const row = db.prepare(`
    SELECT MAX(CAST(user_code AS INTEGER)) AS max_code
    FROM users
    WHERE user_code GLOB '[0-9][0-9][0-9][0-9][0-9]'
  `).get()
  return String(Math.max(10000, Number(row?.max_code) || 10000) + 1)
}

function migrateSequentialUserCredentials() {
  if (getSetting('sequential_user_credentials_v1') === 'done') return
  const rows = db.prepare('SELECT id, name, role FROM users').all()
  const sorted = [...rows].sort((a, b) => {
    const score = (u) => {
      const name = String(u.name ?? '').trim().toLowerCase()
      if (u.id === 'u-ceo' || name === 'ceo') return 0
      if (u.role === 'executive') return 1
      if (u.role === 'manager') return 2
      if (u.role === 'outlet') return 3
      return 4
    }
    const s = score(a) - score(b)
    if (s !== 0) return s
    return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' })
  })
  const update = db.prepare('UPDATE users SET user_code = @user_code WHERE id = @id')
  const tx = db.transaction(() => {
    sorted.forEach((row, index) => {
      update.run({
        id: row.id,
        user_code: String(10001 + index),
      })
    })
    setSetting('sequential_user_credentials_v1', 'done')
  })
  tx()
}

const insertInventoryEventStmt = db.prepare(`
  INSERT INTO inventory_events (
    event_id, event_type, sku, product_name, barcode, size,
    quantity, signed_quantity, unit_price, revenue, event_date,
    source_kind, source_ref, created_at
  )
  VALUES (
    @event_id, @event_type, @sku, @product_name, @barcode, @size,
    @quantity, @signed_quantity, @unit_price, @revenue, @event_date,
    @source_kind, @source_ref, @created_at
  )
`)

function upsertInventoryEvent(event) {
  insertInventoryEventStmt.run(event)
}

const INVENTORY_REFRESH_LOG_ROWS = 1000
const INVENTORY_REFRESH_LOG_MS = 250

function inventoryRefreshLog(label, stats) {
  const elapsedMs = Date.now() - stats.startedAt
  const rowsTouched = Number(stats.scanned || 0) + Number(stats.deleted || 0) + Number(stats.inserted || 0)
  if (rowsTouched < INVENTORY_REFRESH_LOG_ROWS && elapsedMs < INVENTORY_REFRESH_LOG_MS) return
  console.log(
    `[db] Inventory events ${label}: scanned ${stats.scanned || 0}, deleted ${stats.deleted || 0}, inserted ${stats.inserted || 0}, ${elapsedMs}ms`,
  )
}

function inventoryEventFromIntakeRow(row) {
  const qty = Math.max(0, Math.round(Number(row.quantity_added) || 0))
  if (qty <= 0) return null
  return {
    event_id: `intake:${row.id}`,
    event_type: 'IMPORT',
    sku: row.sku ?? '',
    product_name: row.product_name ?? '',
    barcode: normalizeBarcodeValue(row.barcode ?? '') || '',
    size: row.size ?? '',
    quantity: qty,
    signed_quantity: qty,
    unit_price: null,
    revenue: 0,
    event_date: row.imported_at ?? new Date().toISOString(),
    source_kind: 'intake_import',
    source_ref: row.import_id ?? null,
    created_at: row.imported_at ?? new Date().toISOString(),
  }
}

function inventoryEventFromSalesRow(row) {
  const units = Math.round(Number(row.units_sold) || 0)
  if (units === 0) return null
  const qty = Math.abs(units)
  return {
    event_id: `sales:${row.id}`,
    event_type: units > 0 ? 'SALE' : 'RETURN',
    sku: row.sku ?? '',
    product_name: row.product_name ?? '',
    barcode: '',
    size: row.size ?? '',
    quantity: qty,
    signed_quantity: units > 0 ? -qty : qty,
    unit_price: Math.abs(Number(row.price_sold) || 0),
    revenue: Number(row.revenue) || 0,
    event_date: row.event_date ?? new Date().toISOString().slice(0, 10),
    source_kind: 'reporting_import',
    source_ref: row.import_id ?? null,
    created_at: row.created_at ?? new Date().toISOString(),
  }
}

function rebuildInventoryEvents() {
  const startedAt = Date.now()
  const clear = db.prepare('DELETE FROM inventory_events')
  const intakeRows = db.prepare(`
    SELECT
      il.id,
      il.import_id,
      il.sku,
      il.size,
      il.quantity_added,
      il.imported_at,
      il.gender,
      il.barcode,
      il.product_name
    FROM import_lines il
    WHERE il.import_id IN (SELECT id FROM import_history)
      AND COALESCE(il.quantity_added, 0) > 0
  `).all()
  const salesRows = db.prepare(`
    SELECT id, sku, product_name, size, units_sold, price_sold, revenue, event_date, import_id, order_id, exchange_group_id, created_at
    FROM sales_events
  `).all()

  let deleted = 0
  let inserted = 0
  const tx = db.transaction(() => {
    deleted = clear.run().changes

    for (const row of intakeRows) {
      const event = inventoryEventFromIntakeRow(row)
      if (event) {
        upsertInventoryEvent(event)
        inserted += 1
      }
    }

    for (const row of salesRows) {
      const event = inventoryEventFromSalesRow(row)
      if (event) {
        upsertInventoryEvent(event)
        inserted += 1
      }
    }
  })

  tx()
  inventoryRefreshLog('full rebuild', {
    startedAt,
    scanned: intakeRows.length + salesRows.length,
    deleted,
    inserted,
  })
}

function rebuildInventoryEventsForKeys(onlyKeys, label = 'scoped refresh') {
  if (!(onlyKeys instanceof Set) || onlyKeys.size === 0) return { deleted: 0, inserted: 0 }
  const startedAt = Date.now()
  const keys = [...onlyKeys].map((key) => {
    const pipe = key.indexOf('|')
    return pipe >= 0 ? { sku: key.slice(0, pipe), size: key.slice(pipe + 1) } : null
  }).filter(Boolean)
  if (!keys.length) return { deleted: 0, inserted: 0 }

  const del = db.prepare(`
    DELETE FROM inventory_events
    WHERE sku = @sku
      AND TRIM(COALESCE(size, '')) = @size
  `)
  const intake = db.prepare(`
    SELECT
      il.id,
      il.import_id,
      il.sku,
      il.size,
      il.quantity_added,
      il.imported_at,
      il.gender,
      il.barcode,
      il.product_name
    FROM import_lines il
    WHERE il.import_id IN (SELECT id FROM import_history)
      AND il.sku = @sku
      AND TRIM(COALESCE(il.size, '')) = @size
      AND COALESCE(il.quantity_added, 0) > 0
  `)
  const sales = db.prepare(`
    SELECT id, sku, product_name, size, units_sold, price_sold, revenue, event_date, import_id, order_id, exchange_group_id, created_at
    FROM sales_events
    WHERE sku = @sku
      AND TRIM(COALESCE(size, '')) = @size
  `)

  let deleted = 0
  let inserted = 0
  let scanned = 0
  db.transaction(() => {
    for (const key of keys) {
      deleted += del.run(key).changes
      const intakeRows = intake.all(key)
      const salesRows = sales.all(key)
      scanned += intakeRows.length + salesRows.length
      for (const row of intakeRows) {
        const event = inventoryEventFromIntakeRow(row)
        if (event) {
          upsertInventoryEvent(event)
          inserted += 1
        }
      }
      for (const row of salesRows) {
        const event = inventoryEventFromSalesRow(row)
        if (event) {
          upsertInventoryEvent(event)
          inserted += 1
        }
      }
    }
  })()
  inventoryRefreshLog(label, { startedAt, scanned, deleted, inserted })
  return { deleted, inserted }
}

function deleteInventoryEventsForSkuCodes(skuCodes, label = 'sku purge') {
  const codes = [...new Set((skuCodes || []).map((code) => String(code || '').trim()).filter(Boolean))]
  if (!codes.length) return 0
  const startedAt = Date.now()
  const del = db.prepare('DELETE FROM inventory_events WHERE sku = ?')
  let deleted = 0
  db.transaction(() => {
    for (const code of codes) deleted += del.run(code).changes
  })()
  inventoryRefreshLog(label, { startedAt, scanned: 0, deleted, inserted: 0 })
  return deleted
}

function deleteInventoryEventsBySource(sourceKind, sourceRef, label) {
  const startedAt = Date.now()
  const deleted = sourceRef == null
    ? db.prepare('DELETE FROM inventory_events WHERE source_kind = ?').run(sourceKind).changes
    : db.prepare('DELETE FROM inventory_events WHERE source_kind = ? AND source_ref = ?').run(sourceKind, sourceRef).changes
  inventoryRefreshLog(label, { startedAt, scanned: 0, deleted, inserted: 0 })
  return deleted
}
// ── Data-mutating backfill steps ────────────────────────────────────────────
// The functions below CHANGE row data (not schema). They are idempotent (safe to
// re-run) and are orchestrated by `runStartupDataBackfills()` near the end of this
// module. They are intentionally NOT executed inline at definition time so the
// orchestrator can sequence them, log them, and be gated/triggered explicitly
// (see RETAILOS_SKIP_STARTUP_BACKFILLS and scripts/run-data-backfills.mjs).

function backfillImportHistoryTotalUnits() {
  try {
    const needs = db.prepare(
      "SELECT id FROM import_history WHERE total_units IS NULL OR total_units = 0"
    ).all()
    const sumQ = db.prepare('SELECT COALESCE(SUM(quantity_added), 0) AS s FROM import_lines WHERE import_id = ?')
    const upd = db.prepare('UPDATE import_history SET total_units = ? WHERE id = ?')
    for (const { id } of needs) {
      const t = sumQ.get(id)?.s ?? 0
      if (t > 0) upd.run(t, id)
    }
  } catch { /* ignore */ }
}

// Fixes rows where merge/import zeroed cost_price when on-hand was 0 — backfill from another size of same sku
function repairSkusZeroCostFromSkuPeers() {
  try {
    const r = db.prepare(`
      UPDATE skus SET cost_price = (
        SELECT MAX(s2.cost_price)
        FROM skus s2
        WHERE s2.sku = skus.sku AND COALESCE(s2.cost_price, 0) > 0
      )
      WHERE COALESCE(cost_price, 0) = 0
        AND EXISTS (
          SELECT 1 FROM skus s3
          WHERE s3.sku = skus.sku AND COALESCE(s3.cost_price, 0) > 0
        )
    `).run()
    if (r.changes > 0) {
      console.log(`[db] Repaired cost_price on ${r.changes} sku row(s) (copied from same-SKU line with cost)`)
    }
  } catch { /* ignore */ }
}

// Exact duplicate sales_event rows (e.g. reporting confirm run multiple times before replace=1) inflate Bestsellers revenue 2–3×.
// Keep one row per (sku, size, day, units, revenue). Omit price_sold from the key: tiny float drift (91 vs 90.999) would split a duplicate group.
export function runDedupeSalesEvents() {
  return db
    .prepare(
      `DELETE FROM sales_events
       WHERE id NOT IN (
         SELECT MIN(id) FROM sales_events
         GROUP BY sku,
                  LOWER(TRIM(COALESCE(size, ''))),
                  event_date,
                  ROUND(COALESCE(units_sold, 0), 2),
                  ROUND(COALESCE(revenue, 0), 2)
       )`,
    )
    .run().changes
}

function runDedupeOnStartup() {
  try {
    if (!db.prepare('SELECT COUNT(*) AS c FROM sales_events').get().c) return
    const n = runDedupeSalesEvents()
    if (n > 0) {
      console.log(
        `[db] Removed ${n} duplicate sales_event row(s) (kept one per sku/size/day/units/revenue; fixes inflated period revenue)`,
      )
    }
  } catch (e) {
    console.warn('[db] dedupe sales_events failed:', e)
  }
}

function repairReportingLineTotalRevenue() {
  const fixEvents = db.prepare(`
    UPDATE sales_events
       SET revenue = CASE
             WHEN COALESCE(units_sold, 0) < 0 THEN -ABS(price_sold)
             ELSE ABS(price_sold)
           END,
           price_sold = CASE
             WHEN ABS(COALESCE(units_sold, 0)) > 0 THEN ABS(price_sold) / ABS(units_sold)
             ELSE COALESCE(price_sold, 0)
           END
     WHERE ABS(COALESCE(units_sold, 0)) > 1
       AND ABS(COALESCE(price_sold, 0)) > 0
       AND ABS(COALESCE(revenue, 0) - (COALESCE(price_sold, 0) * ABS(COALESCE(units_sold, 0)))) < 0.02
       AND EXISTS (
         SELECT 1
           FROM skus s
          WHERE s.sku = sales_events.sku
            AND LOWER(TRIM(COALESCE(s.size, ''))) = LOWER(TRIM(COALESCE(sales_events.size, '')))
            AND COALESCE(s.price_tag, 0) > 0
            AND ABS(COALESCE(sales_events.price_sold, 0)) > COALESCE(s.price_tag, 0) * 1.05
       )
  `).run().changes

  const fixSkuAvg = db.prepare(`
    UPDATE skus
       SET price_sold = (
         SELECT SUM(e.revenue) / SUM(e.units_sold)
           FROM sales_events e
          WHERE e.sku = skus.sku
            AND LOWER(TRIM(COALESCE(e.size, ''))) = LOWER(TRIM(COALESCE(skus.size, '')))
          GROUP BY e.sku, LOWER(TRIM(COALESCE(e.size, '')))
         HAVING ABS(SUM(e.units_sold)) > 0
       )
     WHERE EXISTS (
       SELECT 1
         FROM sales_events e
        WHERE e.sku = skus.sku
          AND LOWER(TRIM(COALESCE(e.size, ''))) = LOWER(TRIM(COALESCE(skus.size, '')))
        GROUP BY e.sku, LOWER(TRIM(COALESCE(e.size, '')))
       HAVING ABS(SUM(e.units_sold)) > 0
     )
  `).run().changes

  if (fixEvents > 0 || fixSkuAvg > 0) {
    rebuildInventoryEvents()
  }
  return { fixEvents, fixSkuAvg }
}

// Rename legacy shops: Shop 1 → Ring Mall, Shop 2 → Village
function migrateRetailShopNames() {
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
}

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

  CREATE TABLE IF NOT EXISTS sale_change_reports (
    id TEXT PRIMARY KEY,
    listId TEXT,
    listTitle TEXT,
    shop TEXT,
    createdBy TEXT,
    assignedTo TEXT,
    createdAt TEXT,
    changes TEXT
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

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    actor_user_id TEXT,
    actor_name TEXT NOT NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    summary TEXT NOT NULL,
    meta_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_log_category_created ON activity_log (category, created_at DESC);
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_skus_deleted_sku_size ON skus (deleted_at, sku, size);
  CREATE INDEX IF NOT EXISTS idx_skus_sku_normsize_deleted ON skus (sku, TRIM(COALESCE(size, '')), deleted_at);
  CREATE INDEX IF NOT EXISTS idx_skus_import_id ON skus (_importId);
  CREATE INDEX IF NOT EXISTS idx_skus_season_deleted_sku ON skus (season, deleted_at, sku);
  CREATE INDEX IF NOT EXISTS idx_skus_brand ON skus (brand);
  CREATE INDEX IF NOT EXISTS idx_skus_sale_list ON skus (sale_list_id, sale_active);

  CREATE INDEX IF NOT EXISTS idx_import_history_imported_at ON import_history (imported_at DESC);
  CREATE INDEX IF NOT EXISTS idx_import_history_imported_by ON import_history (imported_by_user_id, imported_at DESC);

  CREATE INDEX IF NOT EXISTS idx_import_lines_import_id ON import_lines (import_id);
  CREATE INDEX IF NOT EXISTS idx_import_lines_import_sku_normsize ON import_lines (import_id, sku, TRIM(COALESCE(size, '')));
  CREATE INDEX IF NOT EXISTS idx_import_lines_sku_normsize_imported ON import_lines (sku, TRIM(COALESCE(size, '')), imported_at);
  CREATE INDEX IF NOT EXISTS idx_import_lines_sku_imported ON import_lines (sku, imported_at);

  CREATE INDEX IF NOT EXISTS idx_sales_events_import_id ON sales_events (import_id);
  CREATE INDEX IF NOT EXISTS idx_sales_events_sku_normsize_date ON sales_events (sku, TRIM(COALESCE(size, '')), event_date);
  CREATE INDEX IF NOT EXISTS idx_sales_events_sku_date ON sales_events (sku, event_date);
  CREATE INDEX IF NOT EXISTS idx_sales_events_event_date ON sales_events (event_date);
  CREATE INDEX IF NOT EXISTS idx_sales_events_exchange_group ON sales_events (exchange_group_id);
  CREATE INDEX IF NOT EXISTS idx_sales_events_order_id ON sales_events (order_id);

  CREATE INDEX IF NOT EXISTS idx_inventory_events_sku_normsize ON inventory_events (sku, TRIM(COALESCE(size, '')));
  CREATE INDEX IF NOT EXISTS idx_inventory_events_sku_date ON inventory_events (sku, event_date);
  CREATE INDEX IF NOT EXISTS idx_inventory_events_source ON inventory_events (source_kind, source_ref);

  CREATE INDEX IF NOT EXISTS idx_users_user_code ON users (user_code);
  CREATE INDEX IF NOT EXISTS idx_users_shop_role ON users (shop, role);

  CREATE INDEX IF NOT EXISTS idx_assignments_created ON assignments (createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_assignments_sku ON assignments (skuCode);
  CREATE INDEX IF NOT EXISTS idx_assignments_shop_status ON assignments (shop, status);
  CREATE INDEX IF NOT EXISTS idx_assignments_assigned_status ON assignments (assignedTo, status);

  CREATE INDEX IF NOT EXISTS idx_outlet_transfers_created ON outlet_transfers (createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_outlet_transfers_status_created ON outlet_transfers (status, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_outlet_transfers_assigned ON outlet_transfers (assignedTo, status);
  CREATE INDEX IF NOT EXISTS idx_outlet_transfers_created_by ON outlet_transfers (createdBy, createdAt DESC);

  CREATE INDEX IF NOT EXISTS idx_store_transfers_created ON store_transfers (createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_store_transfers_from_status ON store_transfers (fromShop, status);
  CREATE INDEX IF NOT EXISTS idx_store_transfers_to_status ON store_transfers (toShop, status);
  CREATE INDEX IF NOT EXISTS idx_store_transfers_assigned ON store_transfers (assignedTo, status);
  CREATE INDEX IF NOT EXISTS idx_store_transfers_created_by ON store_transfers (createdBy, createdAt DESC);

  CREATE INDEX IF NOT EXISTS idx_markdown_lists_created ON markdown_lists (createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_markdown_lists_shop_status ON markdown_lists (shop, status);
  CREATE INDEX IF NOT EXISTS idx_markdown_lists_assigned_status ON markdown_lists (assignedTo, status);
  CREATE INDEX IF NOT EXISTS idx_markdown_lists_kind_status ON markdown_lists (kind, status);

  CREATE INDEX IF NOT EXISTS idx_sale_change_reports_created ON sale_change_reports (createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_sale_change_reports_shop_created ON sale_change_reports (shop, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_sale_change_reports_assigned ON sale_change_reports (assignedTo, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_sale_change_reports_list ON sale_change_reports (listId);

  CREATE INDEX IF NOT EXISTS idx_sales_snapshots_timestamp ON sales_snapshots (timestamp);
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications (userId, read, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_shifts_user_open ON shifts (user_id, clock_out);
  CREATE INDEX IF NOT EXISTS idx_shifts_clock_out_in ON shifts (clock_out, clock_in);
  CREATE INDEX IF NOT EXISTS idx_shifts_clock_in ON shifts (clock_in DESC);
  CREATE INDEX IF NOT EXISTS idx_shifts_shop_clock_in ON shifts (shop, clock_in DESC);
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
  const tx = db.transaction(() => {
    for (const u of defaultUsers) ins.run({ ...u, pin: hashPin(u.pin) })
  })
  tx()
}

migratePlaintextPinsToBcrypt()
clearStoredPlaintextPins()
migrateSequentialUserCredentials()

// ── SKUs ────────────────────────────────────────────────────────────────────

function toSku(row) {
  if (!row) return null
  return {
    id: row.id, barcode: normalizeBarcodeValue(row.barcode) || '', sku: row.sku, product_name: row.product_name,
    size: row.size, price_sold: row.price_sold, price_tag: row.price_tag ?? 0,
    cost_price: row.cost_price ?? 0,
    quantity: row.quantity, sold_quantity: row.sold_quantity,
    import_date: row.import_date, last_import_date: row.last_import_date ?? row.import_date,
    gender: row.gender, season: row.season, category: row.category, brand: row.brand,
    sale_active: row.sale_active ? 1 : 0, sale_percent: row.sale_percent ?? null, sale_list_id: row.sale_list_id ?? null,
    _importId: row._importId,
  }
}

/**
 * Live per-(sku,size) average sold price from the sales_events ledger.
 * sales_events is the source of truth for what actually sold and at what price,
 * whereas skus.price_sold is only a per-size snapshot that can drift to 0 when
 * units sell through reporting imports. Keyed by `${sku}\u0000${size}`.
 * Returns the signed net average (revenue / units) so returns are reflected,
 * and only includes sizes with positive net units so a full return never
 * produces a misleading price.
 */
function salesEventAvgPriceBySkuSize() {
  const map = new Map()
  let rows
  try {
    rows = db.prepare(`
      SELECT sku, size, SUM(units_sold) AS units, SUM(revenue) AS revenue
      FROM sales_events
      GROUP BY sku, size
    `).all()
  } catch {
    return map
  }
  for (const r of rows) {
    const units = Number(r.units) || 0
    if (units <= 0) continue
    const revenue = Number(r.revenue) || 0
    const avg = Math.round((revenue / units) * 100) / 100
    map.set(`${r.sku ?? ''}\u0000${String(r.size ?? '').trim()}`, avg)
  }
  return map
}

function inventoryOnHandBySkuSize() {
  const map = new Map()
  let rows
  try {
    rows = db.prepare(`
      SELECT sku, size, COALESCE(SUM(signed_quantity), 0) AS on_hand
      FROM inventory_events
      GROUP BY sku, size
    `).all()
  } catch {
    return map
  }
  for (const r of rows) {
    const onHand = Math.max(0, Math.round(Number(r.on_hand) || 0))
    map.set(`${r.sku ?? ''}\u0000${String(r.size ?? '').trim()}`, onHand)
  }
  return map
}

export function getAllSkus() {
  const avgBySize = salesEventAvgPriceBySkuSize()
  const onHandBySize = inventoryOnHandBySkuSize()
  return db.prepare('SELECT * FROM skus WHERE deleted_at IS NULL').all().map((row) => {
    const sku = toSku(row)
    const sizeKey = `${sku.sku ?? ''}\u0000${String(sku.size ?? '').trim()}`
    // Self-heal a stale/zero price_sold snapshot from the sales ledger when that
    // size actually has sales, so derived averages (e.g. tiles) stay accurate.
    const derived = avgBySize.get(sizeKey)
    if (derived != null && derived > 0) sku.price_sold = derived
    const onHand = onHandBySize.get(sizeKey)
    if (onHand != null) {
      sku.quantity = onHand + (Number(sku.sold_quantity) || 0)
      sku.on_hand_quantity = onHand
    }
    return sku
  })
}

const insertImportLine = db.prepare(`
  INSERT INTO import_lines (
    id, import_id, sku, size, barcode, product_name, gender,
    unit_cost, line_investment, price_tag, category, brand, season,
    quantity_added, imported_at
  )
  VALUES (
    @id, @import_id, @sku, @size, @barcode, @product_name, @gender,
    @unit_cost, @line_investment, @price_tag, @category, @brand, @season,
    @quantity_added, @imported_at
  )
`)

function onHandForSkuSize(sku, size) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(signed_quantity), 0) AS on_hand
    FROM inventory_events
    WHERE sku = ?
      AND TRIM(COALESCE(size, '')) = TRIM(COALESCE(?, ''))
  `).get(sku, size ?? '')
  if (row && Number(row.on_hand) !== 0) return Number(row.on_hand) || 0
  const cat = db.prepare(`
    SELECT quantity, sold_quantity FROM skus
    WHERE sku = ? AND TRIM(COALESCE(size, '')) = TRIM(COALESCE(?, '')) AND deleted_at IS NULL
    LIMIT 1
  `).get(sku, size ?? '')
  if (!cat) return 0
  return Math.max(0, (Number(cat.quantity) || 0) - (Number(cat.sold_quantity) || 0))
}

/**
 * Option B: at season start, re-tag prior-season on-hand stock to the new season (no intake qty).
 * @param {string} targetSeason e.g. FW26
 */
export function rolloverCarryoverToSeason(targetSeason) {
  const target = normalizeSeasonInput(targetSeason)
  if (!target || target.toLowerCase() === 'all') return { updated: 0, targetSeason: target }

  const rows = db.prepare(`
    SELECT id, sku, size, season
    FROM skus
    WHERE deleted_at IS NULL
      AND TRIM(COALESCE(season, '')) != ''
      AND TRIM(COALESCE(season, '')) != ?
  `).all(target)

  const upd = db.prepare('UPDATE skus SET season = ? WHERE id = ?')
  let updated = 0
  for (const row of rows) {
    if (!isEarlierSeason(row.season, target)) continue
    if (onHandForSkuSize(row.sku, row.size) <= 0) continue
    upd.run(target, row.id)
    updated += 1
  }
  return { updated, targetSeason: target }
}

/** First intake batch for a season triggers global carryover rollover (verdict B). */
function maybeStartSeasonFromIntake(skusArray) {
  const seasons = [...new Set(
    (skusArray || [])
      .map((s) => normalizeSeasonInput(s?.season))
      .filter(Boolean),
  )]
  if (seasons.length !== 1) return { rolledOver: 0, reason: 'mixed_season_batch' }
  const target = seasons[0]
  const started = db.prepare('SELECT 1 AS o FROM season_starts WHERE season = ?').get(target)
  if (started) return { rolledOver: 0, targetSeason: target, alreadyStarted: true }
  const result = rolloverCarryoverToSeason(target)
  db.prepare('INSERT INTO season_starts (season, started_at) VALUES (?, ?)').run(
    target,
    new Date().toISOString(),
  )
  return { ...result, seasonStarted: true }
}

/**
 * Shipment dates per SKU from import_lines (all deliveries with qty > 0).
 * @returns {Record<string, object>}
 */
export function getShipmentMetaBySku() {
  const rows = db.prepare(`
    SELECT
      il.sku,
      TRIM(COALESCE(il.season, '')) AS season,
      il.imported_at,
      il.quantity_added
    FROM import_lines il
    WHERE il.import_id IN (SELECT id FROM import_history)
      AND COALESCE(il.quantity_added, 0) > 0
      AND TRIM(COALESCE(il.sku, '')) != ''
    ORDER BY il.imported_at ASC, il.id ASC
  `).all()

  const seasonRowsBySku = db.prepare(`
    SELECT sku, season
    FROM skus
    WHERE deleted_at IS NULL
      AND TRIM(COALESCE(sku, '')) != ''
      AND TRIM(COALESCE(season, '')) != ''
    ORDER BY sku
  `).all()
  const currentSeasonBySku = {}
  for (const row of seasonRowsBySku) {
    const sku = row.sku
    const season = normalizeSeasonInput(row.season)
    if (!season) continue
    if (!currentSeasonBySku[sku] || compareSeasons(currentSeasonBySku[sku], season) < 0) {
      currentSeasonBySku[sku] = season
    }
  }

  const fallbackSeasonBySku = db.prepare(`
    SELECT sku, season
    FROM import_lines
    WHERE TRIM(COALESCE(sku, '')) != ''
      AND TRIM(COALESCE(season, '')) != ''
    ORDER BY imported_at ASC, id ASC
  `).all()
  for (const row of fallbackSeasonBySku) {
    const sku = row.sku
    const season = normalizeSeasonInput(row.season)
    if (!season) continue
    if (!currentSeasonBySku[sku] || compareSeasons(currentSeasonBySku[sku], season) < 0) {
      currentSeasonBySku[sku] = season
    }
  }

  const seasonStarts = Object.fromEntries(
    db.prepare('SELECT season, started_at FROM season_starts').all()
      .map((r) => [normalizeSeasonInput(r.season), r.started_at]),
  )

  /** Bucket an import line into a season for shipment/lifecycle metadata. */
  function seasonBucketForLine(sku, rowSeason, importedAt) {
    const trimmed = String(rowSeason || '').trim()
    if (trimmed) return trimmed
    const currentSeason = normalizeSeasonInput(currentSeasonBySku[sku] || '')
    if (!currentSeason) return '—'
    const startedAt = seasonStarts[currentSeason]
    if (startedAt && importedAt >= startedAt) return currentSeason
    return '—'
  }

  /** @type {Record<string, object>} */
  const map = {}
  for (const row of rows) {
    const sku = row.sku
    if (!map[sku]) {
      map[sku] = {
        first_arrival_date: row.imported_at,
        last_shipment_date: row.imported_at,
        first_season: row.season || null,
        current_season: currentSeasonBySku[sku] || row.season || '',
        shipments_by_season: {},
        imported_units_by_season: {},
        shipment_count: 0,
      }
    }
    const meta = map[sku]
    meta.last_shipment_date = row.imported_at
    meta.shipment_count += 1
    const sn = seasonBucketForLine(sku, row.season, row.imported_at)
    if (!meta.shipments_by_season[sn]) meta.shipments_by_season[sn] = []
    meta.shipments_by_season[sn].push(row.imported_at)
    meta.imported_units_by_season[sn] = (Number(meta.imported_units_by_season[sn]) || 0) + (Number(row.quantity_added) || 0)
    const lineSeason = String(row.season || '').trim()
    if (!meta.first_season && lineSeason) meta.first_season = lineSeason
  }

  for (const meta of Object.values(map)) {
    const cs = normalizeSeasonInput(meta.current_season)
    const seasonDates = cs ? (meta.shipments_by_season[cs] || []) : []
    meta.current_season_first_shipment = seasonDates[0] || null
    meta.current_season_last_shipment = seasonDates.length
      ? seasonDates[seasonDates.length - 1]
      : null
    meta.has_prior_season_carryover = cs && meta.first_season
      ? isEarlierSeason(meta.first_season, cs)
      : false
    if (seasonDates.length >= 2) {
      meta.prior_same_season_shipment = seasonDates[seasonDates.length - 2]
    } else {
      meta.prior_same_season_shipment = null
    }
  }
  return map
}

export function insertSkus(skusArray) {
  const insert = db.prepare(`
    INSERT INTO skus (id, barcode, sku, product_name, size, price_sold, price_tag, cost_price, quantity, sold_quantity, import_date, gender, season, category, brand, _importId)
    VALUES (@id, @barcode, @sku, @product_name, @size, @price_sold, @price_tag, @cost_price, @quantity, @sold_quantity, @import_date, @gender, @season, @category, @brand, @_importId)
    ON CONFLICT(sku, size) DO UPDATE SET
      id = excluded.id,
      barcode = excluded.barcode,
      product_name = excluded.product_name,
      price_sold = CASE
        WHEN excluded.price_sold > 0 THEN excluded.price_sold
        ELSE skus.price_sold
      END,
      price_tag = excluded.price_tag,
      cost_price = excluded.cost_price,
      quantity = excluded.quantity,
      sold_quantity = CASE
        WHEN COALESCE(excluded.sold_quantity, 0) > 0 THEN excluded.sold_quantity
        ELSE skus.sold_quantity
      END,
      import_date = CASE
        WHEN skus.import_date IS NOT NULL
          AND excluded.import_date IS NOT NULL
          AND excluded.import_date < skus.import_date
        THEN excluded.import_date
        WHEN skus.import_date IS NOT NULL THEN skus.import_date
        ELSE excluded.import_date
      END,
      gender = excluded.gender,
      season = excluded.season,
      category = excluded.category,
      brand = excluded.brand,
      _importId = COALESCE(skus._importId, excluded._importId)
  `)
  const tx = db.transaction((items) => {
    for (const s of items) {
      const importDate = s.import_date instanceof Date ? s.import_date.toISOString()
        : (typeof s.import_date === 'string' ? s.import_date : null)
      const rowId = s.id || uid()
      const qtyN = Math.max(0, Math.round(Number(s.quantity) || 0))
      const soldN = Math.max(0, Math.round(Number(s.sold_quantity) || 0))
      // Never persist sold > received in catalog (fixes negative "on hand" and tiles); under-reported qty is raised to match sales.
      const quantitySaved = Math.max(qtyN, soldN)
      const p = s.price_sold
      const priceSoldParam = p == null || p === '' ? null : (() => { const n = Number(p); return Number.isNaN(n) ? null : n })()
      const categoryNorm = normalizeCategory(s.category ?? '')
      insert.run({
        id: rowId, barcode: normalizeBarcodeValue(s.barcode ?? '') || '', sku: s.sku ?? '', product_name: s.product_name ?? '',
        size: s.size ?? '', price_sold: priceSoldParam, price_tag: s.price_tag ?? 0,
        cost_price: s.cost_price ?? 0,
        quantity: quantitySaved, sold_quantity: soldN, import_date: importDate,
        gender: s.gender ?? '', season: s.season ?? '', category: categoryNorm, brand: s.brand ?? '',
        _importId: s._importId ?? null,
      })
      if (s._importId) {
        const qty = qtyN
        const unitCost = Number(s.cost_price) || 0
        insertImportLine.run({
          id: uid(),
          import_id: s._importId,
          sku: s.sku ?? '',
          size: s.size ?? '',
          barcode: normalizeBarcodeValue(s.barcode ?? '') || '',
          product_name: s.product_name ?? '',
          gender: s.gender ?? '',
          unit_cost: unitCost,
          line_investment: roundMoney(qty * unitCost),
          price_tag: s.price_tag ?? 0,
          category: categoryNorm,
          brand: s.brand ?? '',
          season: s.season ?? '',
          quantity_added: qty,
          imported_at: importDate || new Date().toISOString(),
        })
      }
    }
  })
  tx(skusArray)
  if (skusArray.some((s) => s?._importId)) {
    const seasonRollover = maybeStartSeasonFromIntake(skusArray)
    const batchKeys = new Set(
      skusArray
        .filter((s) => s?._importId)
        .map((s) => catalogLedgerKey(s.sku, s.size)),
    )
    syncSkuCatalogFromLedgers({ onlyKeys: batchKeys })
    rebuildInventoryEventsForKeys(batchKeys, `scoped intake import (${skusArray.length} input row(s))`)
    return { count: skusArray.length, seasonRollover }
  }
  return skusArray.length
}

function affectedImportLedgerKeys(importId) {
  const keys = new Map()
  const add = (row) => {
    const sku = String(row?.sku ?? '').trim()
    if (!sku) return
    const size = normalizedEventSizeKey(row?.size)
    keys.set(catalogLedgerKey(sku, size), { sku, size })
  }
  db.prepare('SELECT sku, size FROM import_lines WHERE import_id = ?').all(importId).forEach(add)
  db.prepare('SELECT sku, size FROM skus WHERE _importId = ?').all(importId).forEach(add)
  db.prepare('SELECT sku, size FROM sales_events WHERE import_id = ?').all(importId).forEach(add)
  return [...keys.values()]
}

function reconcileSalesEventsForImportDeletion(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return { salesEventsDeleted: 0, salesEventsAdjusted: 0 }
  }
  const remainingQtyStmt = db.prepare(`
    SELECT COALESCE(SUM(quantity_added), 0) AS qty
    FROM import_lines
    WHERE sku = @sku
      AND TRIM(COALESCE(size, '')) = @size
  `)
  const netSoldStmt = db.prepare(`
    SELECT COALESCE(SUM(units_sold), 0) AS sold
    FROM sales_events
    WHERE sku = @sku
      AND TRIM(COALESCE(size, '')) = @size
  `)
  const saleRowsStmt = db.prepare(`
    SELECT rowid, units_sold, price_sold, revenue
    FROM sales_events
    WHERE sku = @sku
      AND TRIM(COALESCE(size, '')) = @size
      AND units_sold > 0
    ORDER BY event_date DESC, created_at DESC, rowid DESC
  `)
  const deleteEventStmt = db.prepare('DELETE FROM sales_events WHERE rowid = ?')
  const updateEventStmt = db.prepare(`
    UPDATE sales_events
    SET units_sold = @units_sold,
        revenue = @revenue,
        price_sold = @price_sold
    WHERE rowid = @rowid
  `)

  let salesEventsDeleted = 0
  let salesEventsAdjusted = 0
  for (const key of keys) {
    const params = { sku: key.sku, size: key.size }
    const remainingQty = Math.max(0, Math.round(Number(remainingQtyStmt.get(params)?.qty) || 0))
    const netSold = Math.round(Number(netSoldStmt.get(params)?.sold) || 0)
    let excess = netSold - remainingQty
    if (excess <= 0) continue

    for (const row of saleRowsStmt.all(params)) {
      if (excess <= 0) break
      const units = Math.max(0, Math.round(Number(row.units_sold) || 0))
      if (units <= 0) continue
      if (units <= excess) {
        salesEventsDeleted += deleteEventStmt.run(row.rowid).changes
        excess -= units
        continue
      }
      const nextUnits = units - excess
      const unitRevenue = units !== 0 ? (Number(row.revenue) || 0) / units : Number(row.price_sold) || 0
      const nextRevenue = roundMoney(unitRevenue * nextUnits)
      const nextPrice = nextUnits !== 0 ? roundMoney(nextRevenue / nextUnits) : 0
      salesEventsAdjusted += updateEventStmt.run({
        rowid: row.rowid,
        units_sold: nextUnits,
        revenue: nextRevenue,
        price_sold: nextPrice,
      }).changes
      excess = 0
    }
  }
  return { salesEventsDeleted, salesEventsAdjusted }
}

/**
 * Remove an import batch from all ledgers/projections. Sales events directly tied
 * to the deleted import are removed; remaining sales for affected SKU sizes are
 * trimmed only when remaining intake can no longer cover them.
 * @returns {{ skuRowsDeleted: number, fullyRemovedSkuCodes: string[], salesEventsDeleted: number, salesEventsAdjusted: number }}
 */
function deleteSkusByImportCore(importId) {
  const affectedKeys = affectedImportLedgerKeys(importId)
  const affectedKeySet = new Set(affectedKeys.map((key) => catalogLedgerKey(key.sku, key.size)))
  const skuCodes = [...new Set(affectedKeys.map((r) => r.sku).filter(Boolean))]

  const directlyDeletedSales = db.prepare('DELETE FROM sales_events WHERE import_id = ?').run(importId).changes
  db.prepare('DELETE FROM import_lines WHERE import_id = ?').run(importId)
  const skuRowsDeleted = db.prepare('DELETE FROM skus WHERE _importId = ?').run(importId).changes
  const reconciled = reconcileSalesEventsForImportDeletion(affectedKeys)
  syncSkuCatalogFromLedgers()

  const fullyRemovedSkuCodes = []
  for (const code of skuCodes) {
    const n = db.prepare('SELECT COUNT(*) AS c FROM skus WHERE sku = ?').get(code)?.c ?? 0
    if (n === 0) {
      fullyRemovedSkuCodes.push(code)
      db.prepare('DELETE FROM assignments WHERE skuCode = ?').run(code)
    }
  }
  rebuildInventoryEventsForKeys(affectedKeySet, `scoped import deletion (${importId})`)
  return {
    skuRowsDeleted,
    fullyRemovedSkuCodes,
    salesEventsDeleted: directlyDeletedSales + reconciled.salesEventsDeleted,
    salesEventsAdjusted: reconciled.salesEventsAdjusted,
  }
}

export function deleteSkusByImport(importId) {
  return db.transaction(() => deleteSkusByImportCore(importId))()
}

// ── Recycle bin (soft delete) ──────────────────────────────────────────────
// Window after which binned SKUs are permanently purged.
const BIN_RETENTION_DAYS = 30

/**
 * Soft-delete every row that shares this product code (all sizes go to the Bin together).
 * No math/data is altered — getAllSkus() filters by deleted_at IS NULL so binned items
 * disappear from every analytics surface but can be restored intact.
 * @param {string} code
 * @param {{ id?: string|number, name?: string }|null} actor
 * @returns {{ skuRowsUpdated: number }}
 */
export function softDeleteSkuByCode(code, actor = null) {
  const skuCode = String(code || '').trim()
  if (!skuCode) return { skuRowsUpdated: 0 }
  const now = new Date().toISOString()
  const by = actor ? String(actor.name || actor.id || '').trim() || null : null
  const result = db
    .prepare('UPDATE skus SET deleted_at = ?, deleted_by = ? WHERE sku = ? AND deleted_at IS NULL')
    .run(now, by, skuCode)
  return { skuRowsUpdated: result.changes }
}

/**
 * Restore every binned row for this product code.
 * @param {string} code
 * @returns {{ skuRowsUpdated: number }}
 */
export function restoreSkuByCode(code) {
  const skuCode = String(code || '').trim()
  if (!skuCode) return { skuRowsUpdated: 0 }
  const result = db
    .prepare('UPDATE skus SET deleted_at = NULL, deleted_by = NULL WHERE sku = ? AND deleted_at IS NOT NULL')
    .run(skuCode)
  return { skuRowsUpdated: result.changes }
}

/**
 * Aggregate binned product codes for the Recycle Bin page.
 * Each entry collapses size rows into one product row with sizes + units + days-left countdown.
 * @returns {Array<{
 *   sku: string, product_name: string, brand: string, category: string,
 *   gender: string, sizes: string[], totalQuantity: number,
 *   deletedAt: string, deletedBy: string|null,
 *   ageDays: number, daysLeft: number, retentionDays: number,
 * }>}
 */
export function listBinnedSkus() {
  const rows = db
    .prepare(
      `SELECT sku, product_name, brand, category, gender, size, quantity, deleted_at, deleted_by
       FROM skus
       WHERE deleted_at IS NOT NULL`,
    )
    .all()
  const grouped = new Map()
  for (const r of rows) {
    const key = r.sku
    if (!grouped.has(key)) {
      grouped.set(key, {
        sku: r.sku,
        product_name: r.product_name || '',
        brand: r.brand || '',
        category: r.category || '',
        gender: r.gender || '',
        sizes: new Set(),
        totalQuantity: 0,
        deletedAt: r.deleted_at,
        deletedBy: r.deleted_by || null,
      })
    }
    const g = grouped.get(key)
    if (r.size) g.sizes.add(String(r.size))
    g.totalQuantity += Math.max(0, Number(r.quantity) || 0)
    if (r.deleted_at && (!g.deletedAt || r.deleted_at > g.deletedAt)) g.deletedAt = r.deleted_at
    if (!g.product_name && r.product_name) g.product_name = r.product_name
    if (!g.brand && r.brand) g.brand = r.brand
    if (!g.category && r.category) g.category = r.category
    if (!g.gender && r.gender) g.gender = r.gender
  }
  const now = Date.now()
  return [...grouped.values()].map((g) => {
    const deletedMs = Date.parse(g.deletedAt)
    const ageMs = Number.isFinite(deletedMs) ? Math.max(0, now - deletedMs) : 0
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
    const daysLeft = Math.max(0, BIN_RETENTION_DAYS - ageDays)
    return {
      sku: g.sku,
      product_name: g.product_name,
      brand: g.brand,
      category: g.category,
      gender: g.gender,
      sizes: [...g.sizes],
      totalQuantity: g.totalQuantity,
      deletedAt: g.deletedAt,
      deletedBy: g.deletedBy,
      ageDays,
      daysLeft,
      retentionDays: BIN_RETENTION_DAYS,
    }
  }).sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
}

/**
 * Hard-delete every row for a product code, mirroring the cascade in deleteSkusByImportCore
 * (skus + import_lines, then assignments + sales_events when the code is fully gone).
 * Photos are intentionally kept.
 * @param {string} code
 * @returns {{ skuRowsDeleted: number, fullyRemoved: boolean }}
 */
function purgeSkuByCodeCore(code) {
  const skuCode = String(code || '').trim()
  if (!skuCode) return { skuRowsDeleted: 0, fullyRemoved: false }
  db.prepare('DELETE FROM import_lines WHERE sku = ?').run(skuCode)
  const skuRowsDeleted = db.prepare('DELETE FROM skus WHERE sku = ?').run(skuCode).changes
  const fullyRemoved = skuRowsDeleted > 0
  if (fullyRemoved) {
    db.prepare('DELETE FROM assignments WHERE skuCode = ?').run(skuCode)
    db.prepare('DELETE FROM sales_events WHERE sku = ?').run(skuCode)
  }
  return { skuRowsDeleted, fullyRemoved }
}

export function purgeSkuByCode(code) {
  return db.transaction(() => {
    const result = purgeSkuByCodeCore(code)
    if (result.fullyRemoved) deleteInventoryEventsForSkuCodes([code], `sku purge (${code})`)
    return result
  })()
}

/**
 * Hard-delete any binned SKU whose deleted_at is older than BIN_RETENTION_DAYS.
 * Called on server boot and on each /api/skus/bin and /api/skus poll.
 * @returns {{ purgedCodes: string[] }}
 */
export function purgeExpiredBinnedSkus() {
  const cutoffMs = Date.now() - BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000
  const cutoffIso = new Date(cutoffMs).toISOString()
  const expired = db
    .prepare('SELECT DISTINCT sku FROM skus WHERE deleted_at IS NOT NULL AND deleted_at <= ?')
    .all(cutoffIso)
  if (!expired.length) return { purgedCodes: [] }
  const purgedCodes = []
  db.transaction(() => {
    for (const row of expired) {
      const r = purgeSkuByCodeCore(row.sku)
      if (r.fullyRemoved) purgedCodes.push(row.sku)
    }
    if (purgedCodes.length) deleteInventoryEventsForSkuCodes(purgedCodes, `expired bin purge (${purgedCodes.length} sku(s))`)
  })()
  return { purgedCodes }
}

// ── Import history ──────────────────────────────────────────────────────────

export function getImportHistory() {
  return db.prepare('SELECT * FROM import_history ORDER BY imported_at DESC').all().map((r) => ({
    id: r.id,
    filename: r.filename,
    date: r.imported_at,
    count: r.sku_count,
    totalUnits: r.total_units != null ? Number(r.total_units) : null,
    importedByUserId: r.imported_by_user_id ?? null,
    importedByName: r.imported_by_name ?? null,
    csvFileName: r.csv_file_name ?? null,
    csvFilePath: r.csv_file_path ?? null,
    csvFileSize: r.csv_file_size != null ? Number(r.csv_file_size) : null,
  }))
}

export function insertImportRecord(record) {
  const id = record.id || uid()
  const date = record.date || record.imported_at || new Date().toISOString()
  const count = record.count ?? record.sku_count ?? 0
  const totalUnits = Number(record.totalUnits ?? record.total_units) || 0
  const byId = record.imported_by_user_id ?? record.importedByUserId ?? null
  const byName = record.imported_by_name ?? record.importedByName ?? null
  const csvFileName = record.csv_file_name ?? record.csvFileName ?? null
  const csvFilePath = record.csv_file_path ?? record.csvFilePath ?? null
  const csvFileSize = record.csv_file_size ?? record.csvFileSize ?? null
  db.prepare(`
    INSERT INTO import_history (
      id, filename, imported_at, sku_count, total_units,
      imported_by_user_id, imported_by_name, csv_file_name, csv_file_path, csv_file_size
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, record.filename ?? '', date, count, totalUnits, byId, byName, csvFileName, csvFilePath, csvFileSize)
  return {
    id,
    filename: record.filename,
    date,
    count,
    totalUnits,
    importedByUserId: byId,
    importedByName: byName,
    csvFileName,
    csvFilePath,
    csvFileSize: csvFileSize != null ? Number(csvFileSize) : null,
  }
}

export function attachImportCsvFile(importId, fileMeta) {
  const r = db.prepare(`
    UPDATE import_history
    SET csv_file_name = ?, csv_file_path = ?, csv_file_size = ?
    WHERE id = ?
  `).run(
    fileMeta?.fileName ?? null,
    fileMeta?.filePath ?? null,
    fileMeta?.fileSize ?? null,
    importId,
  )
  return r.changes
}

export function getImportCsvFileMeta(importId) {
  if (!importId) return null
  return db.prepare(`
    SELECT id, filename, csv_file_name, csv_file_path, csv_file_size
    FROM import_history
    WHERE id = ?
  `).get(importId) ?? null
}

export function deleteImportRecord(importId) {
  return db.transaction(() => {
    const result = deleteSkusByImportCore(importId)
    const importHistoryDeleted = db.prepare('DELETE FROM import_history WHERE id = ?').run(importId).changes
    return { ...result, importHistoryDeleted }
  })()
}

// ── Import lines / product reports ──────────────────────────────────────────

/**
 * Deduplicate import_lines: a second batch can append another row for the same
 * (sku, size) and blind SUM(quantity_added) over-counts. Intake uses the first
 * line per (sku, size) by `imported_at` then `id` (earliest = original intake).
 */
const sqlIntakeLineRankedCte = `
  il_first AS (
    SELECT
      il.sku, il.size, il.barcode, il.product_name, il.quantity_added, il.gender,
      il.unit_cost, il.line_investment, il.price_tag, il.category, il.brand, il.season,
      il.imported_at, il.import_id, il.id,
      ROW_NUMBER() OVER (
        PARTITION BY il.sku, TRIM(COALESCE(il.size, ''))
        ORDER BY il.imported_at ASC, il.id ASC
      ) AS _rn
    FROM import_lines il
  )`

function backfillImportLineCostsFromCatalog() {
  const fillExactSize = db.prepare(`
    UPDATE import_lines
    SET
      unit_cost = (
        SELECT s.cost_price
        FROM skus s
        WHERE s.sku = import_lines.sku
          AND TRIM(COALESCE(s.size, '')) = TRIM(COALESCE(import_lines.size, ''))
          AND COALESCE(s.cost_price, 0) > 0
        LIMIT 1
      ),
      line_investment = ROUND(quantity_added * (
        SELECT s.cost_price
        FROM skus s
        WHERE s.sku = import_lines.sku
          AND TRIM(COALESCE(s.size, '')) = TRIM(COALESCE(import_lines.size, ''))
          AND COALESCE(s.cost_price, 0) > 0
        LIMIT 1
      ), 2)
    WHERE (unit_cost IS NULL OR line_investment IS NULL)
      AND EXISTS (
        SELECT 1
        FROM skus s
        WHERE s.sku = import_lines.sku
          AND TRIM(COALESCE(s.size, '')) = TRIM(COALESCE(import_lines.size, ''))
          AND COALESCE(s.cost_price, 0) > 0
      )
  `).run().changes

  const fillSkuFallback = db.prepare(`
    UPDATE import_lines
    SET
      unit_cost = (
        SELECT MAX(s.cost_price)
        FROM skus s
        WHERE s.sku = import_lines.sku
          AND COALESCE(s.cost_price, 0) > 0
      ),
      line_investment = ROUND(quantity_added * (
        SELECT MAX(s.cost_price)
        FROM skus s
        WHERE s.sku = import_lines.sku
          AND COALESCE(s.cost_price, 0) > 0
      ), 2)
    WHERE (unit_cost IS NULL OR line_investment IS NULL)
      AND EXISTS (
        SELECT 1
        FROM skus s
        WHERE s.sku = import_lines.sku
          AND COALESCE(s.cost_price, 0) > 0
      )
  `).run().changes

  const fillMetadata = db.prepare(`
    UPDATE import_lines
    SET
      price_tag = COALESCE(price_tag, (
        SELECT MAX(s.price_tag) FROM skus s WHERE s.sku = import_lines.sku
      )),
      category = COALESCE(NULLIF(category, ''), (
        SELECT MAX(NULLIF(TRIM(s.category), '')) FROM skus s WHERE s.sku = import_lines.sku
      )),
      brand = COALESCE(NULLIF(brand, ''), (
        SELECT MAX(NULLIF(TRIM(s.brand), '')) FROM skus s WHERE s.sku = import_lines.sku
      )),
      season = COALESCE(NULLIF(season, ''), (
        SELECT MAX(NULLIF(TRIM(s.season), '')) FROM skus s WHERE s.sku = import_lines.sku
      ))
    WHERE EXISTS (SELECT 1 FROM skus s WHERE s.sku = import_lines.sku)
  `).run().changes

  return { fillExactSize, fillSkuFallback, fillMetadata }
}

function backfillImportLineCostsOnStartup() {
  try {
    const { fillExactSize, fillSkuFallback, fillMetadata } = backfillImportLineCostsFromCatalog()
    if (fillExactSize > 0 || fillSkuFallback > 0 || fillMetadata > 0) {
      console.log(`[db] Backfilled import_lines cost ledger (${fillExactSize} exact row(s), ${fillSkuFallback} sku-fallback row(s), ${fillMetadata} metadata row(s))`)
    }
  } catch (e) {
    console.warn('[db] import_lines cost backfill failed:', e.message)
  }
}

function rebuildInventoryEventsOnStartup() {
  try {
    rebuildInventoryEvents()
  } catch (e) {
    console.warn('[db] rebuild inventory_events failed:', e)
  }
}

function repairReportingLineTotalsOnStartup() {
  try {
    if (!db.prepare('SELECT COUNT(*) AS c FROM sales_events').get().c) return
    const { fixEvents, fixSkuAvg } = repairReportingLineTotalRevenue()
    if (fixEvents > 0 || fixSkuAvg > 0) {
      console.log(
        `[db] Repaired reporting revenue math (${fixEvents} sales_event row(s), ${fixSkuAvg} sku average price row(s))`,
      )
    }
  } catch (e) {
    console.warn('[db] repair reporting line-total revenue failed:', e)
  }
}

/** Fold inconsistent category spellings (FOOTWEAR/FTW, APP, ...) into canonical names. */
function normalizeStoredCategories() {
  let changed = 0
  for (const table of ['skus', 'import_lines']) {
    const rows = db.prepare(`SELECT DISTINCT category FROM ${table}`).all()
    const upd = db.prepare(`UPDATE ${table} SET category = ? WHERE category = ?`)
    const tx = db.transaction(() => {
      for (const r of rows) {
        const orig = r.category
        if (orig == null) continue
        const canon = normalizeCategory(orig)
        if (canon && canon !== orig) {
          changed += upd.run(canon, orig).changes
        }
      }
    })
    tx()
  }
  return changed
}

function normalizeStoredCategoriesOnStartup() {
  try {
    const changed = normalizeStoredCategories()
    if (changed > 0) {
      console.log(`[db] Normalized categories (${changed} row(s))`)
    }
  } catch (e) {
    console.warn('[db] normalize categories failed:', e)
  }
}

/** Map sku code -> total quantity imported from successful import history. */
export function getLifetimeImportedBySku() {
  const rows = db.prepare(`
    SELECT il.sku, COALESCE(SUM(il.quantity_added), 0) AS total
    FROM import_lines il
    WHERE il.import_id IN (SELECT id FROM import_history)
    GROUP BY il.sku
  `).all()
  const map = {}
  for (const r of rows) map[r.sku] = r.total
  return map
}

/** Map sku code -> imported units, immutable ledger investment, and missing-cost audit. */
export function getLifetimeImportCostBySku() {
  const rows = db.prepare(`
    SELECT
      il.sku,
      COALESCE(SUM(il.quantity_added), 0) AS units_imported,
      COALESCE(SUM(COALESCE(il.line_investment, il.quantity_added * COALESCE(il.unit_cost, 0), 0)), 0) AS import_investment,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(il.line_investment, il.quantity_added * COALESCE(il.unit_cost, 0), 0) <= 0
            AND COALESCE(il.quantity_added, 0) > 0
          THEN il.quantity_added
          ELSE 0
        END
      ), 0) AS missing_cost_units
    FROM import_lines il
    WHERE il.import_id IN (SELECT id FROM import_history)
    GROUP BY il.sku
  `).all()
  const map = {}
  for (const r of rows) {
    const units = Number(r.units_imported) || 0
    const investment = roundMoney(r.import_investment)
    map[r.sku] = {
      units_imported: units,
      import_investment: investment,
      avg_unit_cost: units > 0 ? roundMoney(investment / units) : 0,
      missing_cost_units: Number(r.missing_cost_units) || 0,
    }
  }
  return map
}

export function getImportCostAudit(options = {}) {
  const importId = options.importId ? String(options.importId) : ''
  const expectedTotal = options.expectedTotal == null || options.expectedTotal === ''
    ? null
    : roundMoney(options.expectedTotal)
  const sourceSql = importId
    ? 'SELECT * FROM import_lines WHERE import_id = ?'
    : 'SELECT * FROM import_lines WHERE import_id IN (SELECT id FROM import_history)'
  const args = importId ? [importId] : []
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS line_rows,
      COALESCE(SUM(quantity_added), 0) AS units_imported,
      COALESCE(SUM(COALESCE(line_investment, quantity_added * COALESCE(unit_cost, 0), 0)), 0) AS ledger_investment,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(line_investment, quantity_added * COALESCE(unit_cost, 0), 0) <= 0
            AND COALESCE(quantity_added, 0) > 0
          THEN quantity_added
          ELSE 0
        END
      ), 0) AS missing_cost_units,
      SUM(CASE
        WHEN COALESCE(line_investment, quantity_added * COALESCE(unit_cost, 0), 0) <= 0
          AND COALESCE(quantity_added, 0) > 0
        THEN 1
        ELSE 0
      END) AS missing_cost_rows
    FROM (${sourceSql}) src
  `).get(...args)
  const missingRows = db.prepare(`
    SELECT import_id, sku, size, product_name, quantity_added, imported_at
    FROM (${sourceSql}) src
    WHERE COALESCE(line_investment, quantity_added * COALESCE(unit_cost, 0), 0) <= 0
      AND COALESCE(quantity_added, 0) > 0
    ORDER BY import_id, sku, size
    LIMIT 200
  `).all(...args)
  const ledgerInvestment = roundMoney(totals?.ledger_investment)
  return {
    importId: importId || null,
    expectedTotal,
    lineRows: Number(totals?.line_rows) || 0,
    unitsImported: Number(totals?.units_imported) || 0,
    ledgerInvestment,
    missingCostRows: Number(totals?.missing_cost_rows) || 0,
    missingCostUnits: Number(totals?.missing_cost_units) || 0,
    difference: expectedTotal == null ? null : roundMoney(ledgerInvestment - expectedTotal),
    missingRows,
  }
}

/**
 * Distinct non-empty `brand` values from `skus` (CSV import and upserts), for filters.
 * @returns {string[]}
 */
export function getDistinctSkuBrands() {
  const rows = db
    .prepare(
      `
    SELECT DISTINCT TRIM(brand) AS b
    FROM skus
    WHERE TRIM(COALESCE(brand, '')) != ''
      AND deleted_at IS NULL
    ORDER BY b COLLATE NOCASE
  `,
    )
    .all()
  return rows.map((r) => r.b).filter(Boolean)
}

/**
 * Product / SKU substring report: aggregated rows per SKU code + timeline + totals.
 * @param {string} q — trimmed search; empty returns structure for "all" from client overview
 */
export function getProductNameReport(searchQuery = '', options = {}) {
  const query = String(searchQuery || '').trim()
  const needle = query.toLowerCase()
  const seasonFilter = normalizeSeasonInput(options.season)
  const seasonActive = seasonFilter && seasonFilter.toLowerCase() !== 'all'
  const seasonClause = seasonActive ? " AND TRIM(COALESCE(season, '')) = ?" : ''
  const seasonArgs = seasonActive ? [seasonFilter] : []
  const skuRows = needle
    ? db.prepare(`
        SELECT DISTINCT sku FROM skus
        WHERE deleted_at IS NULL
          AND (LOWER(COALESCE(product_name, '')) LIKE '%' || ? || '%'
            OR LOWER(COALESCE(sku, '')) LIKE '%' || ? || '%')${seasonClause}
      `).all(needle, needle, ...seasonArgs)
    : db.prepare(`SELECT DISTINCT sku FROM skus WHERE deleted_at IS NULL${seasonClause}`).all(...seasonArgs)
  const skuCodes = skuRows.map((r) => r.sku).filter(Boolean)
  const emptyTotals = { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalProfit: 0, avgRoi: 0, totalInvestment: 0 }
  const emptyGender = () => ({
    stock: 0,
    remaining: 0,
    sold: 0,
    cogs: 0,
    totalRevenue: 0,
    totalInvestment: 0,
    imported: 0,
  })
  if (!skuCodes.length) {
    return {
      query,
      rows: [],
      totals: emptyTotals,
      byGender: {
        Men: emptyGender(),
        Women: emptyGender(),
        Kids: emptyGender(),
        Unisex: emptyGender(),
        Unspecified: emptyGender(),
      },
      timeline: [],
    }
  }

  const placeholders = skuCodes.map(() => '?').join(',')
  const shipmentDateAgg = db.prepare(`
    SELECT
      il.sku,
      MIN(il.imported_at) AS first_import_date,
      MAX(il.imported_at) AS last_import_date
    FROM import_lines il
    WHERE il.import_id IN (SELECT id FROM import_history)
      AND il.sku IN (${placeholders})
      AND COALESCE(il.quantity_added, 0) > 0
    GROUP BY il.sku
  `).all(...skuCodes)
  const shipmentDatesBySku = Object.fromEntries(
    shipmentDateAgg.map((r) => [r.sku, r]),
  )

  const metaAgg = db.prepare(`
    SELECT s.sku,
      MAX(s.product_name) AS product_name,
      MAX(
        CASE WHEN TRIM(COALESCE(s.brand, '')) != '' THEN TRIM(s.brand) END
      ) AS brand,
      MAX(
        CASE WHEN TRIM(COALESCE(s.category, '')) != '' THEN TRIM(s.category) END
      ) AS category,
      MAX(s.gender) AS gender,
      MIN(s.import_date) AS first_import_date_fallback,
      MAX(s.last_import_date) AS last_import_date_fallback,
      MAX(s.season) AS season,
      MAX(s.sale_active) AS sale_active,
      MAX(s.sale_percent) AS sale_percent,
      GROUP_CONCAT(DISTINCT s.size) AS sizes
    FROM skus s WHERE s.sku IN (${placeholders}) AND s.deleted_at IS NULL
    GROUP BY s.sku
  `).all(...skuCodes)

  const rawLineRows = db.prepare(`SELECT s.sku, s.gender, s.quantity FROM skus s WHERE s.sku IN (${placeholders}) AND s.deleted_at IS NULL`).all(...skuCodes)
  const dominantBySku = dominantGenderBySku(skuCodes, rawLineRows)

  // Intake: all successful import_lines rows. Reorders of the same SKU/size are real added cost.
  const intakeRows = db.prepare(`
    SELECT
      il.sku,
      COALESCE(SUM(il.quantity_added), 0) AS units_imported,
      COALESCE(SUM(COALESCE(il.line_investment, il.quantity_added * COALESCE(il.unit_cost, 0), 0)), 0) AS import_investment,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(il.line_investment, il.quantity_added * COALESCE(il.unit_cost, 0), 0) <= 0
            AND COALESCE(il.quantity_added, 0) > 0
          THEN il.quantity_added
          ELSE 0
        END
      ), 0) AS missing_cost_units
    FROM import_lines il
    WHERE il.import_id IN (SELECT id FROM import_history)
      AND il.sku IN (${placeholders})
    GROUP BY il.sku
  `).all(...skuCodes)
  const intakeBySku = Object.fromEntries(intakeRows.map((x) => [x.sku, x]))

  const onHandRows = db.prepare(`
    SELECT sku, COALESCE(SUM(signed_quantity), 0) AS on_hand
    FROM inventory_events
    WHERE sku IN (${placeholders})
    GROUP BY sku
  `).all(...skuCodes)
  const onHandBySku = Object.fromEntries(onHandRows.map((x) => [x.sku, Number(x.on_hand) || 0]))

  const salesAggRows = db.prepare(`
    SELECT
      e.sku,
      COALESCE(SUM(e.units_sold), 0) AS sold_quantity,
      COALESCE(SUM(e.revenue), 0) AS total_revenue,
      COALESCE(SUM(
        e.units_sold * COALESCE(
          (SELECT s.cost_price FROM skus s
            WHERE s.sku = e.sku
              AND TRIM(COALESCE(s.size, '')) = TRIM(COALESCE(e.size, ''))
              AND COALESCE(s.cost_price, 0) > 0
            LIMIT 1
          ),
          (SELECT MAX(s2.cost_price) FROM skus s2
            WHERE s2.sku = e.sku AND COALESCE(s2.cost_price, 0) > 0
          ),
          0
        )
      ), 0) AS cogs
    FROM sales_events e
    WHERE e.sku IN (${placeholders})
    GROUP BY e.sku
  `).all(...skuCodes)
  const salesAggBySku = Object.fromEntries(salesAggRows.map((x) => [x.sku, x]))

  const rows = metaAgg.map((r) => {
    const salesAgg = salesAggBySku[r.sku]
    const cogs = Number(salesAgg?.cogs) || 0
    const totalRevenue = Number(salesAgg?.total_revenue) || 0
    const profit = totalRevenue - cogs
    const roi = cogs > 0 ? (profit / cogs) * 100 : 0
    const soldQty = Number(salesAgg?.sold_quantity) || 0
    const fromIntake = intakeBySku[r.sku]
    const unitsImported = fromIntake ? Number(fromIntake.units_imported) || 0 : 0
    const invImported = fromIntake ? Number(fromIntake.import_investment) || 0 : 0
    const missingCostUnits = fromIntake ? Number(fromIntake.missing_cost_units) || 0 : 0
    const displayQty = unitsImported
    const displayInvestment = invImported
    const onHand = Number(onHandBySku[r.sku]) || 0
    const costPrice =
      displayQty > 0 && displayInvestment > 0
        ? displayInvestment / displayQty
        : 0
    const displayGender = dominantBySku.has(r.sku) ? dominantBySku.get(r.sku) : r.gender
    const shipDates = shipmentDatesBySku[r.sku]
    const firstImportDate = shipDates?.first_import_date || r.first_import_date_fallback
    const lastImportDate = shipDates?.last_import_date || r.last_import_date_fallback || firstImportDate
    return {
      sku: r.sku,
      product_name: r.product_name,
      brand: (r.brand && String(r.brand).trim()) || '—',
      category: r.category,
      gender: displayGender,
      genderBucket: genderBucketKey(displayGender),
      season: r.season || '',
      cost_price: costPrice,
      stock: displayQty,
      remaining: onHand,
      sold: soldQty,
      totalInvestment: displayInvestment,
      missingCostUnits,
      first_import_date: firstImportDate,
      last_import_date: lastImportDate,
      sizes: r.sizes,
      cogs,
      totalRevenue,
      profit,
      roi,
      avgTicket: soldQty > 0 ? totalRevenue / soldQty : 0,
      sale_active: r.sale_active ? 1 : 0,
      sale_percent: r.sale_percent ?? null,
    }
  })

  const byGender = {
    Men: emptyGender(),
    Women: emptyGender(),
    Kids: emptyGender(),
    Unisex: emptyGender(),
    Unspecified: emptyGender(),
  }
  for (const row of rows) {
    const key = row.genderBucket
    if (!byGender[key]) continue
    byGender[key].stock += row.stock
    byGender[key].remaining += row.remaining
    byGender[key].sold += row.sold
    byGender[key].cogs += row.cogs
    byGender[key].totalRevenue += row.totalRevenue
    byGender[key].totalInvestment += row.totalInvestment
    byGender[key].imported += row.stock
  }

  let stock = 0
  let remaining = 0
  let sold = 0
  let cogs = 0
  let totalRevenue = 0
  let totalInvestment = 0
  for (const row of rows) {
    stock += row.stock
    remaining += row.remaining
    sold += row.sold
    cogs += row.cogs
    totalRevenue += row.totalRevenue
    totalInvestment += row.totalInvestment
  }

  const timelineRows = db.prepare(`
    SELECT il.import_id,
      COALESCE(SUM(il.quantity_added), 0) AS units,
      MIN(il.imported_at) AS imported_at
    FROM import_lines il
    WHERE il.import_id IN (SELECT id FROM import_history)
      AND il.sku IN (${placeholders})
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
    query,
    rows,
    totals: { stock, remaining, sold, cogs, totalRevenue, totalProfit, avgRoi, totalInvestment },
    byGender,
    timeline,
  }
}

// ── Product type labels ─────────────────────────────────────────────────────

const PRODUCT_TYPE_KEYS = new Set([
  'tshirt',
  'shorts',
  'shoe',
  'skirt',
  'pants',
  'hoodie',
  'jacket',
  'bag',
  'dress',
  'swimwear',
  'other',
])

export function normalizeProductType(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (!raw) return 'other'
  if (raw === 'tee' || raw === 'tshirt' || raw === 'shirt' || raw === 'top') return 'tshirt'
  if (raw === 'short' || raw === 'shorts') return 'shorts'
  if (raw === 'shoes' || raw === 'shoe' || raw === 'sneaker' || raw === 'slides' || raw === 'slide' || raw === 'sandal') return 'shoe'
  if (raw === 'skirt') return 'skirt'
  if (raw === 'pant' || raw === 'pants' || raw === 'trouser' || raw === 'trousers' || raw === 'jogger' || raw === 'leggings') return 'pants'
  if (raw === 'hoodie' || raw === 'sweater' || raw === 'sweatshirt') return 'hoodie'
  if (raw === 'jacket' || raw === 'coat' || raw === 'outerwear') return 'jacket'
  if (raw === 'bag' || raw === 'backpack') return 'bag'
  if (raw === 'dress') return 'dress'
  if (raw === 'swimwear' || raw === 'swimshorts' || raw === 'swimsuit') return 'swimwear'
  return PRODUCT_TYPE_KEYS.has(raw) ? raw : 'other'
}

function toProductTypeLabel(row) {
  if (!row) return null
  return {
    sku: row.sku,
    product_type: normalizeProductType(row.product_type),
    source: row.source || '',
    confidence: Number(row.confidence) || 0,
    photo_signature: row.photo_signature || '',
    updated_at: row.updated_at || '',
  }
}

export function getProductTypeLabels() {
  const rows = db.prepare('SELECT * FROM product_type_labels ORDER BY sku COLLATE NOCASE').all()
  const out = {}
  for (const row of rows) out[row.sku] = toProductTypeLabel(row)
  return out
}

export function getProductTypeLabel(sku) {
  const code = String(sku || '').trim()
  if (!code) return null
  return toProductTypeLabel(db.prepare('SELECT * FROM product_type_labels WHERE sku = ?').get(code))
}

export function upsertProductTypeLabel(label) {
  const sku = String(label?.sku || '').trim()
  if (!sku) return null
  const row = {
    sku,
    product_type: normalizeProductType(label.product_type),
    source: String(label.source || 'ai'),
    confidence: Number(label.confidence) || 0,
    photo_signature: String(label.photo_signature || ''),
    updated_at: label.updated_at || new Date().toISOString(),
  }
  db.prepare(`
    INSERT INTO product_type_labels (sku, product_type, source, confidence, photo_signature, updated_at)
    VALUES (@sku, @product_type, @source, @confidence, @photo_signature, @updated_at)
    ON CONFLICT(sku) DO UPDATE SET
      product_type = excluded.product_type,
      source = excluded.source,
      confidence = excluded.confidence,
      photo_signature = excluded.photo_signature,
      updated_at = excluded.updated_at
  `).run(row)
  return getProductTypeLabel(sku)
}

export function deleteProductTypeLabel(sku) {
  return db.prepare('DELETE FROM product_type_labels WHERE sku = ?').run(String(sku || '').trim()).changes
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

export function toExecutiveUser(row) {
  return toPublicUser(row)
}

export function getAllUsers() {
  return db.prepare('SELECT id, name, role, shop, user_code FROM users ORDER BY CAST(user_code AS INTEGER), name COLLATE NOCASE').all()
}

/** Directory without login codes — safe for any authenticated user. */
export function getUsersPublicDirectory() {
  return db.prepare('SELECT id, name, role, shop FROM users ORDER BY name COLLATE NOCASE').all()
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
    if (['name', 'role', 'shop'].includes(k)) {
      fields.push(`${k} = @${k}`)
      values[k] = v
    }
  }
  if (!fields.length) return null
  values.id = id
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = @id`).run(values)
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  return toExecutiveUser(row)
}

export function addUser(user) {
  const id = user.id || uid()
  const pinPlain = randomPin()
  const code = nextUserCode()
  const pinStored = hashPin(pinPlain)
  db.prepare('INSERT INTO users (id, name, role, shop, pin, user_code) VALUES (@id, @name, @role, @shop, @pin, @user_code)')
    .run({ id, name: user.name ?? '', role: user.role ?? 'manager', shop: user.shop ?? null, pin: pinStored, user_code: code })
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  return { ...toExecutiveUser(row), one_time_pin: pinPlain }
}

export function regenerateUserPin(userId) {
  const pin = randomPin()
  const result = db.prepare('UPDATE users SET pin = ?, pin_plain = NULL WHERE id = ?').run(hashPin(pin), userId)
  if (!result.changes) return null
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  return { ...toExecutiveUser(row), one_time_pin: pin }
}

export function removeUser(userId) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes
}

// ── Assignments ─────────────────────────────────────────────────────────────

export function getAllAssignments() {
  return db.prepare('SELECT * FROM assignments ORDER BY createdAt DESC').all()
}

export function getAssignmentById(id) {
  return db.prepare('SELECT * FROM assignments WHERE id = ?').get(id)
}

function runInsertAssignment(a) {
  const id = a.id || uid()
  const createdAt = a.createdAt || new Date().toISOString()
  db.prepare(`INSERT INTO assignments (id, type, skuCode, productName, assignedTo, assignedBy, shop, status, note, createdAt, completedAt)
    VALUES (@id, @type, @skuCode, @productName, @assignedTo, @assignedBy, @shop, @status, @note, @createdAt, @completedAt)`)
    .run({ id, type: a.type ?? '', skuCode: a.skuCode ?? '', productName: a.productName ?? '',
      assignedTo: a.assignedTo ?? '', assignedBy: a.assignedBy ?? '', shop: a.shop ?? '',
      status: a.status ?? 'pending', note: a.note ?? '', createdAt, completedAt: a.completedAt ?? null })
  return { ...a, id, createdAt, completedAt: a.completedAt ?? null }
}

export function insertAssignment(a) {
  return runInsertAssignment(a)
}

/** Single transaction; for large CSV imports (e.g. 10k SKUs needing photo tasks). */
export function insertAssignments(assignmentsArray) {
  if (!assignmentsArray?.length) return []
  const tx = db.transaction((items) => {
    const out = []
    for (const a of items) {
      out.push(runInsertAssignment(a))
    }
    return out
  })
  return tx(assignmentsArray)
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
    ...r,
    items: safeJsonArray(r.items, { table: 'outlet_transfers', column: 'items', id: r.id }),
  }))
}

export function getOutletTransferById(id) {
  const row = db.prepare('SELECT * FROM outlet_transfers WHERE id = ?').get(id)
  if (!row) return null
  return {
    ...row,
    items: safeJsonArray(row.items, { table: 'outlet_transfers', column: 'items', id: row.id }),
  }
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
  return row
    ? {
        ...row,
        items: safeJsonArray(row.items, { table: 'outlet_transfers', column: 'items', id: row.id }),
      }
    : null
}

// ── Store transfers ─────────────────────────────────────────────────────────

export function getAllStoreTransfers() {
  return db.prepare('SELECT * FROM store_transfers ORDER BY createdAt DESC').all().map((r) => ({
    ...r,
    items: safeJsonArray(r.items, { table: 'store_transfers', column: 'items', id: r.id }),
    item_statuses: safeJsonObject(r.item_statuses, { table: 'store_transfers', column: 'item_statuses', id: r.id }),
  }))
}

export function getStoreTransferById(id) {
  const row = db.prepare('SELECT * FROM store_transfers WHERE id = ?').get(id)
  if (!row) return null
  return {
    ...row,
    items: safeJsonArray(row.items, { table: 'store_transfers', column: 'items', id: row.id }),
    item_statuses: safeJsonObject(row.item_statuses, { table: 'store_transfers', column: 'item_statuses', id: row.id }),
  }
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
  } catch {
    const fallbackKeys = keysPresent.filter((k) => k !== 'item_statuses')
    if (fallbackKeys.length) {
      const fb = buildUpdate(fallbackKeys)
      db.prepare(`UPDATE store_transfers SET ${fb.fields.join(', ')} WHERE id = @id`).run(fb.values)
    }
  }
  const row = db.prepare('SELECT * FROM store_transfers WHERE id = ?').get(id)
  return row
    ? {
        ...row,
        items: safeJsonArray(row.items, { table: 'store_transfers', column: 'items', id: row.id }),
        item_statuses: safeJsonObject(row.item_statuses, { table: 'store_transfers', column: 'item_statuses', id: row.id }),
      }
    : null
}

// ── Markdown / sale lists ───────────────────────────────────────────────────

function toMarkdownList(row) {
  if (!row) return null
  return {
    ...row,
    items: safeJsonArray(row.items, { table: 'markdown_lists', column: 'items', id: row.id }),
    item_statuses: safeJsonObject(row.item_statuses, { table: 'markdown_lists', column: 'item_statuses', id: row.id }),
  }
}

export function getAllMarkdownLists() {
  return db.prepare('SELECT * FROM markdown_lists ORDER BY createdAt DESC').all().map(toMarkdownList)
}

export function getMarkdownListById(id) {
  return toMarkdownList(db.prepare('SELECT * FROM markdown_lists WHERE id = ?').get(id))
}

export function insertMarkdownList(l) {
  const id = l.id || uid()
  const createdAt = l.createdAt || new Date().toISOString()
  db.prepare(`INSERT INTO markdown_lists (id, title, items, item_statuses, shop, createdBy, assignedTo, createdAt, status, completedAt, note, kind)
    VALUES (@id, @title, @items, @item_statuses, @shop, @createdBy, @assignedTo, @createdAt, @status, @completedAt, @note, @kind)`)
    .run({
      id, title: l.title ?? '', items: JSON.stringify(l.items || []),
      item_statuses: JSON.stringify(l.item_statuses || {}),
      shop: l.shop ?? '', createdBy: l.createdBy ?? '', assignedTo: l.assignedTo ?? null,
      createdAt, status: l.status ?? 'pending', completedAt: l.completedAt ?? null, note: l.note ?? null,
      kind: l.kind === 'removal' ? 'removal' : 'sale',
    })
  return getMarkdownListById(id)
}

export function updateMarkdownList(id, changes) {
  const ALLOWED = ['status', 'completedAt', 'item_statuses', 'note', 'assignedTo', 'items']
  const fields = []
  const values = { id }
  for (const k of ALLOWED) {
    const v = changes[k]
    if (v === undefined) continue
    fields.push(`${k} = @${k}`)
    values[k] = (k === 'item_statuses' || k === 'items') ? JSON.stringify(v) : v
  }
  if (!fields.length) return getMarkdownListById(id)
  db.prepare(`UPDATE markdown_lists SET ${fields.join(', ')} WHERE id = @id`).run(values)
  return getMarkdownListById(id)
}

/** Whether a sale list accepts item / % edits (pending or completed, not ended/removal). */
function markdownListEditable(list) {
  if (!list || list.kind === 'removal' || list.status === 'ended') return false
  return list.status === 'pending' || list.status === 'completed'
}

/** Merge new items into an active sale list and apply SALE flags to affected SKUs. */
export function appendItemsToMarkdownList(listId, newItems) {
  const list = getMarkdownListById(listId)
  if (!list) throw new Error('Sale list not found')
  if (list.kind === 'removal') throw new Error('Cannot add items to a removal list')
  if (!markdownListEditable(list)) throw new Error('Sale list is not open for edits')

  const existing = list.items || []
  const byCode = new Map(existing.map((i) => [i.skuCode, i]))
  const affected = []
  for (const it of newItems || []) {
    if (!it?.skuCode) continue
    byCode.set(it.skuCode, it)
    affected.push(it)
  }
  if (!affected.length) return list

  const merged = Array.from(byCode.values())
  updateMarkdownList(listId, { items: merged })
  applySaleToSkus(listId, affected)
  return getMarkdownListById(listId)
}

function toSaleChangeReport(row) {
  if (!row) return null
  const rawStatuses = safeJsonObject(row.item_statuses, { table: 'sale_change_reports', column: 'item_statuses', id: row.id })
  return {
    ...row,
    changes: safeJsonArray(row.changes, { table: 'sale_change_reports', column: 'changes', id: row.id }),
    item_statuses: normalizeSaleChangeItemStatuses(rawStatuses, row.shop),
  }
}

/** Migrate legacy flat per-SKU marks to nested per-shop structure. */
export function normalizeSaleChangeItemStatuses(raw, reportShop) {
  const out = {}
  for (const [sku, entry] of Object.entries(raw || {})) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.status === 'marked' || entry.status === 'pending') {
      const shop = reportShop || 'Unknown'
      out[sku] = {
        [shop]: {
          status: entry.status,
          markedBy: entry.markedBy || '',
          markedAt: entry.markedAt || '',
        },
      }
    } else {
      out[sku] = { ...entry }
    }
  }
  return out
}

export const RETAIL_MARKDOWN_SHOPS = ['Ring Mall', 'Village']

export function getAllSaleChangeReports() {
  return db.prepare('SELECT * FROM sale_change_reports ORDER BY createdAt DESC').all().map(toSaleChangeReport)
}

export function getSaleChangeReportById(id) {
  return toSaleChangeReport(db.prepare('SELECT * FROM sale_change_reports WHERE id = ?').get(id))
}

export function insertSaleChangeReport(r) {
  const id = r.id || uid()
  const createdAt = r.createdAt || new Date().toISOString()
  db.prepare(`INSERT INTO sale_change_reports (id, listId, listTitle, shop, createdBy, assignedTo, createdAt, changes, item_statuses)
    VALUES (@id, @listId, @listTitle, @shop, @createdBy, @assignedTo, @createdAt, @changes, @item_statuses)`)
    .run({
      id,
      listId: r.listId ?? '',
      listTitle: r.listTitle ?? '',
      shop: r.shop ?? '',
      createdBy: r.createdBy ?? '',
      assignedTo: r.assignedTo ?? null,
      createdAt,
      changes: JSON.stringify(r.changes || []),
      item_statuses: JSON.stringify(r.item_statuses || {}),
    })
  return getSaleChangeReportById(id)
}

export function updateSaleChangeReport(id, patch) {
  const ALLOWED = ['item_statuses']
  const keysPresent = Object.keys(patch || {}).filter((k) => ALLOWED.includes(k))
  if (!keysPresent.length) return getSaleChangeReportById(id)
  const values = { id }
  for (const k of keysPresent) {
    const v = patch[k]
    values[k] = k === 'item_statuses' ? JSON.stringify(v) : v
  }
  const sets = keysPresent.map((k) => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE sale_change_reports SET ${sets} WHERE id = @id`).run(values)
  return getSaleChangeReportById(id)
}

/** Toggle physical mark-down of new sale tag on a change report item for one shop. */
export function toggleSaleChangeItemMarked(reportId, skuCode, actorUserId, shop) {
  const report = getSaleChangeReportById(reportId)
  if (!report) throw new Error('Change report not found')
  if (!shop) throw new Error('Shop required')
  const changes = report.changes || []
  if (!changes.some((c) => c.skuCode === skuCode)) throw new Error('Product not in this report')

  const statuses = { ...(report.item_statuses || {}) }
  const byShop = { ...(statuses[skuCode] || {}) }
  if (byShop[shop]?.status === 'marked') {
    delete byShop[shop]
  } else {
    byShop[shop] = {
      status: 'marked',
      markedAt: new Date().toISOString(),
      markedBy: actorUserId || '',
    }
  }
  if (Object.keys(byShop).length) {
    statuses[skuCode] = byShop
  } else {
    delete statuses[skuCode]
  }
  return updateSaleChangeReport(reportId, { item_statuses: statuses })
}

export function saleChangeReportVisibleToUser(report, user) {
  if (!report || !user) return false
  if (user.role === 'executive') return true
  if (user.role === 'manager' && RETAIL_MARKDOWN_SHOPS.includes(user.shop)) return true
  return (
    (report.shop && report.shop === user.shop) ||
    report.createdBy === user.id ||
    report.assignedTo === user.id
  )
}

/** Update one product's sale % on an active list; records a sale change report. */
export function changeMarkdownListItemSalePct(listId, skuCode, newPct, actorUserId) {
  const list = getMarkdownListById(listId)
  if (!list) throw new Error('Sale list not found')
  if (!markdownListEditable(list)) throw new Error('Sale list is not open for edits')

  const pct = Math.max(0, Math.min(90, Math.round(Number(newPct) || 0)))
  if (pct <= 0) throw new Error('Invalid sale percent')

  const items = list.items || []
  const idx = items.findIndex((i) => i.skuCode === skuCode)
  if (idx < 0) throw new Error('Product not in list')

  const item = items[idx]
  const oldPct = Number(item.salePct) || 0
  if (oldPct === pct) throw new Error('Sale percent unchanged')

  const oldSalePrice = Number(item.salePrice) || salePriceOf(item.priceTag, oldPct)
  const newSalePrice = salePriceOf(item.priceTag, pct)
  const updatedItem = { ...item, salePct: pct, salePrice: newSalePrice }
  const newItems = [...items]
  newItems[idx] = updatedItem

  updateMarkdownList(listId, { items: newItems })
  applySaleToSkus(listId, [updatedItem])

  const report = insertSaleChangeReport({
    listId,
    listTitle: list.title || 'Sale list',
    shop: list.shop || '',
    createdBy: actorUserId || '',
    assignedTo: list.assignedTo || null,
    changes: [{
      skuCode: item.skuCode,
      productName: item.productName || '',
      brand: item.brand || '',
      sizes: item.sizes || '',
      priceTag: Number(item.priceTag) || 0,
      oldSalePct: oldPct,
      newSalePct: pct,
      oldSalePrice,
      newSalePrice,
      changedBy: actorUserId || '',
    }],
  })

  return { list: getMarkdownListById(listId), report }
}

export function deleteMarkdownList(id) {
  clearSaleForList(id)
  return db.prepare('DELETE FROM markdown_lists WHERE id = ?').run(id).changes
}

/** Mark all size rows of the listed SKUs as on sale with their per-product percent. */
export function applySaleToSkus(listId, items) {
  const stmt = db.prepare('UPDATE skus SET sale_active = 1, sale_percent = ?, sale_list_id = ? WHERE sku = ? AND deleted_at IS NULL')
  const run = db.transaction((rows) => {
    for (const it of rows) {
      const pct = Math.max(0, Math.min(90, Math.round(Number(it.salePct) || 0)))
      if (!it.skuCode || pct <= 0) continue
      stmt.run(pct, listId, it.skuCode)
    }
  })
  run(items || [])
}

/** Remove the sale flag from every SKU that belongs to this list. */
export function clearSaleForList(listId) {
  return db.prepare('UPDATE skus SET sale_active = 0, sale_percent = NULL, sale_list_id = NULL WHERE sale_list_id = ?')
    .run(listId).changes
}

// ── Sales snapshots ─────────────────────────────────────────────────────────

export function getAllSnapshots() {
  return db.prepare('SELECT * FROM sales_snapshots ORDER BY timestamp ASC').all().map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    products: safeJsonObject(r.products, { table: 'sales_snapshots', column: 'products', id: r.id }),
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
  const rows = db.prepare(`
    SELECT sku, size, COALESCE(SUM(units_sold), 0) AS sold_quantity
    FROM sales_events
    GROUP BY sku, TRIM(COALESCE(size, ''))
  `).all()
  const map = {}
  for (const r of rows) map[`${r.sku}|${r.size ?? ''}`] = r.sold_quantity ?? 0
  return map
}

export function getSalesBySku(sinceDate, untilDate, season) {
  const params = [sinceDate || '1970-01-01']
  let where = 'event_date >= ?'
  if (untilDate) { where += ' AND event_date <= ?'; params.push(untilDate) }
  const seasonFilter = normalizeSeasonInput(season)
  const seasonActive = seasonFilter && seasonFilter.toLowerCase() !== 'all'
  if (seasonActive) {
    const skuCodes = [...new Set(
      getAllSkus()
        .filter((s) => normalizeSeasonInput(s.season) === seasonFilter)
        .map((s) => s.sku)
        .filter(Boolean),
    )]
    if (!skuCodes.length) return []
    where += ` AND sku IN (${skuCodes.map(() => '?').join(',')})`
    params.push(...skuCodes)
  }
  return db.prepare(`
    SELECT sku,
           SUM(units_sold) AS sold_qty,
           SUM(revenue) AS revenue
    FROM sales_events
    WHERE ${where}
    GROUP BY sku
  `).all(...params)
}

/** All-time (no date filter) per-SKU net revenue, net units, and return-line count from sales_events. */
export function getSalesSummaryForSku(skuCode) {
  if (!skuCode) {
    return { netRevenue: 0, netQtySold: 0, returnsCount: 0 }
  }
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(revenue), 0) AS netRevenue,
      COALESCE(SUM(units_sold), 0) AS netQtySold,
      COALESCE(SUM(CASE WHEN units_sold < 0 THEN 1 ELSE 0 END), 0) AS returnsCount
    FROM sales_events
    WHERE sku = ?
  `).get(skuCode)
  return {
    netRevenue: row?.netRevenue ?? 0,
    netQtySold: row?.netQtySold ?? 0,
    returnsCount: row?.returnsCount ?? 0,
  }
}

/** True if at least one reporting sales event exists (date-aware Reports use this path). */
export function hasAnySalesEvents() {
  const row = db.prepare('SELECT 1 AS o FROM sales_events LIMIT 1').get()
  return !!row
}

/** Per-calendar-day totals for trend charts (event_date is YYYY-MM-DD). */
export function getSalesAggregatedByDay(sinceDate, untilDate, season) {
  const params = [sinceDate || '1970-01-01']
  let where = 'event_date >= ?'
  if (untilDate) { where += ' AND event_date <= ?'; params.push(untilDate) }
  const seasonFilter = normalizeSeasonInput(season)
  const seasonActive = seasonFilter && seasonFilter.toLowerCase() !== 'all'
  if (seasonActive) {
    const skuCodes = [...new Set(
      getAllSkus()
        .filter((s) => normalizeSeasonInput(s.season) === seasonFilter)
        .map((s) => s.sku)
        .filter(Boolean),
    )]
    if (!skuCodes.length) return []
    where += ` AND sku IN (${skuCodes.map(() => '?').join(',')})`
    params.push(...skuCodes)
  }
  return db.prepare(`
    SELECT event_date AS event_date,
           SUM(units_sold) AS units,
           SUM(revenue) AS revenue
    FROM sales_events
    WHERE ${where}
    GROUP BY event_date
    ORDER BY event_date
  `).all(...params)
}

/**
 * Exchange groups are linked sales_events sharing the same non-empty exchange_group_id.
 * A valid exchange pair has at least one return-side row (units_sold < 0) and one sale-side row (units_sold > 0).
 */
export function getExchangePairs(sinceDate, untilDate) {
  const params = []
  const where = ["TRIM(COALESCE(exchange_group_id, '')) != ''"]
  if (sinceDate) {
    where.push('event_date >= ?')
    params.push(sinceDate)
  }
  if (untilDate) {
    where.push('event_date <= ?')
    params.push(untilDate)
  }

  const rows = db.prepare(`
    SELECT
      exchange_group_id,
      order_id,
      sku,
      size,
      units_sold,
      revenue,
      event_date
    FROM sales_events
    WHERE ${where.join(' AND ')}
    ORDER BY event_date ASC, created_at ASC, id ASC
  `).all(...params)

  const groups = new Map()
  for (const row of rows) {
    const key = String(row.exchange_group_id ?? '').trim()
    if (!key) continue
    if (!groups.has(key)) {
      groups.set(key, {
        exchange_group_id: key,
        order_id: String(row.order_id ?? '').trim(),
        first_event_date: row.event_date,
        return_rows: [],
        sale_rows: [],
      })
    }
    const group = groups.get(key)
    if (!group.order_id && row.order_id) group.order_id = String(row.order_id).trim()
    if (!group.first_event_date || String(row.event_date) < String(group.first_event_date)) {
      group.first_event_date = row.event_date
    }
    const cleanRow = {
      sku: row.sku,
      size: row.size ?? '',
      units: Math.abs(Number(row.units_sold) || 0),
      revenue: Number(row.revenue) || 0,
      event_date: row.event_date,
    }
    if ((Number(row.units_sold) || 0) < 0) group.return_rows.push(cleanRow)
    if ((Number(row.units_sold) || 0) > 0) group.sale_rows.push(cleanRow)
  }

  return [...groups.values()]
    .filter((g) => g.return_rows.length > 0 && g.sale_rows.length > 0)
    .map((g) => ({
      exchange_group_id: g.exchange_group_id,
      order_id: g.order_id || null,
      first_event_date: g.first_event_date,
      returns_count: g.return_rows.length,
      sales_count: g.sale_rows.length,
      returned_units: g.return_rows.reduce((sum, r) => sum + r.units, 0),
      sold_units: g.sale_rows.reduce((sum, r) => sum + r.units, 0),
      return_rows: g.return_rows,
      sale_rows: g.sale_rows,
    }))
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0))
}

function scoreBand(score) {
  const n = Number(score) || 0
  if (n >= 60) return 'buy more'
  if (n >= 40) return 'selective reorder'
  if (n >= 20) return 'monitor'
  return 'do not reorder'
}

function productivityAction(score) {
  const n = Number(score) || 0
  if (n >= 60) return 'increase buy depth'
  if (n >= 40) return 'maintain selective reorder'
  if (n >= 20) return 'monitor'
  return 'cut reorder'
}

function round(n, digits = 1) {
  const p = 10 ** digits
  return Math.round((Number(n) || 0) * p) / p
}

function whereReportDate(params, sinceDate, untilDate, alias = '') {
  const col = alias ? `${alias}.event_date` : 'event_date'
  const where = []
  if (sinceDate) { where.push(`${col} >= ?`); params.push(sinceDate) }
  if (untilDate) { where.push(`${col} <= ?`); params.push(untilDate) }
  return where
}

function eventRowsForReport(skuCodes, sinceDate, untilDate) {
  if (!skuCodes.length) return []
  const params = [...skuCodes]
  const where = [`sku IN (${skuCodes.map(() => '?').join(',')})`]
  where.push(...whereReportDate(params, sinceDate, untilDate))
  return db.prepare(`
    SELECT sku, size, units_sold, revenue, event_date, exchange_group_id
    FROM sales_events
    WHERE ${where.join(' AND ')}
  `).all(...params)
}

function lifetimeSoldBySku(skuCodes) {
  if (!skuCodes.length) return {}
  const placeholders = skuCodes.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT sku, COALESCE(SUM(units_sold), 0) AS sold
    FROM sales_events
    WHERE sku IN (${placeholders})
    GROUP BY sku
  `).all(...skuCodes)
  return Object.fromEntries(rows.map((r) => [r.sku, Number(r.sold) || 0]))
}

function onHandBySku(skuCodes) {
  if (!skuCodes.length) return {}
  const placeholders = skuCodes.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT sku, COALESCE(SUM(signed_quantity), 0) AS on_hand
    FROM inventory_events
    WHERE sku IN (${placeholders})
    GROUP BY sku
  `).all(...skuCodes)
  return Object.fromEntries(rows.map((r) => [r.sku, Number(r.on_hand) || 0]))
}

function buildBuyingReportContext({ since, until, season } = {}) {
  const seasonFilter = normalizeSeasonInput(season)
  const seasonActive = seasonFilter && seasonFilter.toLowerCase() !== 'all'
  const rawSkus = getAllSkus().filter((s) => !seasonActive || normalizeSeasonInput(s.season) === seasonFilter)
  const shipmentMeta = getShipmentMetaBySku()
  const products = aggregateSkus(rawSkus, shipmentMeta)
  const skuCodes = products.map((p) => p.sku).filter(Boolean)
  const importTotals = getLifetimeImportedBySku()
  const lifetimeSoldMap = lifetimeSoldBySku(skuCodes)
  const onHandMap = onHandBySku(skuCodes)
  const rows = eventRowsForReport(skuCodes, since, until)
  const eventAgg = new Map()

  for (const row of rows) {
    const sku = row.sku
    if (!eventAgg.has(sku)) {
      eventAgg.set(sku, {
        gross_units: 0,
        return_units: 0,
        net_units: 0,
        net_revenue: 0,
        exchange_return_units: 0,
        exchange_groups: new Set(),
      })
    }
    const agg = eventAgg.get(sku)
    const units = Number(row.units_sold) || 0
    const revenue = Number(row.revenue) || 0
    if (units > 0) agg.gross_units += units
    if (units < 0) {
      agg.return_units += Math.abs(units)
      if (String(row.exchange_group_id || '').trim()) {
        agg.exchange_return_units += Math.abs(units)
        agg.exchange_groups.add(String(row.exchange_group_id).trim())
      }
    }
    agg.net_units += units
    agg.net_revenue += revenue
  }

  const productsWithMetrics = products.map((p) => {
    const hasEvents = eventAgg.has(p.sku)
    const ev = eventAgg.get(p.sku) || {}
    const catalogQty = Number(p.quantity) || 0
    const unitsImported = Number(importTotals[p.sku]) || catalogQty
    const fallbackSold = Number(p.sold_quantity) || 0
    const lifetimeSold = Math.max(0, Number(lifetimeSoldMap[p.sku]) || fallbackSold)
    const fallbackPrice = Number(p.avg_price_sold || p.price_sold || p.price_tag) || 0
    const grossUnits = hasEvents ? Number(ev.gross_units) || 0 : fallbackSold
    const returnUnits = hasEvents ? Number(ev.return_units) || 0 : Number(p.returnsCount) || 0
    const netUnits = hasEvents ? Number(ev.net_units) || 0 : fallbackSold
    const netRevenue = hasEvents ? Number(ev.net_revenue) || 0 : fallbackSold * fallbackPrice
    const priceTag = Number(p.price_tag) || 0
    const avgSoldPrice = grossUnits > 0 ? netRevenue / grossUnits : fallbackPrice
    const priceRealization = priceTag > 0 && grossUnits > 0 ? (netRevenue / (grossUnits * priceTag)) * 100 : 0
    const returnRate = grossUnits > 0 ? (returnUnits / grossUnits) * 100 : 0
    const exchangeReturnRate = grossUnits > 0 ? ((Number(ev.exchange_return_units) || 0) / grossUnits) * 100 : 0
    const sellThrough = getSellThrough(lifetimeSold, unitsImported)
    const days = Math.max(1, getDaysInStore(p.import_date))
    const velocity = netUnits / days
    const revenuePerDay = netRevenue / days
    const remaining = onHandMap[p.sku] != null
      ? Math.max(0, onHandMap[p.sku])
      : Math.max(0, unitsImported - lifetimeSold)
    return {
      sku: p.sku,
      product_name: p.product_name || p.sku,
      brand: p.brand || 'Unbranded',
      category: p.category || 'Other',
      gender: genderBucketKey(p.gender),
      season: p.season || '',
      size: Array.isArray(p.sizes) ? p.sizes.join(', ') : p.size || '',
      quantity: unitsImported,
      units_imported: unitsImported,
      lifetime_sold: lifetimeSold,
      remaining,
      gross_units: round(grossUnits, 0),
      return_units: round(returnUnits, 0),
      net_units: round(netUnits, 0),
      net_revenue: round(netRevenue, 2),
      avg_sold_price: round(avgSoldPrice, 2),
      price_tag: round(priceTag, 2),
      price_realization: round(priceRealization, 1),
      return_rate: round(returnRate, 1),
      exchange_return_rate: round(exchangeReturnRate, 1),
      sell_through: round(sellThrough, 1),
      days_in_store: days,
      velocity: round(velocity, 2),
      revenue_per_day: round(revenuePerDay, 2),
      exchange_groups: ev.exchange_groups ? ev.exchange_groups.size : 0,
      import_date: p.import_date,
    }
  })

  const maxVelocity = Math.max(1, ...productsWithMetrics.map((p) => Math.max(0, p.velocity)))
  const maxRevenue = Math.max(1, ...productsWithMetrics.map((p) => Math.max(0, p.net_revenue)))
  const scoredProducts = productsWithMetrics.map((p) => {
    const velocityScore = clamp((Math.max(0, p.velocity) / maxVelocity) * 100)
    const revenueScore = clamp((Math.max(0, p.net_revenue) / maxRevenue) * 100)
    const priceScore = p.price_tag > 0 ? clamp(p.price_realization) : 55
    const agePenalty = p.days_in_store > 120 ? 18 : p.days_in_store > 75 ? 10 : 0
    const overstockPenalty = p.quantity > 0 ? clamp((p.remaining / p.quantity) * 18, 0, 18) : 0
    const returnPenalty = clamp(p.return_rate * 1.4, 0, 35)
    const rebuyScore = clamp(
      p.sell_through * 0.35 + priceScore * 0.22 + velocityScore * 0.2 + revenueScore * 0.15
      - returnPenalty - agePenalty * 0.4 - overstockPenalty * 0.5,
    )
    const markdownRisk = clamp(
      (100 - clamp(p.sell_through)) * 0.28
      + (100 - priceScore) * 0.2
      + clamp(p.return_rate * 1.2, 0, 30)
      + clamp(p.days_in_store / 1.6, 0, 55) * 0.28
      + overstockPenalty * 1.1,
    )
    return {
      ...p,
      score: round(rebuyScore, 0),
      score_band: scoreBand(rebuyScore),
      markdown_risk_score: round(markdownRisk, 0),
      markdown_band: markdownRisk >= 70 ? 'markdown watch' : markdownRisk >= 50 ? 'review' : 'protect',
      signal_reason: buildProductSignalReason(p, rebuyScore, markdownRisk),
      recommended_action: buildProductRecommendation(p, rebuyScore, markdownRisk),
    }
  })

  return { products: scoredProducts, rawSkus, salesEvents: rows, since, until, season: seasonFilter || 'All' }
}

function buildProductSignalReason(p, score, markdownRisk) {
  if (score >= 80) return `${p.sell_through}% sell-through, ${p.return_rate}% return rate, ${p.price_realization || 0}% price realization`
  if (p.return_rate >= 20) return `High return pressure at ${p.return_rate}% is distorting demand`
  if (markdownRisk >= 70) return `${p.remaining} units remain after ${p.days_in_store} days with ${p.sell_through}% sell-through`
  if (p.price_realization > 0 && p.price_realization < 75) return `Average selling price is only ${p.price_realization}% of tag price`
  return `${p.net_units} net units, ${p.sell_through}% sell-through, ${p.velocity} units/day`
}

function buildProductRecommendation(p, score, markdownRisk) {
  if (score >= 80 && p.return_rate < 12) return 'increase buy depth'
  if (p.return_rate >= 20) return 'cut reorder and inspect fit/quality'
  if (markdownRisk >= 70) return 'watch for markdown'
  if (score >= 60) return 'maintain selective reorder'
  if (score < 40) return 'do not reorder'
  return 'monitor before committing buy'
}

function groupReportRows(products, keyFn, labelKey) {
  const map = new Map()
  for (const p of products) {
    const name = keyFn(p) || 'Other'
    if (!map.has(name)) {
      map.set(name, {
        [labelKey]: name,
        stock_units: 0,
        remaining_units: 0,
        gross_units: 0,
        return_units: 0,
        net_units: 0,
        net_revenue: 0,
        price_tag_total: 0,
        sellThroughSum: 0,
        priceRealizationSum: 0,
        scoreSum: 0,
        count: 0,
      })
    }
    const g = map.get(name)
    g.stock_units += p.quantity
    g.remaining_units += p.remaining
    g.gross_units += p.gross_units
    g.return_units += p.return_units
    g.net_units += p.net_units
    g.net_revenue += p.net_revenue
    g.price_tag_total += p.price_tag * p.gross_units
    g.sellThroughSum += p.sell_through
    g.priceRealizationSum += p.price_realization || 0
    g.scoreSum += p.score
    g.count += 1
  }
  const totals = [...map.values()].reduce((acc, g) => {
    acc.stock += g.stock_units
    acc.revenue += g.net_revenue
    acc.net += g.net_units
    return acc
  }, { stock: 0, revenue: 0, net: 0 })
  return [...map.values()].map((g) => {
    const score = g.count ? g.scoreSum / g.count : 0
    const returnRate = g.gross_units > 0 ? (g.return_units / g.gross_units) * 100 : 0
    const priceRealization = g.price_tag_total > 0 ? (g.net_revenue / g.price_tag_total) * 100 : 0
    return {
      ...g,
      stock_share: totals.stock > 0 ? round((g.stock_units / totals.stock) * 100, 1) : 0,
      revenue_share: totals.revenue > 0 ? round((g.net_revenue / totals.revenue) * 100, 1) : 0,
      sales_share: totals.net > 0 ? round((g.net_units / totals.net) * 100, 1) : 0,
      sell_through: g.count ? round(g.sellThroughSum / g.count, 1) : 0,
      return_rate: round(returnRate, 1),
      price_realization: round(priceRealization, 1),
      score: round(score, 0),
      score_band: scoreBand(score),
      signal_reason: `${round(g.net_units, 0)} net units, ${round(returnRate, 1)}% returns, ${round(priceRealization, 1)}% price realization`,
      recommended_action: productivityAction(score),
    }
  }).sort((a, b) => b.net_revenue - a.net_revenue)
}

export function getBrandProductivityReport(q = {}) {
  const ctx = buildBuyingReportContext(q)
  const rows = groupReportRows(ctx.products, (p) => p.brand, 'brand')
  return { rows, generated_at: new Date().toISOString(), filters: { since: q.since || null, until: q.until || null, season: q.season || 'All' } }
}

export function getCategoryProductivityReport(q = {}) {
  const ctx = buildBuyingReportContext(q)
  const rows = groupReportRows(ctx.products, (p) => p.category, 'category')
  return { rows, generated_at: new Date().toISOString(), filters: { since: q.since || null, until: q.until || null, season: q.season || 'All' } }
}

export function getMoversReport(q = {}) {
  const ctx = buildBuyingReportContext(q)
  const limit = Math.max(1, Math.min(50, Number(q.limit) || 10))
  const pick = (p) => ({
    sku: p.sku,
    product_name: p.product_name,
    brand: p.brand,
    category: p.category,
    gender: p.gender,
    quantity: p.quantity,
    remaining: p.remaining,
    net_units: p.net_units,
    net_revenue: p.net_revenue,
    sell_through: p.sell_through,
    velocity: p.velocity,
    days_in_store: p.days_in_store,
    score: p.score,
    score_band: p.score_band,
  })
  const fast = ctx.products
    .filter((p) => p.net_units > 0)
    .sort((a, b) => (b.velocity - a.velocity) || (b.sell_through - a.sell_through) || (b.net_revenue - a.net_revenue))
    .slice(0, limit)
    .map(pick)
  const slow = ctx.products
    .filter((p) => p.remaining > 0)
    .sort((a, b) => (a.velocity - b.velocity) || (b.days_in_store - a.days_in_store) || (b.remaining - a.remaining))
    .slice(0, limit)
    .map(pick)
  return {
    fast,
    slow,
    generated_at: new Date().toISOString(),
    filters: { since: q.since || null, until: q.until || null, season: q.season || 'All' },
  }
}

export function getExecutiveBuyingReport(q = {}) {
  const ctx = buildBuyingReportContext(q)
  const products = ctx.products
  const brandRows = groupReportRows(products, (p) => p.brand, 'brand')
  const categoryRows = groupReportRows(products, (p) => p.category, 'category')
  const topWinner = products.filter((p) => p.score >= 70 && p.return_rate < 15).sort((a, b) => b.score - a.score)[0]
  const falseWinner = products.filter((p) => p.gross_units >= 3 && (p.return_rate >= 20 || (p.price_realization > 0 && p.price_realization < 75))).sort((a, b) => b.return_rate - a.return_rate)[0]
  const cashTrap = products.filter((p) => p.markdown_risk_score >= 55).sort((a, b) => b.markdown_risk_score - a.markdown_risk_score)[0]
  const underInvestedBrand = brandRows.filter((b) => b.revenue_share > b.stock_share + 5 && b.score >= 55).sort((a, b) => (b.revenue_share - b.stock_share) - (a.revenue_share - a.stock_share))[0]
  const overboughtCategory = categoryRows.filter((c) => c.stock_share > c.revenue_share + 8 && c.score < 60).sort((a, b) => (b.stock_share - b.revenue_share) - (a.stock_share - a.revenue_share))[0]
  const sizeCurve = getSizeCurveHealthReport(q).rows[0]
  const cards = [
    topWinner && {
      type: 'rebuy_winner',
      title: 'Rebuy winner',
      affected: `${topWinner.product_name} (${topWinner.sku})`,
      business_reason: topWinner.signal_reason,
      financial_impact: topWinner.net_revenue,
      recommended_action: 'increase buy depth',
      score: topWinner.score,
    },
    falseWinner && {
      type: 'false_winner',
      title: 'False winner',
      affected: `${falseWinner.product_name} (${falseWinner.sku})`,
      business_reason: falseWinner.signal_reason,
      financial_impact: falseWinner.net_revenue,
      recommended_action: 'cut reorder and inspect fit/quality',
      score: falseWinner.score,
    },
    cashTrap && {
      type: 'cash_trap',
      title: 'Cash trap',
      affected: `${cashTrap.product_name} (${cashTrap.sku})`,
      business_reason: cashTrap.signal_reason,
      financial_impact: cashTrap.remaining * (cashTrap.price_tag || cashTrap.avg_sold_price || 0),
      recommended_action: 'watch for markdown',
      score: cashTrap.markdown_risk_score,
    },
    sizeCurve && {
      type: 'size_run_issue',
      title: 'Size-run issue',
      affected: `${sizeCurve.category} / ${sizeCurve.brand}`,
      business_reason: `${sizeCurve.issue_count} size(s) are materially overstocked or understocked versus demand`,
      financial_impact: sizeCurve.net_revenue,
      recommended_action: 'fix size run before next buy',
      score: sizeCurve.score,
    },
    underInvestedBrand && {
      type: 'brand_under_invested',
      title: 'Brand under-invested',
      affected: underInvestedBrand.brand,
      business_reason: `${underInvestedBrand.revenue_share}% revenue share vs ${underInvestedBrand.stock_share}% stock share`,
      financial_impact: underInvestedBrand.net_revenue,
      recommended_action: 'shift buy budget toward this brand',
      score: underInvestedBrand.score,
    },
    overboughtCategory && {
      type: 'overbought_category',
      title: 'Overbought category',
      affected: overboughtCategory.category,
      business_reason: `${overboughtCategory.stock_share}% stock share vs ${overboughtCategory.revenue_share}% revenue share`,
      financial_impact: overboughtCategory.remaining_units * 1,
      recommended_action: 'cut reorder and clear existing depth',
      score: overboughtCategory.score,
    },
  ].filter(Boolean).slice(0, 8)

  return {
    cards,
    headline: {
      product_count: products.length,
      net_revenue: round(products.reduce((s, p) => s + p.net_revenue, 0), 2),
      net_units: round(products.reduce((s, p) => s + p.net_units, 0), 0),
      return_units: round(products.reduce((s, p) => s + p.return_units, 0), 0),
      avg_rebuy_score: products.length ? round(products.reduce((s, p) => s + p.score, 0) / products.length, 0) : 0,
    },
    top_rebuy: products.sort((a, b) => b.score - a.score).slice(0, 10),
  }
}

export function getReturnsExchangeReport(q = {}) {
  const ctx = buildBuyingReportContext(q)
  const exchangePairs = getExchangePairs(q.since, q.until)
  const rows = ctx.products
    .filter((p) => p.return_units > 0 || p.return_rate > 0)
    .sort((a, b) => b.return_rate - a.return_rate || b.return_units - a.return_units)
  const fit_problems = rows
    .filter((p) => p.return_rate >= 15 || p.exchange_return_rate >= 10)
    .slice(0, 12)
    .map((p) => ({ ...p, recommended_action: 'cut reorder and inspect fit/quality' }))
  const destinations = new Map()
  for (const pair of exchangePairs) {
    for (const r of pair.return_rows) {
      for (const s of pair.sale_rows) {
        const key = `${r.sku} -> ${s.sku}`
        destinations.set(key, {
          from_sku: r.sku,
          to_sku: s.sku,
          units: (destinations.get(key)?.units || 0) + Math.min(r.units, s.units),
        })
      }
    }
  }
  return {
    rows,
    fit_problems,
    exchange_pairs: exchangePairs,
    exchange_destinations: [...destinations.values()].sort((a, b) => b.units - a.units).slice(0, 20),
  }
}

export function getSizeCurveHealthReport(q = {}) {
  const ctx = buildBuyingReportContext(q)
  const map = new Map()
  for (const row of ctx.rawSkus) {
    const key = `${row.category || 'Other'}|${row.brand || 'Unbranded'}`
    const size = String(row.size || 'Unspecified').trim() || 'Unspecified'
    if (!map.has(key)) map.set(key, { category: row.category || 'Other', brand: row.brand || 'Unbranded', sizes: new Map(), net_revenue: 0 })
    const group = map.get(key)
    if (!group.sizes.has(size)) group.sizes.set(size, { size, stocked: 0, sold: 0 })
    const s = group.sizes.get(size)
    s.stocked += Number(row.quantity) || 0
    s.sold += Number(row.sold_quantity) || 0
    group.net_revenue += (Number(row.sold_quantity) || 0) * (Number(row.price_sold || row.price_tag) || 0)
  }
  const rows = [...map.values()].map((g) => {
    const sizes = [...g.sizes.values()].map((s) => ({
      ...s,
      stocked_share: g.sizes.size ? 0 : 0,
      sold_share: 0,
      sell_through: s.stocked > 0 ? round((s.sold / s.stocked) * 100, 1) : 0,
    }))
    const stockedTotal = sizes.reduce((sum, s) => sum + s.stocked, 0)
    const soldTotal = sizes.reduce((sum, s) => sum + s.sold, 0)
    const withShares = sizes.map((s) => ({
      ...s,
      stocked_share: stockedTotal > 0 ? round((s.stocked / stockedTotal) * 100, 1) : 0,
      sold_share: soldTotal > 0 ? round((s.sold / soldTotal) * 100, 1) : 0,
      gap: soldTotal > 0 && stockedTotal > 0 ? round((s.sold / soldTotal) * 100 - (s.stocked / stockedTotal) * 100, 1) : 0,
    }))
    const issueCount = withShares.filter((s) => Math.abs(s.gap) >= 8 && (s.stocked > 0 || s.sold > 0)).length
    return {
      category: g.category,
      brand: g.brand,
      sizes: withShares,
      issue_count: issueCount,
      score: clamp(issueCount * 18, 0, 100),
      net_revenue: round(g.net_revenue, 2),
      signal_reason: issueCount ? `${issueCount} size(s) are misaligned with demand` : 'Size curve is balanced',
      recommended_action: issueCount ? 'fix size run before next buy' : 'maintain current size run',
    }
  }).sort((a, b) => b.score - a.score || b.net_revenue - a.net_revenue)
  return { rows }
}

export function getMarkdownRiskReport(q = {}) {
  const ctx = buildBuyingReportContext(q)
  const markdown_candidates = ctx.products
    .filter((p) => p.markdown_risk_score >= 45)
    .sort((a, b) => b.markdown_risk_score - a.markdown_risk_score)
    .slice(0, 30)
  const protected_winners = ctx.products
    .filter((p) => p.score >= 70 && p.markdown_risk_score < 45 && p.price_realization >= 80)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
  const exit_buy_list = ctx.products
    .filter((p) => p.score < 40 || p.return_rate >= 25)
    .sort((a, b) => a.score - b.score || b.return_rate - a.return_rate)
    .slice(0, 20)
  return { markdown_candidates, protected_winners, exit_buy_list }
}

/** Remove all reporting sales events (weekly dashboard KPIs). Does not change SKU on-hand or sold_quantity on skus. */
export function deleteAllSalesEvents() {
  const deleted = db.prepare('DELETE FROM sales_events').run().changes
  deleteInventoryEventsBySource('reporting_import', null, 'cleared reporting inventory events')
  return deleted
}

export function deleteSalesEventsByImportId(importId) {
  const id = String(importId || '').trim()
  if (!id) return 0
  const affectedKeys = new Set(
    db.prepare('SELECT sku, size FROM sales_events WHERE import_id = ?')
      .all(id)
      .map((row) => catalogLedgerKey(row.sku, row.size)),
  )
  const deleted = db.prepare('DELETE FROM sales_events WHERE import_id = ?').run(id).changes
  if (deleted > 0) {
    syncSkuCatalogFromLedgers({ onlyKeys: affectedKeys })
    deleteInventoryEventsBySource('reporting_import', id, `deleted reporting import (${id})`)
  }
  return deleted
}

export function insertSalesEvents(events) {
  const affectedKeys = new Set((events || []).map((event) => catalogLedgerKey(event?.sku, event?.size)))
  const ins = db.prepare(`
    INSERT INTO sales_events (id, sku, product_name, size, units_sold, price_sold, revenue, event_date, import_id, order_id, exchange_group_id, created_at)
    VALUES (@id, @sku, @product_name, @size, @units_sold, @price_sold, @revenue, @event_date, @import_id, @order_id, @exchange_group_id, @created_at)
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
        order_id: e.order_id ?? '',
        exchange_group_id: e.exchange_group_id ?? '',
        created_at: e.created_at ?? new Date().toISOString(),
      })
    }
  })
  tx(events)
  rebuildInventoryEventsForKeys(affectedKeys, `scoped sales append (${events.length} input row(s))`)
  return events.length
}

/** Match event row size the same way as INSERT (trim, empty = blank). */
function normalizedEventSizeKey(size) {
  if (size == null || size === '') return ''
  return String(size).trim()
}

function catalogLedgerKey(sku, size) {
  return `${String(sku ?? '')}|${normalizedEventSizeKey(size)}`
}

function syncSkuCatalogFromLedgersScoped(onlyKeys) {
  const syncQtyOne = db.prepare(`
    UPDATE skus
    SET quantity = (
      SELECT COALESCE(SUM(il.quantity_added), 0)
      FROM import_lines il
      WHERE il.import_id IN (SELECT id FROM import_history)
        AND il.sku = @sku
        AND TRIM(COALESCE(il.size, '')) = @size
    )
    WHERE sku = @sku
      AND TRIM(COALESCE(size, '')) = @size
      AND EXISTS (
        SELECT 1
        FROM import_lines il
        WHERE il.import_id IN (SELECT id FROM import_history)
          AND il.sku = @sku
          AND TRIM(COALESCE(il.size, '')) = @size
      )
  `)
  const syncImportDatesOne = db.prepare(`
    UPDATE skus
    SET
      import_date = (
        SELECT MIN(il.imported_at)
        FROM import_lines il
        WHERE il.import_id IN (SELECT id FROM import_history)
          AND il.sku = @sku
          AND TRIM(COALESCE(il.size, '')) = @size
      ),
      last_import_date = (
        SELECT MAX(il.imported_at)
        FROM import_lines il
        WHERE il.import_id IN (SELECT id FROM import_history)
          AND il.sku = @sku
          AND TRIM(COALESCE(il.size, '')) = @size
      )
    WHERE sku = @sku
      AND TRIM(COALESCE(size, '')) = @size
  `)
  const syncSoldOne = db.prepare(`
    UPDATE skus
    SET sold_quantity = COALESCE((
      SELECT SUM(se.units_sold)
      FROM sales_events se
      WHERE se.sku = @sku
        AND TRIM(COALESCE(se.size, '')) = @size
    ), 0)
    WHERE sku = @sku
      AND TRIM(COALESCE(size, '')) = @size
  `)

  let syncQty = 0
  let syncImportDates = 0
  let syncSold = 0
  for (const key of onlyKeys) {
    const pipe = key.indexOf('|')
    if (pipe < 0) continue
    const sku = key.slice(0, pipe)
    const size = key.slice(pipe + 1)
    syncQty += syncQtyOne.run({ sku, size }).changes
    syncImportDates += syncImportDatesOne.run({ sku, size }).changes
    syncSold += syncSoldOne.run({ sku, size }).changes
  }

  return {
    insertedMissingImport: 0,
    syncQty,
    syncImportDates,
    syncSold,
    insertedEventOnly: 0,
    syncEventOnly: 0,
  }
}

/**
 * Keep the catalog projection aligned with the append-only ledgers:
 * - quantity comes from intake import_lines (deduped exactly like Product Lookup)
 * - sold_quantity comes from signed reporting sales_events
 * @param {{ onlyKeys?: Set<string> }} [options] — when set, sync only those sku|size keys (faster on import)
 */
function syncSkuCatalogFromLedgers(options = {}) {
  const onlyKeys = options.onlyKeys
  if (onlyKeys instanceof Set && onlyKeys.size > 0) {
    return syncSkuCatalogFromLedgersScoped(onlyKeys)
  }
  const templateBySku = db.prepare(`
    SELECT barcode, product_name, price_sold, price_tag, cost_price, import_date, gender, season, category, brand
    FROM skus
    WHERE sku = ?
    ORDER BY CASE WHEN _importId IS NOT NULL THEN 0 ELSE 1 END, rowid ASC
    LIMIT 1
  `)

  const missingImportRows = db.prepare(`
    WITH ${sqlIntakeLineRankedCte}
    SELECT
      f.sku,
      TRIM(COALESCE(f.size, '')) AS size,
      f.quantity_added,
      f.barcode,
      f.product_name,
      f.gender,
      f.imported_at,
      f.import_id,
      COALESCE((
        SELECT SUM(se.units_sold)
        FROM sales_events se
        WHERE se.sku = f.sku
          AND TRIM(COALESCE(se.size, '')) = TRIM(COALESCE(f.size, ''))
      ), 0) AS sold_quantity
    FROM il_first f
    WHERE f._rn = 1
      AND NOT EXISTS (
        SELECT 1
        FROM skus s
        WHERE s.sku = f.sku
          AND TRIM(COALESCE(s.size, '')) = TRIM(COALESCE(f.size, ''))
      )
  `).all()

  const insertMissingImport = db.prepare(`
    INSERT INTO skus (id, barcode, sku, product_name, size, price_sold, price_tag, cost_price, quantity, sold_quantity, import_date, gender, season, category, brand, _importId)
    VALUES (@id, @barcode, @sku, @product_name, @size, @price_sold, @price_tag, @cost_price, @quantity, @sold_quantity, @import_date, @gender, @season, @category, @brand, @_importId)
  `)

  for (const row of missingImportRows) {
    const template = templateBySku.get(row.sku) || {}
    insertMissingImport.run({
      id: uid(),
      barcode: row.barcode || template.barcode || '',
      sku: row.sku,
      product_name: row.product_name || template.product_name || '',
      size: row.size ?? '',
      price_sold: template.price_sold ?? 0,
      price_tag: template.price_tag ?? 0,
      cost_price: template.cost_price ?? 0,
      quantity: Math.max(0, Math.round(Number(row.quantity_added) || 0)),
      sold_quantity: Math.round(Number(row.sold_quantity) || 0),
      import_date: row.imported_at || template.import_date || new Date().toISOString(),
      gender: row.gender || template.gender || '',
      season: template.season ?? '',
      category: template.category ?? '',
      brand: template.brand ?? '',
      _importId: row.import_id ?? null,
    })
  }

  const syncQty = db.prepare(`
    UPDATE skus
    SET quantity = (
      SELECT COALESCE(SUM(il.quantity_added), 0)
      FROM import_lines il
      WHERE il.import_id IN (SELECT id FROM import_history)
        AND il.sku = skus.sku
        AND TRIM(COALESCE(il.size, '')) = TRIM(COALESCE(skus.size, ''))
    )
    WHERE EXISTS (
      SELECT 1
      FROM import_lines il
      WHERE il.import_id IN (SELECT id FROM import_history)
        AND il.sku = skus.sku
        AND TRIM(COALESCE(il.size, '')) = TRIM(COALESCE(skus.size, ''))
    )
      AND COALESCE(quantity, 0) != (
        SELECT COALESCE(SUM(il.quantity_added), 0)
        FROM import_lines il
        WHERE il.import_id IN (SELECT id FROM import_history)
          AND il.sku = skus.sku
          AND TRIM(COALESCE(il.size, '')) = TRIM(COALESCE(skus.size, ''))
      )
  `).run().changes

  const syncImportDates = db.prepare(`
    UPDATE skus
    SET
      import_date = (
        SELECT MIN(il.imported_at)
        FROM import_lines il
        WHERE il.import_id IN (SELECT id FROM import_history)
          AND il.sku = skus.sku
          AND TRIM(COALESCE(il.size, '')) = TRIM(COALESCE(skus.size, ''))
      ),
      last_import_date = (
        SELECT MAX(il.imported_at)
        FROM import_lines il
        WHERE il.import_id IN (SELECT id FROM import_history)
          AND il.sku = skus.sku
          AND TRIM(COALESCE(il.size, '')) = TRIM(COALESCE(skus.size, ''))
      )
    WHERE EXISTS (
      SELECT 1
      FROM import_lines il
      WHERE il.import_id IN (SELECT id FROM import_history)
        AND il.sku = skus.sku
        AND TRIM(COALESCE(il.size, '')) = TRIM(COALESCE(skus.size, ''))
    )
  `).run().changes

  const syncSold = db.prepare(`
    UPDATE skus
    SET sold_quantity = COALESCE((
      SELECT SUM(se.units_sold)
      FROM sales_events se
      WHERE se.sku = skus.sku
        AND TRIM(COALESCE(se.size, '')) = TRIM(COALESCE(skus.size, ''))
    ), 0)
    WHERE EXISTS (
      SELECT 1
      FROM import_lines il
      WHERE il.sku = skus.sku
        AND TRIM(COALESCE(il.size, '')) = TRIM(COALESCE(skus.size, ''))
    )
      AND COALESCE(sold_quantity, 0) != COALESCE((
        SELECT SUM(se.units_sold)
        FROM sales_events se
        WHERE se.sku = skus.sku
          AND TRIM(COALESCE(se.size, '')) = TRIM(COALESCE(skus.size, ''))
      ), 0)
  `).run().changes

  const eventOnlyRows = db.prepare(`
    SELECT
      se.sku,
      TRIM(COALESCE(se.size, '')) AS size,
      COALESCE(SUM(se.units_sold), 0) AS sold_quantity,
      CASE
        WHEN COALESCE(SUM(se.units_sold), 0) != 0 THEN COALESCE(SUM(se.revenue), 0) / COALESCE(SUM(se.units_sold), 0)
        ELSE 0
      END AS price_sold,
      MAX(se.product_name) AS product_name,
      MIN(se.event_date) AS event_date
    FROM sales_events se
    WHERE NOT EXISTS (
      SELECT 1
      FROM skus s
      WHERE s.sku = se.sku
        AND TRIM(COALESCE(s.size, '')) = TRIM(COALESCE(se.size, ''))
    )
    GROUP BY se.sku, TRIM(COALESCE(se.size, ''))
  `).all()

  const insertEventOnly = db.prepare(`
    INSERT INTO skus (id, barcode, sku, product_name, size, price_sold, price_tag, cost_price, quantity, sold_quantity, import_date, gender, season, category, brand, _importId)
    VALUES (@id, @barcode, @sku, @product_name, @size, @price_sold, @price_tag, @cost_price, 0, @sold_quantity, @import_date, @gender, @season, @category, @brand, NULL)
  `)
  for (const row of eventOnlyRows) {
    const template = templateBySku.get(row.sku) || {}
    insertEventOnly.run({
      id: uid(),
      barcode: template.barcode ?? '',
      sku: row.sku,
      product_name: template.product_name || row.product_name || '',
      size: row.size ?? '',
      price_sold: row.price_sold ?? 0,
      price_tag: template.price_tag ?? 0,
      cost_price: template.cost_price ?? 0,
      sold_quantity: row.sold_quantity ?? 0,
      import_date: template.import_date || row.event_date || new Date().toISOString(),
      gender: template.gender ?? '',
      season: template.season ?? '',
      category: template.category ?? '',
      brand: template.brand ?? '',
    })
  }

  const syncEventOnly = db.prepare(`
    UPDATE skus
    SET
      quantity = 0,
      sold_quantity = COALESCE((
        SELECT SUM(se.units_sold)
        FROM sales_events se
        WHERE se.sku = skus.sku
          AND TRIM(COALESCE(se.size, '')) = TRIM(COALESCE(skus.size, ''))
      ), 0)
    WHERE NOT EXISTS (
      SELECT 1
      FROM import_lines il
      WHERE il.sku = skus.sku
        AND TRIM(COALESCE(il.size, '')) = TRIM(COALESCE(skus.size, ''))
    )
      AND EXISTS (
        SELECT 1
        FROM sales_events se
        WHERE se.sku = skus.sku
          AND TRIM(COALESCE(se.size, '')) = TRIM(COALESCE(skus.size, ''))
      )
      AND (
        COALESCE(quantity, 0) != 0
        OR COALESCE(sold_quantity, 0) != COALESCE((
          SELECT SUM(se.units_sold)
          FROM sales_events se
          WHERE se.sku = skus.sku
            AND TRIM(COALESCE(se.size, '')) = TRIM(COALESCE(skus.size, ''))
        ), 0)
      )
  `).run().changes

  return {
    insertedMissingImport: missingImportRows.length,
    syncQty,
    syncImportDates,
    syncSold,
    insertedEventOnly: eventOnlyRows.length,
    syncEventOnly,
  }
}

function syncSkuCatalogProjectionOnStartup() {
  try {
    const { insertedMissingImport, syncQty, syncSold, insertedEventOnly, syncEventOnly } = syncSkuCatalogFromLedgers()
    if (insertedMissingImport > 0 || syncQty > 0 || syncSold > 0 || insertedEventOnly > 0 || syncEventOnly > 0) {
      console.log(`[db] Synced SKU catalog projection from ledgers (${insertedMissingImport} missing intake row(s), ${syncQty} quantity row(s), ${syncSold} sold row(s), ${insertedEventOnly} event-only size row(s), ${syncEventOnly} event-only sync row(s))`)
    }
  } catch (e) {
    console.warn('[db] SKU catalog projection sync failed:', e.message)
  }
}

/**
 * Reporting import: replace rows by (sku, sale calendar day, size), while preserving separate
 * sale-side and return-side rows. Prevents 2×/3× revenue when the same file is confirmed again
 * without collapsing a same-day sale and return into one net-zero event.
 */
export function replaceSalesEventsForReportingImport(events) {
  if (!Array.isArray(events) || events.length === 0) return 0
  /** @type {Map<string, object>} one merged row per (sku, day, size, direction) so sales and returns do not cancel each other */
  const merged = new Map()
  for (const e of events) {
    const sku = e.sku ?? ''
    const eventDate = String(e.event_date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    const u = Number(e.units_sold) || 0
    const r = Number(e.revenue) || 0
    const direction = u < 0 ? 'RETURN' : u > 0 ? 'SALE' : r < 0 ? 'RETURN' : 'SALE'
    const k = `${sku}\t${eventDate}\t${normalizedEventSizeKey(e.size)}\t${direction}`
    if (!merged.has(k)) {
        merged.set(k, {
          id: e.id || uid(),
          sku,
          product_name: (e.product_name && String(e.product_name).trim()) ? e.product_name : '',
          size: e.size ?? '',
          units_sold: u,
          revenue: r,
          event_date: eventDate,
          import_id: e.import_id ?? null,
          order_id: e.order_id ?? '',
          exchange_group_id: e.exchange_group_id ?? '',
          created_at: e.created_at ?? new Date().toISOString(),
        })
      } else {
        const m = merged.get(k)
        m.units_sold = (Number(m.units_sold) || 0) + u
        m.revenue = (Number(m.revenue) || 0) + r
        if (!String(m.product_name ?? '').trim() && e.product_name) m.product_name = e.product_name
        if (!String(m.order_id ?? '').trim() && e.order_id) m.order_id = e.order_id
        if (!String(m.exchange_group_id ?? '').trim() && e.exchange_group_id) m.exchange_group_id = e.exchange_group_id
      }
    }
  const list = []
  for (const m of merged.values()) {
    const u = m.units_sold
    m.price_sold =
      u !== 0 && Math.abs(m.revenue) > 1e-9 ? m.revenue / u : 0
    list.push(m)
  }
  const affectedKeys = new Set(list.map((event) => catalogLedgerKey(event.sku, event.size)))

  const del = db.prepare(`
    DELETE FROM sales_events
    WHERE sku = @sku
      AND event_date = @event_date
      AND LOWER(TRIM(COALESCE(size, ''))) = @sizeKey
  `)
  const ins = db.prepare(`
    INSERT INTO sales_events (id, sku, product_name, size, units_sold, price_sold, revenue, event_date, import_id, order_id, exchange_group_id, created_at)
    VALUES (@id, @sku, @product_name, @size, @units_sold, @price_sold, @revenue, @event_date, @import_id, @order_id, @exchange_group_id, @created_at)
  `)
  const tx = db.transaction((items) => {
    const deletedKeys = new Set()
    for (const e of items) {
      const deleteKey = `${e.sku}\t${e.event_date}\t${normalizedEventSizeKey(e.size).toLowerCase()}`
      if (!deletedKeys.has(deleteKey)) {
        deletedKeys.add(deleteKey)
        del.run({
          sku: e.sku,
          event_date: e.event_date,
          sizeKey: normalizedEventSizeKey(e.size).toLowerCase(),
        })
      }
      ins.run({
        id: e.id,
        sku: e.sku,
        product_name: e.product_name ?? '',
        size: e.size ?? '',
        units_sold: e.units_sold ?? 0,
        price_sold: e.price_sold ?? 0,
        revenue: e.revenue ?? 0,
        event_date: e.event_date,
        import_id: e.import_id ?? null,
        order_id: e.order_id ?? '',
        exchange_group_id: e.exchange_group_id ?? '',
        created_at: e.created_at ?? new Date().toISOString(),
      })
    }
  })
  tx(list)
  const removed = runDedupeSalesEvents()
  if (removed > 0) {
    console.log(
      `[db] Post-replace: removed ${removed} extra duplicate sales_event row(s) (same sku/day/size, near-identical key)`,
    )
  }
  syncSkuCatalogFromLedgers()
  rebuildInventoryEventsForKeys(affectedKeys, `scoped reporting import replace (${events.length} input row(s), ${list.length} merged row(s))`)
  return list.length
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

// ── Activity log (executive audit trail) ────────────────────────────────────

const insertActivityRow = db.prepare(`
  INSERT INTO activity_log (id, created_at, actor_user_id, actor_name, category, action, entity_type, entity_id, summary, meta_json)
  VALUES (@id, @created_at, @actor_user_id, @actor_name, @category, @action, @entity_type, @entity_id, @summary, @meta_json)
`)

/**
 * @param {{
 *   actorUserId?: string|null,
 *   actorName: string,
 *   category: string,
 *   action: string,
 *   entityType?: string|null,
 *   entityId?: string|null,
 *   summary: string,
 *   meta?: Record<string, unknown>|null,
 * }} row
 */
export function appendActivityLog(row) {
  const id = uid()
  const created_at = new Date().toISOString()
  insertActivityRow.run({
    id,
    created_at,
    actor_user_id: row.actorUserId ?? null,
    actor_name: row.actorName ?? 'Unknown',
    category: row.category,
    action: row.action,
    entity_type: row.entityType ?? null,
    entity_id: row.entityId ?? null,
    summary: row.summary ?? '',
    meta_json: row.meta != null ? JSON.stringify(row.meta) : null,
  })
  return id
}

function mapActivityRow(r) {
  let meta = null
  if (r.meta_json) {
    try {
      meta = JSON.parse(r.meta_json)
    } catch {
      meta = null
    }
  }
  return {
    id: r.id,
    createdAt: r.created_at,
    actorUserId: r.actor_user_id,
    actorName: r.actor_name,
    category: r.category,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    summary: r.summary,
    meta,
  }
}

/**
 * @param {{ limit?: number, offset?: number, category?: string, since?: string, until?: string }} q
 */
export function getActivityLog(q = {}) {
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
  const offset = Math.max(Number(q.offset) || 0, 0)
  const conditions = []
  const params = []
  if (q.category) {
    conditions.push('category = ?')
    params.push(q.category)
  }
  if (q.since) {
    conditions.push('created_at >= ?')
    params.push(q.since)
  }
  if (q.until) {
    conditions.push('created_at <= ?')
    params.push(q.until)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const countRow = db.prepare(`SELECT COUNT(*) AS c FROM activity_log ${where}`).get(...params)
  const rows = db.prepare(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset)
  return { items: rows.map(mapActivityRow), total: countRow.c }
}

function userNameOr(id, fallback = 'Unknown') {
  if (!id) return fallback
  const u = getPublicUserById(id)
  return u?.name || fallback
}

/**
 * One-time: populate activity_log from existing domain tables when empty.
 * @returns {{ skipped: boolean, inserted: number }}
 */
export function backfillActivityLogFromLegacyIfEmpty() {
  const c = db.prepare('SELECT COUNT(*) AS c FROM activity_log').get().c
  if (c > 0) return { skipped: true, inserted: 0 }

  let inserted = 0
  const ins = db.prepare(`
    INSERT INTO activity_log (id, created_at, actor_user_id, actor_name, category, action, entity_type, entity_id, summary, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction(() => {
    const imp = db.prepare('SELECT * FROM import_history ORDER BY imported_at ASC').all()
    for (const r of imp) {
      const actorId = r.imported_by_user_id || null
      const actorName = r.imported_by_name || 'Legacy import'
      ins.run(
        `bf-imp-${r.id}`,
        r.imported_at,
        actorId,
        actorName,
        'import',
        'recorded',
        'import_batch',
        r.id,
        `Import "${r.filename}" — ${r.sku_count} SKUs`,
        JSON.stringify({ filename: r.filename, skuCount: r.sku_count, legacy: true }),
      )
      inserted++
    }

    const asn = db.prepare('SELECT * FROM assignments ORDER BY createdAt ASC').all()
    for (const r of asn) {
      const by = userNameOr(r.assignedBy, 'System')
      ins.run(
        `bf-asn-${r.id}`,
        r.createdAt || new Date().toISOString(),
        r.assignedBy || null,
        by,
        'assignment',
        'created',
        'assignment',
        r.id,
        `${r.type || 'Task'}: ${(r.productName || r.skuCode || '').slice(0, 80)}`,
        JSON.stringify({ type: r.type, skuCode: r.skuCode, status: r.status, shop: r.shop, legacy: true }),
      )
      inserted++
    }

    const ot = db.prepare('SELECT * FROM outlet_transfers ORDER BY createdAt ASC').all()
    for (const r of ot) {
      const by = userNameOr(r.createdBy, 'Unknown')
      let n = 0
      n = safeJsonArray(r.items, { table: 'outlet_transfers', column: 'items', id: r.id }).length
      ins.run(
        `bf-ot-${r.id}`,
        r.createdAt || new Date().toISOString(),
        r.createdBy || null,
        by,
        'transfer_outlet',
        'created',
        'outlet_transfer',
        r.id,
        `Outlet transfer (${n} items) — ${r.status || 'pending'}`,
        JSON.stringify({ status: r.status, legacy: true }),
      )
      inserted++
    }

    const st = db.prepare('SELECT * FROM store_transfers ORDER BY createdAt ASC').all()
    for (const r of st) {
      const by = userNameOr(r.createdBy, 'Unknown')
      let n = 0
      n = safeJsonArray(r.items, { table: 'store_transfers', column: 'items', id: r.id }).length
      ins.run(
        `bf-st-${r.id}`,
        r.createdAt || new Date().toISOString(),
        r.createdBy || null,
        by,
        'transfer_store',
        'created',
        'store_transfer',
        r.id,
        `Store transfer ${r.fromShop || '?'} → ${r.toShop || '?'} (${n} items)`,
        JSON.stringify({ fromShop: r.fromShop, toShop: r.toShop, status: r.status, legacy: true }),
      )
      inserted++
    }

    const shifts = db.prepare('SELECT * FROM shifts ORDER BY clock_in ASC').all()
    for (const r of shifts) {
      const name = r.user_name || userNameOr(r.user_id, 'Unknown')
      ins.run(
        `bf-sh-in-${r.id}`,
        r.clock_in,
        r.user_id,
        name,
        'shift',
        'clock_in',
        'shift',
        r.id,
        `Clock in${r.shop ? ` @ ${r.shop}` : ''}`,
        JSON.stringify({ shop: r.shop, legacy: true }),
      )
      inserted++
      if (r.clock_out) {
        ins.run(
          `bf-sh-out-${r.id}`,
          r.clock_out,
          r.user_id,
          name,
          'shift',
          'clock_out',
          'shift',
          r.id,
          `Clock out${r.duration_min != null ? ` (${r.duration_min} min)` : ''}`,
          JSON.stringify({ durationMin: r.duration_min, legacy: true }),
        )
        inserted++
      }
    }

    const snaps = db.prepare('SELECT * FROM sales_snapshots ORDER BY timestamp ASC').all()
    for (const r of snaps) {
      let keys = 0
      keys = Object.keys(safeJsonObject(r.products, { table: 'sales_snapshots', column: 'products', id: r.id })).length
      ins.run(
        `bf-snap-${r.id}`,
        r.timestamp || new Date().toISOString(),
        null,
        'System',
        'sales_snapshot',
        'created',
        'snapshot',
        r.id,
        `Sales snapshot — ${keys} product keys`,
        JSON.stringify({ legacy: true }),
      )
      inserted++
    }

    const evAgg = db.prepare(`
      SELECT date(created_at) AS d, COUNT(*) AS n, SUM(units_sold) AS units
      FROM sales_events
      GROUP BY date(created_at)
      ORDER BY d ASC
    `).all()
    for (const row of evAgg) {
      if (!row.d) continue
      ins.run(
        `bf-se-${row.d}`,
        `${row.d}T12:00:00.000Z`,
        null,
        'System',
        'sales_event',
        'batch_import',
        'sales_events',
        row.d,
        `Sales events — ${row.n} lines, ${row.units ?? 0} units (historical)`,
        JSON.stringify({ lines: row.n, units: row.units, legacy: true }),
      )
      inserted++
    }

    const notif = db.prepare('SELECT * FROM notifications ORDER BY createdAt ASC LIMIT 500').all()
    for (const r of notif) {
      ins.run(
        `bf-nf-${r.id}`,
        r.createdAt || new Date().toISOString(),
        null,
        'System',
        'notification',
        'created',
        'notification',
        r.id,
        r.title || r.type || 'Notification',
        JSON.stringify({ type: r.type, legacy: true }),
      )
      inserted++
    }
  })

  tx()
  return { skipped: false, inserted }
}

// ── Data-mutating backfill orchestrator ─────────────────────────────────────
//
// Schema-safe setup (CREATE TABLE/INDEX, ALTER TABLE ADD COLUMN, default-user
// seed, and the security-critical PIN hashing) runs unconditionally above — it
// must always be applied for the app to function safely.
//
// The steps below only repair/rebuild EXISTING row data. Each is idempotent
// (re-running is a no-op once data is clean) and self-logging. They run in
// dependency order: ledger fills/repairs first, then projection rebuilds that
// read from those ledgers.
//
// By default this runs automatically on import to preserve dashboard/data
// correctness. Set RETAILOS_SKIP_STARTUP_BACKFILLS=1 to disable the automatic
// pass (e.g. in production) and instead run them in a controlled maintenance
// window via `node scripts/run-data-backfills.mjs`.
const STARTUP_DATA_BACKFILL_STEPS = [
  ['backfill_import_history_total_units', backfillImportHistoryTotalUnits],
  ['repair_skus_zero_cost_from_peers', repairSkusZeroCostFromSkuPeers],
  ['dedupe_sales_events', runDedupeOnStartup],
  ['migrate_retail_shop_names', migrateRetailShopNames],
  ['backfill_import_line_costs', backfillImportLineCostsOnStartup],
  ['rebuild_inventory_events', rebuildInventoryEventsOnStartup],
  ['repair_reporting_line_totals', repairReportingLineTotalsOnStartup],
  ['normalize_stored_categories', normalizeStoredCategoriesOnStartup],
  ['sync_sku_catalog_projection', syncSkuCatalogProjectionOnStartup],
]

/**
 * Run every data-mutating backfill/repair step in dependency order. Idempotent.
 * A failure in one step is logged and does not abort the remaining steps
 * (matching the previous per-step try/catch behavior).
 * @param {{ logger?: { log: Function, warn: Function } }} [options]
 * @returns {{ ran: string[], failed: Array<{ step: string, error: string }> }}
 */
export function runStartupDataBackfills({ logger = console } = {}) {
  const ran = []
  const failed = []
  for (const [name, step] of STARTUP_DATA_BACKFILL_STEPS) {
    try {
      step()
      ran.push(name)
    } catch (e) {
      failed.push({ step: name, error: e?.message || String(e) })
      logger.warn(`[db] startup backfill step "${name}" failed:`, e?.message || e)
    }
  }
  return { ran, failed }
}

const SKIP_STARTUP_BACKFILLS =
  process.env.RETAILOS_SKIP_STARTUP_BACKFILLS === '1' ||
  process.env.RETAILOS_SKIP_STARTUP_BACKFILLS === 'true'

if (SKIP_STARTUP_BACKFILLS) {
  console.log('[db] Skipping automatic data backfills (RETAILOS_SKIP_STARTUP_BACKFILLS set) — run scripts/run-data-backfills.mjs to apply them.')
} else {
  runStartupDataBackfills()
}
