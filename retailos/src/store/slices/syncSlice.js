import * as api from '../../api/client.js'
import {
  asArray,
  asRecord,
  photoPatchFromList,
  publicUser,
  runExclusiveSync,
} from '../storeHelpers.js'

/** Server bootstrap + background sync workflows. */
export function createSyncSlice(set, get) {
  return {
    initFromServer: async () => {
      const online = await api.checkHealth()
      if (!online) {
        // Server unreachable: stay offline but NEVER fabricate default users.
        // Overwriting with hardcoded CEO/COO/CTO seed rows (which reuse the real
        // DB ids) is what made real users appear "renamed back" to defaults.
        set({
          _ready: true,
          _apiOnline: false,
        })
        return
      }
      let sessionUser = null
      try {
        const me = await api.fetchAuthMe()
        sessionUser = me?.user ?? null
      } catch (e) {
        if (e?.status === 401) {
          try { localStorage.removeItem('retailos_active_user') } catch { /* */ }
          set({
            activeUser: null,
            users: [],
            _ready: true,
            _apiOnline: true,
          })
          return
        }
        set({ _ready: true, _apiOnline: false })
        return
      }
      if (!sessionUser) {
        try { localStorage.removeItem('retailos_active_user') } catch { /* */ }
        set({ activeUser: null, users: [], _ready: true, _apiOnline: true })
        return
      }
      const activeUser = publicUser(sessionUser)
      try { localStorage.setItem('retailos_active_user', JSON.stringify(activeUser)) } catch { /* */ }
      try {
        const [skus, importHistory, users, assignments, outletTransfers, storeTransfers, markdownLists, saleChangeReports, salesSnapshots, photoList, skuImportTotals, shipmentMeta, weeklySales, notifs, shifts] =
          await Promise.all([
            api.fetchSkus().catch(() => []),
            api.fetchImportHistory().catch(() => []),
            api.fetchUsers().catch(() => null),
            api.fetchAssignments().catch(() => []),
            api.fetchOutletTransfers().catch(() => []),
            api.fetchStoreTransfers().catch(() => []),
            api.fetchMarkdownLists().catch(() => []),
            api.fetchSaleChangeReports().catch(() => []),
            api.fetchSnapshots().catch(() => []),
            api.fetchPhotoList().catch(() => []),
            api.fetchSkuImportTotals().catch(() => ({})),
            api.fetchShipmentMeta().catch(() => ({})),
            api.fetchWeeklySales(8).catch(() => []),
            api.fetchNotifications().catch(() => []),
            api.fetchActiveShifts().catch(() => []),
          ])
        const photoPatch = photoPatchFromList(photoList) || { photoMap: {}, photoCount: 0 }
        const notifsArr = asArray(notifs)
        const shiftsArr = asArray(shifts)
        const myShift = activeUser ? shiftsArr.find((s) => s.user_id === activeUser.id) || null : null
        set({
          skus: asArray(skus),
          importHistory: asArray(importHistory),
          users: Array.isArray(users) ? users : get().users,
          assignments: asArray(assignments),
          outletTransfers: asArray(outletTransfers),
          storeTransfers: asArray(storeTransfers),
          markdownLists: asArray(markdownLists),
          saleChangeReports: asArray(saleChangeReports),
          salesSnapshots: asArray(salesSnapshots),
          ...photoPatch,
          skuImportTotals: asRecord(skuImportTotals),
          shipmentMeta: asRecord(shipmentMeta),
          weeklySales: asArray(weeklySales),
          notifications: notifsArr,
          unreadCount: notifsArr.filter((n) => !n.read).length,
          activeShifts: shiftsArr,
          myShift,
          activeUser,
          _ready: true,
          _apiOnline: true,
        })
      } catch {
        set({ _ready: true, _apiOnline: false, activeUser })
      }
    },

    refreshSkuImportTotals: async () => {
      try {
        const totals = await api.fetchSkuImportTotals()
        set({ skuImportTotals: asRecord(totals) })
      } catch { /* ignore */ }
    },

    refreshShipmentMeta: async () => {
      try {
        const meta = await api.fetchShipmentMeta()
        set({ shipmentMeta: asRecord(meta) })
      } catch { /* ignore */ }
    },

    refreshWeeklySales: async () => {
      try {
        const data = await api.fetchWeeklySales(8)
        set({ weeklySales: asArray(data) })
      } catch { /* ignore */ }
    },

    refreshImportHistory: async () => {
      try {
        const data = await api.fetchImportHistory()
        set({ importHistory: asArray(data) })
      } catch { /* ignore */ }
    },

    /** Executive: delete all rows in sales_events (weekly KPI source); refetch weekly aggregates. */
    clearSalesEventHistory: async () => {
      await api.deleteAllSalesEvents()
      const data = await api.fetchWeeklySales(8).catch(() => [])
      set({ weeklySales: asArray(data) })
    },

    syncUsers: async () => runExclusiveSync('users', async () => {
      const users = await api.fetchUsers().catch(() => null)
      if (!Array.isArray(users) || !users.length) return
      const updates = { users }
      const active = get().activeUser
      if (active) {
        const refreshed = users.find((u) => u.id === active.id)
        if (refreshed) {
          updates.activeUser = refreshed
          try { localStorage.setItem('retailos_active_user', JSON.stringify(refreshed)) } catch { /* */ }
        }
      }
      set(updates)
    }),

    syncOperationalData: async () => runExclusiveSync('operational', async () => {
      const online = await api.checkHealth()
      if (!online) {
        if (get()._apiOnline) set({ _apiOnline: false })
        return
      }
      if (!get()._apiOnline) set({ _apiOnline: true })
      const [assignments, outletTransfers, storeTransfers, markdownLists, saleChangeReports, notifs, shifts] = await Promise.all([
        api.fetchAssignments().catch(() => null),
        api.fetchOutletTransfers().catch(() => null),
        api.fetchStoreTransfers().catch(() => null),
        api.fetchMarkdownLists().catch(() => null),
        api.fetchSaleChangeReports().catch(() => null),
        api.fetchNotifications().catch(() => null),
        api.fetchActiveShifts().catch(() => null),
      ])
      const updates = {}
      if (Array.isArray(assignments)) updates.assignments = assignments
      if (Array.isArray(outletTransfers)) updates.outletTransfers = outletTransfers
      if (Array.isArray(storeTransfers)) updates.storeTransfers = storeTransfers
      if (Array.isArray(markdownLists)) updates.markdownLists = markdownLists
      if (Array.isArray(saleChangeReports)) updates.saleChangeReports = saleChangeReports
      if (Array.isArray(notifs)) {
        updates.notifications = notifs
        updates.unreadCount = notifs.filter((n) => !n.read).length
      }
      if (Array.isArray(shifts)) {
        updates.activeShifts = shifts
        const me = get().activeUser
        updates.myShift = me ? shifts.find((s) => s.user_id === me.id) || null : null
      }
      if (Object.keys(updates).length) set(updates)
    }),

    syncCatalogData: async () => runExclusiveSync('catalog', async () => {
      const [freshSkus, importHistory, photoList, skuImportTotals, shipmentMeta] = await Promise.all([
        api.fetchSkus().catch(() => null),
        api.fetchImportHistory().catch(() => null),
        api.fetchPhotoList().catch(() => null),
        api.fetchSkuImportTotals().catch(() => null),
        api.fetchShipmentMeta().catch(() => null),
      ])
      const updates = {}
      const photoPatch = photoPatchFromList(photoList)
      if (Array.isArray(freshSkus)) updates.skus = freshSkus
      if (Array.isArray(importHistory)) updates.importHistory = importHistory
      if (photoPatch) Object.assign(updates, photoPatch)
      if (skuImportTotals != null) updates.skuImportTotals = asRecord(skuImportTotals)
      if (shipmentMeta != null) updates.shipmentMeta = asRecord(shipmentMeta)
      if (Object.keys(updates).length) set(updates)
    }),

    syncReportingData: async () => runExclusiveSync('reporting', async () => {
      const [weeklySales, salesSnapshots] = await Promise.all([
        api.fetchWeeklySales(8).catch(() => null),
        api.fetchSnapshots().catch(() => null),
      ])
      const updates = {}
      if (Array.isArray(weeklySales)) updates.weeklySales = weeklySales
      if (Array.isArray(salesSnapshots)) updates.salesSnapshots = salesSnapshots
      if (Object.keys(updates).length) set(updates)
    }),

    syncFromServer: async () => runExclusiveSync('full', async () => {
      const online = await api.checkHealth()
      if (!online) {
        if (get()._apiOnline) set({ _apiOnline: false })
        return
      }
      try {
        if (!get()._apiOnline) set({ _apiOnline: true })
        const [users, assignments, outletTransfers, storeTransfers, markdownLists, saleChangeReports, photoList, freshSkus, importHistory, weeklySales, salesSnapshots, skuImportTotals, shipmentMeta, notifs, shifts] = await Promise.all([
          api.fetchUsers().catch(() => null),
          api.fetchAssignments().catch(() => null),
          api.fetchOutletTransfers().catch(() => null),
          api.fetchStoreTransfers().catch(() => null),
          api.fetchMarkdownLists().catch(() => null),
          api.fetchSaleChangeReports().catch(() => null),
          api.fetchPhotoList().catch(() => null),
          api.fetchSkus().catch(() => null),
          api.fetchImportHistory().catch(() => null),
          api.fetchWeeklySales(8).catch(() => null),
          api.fetchSnapshots().catch(() => null),
          api.fetchSkuImportTotals().catch(() => null),
          api.fetchShipmentMeta().catch(() => null),
          api.fetchNotifications().catch(() => null),
          api.fetchActiveShifts().catch(() => null),
        ])
        const updates = {}
        if (Array.isArray(users) && users.length) {
          updates.users = users
          const active = get().activeUser
          if (active) {
            const refreshed = users.find((u) => u.id === active.id)
            if (refreshed) {
              updates.activeUser = refreshed
              try { localStorage.setItem('retailos_active_user', JSON.stringify(refreshed)) } catch { /* */ }
            }
          }
        }
        if (Array.isArray(assignments)) updates.assignments = assignments
        if (Array.isArray(outletTransfers)) updates.outletTransfers = outletTransfers
        if (Array.isArray(storeTransfers)) updates.storeTransfers = storeTransfers
        if (Array.isArray(markdownLists)) updates.markdownLists = markdownLists
        if (Array.isArray(saleChangeReports)) updates.saleChangeReports = saleChangeReports
        const photoPatch = photoPatchFromList(photoList)
        if (photoPatch) Object.assign(updates, photoPatch)
        if (Array.isArray(freshSkus)) updates.skus = freshSkus
        if (Array.isArray(importHistory)) updates.importHistory = importHistory
        if (Array.isArray(weeklySales)) updates.weeklySales = weeklySales
        if (Array.isArray(salesSnapshots)) updates.salesSnapshots = salesSnapshots
        if (skuImportTotals != null) updates.skuImportTotals = asRecord(skuImportTotals)
        if (shipmentMeta != null) updates.shipmentMeta = asRecord(shipmentMeta)
        if (Array.isArray(notifs)) {
          updates.notifications = notifs
          updates.unreadCount = notifs.filter((n) => !n.read).length
        }
        if (Array.isArray(shifts)) {
          updates.activeShifts = shifts
          const me = get().activeUser
          updates.myShift = me ? shifts.find((s) => s.user_id === me.id) || null : null
        }
        set(updates)
      } catch { /* silent */ }
    }),
  }
}
