import { useMemo, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store/useStore'
import { isExecutive } from '../utils/roles'
import { getDaysInStore, getLifecycleStatus, STATUS_COLORS } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import { normalizeGenderCodeForFilter } from '../utils/gender.js'
import { filterSkusByActiveSeason, isSeasonFilterActive } from '../utils/seasons.js'
import ProductCard from '../components/ProductCard'
import ProductDetailModal from '../components/ProductDetailModal'
import StatusChip from '../components/StatusChip'
import BrandSelect from '../components/BrandSelect.jsx'
import { fetchSalesBySku } from '../api/client.js'
import {
  IconFootwear,
  IconApparel,
  IconAccessories,
  IconPackage,
  IconTrendUp,
  IconSlowMover,
  IconWarning,
  IconDisplay,
  IconDownload,
  IconSliders,
  IconChevronDown,
  IconTag,
} from '../utils/icons.js'

const CATEGORY_FILTERS = ['All', 'Footwear', 'Apparel', 'Accessories']
const GENDER_FILTERS = [
  { key: 'All', label: 'All Genders' },
  { key: 'M', label: 'Male' },
  { key: 'F', label: 'Female' },
  { key: 'K', label: 'Kids' },
  { key: 'U', label: 'Unisex' },
]

const TIME_RANGES = [
  { key: 'all', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '2w', label: 'Last 2 Weeks' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
]

const RANK_MODES = [
  { key: 'sell_through', label: '% Sell-Through' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'qty_sold', label: 'Qty Sold' },
]

function computeSinceDate(key) {
  const now = new Date()
  switch (key) {
    case 'today': return now.toISOString().slice(0, 10)
    case 'yesterday': { const d = new Date(now); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) }
    case '7d': { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) }
    case '2w': { const d = new Date(now); d.setDate(d.getDate() - 14); return d.toISOString().slice(0, 10) }
    case 'month': return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    default: return null
  }
}

function computePreviousPeriod(key, customFrom, customTo) {
  const now = new Date()
  switch (key) {
    case 'today': {
      const d = new Date(now); d.setDate(d.getDate() - 1)
      return { since: d.toISOString().slice(0, 10), until: d.toISOString().slice(0, 10) }
    }
    case 'yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 2)
      const day = d.toISOString().slice(0, 10)
      return { since: day, until: day }
    }
    case '7d': {
      const s = new Date(now); s.setDate(s.getDate() - 14)
      const e = new Date(now); e.setDate(e.getDate() - 8)
      return { since: s.toISOString().slice(0, 10), until: e.toISOString().slice(0, 10) }
    }
    case '2w': {
      const s = new Date(now); s.setDate(s.getDate() - 28)
      const e = new Date(now); e.setDate(e.getDate() - 15)
      return { since: s.toISOString().slice(0, 10), until: e.toISOString().slice(0, 10) }
    }
    case 'month': {
      const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
      const m = now.getMonth() === 0 ? 12 : now.getMonth()
      const s = `${y}-${String(m).padStart(2, '0')}-01`
      const last = new Date(y, m, 0)
      return { since: s, until: last.toISOString().slice(0, 10) }
    }
    case 'custom': {
      if (!customFrom) return null
      const from = new Date(customFrom)
      const to = customTo ? new Date(customTo) : new Date()
      const span = to - from
      const prevTo = new Date(from.getTime() - 86400000)
      const prevFrom = new Date(prevTo.getTime() - span)
      return { since: prevFrom.toISOString().slice(0, 10), until: prevTo.toISOString().slice(0, 10) }
    }
    default: return null
  }
}

function periodWeeks(key, customFrom, customTo) {
  switch (key) {
    case 'today': return 1 / 7
    case 'yesterday': return 1 / 7
    case '7d': return 1
    case '2w': return 2
    case 'month': {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return Math.max((now - start) / (7 * 86400000), 1 / 7)
    }
    case 'custom': {
      if (!customFrom) return 1
      const from = new Date(customFrom)
      const to = customTo ? new Date(customTo) : new Date()
      return Math.max((to - from) / (7 * 86400000), 1 / 7)
    }
    default: return null
  }
}

function categoryNorm(cat) {
  return String(cat ?? '')
    .trim()
    .toLowerCase()
}

function matchesCategory(sku, filter) {
  if (filter === 'All') return true
  const cat = categoryNorm(sku.category)
  if (filter === 'Footwear') return cat === 'footwear'
  if (filter === 'Apparel') return cat === 'apparel'
  if (filter === 'Accessories') return cat === 'accessories'
  return true
}

function matchesGender(sku, filter) {
  if (filter === 'All') return true
  return normalizeGenderCodeForFilter(sku.gender) === filter
}

function normalizedBrand(brand) {
  const b = String(brand ?? '').trim()
  return b || 'Unknown'
}

function matchesBrand(sku, filter) {
  if (filter === 'All') return true
  return normalizedBrand(sku.brand) === filter
}

function hasPositivePeriodSales(sku, useEventSales) {
  if (!useEventSales) return true
  return (Number(sku._periodSold) || 0) > 0
}

/** Products eligible for the sold ranking (period sales for exec, lifetime for shop). */
function hasSoldForRanking(sku, hasEventSales) {
  if (hasEventSales) return (Number(sku._periodSold) || 0) > 0
  return (Number(sku.sold_quantity) || 0) > 0
}

