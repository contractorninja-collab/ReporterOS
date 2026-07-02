import { useMemo, useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { isExecutive } from '../utils/roles'
import { getSellThrough } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import {
  computeSalesInPeriod, groupSalesByInterval, groupEventDaysByInterval, pickInterval, computeRevenueInPeriod,
} from '../utils/salesSnapshots'
import {
  fetchSalesBySku, fetchSalesByDay, fetchSalesEventsHasAny,
  fetchExecutiveBuyingReport, fetchBrandProductivityReport, fetchReturnsExchangeReport,
  fetchSizeCurveHealthReport, fetchMarkdownRiskReport,
  fetchCategoryProductivityReport, fetchMoversReport, fetchWeeklySales, fetchProductReport,
} from '../api/client'
import { genderBucketKey } from '../utils/gender.js'
import { normalizeCategory } from '../utils/category.js'
import StatusBadge from '../components/StatusBadge.jsx'
import { isSeasonFilterActive, productMatchesActiveSeason } from '../utils/seasons.js'
import { toTitleCase } from '../utils/textFormat.js'
import KpiCard from '../components/KpiCard'
import { IconLock, IconPrint } from '../utils/icons.js'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'

const COLORS = ['#38bdf8', '#f472b6', '#fbbf24', '#00e676', '#c084fc', '#ff3333', '#ff8800', '#6366f1', '#34d399', '#f97316']
const GENDER_SEGMENT_COLORS = {
  Men: '#60A5FA',
  Women: '#F472B6',
  Kids: '#FBBF24',
  Unisex: '#34D399',
}
const CATEGORY_DISPLAY_COLORS = {
  Footwear: '#60A5FA',
  Apparel: '#A78BFA',
  Accessories: '#34D399',
  Other: '#9CA3AF',
}
const REPORTS_CHART_GRID = '#f3f4f6'
const REPORTS_AXIS_TICK = { fill: '#9ca3af', fontSize: 10 }
const REPORTS_CATEGORY_BAR = '#60a5fa'
const REPORTS_BAR_TREND = '#60a5fa'
const REPORTS_BAR_WOW = '#a78bfa'

function genderSegmentColor(name, index) {
  return GENDER_SEGMENT_COLORS[name] || COLORS[index % COLORS.length]
}

function categoryDisplayColor(name) {
  return CATEGORY_DISPLAY_COLORS[name] || '#9CA3AF'
}

const CHART_CARD = {
  background: 'var(--ro-surface)',
  border: '1px solid var(--ro-border)',
  borderRadius: 12,
  padding: '12px 14px',
}
const TABLE_HEADER = {
  textAlign: 'left', padding: '5px 8px', fontSize: 8, fontWeight: 700,
  color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '0.7px',
  borderBottom: '1px solid var(--ro-border)',
}
const TABLE_CELL = { padding: '5px 8px', fontSize: 11, color: 'var(--ro-text)' }
const TABLE_CELL_DIM = { ...TABLE_CELL, color: 'var(--ro-text-dim)', fontSize: 10 }
const PILL_ACTIVE = (color) => ({
  padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
  cursor: 'pointer', border: 'none', fontFamily: '"DM Sans"',
  background: `${color}18`, color,
})
const PILL_INACTIVE = {
  padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
  cursor: 'pointer', border: '1px solid var(--ro-border)',
  background: 'transparent', color: 'var(--ro-text-muted)', fontFamily: '"DM Sans"',
}
const SECTION_TITLE = {
  fontSize: 10, fontWeight: 700, color: 'var(--ro-text-dim)', textTransform: 'uppercase',
  letterSpacing: '1px', marginBottom: 10,
}
const CUSTOM_TOOLTIP = {
  background: 'var(--ro-surface-deep)', border: '1px solid var(--ro-border-hover)',
  borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--ro-text)',
}

function fmt(n) { return n >= 1000 ? `€${(n / 1000).toFixed(1)}K` : `€${Math.round(n)}` }

function downloadTableCSV(headers, rows, filename) {
  const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function ExportBtn({ onClick, label = 'CSV' }) {
  return (
    <button type="button" className="reports-export-btn" onClick={onClick}>{label}</button>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={CUSTOM_TOOLTIP}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || 'var(--ro-text-dim)', fontSize: 11 }}>
          {p.name}: {typeof p.value === 'number' && p.name?.includes('Revenue') ? fmt(p.value) : p.value}
        </div>
      ))}
    </div>
  )
}

function pct(n) { return `${Math.round(Number(n) || 0)}%` }

function fmtSigned(n) {
  const v = Number(n) || 0
  return v < 0 ? `-${fmt(Math.abs(v))}` : fmt(v)
}

function sellThroughColor(pct) {
  const n = Number(pct) || 0
  if (n >= 60) return '#15803D'
  if (n >= 30) return '#D97706'
  return '#DC2626'
}

function MoverProductCell({ name, sku, deadStock = false }) {
  return (
    <div className="movers-product-cell">
      <div className="movers-product-cell__name">
        <span>{toTitleCase(name)}</span>
        {deadStock ? <StatusBadge variant="dead-stock">⚠ Dead stock</StatusBadge> : null}
      </div>
      <div className="movers-product-cell__sku">{sku}</div>
    </div>
  )
}

function moverColumns(variant) {
  const isSlow = variant === 'slow'
  return [
    {
      key: 'product_name',
      label: 'Product',
      render: (r) => (
        <MoverProductCell
          name={r.product_name}
          sku={r.sku}
          deadStock={isSlow && Number(r.days_in_store) >= 150 && Number(r.sell_through) === 0}
        />
      ),
    },
    { key: 'net_units', label: 'Sold' },
    {
      key: 'sell_through',
      label: 'ST%',
      render: (r) => {
        const st = Number(r.sell_through) || 0
        return (
          <span
            className="movers-st"
            style={{ color: isSlow ? '#DC2626' : sellThroughColor(st), fontWeight: isSlow ? 700 : 600 }}
          >
            {pct(st)}
          </span>
        )
      },
    },
    { key: 'velocity', label: 'U/day' },
    {
      key: 'days_in_store',
      label: 'Days',
      render: (r) => {
        const days = Number(r.days_in_store) || 0
        return (
          <span className={isSlow && days >= 150 ? 'movers-days movers-days--urgent' : 'movers-days'}>
            {days}
          </span>
        )
      },
    },
    {
      key: 'remaining',
      label: 'Left',
      render: (r) => (
        <span className={isSlow ? 'movers-left movers-left--emphasis' : 'movers-left'}>
          {r.remaining}
        </span>
      ),
    },
    {
      key: 'net_revenue',
      label: 'Revenue',
      render: (r) => {
        const rev = Number(r.net_revenue) || 0
        return (
          <span className={isSlow && rev === 0 ? 'movers-revenue movers-revenue--zero' : 'movers-revenue'}>
            {fmt(rev)}
          </span>
        )
      },
    },
  ]
}

function ProductCell({ name, sku }) {
  return (
    <div>
      <div style={{ fontWeight: 600 }}>{name}</div>
      <div style={{ fontSize: 9, color: 'var(--ro-text-muted)' }}>{sku}</div>
    </div>
  )
}

const MOVER_COLUMNS_FAST = moverColumns('fast')
const MOVER_COLUMNS_SLOW = moverColumns('slow')

function profitCellColor(profit) {
  const p = Number(profit) || 0
  if (p < 0) return '#DC2626'
  if (p === 0) return '#9CA3AF'
  return '#15803D'
}

function marginThresholdColor(margin) {
  const m = Number(margin) || 0
  if (m >= 50) return '#15803D'
  if (m >= 40) return '#D97706'
  return '#DC2626'
}

