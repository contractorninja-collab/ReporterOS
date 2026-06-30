import express from 'express'

export function createSalesEventsRouter({
  requireExecutive,
  requireDestructiveConfirmation,
  safeError,
  safeImportError,
  act,
  salesEvents,
}) {
  const router = express.Router()

  router.get('/sales/events/has-any', (req, res) => {
    try { res.json({ has: salesEvents.hasAnySalesEvents() }) }
    catch (e) { safeError(res, e) }
  })

  router.post('/sales-events', requireExecutive, (req, res) => {
    try {
      if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' })
      const replace = req.query.replace === '1' || req.query.replace === 'true'
      const count = replace
        ? salesEvents.replaceSalesEventsForReportingImport(req.body)
        : salesEvents.insertSalesEvents(req.body)
      act(req.authUser, {
        category: 'sales_event',
        action: 'imported',
        entityType: 'sales_events',
        entityId: null,
        summary: `Sales events import — ${count} rows`,
        meta: { count },
      })
      res.json({ inserted: count })
    } catch (e) { safeImportError(res, e, req) }
  })

  router.delete('/sales-events', requireExecutive, (req, res) => {
    try {
      const blocked = requireDestructiveConfirmation(req, res, 'delete-sales-events', 'all')
      if (blocked) return
      const n = salesEvents.deleteAllSalesEvents()
      act(req.authUser, {
        category: 'sales_event',
        action: 'cleared',
        entityType: 'sales_events',
        entityId: null,
        summary: `Cleared all sales events (${n} rows)`,
        meta: { deleted: n },
      })
      res.json({ deleted: n })
    } catch (e) { safeError(res, e) }
  })

  router.delete('/sales-events/import/:importId', requireExecutive, (req, res) => {
    try {
      const blocked = requireDestructiveConfirmation(req, res, 'delete-sales-events-import', req.params.importId)
      if (blocked) return
      const n = salesEvents.deleteSalesEventsByImportId(req.params.importId)
      if (n > 0) {
        act(req.authUser, {
          category: 'sales_event',
          action: 'rollback_import',
          entityType: 'import_batch',
          entityId: req.params.importId,
          summary: `Rolled back sales events for reporting import ${req.params.importId}`,
          meta: { deleted: n },
        })
      }
      res.json({ deleted: n })
    } catch (e) { safeImportError(res, e, req, e.statusCode || 500) }
  })

  router.get('/sales/weekly', (req, res) => {
    try {
      const weeks = parseInt(req.query.weeks, 10) || 8
      res.json(salesEvents.getWeeklySales(weeks))
    } catch (e) { safeError(res, e) }
  })

  return router
}
