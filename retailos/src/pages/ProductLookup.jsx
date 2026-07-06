import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import useStore from '../store/useStore'
import { isExecutive } from '../utils/roles'
import { aggregateSkus } from '../utils/aggregateSkus'
import { getLifecycleStatus, getReorderVerdict } from '../utils/lifecycle'
import * as api from '../api/client'
import ProductDetailModal from '../components/ProductDetailModal'
import SaleBadge from '../components/SaleBadge.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import BrandSelect from '../components/BrandSelect.jsx'
import { lifecycleStatusBadgeClass } from '../utils/statusBadge.js'
import { IconLock, IconDelete, IconSliders, IconChevronDown } from '../utils/icons.js'
import { toTitleCase } from '../utils/textFormat.js'
import {
  genderBucketKey,
  accumulateReportByGender,
  dominantGenderBySku,
  mergeImportedUnitsIntoBuckets,
} from '../utils/gender.js'
import { DISCOUNTS, salePriceOf } from '../utils/saleList.js'
import { isSeasonFilterActive, productMatchesActiveSeason } from '../utils/seasons.js'

const DM = '"DM Sans", sans-serif'

const GENDER_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'Men', label: 'Men' },
  { key: 'Women', label: 'Women' },
  { key: 'Kids', label: 'Kids' },
  { key: 'Unisex', label: 'Unisex' },
  { key: 'Unspecified', label: 'Other / unspecified' },
]

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'footwear', label: 'Footwear' },
  { key: 'apparel', label: 'Apparel' },
  { key: 'accessories', label: 'Accessories' },
]

const PRODUCT_TYPE_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'tshirt', label: 'T-shirts' },
  { key: 'shorts', label: 'Shorts' },
  { key: 'shoe', label: 'Shoes' },
  { key: 'skirt', label: 'Skirts' },
  { key: 'pants', label: 'Pants' },
  { key: 'hoodie', label: 'Hoodies' },
  { key: 'jacket', label: 'Jackets' },
  { key: 'bag', label: 'Bags' },
  { key: 'dress', label: 'Dresses' },
  { key: 'swimwear', label: 'Swimwear' },
  { key: 'other', label: 'Other' },
]

const PL_DRAWER_TYPE_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'shoe', label: 'Shoe' },
  { key: 'other', label: 'Other' },
  { key: 'apparel', label: 'Apparel' },
]

const PL_DRAWER_GENDER_FILTERS = GENDER_FILTERS.filter((g) => g.key !== 'Unspecified')

const PL_NUMERIC_SORT_COLS = new Set(['stock', 'remaining', 'sold', 'totalInvestment', 'cogs', 'totalRevenue', 'avgTicket', 'profit', 'roi', 'first_import_date'])

const PL_MOBILE_SORT_OPTIONS = [
  { key: 'product_name', label: 'Product name' },
  { key: 'roi', label: 'Margin' },
  { key: 'profit', label: 'Profit' },
  { key: 'sold', label: 'Sold' },
  { key: 'first_import_date', label: 'Days' },
]

function downloadTableCSV(headers, rows, filename) {
  const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function fmtEuroShort(n, fraction = 0) {
  return `€${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: fraction, minimumFractionDigits: fraction })}`
}

const SLOW_SALES_MAX = 3

function isSlowMover(row) {
  const sold = Number(row?.sold) || 0
  return sold >= 0 && sold <= SLOW_SALES_MAX
}

const LOW_STOCK_MAX = 3

function isLowStock(row) {
  const remaining = Number(row?.remaining) || 0
  return remaining >= 1 && remaining <= LOW_STOCK_MAX
}

function isLowOnHand(row) {
  const remaining = Number(row?.remaining) || 0
  return remaining >= 1 && remaining <= LOW_STOCK_MAX
}

/** 'low' | 'dead' | null — requires sold30d on row (30-day sales loaded) */
function stockBadgeKind(row) {
  if (!isLowOnHand(row)) return null
  if (row.sold30d == null) return null
  const sold30 = Number(row.sold30d) || 0
  if (sold30 > 0) return 'low'
  return 'dead'
}

function salesSince30DaysYMD() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function categoryKeyFromRaw(category) {
  const key = String(category ?? '').trim().toLowerCase()
  if (key === 'ftw') return 'footwear'
  if (key === 'app') return 'apparel'
  if (key === 'acc' || key === 'accessory') return 'accessories'
  return key
}

function productTypeFromText(row) {
  const hay = `${row?.product_name || ''} ${row?.category || ''} ${row?.sku || ''}`.toLowerCase()
  if (/shoe|sneaker|trainer|slide|sandal|court|runner|boot|pace|barreda|adilette/.test(hay)) return 'shoe'
  if (/short|sho\b|sh\b/.test(hay)) return 'shorts'
  if (/skirt|\bski\b/.test(hay)) return 'skirt'
  if (/pant|trouser|jogger|legging|tight/.test(hay)) return 'pants'
  if (/hoodie|hoody|sweater|sweatshirt|crew|crw|fleece|ft hd/.test(hay)) return 'hoodie'
  if (/jacket|coat|track jacket|windbreaker|bomber|gilet|vest/.test(hay)) return 'jacket'
  if (/bag|backpack|bkpk/.test(hay)) return 'bag'
  if (/dress|\bdre\b/.test(hay)) return 'dress'
  if (/swim|breaker/.test(hay)) return 'swimwear'
  if (/tee|shirt|t-shirt|tshirt|top|polo|tank/.test(hay)) return 'tshirt'
  return 'other'
}

function productTypeForRow(row, productTypeMap) {
  return productTypeMap?.[row?.sku]?.product_type || productTypeFromText(row)
}

function brandKeyFromRaw(brand) {
  const t = String(brand ?? '').trim()
  if (!t || t === '—') return ''
  return t.toLowerCase()
}

/** Distinct brands from API (all `skus`), client store, and current report rows (CSV import fields). */
/**
 * When the report row has no brand, copy from the live catalog so filters match
 * the same values as GET /api/sku-brands (e.g. after MAX(brand) was empty in SQL).
 * Uses lexicographic max among non-empty trimmed brand strings, matching SQLite MAX.
 */
function pickBrandForSku(sku, skuRows) {
  let best = null
  for (const s of skuRows || []) {
    if (s.sku !== sku) continue
    const t = String(s.brand ?? '').trim()
    if (!t) continue
    if (t === '—') continue
    if (best == null || t > best) best = t
  }
  return best
}

function pickCategoryForSku(sku, skuRows) {
  let best = null
  for (const s of skuRows || []) {
    if (s.sku !== sku) continue
    const t = String(s.category ?? '').trim()
    if (!t) continue
    if (t === '—') continue
    if (best == null || t > best) best = t
  }
  return best
}

function enrichReportBrandsFromSkus(rows, skuRows) {
  if (!rows?.length) return []
  return rows.map((row) => {
    const t = String(row.brand ?? '').trim()
    const c = String(row.category ?? '').trim()
    if (t && t !== '—' && c && c !== '—') return row
    const b = pickBrandForSku(row.sku, skuRows)
    const category = pickCategoryForSku(row.sku, skuRows)
    if (!b && !category) return row
    return {
      ...row,
      ...(b ? { brand: b } : null),
      ...(category ? { category } : null),
    }
  })
}

/**
 * Merges GET /api/sales/by-sku (sold_qty, revenue) into report rows. Leaves totalInvestment (COST) unchanged.
 * salesMap: null = fetch not done yet; keep raw rows. Object = map sku → sales row.
 */
function applyNetSalesToRows(rows, salesMap) {
  if (!rows?.length) return []
  if (salesMap == null || salesMap === undefined) return rows
  if (salesMap === 'error') return rows
  return rows.map((row) => {
    const sale = salesMap[row.sku]
    const netSold = Number(sale?.sold_qty) || 0
    const netRevenue = Number(sale?.revenue) || 0
    const importQty = Number(row.stock) || 0
    const costPrice = Number(row.cost_price) || 0
    const cogs = netSold > 0 ? costPrice * netSold : 0
    const profit = netRevenue - cogs
    const avgTicket = netSold > 0 ? netRevenue / netSold : 0
    const roi = netRevenue > 0 ? (profit / netRevenue) * 100 : 0
    const remaining = Math.max(0, importQty - netSold)
    return {
      ...row,
      sold: netSold,
      remaining,
      cogs,
      totalRevenue: netRevenue,
      profit,
      avgTicket,
      roi,
    }
  })
}

/** Uses immutable import_lines ledger totals so Import/Cost match CSV intake, not mutable skus.quantity/cost_price. */
function applyIntakeTotalsToRows(rows, importTotalsMap) {
  if (!rows?.length || importTotalsMap == null) return rows
  return rows.map((row) => {
    const raw = importTotalsMap[row.sku]
    if (raw == null || raw === '') return row
    const u = typeof raw === 'object'
      ? Number(raw.units_imported) || 0
      : Number(raw) || 0
    if (u <= 0) return row
    const ledgerInvestment = typeof raw === 'object' ? Number(raw.import_investment) || 0 : null
    const ledgerUnitCost = typeof raw === 'object' ? Number(raw.avg_unit_cost) || 0 : null
    const missingCostUnits = typeof raw === 'object' ? Number(raw.missing_cost_units) || 0 : 0
    const totalInvestment = ledgerInvestment != null ? ledgerInvestment : Number(row.totalInvestment) || 0
    const unitCost = ledgerUnitCost != null && ledgerUnitCost > 0
      ? ledgerUnitCost
      : u > 0 && totalInvestment > 0
        ? totalInvestment / u
        : Number(row.cost_price) || 0
    const sold = Number(row.sold) || 0
    return {
      ...row,
      stock: u,
      cost_price: unitCost > 0 ? unitCost : row.cost_price,
      totalInvestment,
      missingCostUnits,
      remaining: Math.max(0, u - sold),
    }
  })
}

function mergeBrandOptionEntries(apiLabels, skuRows, reportRows) {
  const byKey = new Map()
  const add = (raw) => {
    const t = String(raw ?? '').trim()
    if (!t || t === '—') {
      if (!byKey.has('')) byKey.set('', '—')
      return
    }
    const k = brandKeyFromRaw(t)
    if (!byKey.has(k)) byKey.set(k, t)
  }
  for (const s of apiLabels || []) add(s)
  for (const s of skuRows || []) add(s.brand)
  for (const r of reportRows || []) add(r.brand)
  return [...byKey.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, label]) => ({ key, label }))
}

