import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
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
import { getLifecycleStatus, getSellThrough, getDaysInStore, STATUS_COLORS } from '../utils/lifecycle'
import { isExecutive } from '../utils/roles'
import { aggregateSkus } from '../utils/aggregateSkus'
import LifecycleTile from '../components/LifecycleTile'
import ProductPanelCard from '../components/ProductPanelCard'
import ProductDetailModal from '../components/ProductDetailModal'
import { SmartAlertsList, SmartAlertsHeaderTitle } from '../components/SmartAlertsList'
import SectionHeader from '../components/SectionHeader'
import StatusChip from '../components/StatusChip'
import ProgressBar from '../components/ProgressBar'
import { IconClose, IconSearchEmpty } from '../utils/icons.js'

const DM_SANS = '"DM Sans", sans-serif'
const DASH_PRIVACY_KEY = 'retailos_dashboard_privacy'

function maskKpiDisplay(raw) {
  if (raw === '—') return '—'
  return '*******'
}

const STATUS_LABELS = {
  'New Arrival': 'New Arrivals',
  Active: 'Active SKUs',
  Aging: 'Aging',
  Risk: 'At Risk',
  Clearance: 'Clearance',
  Outlet: 'Outlet',
}

const TILES = [
  {
    status: 'New Arrival',
    key: 'new',
    color: '#38bdf8',
    colorBg: 'rgba(56,189,248,0.1)',
    sub: 'Day 0 – 30',
    tag: 'Recently added',
    icon: '•',
  },
  {
    status: 'Active',
    key: 'active',
    color: '#00e676',
    colorBg: 'rgba(0,230,118,0.1)',
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
    color: '#ff8800',
    colorBg: 'rgba(255,136,0,0.1)',
    sub: 'Low sell-through',
    tag: 'Act now',
    icon: '!',
  },
  {
    status: 'Clearance',
    key: 'clearance',
    color: '#ff3333',
    colorBg: 'rgba(255,51,51,0.1)',
    sub: 'Day 150+',
    tag: 'Discount now',
    icon: '▼',
  },
  {
    status: 'Outlet',
    key: 'outlet',
    color: '#c084fc',
    colorBg: 'rgba(192,132,252,0.1)',
    sub: 'Day 180+',
    tag: 'Last units',
    icon: '◆',
  },
]

function normalizeGenderCode(g) {
  const x = (g || 'M').toUpperCase().slice(0, 1)
  if (x === 'M') return 'M'
  if (x === 'F') return 'F'
  return 'K'
}

