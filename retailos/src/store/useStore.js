import { create } from 'zustand'
import { loadExtraSeasons, restoreActiveUser } from './storeHelpers.js'
import { createSyncSlice } from './slices/syncSlice.js'
import { createUsersSlice } from './slices/usersSlice.js'
import { createAssignmentsSlice } from './slices/assignmentsSlice.js'
import { createTransfersSlice } from './slices/transfersSlice.js'
import { createMarkdownsSlice } from './slices/markdownsSlice.js'
import { createNotificationsSlice } from './slices/notificationsSlice.js'
import { createShiftsSlice } from './slices/shiftsSlice.js'
import { createPhotosSlice } from './slices/photosSlice.js'
import { createCatalogSlice } from './slices/catalogSlice.js'
import { createImportsSlice } from './slices/importsSlice.js'

/**
 * Initial store state. Behavior and shape are unchanged from the previous
 * monolithic store — workflow actions now live in focused slices under ./slices.
 */
const initialState = {
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
}

const useStore = create((set, get) => ({
  ...initialState,

  // ── Server bootstrap + background sync ──────────────────────────────────────
  ...createSyncSlice(set, get),

  // ── Users / session ─────────────────────────────────────────────────────────
  ...createUsersSlice(set, get),

  // ── Assignments / tasks ─────────────────────────────────────────────────────
  ...createAssignmentsSlice(set, get),

  // ── Outlet + store transfers ────────────────────────────────────────────────
  ...createTransfersSlice(set, get),

  // ── Markdown / sale lists ───────────────────────────────────────────────────
  ...createMarkdownsSlice(set, get),

  // ── Notifications ───────────────────────────────────────────────────────────
  ...createNotificationsSlice(set, get),

  // ── Shifts ──────────────────────────────────────────────────────────────────
  ...createShiftsSlice(set, get),

  // ── Photos ──────────────────────────────────────────────────────────────────
  ...createPhotosSlice(set, get),

  // ── SKU catalog / seasons / snapshots ───────────────────────────────────────
  ...createCatalogSlice(set, get),

  // ── CSV imports ─────────────────────────────────────────────────────────────
  ...createImportsSlice(set, get),
}))

export default useStore
export { useStore }
