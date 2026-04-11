const BASE = '/api'

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (res.status === 401) {
    try { window.dispatchEvent(new CustomEvent('retailos:unauthorized')) } catch { /* */ }
    const err = new Error('Unauthorized')
    err.status = 401
    throw err
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    const e = new Error(err.error || res.statusText)
    e.status = res.status
    throw e
  }
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ── Health (public) ─────────────────────────────────────────────────────────

export async function checkHealth() {
  try {
    const res = await fetch(`${BASE}/health`, { method: 'GET', signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────

export async function authLogin(userCode, pin) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_code: userCode, pin }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Login failed' }))
    throw new Error(err.error || 'Login failed')
  }
  return res.json()
}

export async function fetchAuthMe() {
  return request('/auth/me')
}

export async function authLogout() {
  try {
    await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
  } catch { /* ignore */ }
}

// ── SKUs ────────────────────────────────────────────────────────────────────

export const fetchSkus = () => request('/skus')
export const postSkus = (skus) => request('/skus', { method: 'POST', body: JSON.stringify(skus) })
export const deleteImportSkus = (importId) => request(`/skus/import/${importId}`, { method: 'DELETE' })
export const fetchSkuImportTotals = () => request('/sku-import-totals')
export const fetchProductReport = (q) =>
  request(`/product-report?q=${encodeURIComponent(q ?? '')}`)

// ── Import history ──────────────────────────────────────────────────────────

export const fetchImportHistory = () => request('/import-history')
export const postImportRecord = (record) => request('/import-history', { method: 'POST', body: JSON.stringify(record) })
export const deleteImportById = (id) => request(`/import-history/${id}`, { method: 'DELETE' })

// ── Users ───────────────────────────────────────────────────────────────────

export const fetchUsers = () => request('/users')
export const postUser = (user) => request('/users', { method: 'POST', body: JSON.stringify(user) })
export const putUser = (id, changes) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(changes) })
export const deleteUser = (id) => request(`/users/${id}`, { method: 'DELETE' })

// ── Assignments ─────────────────────────────────────────────────────────────

export const fetchAssignments = () => request('/assignments')
export const postAssignment = (a) => request('/assignments', { method: 'POST', body: JSON.stringify(a) })
export const putAssignment = (id, changes) => request(`/assignments/${id}`, { method: 'PUT', body: JSON.stringify(changes) })

// ── Outlet transfers ────────────────────────────────────────────────────────

export const fetchOutletTransfers = () => request('/outlet-transfers')
export const postOutletTransfer = (t) => request('/outlet-transfers', { method: 'POST', body: JSON.stringify(t) })
export const putOutletTransfer = (id, changes) => request(`/outlet-transfers/${id}`, { method: 'PUT', body: JSON.stringify(changes) })

// ── Store transfers ─────────────────────────────────────────────────────────

export const fetchStoreTransfers = () => request('/store-transfers')
export const postStoreTransfer = (t) => request('/store-transfers', { method: 'POST', body: JSON.stringify(t) })
export const putStoreTransfer = (id, changes) => request(`/store-transfers/${id}`, { method: 'PUT', body: JSON.stringify(changes) })

// ── Sales snapshots ─────────────────────────────────────────────────────────

export const fetchSnapshots = () => request('/snapshots')
export const postSnapshot = (snap) => request('/snapshots', { method: 'POST', body: JSON.stringify(snap) })

// ── Sales events ─────────────────────────────────────────────────────────────

export const fetchSoldQuantityMap = () => request('/skus/sold-map')
export const postSalesEvents = (events) => request('/sales-events', { method: 'POST', body: JSON.stringify(events) })
export const fetchWeeklySales = (weeks = 8) => request(`/sales/weekly?weeks=${weeks}`)
export const fetchSalesBySku = (since, until) => {
  let url = `/sales/by-sku?since=${encodeURIComponent(since || '')}`
  if (until) url += `&until=${encodeURIComponent(until)}`
  return request(url)
}

// ── Shifts ──────────────────────────────────────────────────────────────────

export const fetchActiveShifts = () => request('/shifts/active')
export const fetchShiftHistory = (days = 7) => request(`/shifts/history?days=${days}`)
export const postClockIn = (data) => request('/shifts/clock-in', { method: 'POST', body: JSON.stringify(data) })
export const putClockOut = (shiftId) => request(`/shifts/${shiftId}/clock-out`, { method: 'PUT' })

// ── Notifications ──────────────────────────────────────────────────────────

export const fetchNotifications = () => request('/notifications')
export const postNotification = (n) => request('/notifications', { method: 'POST', body: JSON.stringify(n) })
export const putNotificationRead = (id) => request(`/notifications/${id}/read`, { method: 'PUT' })
export const putNotificationsReadAll = () => request('/notifications/read-all', { method: 'PUT' })

// ── Photos ──────────────────────────────────────────────────────────────────

export const fetchPhotoList = () => request('/photos')

export const getPhotoUrl = (skuCode) => `${BASE}/photos/${encodeURIComponent(skuCode)}`

export async function uploadPhoto(skuCode, file) {
  const form = new FormData()
  form.append('photo', file)
  const res = await fetch(`${BASE}/photos/${encodeURIComponent(skuCode)}`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  })
  if (res.status === 401) {
    try { window.dispatchEvent(new CustomEvent('retailos:unauthorized')) } catch { /* */ }
    throw new Error('Unauthorized')
  }
  if (!res.ok) throw new Error('Upload failed')
  return res.json()
}

export const deletePhoto = (skuCode) =>
  fetch(`${BASE}/photos/${encodeURIComponent(skuCode)}`, { method: 'DELETE', credentials: 'include' }).then(async (r) => {
    if (r.status === 401) {
      try { window.dispatchEvent(new CustomEvent('retailos:unauthorized')) } catch { /* */ }
      throw new Error('Unauthorized')
    }
    return r.json()
  })
