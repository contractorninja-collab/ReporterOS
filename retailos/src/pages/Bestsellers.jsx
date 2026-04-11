import { useMemo, useState, useEffect, useCallback } from 'react'
import { useStore } from '../store/useStore'
import { isExecutive } from '../utils/roles'
import { getSellThrough, getDaysInStore, getLifecycleStatus, STATUS_COLORS } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import ProductCard from '../components/ProductCard'
import ProductDetailModal from '../components/ProductDetailModal'
import StatusChip from '../components/StatusChip'
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
  IconCalendar,
  IconTag,
} from '../utils/icons.js'

const CATEGORY_FILTERS = ['All', 'Footwear', 'Apparel', 'K Kids']

const TIME_RANGES = [
  { key: 'all', label: 'All Time' },
  { key: 'today', label: 'Today' },
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

function matchesCategory(sku, filter) {
  if (filter === 'All') return true
  if (filter === 'Footwear') return (sku.category || '') === 'Footwear'
  if (filter === 'Apparel') return (sku.category || '') === 'Apparel'
  if (filter === 'K Kids') return (sku.gender || '').toUpperCase().startsWith('K')
  return true
}

const PILL = {
  padding: '5px 11px', borderRadius: 20, fontSize: 11, fontWeight: 600,
  cursor: 'pointer', transition: 'all 0.13s', fontFamily: '"DM Sans"',
}
const PILL_ON = { background: 'rgba(255,51,51,0.1)', border: '1px solid rgba(255,51,51,0.25)', color: '#ff3333' }
const PILL_OFF = { background: '#17171f', border: '1px solid rgba(255,255,255,0.055)', color: '#4a4a62' }
const TOGGLE_ON = { background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.25)', color: '#38bdf8' }
const TOGGLE_OFF = { background: '#17171f', border: '1px solid rgba(255,255,255,0.055)', color: '#4a4a62' }
const GREEN_ON = { background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.25)', color: '#00e676' }

function fmt(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return typeof n === 'number' ? n.toLocaleString('en', { maximumFractionDigits: 0 }) : n
}

const LOW_STOCK_THRESHOLD = 5

// ── Mini SVG Charts ──────────────────────────────────────────────────────────

function HorizontalBarChart({ items, maxValue }) {
  if (!items.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((item) => {
        const pct = maxValue > 0 ? (item.value / maxValue) * 100 : 0
        return (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 70, fontSize: 10, color: '#9090aa', fontFamily: '"DM Sans"', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
            </div>
            <div style={{ flex: 1, height: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
              <div style={{ width: `${Math.max(pct, 2)}%`, height: '100%', background: item.color || '#38bdf8', borderRadius: 3, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ width: 40, fontSize: 10, color: '#e4e4f0', fontFamily: '"DM Sans"', textAlign: 'right', flexShrink: 0 }}>
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
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fill="#e4e4f0" fontSize={13} fontFamily="DM Sans" fontWeight={700}>
          {total}
        </text>
      </svg>
      {label && <div style={{ fontSize: 9, color: '#4a4a62', textTransform: 'uppercase', letterSpacing: 1, fontFamily: '"DM Sans"' }}>{label}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {segments.filter((s) => s.value > 0).map((seg) => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: '#9090aa' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color }} />
            {seg.label} ({Math.round((seg.value / total) * 100)}%)
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Delta Arrow ──────────────────────────────────────────────────────────────

function DeltaBadge({ prevRank, currentRank }) {
  if (prevRank == null) return <span style={{ fontSize: 9, color: '#4a4a62', fontFamily: '"DM Sans"' }}>NEW</span>
  const diff = prevRank - currentRank
  if (diff === 0) return <span style={{ fontSize: 9, color: '#4a4a62', fontFamily: '"DM Sans"' }}>=</span>
  const up = diff > 0
  return (
    <span style={{ fontSize: 9, fontWeight: 700, fontFamily: '"DM Sans"', color: up ? '#00e676' : '#ff3333', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {up ? '▲' : '▼'}{Math.abs(diff)}
    </span>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export function Bestsellers() {
  const skus = useStore((s) => s.skus)
  const activeUser = useStore((s) => s.activeUser)
  const photoMap = useStore((s) => s.photoMap)
  const addAssignment = useStore((s) => s.addAssignment)

  const [categoryFilter, setCategoryFilter] = useState('All')
  const [timeRange, setTimeRange] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [rankMode, setRankMode] = useState('sell_through')
  const [limit, setLimit] = useState(10)
  const [selectedSku, setSelectedSku] = useState(null)
  const [salesData, setSalesData] = useState(null)
  const [prevSalesData, setPrevSalesData] = useState(null)
  const [showCompare, setShowCompare] = useState(false)
  const [actionToast, setActionToast] = useState(null)

  const exec = isExecutive(activeUser)

  useEffect(() => {
    if (!isExecutive(activeUser)) {
      setTimeRange('all')
      setRankMode('sell_through')
      setShowCompare(false)
    }
  }, [activeUser])

  const products = useMemo(() => aggregateSkus(skus), [skus])

  const sinceDate = useMemo(() => {
    if (timeRange === 'custom') return customFrom || null
    return computeSinceDate(timeRange)
  }, [timeRange, customFrom])

  const untilDate = useMemo(() => {
    if (timeRange === 'custom') return customTo || null
    return null
  }, [timeRange, customTo])

  const needsFetch = timeRange !== 'all'

  const fetchSales = useCallback(async () => {
    if (!needsFetch) { setSalesData(null); setPrevSalesData(null); return }
    try {
      const data = await fetchSalesBySku(sinceDate, untilDate)
      const map = {}
      if (Array.isArray(data)) for (const r of data) map[r.sku] = r
      setSalesData(map)
    } catch { setSalesData(null) }

    const prev = computePreviousPeriod(timeRange, customFrom, customTo)
    if (prev) {
      try {
        const data = await fetchSalesBySku(prev.since, prev.until)
        const map = {}
        if (Array.isArray(data)) for (const r of data) map[r.sku] = r
        setPrevSalesData(map)
      } catch { setPrevSalesData(null) }
    } else { setPrevSalesData(null) }
  }, [needsFetch, sinceDate, untilDate, timeRange, customFrom, customTo])

  useEffect(() => { fetchSales() }, [fetchSales])

  const isTimeLimited = needsFetch && salesData !== null

  const weeks = useMemo(() => periodWeeks(timeRange, customFrom, customTo), [timeRange, customFrom, customTo])

  // ── Enrich products with period data ────────────────────────────────────────
  function enrichProducts(prods) {
    if (isTimeLimited) {
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
  }

  function sortBest(arr) {
    const sorted = [...arr]
    switch (rankMode) {
      case 'revenue': sorted.sort((a, b) => b._periodRevenue - a._periodRevenue); break
      case 'qty_sold': sorted.sort((a, b) => b._periodSold - a._periodSold); break
      default: { const p = (s) => isTimeLimited ? (s.quantity > 0 ? (s._periodSold / s.quantity) * 100 : 0) : getSellThrough(s.sold_quantity, s.quantity); sorted.sort((a, b) => p(b) - p(a)) }
    }
    return sorted
  }

  function sortWorst(arr) {
    const sorted = [...arr]
    switch (rankMode) {
      case 'revenue': sorted.sort((a, b) => a._periodRevenue - b._periodRevenue); break
      case 'qty_sold': sorted.sort((a, b) => a._periodSold - b._periodSold); break
      default: { const p = (s) => isTimeLimited ? (s.quantity > 0 ? (s._periodSold / s.quantity) * 100 : 0) : getSellThrough(s.sold_quantity, s.quantity); sorted.sort((a, b) => p(a) - p(b)) }
    }
    return sorted
  }

  // ── Compute previous-period rankings for comparison ─────────────────────────
  const prevRankMap = useMemo(() => {
    if (!prevSalesData || !showCompare) return null
    let prods = products.filter((s) => matchesCategory(s, categoryFilter))
    prods = prods.map((s) => {
      const ev = prevSalesData[s.sku]
      return ev
        ? { ...s, _periodSold: ev.sold_qty ?? 0, _periodRevenue: ev.revenue ?? 0 }
        : { ...s, _periodSold: 0, _periodRevenue: 0 }
    })
    const sorted = sortBest(prods)
    const map = {}
    sorted.forEach((s, i) => { map[s.sku] = i + 1 })
    return map
  }, [prevSalesData, showCompare, products, categoryFilter, rankMode])

  const rankedSkus = useMemo(() => {
    const filtered = enrichProducts(products.filter((s) => matchesCategory(s, categoryFilter)))
    return sortBest(filtered).slice(0, limit)
  }, [products, categoryFilter, rankMode, limit, isTimeLimited, salesData])

  const slowestSkus = useMemo(() => {
    const bestSkuSet = new Set(rankedSkus.map((s) => s.sku))
    const filtered = enrichProducts(
      products.filter((s) => matchesCategory(s, categoryFilter) && !bestSkuSet.has(s.sku))
    )
    return sortWorst(filtered).slice(0, limit === 20 ? 10 : 5)
  }, [products, categoryFilter, rankMode, limit, isTimeLimited, salesData, rankedSkus])

  const headerLabel = useMemo(() => {
    const mode = RANK_MODES.find((m) => m.key === rankMode)?.label || '% SELL-THROUGH'
    return `BESTSELLERS — ${mode.toUpperCase()} RANKED`
  }, [rankMode])

  function getMetric(sku) {
    switch (rankMode) {
      case 'revenue': return { value: `€${fmt(sku._periodRevenue)}`, label: 'Revenue' }
      case 'qty_sold': return { value: `${sku._periodSold}`, label: 'Units Sold' }
      default: {
        const pct = isTimeLimited
          ? (sku.quantity > 0 ? Math.round((sku._periodSold / sku.quantity) * 100) : 0)
          : Math.round(getSellThrough(sku.sold_quantity, sku.quantity))
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
    return Math.max(0, (sku.quantity ?? 0) - (sku.sold_quantity ?? 0))
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
    const counts = { M: 0, F: 0, K: 0, Other: 0 }
    for (const s of rankedSkus) {
      const g = (s.gender || '').toUpperCase()
      if (g.startsWith('M')) counts.M++
      else if (g.startsWith('F') || g.startsWith('W')) counts.F++
      else if (g.startsWith('K')) counts.K++
      else counts.Other++
    }
    return [
      { label: 'Men', value: counts.M, color: '#38bdf8' },
      { label: 'Women', value: counts.F, color: '#f472b6' },
      { label: 'Kids', value: counts.K, color: '#fbbf24' },
      { label: 'Other', value: counts.Other, color: '#9090aa' },
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
      const pct = isTimeLimited
        ? (sku.quantity > 0 ? Math.round((sku._periodSold / sku.quantity) * 100) : 0)
        : Math.round(getSellThrough(sku.sold_quantity, sku.quantity))
      const vel = getVelocity(sku)
      return [
        i + 1, sku.sku, `"${(sku.product_name || '').replace(/"/g, '""')}"`,
        sku.category || '', sku.brand || '', sku.season || '', sku.gender || '',
        sku.quantity, sku._periodSold, getRemaining(sku),
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
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }} className="fade-up delay-1">
        <div style={{ fontFamily: '"DM Sans"', fontSize: 16, letterSpacing: '2px', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff8800', animation: 'blink 2s infinite' }} />
          {headerLabel}
        </div>
        {exec && (
          <button type="button" onClick={exportCsv}
            style={{ ...PILL, ...TOGGLE_OFF, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <IconCalendar size={12} strokeWidth={1.5} /> Export CSV
          </button>
        )}
      </div>

      {/* Time-range pills (executives only — managers use full-history sell-through) */}
      {exec ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} className="fade-up delay-1">
          {TIME_RANGES.map((t) => (
            <div key={t.key} onClick={() => setTimeRange(t.key)} style={{ ...PILL, ...(timeRange === t.key ? PILL_ON : PILL_OFF) }}>
              {t.label}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#4a4a62', marginBottom: 10, lineHeight: 1.45 }} className="fade-up delay-1">
          Rankings use <strong style={{ color: '#9090aa' }}>sell-through %</strong> on your full inventory history (no revenue or period sales).
        </div>
      )}

      {/* Custom date picker */}
      {exec && timeRange === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }} className="fade-up delay-1">
          <label style={{ fontSize: 11, color: '#9090aa' }}>From</label>
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
            style={{ background: '#17171f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e4e4f0', padding: '4px 8px', fontSize: 11, fontFamily: '"DM Sans"', outline: 'none' }} />
          <label style={{ fontSize: 11, color: '#9090aa' }}>To</label>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
            style={{ background: '#17171f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e4e4f0', padding: '4px 8px', fontSize: 11, fontFamily: '"DM Sans"', outline: 'none' }} />
        </div>
      )}

      {/* Category pills + Rank mode + Top N toggle + Compare toggle */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }} className="fade-up delay-1">
        {CATEGORY_FILTERS.map((f) => (
          <div key={f} onClick={() => setCategoryFilter(f)} style={{ ...PILL, ...(categoryFilter === f ? PILL_ON : PILL_OFF) }}>
            {f}
          </div>
        ))}

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.06)', margin: '0 6px' }} />

        {(exec ? RANK_MODES : RANK_MODES.filter((m) => m.key === 'sell_through')).map((m) => (
          <div key={m.key} onClick={() => exec && setRankMode(m.key)} style={{ ...PILL, ...(rankMode === m.key ? TOGGLE_ON : TOGGLE_OFF) }}>
            {m.label}
          </div>
        ))}

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.06)', margin: '0 6px' }} />

        <div onClick={() => setLimit(limit === 10 ? 20 : 10)} style={{ ...PILL, ...(limit === 20 ? TOGGLE_ON : TOGGLE_OFF) }}>
          Top {limit}
        </div>

        {exec && needsFetch && (
          <>
            <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.06)', margin: '0 6px' }} />
            <div onClick={() => setShowCompare(!showCompare)} style={{ ...PILL, ...(showCompare ? GREEN_ON : TOGGLE_OFF), display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <IconTrendUp size={12} strokeWidth={1.5} /> vs Prev
            </div>
          </>
        )}
      </div>

      {/* Info banner */}
      <div style={{ background: '#17171f', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 11, color: '#9090aa', lineHeight: 1.6 }} className="fade-up delay-1">
        {!exec ? (
          <><strong style={{ color: '#e4e4f0' }}>Shop view:</strong> Top products are ranked by sell-through % only. Revenue, units sold, and time filters are available to executives.</>
        ) : (
          <>
            {rankMode === 'sell_through' && (
              <><strong style={{ color: '#e4e4f0' }}>Bestseller Logic:</strong> Rank uses % sell-through — not raw quantity. A 3-unit apparel item at 67% ranks above a 40-pair shoe at 20%.</>
            )}
            {rankMode === 'revenue' && (
              <><strong style={{ color: '#e4e4f0' }}>Revenue Ranked:</strong> Products are sorted by total revenue generated{isTimeLimited ? ' in the selected period' : ''}. Best earners appear first.</>
            )}
            {rankMode === 'qty_sold' && (
              <><strong style={{ color: '#e4e4f0' }}>Qty Sold Ranked:</strong> Products are sorted by total units sold{isTimeLimited ? ' in the selected period' : ''}. Highest volume movers appear first.</>
            )}
          </>
        )}
      </div>

      {/* Product card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 22 }} className="fade-up delay-2">
        {rankedSkus.map((sku, i) => {
          const m = getMetric(sku)
          const vel = getVelocity(sku)
          const remaining = getRemaining(sku)
          const lowStock = remaining > 0 && remaining < LOW_STOCK_THRESHOLD
          return (
            <ProductCard
              key={sku.id ?? sku.sku}
              sku={sku}
              rank={i + 1}
              metric={m.value}
              metricLabel={m.label}
              velocity={vel}
              lowStock={lowStock}
              hideSalesCounts={!exec}
              delta={showCompare && prevRankMap ? <DeltaBadge prevRank={prevRankMap[sku.sku] ?? null} currentRank={i + 1} /> : null}
              onClick={() => setSelectedSku(sku)}
            />
          )
        })}
        {rankedSkus.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: '#4a4a62', fontSize: 13 }}>
            No products match the current filters.
          </div>
        )}
      </div>

      {/* Analytics Row — Brand Breakdown + Gender + Season */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 22 }} className="fade-up delay-2">
        {/* Brand breakdown */}
        <div style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 13, padding: 16 }}>
          <div style={{ fontFamily: '"DM Sans"', fontSize: 11, letterSpacing: '1.5px', color: '#4a4a62', textTransform: 'uppercase', marginBottom: 10 }}>
            Brand Distribution (Top {limit})
          </div>
          <HorizontalBarChart items={brandBreakdown} maxValue={Math.max(...brandBreakdown.map((b) => b.value), 1)} />
          {brandBreakdown.length === 0 && <div style={{ fontSize: 11, color: '#4a4a62' }}>No brand data</div>}
        </div>

        {/* Gender drill-down */}
        <div style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 13, padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <DonutChart segments={genderSegments} size={90} label="Gender Split" />
        </div>

        {/* Season drill-down */}
        <div style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 13, padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <DonutChart segments={seasonSegments} size={90} label="Season Split" />
        </div>
      </div>

      {/* Slowest Movers */}
      <div style={{ fontFamily: '"DM Sans"', fontSize: 14, letterSpacing: '2px', color: '#fff', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconSlowMover size={16} strokeWidth={1.5} color="#ff3333" />
        SLOWEST MOVERS — Needs Attention
      </div>

      <div style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 13, overflow: 'hidden', marginBottom: 22 }} className="fade-up delay-3">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
              {[
                'Rank', 'Photo', 'Product', 'SKU',
                exec ? (rankMode === 'revenue' ? 'Revenue' : rankMode === 'qty_sold' ? 'Qty Sold' : 'Sell-through') : 'Sell-through',
                ...(exec ? ['Velocity'] : []),
                'Remaining', 'Days in store', 'Status', 'Action',
              ].map((h) => (
                <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#4a4a62', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slowestSkus.map((sku, i) => {
              const thumbUrl = photoMap[sku.sku]
              const pct = isTimeLimited
                ? (sku.quantity > 0 ? Math.round((sku._periodSold / sku.quantity) * 100) : 0)
                : Math.round(getSellThrough(sku.sold_quantity, sku.quantity))
              const days = getDaysInStore(sku.import_date)
              const status = getLifecycleStatus(sku.import_date, sku.sold_quantity, sku.quantity)
              const rankColors = ['#ff3333', '#ff8800', '#fbbf24']
              const slowCount = slowestSkus.length
              const rankLabels = Array.from({ length: slowCount }, (_, j) => j === 0 ? '#1 worst' : `#${j + 1}`)
              const CategoryIcon = sku.category === 'Footwear' ? IconFootwear : sku.category === 'Apparel' ? IconApparel : sku.category === 'Accessories' ? IconAccessories : IconPackage
              const vel = getVelocity(sku)
              const remaining = getRemaining(sku)
              const lowStock = remaining > 0 && remaining < LOW_STOCK_THRESHOLD

              let metricCell
              if (exec && rankMode === 'revenue') metricCell = <span style={{ fontWeight: 700, color: '#9090aa' }}>€{fmt(sku._periodRevenue)}</span>
              else if (exec && rankMode === 'qty_sold') metricCell = <span style={{ fontWeight: 700, color: '#9090aa' }}>{sku._periodSold}</span>
              else metricCell = <span style={{ fontWeight: 700, color: pct < 15 ? '#ff3333' : '#ff8800' }}>{pct}%</span>

              return (
                <tr key={sku.id ?? sku.sku} style={{ borderBottom: '1px solid rgba(255,255,255,0.055)', transition: 'background 0.1s', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#17171f' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                >
                  <td style={{ padding: '9px 14px', fontFamily: '"DM Sans"', fontSize: 11, color: rankColors[i] || '#9090aa' }}>{rankLabels[i]}</td>
                  <td style={{ padding: '9px 14px', verticalAlign: 'middle' }} onClick={() => setSelectedSku(sku)}>
                    {thumbUrl ? (
                      <img src={thumbUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ width: 32, height: 32, borderRadius: 6, background: '#17171f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CategoryIcon size={16} strokeWidth={1.5} color="#9090aa" />
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '9px 14px', fontSize: 12, fontWeight: 600, color: '#e4e4f0' }} onClick={() => setSelectedSku(sku)}>{sku.product_name}</td>
                  <td style={{ padding: '9px 14px', fontFamily: '"DM Sans"', fontSize: 11, color: '#9090aa' }}>{sku.sku}</td>
                  <td style={{ padding: '9px 14px' }}>{metricCell}</td>
                  {exec ? (
                    <td style={{ padding: '9px 14px', fontFamily: '"DM Sans"', fontSize: 11, color: vel != null && vel > 0 ? '#e4e4f0' : '#4a4a62' }}>
                      {vel != null ? `${vel}/wk` : '—'}
                    </td>
                  ) : null}
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{ fontFamily: '"DM Sans"', fontSize: 11, fontWeight: lowStock ? 700 : 400, color: lowStock ? '#ff3333' : '#9090aa', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      {lowStock && <IconWarning size={11} strokeWidth={2} color="#ff3333" />}
                      {remaining}
                    </span>
                  </td>
                  <td style={{ padding: '9px 14px', fontFamily: '"DM Sans"', fontSize: 11, color: days > 150 ? '#ff3333' : days > 90 ? '#ff8800' : '#9090aa' }}>{days}d</td>
                  <td style={{ padding: '9px 14px' }}><StatusChip status={status} /></td>
                  <td style={{ padding: '9px 14px' }}>
                    {(status === 'Clearance' || status === 'Outlet') ? (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleMarkdown(sku) }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 8, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#ff3333', color: '#fff', fontFamily: '"DM Sans"' }}>
                        <IconTag size={10} strokeWidth={2} /> Apply -30%
                      </button>
                    ) : (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleFrontDisplay(sku) }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 8, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: '#17171f', color: '#9090aa', border: '1px solid rgba(255,255,255,0.055)', fontFamily: '"DM Sans"' }}>
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
        const st = getLifecycleStatus(selectedSku.import_date, selectedSku.sold_quantity, selectedSku.quantity)
        return (
          <ProductDetailModal
            sku={selectedSku}
            status={st}
            statusData={{ color: STATUS_COLORS[st] || '#9090aa', colorBg: `${STATUS_COLORS[st] || '#9090aa'}18` }}
            onClose={() => setSelectedSku(null)}
          />
        )
      })()}
    </div>
  )
}
