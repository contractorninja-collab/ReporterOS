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
export const postAssignmentsBulk = (assignments) =>
  request('/assignments/bulk', { method: 'POST', body: JSON.stringify(assignments) })
export const deleteImportSkus = (importId) => request(`/skus/import/${importId}`, { method: 'DELETE' })

export const deleteSku = (code) => request(`/skus/${encodeURIComponent(code)}`, { method: 'DELETE' })
export const fetchBinnedSkus = () => request('/skus/bin')
export const restoreSku = (code) => request(`/skus/${encodeURIComponent(code)}/restore`, { method: 'POST' })
export const purgeSku = (code) => request(`/skus/${encodeURIComponent(code)}/purge`, { method: 'DELETE' })
export const fetchSkuImportTotals = () => request('/sku-import-totals')
export const fetchShipmentMeta = () => request('/shipment-meta')
export const fetchSkuImportCostTotals = () => request('/sku-import-cost-totals')
export const fetchImportCostAudit = (params = {}) => {
  const q = new URLSearchParams()
  if (params.importId) q.set('importId', params.importId)
  if (params.expectedTotal != null) q.set('expectedTotal', String(params.expectedTotal))
  const qs = q.toString()
  return request(`/import-cost-audit${qs ? `?${qs}` : ''}`)
}
export const postImportCsvFile = ({ importId, filename, csvText }) =>
  request('/import-files', { method: 'POST', body: JSON.stringify({ importId, filename, csvText }) })
export const reprocessReportingImport = (importId) =>
  request(`/import-history/${encodeURIComponent(importId)}/reprocess-reporting`, { method: 'POST' })
export const reprocessAllReportingImports = () =>
  request('/import-history/reprocess-reporting', { method: 'POST' })
export const fetchProductReport = (q, options = {}) => {
  const params = new URLSearchParams()
  params.set('q', q ?? '')
  if (options.season) params.set('season', options.season)
  return request(`/product-report?${params.toString()}`)
}
export const fetchSkuBrands = () => request('/sku-brands')
export const fetchProductTypeLabels = () => request('/product-type-labels')
export const classifyProductType = (skuCode, options = {}) =>
  request(`/product-type-labels/${encodeURIComponent(skuCode)}`, {
    method: 'POST',
    body: JSON.stringify({ force: options.force === true }),
  })
export const classifyProductTypesBulk = (options = {}) =>
  request('/product-type-labels/classify-bulk', {
    method: 'POST',
    body: JSON.stringify({
      skus: Array.isArray(options.skus) ? options.skus : undefined,
      limit: options.limit,
      force: options.force === true,
    }),
  })
export const updateProductTypeLabel = (skuCode, productType) =>
  request(`/product-type-labels/${encodeURIComponent(skuCode)}`, {
    method: 'PUT',
    body: JSON.stringify({ product_type: productType }),
  })

// ── Import history ──────────────────────────────────────────────────────────

export const fetchImportHistory = () => request('/import-history')
export const postImportRecord = (record) => request('/import-history', { method: 'POST', body: JSON.stringify(record) })
export const deleteImportById = (id) => request(`/import-history/${id}`, { method: 'DELETE' })

// ── Users ───────────────────────────────────────────────────────────────────

export const fetchUsers = () => request('/users')
export const postUser = (user) => request('/users', { method: 'POST', body: JSON.stringify(user) })
export const putUser = (id, changes) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(changes) })
export const regenerateUserPin = (id) => request(`/users/${id}/regenerate-pin`, { method: 'POST' })
export const deleteUser = (id) => request(`/users/${id}`, { method: 'DELETE' })

// ── Activity log (executive) ─────────────────────────────────────────────────

export function fetchActivityLog(params = {}) {
  const q = new URLSearchParams()
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  if (params.category) q.set('category', params.category)
  if (params.since) q.set('since', params.since)
  if (params.until) q.set('until', params.until)
  const s = q.toString()
  return request(`/activity-log${s ? `?${s}` : ''}`)
}

// ── Assignments ─────────────────────────────────────────────────────────────

export const fetchAssignments = () => request('/assignments')
export const postAssignment = (a) => request('/assignments', { method: 'POST', body: JSON.stringify(a) })
export const putAssignment = (id, changes) => request(`/assignments/${id}`, { method: 'PUT', body: JSON.stringify(changes) })
export const completePhotoTasks = (skuCodes) =>
  request('/assignments/complete-photo-tasks', { method: 'POST', body: JSON.stringify({ skuCodes }) })

// ── Outlet transfers ────────────────────────────────────────────────────────

export const fetchOutletTransfers = () => request('/outlet-transfers')
export const postOutletTransfer = (t) => request('/outlet-transfers', { method: 'POST', body: JSON.stringify(t) })
export const putOutletTransfer = (id, changes) => request(`/outlet-transfers/${id}`, { method: 'PUT', body: JSON.stringify(changes) })

