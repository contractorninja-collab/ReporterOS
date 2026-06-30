import * as api from '../../api/client.js'
import { normalizeSeasonInput } from '../../utils/seasons.js'
import {
  generateId,
  notifyLocalWriteFailure,
  persistExtraSeasons,
  resyncAfterWriteFailure,
} from '../storeHelpers.js'

/** SKU catalog state, season/category/gender filters, and sales snapshots. */
export function createCatalogSlice(set, get) {
  return {
    setSkus: (skus) => set({ skus }),

    updateSku: (skuCode, changes) =>
      set((state) => ({
        skus: state.skus.map((sku) => (sku.sku === skuCode ? { ...sku, ...changes } : sku)),
      })),

    clearSkus: () => set({ skus: [] }),

    setActiveSeason: (season) => set({ activeSeason: season }),

    addExtraSeason: (code) => {
      const n = normalizeSeasonInput(code)
      if (!n || n === 'All' || n.length > 48) return
      const cur = get().extraSeasons
      if (cur.some((c) => c === n)) {
        set({ activeSeason: n })
        return
      }
      const next = [...cur, n]
      persistExtraSeasons(next)
      set({ extraSeasons: next, activeSeason: n })
    },

    setActiveCategory: (cat) => set({ activeCategory: cat }),
    setActiveGender: (gender) => set({ activeGender: gender }),

    addSalesSnapshot: (snapshot) => {
      const full = { ...snapshot, id: snapshot.id || generateId(), timestamp: snapshot.timestamp || new Date().toISOString() }
      set((state) => ({ salesSnapshots: [...state.salesSnapshots, full] }))
      api.postSnapshot(full).catch((err) => {
        set((state) => ({ salesSnapshots: state.salesSnapshots.filter((snap) => snap.id !== full.id) }))
        notifyLocalWriteFailure(set, get, 'Sales snapshot was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },
  }
}
