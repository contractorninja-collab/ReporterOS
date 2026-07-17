const BASE = '/api'

function dispatchUnauthorized() {
  try { window.dispatchEvent(new CustomEvent('retailos:unauthorized')) } catch { /* non-browser context */ }
}

/** Build an Error from a non-OK response, preferring the JSON `{ error }` body and carrying the HTTP status. */
async function toResponseError(res, fallbackMessage) {
  const body = await res.json().catch(() => null)
  const e = new Error(body?.error || fallbackMessage || res.statusText)
  e.status = res.status
  return e
}

/** Parse a successful response body: 204/empty → null, JSON when possible, else raw text. */
async function parseResponseBody(res) {
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Single source of truth for every API call (JSON, multipart, photo upload, delete).
 * Centralizes credentials, 401 session handling, error parsing, and body parsing so
 * all endpoint types behave consistently. Do not set Content-Type for FormData bodies —
 * the browser adds the multipart boundary automatically.
 *
 * @param {string} path
 * @param {RequestInit & { skipAuthRedirect?: boolean, errorMessage?: string }} [opts]
 *   skipAuthRedirect: for auth endpoints (login/logout) where a 401 is an expected
 *   result, not an expired session — suppresses the `retailos:unauthorized` event.
 */
async function apiFetch(path, opts = {}) {
  const { skipAuthRedirect = false, errorMessage, ...init } = opts
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
  })
  if (res.status === 401 && !skipAuthRedirect) {
    dispatchUnauthorized()
    const err = new Error('Unauthorized')
    err.status = 401
    throw err
  }
  if (!res.ok) {
    throw await toResponseError(res, errorMessage)
  }
  return parseResponseBody(res)
}

/** JSON request helper: sets JSON content-type and routes through the shared core. */
function request(path, opts = {}) {
  return apiFetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  })
}

