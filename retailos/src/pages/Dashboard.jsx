import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, LayoutGrid, List } from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import useStore from '../store/useStore'
import { getSellThrough, getDaysInStore, getProductLifecycleStatus, getEffectiveLifecycleImportDate } from '../utils/lifecycle'
import { isExecutive } from '../utils/roles'
import { aggregateSkus } from '../utils/aggregateSkus'
import LifecycleTile from '../components/LifecycleTile'
import ProductPanelCard from '../components/ProductPanelCard'
import ProductDetailModal from '../components/ProductDetailModal'
import ProductActivityModal from '../components/ProductActivityModal'
import { SmartAlertsList, SmartAlertsHeaderTitle } from '../components/SmartAlertsList'
import { toTitleCase } from '../utils/textFormat.js'
import StatusChip from '../components/StatusChip'
import ProgressBar from '../components/ProgressBar'
import { IconClose, IconSearchEmpty } from '../utils/icons.js'
import { normalizeGenderCodeForFilter, genderShortLabel } from '../utils/gender.js'
import { fetchSalesByDay } from '../api/client.js'
import { productMatchesActiveSeason } from '../utils/seasons.js'
import { DASHBOARD_PRODUCT_SORT_OPTIONS, sortDashboardProducts } from '../utils/dashboardProductSort.js'

const DM_SANS = '"DM Sans", sans-serif'
const DASH_PRIVACY_KEY = 'retailos_dashboard_privacy'
const DASH_PANEL_LAYOUT_KEY = 'retailos_dash_panel_layout'

const SALES_DATE_FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_week', label: 'Last Week' },
  { key: 'last_2w', label: 'Last 2 Weeks' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'custom', label: 'Custom' },
]

function toDateInputValue(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getDashboardSalesPeriod(key, customFrom, customTo) {
  const today = new Date()
  const start = new Date(today)
  const end = new Date(today)
  switch (key) {
    case 'today':
      return { since: toDateInputValue(today), until: toDateInputValue(today), label: 'Today', days: 1 }
    case 'yesterday': {
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)
      return { since: toDateInputValue(yesterday), until: toDateInputValue(yesterday), label: 'Yesterday', days: 1 }
    }
    case 'last_2w':
      start.setDate(today.getDate() - 13)
      return { since: toDateInputValue(start), until: toDateInputValue(end), label: 'Last 2 Weeks', days: 14 }
    case 'this_month':
      start.setDate(1)
      return {
        since: toDateInputValue(start),
        until: toDateInputValue(end),
        label: 'This Month',
        days: Math.max(1, Math.round((end - start) / 86400000) + 1),
      }
    case 'last_month': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const last = new Date(today.getFullYear(), today.getMonth(), 0)
      return {
        since: toDateInputValue(first),
        until: toDateInputValue(last),
        label: 'Last Month',
        days: Math.max(1, Math.round((last - first) / 86400000) + 1),
      }
    }
    case 'custom': {
      const since = customFrom || toDateInputValue(today)
      const until = customTo || since
      const a = new Date(since)
      const b = new Date(until)
      return {
        since,
        until,
        label: 'Custom',
        days: Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())
          ? 1
          : Math.max(1, Math.round((b - a) / 86400000) + 1),
      }
    }
    case 'last_week':
    default:
      start.setDate(today.getDate() - 6)
      return { since: toDateInputValue(start), until: toDateInputValue(end), label: 'Last Week', days: 7 }
  }
}

function maskKpiDisplay(raw) {
  if (raw === '—') return '—'
  return '*******'
}

function isFullySold(product) {
  const qty = Number(product.quantity) || 0
  const sold = Number(product.sold_quantity) || 0
  return qty > 0 && Math.max(0, qty - sold) === 0
}

const STATUS_LABELS = {
  'New Arrival': 'New Arrivals',
  Active: 'Active SKUs',
  Aging: 'Aging',
  Risk: 'At Risk',
  Clearance: 'Clearance',
  Outlet: 'Outlet',
  'All Sold': 'All Sold',
}

