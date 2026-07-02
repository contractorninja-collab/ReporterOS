import * as api from '../../api/client.js'
import { asRecord, generateId } from '../storeHelpers.js'

/** CSV import persistence: SKU batches, import history records, and deletion. */
export function createImportsSlice(set) {
  return {
    /**
     * Persist SKU rows to the API, merge into local state, then reload from server so totals
     * (e.g. Product Lookup investment) match the database. Surfaces POST failures instead of
     * swallowing them (large imports previously looked successful while the server never saved).
     */
    importSkusBatch: async (newSkus) => {
      if (!Array.isArray(newSkus) || newSkus.length === 0) return null
      const postResult = await api.postSkus(newSkus)
      set((state) => {
        const map = new Map(state.skus.map((s) => [`${s.sku}|${s.size ?? ''}`, s]))
        for (const s of newSkus) {
          const key = `${s.sku}|${s.size ?? ''}`
          const prev = map.get(key)
          map.set(key, prev ? { ...prev, ...s } : { ...s, id: s.id || generateId() })
        }
        return { skus: [...map.values()] }
      })
      try {
        const [freshSkus, totals, meta] = await Promise.all([
          api.fetchSkus().catch(() => null),
          api.fetchSkuImportTotals().catch(() => null),
          api.fetchShipmentMeta().catch(() => null),
        ])
        const patch = {}
        if (Array.isArray(freshSkus)) patch.skus = freshSkus
        if (totals != null) patch.skuImportTotals = asRecord(totals)
        if (meta != null) patch.shipmentMeta = asRecord(meta)
        if (Object.keys(patch).length) set(patch)
      } catch {
        /* offline — keep merged local */
      }
      return postResult?.seasonRollover ?? null
    },

    addImportRecord: async (record) => {
      const full = { ...record, id: record.id || generateId() }
      set((state) => ({ importHistory: [full, ...state.importHistory] }))
      try {
        return await api.postImportRecord(full)
      } catch (err) {
        set((state) => ({
          importHistory: state.importHistory.filter((r) => r.id !== full.id),
        }))
        throw err
      }
    },

    deleteImport: async (importId) => {
      await api.deleteImportById(importId)
      const [skus, importHistory, assignments, skuImportTotals, shipmentMeta, weeklySales, photoList] = await Promise.all([
        api.fetchSkus().catch(() => null),
        api.fetchImportHistory().catch(() => null),
        api.fetchAssignments().catch(() => null),
        api.fetchSkuImportTotals().catch(() => null),
        api.fetchShipmentMeta().catch(() => null),
        api.fetchWeeklySales(8).catch(() => null),
        api.fetchPhotoList().catch(() => null),
      ])
      const patch = {}
      if (Array.isArray(skus)) patch.skus = skus
      if (Array.isArray(importHistory)) patch.importHistory = importHistory
      if (Array.isArray(assignments)) patch.assignments = assignments
      if (skuImportTotals != null) patch.skuImportTotals = asRecord(skuImportTotals)
      if (shipmentMeta != null) patch.shipmentMeta = asRecord(shipmentMeta)
      if (Array.isArray(weeklySales)) patch.weeklySales = weeklySales
      if (Array.isArray(photoList)) {
        const photoMap = {}
        for (const code of photoList) photoMap[code] = api.getPhotoUrl(code)
        patch.photoMap = photoMap
        patch.photoCount = photoList.length
      }
      set(patch)
    },
  }
}
