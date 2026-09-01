import * as api from '../../api/client.js'
import {
  generateId,
  notifyLocalWriteFailure,
  resyncAfterWriteFailure,
} from '../storeHelpers.js'
import {
  clearOutletItemStatuses,
  findTodayPendingOutletTransfer,
  unavailableOutletSkuCodes,
  upsertOutletTransferItem,
  upsertOutletTransferItems,
} from '../../utils/outletTransfers.js'

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
      api.postOutletTransfer(full).then((saved) => {
        if (saved?.id) {
          set((state) => ({
            outletTransfers: state.outletTransfers.map((t) => (t.id === full.id ? saved : t)),
          }))
        }
        get().syncOperationalData?.().catch(() => {})
      }).catch((err) => {
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
      return api.putOutletTransfer(transferId, changes)
        .then((result) => {
          const updatedTransfer = result?.transfer || result
          const ecommerceSale = result?.ecommerceSale
          const locationChange = result?.locationChange
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
          if (locationChange?.list) {
            set((state) => ({
              markdownLists: [
                locationChange.list,
                ...state.markdownLists.filter((l) => l.id !== locationChange.list.id),
              ],
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
          throw err
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

    addItemToTodayTransfer: async (item, createdBy, fromShop) => {
      const state = get()
      const conflicts = unavailableOutletSkuCodes([item], state.outletTransfers, state.markdownLists)
      if (conflicts.length) throw new Error(`${conflicts[0]} is already assigned to Outlet or an active Outlet transfer`)
      const sourceShop = String(fromShop ?? state.activeUser?.shop ?? '').trim()
      if (!sourceShop) throw new Error('Choose the store sending this product to Outlet')
      const existing = findTodayPendingOutletTransfer(state.outletTransfers, sourceShop)
      if (existing) {
        const newItems = upsertOutletTransferItem(existing.items, item)
        const itemStatuses = clearOutletItemStatuses(existing.item_statuses, item.skuCode)
        const changes = { items: newItems, item_statuses: itemStatuses }
        set((s) => ({
          outletTransfers: s.outletTransfers.map((t) => (t.id === existing.id ? { ...t, ...changes } : t)),
        }))
        try {
          const result = await api.putOutletTransfer(existing.id, changes)
          const saved = result?.transfer || result
          if (saved?.id) {
            set((s) => ({
              outletTransfers: s.outletTransfers.map((t) => (t.id === existing.id ? saved : t)),
            }))
          }
          get().syncOperationalData?.().catch(() => {})
          return saved
        } catch (err) {
          set((s) => ({
            outletTransfers: s.outletTransfers.map((t) => (t.id === existing.id ? existing : t)),
          }))
          notifyLocalWriteFailure(set, get, 'Outlet transfer item was not saved', err)
          resyncAfterWriteFailure(get)
          throw err
        }
      } else {
        const full = {
          id: generateId(),
          items: [item],
          createdBy,
          createdAt: new Date().toISOString(),
          status: 'pending',
          receivedAt: null,
          fromShop: sourceShop,
          item_statuses: {},
        }
        set((s) => ({ outletTransfers: [full, ...s.outletTransfers] }))
        try {
          const saved = await api.postOutletTransfer(full)
          if (saved?.id) {
            set((s) => ({
              outletTransfers: s.outletTransfers.map((t) => (t.id === full.id ? saved : t)),
            }))
          }
          get().syncOperationalData?.().catch(() => {})
          return saved
        } catch (err) {
          set((s) => ({ outletTransfers: s.outletTransfers.filter((t) => t.id !== full.id) }))
          notifyLocalWriteFailure(set, get, 'Outlet transfer was not saved', err)
          resyncAfterWriteFailure(get)
          throw err
        }
      }
    },

    // ── Store transfers ───────────────────────────────────────────────────────

    addItemToStoreTransfer: (item, fromShop, toShop, createdBy) => {
      const today = new Date().toISOString().slice(0, 10)
      const state = get()
      const conflicts = unavailableOutletSkuCodes([item], state.outletTransfers, state.markdownLists)
      if (conflicts.length) throw new Error(`${conflicts[0]} is already assigned to Outlet or an active Outlet transfer`)
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
      return api.putStoreTransfer(transferId, changes).then((updated) => {
        if (updated?.id) {
          set((state) => ({ storeTransfers: state.storeTransfers.map((t) => (t.id === transferId ? updated : t)) }))
        }
        return updated
      }).catch((err) => {
        if (prev) {
          set((state) => ({
            storeTransfers: state.storeTransfers.map((t) => (t.id === transferId ? prev : t)),
          }))
        }
        notifyLocalWriteFailure(set, get, 'Store transfer update was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    verifyStoreTransferLine: async (transferId, payload) => {
      try {
        const updated = await api.patchStoreTransferVerification(transferId, payload)
        set((state) => ({ storeTransfers: state.storeTransfers.map((t) => (t.id === transferId ? updated : t)) }))
        return updated
      } catch (err) {
        notifyLocalWriteFailure(set, get, 'Size confirmation was not saved', err)
        resyncAfterWriteFailure(get)
        throw err
      }
    },

    markStoreTransferSent: async (transferId) => {
      try {
        const updated = await api.markStoreTransferSent(transferId)
        set((state) => ({ storeTransfers: state.storeTransfers.map((t) => (t.id === transferId ? updated : t)) }))
        get().syncOperationalData?.().catch(() => {})
        return updated
      } catch (err) {
        notifyLocalWriteFailure(set, get, 'Transfer was not marked as sent', err)
        resyncAfterWriteFailure(get)
        throw err
      }
    },

    markStoreTransferReceived: async (transferId) => {
      try {
        const updated = await api.markStoreTransferReceived(transferId)
        set((state) => ({ storeTransfers: state.storeTransfers.map((t) => (t.id === transferId ? updated : t)) }))
        get().syncOperationalData?.().catch(() => {})
        return updated
      } catch (err) {
        notifyLocalWriteFailure(set, get, 'Transfer was not marked as received', err)
        resyncAfterWriteFailure(get)
        throw err
      }
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
     * Use `assignedToIds` for one or more managers; each gets an assignment. `assignedTo` on the batch is stored as comma-separated ids.
     */
    createTransferBatch: (type, payload) => {
      const state = get()
      const conflicts = unavailableOutletSkuCodes(payload.items, state.outletTransfers, state.markdownLists)
      if (conflicts.length) {
        const shown = conflicts.slice(0, 3).join(', ')
        const extra = conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ''
        throw new Error(`${shown}${extra} already belong to Outlet or an active Outlet transfer`)
      }
      const createdAt = new Date().toISOString()
      const sourceShop = String(payload.fromShop ?? state.activeUser?.shop ?? '').trim()
      const existingOutletTransfer = type === 'outlet'
        ? findTodayPendingOutletTransfer(state.outletTransfers, sourceShop, new Date(createdAt))
        : null
      const id = existingOutletTransfer?.id || generateId()

      const assignmentTargets = Array.from(new Set(
        Array.isArray(payload.assignedToIds)
          ? payload.assignedToIds.filter(Boolean)
          : payload.assignedTo
            ? String(payload.assignedTo).split(',').map((id) => id.trim()).filter(Boolean)
            : [],
      ))

      const existingAssignmentTargets = String(existingOutletTransfer?.assignedTo || '')
        .split(',')
        .map((userId) => userId.trim())
        .filter(Boolean)
      const allAssignmentTargets = Array.from(new Set([
        ...existingAssignmentTargets,
        ...assignmentTargets,
      ]))
      const assignedToStored = allAssignmentTargets.length > 0 ? allAssignmentTargets.join(',') : null

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
      let outletSavePromise = null
      if (type === 'outlet') {
        if (existingOutletTransfer) {
          const items = upsertOutletTransferItems(existingOutletTransfer.items, payload.items)
          const itemStatuses = (payload.items || []).reduce(
            (statuses, item) => clearOutletItemStatuses(statuses, item.skuCode),
            existingOutletTransfer.item_statuses,
          )
          const incomingNote = String(payload.note || '').trim()
          const previousNote = String(existingOutletTransfer.note || '').trim()
          const note = incomingNote && incomingNote !== previousNote
            ? [previousNote, incomingNote].filter(Boolean).join('\n')
            : (previousNote || incomingNote || null)
          const changes = { items, item_statuses: itemStatuses, assignedTo: assignedToStored, note }
          set((s) => ({
            outletTransfers: s.outletTransfers.map((transfer) => (
              transfer.id === id ? { ...transfer, ...changes } : transfer
            )),
          }))
          outletSavePromise = api.putOutletTransfer(id, changes).then((result) => {
            const saved = result?.transfer || result
            if (saved?.id) {
              set((s) => ({
                outletTransfers: s.outletTransfers.map((transfer) => (transfer.id === id ? saved : transfer)),
              }))
            }
            get().syncOperationalData?.().catch(() => {})
            return saved
          }).catch((err) => {
            set((s) => ({
              outletTransfers: s.outletTransfers.map((transfer) => (
                transfer.id === id ? existingOutletTransfer : transfer
              )),
            }))
            notifyLocalWriteFailure(set, get, 'Transfer batch was not saved', err)
            resyncAfterWriteFailure(get)
            throw err
          })
        } else {
          const full = { ...base, fromShop: sourceShop }
          set((s) => ({ outletTransfers: [full, ...s.outletTransfers] }))
          outletSavePromise = api.postOutletTransfer(full).then((saved) => {
            if (saved?.id) {
              set((s) => ({
                outletTransfers: s.outletTransfers.map((transfer) => (transfer.id === id ? saved : transfer)),
              }))
            }
            get().syncOperationalData?.().catch(() => {})
            return saved
          }).catch((err) => {
            set((s) => ({ outletTransfers: s.outletTransfers.filter((transfer) => transfer.id !== id) }))
            notifyLocalWriteFailure(set, get, 'Transfer batch was not saved', err)
            resyncAfterWriteFailure(get)
            throw err
          })
        }
      } else {
        const full = {
          ...base, fromShop: payload.fromShop ?? '', toShop: payload.toShop ?? '',
          workflow_version: 2, send_item_statuses: {}, sentAt: null, sentBy: null,
          receivedBy: null, receiverAssignedTo: null,
        }
        set((s) => ({ storeTransfers: [full, ...s.storeTransfers] }))
        api.postStoreTransfer(full).then((saved) => {
          set((s) => ({ storeTransfers: s.storeTransfers.map((t) => (t.id === id ? saved : t)) }))
          get().syncOperationalData?.().catch(() => {})
        }).catch((err) => {
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

      if (type === 'outlet') {
        outletSavePromise?.then(() => {
          for (const uid of assignmentTargets) {
            get().addAssignment({
              type: 'outlet_move',
              skuCode: id,
              productName: `Transfer to ${destination}: ${summary}`,
              assignedTo: uid,
              assignedBy: state.activeUser?.id ?? '',
              shop: sourceShop,
              status: 'pending',
              note: payload.note
                ? `${totalUnits} units — ${payload.note}`
                : `${totalUnits} units to ${destination}`,
            })
          }

          const action = existingOutletTransfer ? 'added' : 'sent'
          const notifyMessage = `${state.activeUser?.name || 'Someone'} ${action} ${totalUnits} units (${summary}) from ${fromLabel} to ${destination}`
          get().addNotification({
            type: 'transfer_created',
            title: existingOutletTransfer ? 'Transfer Updated' : 'New Transfer Created',
            message: notifyMessage,
            userId: 'all',
            relatedId: id,
          })
        }).catch(() => {})
      }

      return id
    },
  }
}