const TILES = [
  {
    status: 'New Arrival',
    key: 'new',
    color: '#60a5fa',
    colorBg: 'rgba(96,165,250,0.1)',
    sub: 'Day 0 – 30',
    tag: 'Recently added',
    icon: '•',
  },
  {
    status: 'Active',
    key: 'active',
    color: '#34d399',
    colorBg: 'rgba(52,211,153,0.1)',
    sub: 'Day 31 – 90',
    tag: 'Healthy',
    icon: '●',
  },
  {
    status: 'Aging',
    key: 'aging',
    color: '#fbbf24',
    colorBg: 'rgba(251,191,36,0.1)',
    sub: 'Day 91 – 150',
    tag: 'Monitor',
    icon: '◐',
  },
  {
    status: 'Risk',
    key: 'risk',
    color: '#f87171',
    colorBg: 'rgba(248,113,113,0.1)',
    sub: 'Low sell-through',
    tag: 'Act now',
    icon: '!',
  },
  {
    status: 'Clearance',
    key: 'clearance',
    color: '#a78bfa',
    colorBg: 'rgba(167,139,250,0.1)',
    sub: 'Day 150+',
    tag: 'Discount now',
    icon: '▼',
  },
  {
    status: 'Outlet',
    key: 'outlet',
    color: '#fb923c',
    colorBg: 'rgba(251,146,60,0.1)',
    sub: 'Day 180+',
    tag: 'Last units',
    icon: '◆',
  },
  {
    status: 'All Sold',
    key: 'sold',
    color: '#6b7280',
    colorBg: 'rgba(107,114,128,0.1)',
    sub: '100% sell-through',
    tag: 'Fully sold out',
    icon: '✓',
  },
]

function sentencePeriod(label) {
  if (!label) return ''
  const lower = label.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function getSellThroughDisplay(pct) {
  if (pct >= 60) return { textColor: '#15803D', barColor: '#16A34A' }
  if (pct >= 30) return { textColor: '#D97706', barColor: '#D97706' }
  return { textColor: '#DC2626', barColor: '#DC2626' }
}

function actionForRow(status, pct, hideSalesBasedActions) {
  if (hideSalesBasedActions) {
    return {
      label: 'View',
      bg: 'transparent',
      color: 'var(--ro-text-dim)',
      border: '1px solid var(--ro-border)',
    }
  }
  if (pct >= 60) {
    return {
      label: 'Reorder',
      bg: 'rgba(0,230,118,0.1)',
      color: '#00e676',
      border: '1px solid rgba(0,230,118,0.25)',
    }
  }
  if (status === 'Clearance') {
    return { label: '-30%', bg: '#ff3333', color: '#fff', border: 'none' }
  }
  return {
    label: 'View',
    bg: 'transparent',
    color: 'var(--ro-text-dim)',
    border: '1px solid var(--ro-border)',
  }
}

function GenderInventoryTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div
      style={{
        background: 'var(--ro-tooltip-bg)',
        border: '1px solid var(--ro-tooltip-border)',
        borderRadius: '8px',
        padding: '8px 12px',
        fontFamily: DM_SANS,
        fontSize: '12px',
      }}
    >
      <div style={{ color: 'var(--ro-tooltip-label)', fontWeight: 600 }}>{p.name}</div>
      <div style={{ color: 'var(--ro-tooltip-muted)' }}>{p.value} SKUs</div>
    </div>
  )
}

