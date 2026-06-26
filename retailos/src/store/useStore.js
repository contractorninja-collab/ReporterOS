import { create } from 'zustand'
import * as api from '../api/client.js'
import { normalizeSeasonInput } from '../utils/seasons.js'

const EXTRA_SEASONS_KEY = 'retailos_extra_seasons'

function loadExtraSeasons() {
  try {
    const raw = localStorage.getItem(EXTRA_SEASONS_KEY)
    if (!raw) return []
    const p = JSON.parse(raw)
    if (!Array.isArray(p)) return []
    return [...new Set(p.map((x) => normalizeSeasonInput(x)).filter(Boolean))]
  } catch {
    return []
  }
}

function persistExtraSeasons(arr) {
  try {
    localStorage.setItem(EXTRA_SEASONS_KEY, JSON.stringify(arr))
  } catch {
    /* ignore */
  }
}

function asArray(v) {
  return Array.isArray(v) ? v : []
}

/** Plain object map; rejects null and arrays (typeof null === 'object' in JS). */
function asRecord(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

function generateId() {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Strip secrets before persisting or restoring session snapshot. */
function publicUser(u) {
  if (!u) return null
  const { pin: _p, pin_plain: _pp, ...rest } = u
  return rest
}

function restoreActiveUser() {
  try {
    const raw = localStorage.getItem('retailos_active_user')
    if (raw) return publicUser(JSON.parse(raw))
  } catch { /* ignore */ }
  return null
}

const useStore = create((set, get) => ({
  _ready: false,
  _apiOnline: true,

  skus: [],
  importHistory: [],
  activeSeason: 'SS26',
  extraSeasons: loadExtraSeasons(),
  activeCategory: 'all',
  activeGender: 'all',

  users: [],
  activeUser: restoreActiveUser(),
  assignments: [],
  outletTransfers: [],
  storeTransfers: [],
  markdownLists: [],
  saleChangeReports: [],
  salesSnapshots: [],

  notifications: [],
  unreadCount: 0,

  activeShifts: [],
  myShift: null,

  photoMap: {},
  photoCount: 0,
  /** @type {Record<string, number>} sku code -> lifetime units imported */
  skuImportTotals: {},
  /** @type {Record<string, object>} sku code -> shipment dates / season meta */
  shipmentMeta: {},
  /** @type {Array<{week: string, weekLabel: string, totalUnits: number, totalRevenue: number}>} */
  weeklySales: [],

  // ── Bootstrap from server ───────────────────────────────────────────────

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
      const list = asArray(photoList)
      const photoMap = {}
      for (const code of list) {
        photoMap[code] = api.getPhotoUrl(code)
      }
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
        photoMap,
        photoCount: list.length,
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

  syncFromServer: async () => {
    const online = await api.checkHealth()
    if (!online) {
      if (get()._apiOnline) set({ _apiOnline: false })
      return
    }
    try {
      if (!get()._apiOnline) set({ _apiOnline: true })
      const [users, assignments, outletTransfers, storeTransfers, markdownLists, saleChangeReports, photoList, freshSkus, importHistory, weeklySales, salesSnapshots, notifs, shifts] = await Promise.all([
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
      if (Array.isArray(photoList)) {
        const photoMap = {}
        for (const code of photoList) photoMap[code] = api.getPhotoUrl(code)
        updates.photoMap = photoMap
        updates.photoCount = photoList.length
      }
      if (Array.isArray(freshSkus)) updates.skus = freshSkus
      if (Array.isArray(importHistory)) updates.importHistory = importHistory
      if (Array.isArray(weeklySales)) updates.weeklySales = weeklySales
      if (Array.isArray(salesSnapshots)) updates.salesSnapshots = salesSnapshots
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
  },

  // ── Users ─────────────────────────────────────────────────────────────────

  addUser: (user) => {
    const full = { ...user, id: user.id || generateId() }
    const optimistic = publicUser(full)
    set((state) => ({ users: [...state.users, optimistic] }))
    api.postUser(full)
      .then((created) => {
        set((state) => ({
          users: state.users.map((u) => (u.id === optimistic.id ? created : u)),
        }))
      })
      .catch(() => {
        set((state) => ({ users: state.users.filter((u) => u.id !== optimistic.id) }))
      })
  },

  removeUser: (userId) => {
    const wasActive = get().activeUser?.id === userId
    set((state) => ({
      users: state.users.filter((u) => u.id !== userId),
      activeUser: state.activeUser?.id === userId ? null : state.activeUser,
    }))
    if (wasActive) {
      try { localStorage.removeItem('retailos_active_user') } catch { /* */ }
      api.authLogout().catch(() => {})
    }
    api.deleteUser(userId).catch(() => {})
  },

  updateUser: (userId, changes) => {
    const prev = get().users.find((u) => u.id === userId)
    const localChanges = publicUser({ ...changes })
    set((state) => {
      const merged = state.activeUser?.id === userId ? publicUser({ ...state.activeUser, ...localChanges }) : state.activeUser
      if (state.activeUser?.id === userId) {
        try { localStorage.setItem('retailos_active_user', JSON.stringify(merged)) } catch { /* */ }
      }
      return {
        users: state.users.map((u) => (u.id === userId ? publicUser({ ...u, ...localChanges }) : u)),
        activeUser: merged,
      }
    })
    api.putUser(userId, changes)
      .then((serverUser) => {
        if (!serverUser) return
        set((state) => ({
          users: state.users.map((u) => (u.id === userId ? serverUser : u)),
          activeUser: state.activeUser?.id === userId ? serverUser : state.activeUser,
        }))
        if (get().activeUser?.id === userId) {
          try { localStorage.setItem('retailos_active_user', JSON.stringify(publicUser(serverUser))) } catch { /* */ }
        }
      })
      .catch(() => {
        if (prev) {
          set((state) => {
            const rolledBack = state.activeUser?.id === userId ? prev : state.activeUser
            if (state.activeUser?.id === userId) {
              try { localStorage.setItem('retailos_active_user', JSON.stringify(publicUser(rolledBack))) } catch { /* */ }
            }
            return {
              users: state.users.map((u) => (u.id === userId ? prev : u)),
              activeUser: rolledBack,
            }
          })
        }
      })
  },

  regenerateUserPin: (userId) => {
    api.regenerateUserPin(userId)
      .then((serverUser) => {
        if (!serverUser) return
        set((state) => ({
          users: state.users.map((u) => (u.id === userId ? serverUser : u)),
          activeUser: state.activeUser?.id === userId ? publicUser(serverUser) : state.activeUser,
        }))
        if (get().activeUser?.id === userId) {
          try { localStorage.setItem('retailos_active_user', JSON.stringify(publicUser(serverUser))) } catch { /* */ }
        }
      })
      .catch(() => {})
  },

  setActiveUser: (user) => {
    if (!user) {
      api.authLogout().catch(() => {})
      try { localStorage.removeItem('retailos_active_user') } catch { /* */ }
      set({ activeUser: null })
      return
    }
    const safe = publicUser(user)
    set({ activeUser: safe })
    try { localStorage.setItem('retailos_active_user', JSON.stringify(safe)) } catch { /* */ }
  },

  // ── Assignments ───────────────────────────────────────────────────────────

  addAssignment: (assignment) => {
    const full = { ...assignment, id: assignment.id || generateId(), createdAt: new Date().toISOString(), completedAt: null }
    set((state) => ({ assignments: [full, ...state.assignments] }))
    api.postAssignment(full).catch(() => {})
  },

  /** Many tasks in one React update + one API call (e.g. large CSV import photo reminders). */
  addAssignments: (assignments) => {
    if (!assignments?.length) return
    const enriched = assignments.map((a) => ({
      ...a,
      id: a.id || generateId(),
      createdAt: new Date().toISOString(),
      completedAt: null,
    }))
    set((state) => ({ assignments: [...enriched, ...state.assignments] }))
    api.postAssignmentsBulk(enriched).catch(() => {})
  },

  updateAssignment: (assignmentId, changes) => {
    set((state) => ({
      assignments: state.assignments.map((a) => (a.id === assignmentId ? { ...a, ...changes } : a)),
    }))
    api.putAssignment(assignmentId, changes).catch(() => {})
  },

  completePhotoAssignmentsForSkus: (skuCodes) => {
    const codeSet = new Set((skuCodes || []).map((x) => String(x ?? '').trim()).filter(Boolean))
    if (codeSet.size === 0) return
    const now = new Date().toISOString()
    set((state) => ({
      assignments: state.assignments.map((a) => (
        a.type === 'photo_needed' && a.status === 'pending' && codeSet.has(String(a.skuCode ?? '').trim())
          ? { ...a, status: 'done', completedAt: now }
          : a
      )),
    }))
    api.completePhotoTasks([...codeSet]).catch(() => {})
  },

  completeAssignmentsForTransfer: (transferId) => {
    const now = new Date().toISOString()
    for (const a of get().assignments) {
      if ((a.type === 'store_transfer' || a.type === 'outlet_move') && a.skuCode === transferId && a.status !== 'done') {
        get().updateAssignment(a.id, { status: 'done', completedAt: now })
      }
    }
  },

  // ── Outlet transfers ──────────────────────────────────────────────────────

  addOutletTransfer: (transfer) => {
    const full = { ...transfer, id: transfer.id || generateId(), createdAt: new Date().toISOString(), receivedAt: null }
    set((state) => ({ outletTransfers: [full, ...state.outletTransfers] }))
    api.postOutletTransfer(full).catch(() => {})
  },

  updateOutletTransfer: (transferId, changes) => {
    set((state) => ({
      outletTransfers: state.outletTransfers.map((t) => (t.id === transferId ? { ...t, ...changes } : t)),
    }))
    api.putOutletTransfer(transferId, changes).catch(() => {})
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
      api.putOutletTransfer(existing.id, { items: newItems }).catch(() => {})
    } else {
      const full = { id: generateId(), items: [item], createdBy, createdAt: new Date().toISOString(), status: 'pending', receivedAt: null }
      set((s) => ({ outletTransfers: [full, ...s.outletTransfers] }))
      api.postOutletTransfer(full).catch(() => {})
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
      api.putStoreTransfer(existing.id, { items: newItems }).catch(() => {})
    } else {
      const full = { id: generateId(), items: [item], fromShop, toShop, createdBy, createdAt: new Date().toISOString(), status: 'pending', receivedAt: null }
      set((s) => ({ storeTransfers: [full, ...s.storeTransfers] }))
      api.postStoreTransfer(full).catch(() => {})
    }
  },

  updateStoreTransfer: (transferId, changes) => {
    set((state) => ({
      storeTransfers: state.storeTransfers.map((t) => (t.id === transferId ? { ...t, ...changes } : t)),
    }))
    api.putStoreTransfer(transferId, changes).catch(() => {})
  },

  /**
   * Create a complete transfer batch (used by the Transfer Builder page).
   * @param {'store'|'outlet'} type
   * @param {{ items, fromShop?, toShop?, assignedTo?, assignedToIds?, note? }} payload
   * For outlet: use `assignedToIds` (Ring Mall & Village managers); each gets an assignment and notification. `assignedTo` on the batch is stored as comma-separated ids.
   */
  createTransferBatch: (type, payload) => {
    const state = get()
    const id = generateId()
    const createdAt = new Date().toISOString()

    const assignmentTargets =
      type === 'outlet'
        ? (Array.isArray(payload.assignedToIds) ? payload.assignedToIds.filter(Boolean) : [])
        : payload.assignedTo
          ? [payload.assignedTo]
          : []

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
    }
    if (type === 'outlet') {
      set((s) => ({ outletTransfers: [base, ...s.outletTransfers] }))
      api.postOutletTransfer(base).catch(() => {})
    } else {
      const full = { ...base, fromShop: payload.fromShop ?? '', toShop: payload.toShop ?? '' }
      set((s) => ({ storeTransfers: [full, ...s.storeTransfers] }))
      api.postStoreTransfer(full).catch(() => {})
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
    if (assignmentTargets.length > 0) {
      for (const uid of assignmentTargets) {
        get().addNotification({
          type: 'transfer_created',
          title: 'New Transfer Created',
          message: notifyMessage,
          userId: uid,
          relatedId: id,
        })
      }
    } else {
      get().addNotification({
        type: 'transfer_created',
        title: 'New Transfer Created',
        message: notifyMessage,
        userId: 'all',
        relatedId: id,
      })
    }

    return id
  },

  // ── Markdown / sale lists ──────────────────────────────────────────────────

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
    api.postMarkdownList(full).catch(() => {})

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
    set((state) => ({
      markdownLists: state.markdownLists.map((l) => (l.id === listId ? { ...l, status: 'ended' } : l)),
      skus: state.skus.map((row) => (row.sale_list_id === listId
        ? { ...row, sale_active: 0, sale_percent: null, sale_list_id: null }
        : row)),
    }))
    api.putMarkdownList(listId, { status: 'ended' }).catch(() => {})
  },

  updateMarkdownList: (listId, changes) => {
    set((state) => ({
      markdownLists: state.markdownLists.map((l) => (l.id === listId ? { ...l, ...changes } : l)),
    }))
    api.putMarkdownList(listId, changes).catch(() => {})
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
    api.putMarkdownList(listId, { items: merged }).catch(() => {})
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
    set((state) => ({
      markdownLists: state.markdownLists.filter((l) => l.id !== listId),
      skus: state.skus.map((row) => (row.sale_list_id === listId
        ? { ...row, sale_active: 0, sale_percent: null, sale_list_id: null }
        : row)),
    }))
    api.deleteMarkdownList(listId).catch(() => {})
  },

  // ── Sales snapshots ───────────────────────────────────────────────────────

  addSalesSnapshot: (snapshot) => {
    const full = { ...snapshot, id: snapshot.id || generateId(), timestamp: snapshot.timestamp || new Date().toISOString() }
    set((state) => ({ salesSnapshots: [...state.salesSnapshots, full] }))
    api.postSnapshot(full).catch(() => {})
  },

  // ── Notifications ──────────────────────────────────────────────────────────

  fetchNotifications: async () => {
    try {
      const data = await api.fetchNotifications()
      const arr = asArray(data)
      set({ notifications: arr, unreadCount: arr.filter((n) => !n.read).length })
    } catch { /* ignore */ }
  },

  addNotification: async (notification) => {
    const n = { ...notification, id: notification.id || generateId(), createdAt: notification.createdAt || new Date().toISOString(), read: 0 }
    set((state) => ({
      notifications: [n, ...state.notifications],
      unreadCount: state.unreadCount + 1,
    }))
    try { await api.postNotification(n) } catch { /* ignore */ }
  },

  markNotificationRead: async (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: 1 } : n)),
      unreadCount: Math.max(0, state.unreadCount - (state.notifications.find((n) => n.id === id && !n.read) ? 1 : 0)),
    }))
    try { await api.putNotificationRead(id) } catch { /* ignore */ }
  },

  markAllNotificationsRead: async () => {
    try {
      await api.putNotificationsReadAll()
      const notifs = await api.fetchNotifications()
      const arr = asArray(notifs)
      set({
        notifications: arr,
        unreadCount: arr.filter((n) => !n.read).length,
      })
    } catch { /* ignore */ }
  },

  // ── Shifts ────────────────────────────────────────────────────────────────

  clockIn: async () => {
    const user = get().activeUser
    if (!user || user.role === 'executive') return null
    const id = generateId()
    const shift = { id, user_id: user.id, user_name: user.name, shop: user.shop, clock_in: new Date().toISOString(), clock_out: null, duration_min: null }
    set((s) => ({
      activeShifts: [...s.activeShifts, shift],
      myShift: shift,
    }))
    try { await api.postClockIn({ id, userId: user.id, userName: user.name, shop: user.shop }) } catch { /* ignore */ }
    get().addNotification({
      type: 'shift_clock_in',
      title: 'Shift Started',
      message: `${user.name} clocked in at ${user.shop}`,
      userId: 'executives',
      relatedId: id,
    })
    return shift
  },

  clockOut: async () => {
    const shift = get().myShift
    if (!shift) return null
    const user = get().activeUser
    const now = new Date()
    const durationMin = Math.round((now.getTime() - new Date(shift.clock_in).getTime()) / 60000)
    const updated = { ...shift, clock_out: now.toISOString(), duration_min: durationMin }
    set((s) => ({
      activeShifts: s.activeShifts.filter((sh) => sh.id !== shift.id),
      myShift: null,
    }))
    try { await api.putClockOut(shift.id) } catch { /* ignore */ }
    get().addNotification({
      type: 'shift_clock_out',
      title: 'Shift Ended',
      message: `${user?.name || 'User'} clocked out from ${shift.shop} (${Math.floor(durationMin / 60)}h ${durationMin % 60}m)`,
      userId: 'executives',
      relatedId: shift.id,
    })
    return updated
  },

  fetchActiveShifts: async () => {
    try {
      const data = await api.fetchActiveShifts()
      const arr = asArray(data)
      const me = get().activeUser
      set({ activeShifts: arr, myShift: me ? arr.find((s) => s.user_id === me.id) || null : null })
    } catch { /* ignore */ }
  },

  // ── Photos ────────────────────────────────────────────────────────────────

  setPhotoMap: (map) => set({ photoMap: map }),

  addPhotoToMap: (skuCode, url) =>
    set((state) => ({ photoMap: { ...state.photoMap, [skuCode]: url } })),

  removePhotoFromMap: (skuCode) => {
    set((state) => {
      const next = { ...state.photoMap }
      delete next[skuCode]
      return { photoMap: next }
    })
    api.deletePhoto(skuCode).catch(() => {})
  },

  setPhotoCount: (count) => set({ photoCount: count }),

  getPhotoUrl: (skuCode) => get().photoMap[skuCode] ?? null,

  // ── SKUs ──────────────────────────────────────────────────────────────────

  setSkus: (skus) => set({ skus }),

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
      const [fresh, totals, meta] = await Promise.all([
        api.fetchSkus(),
        api.fetchSkuImportTotals().catch(() => null),
        api.fetchShipmentMeta().catch(() => null),
      ])
      const patch = {}
      if (Array.isArray(fresh)) patch.skus = fresh
      if (totals != null) patch.skuImportTotals = asRecord(totals)
      if (meta != null) patch.shipmentMeta = asRecord(meta)
      if (Object.keys(patch).length) set(patch)
    } catch {
      /* offline — keep merged local */
    }
    return postResult?.seasonRollover ?? null
  },

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
}))

export default useStore
export { useStore }