// ── Store transfers ─────────────────────────────────────────────────────────

export const fetchStoreTransfers = () => request('/store-transfers')
export const postStoreTransfer = (t) => request('/store-transfers', { method: 'POST', body: JSON.stringify(t) })
export const putStoreTransfer = (id, changes) => request(`/store-transfers/${id}`, { method: 'PUT', body: JSON.stringify(changes) })

// ── Markdown / sale lists ───────────────────────────────────────────────────

export const fetchMarkdownLists = () => request('/markdown-lists')
export const postMarkdownList = (l) => request('/markdown-lists', { method: 'POST', body: JSON.stringify(l) })
export const putMarkdownList = (id, changes) => request(`/markdown-lists/${id}`, { method: 'PUT', body: JSON.stringify(changes) })
export const deleteMarkdownList = (id) => request(`/markdown-lists/${id}`, { method: 'DELETE' })
export const patchMarkdownListItemSalePct = (listId, skuCode, salePct) =>
  request(`/markdown-lists/${listId}/items/${encodeURIComponent(skuCode)}/sale-pct`, {
    method: 'PATCH',
    body: JSON.stringify({ salePct }),
  })

// ── Sale change reports ─────────────────────────────────────────────────────

export const fetchSaleChangeReports = () => request('/sale-change-reports')
export const fetchSaleChangeReport = (id) => request(`/sale-change-reports/${id}`)
export const patchSaleChangeItemMarked = (reportId, skuCode, shop) =>
  request(`/sale-change-reports/${reportId}/items/${encodeURIComponent(skuCode)}/marked`, {
    method: 'PATCH',
    body: JSON.stringify({ shop }),
  })

// ── Sales snapshots ─────────────────────────────────────────────────────────

export const fetchSnapshots = () => request('/snapshots')
export const postSnapshot = (snap) => request('/snapshots', { method: 'POST', body: JSON.stringify(snap) })

// ── Sales events ─────────────────────────────────────────────────────────────

export const fetchSoldQuantityMap = () => request('/skus/sold-map')
/** @param {boolean} [replace] — if true, replace existing rows for same (sku, size, event_date) (reporting import). */
export const postSalesEvents = (events, replace = false) => {
  const q = replace ? '?replace=1' : ''
  return request(`/sales-events${q}`, { method: 'POST', body: JSON.stringify(events) })
}
export const deleteAllSalesEvents = () => request('/sales-events', { method: 'DELETE' })
export const fetchWeeklySales = (weeks = 8) => request(`/sales/weekly?weeks=${weeks}`)
export const fetchSalesBySku = (since, until, season) => {
  let url = `/sales/by-sku?since=${encodeURIComponent(since || '')}`
  if (until) url += `&until=${encodeURIComponent(until)}`
  if (season && String(season).toLowerCase() !== 'all') url += `&season=${encodeURIComponent(season)}`
  return request(url)
}

export const fetchSalesSummaryForSku = (sku) =>
  request(`/sales/summary/${encodeURIComponent(sku || '')}`)

export const fetchSalesByDay = (since, until, season) => {
  let url = `/sales/by-day?since=${encodeURIComponent(since || '')}`
  if (until) url += `&until=${encodeURIComponent(until)}`
  if (season && String(season).toLowerCase() !== 'all') url += `&season=${encodeURIComponent(season)}`
  return request(url)
}

export const fetchSalesExchanges = (since, until) => {
  let url = `/sales/exchanges`
  const q = new URLSearchParams()
  if (since) q.set('since', since)
  if (until) q.set('until', until)
  const qs = q.toString()
  if (qs) url += `?${qs}`
  return request(url)
}

export const fetchSalesEventsHasAny = () => request('/sales/events/has-any')

// ── Executive reports ───────────────────────────────────────────────────────

function reportParams(params = {}) {
  const q = new URLSearchParams()
  if (params.since) q.set('since', params.since)
  if (params.until) q.set('until', params.until)
  if (params.season) q.set('season', params.season)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const fetchExecutiveBuyingReport = (params) =>
  request(`/reports/executive-buying${reportParams(params)}`)
export const fetchBrandProductivityReport = (params) =>
  request(`/reports/brand-productivity${reportParams(params)}`)
export const fetchReturnsExchangeReport = (params) =>
  request(`/reports/returns-exchanges${reportParams(params)}`)
export const fetchSizeCurveHealthReport = (params) =>
  request(`/reports/size-curve-health${reportParams(params)}`)
export const fetchMarkdownRiskReport = (params) =>
  request(`/reports/markdown-risk${reportParams(params)}`)
export const fetchCategoryProductivityReport = (params) =>
  request(`/reports/category-productivity${reportParams(params)}`)
export const fetchMoversReport = (params) =>
  request(`/reports/movers${reportParams(params)}`)

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