function rankSubtitle(mode) {
  if (mode === 'revenue') return 'Ranked by revenue'
  if (mode === 'qty_sold') return 'Ranked by units sold'
  return 'Ranked by % sell-through'
}

function fmt(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return typeof n === 'number' ? n.toLocaleString('en', { maximumFractionDigits: 0 }) : n
}

const LOW_STOCK_THRESHOLD = 5

function unitsImported(sku, skuImportTotals) {
  return Number(skuImportTotals?.[sku.sku]) || Number(sku.quantity) || 0
}

function sellThroughPct(sku, hasEventSales, skuImportTotals) {
  const imported = unitsImported(sku, skuImportTotals)
  if (imported <= 0) return 0
  const sold = hasEventSales
    ? (Number(sku._periodSold) || 0)
    : (Number(sku.sold_quantity) || 0)
  return (sold / imported) * 100
}

function cardDisplaySku(sku, skuImportTotals) {
  const imported = unitsImported(sku, skuImportTotals)
  return imported > 0 ? { ...sku, quantity: imported } : sku
}

// ── Mini SVG Charts ──────────────────────────────────────────────────────────

function HorizontalBarChart({ items, maxValue }) {
  if (!items.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((item) => {
        const pct = maxValue > 0 ? (item.value / maxValue) * 100 : 0
        return (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 70, fontSize: 10, color: 'var(--ro-text-dim)', fontFamily: '"DM Sans"', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
            </div>
            <div style={{ flex: 1, height: 14, background: 'var(--ro-fill-faint)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
              <div style={{ width: `${Math.max(pct, 2)}%`, height: '100%', background: item.color || '#38bdf8', borderRadius: 3, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ width: 40, fontSize: 10, color: 'var(--ro-text)', fontFamily: '"DM Sans"', textAlign: 'right', flexShrink: 0 }}>
              {item.value}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DonutChart({ segments, size = 80, label }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) return null
  const r = (size - 8) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  let offset = 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map((seg) => {
          const pct = seg.value / total
          const dash = pct * circumference
          const gap = circumference - dash
          const el = (
            <circle key={seg.label} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={6} strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset} transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: 'stroke-dasharray 0.4s ease' }} />
          )
          offset += dash
          return el
        })}
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fill="var(--ro-text)" fontSize={13} fontFamily="DM Sans" fontWeight={700}>
          {total}
        </text>
      </svg>
      {label && <div style={{ fontSize: 9, color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: '"DM Sans"' }}>{label}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {segments.filter((s) => s.value > 0).map((seg) => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: 'var(--ro-text-dim)' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color }} />
            {seg.label} ({Math.round((seg.value / total) * 100)}%)
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export function Bestsellers() {
  const skus = useStore((s) => s.skus)
  const shipmentMeta = useStore((s) => s.shipmentMeta)
  const activeSeason = useStore((s) => s.activeSeason)
  const skuImportTotals = useStore((s) => s.skuImportTotals)
  const activeUser = useStore((s) => s.activeUser)
  const photoMap = useStore((s) => s.photoMap)
  const addAssignment = useStore((s) => s.addAssignment)

  const [categoryFilter, setCategoryFilter] = useState('All')
  const [genderFilter, setGenderFilter] = useState('All')
  const [brandFilter, setBrandFilter] = useState('All')
  const [timeRange, setTimeRange] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [rankMode, setRankMode] = useState('sell_through')
  const [limit, setLimit] = useState(10)
  const [showAllSold, setShowAllSold] = useState(false)
  const [selectedSku, setSelectedSku] = useState(null)
  const [salesData, setSalesData] = useState(null)
  const [prevSalesData, setPrevSalesData] = useState(null)
  const [showCompare, setShowCompare] = useState(false)
  const [actionToast, setActionToast] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [logicExpanded, setLogicExpanded] = useState(false)

  const exec = isExecutive(activeUser)

  useEffect(() => {
    if (!isExecutive(activeUser)) {
      setTimeRange('all')
      setRankMode('sell_through')
      setShowCompare(false)
    }
  }, [activeUser])

  useEffect(() => {
    setShowAllSold(false)
  }, [timeRange, categoryFilter, genderFilter, brandFilter, activeSeason, rankMode, limit])

  const seasonFilteredSkus = useMemo(
    () => filterSkusByActiveSeason(skus, activeSeason),
    [skus, activeSeason],
  )

  const products = useMemo(
    () => aggregateSkus(seasonFilteredSkus, shipmentMeta),
    [seasonFilteredSkus, shipmentMeta],
  )

  const brandOptions = useMemo(() => {
    const brands = new Set()
    for (const p of products) {
      if (!matchesCategory(p, categoryFilter)) continue
      if (!matchesGender(p, genderFilter)) continue
      brands.add(normalizedBrand(p.brand))
    }
    return [...brands].sort((a, b) => a.localeCompare(b))
  }, [products, categoryFilter, genderFilter])

  useEffect(() => {
    if (brandFilter !== 'All' && !brandOptions.includes(brandFilter)) {
      setBrandFilter('All')
    }
  }, [brandFilter, brandOptions])

  const filteredProducts = useMemo(() => (
    products.filter((s) => (
      matchesCategory(s, categoryFilter) &&
      matchesGender(s, genderFilter) &&
      matchesBrand(s, brandFilter)
    ))
  ), [products, categoryFilter, genderFilter, brandFilter])

  const sinceDate = useMemo(() => {
    if (timeRange === 'custom') return customFrom || null
    return computeSinceDate(timeRange)
  }, [timeRange, customFrom])

  const untilDate = useMemo(() => {
    if (timeRange === 'custom') return customTo || null
    if (timeRange === 'yesterday') return computeSinceDate('yesterday')
    return null
  }, [timeRange, customTo])

  /** Executives: always load /sales/by-sku so all-time and period views both use signed SUMs from sales_events. */
  const dateRangeActive = timeRange !== 'all'
  const hasEventSales = exec && salesData !== null

  const fetchSales = useCallback(async () => {
    if (!exec) {
      setSalesData(null)
      setPrevSalesData(null)
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    try {
      const since = timeRange === 'all' ? '1970-01-01' : (sinceDate || '1970-01-01')
      const until = timeRange === 'all' ? today : untilDate
      const data = await fetchSalesBySku(since, until, activeSeason)
      const map = {}
      if (Array.isArray(data)) for (const r of data) map[r.sku] = r
      setSalesData(map)
    } catch { setSalesData(null) }

    const prev = timeRange === 'all' ? null : computePreviousPeriod(timeRange, customFrom, customTo)
    if (prev) {
      try {
        const data = await fetchSalesBySku(prev.since, prev.until, activeSeason)
        const map = {}
        if (Array.isArray(data)) for (const r of data) map[r.sku] = r
        setPrevSalesData(map)
      } catch { setPrevSalesData(null) }
    } else { setPrevSalesData(null) }
  }, [exec, timeRange, sinceDate, untilDate, customFrom, customTo, activeSeason])

  useEffect(() => { fetchSales() }, [fetchSales])

  const weeks = useMemo(() => periodWeeks(timeRange, customFrom, customTo), [timeRange, customFrom, customTo])

  useEffect(() => {
    if (!filtersOpen) return undefined
    document.body.classList.add('sheet-open')
    return () => document.body.classList.remove('sheet-open')
  }, [filtersOpen])

  const activeFilterPills = useMemo(() => {
    const pills = []
    if (exec) pills.push(TIME_RANGES.find((t) => t.key === timeRange)?.label ?? 'All Time')
    pills.push(categoryFilter)
    pills.push(GENDER_FILTERS.find((g) => g.key === genderFilter)?.label ?? 'All Genders')
    pills.push(RANK_MODES.find((m) => m.key === rankMode)?.label ?? '% Sell-Through')
    return pills
  }, [exec, timeRange, categoryFilter, genderFilter, rankMode])

  function resetFilters() {
    setCategoryFilter('All')
    setGenderFilter('All')
    setBrandFilter('All')
    setTimeRange('all')
    setCustomFrom('')
    setCustomTo('')
    setRankMode('sell_through')
    setLimit(10)
    setShowCompare(false)
  }

  const timeRangeLabel = TIME_RANGES.find((t) => t.key === timeRange)?.label ?? 'All Time'
  const seasonScopeText = isSeasonFilterActive(activeSeason)
    ? `Showing ${activeSeason} assortment (includes carryover).`
    : 'Showing all seasons.'

  const logicBannerText = !exec ? (
    <>
      <strong className="bs-logic-banner__label">Shop view:</strong> {seasonScopeText} Ranked by lifetime sell-through % (sold ÷ total imported). Revenue, units sold, and time filters are available to executives.
    </>
  ) : (
    <>
      {seasonScopeText}{' '}
      {rankMode === 'sell_through' && (
        <>Sell-through uses sales in <strong>{timeRangeLabel}</strong> vs lifetime import.</>
      )}
      {rankMode === 'revenue' && (
        <>Ranked by revenue{dateRangeActive ? ` in ${timeRangeLabel}` : ''}.</>
      )}
      {rankMode === 'qty_sold' && (
        <>Ranked by units sold{dateRangeActive ? ` in ${timeRangeLabel}` : ''}.</>
      )}
    </>
  )

  // ── Enrich products with period data ────────────────────────────────────────
  const enrichProducts = useCallback((prods) => {
    if (hasEventSales) {
      return prods.map((s) => {
        const ev = salesData[s.sku]
        return ev
          ? { ...s, _periodSold: ev.sold_qty ?? 0, _periodRevenue: ev.revenue ?? 0 }
          : { ...s, _periodSold: 0, _periodRevenue: 0 }
      })
    }
    return prods.map((s) => ({
      ...s,
      _periodSold: s.sold_quantity ?? 0,
      _periodRevenue: s._salesRevenue ?? 0,
    }))
  }, [hasEventSales, salesData])

  const sortBest = useCallback((arr) => {
    const sorted = [...arr]
    switch (rankMode) {
      case 'revenue': sorted.sort((a, b) => b._periodRevenue - a._periodRevenue); break
      case 'qty_sold': sorted.sort((a, b) => b._periodSold - a._periodSold); break
      default: { const p = (s) => sellThroughPct(s, hasEventSales, skuImportTotals); sorted.sort((a, b) => p(b) - p(a)) }
    }
    return sorted
  }, [rankMode, hasEventSales, skuImportTotals])

  const sortWorst = useCallback((arr) => {
    const sorted = [...arr]
    switch (rankMode) {
      case 'revenue': sorted.sort((a, b) => a._periodRevenue - b._periodRevenue); break
      case 'qty_sold': sorted.sort((a, b) => a._periodSold - b._periodSold); break
      default: { const p = (s) => sellThroughPct(s, hasEventSales, skuImportTotals); sorted.sort((a, b) => p(a) - p(b)) }
    }
    return sorted
  }, [rankMode, hasEventSales, skuImportTotals])

  // ── Compute previous-period rankings for comparison ─────────────────────────
  const prevRankMap = useMemo(() => {
    if (!prevSalesData || !showCompare) return null
    const prods = filteredProducts.map((s) => {
      const ev = prevSalesData[s.sku]
      return ev
        ? { ...s, _periodSold: ev.sold_qty ?? 0, _periodRevenue: ev.revenue ?? 0 }
        : { ...s, _periodSold: 0, _periodRevenue: 0 }
    })
    const sorted = sortBest(prods.filter((s) => (Number(s._periodSold) || 0) > 0))
    const map = {}
    sorted.forEach((s, i) => { map[s.sku] = i + 1 })
    return map
  }, [prevSalesData, showCompare, filteredProducts, sortBest])

  const allRankedSkus = useMemo(() => {
    const filtered = enrichProducts(filteredProducts).filter((s) => hasSoldForRanking(s, hasEventSales))
    return sortBest(filtered)
  }, [filteredProducts, hasEventSales, enrichProducts, sortBest])

  const rankedSkus = useMemo(() => {
    if (showAllSold) return allRankedSkus
    return allRankedSkus.slice(0, limit)
  }, [allRankedSkus, showAllSold, limit])

  const rankedScopeLabel = showAllSold
    ? `All ${allRankedSkus.length} sold`
    : `Top ${Math.min(limit, allRankedSkus.length)}`

  const canExpandSoldList = allRankedSkus.length > limit

  function renderShowAllSoldControl(className = '') {
    if (allRankedSkus.length === 0) return null
    if (!canExpandSoldList) {
      return (
        <span className={`bs-show-all-sold-hint${className ? ` ${className}` : ''}`}>
          Showing all {allRankedSkus.length} sold
        </span>
      )
    }
    return (
      <button
        type="button"
        className={`bs-filter-chip bs-show-all-sold-btn${showAllSold ? ' bs-filter-chip--active' : ''}${className ? ` ${className}` : ''}`}
        onClick={() => setShowAllSold((v) => !v)}
      >
        Show all sold ({allRankedSkus.length})
      </button>
    )
  }

  const slowestSkus = useMemo(() => {
    const bestSkuSet = new Set(rankedSkus.map((s) => s.sku))
    const filtered = enrichProducts(
      filteredProducts.filter((s) => !bestSkuSet.has(s.sku))
    ).filter((s) => hasPositivePeriodSales(s, hasEventSales))
    return sortWorst(filtered).slice(0, limit === 20 ? 10 : 5)
  }, [filteredProducts, limit, hasEventSales, rankedSkus, enrichProducts, sortWorst])

  const emptyRankedMessage = (() => {
    if (products.length === 0 && isSeasonFilterActive(activeSeason)) {
      return `No ${activeSeason} products match the current filters.`
    }
    if (hasEventSales && filteredProducts.length > 0) {
      if (isSeasonFilterActive(activeSeason)) {
        return `No sales in this period for ${activeSeason} assortment.`
      }
      return 'No SKUs recorded sales for the selected period and filters.'
    }
    if (!hasEventSales && filteredProducts.length > 0 && allRankedSkus.length === 0) {
      return 'No products with sales in this assortment yet.'
    }
    return 'No products match the current filters.'
  })()

  function getMetric(sku) {
    switch (rankMode) {
      case 'revenue': return { value: `€${fmt(sku._periodRevenue)}`, label: 'Revenue' }
      case 'qty_sold': return { value: `${sku._periodSold}`, label: 'Units Sold' }
      default: {
        const pct = Math.round(sellThroughPct(sku, hasEventSales, skuImportTotals))
        return { value: `${pct}%`, label: 'Sell-through' }
      }
    }
  }

  function getVelocity(sku) {
    const sold = sku._periodSold ?? 0
    if (weeks && weeks > 0) return Math.round((sold / weeks) * 10) / 10
    const days = getDaysInStore(sku.import_date)
    if (days <= 0) return sold > 0 ? sold : 0
    const w = days / 7
    return Math.round((sold / w) * 10) / 10
  }

  function getRemaining(sku) {
    return Math.max(0, unitsImported(sku, skuImportTotals) - (Number(sku.sold_quantity) || 0))
  }

  // ── Brand breakdown ─────────────────────────────────────────────────────────
  const brandBreakdown = useMemo(() => {
    const counts = {}
    for (const s of rankedSkus) {
      const b = s.brand || 'Unknown'
      counts[b] = (counts[b] || 0) + 1
    }
    const colors = ['#38bdf8', '#00e676', '#ff8800', '#ff3333', '#a78bfa', '#f472b6', '#fbbf24', '#06b6d4']
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({ label, value, color: colors[i % colors.length] }))
  }, [rankedSkus])

  // ── Gender / Season drill-down ──────────────────────────────────────────────
  const genderSegments = useMemo(() => {
    const counts = { M: 0, F: 0, K: 0, U: 0, Other: 0 }
    for (const s of rankedSkus) {
      const c = normalizeGenderCodeForFilter(s.gender)
      if (c === 'U') counts.U++
      else if (c === 'M') counts.M++
      else if (c === 'F') counts.F++
      else if (c === 'K') counts.K++
      else counts.Other++
    }
    return [
      { label: 'Men', value: counts.M, color: '#38bdf8' },
      { label: 'Women', value: counts.F, color: '#f472b6' },
      { label: 'Kids', value: counts.K, color: '#fbbf24' },
      { label: 'Unisex', value: counts.U, color: '#a78bfa' },
      { label: 'Other', value: counts.Other, color: 'var(--ro-text-dim)' },
    ]
  }, [rankedSkus])

  const seasonSegments = useMemo(() => {
    const counts = {}
    for (const s of rankedSkus) {
      const sn = s.season || 'Unknown'
      counts[sn] = (counts[sn] || 0) + 1
    }
    const colors = ['#00e676', '#38bdf8', '#ff8800', '#a78bfa', '#f472b6', '#fbbf24']
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({ label, value, color: colors[i % colors.length] }))
  }, [rankedSkus])

  // ── Export CSV ──────────────────────────────────────────────────────────────
  function exportCsv() {
    const header = ['Rank', 'SKU', 'Product', 'Category', 'Brand', 'Season', 'Gender', 'Qty', 'Sold', 'Remaining', 'Sell-Through %', 'Revenue', 'Days In Store', 'Velocity (units/wk)']
    const rows = rankedSkus.map((sku, i) => {
      const pct = Math.round(sellThroughPct(sku, hasEventSales, skuImportTotals))
      const vel = getVelocity(sku)
      const imported = unitsImported(sku, skuImportTotals)
      return [
        i + 1, sku.sku, `"${(sku.product_name || '').replace(/"/g, '""')}"`,
        sku.category || '', sku.brand || '', sku.season || '', sku.gender || '',
        imported, sku._periodSold, getRemaining(sku),
        pct, (sku._periodRevenue || 0).toFixed(2),
        getDaysInStore(sku.import_date), vel ?? '',
      ].join(',')
    })
    const csv = [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const tLabel = TIME_RANGES.find((t) => t.key === timeRange)?.label || 'all'
    a.download = `bestsellers_${tLabel.replace(/\s/g, '_')}_${rankMode}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Action handlers for Slowest Movers ──────────────────────────────────────
  function handleMarkdown(sku) {
    addAssignment({
      type: 'markdown',
      skuCode: sku.sku,
      productName: `Apply -30% markdown: ${sku.product_name} (${sku.sku})`,
      assignedTo: activeUser?.name || 'Unassigned',
      shop: activeUser?.shop || '',
      status: 'pending',
      note: 'Auto-created from Bestsellers — Slowest Movers',
    })
    setActionToast(`Markdown task created for ${sku.sku}`)
    setTimeout(() => setActionToast(null), 3000)
  }

  function handleFrontDisplay(sku) {
    addAssignment({
      type: 'display_move',
      skuCode: sku.sku,
      productName: `Move to front display: ${sku.product_name} (${sku.sku})`,
      assignedTo: activeUser?.name || 'Unassigned',
      shop: activeUser?.shop || '',
      status: 'pending',
      note: 'Auto-created from Bestsellers — Slowest Movers',
    })
    setActionToast(`Front display task created for ${sku.sku}`)
    setTimeout(() => setActionToast(null), 3000)
  }

  return (
    <div className="bestsellers-page">
      {/* Header */}
      <div className="bs-page-header fade-up delay-1">
        <div className="bs-page-header__main page-hero-mobile-hide">
          <h1 className="bs-page-header__title">Bestsellers</h1>
          <p className="bs-page-header__subtitle">{rankSubtitle(rankMode)}</p>
        </div>
        <p className="bs-page-header__subtitle bs-page-header__subtitle--mobile">{rankSubtitle(rankMode)}</p>
        {exec && (
          <>
            <button type="button" className="bs-export-btn bs-export-btn--desktop" onClick={exportCsv}>
              <IconDownload size={14} strokeWidth={1.5} aria-hidden />
              Export CSV
            </button>
            <button type="button" className="bs-export-btn bs-export-btn--mobile" onClick={exportCsv} aria-label="Export CSV">
              <IconDownload size={14} strokeWidth={1.5} aria-hidden />
              <span className="bs-export-btn__label">Export</span>
            </button>
          </>
        )}
      </div>

      {/* Mobile filter summary + drawer trigger */}
      <div className="bs-mobile-filters fade-up delay-1">
        <div className="bs-mobile-filter-bar">
          <button type="button" className="bs-mobile-filter-trigger" onClick={() => setFiltersOpen(true)}>
            <IconSliders size={14} strokeWidth={1.75} aria-hidden />
            Filters
          </button>
          <div className="bs-mobile-filter-pills">
            {activeFilterPills.map((pill) => (
              <span key={pill} className="bs-mobile-filter-pill">{pill}</span>
            ))}
          </div>
        </div>
      </div>

      {!exec && (
        <p className="bs-manager-note fade-up delay-1">
          Rankings use <strong>sell-through %</strong> on your full inventory history (no revenue or period sales).
        </p>
      )}

      <div className="bs-filters-desktop">
      {/* Time-range pills (executives only) */}
      {exec ? (
        <div className="bs-filter-row fade-up delay-1">
          {TIME_RANGES.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`bs-filter-chip${timeRange === t.key ? ' bs-filter-chip--active' : ''}`}
              onClick={() => setTimeRange(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Custom date picker */}
      {exec && timeRange === 'custom' && (
        <div className="bs-custom-dates fade-up delay-1">
          <label className="bs-custom-dates__label">From</label>
          <input type="date" className="bs-custom-dates__input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <label className="bs-custom-dates__label">To</label>
          <input type="date" className="bs-custom-dates__input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </div>
      )}

      {/* Category + Gender + Brand */}
      <div className="bs-filter-row bs-filter-row--split fade-up delay-1">
        <div className="bs-filter-group">
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`bs-filter-chip${categoryFilter === f ? ' bs-filter-chip--active' : ''}`}
              onClick={() => setCategoryFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="bs-filter-divider" aria-hidden />
        <div className="bs-filter-group">
          {GENDER_FILTERS.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`bs-filter-chip${genderFilter === g.key ? ' bs-filter-chip--active' : ''}`}
              onClick={() => setGenderFilter(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <BrandSelect
          className="bestsellers-brand-filter"
          value={brandFilter}
          onChange={setBrandFilter}
          allValue="All"
          allLabel="All Brands"
          options={brandOptions.map((brand) => ({ value: brand, label: brand }))}
        />
      </div>

      {/* Sort metric + Top N + Compare */}
      <div className="bs-filter-row fade-up delay-1">
        {(exec ? RANK_MODES : RANK_MODES.filter((m) => m.key === 'sell_through')).map((m) => (
          <button
            key={m.key}
            type="button"
            className={`bs-filter-chip${rankMode === m.key ? ' bs-filter-chip--active' : ''}`}
            onClick={() => exec && setRankMode(m.key)}
          >
            {m.label}
          </button>
        ))}
        <div className="bs-filter-divider" aria-hidden />
        <button
          type="button"
          className={`bs-filter-chip${limit === 20 ? ' bs-filter-chip--active' : ''}`}
          onClick={() => setLimit(limit === 10 ? 20 : 10)}
        >
          Top {limit}
        </button>
        {canExpandSoldList && (
          <>
            <div className="bs-filter-divider" aria-hidden />
            {renderShowAllSoldControl()}
          </>
        )}
        {exec && dateRangeActive && (
          <>
            <div className="bs-filter-divider" aria-hidden />
            <button
              type="button"
              className={`bs-filter-chip bs-filter-chip--icon${showCompare ? ' bs-filter-chip--active' : ''}`}
              onClick={() => setShowCompare(!showCompare)}
            >
              <IconTrendUp size={12} strokeWidth={1.5} aria-hidden />
              vs Prev
            </button>
          </>
        )}
      </div>
      </div>

      {/* Info banner */}
      <div className={`bs-logic-banner fade-up delay-1${logicExpanded ? ' bs-logic-banner--expanded' : ''}`}>
        <button
          type="button"
          className="bs-logic-banner__toggle"
          onClick={() => setLogicExpanded((v) => !v)}
          aria-expanded={logicExpanded}
        >
          <span>ℹ️ Bestseller logic</span>
          <IconChevronDown size={14} strokeWidth={2} aria-hidden className="bs-logic-banner__chevron" />
        </button>
        <span className="bs-logic-banner__icon bs-logic-banner__icon--desktop" aria-hidden>ℹ</span>
        <div className="bs-logic-banner__text">
          {logicBannerText}
        </div>
      </div>

      {canExpandSoldList && (
        <div className="bs-show-all-sold-row bs-show-all-sold-row--mobile fade-up delay-2">
          {renderShowAllSoldControl()}
        </div>
      )}

      {/* Product card grid — responsive columns (see .bestsellers-product-grid in index.css) */}
      <div className="fade-up delay-2 bestsellers-product-grid">
        {rankedSkus.map((sku, i) => {
          const m = getMetric(sku)
          const vel = getVelocity(sku)
          const remaining = getRemaining(sku)
          const lowStock = remaining > 0 && remaining < LOW_STOCK_THRESHOLD
          return (
            <ProductCard
              key={sku.id ?? sku.sku}
              className="bestsellers-product-card"
              sku={cardDisplaySku(sku, skuImportTotals)}
              rank={i + 1}
              metric={m.value}
              metricLabel={m.label}
              velocity={vel}
              lowStock={lowStock}
              hideSalesCounts={!exec}
              showDayOverlay
              showBrandPill
              rankTrend={showCompare && prevRankMap ? { prevRank: prevRankMap[sku.sku] ?? null, currentRank: i + 1 } : null}
              onClick={() => setSelectedSku(sku)}
            />
          )
        })}
        {rankedSkus.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: 'var(--ro-text-muted)', fontSize: 13 }}>
            {emptyRankedMessage}
          </div>
        )}
      </div>

      {/* Analytics Row — Brand Breakdown + Gender + Season */}
      <div className="fade-up delay-2 bestsellers-analytics-row">
        {/* Brand breakdown */}
        <div style={{ background: 'var(--ro-surface)', border: '1px solid var(--ro-border)', borderRadius: 13, padding: 16 }}>
          <div style={{ fontFamily: '"DM Sans"', fontSize: 11, letterSpacing: '1.5px', color: 'var(--ro-text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>
            Brand Distribution ({rankedScopeLabel})
          </div>
          <HorizontalBarChart items={brandBreakdown} maxValue={Math.max(...brandBreakdown.map((b) => b.value), 1)} />
          {brandBreakdown.length === 0 && <div style={{ fontSize: 11, color: 'var(--ro-text-muted)' }}>No brand data</div>}
        </div>

        {/* Gender drill-down */}
        <div style={{ background: 'var(--ro-surface)', border: '1px solid var(--ro-border)', borderRadius: 13, padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <DonutChart segments={genderSegments} size={90} label="Gender Split" />
        </div>

        {/* Season drill-down */}
        <div style={{ background: 'var(--ro-surface)', border: '1px solid var(--ro-border)', borderRadius: 13, padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <DonutChart segments={seasonSegments} size={90} label="Season Split" />
        </div>
      </div>

      {/* Slowest Movers */}
      <div style={{ fontFamily: '"DM Sans"', fontSize: 14, letterSpacing: '2px', color: 'var(--ro-heading)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconSlowMover size={16} strokeWidth={1.5} color="#ff3333" />
        SLOWEST MOVERS — Needs Attention
      </div>

      <div style={{ background: 'var(--ro-surface)', border: '1px solid var(--ro-border)', borderRadius: 13, overflow: 'hidden', marginBottom: 22 }} className="fade-up delay-3">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ro-border)' }}>
              {[
                'Rank', 'Photo', 'Product', 'SKU',
                exec ? (rankMode === 'revenue' ? 'Revenue' : rankMode === 'qty_sold' ? 'Qty Sold' : 'Sell-through') : 'Sell-through',
                ...(exec ? ['Velocity'] : []),
                'Remaining', 'Days in store', 'Status', 'Action',
              ].map((h) => (
                <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--ro-text-muted)', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slowestSkus.map((sku, i) => {
              const thumbUrl = photoMap[sku.sku]
              const imported = unitsImported(sku, skuImportTotals)
              const pct = Math.round(sellThroughPct(sku, hasEventSales, skuImportTotals))
              const days = getDaysInStore(sku.import_date)
              const status = getLifecycleStatus(sku.import_date, sku.sold_quantity, imported)
              const rankColors = ['#ff3333', '#ff8800', '#fbbf24']
              const slowCount = slowestSkus.length
              const rankLabels = Array.from({ length: slowCount }, (_, j) => j === 0 ? '#1 worst' : `#${j + 1}`)
              const CategoryIcon = sku.category === 'Footwear' ? IconFootwear : sku.category === 'Apparel' ? IconApparel : sku.category === 'Accessories' ? IconAccessories : IconPackage
              const vel = getVelocity(sku)
              const remaining = getRemaining(sku)
              const lowStock = remaining > 0 && remaining < LOW_STOCK_THRESHOLD

              let metricCell
              if (exec && rankMode === 'revenue') metricCell = <span style={{ fontWeight: 700, color: 'var(--ro-text-dim)' }}>€{fmt(sku._periodRevenue)}</span>
              else if (exec && rankMode === 'qty_sold') metricCell = <span style={{ fontWeight: 700, color: 'var(--ro-text-dim)' }}>{sku._periodSold}</span>
              else metricCell = <span style={{ fontWeight: 700, color: pct < 15 ? '#ff3333' : '#ff8800' }}>{pct}%</span>

              return (
                <tr key={sku.id ?? sku.sku} style={{ borderBottom: '1px solid var(--ro-border)', transition: 'background 0.1s', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ro-surface-elevated)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                >
                  <td style={{ padding: '9px 14px', fontFamily: '"DM Sans"', fontSize: 11, color: rankColors[i] || 'var(--ro-text-dim)' }}>{rankLabels[i]}</td>
                  <td style={{ padding: '9px 14px', verticalAlign: 'middle' }} onClick={() => setSelectedSku(sku)}>
                    {thumbUrl ? (
                      <img src={thumbUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--ro-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CategoryIcon size={16} strokeWidth={1.5} color="var(--ro-text-dim)" />
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '9px 14px', fontSize: 12, fontWeight: 600, color: 'var(--ro-text)' }} onClick={() => setSelectedSku(sku)}>{sku.product_name}</td>
                  <td style={{ padding: '9px 14px', fontFamily: '"DM Sans"', fontSize: 11, color: 'var(--ro-text-dim)' }}>{sku.sku}</td>
                  <td style={{ padding: '9px 14px' }}>{metricCell}</td>
                  {exec ? (
                    <td style={{ padding: '9px 14px', fontFamily: '"DM Sans"', fontSize: 11, color: vel != null && vel > 0 ? 'var(--ro-text)' : 'var(--ro-text-muted)' }}>
                      {vel != null ? `${vel}/wk` : '—'}
                    </td>
                  ) : null}
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{ fontFamily: '"DM Sans"', fontSize: 11, fontWeight: lowStock ? 700 : 400, color: lowStock ? '#ff3333' : 'var(--ro-text-dim)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      {lowStock && <IconWarning size={11} strokeWidth={2} color="#ff3333" />}
                      {remaining}
                    </span>
                  </td>
                  <td style={{ padding: '9px 14px', fontFamily: '"DM Sans"', fontSize: 11, color: days > 150 ? '#ff3333' : days > 90 ? '#ff8800' : 'var(--ro-text-dim)' }}>{days}d</td>
                  <td style={{ padding: '9px 14px' }}><StatusChip status={status} /></td>
                  <td style={{ padding: '9px 14px' }}>
                    {(status === 'Clearance' || status === 'Outlet') ? (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleMarkdown(sku) }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 8, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#ff3333', color: '#fff', fontFamily: '"DM Sans"' }}>
                        <IconTag size={10} strokeWidth={2} /> Apply -30%
                      </button>
                    ) : (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleFrontDisplay(sku) }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 8, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'var(--ro-surface-elevated)', color: 'var(--ro-text-dim)', border: '1px solid var(--ro-border)', fontFamily: '"DM Sans"' }}>
                        <IconDisplay size={10} strokeWidth={2} /> Front display
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Action toast */}
      {actionToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#00e676', color: '#000', padding: '10px 18px', borderRadius: 10, fontSize: 12, fontWeight: 700, fontFamily: '"DM Sans"', zIndex: 9999, animation: 'fadeUp 0.3s ease' }}>
          {actionToast}
        </div>
      )}

      {selectedSku && (() => {
        const imported = unitsImported(selectedSku, skuImportTotals)
        const st = getLifecycleStatus(selectedSku.import_date, selectedSku.sold_quantity, imported)
        return (
          <ProductDetailModal
            sku={cardDisplaySku(selectedSku, skuImportTotals)}
            status={st}
            statusData={{ color: STATUS_COLORS[st] || 'var(--ro-text-dim)', colorBg: `${STATUS_COLORS[st] || '#64748b'}18` }}
            onClose={() => setSelectedSku(null)}
          />
        )
      })()}

      {filtersOpen && createPortal(
        <div className="bs-filter-drawer-root">
          <div className="bs-filter-drawer-overlay" onClick={() => setFiltersOpen(false)} aria-hidden="true" />
          <div className="bs-filter-drawer-sheet" role="dialog" aria-modal aria-label="Filters">
            <div className="bs-filter-drawer-handle" aria-hidden="true" />
            <h2 className="bs-filter-drawer__title">Filters</h2>

            {exec && (
              <div className="bs-filter-drawer__section">
                <div className="bs-filter-drawer__section-label">Time period</div>
                <div className="bs-filter-drawer__chips">
                  {TIME_RANGES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={`bs-filter-chip${timeRange === t.key ? ' bs-filter-chip--active' : ''}`}
                      onClick={() => setTimeRange(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {timeRange === 'custom' && (
                  <div className="bs-custom-dates bs-custom-dates--drawer">
                    <label className="bs-custom-dates__label">From</label>
                    <input type="date" className="bs-custom-dates__input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                    <label className="bs-custom-dates__label">To</label>
                    <input type="date" className="bs-custom-dates__input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                  </div>
                )}
              </div>
            )}

            <div className="bs-filter-drawer__section">
              <div className="bs-filter-drawer__section-label">Category</div>
              <div className="bs-filter-drawer__chips">
                {CATEGORY_FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`bs-filter-chip${categoryFilter === f ? ' bs-filter-chip--active' : ''}`}
                    onClick={() => setCategoryFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="bs-filter-drawer__section">
              <div className="bs-filter-drawer__section-label">Gender</div>
              <div className="bs-filter-drawer__chips">
                {GENDER_FILTERS.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    className={`bs-filter-chip${genderFilter === g.key ? ' bs-filter-chip--active' : ''}`}
                    onClick={() => setGenderFilter(g.key)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bs-filter-drawer__section">
              <div className="bs-filter-drawer__section-label">Brand</div>
              <BrandSelect
                className="brand-select-wrapper--drawer"
                value={brandFilter}
                onChange={setBrandFilter}
                allValue="All"
                allLabel="All Brands"
                options={brandOptions.map((brand) => ({ value: brand, label: brand }))}
              />
            </div>

            <div className="bs-filter-drawer__section">
              <div className="bs-filter-drawer__section-label">Sort by</div>
              <div className="bs-filter-drawer__chips">
                {(exec ? RANK_MODES : RANK_MODES.filter((m) => m.key === 'sell_through')).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`bs-filter-chip${rankMode === m.key ? ' bs-filter-chip--active' : ''}`}
                    onClick={() => exec && setRankMode(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`bs-filter-chip${limit === 20 ? ' bs-filter-chip--active' : ''}`}
                  onClick={() => setLimit(limit === 10 ? 20 : 10)}
                >
                  Top {limit}
                </button>
                {canExpandSoldList ? renderShowAllSoldControl() : null}
                {exec && dateRangeActive && (
                  <button
                    type="button"
                    className={`bs-filter-chip bs-filter-chip--icon${showCompare ? ' bs-filter-chip--active' : ''}`}
                    onClick={() => setShowCompare(!showCompare)}
                  >
                    <IconTrendUp size={12} strokeWidth={1.5} aria-hidden />
                    vs Prev
                  </button>
                )}
              </div>
            </div>

            <button type="button" className="bs-filter-drawer__apply" onClick={() => setFiltersOpen(false)}>
              Apply filters
            </button>
            <button
              type="button"
              className="bs-filter-drawer__reset"
              onClick={() => {
                resetFilters()
                setFiltersOpen(false)
              }}
            >
              Reset
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