function sumProductReportRows(rows) {
  if (!rows?.length) {
    return { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalProfit: 0, avgRoi: 0, totalInvestment: 0 }
  }
  let stock = 0
  let remaining = 0
  let sold = 0
  let cogs = 0
  let totalRevenue = 0
  let totalInvestment = 0
  for (const row of rows) {
    stock += row.stock ?? 0
    remaining += row.remaining ?? 0
    sold += row.sold ?? 0
    cogs += row.cogs ?? 0
    totalRevenue += row.totalRevenue ?? 0
    totalInvestment += row.totalInvestment ?? 0
  }
  const totalProfit = totalRevenue - cogs
  const avgRoi = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
  return { stock, remaining, sold, cogs, totalRevenue, totalProfit, avgRoi, totalInvestment }
}

const TH = {
  textAlign: 'left',
  padding: '10px 8px',
  fontSize: 10,
  fontWeight: 700,
  color: '#6B7280',
  textTransform: 'none',
  letterSpacing: '0.05em',
  borderBottom: '2px solid #E5E7EB',
  background: '#F9FAFB',
  cursor: 'pointer',
  userSelect: 'none',
}
const TD = { padding: '10px 8px 10px 0', fontSize: 12, color: '#374151', borderBottom: '1px solid #F9FAFB', verticalAlign: 'middle' }

const PL_KPI_ACCENT = {
  Import: '#9CA3AF',
  'On hand': '#60A5FA',
  Sold: '#34D399',
  Cost: '#9CA3AF',
  Revenue: '#60A5FA',
  Profit: '#34D399',
}

function parseMarginPct(margin) {
  if (margin == null || margin === '') return 0
  if (typeof margin === 'number') return Number.isFinite(margin) ? margin : 0
  return parseFloat(String(margin).replace('%', '').trim()) || 0
}

function plMarginColor(margin) {
  const m = parseMarginPct(margin)
  if (m === 0) return '#9CA3AF'
  if (m >= 45) return '#15803D'
  if (m >= 30) return '#D97706'
  return '#DC2626'
}

function plProfitColor(profit, margin) {
  const p = parseFloat(profit) || 0
  const m = parseMarginPct(margin)
  if (p < 0) return '#DC2626'
  if (p === 0) return '#9CA3AF'
  if (p > 50 && m > 30) return '#15803D'
  return '#D97706'
}

function GenderSummaryPart({ dotClass, label, children }) {
  return (
    <>
      <span className="pl-gender-summary__segment">
        <i className={`pl-gender-dot ${dotClass}`} aria-hidden="true" />
        <strong className="pl-gender-summary__label">{label}:</strong>
        <span className="pl-gender-summary__values">{children}</span>
      </span>
      <span className="pl-gender-summary__sep">·</span>
    </>
  )
}

const PL_TABLE_COLSPAN = 19

const PL_TABLE_COL_CLASS = {
  product_name: 'col-product',
  _photo: 'col-photo',
  sku: 'col-sku',
  brand: 'col-brand',
  productType: 'col-type',
  genderBucket: 'col-gender',
  stock: 'col-import',
  sold: 'col-sold',
  remaining: 'col-onhand',
  totalInvestment: 'col-cost',
  cogs: 'col-cogs',
  totalRevenue: 'col-revenue',
  avgTicket: 'col-avgticket',
  profit: 'col-profit',
  roi: 'col-margin',
  verdict: 'col-reasoning',
}

function plTableColClass(key) {
  return PL_TABLE_COL_CLASS[key] || ''
}

function plColumnClass(key, kind = 'td') {
  const prefix = kind === 'th' ? 'pl-th' : 'pl-td'
  const classes = [prefix]
  if (key === 'brand') classes.push(`${prefix}--brand`)
  if (key === 'productType' || key === 'genderBucket' || key === 'stock') classes.push(`${prefix}--compact`)
  return classes.join(' ')
}

function formatProductType(type) {
  const key = String(type || 'other').toLowerCase()
  const map = {
    shoe: 'Shoe',
    other: 'Other',
    tshirt: 'T-shirt',
    shorts: 'Shorts',
    skirt: 'Skirt',
    pants: 'Pants',
    hoodie: 'Hoodie',
    jacket: 'Jacket',
    bag: 'Bag',
    dress: 'Dress',
    swimwear: 'Swimwear',
  }
  return map[key] || key.charAt(0).toUpperCase() + key.slice(1)
}

function lifecycleBadgeClass(status) {
  return lifecycleStatusBadgeClass(status)
}

const TILES = [
  { status: 'New Arrival', color: '#38bdf8', colorBg: 'rgba(56,189,248,0.1)', icon: '•' },
  { status: 'Active', color: '#00e676', colorBg: 'rgba(0,230,118,0.1)', icon: '●' },
  { status: 'Aging', color: '#fbbf24', colorBg: 'rgba(251,191,36,0.1)', icon: '◐' },
  { status: 'Risk', color: '#ff8800', colorBg: 'rgba(255,136,0,0.1)', icon: '!' },
  { status: 'Clearance', color: '#ff3333', colorBg: 'rgba(255,51,51,0.1)', icon: '↓' },
  { status: 'Outlet', color: '#c084fc', colorBg: 'rgba(192,132,252,0.1)', icon: '◆' },
]

function buildClientReport(q, skus, shipmentMeta = null, activeSeason = 'All') {
  const needle = (q || '').trim().toLowerCase()
  const seasonActive = isSeasonFilterActive(activeSeason)
  const products = aggregateSkus(skus, shipmentMeta, activeSeason)
    .filter((p) => productMatchesActiveSeason(p, activeSeason))
  const filtered = needle
    ? products.filter((p) => {
        const name = String(p.product_name || '').toLowerCase()
        const code = String(p.sku || '').toLowerCase()
        return name.includes(needle) || code.includes(needle)
      })
    : products

  const skuSet = new Set(filtered.map((p) => p.sku))
  const rawForGender = skus.filter((r) => skuSet.has(r.sku))
  const byGender = accumulateReportByGender(rawForGender)
  mergeImportedUnitsIntoBuckets(byGender, [])
  const dominantBySku = dominantGenderBySku([...skuSet], rawForGender)

  const rows = filtered.map((p) => {
    const qty = seasonActive
      ? (Number(p.active_season_imported_units) || 0)
      : (Number(p.quantity) || 0)
    const soldQty = Number(p.sold_quantity) || 0
    const cogs = p._salesCogs ?? (soldQty * (Number(p.cost_price) || 0))
    const totalRevenue = p._salesRevenue ?? (soldQty * (Number(p.price_sold) || 0))
    const investment = p._totalInvestment ?? (qty * (Number(p.cost_price) || 0))
    const profit = totalRevenue - cogs
    const roi = cogs > 0 ? (profit / cogs) * 100 : 0
    const displayGender = dominantBySku.has(p.sku) ? dominantBySku.get(p.sku) : p.gender
    return {
      sku: p.sku,
      product_name: p.product_name,
      brand: (String(p.brand ?? '').trim() || '—'),
      category: p.category,
      gender: displayGender,
      genderBucket: genderBucketKey(displayGender),
      stock: qty,
      remaining: seasonActive ? (Number(p.active_season_stock_units) || 0) : Math.max(0, qty - soldQty),
      sold: soldQty,
      totalInvestment: investment,
      first_import_date: p.import_date,
      last_import_date: p.import_date,
      sizes: (p.sizes || []).join(', '),
      cost_price: Number(p.cost_price) || 0,
      cogs,
      totalRevenue,
      profit,
      roi,
      avgTicket: soldQty > 0 ? totalRevenue / soldQty : 0,
    }
  })

  let stock = 0
  let remaining = 0
  let sold = 0
  let cogs = 0
  let totalRevenue = 0
  let totalInvestment = 0
  for (const row of rows) {
    stock += row.stock
    remaining += row.remaining
    sold += row.sold
    cogs += row.cogs
    totalRevenue += row.totalRevenue
    totalInvestment += row.totalInvestment
  }

  const totalProfit = totalRevenue - cogs
  const avgRoi = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  return {
    query: q,
    rows,
    totals: { stock, remaining, sold, cogs, totalRevenue, totalProfit, avgRoi, totalInvestment },
    byGender,
    timeline: [],
    _clientOnly: true,
  }
}

/**
 * Compact dropdown menu used in the filter toolbar.
 * Purely presentational — emits onChange(key) to the parent which owns state.
 */
