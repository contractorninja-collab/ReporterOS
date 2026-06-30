import * as api from '../../api/client.js'
import {
  asArray,
  generateId,
  notifyLocalWriteFailure,
  resyncAfterWriteFailure,
} from '../storeHelpers.js'

/** Markdown / sale lists and sale-change reports. */
export function createMarkdownsSlice(set, get) {
  return {
    /**
     * Create a sale/markdown list (Sale Builder page), or a removal list (kind 'removal')
     * tracking the physical removal of sale tags after a sale ends.
     * @param {{ title?, items, assignedTo?, note?, shop?, kind? }} payload
     * items: [{ skuCode, productName, brand, category, gender, season, priceTag, salePct, salePrice, sizes }]
     */
    createMarkdownList: (payload) => {
      const state = get()
      const id = generateId()
      const createdAt = new Date().toISOString()
      const items = payload.items || []
      const isRemoval = payload.kind === 'removal'
      const full = {
        id,
        title: payload.title || `Sale list ${new Date().toLocaleDateString('en-GB')}`,
        items,
        item_statuses: {},
        shop: payload.shop ?? state.activeUser?.shop ?? '',
        createdBy: state.activeUser?.id ?? '',
        assignedTo: payload.assignedTo ?? null,
        createdAt,
        status: 'pending',
        completedAt: null,
        note: payload.note ?? null,
        kind: isRemoval ? 'removal' : 'sale',
      }
      set((s) => ({ markdownLists: [full, ...s.markdownLists] }))
      api.postMarkdownList(full).catch((err) => {
        set((s) => ({
          markdownLists: s.markdownLists.filter((l) => l.id !== id),
          assignments: s.assignments.filter((a) => a.skuCode !== id),
          notifications: s.notifications.filter((n) => n.relatedId !== id),
          unreadCount: s.notifications
            .filter((n) => n.relatedId !== id ? !n.read : false)
            .length,
          skus: s.skus.map((row) => (row.sale_list_id === id
            ? { ...row, sale_active: 0, sale_percent: null, sale_list_id: null }
            : row)),
        }))
        notifyLocalWriteFailure(set, get, 'Sale list was not saved', err)
        resyncAfterWriteFailure(get)
      })

      // Reflect the sale flags locally so badges show without waiting for a sync.
      if (!isRemoval) {
        const pctBySku = new Map(items.map((i) => [i.skuCode, i.salePct]))
        set((s) => ({
          skus: s.skus.map((row) => (pctBySku.has(row.sku)
            ? { ...row, sale_active: 1, sale_percent: pctBySku.get(row.sku), sale_list_id: id }
            : row)),
        }))
      }

      const names = items.map((i) => i.productName).filter(Boolean)
      const summary = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
      if (payload.assignedTo) {
        get().addAssignment({
          type: 'sale',
          skuCode: id,
          productName: isRemoval ? `Remove sale tags: ${summary}` : `Sale list: ${summary}`,
          assignedTo: payload.assignedTo,
          assignedBy: state.activeUser?.id ?? '',
          shop: full.shop,
          status: 'pending',
          note: payload.note
            ? `${items.length} products — ${payload.note}`
            : isRemoval
              ? `${items.length} products — remove the sale labels`
              : `${items.length} products to tag with sale labels`,
        })
        get().addNotification({
          type: isRemoval ? 'sale_removal_created' : 'sale_list_created',
          title: isRemoval ? 'Sale Ended — Remove Tags' : 'New Sale List',
          message: isRemoval
            ? `${state.activeUser?.name || 'Someone'} ended a sale — ${items.length} products need their sale tags removed`
            : `${state.activeUser?.name || 'Someone'} created a sale list (${items.length} products) for you to tag`,
          userId: payload.assignedTo,
          relatedId: id,
        })
      }
      return id
    },

    /**
     * End a sale: clears the SALE badge from the list's SKUs (server does the same
     * when it sees status 'ended'). The list is kept for history.
     */
    endSaleList: (listId) => {
      const prevLists = get().markdownLists
      const prevSkus = get().skus
      set((state) => ({
        markdownLists: state.markdownLists.map((l) => (l.id === listId ? { ...l, status: 'ended' } : l)),
        skus: state.skus.map((row) => (row.sale_list_id === listId
          ? { ...row, sale_active: 0, sale_percent: null, sale_list_id: null }
          : row)),
      }))
      api.putMarkdownList(listId, { status: 'ended' }).catch((err) => {
        set({ markdownLists: prevLists, skus: prevSkus })
        notifyLocalWriteFailure(set, get, 'Sale list update was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    updateMarkdownList: (listId, changes) => {
      const prev = get().markdownLists.find((l) => l.id === listId)
      set((state) => ({
        markdownLists: state.markdownLists.map((l) => (l.id === listId ? { ...l, ...changes } : l)),
      }))
      api.putMarkdownList(listId, changes).catch((err) => {
        if (prev) {
          set((state) => ({
            markdownLists: state.markdownLists.map((l) => (l.id === listId ? prev : l)),
          }))
        }
        notifyLocalWriteFailure(set, get, 'Sale list update was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    /**
     * Add or update a product on an existing pending sale list (Product Lookup assign flow).
     * @param {string} listId
     * @param {{ skuCode, productName, brand, category, gender, season, priceTag, salePct, salePrice, sizes }} item
     */
    addItemToMarkdownList: (listId, item) => {
      const state = get()
      const list = state.markdownLists.find((l) => l.id === listId)
      if (!list || list.kind === 'removal' || list.status === 'ended') return false
      const prevLists = state.markdownLists
      const prevSkus = state.skus

      const existing = list.items || []
      const byCode = new Map(existing.map((i) => [i.skuCode, i]))
      byCode.set(item.skuCode, item)
      const merged = Array.from(byCode.values())

      set((s) => ({
        markdownLists: s.markdownLists.map((l) => (l.id === listId ? { ...l, items: merged } : l)),
        skus: s.skus.map((row) => (row.sku === item.skuCode
          ? { ...row, sale_active: 1, sale_percent: item.salePct, sale_list_id: listId }
          : row)),
      }))
      api.putMarkdownList(listId, { items: merged }).catch((err) => {
        set({ markdownLists: prevLists, skus: prevSkus })
        notifyLocalWriteFailure(set, get, 'Sale list item was not saved', err)
        resyncAfterWriteFailure(get)
      })
      return true
    },

    fetchSaleChangeReports: async () => {
      try {
        const data = await api.fetchSaleChangeReports()
        set({ saleChangeReports: asArray(data) })
      } catch { /* ignore */ }
    },

    /**
     * Change sale % for one product on an active list; creates a sale change report.
     */
    changeSaleListItemPct: async (listId, skuCode, newPct) => {
      const state = get()
      const list = state.markdownLists.find((l) => l.id === listId)
      if (!list || list.kind === 'removal' || list.status === 'ended') {
        throw new Error('This sale list cannot be edited')
      }

      const items = list.items || []
      const item = items.find((i) => i.skuCode === skuCode)
      if (!item) throw new Error('Product not found in this list')

      const oldPct = Number(item.salePct) || 0
      const pct = Math.round(Number(newPct) || 0)
      if (pct <= 0) throw new Error('Select a valid discount')
      if (oldPct === pct) throw new Error('Choose a different discount %')

      const result = await api.patchMarkdownListItemSalePct(listId, skuCode, pct)
      const report = result?.report
      const updatedList = result?.list
      if (!report || !updatedList) throw new Error('Server did not save the sale change')

      set((s) => ({
        markdownLists: s.markdownLists.map((l) => (l.id === listId ? updatedList : l)),
        saleChangeReports: [report, ...s.saleChangeReports.filter((r) => r.id !== report.id)],
        skus: s.skus.map((row) => (row.sku === skuCode
          ? { ...row, sale_active: 1, sale_percent: pct, sale_list_id: listId }
          : row)),
      }))

      const ch = report.changes?.[0]
      const summary = ch
        ? `${ch.productName || ch.skuCode}: -${ch.oldSalePct}% → -${ch.newSalePct}%`
        : 'Sale % updated'
      const more = (report.changes?.length || 0) > 1 ? ` (+${report.changes.length - 1} more)` : ''
      get().addNotification({
        type: 'sale_pct_changed',
        title: `Sale updated — ${list.title || 'Sale list'}`,
        message: `${state.activeUser?.name || 'Someone'} changed ${summary}${more}`,
        userId: list.assignedTo || 'all',
        relatedId: report.id,
      })
      return report
    },

    toggleSaleChangeItemMarked: async (reportId, skuCode, shop) => {
      const state = get()
      const report = state.saleChangeReports.find((r) => r.id === reportId)
      if (!report) throw new Error('Change report not found')
      if (!shop) throw new Error('Shop required')

      const statuses = { ...(report.item_statuses || {}) }
      const byShop = { ...(statuses[skuCode] || {}) }
      const userId = state.activeUser?.id || ''
      if (byShop[shop]?.status === 'marked') {
        delete byShop[shop]
      } else {
        byShop[shop] = {
          status: 'marked',
          markedAt: new Date().toISOString(),
          markedBy: userId,
        }
      }
      if (Object.keys(byShop).length) {
        statuses[skuCode] = byShop
      } else {
        delete statuses[skuCode]
      }

      set((s) => ({
        saleChangeReports: s.saleChangeReports.map((r) => (
          r.id === reportId ? { ...r, item_statuses: statuses } : r
        )),
      }))

      try {
        const updated = await api.patchSaleChangeItemMarked(reportId, skuCode, shop)
        if (updated) {
          set((s) => ({
            saleChangeReports: s.saleChangeReports.map((r) => (r.id === reportId ? updated : r)),
          }))
        }
        return updated
      } catch (e) {
        get().fetchSaleChangeReports().catch(() => {})
        throw e
      }
    },

    deleteMarkdownList: (listId) => {
      const prevLists = get().markdownLists
      const prevSkus = get().skus
      set((state) => ({
        markdownLists: state.markdownLists.filter((l) => l.id !== listId),
        skus: state.skus.map((row) => (row.sale_list_id === listId
          ? { ...row, sale_active: 0, sale_percent: null, sale_list_id: null }
          : row)),
      }))
      api.deleteMarkdownList(listId).catch((err) => {
        set({ markdownLists: prevLists, skus: prevSkus })
        notifyLocalWriteFailure(set, get, 'Sale list delete was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },
  }
}