export function Dashboard() {
  const skus = useStore((s) => s.skus)
  const shipmentMeta = useStore((s) => s.shipmentMeta)
  const skuImportTotals = useStore((s) => s.skuImportTotals)
  const activeSeason = useStore((s) => s.activeSeason)
  const activeUser = useStore((s) => s.activeUser)
  const weeklySales = useStore((s) => s.weeklySales)
  const clearSalesEventHistory = useStore((s) => s.clearSalesEventHistory)
  const execUser = isExecutive(activeUser)

  const [selectedStatus, setSelectedStatus] = useState(null)
  const [genderFilter, setGenderFilter] = useState('All')
  const [activeInventoryGender, setActiveInventoryGender] = useState(null)
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [panelSort, setPanelSort] = useState('newest')
  const [selectedSkuForModal, setSelectedSku] = useState(null)
  const [activitySku, setActivitySku] = useState(null)
  const [salesMasked, setSalesMasked] = useState(() => {
    try {
      return localStorage.getItem(DASH_PRIVACY_KEY) === '1'
    } catch {
      return false
    }
  })
  const [clearingSalesKpi, setClearingSalesKpi] = useState(false)
  const [salesDateFilter, setSalesDateFilter] = useState('last_week')
  const [customSalesFrom, setCustomSalesFrom] = useState('')
  const [customSalesTo, setCustomSalesTo] = useState('')
  const [periodSalesRows, setPeriodSalesRows] = useState([])
  const [periodSalesLoading, setPeriodSalesLoading] = useState(false)

  const [panelLayout, setPanelLayout] = useState(() => {
    try {
      return localStorage.getItem(DASH_PANEL_LAYOUT_KEY) === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(DASH_PRIVACY_KEY, salesMasked ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [salesMasked])

  useEffect(() => {
    try {
      localStorage.setItem(DASH_PANEL_LAYOUT_KEY, panelLayout)
    } catch {
      /* ignore */
    }
  }, [panelLayout])

  const selectedSalesPeriod = useMemo(
    () => getDashboardSalesPeriod(salesDateFilter, customSalesFrom, customSalesTo),
    [salesDateFilter, customSalesFrom, customSalesTo],
  )

  useEffect(() => {
    if (!execUser) {
      setPeriodSalesRows([])
      return
    }
    let alive = true
    setPeriodSalesLoading(true)
    fetchSalesByDay(selectedSalesPeriod.since, selectedSalesPeriod.until)
      .then((rows) => {
        if (alive) setPeriodSalesRows(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {
        if (alive) setPeriodSalesRows([])
      })
      .finally(() => {
        if (alive) setPeriodSalesLoading(false)
      })
    return () => { alive = false }
  }, [execUser, selectedSalesPeriod])

  const products = useMemo(
    () => aggregateSkus(skus, shipmentMeta, activeSeason).filter((p) => productMatchesActiveSeason(p, activeSeason)),
    [skus, shipmentMeta, activeSeason],
  )

  const statusGroups = useMemo(() => {
    const groups = {
      'New Arrival': [],
      Active: [],
      Aging: [],
      Risk: [],
      Clearance: [],
      Outlet: [],
      'All Sold': [],
    }
    products.forEach((s) => {
      if (isFullySold(s)) {
        groups['All Sold'].push(s)
        return
      }
      const st = getProductLifecycleStatus(s)
      if (groups[st]) groups[st].push(s)
    })
    return groups
  }, [products])

  const { uniqueSkuCount, totalUnitsOnHand } = useMemo(() => {
    const totalUnitsOnHand = products.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0)
    return { uniqueSkuCount: products.length, totalUnitsOnHand }
  }, [products])

  const handleTileClick = (status) => {
    if (selectedStatus === status) {
      setSelectedStatus(null)
      setSelectedSku(null)
    } else {
      setSelectedStatus(status)
      setGenderFilter('All')
      setCategoryFilter('All')
      setSelectedSku(null)
    }
  }

  const panelSkus = useMemo(() => {
    if (!selectedStatus) return []
    const filtered = (statusGroups[selectedStatus] || []).filter((s) => {
      const gOk = genderFilter === 'All' || normalizeGenderCodeForFilter(s.gender) === genderFilter
      const cOk =
        categoryFilter === 'All' || (s.category || '').trim() === categoryFilter.trim()
      return gOk && cOk
    })
    return sortDashboardProducts(filtered, panelSort)
  }, [selectedStatus, statusGroups, genderFilter, categoryFilter, panelSort])

  const selectedTileData = TILES.find((t) => t.status === selectedStatus)

  const gendersInStatus = useMemo(() => {
    if (!selectedStatus) return []
    const codes = [
      ...new Set((statusGroups[selectedStatus] || []).map((s) => normalizeGenderCodeForFilter(s.gender))),
    ]
    const order = { M: 0, F: 1, U: 2, K: 3 }
    codes.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9))
    return ['All', ...codes]
  }, [selectedStatus, statusGroups])

  const catsInStatus = useMemo(() => {
    if (!selectedStatus) return []
    const set = new Set(
      (statusGroups[selectedStatus] || []).map((s) => (s.category || '').trim()).filter(Boolean),
    )
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [selectedStatus, statusGroups])

  const recentSkus = useMemo(() => {
    return [...products]
      .sort((a, b) => {
        const aDate = new Date(a.last_import_date ?? a.lifecycle_import_date ?? a.import_date).getTime()
        const bDate = new Date(b.last_import_date ?? b.lifecycle_import_date ?? b.import_date).getTime()
        return bDate - aDate
      })
      .slice(0, 5)
  }, [products])

  const sellThroughChartData = useMemo(() => {
    const totalSold = products.reduce((sum, s) => sum + (s.sold_quantity || 0), 0)
    const totalQty = products.reduce((sum, s) => sum + (s.quantity || 0), 0)
    const overallPct = totalQty > 0 ? (totalSold / totalQty) * 100 : 0
    const weeks = []
    const now = new Date()
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i * 7)
      const pct = Math.max(0, Math.min(100, Math.round(overallPct * (0.6 + (0.4 * (8 - i)) / 8))))
      weeks.push({
        week: `W${8 - i}`,
        label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        sellThrough: pct,
      })
    }
    return weeks
  }, [products])

  const displaySellThroughChartData = useMemo(
    () => (salesMasked ? sellThroughChartData.map((d) => ({ ...d, sellThrough: 0 })) : sellThroughChartData),
    [sellThroughChartData, salesMasked],
  )

  const genderLegendData = useMemo(() => {
    const map = { M: 0, F: 0, K: 0, U: 0 }
    for (const sku of products) {
      const g = normalizeGenderCodeForFilter(sku.gender)
      if (g === 'M') map.M++
      else if (g === 'F') map.F++
      else if (g === 'K') map.K++
      else if (g === 'U') map.U++
      else map.M++
    }
    return [
      { name: 'Male', value: map.M, color: '#38bdf8' },
      { name: 'Female', value: map.F, color: '#f472b6' },
      { name: 'Kids', value: map.K, color: '#2dd4bf' },
      { name: 'Unisex', value: map.U, color: '#a78bfa' },
    ]
  }, [products])

  const genderPieData = useMemo(() => {
    const data = genderLegendData.filter((d) => d.value > 0)
    return data.length ? data : [{ name: 'No data', value: 1, color: 'var(--ro-text-muted)' }]
  }, [genderLegendData])

  const genderSkuTotal = useMemo(
    () => genderLegendData.reduce((sum, d) => sum + d.value, 0),
    [genderLegendData],
  )

  const genderPercents = useMemo(() => {
    const total = genderSkuTotal || 1
    return Object.fromEntries(genderLegendData.map((d) => [d.name, Math.round((d.value / total) * 100)]))
  }, [genderLegendData, genderSkuTotal])

  const activeInventorySlice = useMemo(() => {
    if (!activeInventoryGender) return null
    return genderLegendData.find((d) => d.name === activeInventoryGender) ?? null
  }, [activeInventoryGender, genderLegendData])

  const selectedPeriodSales = useMemo(() => {
    return (periodSalesRows || []).reduce(
      (acc, row) => ({
        revenue: acc.revenue + (Number(row.revenue) || 0),
        units: acc.units + (Number(row.units) || 0),
      }),
      { revenue: 0, units: 0 },
    )
  }, [periodSalesRows])

  const avgDailyRevenue = useMemo(() => {
    const days = selectedSalesPeriod.days || 1
    return selectedPeriodSales.revenue / days
  }, [selectedPeriodSales.revenue, selectedSalesPeriod.days])

  const revenueChartData = useMemo(() => {
    return (weeklySales || []).map((w) => ({
      week: w.week,
      label: w.weekLabel,
      revenue: w.totalRevenue ?? 0,
      units: w.totalUnits ?? 0,
    }))
  }, [weeklySales])

  const displayRevenueChartData = useMemo(
    () => (salesMasked ? revenueChartData.map((d) => ({ ...d, revenue: 0, units: 0 })) : revenueChartData),
    [revenueChartData, salesMasked],
  )

  const avgSellingPrice = useMemo(() => {
    const units = Math.abs(selectedPeriodSales.units)
    return units > 0 ? selectedPeriodSales.revenue / units : 0
  }, [selectedPeriodSales.revenue, selectedPeriodSales.units])

  const closePanel = () => {
    setSelectedStatus(null)
    setSelectedSku(null)
  }

  async function handleClearSalesEvents() {
    if (
      !window.confirm(
        'Clear all reporting sales events? Weekly revenue and units KPIs will show empty until you import a Reporting CSV. Your inventory (new arrivals) is not deleted.',
      )
    ) {
      return
    }
    setClearingSalesKpi(true)
    try {
      await clearSalesEventHistory()
    } catch {
      window.alert('Could not clear sales events. You must be logged in as executive with the API running.')
    } finally {
      setClearingSalesKpi(false)
    }
  }

  const recentTableHeaders = execUser
    ? ['SKU', 'Product', 'Brand', 'Gender', 'Days', 'Sell-Through', 'Status', 'Action']
    : ['SKU', 'Product', 'Brand', 'Gender', 'Days', 'Status', 'Action']
  const recentTableColSpan = execUser ? 8 : 7

  return (
    <div className="dashboard-page">
      {/* Section 1 — header */}
      <div className="fade-up delay-1 page-hero-mobile-hide dash-lifecycle-header">
        <h2 className="dash-lifecycle-header__title">Inventory Lifecycle Status</h2>
        <p className="dash-lifecycle-header__hint">Click any tile to explore products</p>
        {execUser ? (
          <Link to="/lookup" className="dash-lifecycle-header__link">
            Open inventory overview
          </Link>
        ) : (
          <Link to="/lifecycle" className="dash-lifecycle-header__link">
            Open SKU lifecycle
          </Link>
        )}
      </div>

      {/* Section 2 — lifecycle tiles + catalog overview (distinct SKUs vs total units) */}
      <section className="fade-up delay-1 dash-section dash-lifecycle-tiles dash-lifecycle-tiles--with-catalog">
        {TILES.map((tile) => (
          <LifecycleTile
            key={tile.key}
            tileKey={tile.key}
            status={tile.status}
            count={statusGroups[tile.status]?.length ?? 0}
            sub={tile.sub}
            tag={tile.tag}
            isSelected={selectedStatus === tile.status}
            onClick={() => handleTileClick(tile.status)}
          />
        ))}
        <LifecycleTile
          tileKey="catalog"
          status="Catalog"
          count={uniqueSkuCount}
          sub={`${totalUnitsOnHand.toLocaleString()} units on hand`}
          tag="Distinct product codes"
          isSelected={false}
          onClick={() => {}}
        />
      </section>

      {/* Executive — Weekly Sales KPIs (only when imports exist) */}
      {execUser && skus.length > 0 && (
        <div className="fade-up delay-1 dash-section dash-exec-sales-wrap">
          <div className="dash-sales-visibility-row">
            <div className="dash-sales-visibility-pill">
              <span className="dash-sales-visibility-label">Sales visibility</span>
              <button
                type="button"
                className="dash-sales-privacy-toggle"
                aria-pressed={salesMasked}
                aria-label={salesMasked ? 'Show sales figures' : 'Hide sales figures'}
                onClick={() => setSalesMasked((m) => !m)}
              >
                {salesMasked ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
              </button>
            </div>
          </div>
          <div className="dash-sales-date-filter-row">
            <span className="dash-sales-period-label">Sales period</span>
            {SALES_DATE_FILTERS.map((f) => {
              const active = salesDateFilter === f.key
              return (
                <button
                  key={f.key}
                  type="button"
                  className={`dash-sales-period-chip${active ? ' dash-sales-period-chip--active' : ''}`}
                  onClick={() => setSalesDateFilter(f.key)}
                >
                  {f.label}
                </button>
              )
            })}
            {salesDateFilter === 'custom' && (
              <>
                <input
                  type="date"
                  className="dash-sales-period-date"
                  value={customSalesFrom}
                  onChange={(e) => setCustomSalesFrom(e.target.value)}
                />
                <input
                  type="date"
                  className="dash-sales-period-date"
                  value={customSalesTo}
                  onChange={(e) => setCustomSalesTo(e.target.value)}
                />
              </>
            )}
          </div>
          <div className="fade-up delay-1 dash-kpi-grid">
            {(() => {
              const periodLabel = sentencePeriod(selectedSalesPeriod.label)
              const revenueVal = !periodSalesLoading && selectedPeriodSales.revenue > 0
                ? `€${selectedPeriodSales.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : '—'
              const unitsVal = !periodSalesLoading && selectedPeriodSales.units !== 0
                ? String(selectedPeriodSales.units)
                : '—'
              const avgDailyVal = !periodSalesLoading && avgDailyRevenue > 0
                ? `€${avgDailyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : '—'
              const avgPriceVal = !periodSalesLoading && avgSellingPrice > 0
                ? `€${avgSellingPrice.toFixed(2)}`
                : '—'
              return [
                { label: `${periodLabel} revenue`, value: revenueVal, negative: !periodSalesLoading && selectedPeriodSales.revenue < 0 },
                { label: 'Units sold', period: `· ${periodLabel}`, value: unitsVal, negative: !periodSalesLoading && selectedPeriodSales.units < 0 },
                { label: 'Avg daily revenue', period: `· ${periodLabel}`, value: avgDailyVal, negative: !periodSalesLoading && avgDailyRevenue < 0 },
                { label: 'Avg selling price', period: `· ${periodLabel}`, value: avgPriceVal, negative: !periodSalesLoading && avgSellingPrice < 0 },
              ].map((t) => (
                <div key={t.label} className="dashboard-kpi-card">
                  <div className="dash-kpi-card__label">{t.label}</div>
                  {t.period && <div className="dash-kpi-card__period">{t.period}</div>}
                  <div className={`dash-kpi-card__value${t.negative ? ' dash-kpi-card__value--negative' : ''}`}>
                    {salesMasked ? maskKpiDisplay(t.value) : t.value}
                  </div>
                </div>
              ))
            })()}
          </div>
          <p className="dash-sales-events-kpi-note">
            Selected-period figures ({selectedSalesPeriod.since} to {selectedSalesPeriod.until}) come from{' '}
            <strong className="dash-sales-events-kpi-note__term">Reporting CSV</strong> sales
            events, not from New Arrivals intake.{' '}
            <button
              type="button"
              disabled={clearingSalesKpi}
              onClick={handleClearSalesEvents}
              className="dash-sales-events-clear-btn"
            >
              {clearingSalesKpi ? 'Clearing…' : 'Clear sales event history'}
            </button>
          </p>
        </div>
      )}

      {/* Section 3 — product panel */}
      {selectedStatus && selectedTileData && (
        <div key={selectedStatus} className="fade-up" style={{ marginBottom: 22 }}>
          <div
            className="dashboard-panel"
            style={{
              background: 'var(--ro-surface)',
              border: '1px solid var(--ro-border)',
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            <div
              className="dashboard-panel-header"
              style={{
                background: 'var(--ro-surface-elevated)',
                borderBottom: '1px solid var(--ro-border)',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: selectedTileData.color,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: '"DM Sans"',
                    fontSize: 18,
                    letterSpacing: '1.5px',
                    color: 'var(--ro-heading)',
                  }}
                >
                  {selectedStatus.toUpperCase()} — PRODUCT GRID
                </span>
                <span
                  style={{
                    fontFamily: '"DM Sans"',
                    fontSize: 11,
                    color: 'var(--ro-text-muted)',
                    padding: '2px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--ro-border)',
                  }}
                >
                  {panelSkus.length} SKUs
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--ro-text-muted)' }}>Click a product for details</span>
                <button
                  type="button"
                  onClick={closePanel}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: '1px solid var(--ro-border-hover)',
                    background: 'var(--ro-surface-elevated)',
                    color: 'var(--ro-text-dim)',
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  <IconClose size={14} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <div
              className="dashboard-panel-filters"
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--ro-border)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--ro-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                Product view
              </span>
              <div
                style={{
                  display: 'inline-flex',
                  borderRadius: 8,
                  border: '1px solid var(--ro-border-hover)',
                  overflow: 'hidden',
                  fontFamily: DM_SANS,
                  flexShrink: 0,
                }}
                role="group"
                aria-label="Product grid layout"
              >
                <button
                  type="button"
                  aria-pressed={panelLayout === 'grid'}
                  aria-label="Grid view"
                  onClick={() => setPanelLayout('grid')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    minHeight: 34,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: 'none',
                    borderRight: '1px solid var(--ro-border)',
                    background: panelLayout === 'grid' ? selectedTileData.colorBg : 'var(--ro-surface-elevated)',
                    color: panelLayout === 'grid' ? selectedTileData.color : 'var(--ro-text-muted)',
                  }}
                >
                  <LayoutGrid size={16} strokeWidth={1.5} aria-hidden />
                  Grid
                </button>
                <button
                  type="button"
                  aria-pressed={panelLayout === 'list'}
                  aria-label="List view"
                  onClick={() => setPanelLayout('list')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    minHeight: 34,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: 'none',
                    background: panelLayout === 'list' ? selectedTileData.colorBg : 'var(--ro-surface-elevated)',
                    color: panelLayout === 'list' ? selectedTileData.color : 'var(--ro-text-muted)',
                  }}
                >
                  <List size={16} strokeWidth={1.5} aria-hidden />
                  List
                </button>
              </div>
              <div
                style={{
                  width: 1,
                  height: 16,
                  background: 'var(--ro-border-hover)',
                  margin: '0 4px',
                }}
              />
              <label className="dash-product-sort">
                <span className="dash-product-sort__label">Sort by</span>
                <select
                  className="dash-product-sort__select"
                  value={panelSort}
                  onChange={(event) => setPanelSort(event.target.value)}
                  aria-label="Sort dashboard products"
                >
                  {DASHBOARD_PRODUCT_SORT_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="dash-product-filter-divider" aria-hidden />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--ro-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                Gender
              </span>
              {gendersInStatus.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGenderFilter(g)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border:
                      genderFilter === g
                        ? `1px solid ${selectedTileData.color}`
                        : '1px solid var(--ro-border)',
                    background: genderFilter === g ? selectedTileData.colorBg : 'var(--ro-surface-elevated)',
                    color: genderFilter === g ? selectedTileData.color : 'var(--ro-text-muted)',
                    fontFamily: DM_SANS,
                  }}
                >
                  {g === 'All' ? 'All' : genderShortLabel(g)}
                </button>
              ))}
              <div
                style={{
                  width: 1,
                  height: 16,
                  background: 'var(--ro-border-hover)',
                  margin: '0 4px',
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--ro-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                Category
              </span>
              {catsInStatus.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoryFilter(c)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border:
                      categoryFilter === c
                        ? `1px solid ${selectedTileData.color}`
                        : '1px solid var(--ro-border)',
                    background: categoryFilter === c ? selectedTileData.colorBg : 'var(--ro-surface-elevated)',
                    color: categoryFilter === c ? selectedTileData.color : 'var(--ro-text-muted)',
                    fontFamily: DM_SANS,
                  }}
                >
                  {c}
                </button>
              ))}
            </div>

            <div style={{ padding: '18px 20px' }}>
              {panelSkus.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px 16px',
                    color: 'var(--ro-text-muted)',
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontSize: 36, marginBottom: 8 }}>
                    <IconSearchEmpty size={36} strokeWidth={1.5} />
                  </div>
                  No products match this filter
                </div>
              ) : (
                <div
                  className={`dash-product-grid ${panelLayout === 'list' ? 'dash-product-grid--list' : 'dash-product-grid--dense'}`}
                >
                  {panelSkus.map((sku) => (
                    <ProductPanelCard
                      key={sku.sku}
                      sku={sku}
                      status={selectedStatus}
                      color={selectedTileData.color}
                      colorBg={selectedTileData.colorBg}
                      statusLabel={STATUS_LABELS[selectedStatus] ?? selectedStatus}
                      statusIcon={selectedTileData.icon}
                      totalImported={Number(skuImportTotals[sku.sku]) || Number(sku.quantity) || 0}
                      salesVisible={execUser && !salesMasked}
                      layout={panelLayout === 'list' ? 'row' : 'tile'}
                      onClick={() => setSelectedSku(sku)}
                      onActivityClick={execUser ? () => setActivitySku(sku) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section 4 — alerts + charts */}
      <div
        className="fade-up delay-2 grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] dashboard-insight-grid"
        style={{
          gap: 14,
          marginBottom: 22,
          alignItems: 'stretch',
        }}
      >
        <div className="dashboard-panel dashboard-alerts-panel dash-alerts-panel">
          <div className="dash-panel-title">
            <SmartAlertsHeaderTitle />
          </div>
          <div className="dash-alerts-list">
            <SmartAlertsList limit={5} showViewAllLink urgencyFilter="all" />
          </div>
        </div>

        <div className="dash-insight-stack">
          <div className="dashboard-panel dash-chart-panel">
            {execUser && skus.length > 0 && revenueChartData.length > 0 ? (
              <>
                <div className="dash-panel-title">Weekly Revenue · Last 8 Weeks</div>
                <div className="dash-chart-canvas">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={displayRevenueChartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="0" stroke="#f3f4f6" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: '#9ca3af', fontFamily: DM_SANS }}
                        axisLine={{ stroke: '#f3f4f6' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#9ca3af', fontFamily: DM_SANS }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => (salesMasked ? '****' : `€${v}`)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--ro-tooltip-bg)',
                          border: '1px solid var(--ro-tooltip-border)',
                          borderRadius: 8,
                          fontFamily: DM_SANS,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: 'var(--ro-tooltip-label)' }}
                        formatter={(v, name) =>
                          salesMasked
                            ? ['*******', name === 'revenue' ? 'Revenue' : 'Units']
                            : [name === 'revenue' ? `€${v.toLocaleString()}` : v, name === 'revenue' ? 'Revenue' : 'Units']
                        }
                      />
                      <Bar dataKey="revenue" fill="#60A5FA" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : execUser ? (
              <>
                <div className="dash-panel-title">Sell-Through · Last 8 Weeks</div>
                <div className="dash-chart-canvas">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={displaySellThroughChartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--ro-chart-grid)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: 'var(--ro-text-dim)', fontFamily: DM_SANS }}
                        axisLine={{ stroke: 'var(--ro-chart-axis)' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: 'var(--ro-text-dim)', fontFamily: DM_SANS }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => (salesMasked ? '****' : `${v}%`)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--ro-tooltip-bg)',
                          border: '1px solid var(--ro-tooltip-border)',
                          borderRadius: 8,
                          fontFamily: DM_SANS,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: 'var(--ro-tooltip-label)' }}
                        formatter={(v) => (salesMasked ? ['*******', 'Sell-through'] : [`${v}%`, 'Sell-through'])}
                      />
                      <Bar dataKey="sellThrough" fill="#ff3333" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ro-text)', marginBottom: 8 }}>
                  Store overview
                </div>
                <div style={{ fontSize: 11, color: 'var(--ro-text-muted)', lineHeight: 1.55, padding: '4px 0 12px' }}>
                  Sales and revenue charts are available to executive accounts only. Use lifecycle tiles, Smart Alerts, and the inventory split below to plan your day.
                </div>
              </>
            )}
          </div>

          <div className="dashboard-panel dash-inventory-panel">
            <div className="dash-panel-title">Inventory Split — {activeSeason}</div>
            <div className="dashboard-inventory-split dash-inventory-split">
              <div className="dash-inventory-split__body">
                <div className="dash-inventory-donut">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={genderPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={2}
                        stroke="none"
                        isAnimationActive={false}
                        label={false}
                      >
                        {genderPieData.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={entry.color}
                            opacity={!activeInventoryGender || activeInventoryGender === entry.name ? 1 : 0.34}
                            stroke={activeInventoryGender === entry.name ? 'var(--ro-heading)' : 'transparent'}
                            strokeWidth={activeInventoryGender === entry.name ? 2 : 0}
                            style={{
                              cursor: entry.name === 'No data' ? 'default' : 'pointer',
                              filter: activeInventoryGender === entry.name ? 'brightness(1.14)' : 'none',
                              outline: 'none',
                              transition: 'opacity 180ms ease, filter 180ms ease',
                            }}
                            onMouseEnter={() => entry.name !== 'No data' && setActiveInventoryGender(entry.name)}
                            onMouseLeave={() => setActiveInventoryGender(null)}
                            onClick={() => {
                              if (entry.name === 'No data') return
                              setActiveInventoryGender((cur) => (cur === entry.name ? null : entry.name))
                            }}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<GenderInventoryTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="dash-inventory-donut__center">
                    <span className="dash-inventory-donut__count">
                      {activeInventorySlice ? activeInventorySlice.value : (genderSkuTotal > 0 ? genderSkuTotal : '—')}
                    </span>
                    <span className="dash-inventory-donut__label">
                      {activeInventorySlice ? (
                        <>
                          <span className="dash-inventory-donut__label-pct">{genderPercents[activeInventorySlice.name] ?? 0}%</span>
                          <span className="dash-inventory-donut__label-name">{activeInventorySlice.name}</span>
                        </>
                      ) : (
                        'SKUs'
                      )}
                    </span>
                  </div>
                </div>
                <div className="dash-inventory-legend">
                  {genderLegendData.map((d) => (
                    <button
                      key={d.name}
                      type="button"
                      className={`dash-inventory-legend__row${activeInventoryGender === d.name ? ' dash-inventory-legend__row--active' : ''}${d.value === 0 ? ' dash-inventory-legend__row--empty' : ''}`}
                      onMouseEnter={() => d.value > 0 && setActiveInventoryGender(d.name)}
                      onMouseLeave={() => setActiveInventoryGender(null)}
                      onClick={() => {
                        if (d.value === 0) return
                        setActiveInventoryGender((cur) => (cur === d.name ? null : d.name))
                      }}
                    >
                      <span className="dash-inventory-legend__left">
                        <span className="dash-inventory-legend__dot" style={{ background: d.color }} />
                        <span className="dash-inventory-legend__name">{d.name}</span>
                      </span>
                      <span className="dash-inventory-legend__meta">
                        {d.value === 0 ? '0% · 0' : `${genderPercents[d.name] ?? 0}% · ${d.value}`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 5 — recent activity */}
      <section className="fade-up delay-3 dash-recent-section">
        <div className="dash-recent-header">
          <h3 className="dash-recent-header__title">Recent SKU Activity</h3>
          <Link to="/lifecycle" className="dash-recent-header__link">
            View Full Lifecycle →
          </Link>
        </div>

        <div className="dash-table-wrap" data-dashboard-panel="recent">
          <table className="dash-recent-table">
            <thead>
              <tr>
                {recentTableHeaders.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSkus.length === 0 ? (
                <tr>
                  <td colSpan={recentTableColSpan} className="dash-recent-table__empty">
                    No SKUs yet — import a CSV.
                  </td>
                </tr>
              ) : (
                recentSkus.map((sku) => {
                  const status = getProductLifecycleStatus(sku)
                  const days = getDaysInStore(getEffectiveLifecycleImportDate(sku))
                  const pct = Math.round(getSellThrough(sku.sold_quantity, sku.quantity))
                  const sellDisplay = getSellThroughDisplay(pct)
                  const act = actionForRow(status, pct, !execUser || salesMasked)
                  return (
                    <tr key={sku.sku} className="dash-recent-table__row">
                      <td className="dash-recent-table__sku" data-label="SKU">{sku.sku}</td>
                      <td className="dash-recent-table__product dash-recent-table__product--lead" data-label="Product">
                        {toTitleCase(sku.product_name)}
                      </td>
                      <td className="dash-recent-table__brand" data-label="Brand">{sku.brand}</td>
                      <td className="dash-recent-table__muted" data-label="Gender">{genderShortLabel(sku.gender)}</td>
                      <td className="dash-recent-table__muted" data-label="Days">{days}</td>
                      {execUser ? (
                        <td className="dash-recent-table__sellthrough" data-label="Sell-through">
                          {salesMasked ? (
                            <span className="dash-recent-table__masked">*******</span>
                          ) : (
                            <div className="dash-recent-table__sellthrough-row">
                              <ProgressBar
                                value={pct}
                                color={sellDisplay.barColor}
                                width="48px"
                                className="dash-sell-through-bar"
                                style={{ marginTop: 0 }}
                              />
                              <span
                                className="dash-recent-table__pct"
                                style={{ color: sellDisplay.textColor }}
                              >
                                {pct}%
                              </span>
                            </div>
                          )}
                        </td>
                      ) : null}
                      <td data-label="Status">
                        <StatusChip status={status} />
                      </td>
                      <td className="dash-recent-table__action" data-label="Action">
                        {act.label === 'View' ? (
                          <button type="button" className="dash-table-action-link">
                            {act.label}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="dash-table-action-btn"
                            style={{
                              background: act.bg,
                              color: act.color,
                              border: act.border,
                            }}
                          >
                            {act.label}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedSkuForModal && selectedStatus && selectedTileData && (
        <ProductDetailModal
          sku={selectedSkuForModal}
          status={selectedStatus}
          statusData={{
            label: STATUS_LABELS[selectedStatus] ?? selectedStatus,
            color: selectedTileData.color,
            colorBg: selectedTileData.colorBg,
            icon: selectedTileData.icon,
          }}
          saleListAssign
          onClose={() => setSelectedSku(null)}
        />
      )}
      {activitySku && <ProductActivityModal sku={activitySku} onClose={() => setActivitySku(null)} />}
    </div>
  )
}
