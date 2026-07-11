import * as api from '../../api/client.js'
import {
  generateId,
  notifyLocalWriteFailure,
  resyncAfterWriteFailure,
} from '../storeHelpers.js'

/** Outlet + store transfer workflows, including full batch creation. */
export function createTransfersSlice(set, get) {
  return {
    // ── Outlet transfers ──────────────────────────────────────────────────────

    addOutletTransfer: (transfer) => {
      const full = {
        ...transfer,
        id: transfer.id || generateId(),
        createdAt: new Date().toISOString(),
        receivedAt: null,
        fromShop: transfer.fromShop ?? get().activeUser?.shop ?? '',
        item_statuses: transfer.item_statuses || {},
      }
      set((state) => ({ outletTransfers: [full, ...state.outletTransfers] }))
      api.postOutletTransfer(full).catch((err) => {
        set((state) => ({ outletTransfers: state.outletTransfers.filter((t) => t.id !== full.id) }))
        notifyLocalWriteFailure(set, get, 'Outlet transfer was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    updateOutletTransfer: (transferId, changes) => {
      const prev = get().outletTransfers.find((t) => t.id === transferId)
      set((state) => ({
        outletTransfers: state.outletTransfers.map((t) => (t.id === transferId ? { ...t, ...changes } : t)),
      }))
      api.putOutletTransfer(transferId, changes)
        .then((result) => {
          const updatedTransfer = result?.transfer || result
          const ecommerceSale = result?.ecommerceSale
          if (updatedTransfer?.id) {
            set((state) => ({
              outletTransfers: state.outletTransfers.map((t) => (t.id === transferId ? updatedTransfer : t)),
            }))
          }
          if (ecommerceSale?.list) {
            set((state) => ({
              markdownLists: [
                ecommerceSale.list,
                ...state.markdownLists.filter((l) => l.id !== ecommerceSale.list.id),
              ],
              skus: state.skus.map((row) => {
                const item = (ecommerceSale.items || []).find((it) => it.skuCode === row.sku)
                return item
                  ? {
                      ...row,
                      sale_active: 1,
                      sale_percent: item.salePct,
                      sale_extra_percent: item.extraSalePct || null,
                      sale_list_id: ecommerceSale.list.id,
                    }
                  : row
              }),
            }))
            get().syncOperationalData?.().catch(() => {})
          }
        })
        .catch((err) => {
          if (prev) {
            set((state) => ({
              outletTransfers: state.outletTransfers.map((t) => (t.id === transferId ? prev : t)),
            }))
          }
          notifyLocalWriteFailure(set, get, 'Outlet transfer update was not saved', err)
          resyncAfterWriteFailure(get)
        })
    },

    deleteOutletTransfer: async (transferId) => {
      const prevTransfers = get().outletTransfers
      set((state) => ({
        outletTransfers: state.outletTransfers.filter((t) => t.id !== transferId),
      }))
      try {
        await api.deleteOutletTransfer(transferId)
        get().syncOperationalData?.().catch(() => {})
      } catch (err) {
        set({ outletTransfers: prevTransfers })
        notifyLocalWriteFailure(set, get, 'Outlet transfer was not deleted', err)
        resyncAfterWriteFailure(get)
        throw err
      }
    },

    addItemToTodayTransfer: (item, createdBy) => {
      const today = new Date().toISOString().slice(0, 10)
      const state = get()
      const existing = state.outletTransfers.find((t) => t.status === 'pending' && t.createdAt.slice(0, 10) === today)
      if (existing) {
        const newItems = [...existing.items, item]
        set((s) => ({
          outletTransfers: s.outletTransfers.map((t) => (t.id === existing.id ? { ...t, items: newItems } : t)),
        }))
        api.putOutletTransfer(existing.id, { items: newItems }).catch((err) => {
          set((s) => ({
            outletTransfers: s.outletTransfers.map((t) => (t.id === existing.id ? existing : t)),
          }))
          notifyLocalWriteFailure(set, get, 'Outlet transfer item was not saved', err)
          resyncAfterWriteFailure(get)
        })
      } else {
        const full = {
          id: generateId(),
          items: [item],
          createdBy,
          createdAt: new Date().toISOString(),
          status: 'pending',
          receivedAt: null,
          fromShop: state.activeUser?.shop ?? '',
          item_statuses: {},
        }
        set((s) => ({ outletTransfers: [full, ...s.outletTransfers] }))
        api.postOutletTransfer(full).catch((err) => {
          set((s) => ({ outletTransfers: s.outletTransfers.filter((t) => t.id !== full.id) }))
          notifyLocalWriteFailure(set, get, 'Outlet transfer was not saved', err)
          resyncAfterWriteFailure(get)
        })
      }
    },

    // ── Store transfers ───────────────────────────────────────────────────────

    addItemToStoreTransfer: (item, fromShop, toShop, createdBy) => {
      const today = new Date().toISOString().slice(0, 10)
      const state = get()
      const existing = state.storeTransfers.find(
        (t) => t.status === 'pending' && t.createdAt.slice(0, 10) === today && t.fromShop === fromShop && t.toShop === toShop
      )
      if (existing) {
        const newItems = [...existing.items, item]
        set((s) => ({
          storeTransfers: s.storeTransfers.map((t) => (t.id === existing.id ? { ...t, items: newItems } : t)),
        }))
        api.putStoreTransfer(existing.id, { items: newItems }).catch((err) => {
          set((s) => ({
            storeTransfers: s.storeTransfers.map((t) => (t.id === existing.id ? existing : t)),
          }))
          notifyLocalWriteFailure(set, get, 'Store transfer item was not saved', err)
          resyncAfterWriteFailure(get)
        })
      } else {
        const full = { id: generateId(), items: [item], fromShop, toShop, createdBy, createdAt: new Date().toISOString(), status: 'pending', receivedAt: null }
        set((s) => ({ storeTransfers: [full, ...s.storeTransfers] }))
        api.postStoreTransfer(full).catch((err) => {
          set((s) => ({ storeTransfers: s.storeTransfers.filter((t) => t.id !== full.id) }))
          notifyLocalWriteFailure(set, get, 'Store transfer was not saved', err)
          resyncAfterWriteFailure(get)
        })
      }
    },

    updateStoreTransfer: (transferId, changes) => {
      const prev = get().storeTransfers.find((t) => t.id === transferId)
      set((state) => ({
        storeTransfers: state.storeTransfers.map((t) => (t.id === transferId ? { ...t, ...changes } : t)),
      }))
      api.putStoreTransfer(transferId, changes).catch((err) => {
        if (prev) {
          set((state) => ({
            storeTransfers: state.storeTransfers.map((t) => (t.id === transferId ? prev : t)),
          }))
        }
        notifyLocalWriteFailure(set, get, 'Store transfer update was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    deleteStoreTransfer: async (transferId) => {
      const prevTransfers = get().storeTransfers
      set((state) => ({
        storeTransfers: state.storeTransfers.filter((t) => t.id !== transferId),
      }))
      try {
        await api.deleteStoreTransfer(transferId)
      } catch (err) {
        set({ storeTransfers: prevTransfers })
        notifyLocalWriteFailure(set, get, 'Store transfer was not deleted', err)
        resyncAfterWriteFailure(get)
        throw err
      }
    },

    /**
     * Create a complete transfer batch (used by the Transfer Builder page).
     * @param {'store'|'outlet'} type
     * @param {{ items, fromShop?, toShop?, assignedTo?, assignedToIds?, note? }} payload
     * Use `assignedToIds` for one or more managers; each gets an assignment and notification. `assignedTo` on the batch is stored as comma-separated ids.
     */
    createTransferBatch: (type, payload) => {
      const state = get()
      const id = generateId()
      const createdAt = new Date().toISOString()

      const assignmentTargets = Array.from(new Set(
        Array.isArray(payload.assignedToIds)
          ? payload.assignedToIds.filter(Boolean)
          : payload.assignedTo
            ? String(payload.assignedTo).split(',').map((id) => id.trim()).filter(Boolean)
            : [],
      ))

      const assignedToStored =
        assignmentTargets.length > 0 ? assignmentTargets.join(',') : null

      const base = {
        id,
        items: payload.items,
        createdBy: state.activeUser?.id ?? '',
        createdAt,
        status: 'pending',
        receivedAt: null,
        assignedTo: assignedToStored,
        note: payload.note ?? null,
        item_statuses: {},
      }
      if (type === 'outlet') {
        const full = { ...base, fromShop: payload.fromShop ?? state.activeUser?.shop ?? '' }
        set((s) => ({ outletTransfers: [full, ...s.outletTransfers] }))
        api.postOutletTransfer(full).catch((err) => {
          set((s) => ({
            outletTransfers: s.outletTransfers.filter((t) => t.id !== id),
            assignments: s.assignments.filter((a) => a.skuCode !== id),
            notifications: s.notifications.filter((n) => n.relatedId !== id),
            unreadCount: s.notifications
              .filter((n) => n.relatedId !== id ? !n.read : false)
              .length,
          }))
          notifyLocalWriteFailure(set, get, 'Transfer batch was not saved', err)
          resyncAfterWriteFailure(get)
        })
      } else {
        const full = { ...base, fromShop: payload.fromShop ?? '', toShop: payload.toShop ?? '' }
        set((s) => ({ storeTransfers: [full, ...s.storeTransfers] }))
        api.postStoreTransfer(full).catch((err) => {
          set((s) => ({
            storeTransfers: s.storeTransfers.filter((t) => t.id !== id),
            assignments: s.assignments.filter((a) => a.skuCode !== id),
            notifications: s.notifications.filter((n) => n.relatedId !== id),
            unreadCount: s.notifications
              .filter((n) => n.relatedId !== id ? !n.read : false)
              .length,
          }))
          notifyLocalWriteFailure(set, get, 'Transfer batch was not saved', err)
          resyncAfterWriteFailure(get)
        })
      }

      const totalUnits = (payload.items || []).reduce((s, i) => s + (i.totalQty ?? i.quantity ?? 0), 0)
      const productNames = (payload.items || []).map((i) => i.productName).filter(Boolean)
      const summary = productNames.length <= 3
        ? productNames.join(', ')
        : `${productNames.slice(0, 3).join(', ')} +${productNames.length - 3} more`
      const destination = type === 'outlet' ? 'Outlet' : (payload.toShop || '')
      const fromLabel = payload.fromShop || state.activeUser?.shop || '—'

      for (const uid of assignmentTargets) {
        get().addAssignment({
          type: type === 'outlet' ? 'outlet_move' : 'store_transfer',
          skuCode: id,
          productName: `Transfer to ${destination}: ${summary}`,
          assignedTo: uid,
          assignedBy: state.activeUser?.id ?? '',
          shop: destination,
          status: 'pending',
          note: payload.note
            ? `${totalUnits} units — ${payload.note}`
            : `${totalUnits} units to ${destination}`,
        })
      }

      const notifyMessage = `${state.activeUser?.name || 'Someone'} sent ${totalUnits} units (${summary}) from ${fromLabel} to ${destination}`
      get().addNotification({
        type: 'transfer_created',
        title: 'New Transfer Created',
        message: notifyMessage,
        userId: 'all',
        relatedId: id,
      })

      return id
    },
  }
}
