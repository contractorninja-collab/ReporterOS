import { create } from 'zustand'
import * as api from '../api/client.js'

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

const DEFAULT_USERS = [
  { id: 'u-mgr-s1a', name: 'Manager 1 – Ring Mall', role: 'manager', shop: 'Ring Mall', pin: '1111', user_code: '10001' },
  { id: 'u-mgr-s1b', name: 'Manager 2 – Ring Mall', role: 'manager', shop: 'Ring Mall', pin: '1112', user_code: '10002' },
  { id: 'u-mgr-s2a', name: 'Manager 1 – Village', role: 'manager', shop: 'Village', pin: '2221', user_code: '20001' },
  { id: 'u-mgr-s2b', name: 'Manager 2 – Village', role: 'manager', shop: 'Village', pin: '2222', user_code: '20002' },
  { id: 'u-ceo', name: 'CEO', role: 'executive', shop: null, pin: '9001', user_code: '90001' },
  { id: 'u-coo', name: 'COO', role: 'executive', shop: null, pin: '9002', user_code: '90002' },
  { id: 'u-cto', name: 'CTO', role: 'executive', shop: null, pin: '9003', user_code: '90003' },
  { id: 'u-outlet', name: 'Outlet Manager', role: 'outlet', shop: 'Outlet', pin: '8001', user_code: '80001' },
]

/** Strip secrets before persisting or restoring session snapshot. */
function publicUser(u) {
  if (!u) return null
  const { pin: _p, ...rest } = u
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
  activeCategory: 'all',
  activeGender: 'all',

  users: [],
  activeUser: restoreActiveUser(),
  assignments: [],
  outletTransfers: [],
  storeTransfers: [],
  salesSnapshots: [],

  notifications: [],
  unreadCount: 0,

  activeShifts: [],
  myShift: null,

  photoMap: {},
  photoCount: 0,
  /** @type {Record<string, number>} sku code -> lifetime units imported */
  skuImportTotals: {},
  /** @type {Array<{week: string, weekLabel: string, totalUnits: number, totalRevenue: number}>} */
  weeklySales: [],

  // ── Bootstrap from server ───────────────────────────────────────────────

  initFromServer: async () => {
    const online = await api.checkHealth()
    if (!online) {
      set({
        _ready: true,
        _apiOnline: false,
        users: DEFAULT_USERS,
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
      set({ _ready: true, _apiOnline: false, users: DEFAULT_USERS })
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
      const [skus, importHistory, users, assignments, outletTransfers, storeTransfers, salesSnapshots, photoList, skuImportTotals, weeklySales, notifs, shifts] =
        await Promise.all([
          api.fetchSkus().catch(() => []),
          api.fetchImportHistory().catch(() => []),
          api.fetchUsers().catch(() => null),
          api.fetchAssignments().catch(() => []),
          api.fetchOutletTransfers().catch(() => []),
          api.fetchStoreTransfers().catch(() => []),
          api.fetchSnapshots().catch(() => []),
          api.fetchPhotoList().catch(() => []),
          api.fetchSkuImportTotals().catch(() => ({})),
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
        users: asArray(users).length ? users : [],
        assignments: asArray(assignments),
        outletTransfers: asArray(outletTransfers),
        storeTransfers: asArray(storeTransfers),
        salesSnapshots: asArray(salesSnapshots),
        photoMap,
        photoCount: list.length,
        skuImportTotals: asRecord(skuImportTotals),
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
      set({ _ready: true, _apiOnline: false, users: DEFAULT_USERS, activeUser })
    }
  },

  refreshSkuImportTotals: async () => {
    try {
      const totals = await api.fetchSkuImportTotals()
      set({ skuImportTotals: asRecord(totals) })
    } catch { /* ignore */ }
  },

  refreshWeeklySales: async () => {
    try {
      const data = await api.fetchWeeklySales(8)
      set({ weeklySales: asArray(data) })
    } catch { /* ignore */ }
  },

  syncFromServer: async () => {
    const online = await api.checkHealth()
    if (!online) {
      if (get()._apiOnline) set({ _apiOnline: false })
      return
    }
    try {
      if (!get()._apiOnline) set({ _apiOnline: true })
      const syncActiveUser = get().activeUser
      const [users, assignments, outletTransfers, storeTransfers, photoList, freshSkus, weeklySales, salesSnapshots, notifs, shifts] = await Promise.all([
        api.fetchUsers().catch(() => null),
        api.fetchAssignments().catch(() => null),
        api.fetchOutletTransfers().catch(() => null),
        api.fetchStoreTransfers().catch(() => null),
        api.fetchPhotoList().catch(() => null),
        api.fetchSkus().catch(() => null),
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
      if (Array.isArray(photoList)) {
        const photoMap = {}
        for (const code of photoList) photoMap[code] = api.getPhotoUrl(code)
        updates.photoMap = photoMap
        updates.photoCount = photoList.length
      }
      if (Array.isArray(freshSkus)) updates.skus = freshSkus
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

  updateAssignment: (assignmentId, changes) => {
    set((state) => ({
      assignments: state.assignments.map((a) => (a.id === assignmentId ? { ...a, ...changes } : a)),
    }))
    api.putAssignment(assignmentId, changes).catch(() => {})
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

  addSkus: (newSkus) => {
    set((state) => {
      const map = new Map(state.skus.map((s) => [`${s.sku}|${s.size ?? ''}`, s]))
      for (const s of newSkus) {
        const key = `${s.sku}|${s.size ?? ''}`
        const prev = map.get(key)
        map.set(key, prev ? { ...prev, ...s } : { ...s, id: s.id || generateId() })
      }
      return { skus: [...map.values()] }
    })
    api.postSkus(newSkus).catch(() => {})
  },

  updateSku: (skuCode, changes) =>
    set((state) => ({
      skus: state.skus.map((sku) => (sku.sku === skuCode ? { ...sku, ...changes } : sku)),
    })),

  clearSkus: () => set({ skus: [] }),

  setActiveSeason: (season) => set({ activeSeason: season }),
  setActiveCategory: (cat) => set({ activeCategory: cat }),
  setActiveGender: (gender) => set({ activeGender: gender }),

  addImportRecord: (record) => {
    const full = { ...record, id: record.id || generateId() }
    set((state) => ({ importHistory: [full, ...state.importHistory] }))
    api.postImportRecord(full).catch(() => {})
  },

  deleteImport: (importId) => {
    set((state) => ({
      skus: state.skus.filter((s) => s._importId !== importId),
      importHistory: state.importHistory.filter((r) => r.id !== importId),
    }))
    api.deleteImportById(importId).then(() => get().refreshSkuImportTotals()).catch(() => {})
  },
}))

export default useStore
export { useStore }
