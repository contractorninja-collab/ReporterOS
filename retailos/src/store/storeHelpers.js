import * as api from '../api/client.js'
import { normalizeSeasonInput } from '../utils/seasons.js'

export const EXTRA_SEASONS_KEY = 'retailos_extra_seasons'

export function loadExtraSeasons() {
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

export function persistExtraSeasons(arr) {
  try {
    localStorage.setItem(EXTRA_SEASONS_KEY, JSON.stringify(arr))
  } catch {
    /* ignore */
  }
}

export function asArray(v) {
  return Array.isArray(v) ? v : []
}

/** Plain object map; rejects null and arrays (typeof null === 'object' in JS). */
export function asRecord(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

export function photoPatchFromList(photoList) {
  if (!Array.isArray(photoList)) return null
  const photoMap = {}
  for (const code of photoList) photoMap[code] = api.getPhotoUrl(code)
  return { photoMap, photoCount: photoList.length }
}

export function generateId() {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function apiErrorMessage(err, fallback = 'The server rejected this change.') {
  const msg = err?.message ? String(err.message).trim() : ''
  return msg || fallback
}

export function notifyLocalWriteFailure(set, get, title, err) {
  const detail = apiErrorMessage(err)
  const n = {
    id: `local-error-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'sync_error',
    title,
    message: detail,
    userId: get().activeUser?.id || 'local',
    relatedId: null,
    createdAt: new Date().toISOString(),
    read: 0,
    localOnly: true,
  }
  set((state) => ({
    notifications: [n, ...state.notifications],
    unreadCount: state.unreadCount + 1,
  }))
  console.warn(`[store] ${title}: ${detail}`)
}

export function resyncAfterWriteFailure(get) {
  get().syncFromServer?.().catch(() => {})
}

const syncInFlight = new Set()

export async function runExclusiveSync(key, work) {
  if (syncInFlight.has(key)) return
  syncInFlight.add(key)
  try {
    await work()
  } finally {
    syncInFlight.delete(key)
  }
}

/** Strip secrets before persisting or restoring session snapshot. */
export function publicUser(u) {
  if (!u) return null
  const { pin: _p, pin_plain: _pp, one_time_pin: _otp, ...rest } = u
  return rest
}

export function restoreActiveUser() {
  try {
    const raw = localStorage.getItem('retailos_active_user')
    if (raw) return publicUser(JSON.parse(raw))
  } catch { /* ignore */ }
  return null
}
