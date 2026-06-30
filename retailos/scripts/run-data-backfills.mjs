/**
 * run-data-backfills.mjs
 *
 * Controlled, explicit runner for the data-mutating backfill/repair steps that
 * normally run automatically when src/data/db.js is imported.
 *
 * Use this when you set RETAILOS_SKIP_STARTUP_BACKFILLS=1 on the server (so the
 * app boots without mutating data) and want to apply the backfills deliberately
 * during a maintenance window.
 *
 * What it runs (idempotent, in dependency order):
 *   1. backfill import_history.total_units
 *   2. repair zero cost_price from same-SKU peers
 *   3. dedupe sales_events
 *   4. migrate legacy shop names (Shop 1/2 → Ring Mall/Village)
 *   5. backfill import_lines cost ledger
 *   6. rebuild inventory_events projection
 *   7. repair reporting revenue math
 *   8. normalize stored categories
 *   9. sync SKU catalog projection from ledgers
 *
 * SAFETY:
 *   - These steps CHANGE row data. Take a database backup first.
 *   - Idempotent: safe to re-run; clean data results in no changes.
 *   - Schema migrations (tables/columns/indexes) and PIN security migrations are
 *     applied automatically on import and are NOT gated by this script.
 *
 * Usage (from the retailos directory):
 *   node scripts/run-data-backfills.mjs
 *
 * Optional env:
 *   DATA_DIR   Directory containing retailos.db (defaults to the retailos root,
 *              matching src/data/db.js).
 */

// Prevent the automatic pass from running on import so this script is the single
// explicit trigger (avoids running the backfills twice).
process.env.RETAILOS_SKIP_STARTUP_BACKFILLS = '1'

const db = await import('../src/data/db.js')

console.log('[run-data-backfills] Starting controlled data backfill pass…')
const summary = db.runStartupDataBackfills({ logger: console })
console.log(`[run-data-backfills] Completed ${summary.ran.length} step(s).`)
if (summary.failed.length) {
  console.error(`[run-data-backfills] ${summary.failed.length} step(s) failed:`)
  for (const f of summary.failed) console.error(`  - ${f.step}: ${f.error}`)
  process.exit(1)
}
process.exit(0)
