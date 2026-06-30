import assert from 'node:assert/strict'
import { createSalesEventsRouter } from '../src/server/routes/salesEventsRoutes.js'

const router = createSalesEventsRouter({
  requireExecutive: (_req, _res, next) => next(),
  requireDestructiveConfirmation: () => false,
  safeError: () => {},
  safeImportError: () => {},
  act: () => {},
  salesEvents: {
    hasAnySalesEvents: () => false,
    insertSalesEvents: () => 0,
    replaceSalesEventsForReportingImport: () => 0,
    deleteAllSalesEvents: () => 0,
    deleteSalesEventsByImportId: () => 0,
    getWeeklySales: () => [],
  },
})

const routes = []
for (const layer of router.stack || []) {
  if (!layer.route) continue
  for (const method of Object.keys(layer.route.methods)) {
    routes.push(`${method.toUpperCase()} ${layer.route.path}`)
  }
}

const expected = [
  'GET /sales/events/has-any',
  'POST /sales-events',
  'DELETE /sales-events',
  'DELETE /sales-events/import/:importId',
  'GET /sales/weekly',
]

assert.deepEqual(routes.sort(), expected.sort())
console.log(`sales-events route smoke passed (${routes.length} routes)`)