function ProfitProductCell({ name, sku }) {
  return (
    <div className="profit-product-cell">
      <div className="profit-product-cell__name">
        <span>{toTitleCase(name)}</span>
      </div>
      <div className="profit-product-cell__sku">{sku}</div>
    </div>
  )
}

function productMarginPct(r) {
  const rev = Number(r.totalRevenue) || 0
  if (rev <= 0) return 0
  return ((Number(r.profit) || 0) / rev) * 100
}

function profitProductColumns(variant) {
  const isLowMargin = variant === 'low-margin'
  const cols = [
    {
      key: 'product_name',
      label: 'Product',
      render: (r) => (
        <ProfitProductCell name={r.product_name} sku={r.sku} />
      ),
    },
    { key: 'sold', label: 'Sold' },
    { key: 'totalRevenue', label: 'Revenue', render: (r) => fmt(r.totalRevenue || 0) },
    { key: 'cogs', label: 'COGS', render: (r) => fmt(r.cogs || 0) },
    {
      key: 'profit',
      label: 'Profit',
      render: (r) => {
        const p = Number(r.profit) || 0
        return (
          <span className="profit-col-profit" style={{ color: profitCellColor(p) }}>
            {fmtSigned(p)}
          </span>
        )
      },
    },
  ]
  if (isLowMargin) {
    cols.push({
      key: 'margin',
      label: 'Margin',
      render: (r) => {
        const m = productMarginPct(r)
        return (
          <span className="profit-col-margin" style={{ color: marginThresholdColor(m), fontWeight: 600 }}>
            {pct(m)}
          </span>
        )
      },
    })
  } else {
    cols.push({
      key: 'roi',
      label: 'ROI',
      render: (r) => (
        <span className="profit-col-roi" style={{ color: '#374151', fontWeight: 600 }}>
          {pct(r.roi)}
        </span>
      ),
    })
  }
  return cols
}

const PROFIT_COLUMNS_TOP = profitProductColumns('top')
const PROFIT_COLUMNS_LOW_MARGIN = profitProductColumns('low-margin')

const PROFIT_GROUP_COLUMNS = [
  { key: 'name', label: 'Group' },
  { key: 'sold', label: 'Sold' },
  { key: 'revenue', label: 'Revenue', render: (r) => fmt(r.revenue) },
  { key: 'cogs', label: 'COGS', render: (r) => fmt(r.cogs) },
  {
    key: 'profit',
    label: 'Profit',
    render: (r) => {
      const p = Number(r.profit) || 0
      return (
        <span
          className="profit-col-profit profit-col-profit--group"
          style={{ color: p < 0 ? '#DC2626' : '#15803D' }}
        >
          {fmtSigned(p)}
        </span>
      )
    },
  },
  {
    key: 'margin',
    label: 'Margin',
    render: (r) => (
      <span className="profit-col-margin" style={{ color: marginThresholdColor(r.margin) }}>
        {pct(r.margin)}
      </span>
    ),
  },
]

function ShareBars({ revShare, stockShare }) {
  const rev = Math.max(0, Math.min(100, Number(revShare) || 0))
  const stock = Math.max(0, Math.min(100, Number(stockShare) || 0))
  const signal = rev > stock + 5 ? 'under' : stock > rev + 8 ? 'over' : null
  return (
    <div className="rp-cmp">
      <div className="rp-cmp-metric">
        <div className="rp-cmp-head">
          <span className="rp-cmp-k">Rev</span>
          <span className="rp-cmp-v">{rev.toFixed(1)}%</span>
        </div>
        <div className="rp-cmp-track"><span className="rp-cmp-fill rp-cmp-fill--rev" style={{ width: `${rev}%` }} /></div>
      </div>
      <div className="rp-cmp-metric">
        <div className="rp-cmp-head">
          <span className="rp-cmp-k">Stk</span>
          <span className="rp-cmp-v">{stock.toFixed(1)}%</span>
        </div>
        <div className="rp-cmp-track"><span className="rp-cmp-fill rp-cmp-fill--stk" style={{ width: `${stock}%` }} /></div>
      </div>
      {signal && (
        <span className={`rp-cmp-tag rp-cmp-tag--${signal}`}>
          {signal === 'under' ? 'under-bought' : 'over-bought'}
        </span>
      )}
    </div>
  )
}

const productivityColumns = (labelKey) => [
  { key: labelKey, label: labelKey === 'brand' ? 'Brand' : 'Category' },
  { key: 'share', label: 'Revenue vs Stock Share', render: (r) => <ShareBars revShare={r.revenue_share} stockShare={r.stock_share} /> },
  { key: 'net_units', label: 'Net Units' },
  { key: 'net_revenue', label: 'Revenue', render: (r) => fmt(r.net_revenue || 0) },
  { key: 'sell_through', label: 'ST %', dim: true, render: (r) => pct(r.sell_through) },
  { key: 'return_rate', label: 'Returns', dim: true, render: (r) => pct(r.return_rate) },
  { key: 'score', label: 'Score', render: (r) => <ProductivityScore score={r.score} /> },
  { key: 'recommended_action', label: 'Action', dim: true },
]

const SCORE_SCALE_HINT = 'Score 0–100 based on sell-through, velocity, price realization, returns, age, overstock'

function productivityScoreColor(score) {
  const n = Number(score) || 0
  if (n >= 60) return '#15803D'
  if (n >= 40) return '#D97706'
  if (n >= 20) return '#6B7280'
  return '#DC2626'
}

function productivityScoreBand(score) {
  const n = Number(score) || 0
  if (n >= 60) return 'increase buy depth'
  if (n >= 40) return 'maintain selective reorder'
  if (n >= 20) return 'monitor'
  return 'cut reorder'
}

function ProductivityScore({ score }) {
  const n = Math.round(Number(score) || 0)
  const color = productivityScoreColor(n)
  const band = productivityScoreBand(n)
  const width = Math.max(0, Math.min(100, n))
  return (
    <span className="prod-score" title={`${SCORE_SCALE_HINT} — ${band}`}>
      <span className="prod-score__bar" aria-hidden="true">
        <span className="prod-score__fill" style={{ width: `${width}%`, background: color }} />
      </span>
      <span className="prod-score__val" style={{ color }}>{n} / 100</span>
    </span>
  )
}