function idempotencyKey(action, target) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${action}:${target}:${random}`
}

function destructiveDelete(path, action, target) {
  return request(path, {
    method: 'DELETE',
    headers: {
      'X-Destructive-Confirm': `${action}:${target}`,
      'Idempotency-Key': idempotencyKey(action, target),
    },
  })
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
  return apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_code: userCode, pin }),
    skipAuthRedirect: true,
    errorMessage: 'Login failed',
  })
}

export async function fetchAuthMe() {
  return request('/auth/me')
}

export async function authLogout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST', skipAuthRedirect: true })
  } catch { /* ignore */ }
}

// ── SKUs ────────────────────────────────────────────────────────────────────

export const fetchSkus = () => request('/skus')
export const postSkus = (skus) => request('/skus', { method: 'POST', body: JSON.stringify(skus) })
export const postAssignmentsBulk = (assignments) =>
  request('/assignments/bulk', { method: 'POST', body: JSON.stringify(assignments) })
export const deleteImportSkus = (importId) =>
  destructiveDelete(`/skus/import/${importId}`, 'delete-import', importId)

export const deleteSku = (code) => request(`/skus/${encodeURIComponent(code)}`, { method: 'DELETE' })
export const fetchBinnedSkus = () => request('/skus/bin')
export const restoreSku = (code) => request(`/skus/${encodeURIComponent(code)}/restore`, { method: 'POST' })
export const purgeSku = (code) =>
  destructiveDelete(`/skus/${encodeURIComponent(code)}/purge`, 'purge-sku', code)
export const fetchSkuImportTotals = (options = {}) => {
  const q = new URLSearchParams()
  if (options.season) q.set('season', options.season)
  const qs = q.toString()
  return request(`/sku-import-totals${qs ? `?${qs}` : ''}`)
}
export const fetchShipmentMeta = () => request('/shipment-meta')
export const fetchSkuImportCostTotals = (options = {}) => {
  const q = new URLSearchParams()
  if (options.season) q.set('season', options.season)
  const qs = q.toString()
  return request(`/sku-import-cost-totals${qs ? `?${qs}` : ''}`)
}
export const fetchImportCostAudit = (params = {}) => {
  const q = new URLSearchParams()
  if (params.importId) q.set('importId', params.importId)
  if (params.expectedTotal != null) q.set('expectedTotal', String(params.expectedTotal))
  const qs = q.toString()
  return request(`/import-cost-audit${qs ? `?${qs}` : ''}`)
}
export async function postImportCsvFile({ importId, filename, file, blob, csvText }) {
  const form = new FormData()
  form.append('importId', importId)
  const uploadName = filename || file?.name || 'import.csv'
  form.append('filename', uploadName)
  const uploadFile = file || blob
  if (uploadFile instanceof Blob) {
    form.append('file', uploadFile, uploadName)
  } else if (csvText != null) {
    form.append('csvText', csvText)
  }
  return apiFetch('/import-files', { method: 'POST', body: form })
}
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
export const deleteImportById = (id) =>
  destructiveDelete(`/import-history/${encodeURIComponent(id)}`, 'delete-import', id)

// ── Users ───────────────────────────────────────────────────────────────────

export const fetchUsers = () => request('/users')
export const postUser = (user) => request('/users', { method: 'POST', body: JSON.stringify(user) })
export const putUser = (id, changes) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(changes) })
export const regenerateUserPin = (id) => request(`/users/${id}/regenerate-pin`, { method: 'POST' })
export const deleteUser = (id) =>
  destructiveDelete(`/users/${id}`, 'delete-user', id)

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
export const deleteOutletTransfer = (id) => request(`/outlet-transfers/${id}`, { method: 'DELETE' })

// ── Store transfers ─────────────────────────────────────────────────────────

export const fetchStoreTransfers = () => request('/store-transfers')
export const postStoreTransfer = (t) => request('/store-transfers', { method: 'POST', body: JSON.stringify(t) })
export const putStoreTransfer = (id, changes) => request(`/store-transfers/${id}`, { method: 'PUT', body: JSON.stringify(changes) })
export const deleteStoreTransfer = (id) => request(`/store-transfers/${id}`, { method: 'DELETE' })

// ── Markdown / sale lists ───────────────────────────────────────────────────

export const fetchMarkdownLists = () => request('/markdown-lists')
export const postMarkdownList = (l) => request('/markdown-lists', { method: 'POST', body: JSON.stringify(l) })
export const putMarkdownList = (id, changes) => request(`/markdown-lists/${id}`, { method: 'PUT', body: JSON.stringify(changes) })
export const deleteMarkdownList = (id) => request(`/markdown-lists/${id}`, { method: 'DELETE' })
export const patchMarkdownListItemTagged = (listId, skuCode, lane) =>
  request(`/markdown-lists/${listId}/items/${encodeURIComponent(skuCode)}/tagged`, {
    method: 'PATCH',
    body: JSON.stringify({ lane }),
  })
export const patchMarkdownListItemSalePct = (listId, skuCode, salePct, extraSalePct = 0) =>
  request(`/markdown-lists/${listId}/items/${encodeURIComponent(skuCode)}/sale-pct`, {
    method: 'PATCH',
    body: JSON.stringify({ salePct, extraSalePct }),
  })
export const deleteMarkdownListItem = (listId, skuCode) =>
  request(`/markdown-lists/${listId}/items/${encodeURIComponent(skuCode)}`, { method: 'DELETE' })

// ── Sale change reports ─────────────────────────────────────────────────────

export const fetchSaleChangeReports = () => request('/sale-change-reports')
export const fetchSaleChangeReport = (id) => request(`/sale-change-reports/${id}`)
export const patchSaleChangeItemMarked = (reportId, skuCode, shop) =>
  request(`/sale-change-reports/${reportId}/items/${encodeURIComponent(skuCode)}/marked`, {
    method: 'PATCH',
    body: JSON.stringify({ shop }),
  })
export const deleteSaleChangeReport = (reportId) =>
  destructiveDelete('/sale-change-reports/' + encodeURIComponent(reportId), 'discard-sale-change-report', reportId)

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
export const deleteAllSalesEvents = () =>
  destructiveDelete('/sales-events', 'delete-sales-events', 'all')
export const deleteSalesEventsByImportId = (importId) =>
  destructiveDelete(`/sales-events/import/${encodeURIComponent(importId)}`, 'delete-sales-events-import', importId)
export const fetchWeeklySales = (weeks = 8) => request(`/sales/weekly?weeks=${weeks}`)
export const fetchSalesBySku = (since, until, season) => {
  let url = `/sales/by-sku?since=${encodeURIComponent(since || '')}`
  if (until) url += `&until=${encodeURIComponent(until)}`
  if (season && String(season).toLowerCase() !== 'all') url += `&season=${encodeURIComponent(season)}`
  return request(url)
}

export const fetchSalesSummaryForSku = (sku, options = {}) => {
  const q = new URLSearchParams()
  if (options.season) q.set('season', options.season)
  const qs = q.toString()
  return request(`/sales/summary/${encodeURIComponent(sku || '')}${qs ? `?${qs}` : ''}`)
}

export const fetchSkuActivity = (sku, options = {}) => {
  const q = new URLSearchParams()
  if (options.since) q.set('since', options.since)
  if (options.until) q.set('until', options.until)
  const qs = q.toString()
  return request(`/skus/${encodeURIComponent(sku || '')}/activity${qs ? `?${qs}` : ''}`)
}

export const downloadSkuActivity = async (sku, format = 'csv', options = {}) => {
  const q = new URLSearchParams()
  if (options.since) q.set('since', options.since)
  if (options.until) q.set('until', options.until)
  const response = await fetch(`${BASE}/skus/${encodeURIComponent(sku || '')}/activity.${format}${q.toString() ? `?${q}` : ''}`, { credentials: 'include' })
  if (!response.ok) throw await toResponseError(response, 'Activity export failed')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `RetailOS_Product_Sales_Card_${sku}.${format}`; a.click(); URL.revokeObjectURL(url)
}

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
  return apiFetch(`/photos/${encodeURIComponent(skuCode)}`, {
    method: 'POST',
    body: form,
    errorMessage: 'Upload failed',
  })
}

export const deletePhoto = (skuCode) =>
  apiFetch(`/photos/${encodeURIComponent(skuCode)}`, { method: 'DELETE' })