function FilterMenu({ label, value, options, onChange, accent = 'sky', isOpen, onToggle, onClose }) {
  const wrapperRef = useRef(null)
  const active = options.find((o) => o.key === value) || options[0]
  const isDefault = value === 'all' || value === options[0]?.key

  useEffect(() => {
    if (!isOpen) return undefined
    function onDocClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) onClose()
    }
    function onEsc(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [isOpen, onClose])

  return (
    <div className={`pl-menu pl-menu--${accent} ${isOpen ? 'is-open' : ''} ${!isDefault ? 'has-value' : ''}`} ref={wrapperRef}>
      <button type="button" className="pl-menu__trigger" onClick={onToggle}>
        <span className="pl-menu__label">{label}</span>
        <span className="pl-menu__value">{active?.label ?? '—'}</span>
        <span className="pl-menu__caret" aria-hidden="true" />
      </button>
      {isOpen && (
        <div className="pl-menu__panel" role="listbox">
          {options.map((o) => (
            <button
              key={o.key || '_none'}
              type="button"
              className={`pl-menu__option ${o.key === value ? 'is-selected' : ''}`}
              onClick={() => {
                onChange(o.key)
                onClose()
              }}
            >
              <span className="pl-menu__option-dot" aria-hidden="true" />
              <span className="pl-menu__option-label">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProductLookup() {
  const [searchParams, setSearchParams] = useSearchParams()
  const skus = useStore((s) => s.skus)
  const setSkus = useStore((s) => s.setSkus)
  const activeSeason = useStore((s) => s.activeSeason)
  const shipmentMeta = useStore((s) => s.shipmentMeta)
  const photoMap = useStore((s) => s.photoMap)
  const activeUser = useStore((s) => s.activeUser)
  const markdownLists = useStore((s) => s.markdownLists)
  const addItemToMarkdownList = useStore((s) => s.addItemToMarkdownList)

  const canManage = activeUser?.role === 'executive' || activeUser?.role === 'manager'

  const [tab, setTab] = useState(() => (searchParams.get('q') ? 'search' : 'all'))
  const [input, setInput] = useState(() => searchParams.get('q') || '')
  const [openMenu, setOpenMenu] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [expandedSkus, setExpandedSkus] = useState(() => new Set())
  const mobileSearchRef = useRef(null)
  const [deleteConfirmRow, setDeleteConfirmRow] = useState(null)
  const [deletingSku, setDeletingSku] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleteSuccess, setDeleteSuccess] = useState('')
  const [gender, setGender] = useState('all')
  const [category, setCategory] = useState('all')
  const [brand, setBrand] = useState('all')
  const [showSlowOnly, setShowSlowOnly] = useState(false)
  const [showLowStockOnly, setShowLowStockOnly] = useState(false)
  const [productType, setProductType] = useState('all')
  const [productTypeMap, setProductTypeMap] = useState({})
  const [isClassifyingTypes, setIsClassifyingTypes] = useState(false)
  const [typeStatus, setTypeStatus] = useState('')
  const [skuBrandsFromApi, setSkuBrandsFromApi] = useState([])
  const [report, setReport] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [sortKey, setSortKey] = useState('product_name')
  const [sortDir, setSortDir] = useState('asc')
  const [modalSku, setModalSku] = useState(null)
  const [selectedSkus, setSelectedSkus] = useState({})
  const [bulkListId, setBulkListId] = useState('')
  const [bulkPct, setBulkPct] = useState(30)
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [salesBySku, setSalesBySku] = useState(undefined)
  const [salesBySku30d, setSalesBySku30d] = useState(undefined)
  const [importTotalsMap, setImportTotalsMap] = useState(null)

  const qParam = (searchParams.get('q') || '').trim()
  const qForApi = tab === 'all' ? '' : qParam
  const shouldFetch = tab === 'all' || qParam.length > 0

  const load = useCallback(async () => {
    setLoadError(null)
    if (!shouldFetch) {
      setReport({
        query: '',
        rows: [],
        totals: { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalProfit: 0, avgRoi: 0, totalInvestment: 0 },
        byGender: {
          Men: { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0, imported: 0 },
          Women: { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0, imported: 0 },
          Kids: { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0, imported: 0 },
          Unisex: { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0, imported: 0 },
          Unspecified: { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0, imported: 0 },
        },
        timeline: [],
      })
      return
    }
    try {
      const data = await api.fetchProductReport(qForApi, { season: activeSeason || 'All' })
      setReport(data)
      api
        .fetchSkuBrands()
        .then((list) => {
          if (Array.isArray(list)) setSkuBrandsFromApi(list)
        })
        .catch(() => {})
    } catch (e) {
      setLoadError(e?.message || 'Offline or API unavailable')
      setReport(buildClientReport(qForApi, skus, shipmentMeta, activeSeason))
    }
  }, [shouldFetch, qForApi, activeSeason, skus, shipmentMeta])

  useEffect(() => {
    load()
  }, [load])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirmRow) return
    const code = deleteConfirmRow.sku
    setDeletingSku(code)
    setDeleteError('')
    try {
      await api.deleteSku(code)
      const freshSkus = await api.fetchSkus().catch(() => null)
      if (Array.isArray(freshSkus)) setSkus(freshSkus)
      setDeleteSuccess(`Moved “${deleteConfirmRow.product_name || code}” to the recycle bin. Restore from Recycle Bin within 30 days.`)
      setDeleteConfirmRow(null)
      load()
    } catch (e) {
      setDeleteError(e?.message || 'Failed to move SKU to recycle bin')
    } finally {
      setDeletingSku(null)
    }
  }, [deleteConfirmRow, setSkus, load])

  useEffect(() => {
    if (!deleteSuccess) return undefined
    const t = setTimeout(() => setDeleteSuccess(''), 6000)
    return () => clearTimeout(t)
  }, [deleteSuccess])

  useEffect(() => {
    let cancelled = false
    setSalesBySku(undefined)
    setSalesBySku30d(undefined)
    const today = new Date().toISOString().slice(0, 10)
    const since30 = salesSince30DaysYMD()
    Promise.all([
      api.fetchSalesBySku('1970-01-01', today, activeSeason || 'All'),
      api.fetchSalesBySku(since30, today, activeSeason || 'All'),
    ])
      .then(([salesRows, sales30Rows]) => {
        if (cancelled) return
        const salesMap = {}
        if (Array.isArray(salesRows)) {
          for (const r of salesRows) {
            if (r?.sku) salesMap[r.sku] = r
          }
        }
        const sales30Map = {}
        if (Array.isArray(sales30Rows)) {
          for (const r of sales30Rows) {
            if (r?.sku) sales30Map[r.sku] = r
          }
        }
        setSalesBySku(salesMap)
        setSalesBySku30d(sales30Map)
      })
      .catch(() => {
        if (!cancelled) {
          setSalesBySku('error')
          setSalesBySku30d('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeSeason])

  useEffect(() => {
    let cancelled = false
    setImportTotalsMap(null)
    api
      .fetchSkuImportCostTotals({ season: activeSeason || 'All' })
      .then((m) => {
        if (cancelled) return
        setImportTotalsMap(m && typeof m === 'object' ? m : {})
      })
      .catch(() => {
        if (!cancelled) setImportTotalsMap({})
      })
    return () => {
      cancelled = true
    }
  }, [activeSeason])

  useEffect(() => {
    let cancelled = false
    api
      .fetchSkuBrands()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setSkuBrandsFromApi(list)
      })
      .catch(() => {
        if (!cancelled) setSkuBrandsFromApi([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .fetchProductTypeLabels()
      .then((labels) => {
        if (!cancelled && labels && typeof labels === 'object') setProductTypeMap(labels)
      })
      .catch(() => {
        if (!cancelled) setProductTypeMap({})
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const q = searchParams.get('q')
    if (q != null) setInput(q)
    if (q && String(q).trim()) setTab('search')
  }, [searchParams])

  useEffect(() => {
    if (!filtersOpen && !sortOpen) return undefined
    document.body.classList.add('sheet-open')
    return () => document.body.classList.remove('sheet-open')
  }, [filtersOpen, sortOpen])

  useEffect(() => {
    if (tab !== 'search') return undefined
    if (typeof window === 'undefined' || !window.matchMedia('(max-width: 768px)').matches) return undefined
    const t = setTimeout(() => mobileSearchRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [tab])

  const resetPlFilters = useCallback(() => {
    setBrand('all')
    setCategory('all')
    setProductType('all')
    setGender('all')
  }, [])

  const skuPhoto = useMemo(() => {
    const m = {}
    for (const s of skus) {
      if (!s.sku || m[s.sku]) continue
      if (photoMap[s.sku]) {
        m[s.sku] = photoMap[s.sku]
        continue
      }
      if (s.barcode && photoMap[s.barcode]) {
        m[s.sku] = photoMap[s.barcode]
      }
    }
    return m
  }, [skus, photoMap])

  const reportRowsForUi = useMemo(() => {
    const withSales = applyNetSalesToRows(
      applyIntakeTotalsToRows(enrichReportBrandsFromSkus(report?.rows, skus), importTotalsMap),
      salesBySku,
    )
    if (!withSales.length || salesBySku30d == null || salesBySku30d === 'error') return withSales
    return withSales.map((row) => ({
      ...row,
      sold30d: Number(salesBySku30d[row.sku]?.sold_qty) || 0,
    }))
  }, [report?.rows, skus, salesBySku, salesBySku30d, importTotalsMap])

  const brandOptions = useMemo(
    () => mergeBrandOptionEntries(skuBrandsFromApi, skus, reportRowsForUi),
    [skuBrandsFromApi, skus, reportRowsForUi],
  )

  const mobileFilterPills = useMemo(() => {
    const pills = []
    if (brand !== 'all') {
      const label = brandOptions.find((o) => o.key === brand)?.label || brand
      pills.push({ key: 'brand', text: `Brand: ${label}`, clear: () => setBrand('all') })
    }
    if (category !== 'all') {
      const label = CATEGORY_FILTERS.find((c) => c.key === category)?.label || category
      pills.push({ key: 'category', text: `Category: ${label}`, clear: () => setCategory('all') })
    }
    if (productType !== 'all') {
      const label = PRODUCT_TYPE_FILTERS.find((t) => t.key === productType)?.label || productType
      pills.push({ key: 'type', text: `Type: ${label}`, clear: () => setProductType('all') })
    }
    if (gender !== 'all') {
      const label = GENDER_FILTERS.find((g) => g.key === gender)?.label || gender
      pills.push({ key: 'gender', text: `Gender: ${label}`, clear: () => setGender('all') })
    }
    return pills
  }, [brand, category, productType, gender, brandOptions])

  const drawerTypeApparelActive = category === 'apparel' && productType === 'all'

  const selectDrawerType = (key) => {
    if (key === 'apparel') {
      setCategory('apparel')
      setProductType('all')
      return
    }
    setProductType(key)
  }

  const classifyVisibleTypes = async () => {
    if (isClassifyingTypes) return
    setIsClassifyingTypes(true)
    setTypeStatus('')
    try {
      const visibleSkus = reportRowsForUi.map((r) => r.sku).filter(Boolean)
      const result = await api.classifyProductTypesBulk({ skus: visibleSkus, limit: 10 })
      if (result?.labels) setProductTypeMap(result.labels)
      const processed = Number(result?.processed) || 0
      setTypeStatus(
        result?.status === 'missing_api_key'
          ? `No OpenAI key found. Used cached/fallback labels for ${processed} SKU(s).`
          : `Classified ${processed} SKU(s).`,
      )
    } catch (e) {
      setTypeStatus(e?.message || 'Classification failed')
    } finally {
      setIsClassifyingTypes(false)
    }
  }

  useEffect(() => {
    if (brand === 'all') return
    if (!brandOptions.some((o) => o.key === brand)) setBrand('all')
  }, [brand, brandOptions])

  const baseFilteredRows = useMemo(() => {
    if (!reportRowsForUi.length) return []
    return reportRowsForUi.map((r) => ({
      ...r,
      productType: productTypeForRow(r, productTypeMap),
    })).filter((r) => {
      if (brand !== 'all' && brandKeyFromRaw(r.brand) !== brand) return false
      if (category !== 'all' && categoryKeyFromRaw(r.category) !== category) return false
      if (productType !== 'all' && r.productType !== productType) return false
      if (gender === 'all') return true
      return r.genderBucket === gender
    })
  }, [reportRowsForUi, brand, category, productType, productTypeMap, gender])

  const slowMoverCount = useMemo(
    () => baseFilteredRows.filter(isSlowMover).length,
    [baseFilteredRows],
  )

  const lowStockCount = useMemo(
    () => baseFilteredRows.filter(isLowStock).length,
    [baseFilteredRows],
  )

  const filteredRows = useMemo(() => {
    if (showSlowOnly) return baseFilteredRows.filter(isSlowMover)
    if (showLowStockOnly) return baseFilteredRows.filter(isLowStock)
    return baseFilteredRows
  }, [baseFilteredRows, showSlowOnly, showLowStockOnly])

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows]
    arr.sort((a, b) => {
      let va = a[sortKey]
      let vb = b[sortKey]
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va
      }
      va = String(va ?? '').toLowerCase()
      vb = String(vb ?? '').toLowerCase()
      const c = va.localeCompare(vb)
      return sortDir === 'asc' ? c : -c
    })
    return arr
  }, [filteredRows, sortKey, sortDir])

  const stockBadgeMeta = useMemo(() => {
    const has30d = salesBySku30d != null && salesBySku30d !== 'error'
    if (!sortedRows.length || !has30d) {
      return { suppress: false, count: 0 }
    }
    const kinds = sortedRows.map((r) => stockBadgeKind(r))
    const count = kinds.filter(Boolean).length
    const suppress = count / sortedRows.length > 0.6
    return { suppress, count }
  }, [sortedRows, salesBySku30d])

  const productsBySku = useMemo(() => {
    const map = {}
    for (const p of aggregateSkus(skus, shipmentMeta, activeSeason).filter((row) => productMatchesActiveSeason(row, activeSeason))) {
      map[p.sku] = p
    }
    return map
  }, [skus, shipmentMeta, activeSeason])

  const pendingSaleLists = useMemo(
    () => markdownLists.filter((l) => l.kind !== 'removal' && l.status === 'pending'),
    [markdownLists],
  )

  const selectedCodes = useMemo(() => Object.keys(selectedSkus).filter((k) => selectedSkus[k]), [selectedSkus])
  const selectedCount = selectedCodes.length
  const allVisibleSelected = sortedRows.length > 0 && sortedRows.every((r) => selectedSkus[r.sku])
  const someVisibleSelected = sortedRows.some((r) => selectedSkus[r.sku])

  useEffect(() => {
    if (!bulkListId && pendingSaleLists[0]?.id) setBulkListId(pendingSaleLists[0].id)
  }, [bulkListId, pendingSaleLists])

  const toggleExpandedSku = (sku) => {
    setExpandedSkus((prev) => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
  }

  const handleMobileSortPick = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(PL_NUMERIC_SORT_COLS.has(key) ? 'desc' : 'asc')
    }
  }

  const handleMobileExportSelected = () => {
    const rows = sortedRows.filter((r) => selectedSkus[r.sku])
    if (!rows.length) return
    downloadTableCSV(
      ['SKU', 'Product', 'Brand', 'Gender', 'Sold', 'Profit', 'Margin %', 'Reasoning'],
      rows.map((r) => {
        const verdict = getReorderVerdict(r)
        return [
          r.sku,
          r.product_name,
          r.brand ?? '',
          r.genderBucket ?? '',
          r.sold ?? 0,
          Number(r.profit ?? 0).toFixed(0),
          `${(r.roi ?? 0).toFixed(1)}%`,
          verdict.reason ?? '',
        ]
      }),
      'product-lookup-selected.csv',
    )
  }

  const emptyRowsMessage = tab === 'search' && !qParam
    ? 'Enter a product name or SKU and press Search, or open All inventory for the full catalog.'
    : (showSlowOnly
        ? 'No slow movers match the selected filters.'
        : showLowStockOnly
          ? 'No low-stock products match the selected filters.'
          : report?.rows?.length > 0 && (brand !== 'all' || category !== 'all' || productType !== 'all' || gender !== 'all')
            ? 'No products match the selected brand, category, type, and/or gender filters.'
            : `No products match${tab === 'search' && qForApi ? ` “${qForApi}”` : ''}.`)

  const mobileSortLabel = PL_MOBILE_SORT_OPTIONS.find((o) => o.key === sortKey)?.label || 'Product name'

  const toggleRowSelect = (skuCode, e) => {
    e.stopPropagation()
    setSelectedSkus((prev) => {
      const next = { ...prev }
      if (next[skuCode]) delete next[skuCode]
      else next[skuCode] = true
      return next
    })
  }

  const toggleSelectAllVisible = (e) => {
    e.stopPropagation()
    setSelectedSkus((prev) => {
      const next = { ...prev }
      if (allVisibleSelected) {
        for (const r of sortedRows) delete next[r.sku]
      } else {
        for (const r of sortedRows) next[r.sku] = true
      }
      return next
    })
  }

  const handleBulkAddToSaleList = () => {
    if (!bulkListId || !bulkPct || selectedCount === 0) return
    setBulkAssigning(true)
    setBulkMessage('')
    let added = 0
    let skipped = 0
    for (const code of selectedCodes) {
      const row = productsBySku[code]
      if (!row) continue
      if (row.sale_active && row.sale_list_id && row.sale_list_id !== bulkListId) {
        skipped += 1
        continue
      }
      const reportRow = sortedRows.find((r) => r.sku === code)
      const item = {
        skuCode: code,
        productName: row.product_name || reportRow?.product_name || '',
        brand: row.brand || reportRow?.brand || '',
        category: row.category || reportRow?.category || '',
        gender: row.gender || reportRow?.gender || '',
        season: row.season || '',
        priceTag: Number(row.price_tag) || 0,
        salePct: bulkPct,
        salePrice: salePriceOf(row.price_tag, bulkPct),
        sizes: Array.isArray(row.sizes) ? row.sizes.join(', ') : String(row.sizes || reportRow?.sizes || ''),
      }
      if (addItemToMarkdownList(bulkListId, item)) added += 1
    }
    setBulkAssigning(false)
    if (added > 0) setSelectedSkus({})
    const listTitle = pendingSaleLists.find((l) => l.id === bulkListId)?.title || 'sale list'
    if (added === 0 && skipped > 0) {
      setBulkMessage(`No products added — ${skipped} already on another active sale list.`)
    } else if (skipped > 0) {
      setBulkMessage(`Added ${added} to “${listTitle}” at -${bulkPct}% (${skipped} skipped — on other list).`)
    } else {
      setBulkMessage(`Added ${added} product${added !== 1 ? 's' : ''} to “${listTitle}” at -${bulkPct}%.`)
    }
    setTimeout(() => setBulkMessage(''), 5000)
  }

  const NUMERIC_COLS = PL_NUMERIC_SORT_COLS
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(NUMERIC_COLS.has(key) ? 'desc' : 'asc')
    }
  }

  const runSearch = () => {
    setTab('search')
    const v = input.trim()
    if (v) setSearchParams({ q: v })
    else setSearchParams({})
  }

  const openModal = (row) => {
    const agg = aggregateSkus(skus, shipmentMeta, activeSeason)
      .filter((p) => productMatchesActiveSeason(p, activeSeason))
      .find((p) => p.sku === row.sku)
    if (agg) {
      const rowStock = Number(row.stock)
      const rowSold = Number(row.sold)
      const rowRevenue = Number(row.totalRevenue)
      setModalSku({
        ...agg,
        quantity: Number.isFinite(rowStock) ? rowStock : (Number(agg.quantity) || 0),
        sold_quantity: Number.isFinite(rowSold) ? rowSold : 0,
        _salesRevenue: Number.isFinite(rowRevenue) ? rowRevenue : (Number(agg._salesRevenue) || 0),
        netRevenue: Number.isFinite(rowRevenue) ? rowRevenue : (Number(agg.netRevenue) || 0),
      })
    }
  }

  const handleTableRowClick = (row) => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px) and (max-width: 1024px)').matches) {
      toggleExpandedSku(row.sku)
      return
    }
    openModal(row)
  }

  const modalStatus = modalSku
    ? getLifecycleStatus(modalSku.lifecycle_import_date ?? modalSku.import_date, modalSku.sold_quantity, modalSku.quantity)
    : 'Active'
  const tile = TILES.find((t) => t.status === modalStatus) || TILES[1]

  const filteredTotals = useMemo(() => {
    if (!report) return null
    return sumProductReportRows(filteredRows)
  }, [report, filteredRows])

  const rowsForBrandSummary = useMemo(() => {
    if (!reportRowsForUi.length || brand === 'all') return null
    return reportRowsForUi.filter((r) => {
      if (brandKeyFromRaw(r.brand) !== brand) return false
      if (category !== 'all' && categoryKeyFromRaw(r.category) !== category) return false
      if (productType !== 'all' && productTypeForRow(r, productTypeMap) !== productType) return false
      return true
    })
  }, [reportRowsForUi, brand, category, productType, productTypeMap])

  const brandScopeGenderParts = useMemo(() => {
    if (!rowsForBrandSummary?.length) return null
    const z = () => ({ stock: 0, remaining: 0, sold: 0 })
    const by = { Men: z(), Women: z(), Kids: z(), Unisex: z(), Unspecified: z() }
    for (const r of rowsForBrandSummary) {
      const b = r.genderBucket
      if (!by[b]) continue
      by[b].stock += r.stock ?? 0
      by[b].remaining += r.remaining ?? 0
      by[b].sold += r.sold ?? 0
    }
    return by
  }, [rowsForBrandSummary])

  if (!isExecutive(activeUser)) {
    return (
      <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}><IconLock size={48} strokeWidth={1.5} /></div>
        <h2 style={{ fontFamily: '"DM Sans"', fontSize: 22, letterSpacing: '2px', color: 'var(--ro-heading)', margin: '0 0 8px' }}>EXECUTIVE ACCESS ONLY</h2>
        <p style={{ fontSize: 13, color: 'var(--ro-text-muted)' }}>Product Lookup & AI Insights are only available to Executive users.</p>
      </div>
    )
  }

  return (
    <div className="product-lookup-page" style={{ width: '100%', maxWidth: '100%' }}>
      <div className="pl-page-header">
        <Link to="/" className="pl-dash-link">Dashboard</Link>
      </div>

      <div className="pl-filter-shell">
        <div className="pl-toolbar">
          <div className="pl-mode-group">
            {[
              { key: 'search', label: 'Search' },
              { key: 'all', label: 'All inventory' },
            ].map((t) => (
              <button
                key={t.key}
                className={`pl-mode-btn ${tab === t.key ? 'is-active' : ''}`}
                type="button"
                onClick={() => {
                  setTab(t.key)
                  if (t.key === 'all') setSearchParams({})
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'search' ? (
            <div className="pl-search-wrap pl-search-wrap--desktop">
              <span className="pl-search-icon" aria-hidden="true">⌕</span>
              <input
                className="pl-search-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                placeholder="Name or SKU…"
              />
              <button
                className="pl-search-go"
                type="button"
                onClick={runSearch}
              >
                Go
              </button>
            </div>
          ) : (
            <div className="pl-toolbar__spacer pl-toolbar__spacer--desktop" aria-hidden="true" />
          )}

          <div className="pl-filters-desktop">
            <div className="pl-menus">
              <BrandSelect
                value={brand}
                onChange={setBrand}
                allValue="all"
                allLabel="All Brands"
                options={brandOptions.filter((o) => o.key).map((o) => ({ value: o.key, label: o.label }))}
                isOpen={openMenu === 'brand'}
                onOpenChange={(open) => setOpenMenu(open ? 'brand' : null)}
              />
              <FilterMenu
                label="Category"
                value={category}
                options={CATEGORY_FILTERS}
                onChange={setCategory}
                accent="sky"
                isOpen={openMenu === 'category'}
                onToggle={() => setOpenMenu((m) => (m === 'category' ? null : 'category'))}
                onClose={() => setOpenMenu(null)}
              />
              <FilterMenu
                label="Type"
                value={productType}
                options={PRODUCT_TYPE_FILTERS}
                onChange={setProductType}
                accent="teal"
                isOpen={openMenu === 'type'}
                onToggle={() => setOpenMenu((m) => (m === 'type' ? null : 'type'))}
                onClose={() => setOpenMenu(null)}
              />
              <FilterMenu
                label="Gender"
                value={gender}
                options={GENDER_FILTERS}
                onChange={setGender}
                accent="sky"
                isOpen={openMenu === 'gender'}
                onToggle={() => setOpenMenu((m) => (m === 'gender' ? null : 'gender'))}
                onClose={() => setOpenMenu(null)}
              />
              {isExecutive(activeUser) && (
                <button
                  className="pl-ai-btn"
                  type="button"
                  onClick={classifyVisibleTypes}
                  disabled={isClassifyingTypes}
                  title={isClassifyingTypes ? 'Classifying…' : 'AI classify visible products'}
                >
                  <span className="pl-ai-btn__icon" aria-hidden="true">✦</span>
                  <span className="pl-ai-btn__label">{isClassifyingTypes ? 'Classifying…' : 'AI'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {tab === 'search' ? (
          <div className="pl-search-wrap pl-search-wrap--mobile">
            <input
              ref={mobileSearchRef}
              className="pl-search-input pl-search-input--mobile"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="Name or SKU…"
              aria-label="Search by name or SKU"
            />
            {input ? (
              <button
                type="button"
                className="pl-search-clear"
                onClick={() => setInput('')}
                aria-label="Clear search"
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="pl-mobile-filters">
          <div className="pl-mobile-filter-bar">
            <button type="button" className="pl-mobile-filter-trigger" onClick={() => setFiltersOpen(true)}>
              <IconSliders size={14} strokeWidth={1.75} aria-hidden />
              Filters
            </button>
            <div className="pl-mobile-filter-pills">
              {mobileFilterPills.map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  className="pl-mobile-filter-pill"
                  onClick={pill.clear}
                >
                  {pill.text} ×
                </button>
              ))}
            </div>
          </div>
        </div>

        {(() => {
          const brandLabel = brand === 'all'
            ? null
            : (brandOptions.find((o) => o.key === brand)?.label || brand)
          const categoryLabel = category === 'all'
            ? null
            : (CATEGORY_FILTERS.find((c) => c.key === category)?.label || category)
          const typeLabel = productType === 'all'
            ? null
            : (PRODUCT_TYPE_FILTERS.find((t) => t.key === productType)?.label || productType)
          const genderLabel = gender === 'all'
            ? null
            : (GENDER_FILTERS.find((g) => g.key === gender)?.label || gender)
          const activePills = [
            brandLabel && { key: 'brand', accent: 'sky', label: 'Brand', value: brandLabel, clear: () => setBrand('all') },
            categoryLabel && { key: 'category', accent: 'sky', label: 'Category', value: categoryLabel, clear: () => setCategory('all') },
            typeLabel && { key: 'type', accent: 'teal', label: 'Type', value: typeLabel, clear: () => setProductType('all') },
            genderLabel && { key: 'gender', accent: 'sky', label: 'Gender', value: genderLabel, clear: () => setGender('all') },
          ].filter(Boolean)

          if (activePills.length === 0) return null
          return (
            <div className="pl-filters-desktop">
              <div className="pl-active-bar">
                <span className="pl-active-bar__label">Active</span>
                <div className="pl-active-bar__pills">
                  {activePills.map((p) => (
                    <span key={p.key} className={`pl-active-pill pl-active-pill--${p.accent}`}>
                      <span className="pl-active-pill__group">{p.label}</span>
                      <span className="pl-active-pill__value">{p.value}</span>
                      <button
                        type="button"
                        className="pl-active-pill__x"
                        onClick={p.clear}
                        aria-label={`Clear ${p.label} filter`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="pl-active-bar__clear"
                    onClick={resetPlFilters}
                  >
                    Clear all
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {typeStatus && (
          <div className="pl-type-status">{typeStatus}</div>
        )}
      </div>

      {loadError && (
        <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 12, marginBottom: 12, fontFamily: DM }}>
          {loadError} — showing local data (import timeline unavailable).
        </div>
      )}

      {report && report._clientOnly && !loadError && (
        <div style={{ fontSize: 11, color: 'var(--ro-text-muted)', marginTop: 12, marginBottom: 12, fontFamily: DM }}>
          Using catalog from this device; start the server for full import history and shared totals.
        </div>
      )}

      {report && (
        <>
          <div className="pl-kpi-grid">
            {[
              ['Import', filteredTotals?.stock ?? 0, PL_KPI_ACCENT.Import, null],
              ['On hand', filteredTotals?.remaining ?? 0, PL_KPI_ACCENT['On hand'], null],
              ['Sold', filteredTotals?.sold ?? 0, PL_KPI_ACCENT.Sold, null],
              ['Cost', `€${(filteredTotals?.totalInvestment ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, PL_KPI_ACCENT.Cost, null],
              ['Revenue', `€${(filteredTotals?.totalRevenue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, PL_KPI_ACCENT.Revenue, null],
              ['Profit', `€${(filteredTotals?.totalProfit ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, PL_KPI_ACCENT.Profit, (filteredTotals?.totalProfit ?? 0) < 0 ? '#DC2626' : '#15803D'],
              ['Margin', `${(filteredTotals?.avgRoi ?? 0).toFixed(1)}%`, plMarginColor(filteredTotals?.avgRoi ?? 0), plMarginColor(filteredTotals?.avgRoi ?? 0)],
            ].map(([label, val, accent, valColor]) => (
              <div
                key={label}
                className="pl-kpi-tile"
                style={{ borderTopColor: accent }}
              >
                <div className="pl-kpi-tile__label">{label}</div>
                <div className="pl-kpi-tile__val" style={valColor ? { color: valColor } : undefined}>{val}</div>
              </div>
            ))}
            <button
              type="button"
              className={`pl-kpi-tile pl-kpi-tile--alert-slow${showSlowOnly ? ' is-active' : ''}`}
              onClick={() => { setShowSlowOnly((v) => !v); setShowLowStockOnly(false) }}
              title="Show products with 0 to 3 sold units"
            >
              <div className="pl-kpi-tile__label">Slow</div>
              <div className="pl-kpi-tile__val pl-kpi-tile__val--alert">{slowMoverCount}</div>
              <div className="pl-kpi-tile__hint">0-3 sold{showSlowOnly ? ' · active' : ''}</div>
            </button>
            <button
              type="button"
              className={`pl-kpi-tile pl-kpi-tile--alert-low${showLowStockOnly ? ' is-active' : ''}`}
              style={{ borderTopColor: '#D97706' }}
              onClick={() => { setShowLowStockOnly((v) => !v); setShowSlowOnly(false) }}
              title="Show products with 1 to 3 units left in stock"
            >
              <div className="pl-kpi-tile__label">Low stock</div>
              <div className="pl-kpi-tile__val pl-kpi-tile__val--warn">{lowStockCount}</div>
              <div className="pl-kpi-tile__hint">1-3 left{showLowStockOnly ? ' · active' : ''}</div>
            </button>
          </div>

          {gender === 'all' && brand === 'all' && category === 'all' && productType === 'all' && report.byGender && (
            <div className="pl-gender-summary">
              <GenderSummaryPart dotClass="pl-gender-dot--men" label="Men">
                Σ imported {report.byGender.Men?.imported ?? report.byGender.Men?.stock ?? 0}, on hand{' '}
                {report.byGender.Men?.remaining ?? 0}, sold {report.byGender.Men?.sold ?? 0}
              </GenderSummaryPart>
              <GenderSummaryPart dotClass="pl-gender-dot--women" label="Women">
                Σ imported {report.byGender.Women?.imported ?? report.byGender.Women?.stock ?? 0}, on hand{' '}
                {report.byGender.Women?.remaining ?? 0}, sold {report.byGender.Women?.sold ?? 0}
              </GenderSummaryPart>
              <GenderSummaryPart dotClass="pl-gender-dot--kids" label="Kids">
                Σ imported {report.byGender.Kids?.imported ?? report.byGender.Kids?.stock ?? 0}, on hand{' '}
                {report.byGender.Kids?.remaining ?? 0}, sold {report.byGender.Kids?.sold ?? 0}
              </GenderSummaryPart>
              <span className="pl-gender-summary__segment">
                <i className="pl-gender-dot pl-gender-dot--unisex" aria-hidden="true" />
                <strong className="pl-gender-summary__label">Unisex:</strong>
                <span className="pl-gender-summary__values">
                  Σ imported {report.byGender.Unisex?.imported ?? report.byGender.Unisex?.stock ?? 0}, on hand{' '}
                  {report.byGender.Unisex?.remaining ?? 0}, sold {report.byGender.Unisex?.sold ?? 0}
                </span>
              </span>
              {(report.byGender.Unspecified?.stock ?? 0) > 0 && (
                <>
                  <span className="pl-gender-summary__sep">·</span>
                  <span className="pl-gender-summary__segment">
                    <strong className="pl-gender-summary__label">Other/unspecified:</strong>
                    <span className="pl-gender-summary__values">
                      {' '}Σ imported {report.byGender.Unspecified?.imported ?? report.byGender.Unspecified?.stock ?? 0},
                      on hand {report.byGender.Unspecified?.remaining ?? 0}, sold {report.byGender.Unspecified?.sold ?? 0}
                    </span>
                  </span>
                </>
              )}
            </div>
          )}
          {gender === 'all' && brand !== 'all' && brandScopeGenderParts && rowsForBrandSummary.length > 0 && (
            <div className="pl-gender-summary">
              For this brand (catalog rows): <strong className="pl-gender-summary__label">Men</strong> — import (units) {brandScopeGenderParts.Men.stock}, on hand{' '}
              {brandScopeGenderParts.Men.remaining}, sold {brandScopeGenderParts.Men.sold}
              <span className="pl-gender-summary__sep">·</span>
              <strong className="pl-gender-summary__label">Women</strong> — import (units){' '}
              {brandScopeGenderParts.Women.stock}, on hand {brandScopeGenderParts.Women.remaining}, sold {brandScopeGenderParts.Women.sold}
              <span className="pl-gender-summary__sep">·</span>
              <strong className="pl-gender-summary__label">Kids</strong> — import (units) {brandScopeGenderParts.Kids.stock}, on hand {brandScopeGenderParts.Kids.remaining}, sold {brandScopeGenderParts.Kids.sold}
              <span className="pl-gender-summary__sep">·</span>
              <strong className="pl-gender-summary__label">Unisex</strong> — import (units) {brandScopeGenderParts.Unisex.stock}, on hand {brandScopeGenderParts.Unisex.remaining}, sold {brandScopeGenderParts.Unisex.sold}
              {brandScopeGenderParts.Unspecified.stock + brandScopeGenderParts.Unspecified.remaining + brandScopeGenderParts.Unspecified.sold > 0 && (
                <>
                  <span className="pl-gender-summary__sep">·</span>
                  <strong className="pl-gender-summary__label">Other/unspecified</strong> — import (units) {brandScopeGenderParts.Unspecified.stock}, on hand{' '}
                  {brandScopeGenderParts.Unspecified.remaining}, sold {brandScopeGenderParts.Unspecified.sold}
                </>
              )}
            </div>
          )}

          <div className={`product-lookup-table-scroll pl-table-wrap${selectedCount > 0 ? ' pl-table-wrap--bulk-open' : ''}`}>
            {stockBadgeMeta.suppress && stockBadgeMeta.count > 0 && (
              <div className="pl-stock-alert-banner" role="status">
                ⚠ {stockBadgeMeta.count} products at low stock levels
              </div>
            )}
            {canManage && selectedCount > 0 && (
              <div className="pl-bulk-bar pl-bulk-bar--desktop">
                <span className="pl-bulk-bar__count">
                  <strong>{selectedCount}</strong> selected
                </span>
                {pendingSaleLists.length === 0 ? (
                  <span className="pl-bulk-bar__hint">
                    No open sale lists — <Link to="/markdown">create one</Link>
                  </span>
                ) : (
                  <>
                    <select
                      className="pl-bulk-bar__select"
                      value={bulkListId}
                      onChange={(e) => setBulkListId(e.target.value)}
                    >
                      {pendingSaleLists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title || 'Sale list'} ({(l.items || []).length})
                        </option>
                      ))}
                    </select>
                    <div className="pl-bulk-bar__pills">
                      {DISCOUNTS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`pl-bulk-bar__pill${bulkPct === d ? ' pl-bulk-bar__pill--active' : ''}`}
                          onClick={() => setBulkPct(d)}
                        >
                          -{d}%
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="pl-bulk-bar__action"
                      disabled={!bulkListId || bulkAssigning}
                      onClick={handleBulkAddToSaleList}
                    >
                      {bulkAssigning ? 'Adding…' : 'Add to sale list'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="pl-bulk-bar__clear"
                  onClick={() => setSelectedSkus({})}
                >
                  Clear
                </button>
              </div>
            )}
            {canManage && bulkMessage && (
              <div className="pl-bulk-bar__message pl-bulk-bar__message--desktop">{bulkMessage}</div>
            )}

            <div className="pl-mobile-list">
              <div className="pl-mobile-list-header">
                <div className="pl-mobile-list-header__left">
                  {canManage ? (
                    <input
                      type="checkbox"
                      className="pl-bulk-check pl-mobile-list-header__check"
                      checked={allVisibleSelected}
                      ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected }}
                      onChange={toggleSelectAllVisible}
                      aria-label="Select all visible products"
                    />
                  ) : null}
                  <span className="pl-mobile-list-header__sort-label">
                    {mobileSortLabel}
                    <span aria-hidden="true">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
                  </span>
                </div>
                <button type="button" className="pl-mobile-list-header__sort-btn" onClick={() => setSortOpen(true)}>
                  Sort
                </button>
              </div>

              {sortedRows.length === 0 ? (
                <div className="pl-mobile-list-empty">{emptyRowsMessage}</div>
              ) : (
                sortedRows.map((row) => {
                  const verdict = getReorderVerdict(row)
                  const thumbUrl = skuPhoto[row.sku] || photoMap[row.sku] || null
                  const lifecycleStatus = getLifecycleStatus(row.first_import_date, row.sold, row.stock)
                  const stockBadge = stockBadgeMeta.suppress ? null : stockBadgeKind(row)
                  const isExpanded = expandedSkus.has(row.sku)
                  const isRowSelected = !!selectedSkus[row.sku]
                  const marginPct = parseMarginPct(row.roi)
                  const marginClass = marginPct >= 45 ? 'pl-mobile-card__margin--good' : marginPct >= 30 ? 'pl-mobile-card__margin--mid' : 'pl-mobile-card__margin--bad'
                  const profitText = salesBySku == null
                    ? '—'
                    : fmtEuroShort(row.profit, 0)
                  const soldText = salesBySku == null ? '—' : String(row.sold ?? 0)
                  return (
                    <div
                      key={row.sku}
                      className={`pl-mobile-card${isRowSelected ? ' pl-mobile-card--selected' : ''}${isExpanded ? ' pl-mobile-card--expanded' : ''}`}
                    >
                      <button
                        type="button"
                        className="pl-mobile-card__main"
                        onClick={() => toggleExpandedSku(row.sku)}
                        aria-expanded={isExpanded}
                      >
                        <div className="pl-mobile-card__body">
                          <div className="pl-mobile-card__left">
                            <div className="pl-mobile-card__title-row">
                              {canManage ? (
                                <input
                                  type="checkbox"
                                  className="pl-bulk-check pl-mobile-card__check"
                                  checked={!!selectedSkus[row.sku]}
                                  onChange={(e) => toggleRowSelect(row.sku, e)}
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={`Select ${row.product_name || row.sku}`}
                                />
                              ) : null}
                              <span className="pl-mobile-card__name">{toTitleCase(row.product_name)}</span>
                            </div>
                            <div className="pl-chip-row pl-mobile-card__badges">
                              {row.sale_active ? <SaleBadge percent={row.sale_percent} /> : null}
                              {lifecycleStatus && lifecycleStatus !== '—' ? (
                                <span className={lifecycleBadgeClass(lifecycleStatus)}>
                                  {lifecycleStatus}
                                </span>
                              ) : null}
                              {stockBadge === 'low' ? (
                                <StatusBadge variant="low-stock">Low</StatusBadge>
                              ) : null}
                              {stockBadge === 'dead' ? (
                                <StatusBadge variant="dead-stock">Dead stock</StatusBadge>
                              ) : null}
                            </div>
                            <div className="pl-mobile-card__meta">
                              {row.sku} · {row.brand ?? '—'} · {row.genderBucket ?? '—'}
                            </div>
                            <div className="pl-mobile-card__metrics">
                              <span>Profit: {profitText}</span>
                              <span className="pl-mobile-card__metrics-sep">·</span>
                              <span>Sold: {soldText}</span>
                            </div>
                          </div>
                          <div className="pl-mobile-card__right">
                            <div className="pl-mobile-card__thumb-wrap">
                              {thumbUrl ? (
                                <img src={thumbUrl} alt="" className="pl-mobile-card__thumb" />
                              ) : (
                                <div className="pl-mobile-card__thumb pl-mobile-card__thumb--empty">—</div>
                              )}
                            </div>
                            <div className={`pl-mobile-card__margin-pill ${marginClass}`}>
                              {salesBySku == null ? '—' : `${marginPct.toFixed(1)}%`}
                            </div>
                            <div className="pl-mobile-card__margin-sub">margin</div>
                          </div>
                        </div>
                      </button>

                      {isExpanded ? (
                        <div className="pl-mobile-card__expanded">
                          <div className="pl-mobile-card__grid">
                            <div className="pl-mobile-card__field">
                              <span className="pl-mobile-card__field-label">Import</span>
                              <span className="pl-mobile-card__field-val">{row.stock ?? 0}</span>
                            </div>
                            <div className="pl-mobile-card__field">
                              <span className="pl-mobile-card__field-label">Sold</span>
                              <span className="pl-mobile-card__field-val">{soldText}</span>
                            </div>
                            <div className="pl-mobile-card__field">
                              <span className="pl-mobile-card__field-label">On hand</span>
                              <span className="pl-mobile-card__field-val">{row.remaining ?? 0}</span>
                            </div>
                            <div className="pl-mobile-card__field">
                              <span className="pl-mobile-card__field-label">Cost</span>
                              <span className="pl-mobile-card__field-val">{fmtEuroShort(row.totalInvestment, 0)}</span>
                            </div>
                            <div className="pl-mobile-card__field">
                              <span className="pl-mobile-card__field-label">COGS</span>
                              <span className="pl-mobile-card__field-val">{salesBySku == null ? '—' : fmtEuroShort(row.cogs, 0)}</span>
                            </div>
                            <div className="pl-mobile-card__field">
                              <span className="pl-mobile-card__field-label">Revenue</span>
                              <span className="pl-mobile-card__field-val">{salesBySku == null ? '—' : fmtEuroShort(row.totalRevenue, 0)}</span>
                            </div>
                            <div className="pl-mobile-card__field">
                              <span className="pl-mobile-card__field-label">Avg ticket</span>
                              <span className="pl-mobile-card__field-val">{fmtEuroShort(row.avgTicket, 2)}</span>
                            </div>
                            <div className="pl-mobile-card__field">
                              <span className="pl-mobile-card__field-label">Profit</span>
                              <span className="pl-mobile-card__field-val">{profitText}</span>
                            </div>
                          </div>
                          <div className="pl-mobile-card__reasoning">
                            <span className="pl-mobile-card__reasoning-label">Reasoning:</span>{' '}
                            {verdict.reason || '—'}
                          </div>
                          <div className="pl-mobile-card__actions">
                            <button
                              type="button"
                              className="pl-mobile-card__details-btn"
                              onClick={() => openModal(row)}
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              className="pl-mobile-card__delete-btn"
                              aria-label={`Delete ${row.sku}`}
                              disabled={deletingSku === row.sku}
                              onClick={() => {
                                setDeleteError('')
                                setDeleteConfirmRow(row)
                              }}
                            >
                              <IconDelete size={16} strokeWidth={1.75} />
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>

            <table className="pl-table pl-table-desktop">
              <thead>
                <tr>
                  {[
                    ['product_name', 'Product'],
                    ['_photo', ''],
                    ['sku', 'SKU'],
                    ['brand', 'Brand'],
                    ['productType', 'Type'],
                    ['genderBucket', 'Gender'],
                    ['stock', 'Import'],
                    ['sold', 'Sold'],
                    ['remaining', 'On hand'],
                    ['totalInvestment', 'Cost'],
                    ['cogs', 'COGS'],
                    ['totalRevenue', 'Revenue'],
                    ['avgTicket', 'Avg ticket'],
                    ['profit', 'Profit'],
                    ['roi', 'Margin %'],
                    ['verdict', 'Reasoning'],
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      className={[
                        key === 'verdict' ? 'product-lookup-col-verdict' : '',
                        plColumnClass(key, 'th'),
                        plTableColClass(key),
                        sortKey === key ? 'pl-th--sorted' : '',
                        key !== 'verdict' && key !== '_photo' ? 'pl-th--sortable' : '',
                      ].filter(Boolean).join(' ')}
                      style={
                        key === '_photo'
                          ? { ...TH, cursor: 'default' }
                          : key === 'verdict'
                            ? { ...TH, cursor: 'default' }
                            : key === 'product_name'
                              ? { ...TH, minWidth: canManage ? 148 : undefined }
                              : TH
                      }
                      onClick={key !== 'verdict' && key !== '_photo' ? () => toggleSort(key) : undefined}
                    >
                      {key === 'product_name' && canManage ? (
                        <span className="pl-bulk-th">
                          <input
                            type="checkbox"
                            className="pl-bulk-check"
                            checked={allVisibleSelected}
                            ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected }}
                            onChange={toggleSelectAllVisible}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Select all visible products"
                          />
                          <span>
                            {label}
                            {sortKey === key ? (
                              <span className="pl-th-sort-icon" aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
                            ) : (
                              <span className="pl-th-sort-hint" aria-hidden="true">↕</span>
                            )}
                          </span>
                        </span>
                      ) : (
                        <>
                          {label}
                          {key !== 'verdict' && key !== '_photo' && (
                            sortKey === key ? (
                              <span className="pl-th-sort-icon" aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
                            ) : (
                              <span className="pl-th-sort-hint" aria-hidden="true">↕</span>
                            )
                          )}
                        </>
                      )}
                    </th>
                  ))}
                  <th className="pl-th pl-col-status col-status" style={{ ...TH, cursor: 'default' }}>
                    Status
                  </th>
                  <th className="pl-th pl-col-expand col-expand" style={{ ...TH, cursor: 'default' }} aria-hidden="true" />
                  <th
                    className="product-lookup-col-actions pl-th col-action"
                    style={{ ...TH, cursor: 'default', textAlign: 'center' }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={PL_TABLE_COLSPAN} style={{ ...TD, textAlign: 'center', color: 'var(--ro-text-muted)', padding: 28 }}>
                      {emptyRowsMessage}
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => {
                    const verdict = getReorderVerdict(row)
                    const thumbUrl = skuPhoto[row.sku] || photoMap[row.sku] || null
                    const lifecycleStatus = getLifecycleStatus(row.first_import_date, row.sold, row.stock)
                    const stockBadge = stockBadgeMeta.suppress ? null : stockBadgeKind(row)
                    const rowType = formatProductType(row.productType || productTypeForRow(row, productTypeMap))
                    const isRowSelected = !!selectedSkus[row.sku]
                    const isExpanded = expandedSkus.has(row.sku)
                    const profitText = salesBySku == null
                      ? '—'
                      : fmtEuroShort(row.profit, 0)
                    return (
                      <Fragment key={row.sku}>
                      <tr
                        className={`pl-table-row clickable-row${isRowSelected ? ' pl-row--bulk-selected row-selected' : ''}${isExpanded ? ' pl-table-row--expanded' : ''}`}
                        onClick={() => handleTableRowClick(row)}
                      >
                        <td className={`pl-td pl-td--product ${plTableColClass('product_name')}`} style={TD}>
                          <div className="pl-product-cell">
                            {canManage && (
                              <input
                                type="checkbox"
                                className="pl-bulk-check"
                                checked={!!selectedSkus[row.sku]}
                                onChange={(e) => toggleRowSelect(row.sku, e)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${row.product_name || row.sku}`}
                              />
                            )}
                            <div className="pl-product-cell__main">
                              <div className="pl-product-name">{toTitleCase(row.product_name)}</div>
                              <div className="pl-chip-row">
                                {row.sale_active ? <SaleBadge percent={row.sale_percent} /> : null}
                                {lifecycleStatus && lifecycleStatus !== '—' ? (
                                  <span className={`pl-chip-lifecycle ${lifecycleBadgeClass(lifecycleStatus)}`}>
                                    {lifecycleStatus}
                                  </span>
                                ) : null}
                                {stockBadge === 'low' ? (
                                  <StatusBadge variant="low-stock">Low</StatusBadge>
                                ) : null}
                                {stockBadge === 'dead' ? (
                                  <StatusBadge variant="dead-stock">Dead stock</StatusBadge>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className={`pl-td pl-td--photo ${plTableColClass('_photo')}`} style={TD}>
                          <div className="pl-thumb-wrap">
                            {thumbUrl ? (
                              <img src={thumbUrl} alt="" className="pl-thumb" />
                            ) : (
                              <div className="pl-thumb pl-thumb--empty">—</div>
                            )}
                          </div>
                        </td>
                        <td className={`pl-td pl-td--sku ${plTableColClass('sku')}`} style={TD}>{row.sku}</td>
                        <td className={`${plColumnClass('brand')} ${plTableColClass('brand')}`} style={TD}>{row.brand ?? '—'}</td>
                        <td className={`${plColumnClass('productType')} ${plTableColClass('productType')}`} style={TD}>
                          <span className="pl-type-pill">{rowType}</span>
                        </td>
                        <td className={`${plColumnClass('genderBucket')} ${plTableColClass('genderBucket')}`} style={TD}>{row.genderBucket}</td>
                        <td className={`${plColumnClass('stock')} ${plTableColClass('stock')}`} style={TD}>{row.stock}</td>
                        <td className={`pl-td pl-td--num ${plTableColClass('sold')}`} style={TD}>
                          {salesBySku == null ? <span className="pl-td--muted">—</span> : row.sold}
                        </td>
                        <td className={`pl-td pl-td--num ${plTableColClass('remaining')}`} style={TD}>{row.remaining}</td>
                        <td className={`pl-td pl-td--num ${plTableColClass('totalInvestment')}`} style={TD}>€{(row.totalInvestment ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td className={`pl-td pl-td--num ${plTableColClass('cogs')}`} style={TD}>
                          {salesBySku == null ? (
                            <span className="pl-td--muted">—</span>
                          ) : (
                            `€${(row.cogs ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          )}
                        </td>
                        <td className={`pl-td pl-td--num ${plTableColClass('totalRevenue')}`} style={TD}>
                          {salesBySku == null ? (
                            <span className="pl-td--muted">—</span>
                          ) : (
                            `€${(row.totalRevenue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          )}
                        </td>
                        <td className={`pl-td pl-td--num ${plTableColClass('avgTicket')}`} style={TD}>€{(row.avgTicket ?? 0).toFixed(2)}</td>
                        <td
                          className={`pl-td pl-td--num pl-td--profit ${plTableColClass('profit')}`}
                          style={{
                            ...TD,
                            color: plProfitColor(row.profit, row.roi),
                            fontWeight: (parseFloat(row.profit) || 0) !== 0 ? 600 : 400,
                          }}
                        >
                          {salesBySku == null ? (
                            <span className="pl-td--muted">—</span>
                          ) : (
                            `€${(row.profit ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          )}
                        </td>
                        <td
                          className={`pl-td pl-td--num pl-td--margin ${plTableColClass('roi')}`}
                          style={{
                            ...TD,
                            color: plMarginColor(row.roi),
                            fontWeight: parseMarginPct(row.roi) !== 0 ? 600 : 400,
                          }}
                        >
                          {salesBySku == null ? (
                            <span className="pl-td--muted">—</span>
                          ) : (
                            `${(row.roi ?? 0).toFixed(1)}%`
                          )}
                        </td>
                        <td className={`product-lookup-col-verdict pl-td pl-td--reasoning ${plTableColClass('verdict')}`} style={TD} title={verdict.reason}>
                          <div className="pl-reasoning">{verdict.reason}</div>
                        </td>
                        <td className="pl-td pl-col-status col-status" style={TD}>
                          {lifecycleStatus && lifecycleStatus !== '—' ? (
                            <span className={lifecycleBadgeClass(lifecycleStatus)}>
                              {lifecycleStatus}
                            </span>
                          ) : (
                            <span className="pl-td--muted">—</span>
                          )}
                        </td>
                        <td className="pl-td pl-col-expand col-expand" style={TD}>
                          <IconChevronDown
                            className={`pl-table-expand-chevron${isExpanded ? ' is-open' : ''}`}
                            size={14}
                            strokeWidth={2}
                            aria-hidden
                          />
                        </td>
                        <td className={`product-lookup-col-actions pl-td col-action`} style={TD}>
                          <div className="pl-row-actions">
                            <button
                              type="button"
                              className="pl-details-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                openModal(row)
                              }}
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              className="pl-row-delete-btn"
                              aria-label={`Delete ${row.sku}`}
                              title={`Delete ${row.sku}`}
                              disabled={deletingSku === row.sku}
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteError('')
                                setDeleteConfirmRow(row)
                              }}
                            >
                              <IconDelete size={14} strokeWidth={1.75} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="pl-table-expand-row">
                          <td colSpan={PL_TABLE_COLSPAN} className="pl-table-expand-cell">
                            <div className="pl-table-expand-grid">
                              <div className="pl-table-expand-field">
                                <span className="pl-table-expand-field__label">SKU</span>
                                <span className="pl-table-expand-field__val">{row.sku}</span>
                              </div>
                              <div className="pl-table-expand-field">
                                <span className="pl-table-expand-field__label">Type</span>
                                <span className="pl-table-expand-field__val">{rowType}</span>
                              </div>
                              <div className="pl-table-expand-field">
                                <span className="pl-table-expand-field__label">Gender</span>
                                <span className="pl-table-expand-field__val">{row.genderBucket}</span>
                              </div>
                              <div className="pl-table-expand-field">
                                <span className="pl-table-expand-field__label">Import</span>
                                <span className="pl-table-expand-field__val">{row.stock ?? 0}</span>
                              </div>
                              <div className="pl-table-expand-field">
                                <span className="pl-table-expand-field__label">On hand</span>
                                <span className="pl-table-expand-field__val">{row.remaining ?? 0}</span>
                              </div>
                              <div className="pl-table-expand-field">
                                <span className="pl-table-expand-field__label">Cost</span>
                                <span className="pl-table-expand-field__val">{fmtEuroShort(row.totalInvestment, 0)}</span>
                              </div>
                              <div className="pl-table-expand-field">
                                <span className="pl-table-expand-field__label">COGS</span>
                                <span className="pl-table-expand-field__val">{salesBySku == null ? '—' : fmtEuroShort(row.cogs, 0)}</span>
                              </div>
                              <div className="pl-table-expand-field">
                                <span className="pl-table-expand-field__label">Revenue</span>
                                <span className="pl-table-expand-field__val">{salesBySku == null ? '—' : fmtEuroShort(row.totalRevenue, 0)}</span>
                              </div>
                              <div className="pl-table-expand-field">
                                <span className="pl-table-expand-field__label">Avg ticket</span>
                                <span className="pl-table-expand-field__val">{fmtEuroShort(row.avgTicket, 2)}</span>
                              </div>
                              <div className="pl-table-expand-field">
                                <span className="pl-table-expand-field__label">Profit</span>
                                <span className="pl-table-expand-field__val">{profitText}</span>
                              </div>
                            </div>
                            <div className="pl-table-expand-reasoning">
                              <span className="pl-table-expand-reasoning__label">Reasoning:</span>{' '}
                              {verdict.reason || '—'}
                            </div>
                            <div className="pl-table-expand-actions">
                              <button
                                type="button"
                                className="pl-details-btn"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openModal(row)
                                }}
                              >
                                Details
                              </button>
                              <button
                                type="button"
                                className="pl-row-delete-btn"
                                aria-label={`Delete ${row.sku}`}
                                title={`Delete ${row.sku}`}
                                disabled={deletingSku === row.sku}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteError('')
                                  setDeleteConfirmRow(row)
                                }}
                              >
                                <IconDelete size={14} strokeWidth={1.75} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {report.timeline?.length > 0 && (
            <div style={{ background: 'var(--ro-surface)', border: '1px solid var(--ro-border)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ro-text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, fontFamily: DM }}>
                Import history (this selection)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {report.timeline.map((t) => (
                  <div
                    key={t.importId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 12,
                      color: 'var(--ro-text)',
                      fontFamily: DM,
                      borderBottom: '1px solid var(--ro-border)',
                      paddingBottom: 8,
                    }}
                  >
                    <span>
                      {t.filename} <span style={{ color: 'var(--ro-text-muted)' }}>· {new Date(t.importedAt).toLocaleString()}</span>
                    </span>
                    <span style={{ color: '#38bdf8', fontWeight: 600 }}>+{t.unitsAdded} units</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {deleteSuccess && (
        <div className="pl-delete-toast" role="status">
          {deleteSuccess}
          <button type="button" className="pl-delete-toast__dismiss" onClick={() => setDeleteSuccess('')} aria-label="Dismiss">×</button>
        </div>
      )}

      {deleteConfirmRow && (
        <div className="pl-delete-modal-backdrop" role="presentation" onClick={() => !deletingSku && setDeleteConfirmRow(null)}>
          <div className="pl-delete-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="pl-delete-modal__eyebrow">Confirm delete</div>
            <div className="pl-delete-modal__title">
              Delete {deleteConfirmRow.sku}?
            </div>
            <div className="pl-delete-modal__meta">
              <span>Product</span><strong>{deleteConfirmRow.product_name || deleteConfirmRow.sku}</strong>
              {deleteConfirmRow.brand ? (<><span>Brand</span><strong>{deleteConfirmRow.brand}</strong></>) : null}
            </div>
            <p className="pl-delete-modal__body">
              This cannot be undone. The product (all sizes) will be hidden from dashboards, reports, bestsellers, and product lookup. It stays in the Recycle Bin for <strong>30 days</strong> — open the Recycle Bin to restore it any time before it auto-deletes.
            </p>
            {deleteError && <div className="pl-delete-modal__error">{deleteError}</div>}
            <div className="pl-delete-modal__actions">
              <button
                type="button"
                className="pl-delete-modal__btn pl-delete-modal__btn--ghost"
                disabled={!!deletingSku}
                onClick={() => setDeleteConfirmRow(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pl-delete-modal__btn pl-delete-modal__btn--danger"
                disabled={!!deletingSku}
                onClick={handleConfirmDelete}
              >
                {deletingSku ? 'Moving…' : 'Move to bin'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalSku && (
        <ProductDetailModal
          sku={modalSku}
          status={modalStatus}
          statusData={{ label: modalStatus, color: tile.color, colorBg: tile.colorBg, icon: tile.icon }}
          saleListAssign
          onClose={() => setModalSku(null)}
        />
      )}

      {filtersOpen && createPortal(
        <div className="bs-filter-drawer-root">
          <div className="bs-filter-drawer-overlay" onClick={() => setFiltersOpen(false)} aria-hidden="true" />
          <div className="bs-filter-drawer-sheet" role="dialog" aria-modal aria-label="Filters">
            <div className="bs-filter-drawer-handle" aria-hidden="true" />
            <h2 className="bs-filter-drawer__title">Filters</h2>

            <div className="bs-filter-drawer__section">
              <div className="bs-filter-drawer__section-label">Brand</div>
              <BrandSelect
                className="brand-select-wrapper--drawer"
                value={brand}
                onChange={setBrand}
                allValue="all"
                allLabel="All Brands"
                options={brandOptions.filter((o) => o.key).map((o) => ({ value: o.key, label: o.label }))}
              />
            </div>

            <div className="bs-filter-drawer__section">
              <div className="bs-filter-drawer__section-label">Category</div>
              <div className="bs-filter-drawer__chips">
                {CATEGORY_FILTERS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`bs-filter-chip${category === c.key ? ' bs-filter-chip--active' : ''}`}
                    onClick={() => setCategory(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bs-filter-drawer__section">
              <div className="bs-filter-drawer__section-label">Type</div>
              <div className="bs-filter-drawer__chips">
                {PL_DRAWER_TYPE_FILTERS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`bs-filter-chip${(t.key === 'apparel' ? drawerTypeApparelActive : productType === t.key) ? ' bs-filter-chip--active' : ''}`}
                    onClick={() => selectDrawerType(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bs-filter-drawer__section">
              <div className="bs-filter-drawer__section-label">Gender</div>
              <div className="bs-filter-drawer__chips">
                {PL_DRAWER_GENDER_FILTERS.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    className={`bs-filter-chip${gender === g.key ? ' bs-filter-chip--active' : ''}`}
                    onClick={() => setGender(g.key)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <button type="button" className="bs-filter-drawer__apply" onClick={() => setFiltersOpen(false)}>
              Apply
            </button>
            <button
              type="button"
              className="bs-filter-drawer__reset"
              onClick={() => {
                resetPlFilters()
                setFiltersOpen(false)
              }}
            >
              Reset all
            </button>
          </div>
        </div>,
        document.body,
      )}

      {canManage && selectedCount > 0 && createPortal(
        <div className="pl-mobile-bulk-bar" role="toolbar" aria-label="Bulk actions">
          <span className="pl-mobile-bulk-bar__count">{selectedCount} selected</span>
          <div className="pl-mobile-bulk-bar__actions">
            <button type="button" className="pl-mobile-bulk-bar__btn" onClick={handleMobileExportSelected}>
              Export
            </button>
            <button type="button" className="pl-mobile-bulk-bar__btn" onClick={() => setSelectedSkus({})}>
              Deselect all
            </button>
          </div>
        </div>,
        document.body,
      )}

      {sortOpen && createPortal(
        <div className="bs-filter-drawer-root">
          <div className="bs-filter-drawer-overlay" onClick={() => setSortOpen(false)} aria-hidden="true" />
          <div className="bs-filter-drawer-sheet pl-mobile-sort-sheet" role="dialog" aria-modal aria-label="Sort products">
            <div className="bs-filter-drawer-handle" aria-hidden="true" />
            <h2 className="bs-filter-drawer__title">Sort by</h2>
            <div className="pl-mobile-sort-options">
              {PL_MOBILE_SORT_OPTIONS.map((opt) => {
                const active = sortKey === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    className={`pl-mobile-sort-option${active ? ' pl-mobile-sort-option--active' : ''}`}
                    onClick={() => handleMobileSortPick(opt.key)}
                  >
                    <span>{opt.label}</span>
                    {active ? (
                      <span className="pl-mobile-sort-option__dir" aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <button type="button" className="bs-filter-drawer__apply" onClick={() => setSortOpen(false)}>
              Apply
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