function ReportMobileCards({ rows, columns, cardClassName = '', rowKey }) {
  return (
    <div className="reports-mobile-list">
      {rows.map((row, i) => (
        <div key={rowKey(row, i)} className={`reports-mobile-card${cardClassName ? ` ${cardClassName}` : ''}`}>
          <div className="reports-mobile-card__lead">
            {columns[0]?.render ? columns[0].render(row, i) : row[columns[0]?.key]}
          </div>
          <div className="reports-mobile-stats">
            {columns.slice(1).map((c) => (
              <div
                key={c.key}
                className={`reports-mobile-stat${c.key === 'share' ? ' reports-mobile-stat--wide' : ''}`}
              >
                <span className="reports-mobile-stat__label">{c.label}</span>
                <span className="reports-mobile-stat__val">
                  {c.render ? c.render(row, i) : row[c.key]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CompactTable({ columns, rows, empty = 'No report rows yet', compact = false, variant, isNarrow = false }) {
  if (!rows?.length) {
    return <div className="reports-empty-state">{empty}</div>
  }
  const isMovers = variant === 'movers-fast' || variant === 'movers-slow'
  const isProfit = variant === 'profit-top' || variant === 'profit-low-margin' || variant === 'profit-group'
  const isProductivity = variant === 'productivity'
  if (isMovers && isNarrow) {
    return (
      <ReportMobileCards
        rows={rows}
        columns={columns}
        cardClassName={variant === 'movers-slow' ? 'reports-mobile-card--warn' : ''}
        rowKey={(row, i) => `${row.sku || 'row'}-${i}`}
      />
    )
  }
  if (isProfit && isNarrow) {
    return (
      <ReportMobileCards
        rows={rows}
        columns={columns}
        cardClassName={variant === 'profit-low-margin' ? 'reports-mobile-card--warn' : ''}
        rowKey={(row, i) => `${row.sku || row.name || 'row'}-${i}`}
      />
    )
  }
  if (isProductivity && isNarrow) {
    return (
      <ReportMobileCards
        rows={rows}
        columns={columns}
        rowKey={(row, i) => `${row.brand || row.category || 'row'}-${i}`}
      />
    )
  }
  if (isMovers) {
    return (
      <div className="reports-data-table-wrap movers-table-wrap">
        <table className={`movers-table movers-table--${variant === 'movers-fast' ? 'fast' : 'slow'}`}>
          <thead>
            <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.sku || row.brand || row.category || 'row'}-${i}`}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.render ? c.render(row, i) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (isProfit) {
    const profitKind = variant === 'profit-group' ? 'group' : variant.replace('profit-', '')
    return (
      <div className="reports-data-table-wrap profit-table-wrap">
        <table className={`profit-table profit-table--${profitKind}`}>
          <thead>
            <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.sku || row.name || row.brand || row.category || 'row'}-${i}`}>
                {columns.map((c) => (
                  <td key={c.key} className={c.key === 'name' ? 'profit-table__group' : undefined}>
                    {c.render ? c.render(row, i) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  const headerStyle = compact ? { ...TABLE_HEADER, padding: '3px 6px' } : TABLE_HEADER
  const cellStyle = compact ? { ...TABLE_CELL, padding: '3px 6px', fontSize: 10 } : TABLE_CELL
  const cellDimStyle = compact ? { ...TABLE_CELL_DIM, padding: '3px 6px', fontSize: 9 } : TABLE_CELL_DIM
  return (
    <div className="reports-data-table-wrap" style={{ overflowX: 'auto' }}>
      <table className={`reports-exec-table${compact ? ' reports-exec-table--compact' : ''}`}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={headerStyle}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.sku || row.brand || row.category || row.exchange_group_id || 'row'}-${i}`}>
              {columns.map((c) => (
                <td key={c.key} style={c.dim ? cellDimStyle : cellStyle}>
                  {c.render ? c.render(row, i) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function toLocalYMD(d) {
  const x = new Date(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getDatePresets() {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayOfWeek = today.getDay() || 7
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - dayOfWeek + 1)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const quarterMonth = Math.floor(today.getMonth() / 3) * 3
  const quarterStart = new Date(today.getFullYear(), quarterMonth, 1)
  return {
    today: { start: today, end: now },
    week: { start: weekStart, end: now },
    month: { start: monthStart, end: now },
    quarter: { start: quarterStart, end: now },
  }
}

function useNarrowViewport() {
  const [state, setState] = useState(() => ({
    isNarrow: typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches,
    viewportW: typeof window !== 'undefined' ? window.innerWidth : 390,
  }))
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)')
    const sync = () => setState({ isNarrow: mq.matches, viewportW: window.innerWidth })
    mq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    sync()
    return () => {
      mq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])
  return state
}

/** Fixed-pixel charts on phone — ResponsiveContainer fails inside scroll/flex layouts. */
function ReportChart({ height, mobileWidth, isNarrow, children }) {
  if (isNarrow && mobileWidth > 0) {
    return (
      <div style={{ width: mobileWidth, height, flexShrink: 0 }}>
        {children(mobileWidth, height)}
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      {children()}
    </ResponsiveContainer>
  )
}

export function Reports() {
  const skus = useStore((s) => s.skus)
  const shipmentMeta = useStore((s) => s.shipmentMeta)
  const activeUser = useStore((s) => s.activeUser)
  const snapshots = useStore((s) => s.salesSnapshots)
  const activeSeason = useStore((s) => s.activeSeason)

  const products = useMemo(
    () => aggregateSkus(skus, shipmentMeta, activeSeason).filter((p) => productMatchesActiveSeason(p, activeSeason)),
    [skus, shipmentMeta, activeSeason],
  )

  const seasonSkuSet = useMemo(
    () => new Set(products.map((p) => p.sku)),
    [products],
  )
  const hasSnapshots = snapshots.length > 0

  const presets = useMemo(() => getDatePresets(), [])
  const [rangeKey, setRangeKey] = useState('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [salesEventsMode, setSalesEventsMode] = useState(false)
  const [eventSkuRows, setEventSkuRows] = useState([])
  const [eventDayRows, setEventDayRows] = useState([])
  const [executiveReports, setExecutiveReports] = useState({
    buying: null,
    brand: null,
    returns: null,
    sizeCurve: null,
    markdown: null,
    movers: null,
    categoryProd: null,
    loading: true,
    error: '',
  })
  const [weeklyRows, setWeeklyRows] = useState([])
  const [productReport, setProductReport] = useState(null)

  const { startDate, endDate } = useMemo(() => {
    if (rangeKey === 'custom' && customStart && customEnd) {
      return { startDate: new Date(customStart), endDate: new Date(customEnd + 'T23:59:59') }
    }
    if (rangeKey !== 'all' && presets[rangeKey]) {
      return { startDate: presets[rangeKey].start, endDate: presets[rangeKey].end }
    }
    const earliest = products.reduce((min, p) => {
      const d = new Date(p.import_date)
      return d < min ? d : min
    }, new Date())
    return { startDate: earliest, endDate: new Date() }
  }, [rangeKey, customStart, customEnd, presets, products])

  useEffect(() => {
    let cancelled = false
    fetchSalesEventsHasAny()
      .then((r) => {
        if (!cancelled) setSalesEventsMode(!!r?.has)
      })
      .catch(() => {
        if (!cancelled) setSalesEventsMode(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!salesEventsMode) {
      setEventSkuRows([])
      setEventDayRows([])
      return
    }
    let cancelled = false
    const since = toLocalYMD(startDate)
    const until = toLocalYMD(endDate)
    Promise.all([
      fetchSalesBySku(since, until, activeSeason),
      fetchSalesByDay(since, until, activeSeason),
    ])
      .then(([skuRows, dayRows]) => {
        if (cancelled) return
        setEventSkuRows(Array.isArray(skuRows) ? skuRows : [])
        setEventDayRows(Array.isArray(dayRows) ? dayRows : [])
      })
      .catch(() => {
        if (!cancelled) {
          setEventSkuRows([])
          setEventDayRows([])
        }
      })
    return () => { cancelled = true }
  }, [salesEventsMode, startDate, endDate, activeSeason])

  useEffect(() => {
    let cancelled = false
    const params = {
      since: toLocalYMD(startDate),
      until: toLocalYMD(endDate),
      season: activeSeason || 'All',
    }
    setExecutiveReports((s) => ({ ...s, loading: true, error: '' }))
    Promise.all([
      fetchExecutiveBuyingReport(params),
      fetchBrandProductivityReport(params),
      fetchReturnsExchangeReport(params),
      fetchSizeCurveHealthReport(params),
      fetchMarkdownRiskReport(params),
      fetchMoversReport(params),
      fetchCategoryProductivityReport(params),
    ])
      .then(([buying, brand, returns, sizeCurve, markdown, movers, categoryProd]) => {
        if (cancelled) return
        setExecutiveReports({ buying, brand, returns, sizeCurve, markdown, movers, categoryProd, loading: false, error: '' })
      })
      .catch((e) => {
        if (!cancelled) {
          setExecutiveReports((s) => ({ ...s, loading: false, error: e?.message || 'Report data failed to load' }))
        }
      })
    return () => { cancelled = true }
  }, [startDate, endDate, activeSeason])

  useEffect(() => {
    let cancelled = false
    fetchWeeklySales(8)
      .then((rows) => { if (!cancelled) setWeeklyRows(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (!cancelled) setWeeklyRows([]) })
    fetchProductReport('', { season: activeSeason || 'All' })
      .then((r) => { if (!cancelled) setProductReport(r) })
      .catch(() => { if (!cancelled) setProductReport(null) })
    return () => { cancelled = true }
  }, [activeSeason])

  // --- Core data computation ---
  const salesData = useMemo(() => {
    const inSeason = (skuCode) => seasonSkuSet.has(skuCode)
    if (salesEventsMode) {
      return eventSkuRows
        .map((row) => {
          const sku = row.sku
          const delta = Number(row.sold_qty) || 0
          const revenue = Number(row.revenue) || 0
          const p = products.find((pp) => pp.sku === sku)
          const priceSold = delta > 0 ? revenue / delta : (p?.avg_price_sold || p?.price_sold || 0)
          return {
            skuCode: sku,
            productName: p?.product_name || sku,
            category: p?.category || '',
            gender: p?.gender || '',
            brand: p?.brand || '',
            priceSold,
            priceTag: p?.price_tag,
            quantity: p?.quantity ?? 0,
            soldQuantity: p?.sold_quantity ?? 0,
            delta,
            revenue,
          }
        })
        .filter((r) => r.delta > 0 && inSeason(r.skuCode))
    }
    if (hasSnapshots) {
      const snapshotResult = computeSalesInPeriod(snapshots, startDate, endDate)
      if (snapshotResult.length > 0) {
        return snapshotResult.filter((r) => inSeason(r.skuCode))
      }
    }
    return products.map((p) => ({
      skuCode: p.sku,
      productName: p.product_name,
      category: p.category || '',
      gender: p.gender || '',
      brand: p.brand || '',
      priceSold: p.avg_price_sold || p.price_sold,
      priceTag: p.price_tag,
      quantity: p.quantity,
      soldQuantity: p.sold_quantity,
      delta: p.sold_quantity,
      revenue: p.sold_quantity * (p.avg_price_sold || p.price_sold || 0),
    })).filter((p) => {
      if (p.delta <= 0) return false
      if (rangeKey === 'all') return true
      const d = new Date(products.find((pp) => pp.sku === p.skuCode)?.import_date)
      return d >= startDate && d <= endDate
    })
  }, [salesEventsMode, eventSkuRows, hasSnapshots, snapshots, startDate, endDate, products, rangeKey, seasonSkuSet])

  const trendData = useMemo(() => {
    if (salesEventsMode) {
      if (!eventDayRows.length) return []
      const interval = pickInterval(startDate, endDate)
      return groupEventDaysByInterval(eventDayRows, startDate, endDate, interval)
    }
    if (!hasSnapshots) return []
    const interval = pickInterval(startDate, endDate)
    return groupSalesByInterval(snapshots, startDate, endDate, interval)
  }, [salesEventsMode, eventDayRows, hasSnapshots, snapshots, startDate, endDate])

  // --- KPIs ---
  const totalUnits = useMemo(() => salesData.reduce((s, r) => s + r.delta, 0), [salesData])
  const totalRevenue = useMemo(() => computeRevenueInPeriod(salesData), [salesData])
  const avgSellThrough = useMemo(() => {
    const withQty = salesData.filter((r) => r.quantity > 0)
    if (!withQty.length) return 0
    const total = withQty.reduce((s, r) => s + getSellThrough(r.soldQuantity, r.quantity), 0)
    return Math.round(total / withQty.length)
  }, [salesData])
  const topCategory = useMemo(() => {
    const map = {}
    for (const r of salesData) {
      const cat = (r.category || 'Other').trim()
      map[cat] = (map[cat] || 0) + r.revenue
    }
    let best = 'N/A'
    let bestVal = 0
    for (const [cat, rev] of Object.entries(map)) {
      if (rev > bestVal) { best = cat; bestVal = rev }
    }
    return best
  }, [salesData])

  // --- Gender breakdown ---
  const genderData = useMemo(() => {
    const map = {}
    for (const r of salesData) {
      const g = genderBucketKey(r.gender)
      if (!map[g]) map[g] = { units: 0, revenue: 0 }
      map[g].units += r.delta
      map[g].revenue += r.revenue
    }
    return Object.entries(map).map(([name, d]) => ({ name, value: d.units, revenue: d.revenue })).sort((a, b) => b.value - a.value)
  }, [salesData])

  const totalGenderRevenue = useMemo(() => genderData.reduce((s, d) => s + d.revenue, 0), [genderData])

  // --- Category breakdown ---
  const categoryData = useMemo(() => {
    const map = {}
    for (const r of salesData) {
      const cat = (r.category || 'Other').trim()
      if (!map[cat]) map[cat] = { units: 0, revenue: 0 }
      map[cat].units += r.delta
      map[cat].revenue += r.revenue
    }
    return Object.entries(map).map(([name, d]) => ({ name, units: d.units, revenue: d.revenue })).sort((a, b) => b.units - a.units)
  }, [salesData])

  // --- Product type mix: only the 3 canonical categories.
  // Apparel sub-types (t-shirts, pants, jackets, hoodies, shorts) already carry
  // category "Apparel"; socks are routed to Accessories per requirement.
  const productTypeData = useMemo(() => {
    const map = { Footwear: { units: 0, revenue: 0 }, Apparel: { units: 0, revenue: 0 }, Accessories: { units: 0, revenue: 0 } }
    for (const r of salesData) {
      const name = (r.productName || '').toLowerCase()
      let bucket = normalizeCategory(r.category)
      if (name.includes('sock')) bucket = 'Accessories'
      if (!(bucket in map)) continue
      map[bucket].units += r.delta
      map[bucket].revenue += r.revenue
    }
    return Object.entries(map)
      .map(([name, d]) => ({ name, units: d.units, revenue: d.revenue }))
      .filter((d) => d.units > 0 || d.revenue > 0)
      .sort((a, b) => b.units - a.units)
  }, [salesData])

  // --- Gender → category breakdown (expanded on row click) ---
  const [selectedGender, setSelectedGender] = useState(null)
  const genderCategoryData = useMemo(() => {
    if (!selectedGender) return []
    const map = {}
    let units = 0
    let revenue = 0
    for (const r of salesData) {
      if (genderBucketKey(r.gender) !== selectedGender) continue
      const cat = (r.category || 'Other').trim() || 'Other'
      if (!map[cat]) map[cat] = { units: 0, revenue: 0 }
      map[cat].units += r.delta
      map[cat].revenue += r.revenue
      units += r.delta
      revenue += r.revenue
    }
    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        units: d.units,
        revenue: d.revenue,
        unitPct: units ? (d.units / units) * 100 : 0,
        revPct: revenue ? (d.revenue / revenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [selectedGender, salesData])

  // --- Week-over-week movement (last 8 calendar weeks of sale events) ---
  const wowData = useMemo(() => weeklyRows.map((w, i) => {
    const prev = weeklyRows[i - 1]
    const prevRev = prev ? Number(prev.totalRevenue) || 0 : 0
    const wowPct = i > 0 && prevRev > 0
      ? (((Number(w.totalRevenue) || 0) - prevRev) / prevRev) * 100
      : null
    return { ...w, wowPct }
  }), [weeklyRows])

  // --- Fast & slow movers (server-computed, date-range aware) ---
  const moversFast = executiveReports.movers?.fast || []
  const moversSlow = executiveReports.movers?.slow || []

  // --- Profitability & ROI (all-time P&L from product report) ---
  const profitTotals = productReport?.totals || null
  const grossMarginPct = profitTotals && profitTotals.totalRevenue > 0
    ? (profitTotals.totalProfit / profitTotals.totalRevenue) * 100
    : 0
  const profitRows = useMemo(
    () => (productReport?.rows || []).filter((r) => (r.sold || 0) > 0 || (r.totalRevenue || 0) > 0),
    [productReport],
  )
  const topProfitRows = useMemo(
    () => [...profitRows].sort((a, b) => (b.profit || 0) - (a.profit || 0)).slice(0, 8),
    [profitRows],
  )
  const lowMarginRows = useMemo(
    () => [...profitRows]
      .filter((r) => (r.totalRevenue || 0) >= 50)
      .sort((a, b) => productMarginPct(a) - productMarginPct(b))
      .slice(0, 8),
    [profitRows],
  )
  const [profitGroupKey, setProfitGroupKey] = useState('brand')
  const profitGroups = useMemo(() => {
    const map = {}
    for (const r of profitRows) {
      const key = (profitGroupKey === 'brand' ? r.brand : normalizeCategory(r.category)) || 'Other'
      if (!map[key]) map[key] = { name: key, sold: 0, revenue: 0, cogs: 0, profit: 0 }
      map[key].sold += r.sold || 0
      map[key].revenue += r.totalRevenue || 0
      map[key].cogs += r.cogs || 0
      map[key].profit += r.profit || 0
    }
    return Object.values(map)
      .map((g) => ({ ...g, margin: g.revenue > 0 ? (g.profit / g.revenue) * 100 : 0 }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10)
  }, [profitRows, profitGroupKey])

  // --- Brand & category productivity (revenue share vs stock share) ---
  const [prodView, setProdView] = useState('brand')
  const productivityRows = useMemo(() => {
    const src = prodView === 'brand' ? executiveReports.brand?.rows : executiveReports.categoryProd?.rows
    return Array.isArray(src) ? src.slice(0, 12) : []
  }, [prodView, executiveReports.brand, executiveReports.categoryProd])

  const { isNarrow, viewportW } = useNarrowViewport()
  const chartH = isNarrow ? 248 : 178
  const chartFitW = Math.max(300, viewportW - 72)
  const genderDonutH = isNarrow ? 108 : 168
  const genderDonutW = isNarrow ? 108 : undefined
  const genderPieInner = isNarrow ? 28 : 52
  const genderPieOuter = isNarrow ? 40 : 72

  const categoryChartH = isNarrow && categoryData.length > 0
    ? Math.max(chartH, categoryData.length * 24 + 20)
    : chartH
  const categoryBarSize = isNarrow && categoryData.length > 0
    ? Math.max(12, Math.min(18, Math.floor((categoryChartH - 16) / categoryData.length) - 2))
    : 20

  const rangeLabel = rangeKey === 'all' ? 'All Time'
    : rangeKey === 'custom' ? `${customStart} — ${customEnd}`
    : rangeKey.charAt(0).toUpperCase() + rangeKey.slice(1)

  const seasonScopeLabel = isSeasonFilterActive(activeSeason)
    ? `${activeSeason} products · sales in ${rangeLabel} · inventory totals lifetime`
    : `All seasons · sales in ${rangeLabel} · inventory totals lifetime`

  // --- Print handler ---
  const handlePrint = () => { window.print() }

  if (!isExecutive(activeUser)) {
    return (
      <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}><IconLock size={48} strokeWidth={1.5} /></div>
        <h2 style={{ fontFamily: '"DM Sans"', fontSize: 22, letterSpacing: '2px', color: 'var(--ro-heading)', margin: '0 0 8px' }}>EXECUTIVE ACCESS ONLY</h2>
        <p style={{ fontSize: 13, color: 'var(--ro-text-muted)' }}>Reports are only available to Executive users.</p>
      </div>
    )
  }

  return (
    <div className="reports-page-root">
      {/* Header */}
      <div className="reports-page-header">
        <h2 className="reports-page-header__title page-hero-mobile-hide">Reports & Analytics</h2>
        <button type="button" className="reports-print-btn" onClick={handlePrint}>
          <IconPrint size={14} strokeWidth={1.5} aria-hidden />
          Print Report
        </button>
      </div>

      {/* Date range toolbar */}
      <div className="reports-period-tabs">
        {[
          { key: 'today', label: 'Today' },
          { key: 'week', label: 'This Week' },
          { key: 'month', label: 'This Month' },
          { key: 'quarter', label: 'This Quarter' },
          { key: 'all', label: 'All Time' },
          { key: 'custom', label: 'Custom' },
        ].map((p) => (
          <button
            key={p.key}
            type="button"
            className={`reports-period-tab${rangeKey === p.key ? ' reports-period-tab--active' : ''}`}
            onClick={() => setRangeKey(p.key)}
          >
            {p.label}
          </button>
        ))}
        {rangeKey === 'custom' && (
          <div className="reports-period-custom">
            <input type="date" className="reports-period-date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <span className="reports-period-custom__sep">to</span>
            <input type="date" className="reports-period-date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </div>
        )}
      </div>

      <div className="reports-info-banner">
        <span className="reports-info-banner__icon" aria-hidden>◷</span>
        <p className="reports-info-banner__text">
          {seasonScopeLabel}. Carryover stock re-tagged to the active season counts in that season with full import and sales history.
        </p>
      </div>

      {salesEventsMode && (
        <div className="reports-info-banner">
          <span className="reports-info-banner__icon" aria-hidden>ℹ</span>
          <p className="reports-info-banner__text">
            Reports use sale dates from Reporting Import (each row&apos;s sale_date). Choose a range above to match units and revenue to those calendar days.
          </p>
        </div>
      )}
      {!salesEventsMode && !hasSnapshots && (
        <div className="reports-warn-banner">
          No sales snapshots yet. Import data to start tracking period-based sales. Showing cumulative data filtered by arrival date.
        </div>
      )}

      {executiveReports.error && (
        <div className="reports-error-banner">
          {executiveReports.error}
        </div>
      )}

      {/* KPI Row — desktop: grid; phone: horizontal scroll, wider tiles */}
      <div className="reports-kpi-row">
        <div className="reports-kpi-scroll">
          <div className="reports-kpi-item">
            <KpiCard
              className="reports-kpi-card reports-kpi-card--revenue"
              label="Revenue"
              value={fmt(totalRevenue)}
              sub={rangeLabel}
              accentColor="#60a5fa"
              tag={`${salesData.length} products`}
            />
          </div>
          <div className="reports-kpi-item">
            <KpiCard
              className="reports-kpi-card reports-kpi-card--units"
              label="Units sold"
              value={totalUnits}
              sub="All categories"
              accentColor="#34d399"
              tag={`${avgSellThrough}% avg sell-through`}
            />
          </div>
          <div className="reports-kpi-item">
            <KpiCard
              className="reports-kpi-card reports-kpi-card--sellthrough"
              label="Avg sell-through"
              value={`${avgSellThrough}%`}
              sub="Active products"
              accentColor="#fbbf24"
            />
          </div>
          <div className="reports-kpi-item">
            <KpiCard
              className="reports-kpi-card reports-kpi-card--category"
              label="Top category"
              value={topCategory}
              sub="By revenue"
              accentColor="#f87171"
            />
          </div>
          <div className="reports-kpi-item">
            <KpiCard
              className="reports-kpi-card reports-kpi-card--margin"
              label="Gross margin"
              value={`${Math.round(grossMarginPct)}%`}
              sub="All-time, after COGS"
              accentColor="#a78bfa"
              tag={profitTotals ? fmtSigned(profitTotals.totalProfit) : '—'}
            />
          </div>
        </div>
      </div>

      {/* Charts Grid — phone: single column + optional horizontal chart scroll */}
      <div className="reports-charts-grid">

        {/* Sales Trend */}
        <div className="reports-chart-card">
          <div className="reports-chart-card__head">
            <h3 className="reports-chart-card__title">Sales trend</h3>
            {trendData.length > 0 && (
              <ExportBtn onClick={() => downloadTableCSV(
                ['Period', 'Units', 'Revenue'],
                trendData.map((d) => [d.label, d.units, d.revenue.toFixed(2)]),
                'sales-trend.csv'
              )} />
            )}
          </div>
          {trendData.length > 0 ? (
            <div className="reports-chart-canvas">
              <div
                className="reports-chart-canvas-inner"
                style={isNarrow ? { width: chartFitW, height: chartH, flexShrink: 0 } : undefined}
              >
                <ReportChart height={chartH} mobileWidth={chartFitW} isNarrow={isNarrow}>
                  {(w, h) => (
                    <BarChart
                      {...(w ? { width: w, height: h } : {})}
                      data={trendData}
                      margin={isNarrow ? { top: 8, right: 8, left: 4, bottom: trendData.length > 5 ? 46 : 8 } : undefined}
                      barCategoryGap={isNarrow && trendData.length > 10 ? '10%' : undefined}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={REPORTS_CHART_GRID} />
                      <XAxis
                        dataKey="label"
                        tick={isNarrow && trendData.length > 8 ? { fill: '#9ca3af', fontSize: 8 } : REPORTS_AXIS_TICK}
                        tickLine={false}
                        axisLine={false}
                        interval={isNarrow ? 0 : 'preserveStartEnd'}
                        angle={isNarrow && trendData.length > 5 ? -40 : 0}
                        textAnchor={isNarrow && trendData.length > 5 ? 'end' : 'middle'}
                        height={isNarrow && trendData.length > 5 ? 52 : 30}
                      />
                      <YAxis tick={REPORTS_AXIS_TICK} tickLine={false} axisLine={false} width={isNarrow ? 40 : undefined} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="units" name="Units" fill={REPORTS_BAR_TREND} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  )}
                </ReportChart>
              </div>
            </div>
          ) : (
            <div style={{ height: chartH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ro-text-muted)', fontSize: 13 }}>
              {hasSnapshots ? 'No data in selected range' : 'Import data multiple times to see trends'}
            </div>
          )}
        </div>

        {/* Week-over-Week Movement */}
        <div className="reports-chart-card">
          <div className="reports-chart-card__head">
            <h3 className="reports-chart-card__title">Week-over-week — Last 8 weeks</h3>
            {wowData.length > 0 && (
              <ExportBtn onClick={() => downloadTableCSV(
                ['Week', 'Units', 'Revenue', 'WoW %'],
                wowData.map((w) => [w.weekLabel, w.totalUnits, Number(w.totalRevenue || 0).toFixed(2), w.wowPct == null ? '' : w.wowPct.toFixed(1)]),
                'week-over-week.csv'
              )} />
            )}
          </div>
          {wowData.length > 0 ? (
            <>
              <div className="reports-chart-canvas">
                <div
                  className="reports-chart-canvas-inner"
                  style={isNarrow ? { width: chartFitW, height: chartH - 60, flexShrink: 0 } : undefined}
                >
                  <ReportChart height={chartH - 60} mobileWidth={chartFitW} isNarrow={isNarrow}>
                    {(w, h) => (
                      <BarChart {...(w ? { width: w, height: h } : {})} data={wowData} margin={isNarrow ? { top: 6, right: 8, left: 4, bottom: 46 } : undefined}>
                        <CartesianGrid strokeDasharray="3 3" stroke={REPORTS_CHART_GRID} />
                        <XAxis
                          dataKey="weekLabel"
                          tick={REPORTS_AXIS_TICK}
                          tickLine={false}
                          axisLine={false}
                          interval={0}
                          angle={isNarrow ? -40 : 0}
                          textAnchor={isNarrow ? 'end' : 'middle'}
                          height={isNarrow ? 52 : 30}
                        />
                        <YAxis tick={REPORTS_AXIS_TICK} tickLine={false} axisLine={false} width={isNarrow ? 40 : undefined} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="totalRevenue" name="Revenue" fill={REPORTS_BAR_WOW} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    )}
                  </ReportChart>
                </div>
              </div>
              <div className="rp-wow-list">
                {wowData.slice(-4).map((w) => (
                  <div key={w.week} className="rp-wow-row">
                    <span className="rp-wow-week">{w.weekLabel}</span>
                    <span className="rp-wow-units">{w.totalUnits} u</span>
                    <span className="rp-wow-rev">{fmt(Number(w.totalRevenue) || 0)}</span>
                    <span className={`rp-wow-delta${w.wowPct == null ? '' : w.wowPct >= 0 ? ' rp-wow-delta--up' : ' rp-wow-delta--down'}`}>
                      {w.wowPct == null ? '—' : `${w.wowPct >= 0 ? '+' : ''}${w.wowPct.toFixed(1)}%`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ height: chartH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ro-text-muted)', fontSize: 13 }}>
              No weekly sales yet — import reporting data to see momentum
            </div>
          )}
        </div>

        {/* Gender Split */}
        <div className="reports-chart-card">
          <div className="reports-chart-card__head">
            <h3 className="reports-chart-card__title">Gender split — share of sales</h3>
            <ExportBtn onClick={() => downloadTableCSV(
              ['Gender', 'Units', 'Unit %', 'Revenue', 'Revenue %'],
              genderData.map((d) => [
                d.name, d.value,
                totalUnits ? ((d.value / totalUnits) * 100).toFixed(1) : '0',
                d.revenue.toFixed(2),
                totalGenderRevenue ? ((d.revenue / totalGenderRevenue) * 100).toFixed(1) : '0',
              ]),
              'gender-split.csv'
            )} />
          </div>
          {genderData.length > 0 ? (
            <div
              className={`gs-split${isNarrow ? ' gs-split--narrow' : ''}`}
              style={isNarrow ? { width: '100%', minWidth: 0, maxWidth: '100%' } : undefined}
            >
              <div className={`gs-donut${isNarrow ? ' gs-donut--compact' : ''}`}>
                <ReportChart height={genderDonutH} mobileWidth={genderDonutW} isNarrow={isNarrow}>
                  {(w, h) => (
                    <PieChart {...(w ? { width: w, height: h } : {})}>
                      <Pie
                        data={genderData}
                        cx="50%"
                        cy="50%"
                        innerRadius={genderPieInner}
                        outerRadius={genderPieOuter}
                        dataKey="value"
                        nameKey="name"
                        paddingAngle={3}
                        stroke="none"
                        style={{ cursor: 'pointer', outline: 'none' }}
                        onClick={(entry) => setSelectedGender((g) => (g === entry?.name ? null : entry?.name))}
                      >
                        {genderData.map((d, i) => (
                          <Cell
                            key={i}
                            fill={genderSegmentColor(d.name, i)}
                            opacity={selectedGender && selectedGender !== d.name ? 0.4 : 1}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  )}
                </ReportChart>
                <div className="gs-donut-center" aria-hidden="true">
                  <div className="gs-donut-total">{fmt(totalGenderRevenue)}</div>
                  <div className="gs-donut-sub">Total sales</div>
                </div>
              </div>
              <div className="gs-rows">
                {genderData.map((d, i) => {
                  const color = genderSegmentColor(d.name, i)
                  const unitPct = totalUnits ? ((d.value / totalUnits) * 100).toFixed(1) : '0'
                  const revPct = totalGenderRevenue ? ((d.revenue / totalGenderRevenue) * 100).toFixed(1) : '0'
                  const isActive = selectedGender === d.name
                  return (
                    <div className="gs-row-group" key={d.name}>
                      <button
                        type="button"
                        className={`gs-row gs-row--clickable${isActive ? ' gs-row--active' : ''}`}
                        onClick={() => setSelectedGender((g) => (g === d.name ? null : d.name))}
                        aria-expanded={isActive}
                      >
                        <div className="gs-row-head">
                          <span className="gs-dot" style={{ background: color }} />
                          <span className="gs-name">{d.name}</span>
                          <span className="gs-revpct" style={{ color }}>{revPct}%</span>
                          <span className={`gs-chevron${isActive ? ' gs-chevron--open' : ''}`} aria-hidden="true">›</span>
                        </div>
                        <div className="gs-bar">
                          <div className="gs-bar-fill" style={{ width: `${Math.min(100, Number(revPct))}%`, background: color }} />
                        </div>
                        <div className="gs-row-meta">
                          <span>{d.value} units · {unitPct}%</span>
                          <span className="gs-rev">{fmt(d.revenue)}</span>
                        </div>
                      </button>
                      {isActive && (
                        <div className="gs-sub">
                          <div className="gs-sub-title">Category split — {d.name}</div>
                          {genderCategoryData.length > 0 ? genderCategoryData.map((c) => (
                            <div className="gs-sub-row" key={c.name}>
                              <div className="gs-sub-head">
                                <span className="gs-sub-name">{c.name}</span>
                                <span className="gs-sub-pct" style={{ color }}>{c.revPct.toFixed(1)}%</span>
                              </div>
                              <div className="gs-sub-bar">
                                <div className="gs-sub-bar-fill" style={{ width: `${Math.min(100, c.revPct)}%`, background: color }} />
                              </div>
                              <div className="gs-sub-meta">
                                <span>{c.units} units · {c.unitPct.toFixed(1)}%</span>
                                <span className="gs-rev">{fmt(c.revenue)}</span>
                              </div>
                            </div>
                          )) : (
                            <div className="gs-sub-empty">No category data for this group.</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div style={{ height: chartH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ro-text-muted)', fontSize: 13 }}>No data</div>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="reports-chart-card">
          <div className="reports-chart-card__head">
            <h3 className="reports-chart-card__title">Category breakdown</h3>
            <ExportBtn onClick={() => downloadTableCSV(
              ['Category', 'Units', 'Revenue'],
              categoryData.map((d) => [d.name, d.units, d.revenue.toFixed(2)]),
              'category-breakdown.csv'
            )} />
          </div>
          {categoryData.length > 0 ? (
            <div className="reports-chart-canvas">
              <div
                className="reports-chart-canvas-inner"
                style={isNarrow ? { width: chartFitW, height: categoryChartH, flexShrink: 0 } : undefined}
              >
                <ReportChart height={categoryChartH} mobileWidth={chartFitW} isNarrow={isNarrow}>
                  {(w, h) => (
                    <BarChart
                      {...(w ? { width: w, height: h } : {})}
                      data={categoryData}
                      layout="vertical"
                      margin={isNarrow ? { top: 4, right: 12, left: 4, bottom: 4 } : undefined}
                    >
                      <CartesianGrid strokeDasharray="0" stroke={REPORTS_CHART_GRID} />
                      <XAxis type="number" tick={REPORTS_AXIS_TICK} tickLine={false} axisLine={false} />
                      <YAxis
                        dataKey="name"
                        type="category"
                        tick={{ fill: '#374151', fontSize: isNarrow ? 10 : 12 }}
                        tickLine={false}
                        axisLine={false}
                        width={isNarrow ? 76 : 90}
                        tickFormatter={isNarrow ? (v) => (v.length > 11 ? `${v.slice(0, 10)}…` : v) : undefined}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="units" name="Units" fill={REPORTS_CATEGORY_BAR} barSize={categoryBarSize} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  )}
                </ReportChart>
              </div>
            </div>
          ) : (
            <div style={{ height: chartH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ro-text-muted)', fontSize: 13 }}>No data</div>
          )}
          {categoryData.length > 0 && (
            <div className="reports-data-table-wrap cb-table-wrap">
              <table className="cb-table">
                <thead>
                  <tr>
                    {['Category', 'Units', 'Revenue'].map((h) => (
                      <th key={h} className={`cb-table__th cb-table__th--${h.toLowerCase()}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {categoryData.map((d) => (
                    <tr key={d.name} className="cb-table__row">
                      <td className="cb-table__category">
                        <span className="cb-table__dot" style={{ background: categoryDisplayColor(d.name) }} aria-hidden />
                        {d.name}
                      </td>
                      <td className="cb-table__units">{d.units}</td>
                      <td className="cb-table__revenue">{fmt(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Product Type Mix */}
        <div className="reports-chart-card">
          <div className="reports-chart-card__head">
            <h3 className="reports-chart-card__title">Product type mix</h3>
            <ExportBtn onClick={() => downloadTableCSV(
              ['Type', 'Units', 'Revenue'],
              productTypeData.map((d) => [d.name, d.units, d.revenue.toFixed(2)]),
              'product-type-mix.csv'
            )} />
          </div>
          {productTypeData.length > 0 ? (
            <div className="reports-chart-canvas">
              <div
                className="reports-chart-canvas-inner"
                style={isNarrow ? { width: chartFitW, height: chartH, flexShrink: 0 } : undefined}
              >
                <ReportChart height={chartH} mobileWidth={chartFitW} isNarrow={isNarrow}>
                  {(w, h) => (
                    <BarChart
                      {...(w ? { width: w, height: h } : {})}
                      data={productTypeData}
                      margin={{ top: 10, right: 12, left: 6, bottom: isNarrow ? 46 : 20 }}
                    >
                      <CartesianGrid strokeDasharray="0" stroke={REPORTS_CHART_GRID} />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: '#9ca3af', fontSize: isNarrow ? 10 : 11 }}
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        angle={isNarrow ? -35 : -30}
                        textAnchor="end"
                        height={isNarrow ? 52 : 50}
                      />
                      <YAxis tick={REPORTS_AXIS_TICK} tickLine={false} axisLine={false} width={isNarrow ? 36 : undefined} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="units" name="Units" radius={[4, 4, 0, 0]}>
                        {productTypeData.map((d) => <Cell key={d.name} fill={categoryDisplayColor(d.name)} />)}
                      </Bar>
                    </BarChart>
                  )}
                </ReportChart>
              </div>
            </div>
          ) : (
            <div style={{ height: chartH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ro-text-muted)', fontSize: 13 }}>No data</div>
          )}
          {productTypeData.length > 0 && (
            <div className="reports-data-table-wrap cb-table-wrap">
              <table className="cb-table">
                <thead>
                  <tr>
                    {['Type', 'Units', 'Revenue'].map((h) => (
                      <th key={h} className={`cb-table__th cb-table__th--${h.toLowerCase()}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {productTypeData.map((d) => (
                    <tr key={d.name} className="cb-table__row">
                      <td className="cb-table__category">
                        <span className="cb-table__dot" style={{ background: categoryDisplayColor(d.name) }} aria-hidden />
                        {d.name}
                      </td>
                      <td className="cb-table__units">{d.units}</td>
                      <td className="cb-table__revenue">{fmt(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Fast & Slow Movers */}
      <div className="reports-chart-card reports-chart-card--spaced rp-movers-panel">
        <div className="reports-chart-card__head">
          <h3 className="reports-chart-card__title">Fast & slow movers</h3>
          {(moversFast.length > 0 || moversSlow.length > 0) && (
            <ExportBtn onClick={() => downloadTableCSV(
              ['List', 'SKU', 'Product', 'Brand', 'Category', 'Sold', 'Sell-Through %', 'Units/Day', 'Days In Store', 'Remaining', 'Net Revenue'],
              [
                ...moversFast.map((r) => ['Fast', r.sku, r.product_name, r.brand, r.category, r.net_units, r.sell_through, r.velocity, r.days_in_store, r.remaining, Number(r.net_revenue || 0).toFixed(2)]),
                ...moversSlow.map((r) => ['Slow', r.sku, r.product_name, r.brand, r.category, r.net_units, r.sell_through, r.velocity, r.days_in_store, r.remaining, Number(r.net_revenue || 0).toFixed(2)]),
              ],
              'fast-slow-movers.csv'
            )} />
          )}
        </div>
        <div className="rp-twin-grid rp-movers-grid">
          <div className="rp-movers-col">
            <div className="rp-subhead rp-subhead--good">Fast movers — highest velocity</div>
            <CompactTable columns={MOVER_COLUMNS_FAST} rows={moversFast} variant="movers-fast" isNarrow={isNarrow} empty="No sales in the selected range yet" />
          </div>
          <div className="rp-movers-col rp-movers-col--divider">
            <div className="rp-subhead rp-subhead--bad">Slow movers — stuck stock</div>
            <CompactTable columns={MOVER_COLUMNS_SLOW} rows={moversSlow} variant="movers-slow" isNarrow={isNarrow} empty="No slow stock found" />
          </div>
        </div>
      </div>

      {/* Profitability & ROI */}
      <div className="reports-chart-card reports-chart-card--spaced rp-profit-panel">
        <div className="reports-chart-card__head">
          <h3 className="reports-chart-card__title">Profitability & ROI — all time</h3>
          {profitRows.length > 0 && (
            <ExportBtn onClick={() => downloadTableCSV(
              ['SKU', 'Product', 'Brand', 'Category', 'Sold', 'Revenue', 'COGS', 'Profit', 'ROI %'],
              profitRows.map((r) => [
                r.sku, r.product_name, r.brand, r.category, r.sold,
                Number(r.totalRevenue || 0).toFixed(2), Number(r.cogs || 0).toFixed(2),
                Number(r.profit || 0).toFixed(2), Number(r.roi || 0).toFixed(1),
              ]),
              'profitability.csv'
            )} />
          )}
        </div>
        {profitTotals ? (
          <>
            <div className="rp-pl-strip">
              <div className="rp-pl-chip rp-pl-chip--revenue">
                <span className="rp-pl-label">Revenue</span>
                <span className="rp-pl-val">{fmt(profitTotals.totalRevenue)}</span>
              </div>
              <div className="rp-pl-chip rp-pl-chip--cogs">
                <span className="rp-pl-label">COGS</span>
                <span className="rp-pl-val">{fmt(profitTotals.cogs)}</span>
              </div>
              <div className="rp-pl-chip rp-pl-chip--profit">
                <span className="rp-pl-label">Profit</span>
                <span className={`rp-pl-val${profitTotals.totalProfit < 0 ? ' rp-pl-val--negative' : ''}`}>
                  {fmtSigned(profitTotals.totalProfit)}
                </span>
              </div>
              <div className="rp-pl-chip rp-pl-chip--margin">
                <span className="rp-pl-label">Margin</span>
                <span className="rp-pl-val">{pct(grossMarginPct)}</span>
              </div>
              <div className="rp-pl-chip rp-pl-chip--roi">
                <span className="rp-pl-label">Avg ROI</span>
                <span className={`rp-pl-val${profitTotals.avgRoi < 0 ? ' rp-pl-val--negative' : ''}`}>
                  {pct(profitTotals.avgRoi)}
                </span>
              </div>
            </div>
            <div className="rp-twin-grid rp-profit-twin-grid">
              <div className="rp-profit-col">
                <div className="rp-subhead rp-subhead--profit-top">Top profit products</div>
                <CompactTable columns={PROFIT_COLUMNS_TOP} rows={topProfitRows} variant="profit-top" isNarrow={isNarrow} empty="No profit data yet" />
              </div>
              <div className="rp-profit-col rp-profit-col--divider">
                <div className="rp-subhead rp-subhead--profit-low">Lowest margin %</div>
                <div className="rp-subhead-note">Weakest profit-to-revenue ratio · min €50 revenue</div>
                <CompactTable columns={PROFIT_COLUMNS_LOW_MARGIN} rows={lowMarginRows} variant="profit-low-margin" isNarrow={isNarrow} empty="No products with €50+ revenue yet" />
              </div>
            </div>
            <div className="rp-profit-by-toggle">
              <span className="rp-profit-by-toggle__label">Profit by</span>
              {['brand', 'category'].map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`rp-profit-toggle-chip${profitGroupKey === k ? ' rp-profit-toggle-chip--active' : ''}`}
                  onClick={() => setProfitGroupKey(k)}
                >
                  {k === 'brand' ? 'Brand' : 'Category'}
                </button>
              ))}
            </div>
            <CompactTable columns={PROFIT_GROUP_COLUMNS} rows={profitGroups} variant="profit-group" isNarrow={isNarrow} empty="No rollup data yet" />
          </>
        ) : (
          <div className="reports-empty-state">Profit data not loaded yet — needs cost prices from intake imports.</div>
        )}
      </div>

      {/* Brand & Category Productivity */}
      <div className="reports-chart-card reports-chart-card--spaced reports-chart-card--last">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={SECTION_TITLE}>Brand & Category Productivity</div>
          {productivityRows.length > 0 && (
            <ExportBtn onClick={() => downloadTableCSV(
              [prodView === 'brand' ? 'Brand' : 'Category', 'Net Units', 'Net Revenue', 'Revenue Share %', 'Stock Share %', 'Sell-Through %', 'Return Rate %', 'Score', 'Action'],
              productivityRows.map((r) => [
                r[prodView === 'brand' ? 'brand' : 'category'], r.net_units, Number(r.net_revenue || 0).toFixed(2),
                r.revenue_share, r.stock_share, r.sell_through, r.return_rate, r.score, r.recommended_action,
              ]),
              `${prodView}-productivity.csv`
            )} />
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {['brand', 'category'].map((k) => (
            <button key={k} type="button" onClick={() => setProdView(k)}
              style={prodView === k ? PILL_ACTIVE('#38bdf8') : PILL_INACTIVE}
            >{k === 'brand' ? 'By Brand' : 'By Category'}</button>
          ))}
        </div>
        <CompactTable
          columns={productivityColumns(prodView === 'brand' ? 'brand' : 'category')}
          rows={productivityRows}
          compact
          variant="productivity"
          isNarrow={isNarrow}
          empty={executiveReports.loading ? 'Loading productivity data…' : 'No productivity rows in this range yet'}
        />
        <div className="rp-share-legend">
          <span><i className="rp-dot rp-dot--rev" /> Revenue share</span>
          <span><i className="rp-dot rp-dot--stock" /> Stock share</span>
          <span className="rp-share-hint">Revenue share above stock share = under-bought · below = over-bought</span>
        </div>
        <div className="rp-score-legend">
          <span><i className="rp-dot rp-dot--score-high" /> ≥60 — increase buy depth</span>
          <span><i className="rp-dot rp-dot--score-mid" /> 40–59 — maintain selective reorder</span>
          <span><i className="rp-dot rp-dot--score-watch" /> 20–39 — monitor</span>
          <span><i className="rp-dot rp-dot--score-low" /> &lt;20 — cut reorder</span>
          <span className="rp-score-hint">{SCORE_SCALE_HINT}</span>
        </div>
      </div>

    </div>
  )
}