function genderLabel(g) {
  const x = (g || 'M').toUpperCase().slice(0, 1)
  if (x === 'M') return 'M'
  if (x === 'F') return 'F'
  return 'K'
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
  const activeSeason = useStore((s) => s.activeSeason)
  const skuImportTotals = useStore((s) => s.skuImportTotals)
  const activeUser = useStore((s) => s.activeUser)
  const weeklySales = useStore((s) => s.weeklySales)
  const execUser = isExecutive(activeUser)

  const [selectedStatus, setSelectedStatus] = useState(null)
  const [genderFilter, setGenderFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [selectedSkuForModal, setSelectedSku] = useState(null)
  const [salesMasked, setSalesMasked] = useState(() => {
    try {
      return localStorage.getItem(DASH_PRIVACY_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(DASH_PRIVACY_KEY, salesMasked ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [salesMasked])

  const filteredSkus = useMemo(
    () => (activeSeason === 'All' ? skus : skus.filter((s) => s.season === activeSeason)),
    [skus, activeSeason],
  )

  const products = useMemo(() => aggregateSkus(filteredSkus), [filteredSkus])

  const statusGroups = useMemo(() => {
    const groups = {
      'New Arrival': [],
      Active: [],
      Aging: [],
      Risk: [],
      Clearance: [],
      Outlet: [],
    }
    products.forEach((s) => {
      const st = getLifecycleStatus(s.import_date, s.sold_quantity, s.quantity)
      if (groups[st]) groups[st].push(s)
    })
    return groups
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
    return (statusGroups[selectedStatus] || []).filter((s) => {
      const gOk = genderFilter === 'All' || normalizeGenderCode(s.gender) === genderFilter
      const cOk =
        categoryFilter === 'All' || (s.category || '').trim() === categoryFilter.trim()
      return gOk && cOk
    })
  }, [selectedStatus, statusGroups, genderFilter, categoryFilter])

  const selectedTileData = TILES.find((t) => t.status === selectedStatus)

  const gendersInStatus = useMemo(() => {
    if (!selectedStatus) return []
    const codes = [
      ...new Set((statusGroups[selectedStatus] || []).map((s) => normalizeGenderCode(s.gender))),
    ]
    const order = { M: 0, F: 1, K: 2 }
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
      .sort((a, b) => new Date(b.import_date).getTime() - new Date(a.import_date).getTime())
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

  const genderData = useMemo(() => {
    const map = { M: 0, F: 0, K: 0 }
    for (const sku of products) {
      const g = (sku.gender || 'M').toUpperCase().slice(0, 1)
      if (map[g] !== undefined) map[g]++
      else map.M++
    }
    const data = [
      { name: 'Male', value: map.M, color: '#38bdf8' },
      { name: 'Female', value: map.F, color: '#f472b6' },
      { name: 'Kids', value: map.K, color: '#2dd4bf' },
    ].filter((d) => d.value > 0)
    return data.length ? data : [{ name: 'No data', value: 1, color: 'var(--ro-text-muted)' }]
  }, [products])

  const genderSkuTotal = useMemo(
    () => genderData.reduce((sum, d) => sum + (d.name === 'No data' ? 0 : d.value), 0),
    [genderData],
  )

  const genderPercents = useMemo(() => {
    const total = genderSkuTotal || 1
    return Object.fromEntries(genderData.map((d) => [d.name, Math.round((d.value / total) * 100)]))
  }, [genderData, genderSkuTotal])

  const thisWeekSales = useMemo(() => {
    if (!weeklySales?.length) return { revenue: 0, units: 0 }
    const last = weeklySales[weeklySales.length - 1]
    return { revenue: last.totalRevenue ?? 0, units: last.totalUnits ?? 0 }
  }, [weeklySales])

  const avgWeeklyRevenue = useMemo(() => {
    if (!weeklySales?.length) return 0
    const total = weeklySales.reduce((s, w) => s + (w.totalRevenue ?? 0), 0)
    return total / weeklySales.length
  }, [weeklySales])

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
    let totalRev = 0
    let totalSold = 0
    for (const p of products) {
      const sold = p.sold_quantity || 0
      const avgP = p.avg_price_sold || 0
      totalRev += sold * avgP
      totalSold += sold
    }
    return totalSold > 0 ? totalRev / totalSold : 0
  }, [products])

  const closePanel = () => {
    setSelectedStatus(null)
    setSelectedSku(null)
  }

  const recentTableHeaders = execUser
    ? ['SKU', 'Product', 'Brand', 'Gender', 'Days', 'Sell-through', 'Status', 'Action']
    : ['SKU', 'Product', 'Brand', 'Gender', 'Days', 'Status', 'Action']
  const recentTableColSpan = execUser ? 8 : 7

  return (
    <div>
      {/* Section 1 — header */}
      <div
        className="fade-up delay-1"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="live-dot" style={{ background: '#ff3333' }} />
          <div
            style={{
              fontFamily: '"DM Sans"',
              fontSize: 16,
              letterSpacing: '2px',
              color: 'var(--ro-heading)',
            }}
          >
            INVENTORY LIFECYCLE STATUS
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ro-text-muted)' }}>Click any tile to explore products</div>
        {execUser ? (
          <Link
            to="/lookup"
            style={{
              fontSize: 11,
              color: '#38bdf8',
              fontFamily: '"DM Sans"',
              textDecoration: 'none',
            }}
          >
            Open inventory overview
          </Link>
        ) : (
          <Link
            to="/lifecycle"
            style={{
              fontSize: 11,
              color: '#38bdf8',
              fontFamily: '"DM Sans"',
              textDecoration: 'none',
            }}
          >
            Open SKU lifecycle
          </Link>
        )}
      </div>

      {/* Section 2 — lifecycle tiles */}
      <section
        className="fade-up delay-1 dash-lifecycle-tiles"
        style={{ marginBottom: 22 }}
      >
        {TILES.map((tile) => (
          <LifecycleTile
            key={tile.key}
            status={tile.status}
            count={statusGroups[tile.status]?.length ?? 0}
            sub={tile.sub}
            tag={tile.tag}
            color={tile.color}
            colorBg={tile.colorBg}
            isSelected={selectedStatus === tile.status}
            onClick={() => handleTileClick(tile.status)}
          />
        ))}
      </section>

      {/* Executive — Weekly Sales KPIs (only when imports exist) */}
      {execUser && skus.length > 0 && (
        <div className="fade-up delay-1 dash-exec-sales-privacy-wrap" style={{ marginBottom: 22 }}>
          <div
            className="dash-sales-visibility-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 10,
              marginBottom: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              className="dash-sales-visibility-label"
              style={{ fontSize: 10, fontWeight: 600, color: 'var(--ro-text-muted)', letterSpacing: '0.4px' }}
            >
              Sales visibility
            </span>
            <button
              type="button"
              className="dash-sales-privacy-toggle"
              aria-pressed={salesMasked}
              aria-label={salesMasked ? 'Show sales figures' : 'Hide sales figures'}
              onClick={() => setSalesMasked((m) => !m)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 32,
                padding: 0,
                borderRadius: 8,
                border: '1px solid var(--ro-border-hover)',
                background: 'var(--ro-surface-elevated)',
                color: salesMasked ? 'var(--ro-text-dim)' : 'var(--ro-text)',
                cursor: 'pointer',
              }}
            >
              {salesMasked ? <EyeOff size={18} strokeWidth={1.5} /> : <Eye size={18} strokeWidth={1.5} />}
            </button>
          </div>
          <div className="fade-up delay-1 dash-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {[
              { label: "This Week's Revenue", value: thisWeekSales.revenue > 0 ? `€${thisWeekSales.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—', color: '#00e676' },
              { label: 'Units Sold This Week', value: thisWeekSales.units > 0 ? String(thisWeekSales.units) : '—', color: '#38bdf8' },
              { label: 'Avg Weekly Revenue (8wk)', value: avgWeeklyRevenue > 0 ? `€${avgWeeklyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—', color: '#c084fc' },
              { label: 'Avg Selling Price', value: avgSellingPrice > 0 ? `€${avgSellingPrice.toFixed(2)}` : '—', color: '#fbbf24' },
            ].map((t) => (
              <div
                key={t.label}
                style={{
                  background: 'var(--ro-surface)',
                  border: '1px solid var(--ro-border)',
                  borderRadius: 13,
                  padding: '14px 16px',
                }}
              >
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>{t.label}</div>
                <div style={{ fontFamily: DM_SANS, fontSize: 24, color: t.color, letterSpacing: '0.5px' }}>
                  {salesMasked ? maskKpiDisplay(t.value) : t.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 3 — product panel */}
      {selectedStatus && selectedTileData && (
        <div key={selectedStatus} className="fade-up" style={{ marginBottom: 22 }}>
          <div
            style={{
              background: 'var(--ro-surface)',
              border: '1px solid var(--ro-border)',
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            <div
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                  {g === 'All' ? 'All' : genderLabel(g)}
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
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
                    gap: 12,
                  }}
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
                      totalImported={skuImportTotals[sku.sku] ?? 0}
                      salesVisible={execUser && !salesMasked}
                      onClick={() => setSelectedSku(sku)}
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
        className="fade-up delay-2 grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
        style={{
          gap: 14,
          marginBottom: 22,
          alignItems: 'stretch',
        }}
      >
        <div
          style={{
            background: 'var(--ro-surface)',
            border: '1px solid var(--ro-border)',
            borderRadius: 13,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div
            style={{
              fontFamily: '"DM Sans"',
              fontSize: 14,
              letterSpacing: '2px',
              color: 'var(--ro-heading)',
              marginBottom: 10,
            }}
          >
            <SmartAlertsHeaderTitle />
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto', flex: 1, minHeight: 0 }}>
            <SmartAlertsList limit={5} showViewAllLink urgencyFilter="all" />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div
            style={{
              background: 'var(--ro-surface)',
              border: '1px solid var(--ro-border)',
              borderRadius: 13,
              padding: '12px 14px',
              flex: 1,
              minHeight: 200,
            }}
          >
            {execUser && skus.length > 0 && revenueChartData.length > 0 ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ro-text)', marginBottom: 8 }}>
                  Weekly Revenue · Last 8 Weeks
                </div>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={displayRevenueChartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
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
                      <Bar dataKey="revenue" fill="#00e676" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : execUser ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ro-text)', marginBottom: 8 }}>
                  Sell-Through · Last 8 Weeks
                </div>
                <div style={{ height: 220 }}>
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

          <div
            style={{
              background: 'var(--ro-surface)',
              border: '1px solid var(--ro-border)',
              borderRadius: 13,
              padding: '12px 14px',
              flex: 1,
              minHeight: 0,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ro-text)', marginBottom: 8 }}>
              Inventory Split — {activeSeason}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
              <div style={{ position: 'relative', width: 180, height: 180, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={genderData}
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
                      {genderData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<GenderInventoryTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    paddingTop: 2,
                  }}
                >
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: 32,
                      color: 'var(--ro-heading)',
                      letterSpacing: 1,
                      lineHeight: 1,
                    }}
                  >
                    {genderSkuTotal > 0 ? genderSkuTotal : '—'}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: 'var(--ro-text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '1.2px',
                      marginTop: 4,
                    }}
                  >
                    SKUs
                  </span>
                </div>
              </div>
              <div style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                {genderData.map((d) => (
                  <div
                    key={d.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: d.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          color: 'var(--ro-text)',
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {d.name}
                      </span>
                    </span>
                    <span style={{ color: 'var(--ro-text-dim)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {d.name === 'No data' ? '—' : `${genderPercents[d.name] ?? 0}% · ${d.value}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 5 — recent activity */}
      <section className="fade-up delay-3" style={{ marginBottom: 22 }}>
        <SectionHeader title="RECENT SKU ACTIVITY">
          <Link
            to="/lifecycle"
            style={{
              display: 'inline-block',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ro-text-dim)',
              textDecoration: 'none',
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--ro-border)',
              background: 'var(--ro-surface-elevated)',
            }}
          >
            View Full Lifecycle →
          </Link>
        </SectionHeader>

        <div
          className="dash-table-wrap"
          style={{
            background: 'var(--ro-surface)',
            border: '1px solid var(--ro-border)',
            borderRadius: 13,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ro-border)' }}>
                {recentTableHeaders.map((h) => (
                  <th
                    key={h}
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.8px',
                      color: 'var(--ro-text-muted)',
                      textAlign: 'left',
                      padding: '10px 12px',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSkus.length === 0 ? (
                <tr>
                  <td colSpan={recentTableColSpan} style={{ padding: '24px 12px', fontSize: 12, color: 'var(--ro-text-dim)' }}>
                    No SKUs yet — import a CSV.
                  </td>
                </tr>
              ) : (
                recentSkus.map((sku) => {
                  const status = getLifecycleStatus(sku.import_date, sku.sold_quantity, sku.quantity)
                  const days = getDaysInStore(sku.import_date)
                  const pct = Math.round(getSellThrough(sku.sold_quantity, sku.quantity))
                  const color = STATUS_COLORS[status]
                  const act = actionForRow(status, pct, !execUser || salesMasked)
                  return (
                    <tr key={sku.sku} style={{ borderBottom: '1px solid var(--ro-border)' }}>
                      <td
                        style={{
                          padding: '10px 12px',
                          fontFamily: '"DM Sans"',
                          fontSize: 11,
                          color: 'var(--ro-text)',
                        }}
                      >
                        {sku.sku}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--ro-text)' }}>
                        {sku.product_name}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ro-text)' }}>{sku.brand}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ro-text)' }}>
                        {genderLabel(sku.gender)}
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          fontFamily: '"DM Sans"',
                          fontSize: 11,
                          color: 'var(--ro-text-muted)',
                        }}
                      >
                        {days}
                      </td>
                      {execUser ? (
                        <td style={{ padding: '10px 12px' }}>
                          {salesMasked ? (
                            <span style={{ fontSize: 11, color: 'var(--ro-text-dim)', fontWeight: 700 }}>*******</span>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <ProgressBar value={pct} color={color} width="60px" style={{ marginTop: 0 }} />
                              <span style={{ fontSize: 11, color, fontWeight: 700 }}>{pct}%</span>
                            </div>
                          )}
                        </td>
                      ) : null}
                      <td style={{ padding: '10px 12px' }}>
                        <StatusChip status={status} />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <button
                          type="button"
                          style={{
                            padding: '3px 9px',
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: 'pointer',
                            borderRadius: 6,
                            background: act.bg,
                            color: act.color,
                            border: act.border,
                          }}
                        >
                          {act.label}
                        </button>
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
          onClose={() => setSelectedSku(null)}
        />
      )}
    </div>
  )
}
