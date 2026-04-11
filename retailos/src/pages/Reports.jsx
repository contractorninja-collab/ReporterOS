import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { isExecutive } from '../utils/roles'
import { getLifecycleStatus, getDaysInStore, getSellThrough } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import { computeSalesInPeriod, groupSalesByInterval, pickInterval, computeRevenueInPeriod } from '../utils/salesSnapshots'
import KpiCard from '../components/KpiCard'
import { IconLock, IconPrint } from '../utils/icons.js'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts'

const COLORS = ['#38bdf8', '#f472b6', '#fbbf24', '#00e676', '#c084fc', '#ff3333', '#ff8800', '#6366f1', '#34d399', '#f97316']
const CHART_CARD = {
  background: '#111117',
  border: '1px solid rgba(255,255,255,0.055)',
  borderRadius: 14,
  padding: '18px 20px',
}
const TABLE_HEADER = {
  textAlign: 'left', padding: '6px 10px', fontSize: 9, fontWeight: 700,
  color: '#4a4a62', textTransform: 'uppercase', letterSpacing: '0.8px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
}
const TABLE_CELL = { padding: '6px 10px', fontSize: 12, color: '#e4e4f0' }
const TABLE_CELL_DIM = { ...TABLE_CELL, color: '#9090aa', fontSize: 11 }
const PILL_ACTIVE = (color) => ({
  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', border: 'none', fontFamily: '"DM Sans"',
  background: `${color}18`, color,
})
const PILL_INACTIVE = {
  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', border: '1px solid rgba(255,255,255,0.06)',
  background: 'transparent', color: '#4a4a62', fontFamily: '"DM Sans"',
}
const SECTION_TITLE = {
  fontSize: 11, fontWeight: 700, color: '#9090aa', textTransform: 'uppercase',
  letterSpacing: '1.2px', marginBottom: 14,
}
const CUSTOM_TOOLTIP = {
  background: '#1a1a24', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#e4e4f0',
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
    <button type="button" onClick={onClick} style={{
      padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
      cursor: 'pointer', border: '1px solid rgba(255,255,255,0.06)',
      background: 'transparent', color: '#4a4a62', fontFamily: '"DM Sans"',
    }}>{label}</button>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={CUSTOM_TOOLTIP}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#9090aa', fontSize: 11 }}>
          {p.name}: {typeof p.value === 'number' && p.name?.includes('Revenue') ? fmt(p.value) : p.value}
        </div>
      ))}
    </div>
  )
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

function normalizeGender(g) {
  const x = (g || '').toUpperCase().trim().slice(0, 1)
  if (x === 'F') return 'Women'
  if (x === 'K') return 'Kids'
  return 'Men'
}

export function Reports() {
  const skus = useStore((s) => s.skus)
  const activeUser = useStore((s) => s.activeUser)
  const snapshots = useStore((s) => s.salesSnapshots)
  const activeSeason = useStore((s) => s.activeSeason)

  const products = useMemo(() => aggregateSkus(skus), [skus])
  const hasSnapshots = snapshots.length > 0

  const presets = useMemo(() => getDatePresets(), [])
  const [rangeKey, setRangeKey] = useState('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

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

  // --- Core data computation ---
  const salesData = useMemo(() => {
    if (hasSnapshots) {
      const snapshotResult = computeSalesInPeriod(snapshots, startDate, endDate)
      if (snapshotResult.length > 0) return snapshotResult
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
  }, [hasSnapshots, snapshots, startDate, endDate, products, rangeKey])

  const trendData = useMemo(() => {
    if (!hasSnapshots) return []
    const interval = pickInterval(startDate, endDate)
    return groupSalesByInterval(snapshots, startDate, endDate, interval)
  }, [hasSnapshots, snapshots, startDate, endDate])

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
      const g = normalizeGender(r.gender)
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

  // --- Product type breakdown (from product name keywords) ---
  const productTypeData = useMemo(() => {
    const map = {}
    for (const r of salesData) {
      const name = (r.productName || r.category || 'Other').toLowerCase()
      let type = r.category || 'Other'
      const keywords = [
        ['shoe', 'Shoes'], ['sneaker', 'Shoes'], ['boot', 'Boots'], ['sandal', 'Sandals'],
        ['tee', 'T-Shirts'], ['t-shirt', 'T-Shirts'], ['shirt', 'Shirts'],
        ['short', 'Shorts'], ['jogger', 'Joggers'], ['pant', 'Pants'], ['trouser', 'Pants'],
        ['hoodie', 'Hoodies'], ['sweatshirt', 'Sweatshirts'], ['jacket', 'Jackets'],
        ['cap', 'Caps'], ['hat', 'Caps'], ['bag', 'Bags'], ['sock', 'Socks'],
        ['dress', 'Dresses'], ['skirt', 'Skirts'],
      ]
      for (const [kw, label] of keywords) {
        if (name.includes(kw)) { type = label; break }
      }
      if (!map[type]) map[type] = { units: 0, revenue: 0 }
      map[type].units += r.delta
      map[type].revenue += r.revenue
    }
    return Object.entries(map).map(([name, d]) => ({ name, units: d.units, revenue: d.revenue })).sort((a, b) => b.units - a.units).slice(0, 10)
  }, [salesData])

  // --- ABC Analysis ---
  const abcData = useMemo(() => {
    const sorted = [...salesData].sort((a, b) => b.revenue - a.revenue)
    const totalRev = sorted.reduce((s, r) => s + r.revenue, 0)
    if (totalRev === 0) return []
    let cumulative = 0
    return sorted.map((r) => {
      cumulative += r.revenue
      const cumPct = (cumulative / totalRev) * 100
      let tier = 'C'
      if (cumPct <= 80) tier = 'A'
      else if (cumPct <= 95) tier = 'B'
      return { ...r, tier, pct: ((r.revenue / totalRev) * 100).toFixed(1), cumPct: cumPct.toFixed(1) }
    })
  }, [salesData])

  // --- Sell-through velocity ---
  const velocityData = useMemo(() => {
    return products
      .map((p) => {
        const days = Math.max(1, getDaysInStore(p.import_date))
        const st = getSellThrough(p.sold_quantity, p.quantity)
        const velocity = p.sold_quantity / days
        return {
          sku: p.sku,
          name: p.product_name,
          category: p.category || 'Other',
          days,
          sold: p.sold_quantity,
          qty: p.quantity,
          sellThrough: Math.round(st),
          velocity: +velocity.toFixed(2),
          status: getLifecycleStatus(p.import_date, p.sold_quantity, p.quantity),
        }
      })
      .sort((a, b) => b.velocity - a.velocity)
  }, [products])

  // --- Size curve analysis ---
  const sizeCurveData = useMemo(() => {
    const catMap = {}
    for (const row of skus) {
      const cat = (row.category || 'Other').trim()
      const size = (row.size || '').trim()
      if (!size) continue
      if (!catMap[cat]) catMap[cat] = {}
      if (!catMap[cat][size]) catMap[cat][size] = { qty: 0, sold: 0 }
      catMap[cat][size].qty += Number(row.quantity) || 0
      catMap[cat][size].sold += Number(row.sold_quantity) || 0
    }
    const result = []
    for (const [cat, sizes] of Object.entries(catMap)) {
      const sizeEntries = Object.entries(sizes).map(([size, d]) => ({
        size, stocked: d.qty, sold: d.sold,
        st: d.qty > 0 ? Math.round((d.sold / d.qty) * 100) : 0,
      }))
      result.push({ category: cat, sizes: sizeEntries })
    }
    return result
  }, [skus])

  const [activeSizeCategory, setActiveSizeCategory] = useState(null)
  const visibleSizeCurve = sizeCurveData.find((c) => c.category === activeSizeCategory) || sizeCurveData[0]

  const rangeLabel = rangeKey === 'all' ? 'All Time'
    : rangeKey === 'custom' ? `${customStart} — ${customEnd}`
    : rangeKey.charAt(0).toUpperCase() + rangeKey.slice(1)

  // --- Print handler ---
  const handlePrint = () => { window.print() }

  if (!isExecutive(activeUser)) {
    return (
      <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}><IconLock size={48} strokeWidth={1.5} /></div>
        <h2 style={{ fontFamily: '"DM Sans"', fontSize: 22, letterSpacing: '2px', color: '#fff', margin: '0 0 8px' }}>EXECUTIVE ACCESS ONLY</h2>
        <p style={{ fontSize: 13, color: '#4a4a62' }}>Reports are only available to Executive users.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontFamily: '"DM Sans"', fontSize: 16, letterSpacing: '2px', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#c084fc', animation: 'blink 2s infinite' }} />
          REPORTS & ANALYTICS
        </div>
        <button type="button" onClick={handlePrint} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
          borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
          border: '1px solid rgba(255,255,255,0.055)', background: '#17171f',
          color: '#9090aa', fontFamily: '"DM Sans"',
        }}>
          <IconPrint size={12} strokeWidth={1.5} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Print Report
        </button>
      </div>

      {/* Date range toolbar */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        {[
          { key: 'today', label: 'Today' },
          { key: 'week', label: 'This Week' },
          { key: 'month', label: 'This Month' },
          { key: 'quarter', label: 'This Quarter' },
          { key: 'all', label: 'All Time' },
          { key: 'custom', label: 'Custom' },
        ].map((p) => (
          <button key={p.key} type="button" onClick={() => setRangeKey(p.key)}
            style={rangeKey === p.key ? PILL_ACTIVE('#c084fc') : PILL_INACTIVE}
          >{p.label}</button>
        ))}
        {rangeKey === 'custom' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 4 }}>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '5px 8px', color: '#e4e4f0', fontSize: 12, fontFamily: '"DM Sans"', outline: 'none' }} />
            <span style={{ color: '#4a4a62', fontSize: 12 }}>to</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              style={{ background: '#111117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '5px 8px', color: '#e4e4f0', fontSize: 12, fontFamily: '"DM Sans"', outline: 'none' }} />
          </div>
        )}
      </div>

      {!hasSnapshots && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)', fontSize: 12, color: '#fbbf24', marginBottom: 18 }}>
          No sales snapshots yet. Import data to start tracking period-based sales. Showing cumulative data filtered by arrival date.
        </div>
      )}

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}>
        <KpiCard label="Revenue" value={fmt(totalRevenue)} sub={rangeLabel} accentColor="#00e676"
          tag={`${salesData.length} products`} tagBg="rgba(0,230,118,0.1)" tagColor="#00e676" />
        <KpiCard label="Units Sold" value={totalUnits} sub="All categories" accentColor="#38bdf8"
          tag={`${avgSellThrough}% avg sell-through`} tagBg="rgba(56,189,248,0.1)" tagColor="#38bdf8" />
        <KpiCard label="Avg Sell-Through" value={`${avgSellThrough}%`} sub="Active products" accentColor="#fbbf24" />
        <KpiCard label="Top Category" value={topCategory} sub="By revenue" accentColor="#f472b6" />
      </div>

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 22 }}>

        {/* Sales Trend */}
        <div style={CHART_CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={SECTION_TITLE}>Sales Trend</div>
            {trendData.length > 0 && (
              <ExportBtn onClick={() => downloadTableCSV(
                ['Period', 'Units', 'Revenue'],
                trendData.map((d) => [d.label, d.units, d.revenue.toFixed(2)]),
                'sales-trend.csv'
              )} />
            )}
          </div>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" tick={{ fill: '#4a4a62', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#4a4a62', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="units" name="Units" fill="#38bdf8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a4a62', fontSize: 13 }}>
              {hasSnapshots ? 'No data in selected range' : 'Import data multiple times to see trends'}
            </div>
          )}
        </div>

        {/* Gender Split */}
        <div style={CHART_CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={SECTION_TITLE}>Gender Split — Share of Sales</div>
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
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={genderData} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                  dataKey="value" nameKey="name" paddingAngle={3}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {genderData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a4a62', fontSize: 13 }}>No data</div>
          )}
          {genderData.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Gender', 'Units', 'Unit %', 'Revenue', 'Revenue %'].map((h) => <th key={h} style={TABLE_HEADER}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {genderData.map((d, i) => {
                    const unitPct = totalUnits ? ((d.value / totalUnits) * 100).toFixed(1) : '0'
                    const revPct = totalGenderRevenue ? ((d.revenue / totalGenderRevenue) * 100).toFixed(1) : '0'
                    return (
                      <tr key={d.name}>
                        <td style={TABLE_CELL}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], display: 'inline-block', flexShrink: 0 }} />
                            {d.name}
                          </span>
                        </td>
                        <td style={TABLE_CELL}>{d.value}</td>
                        <td style={TABLE_CELL_DIM}>{unitPct}%</td>
                        <td style={TABLE_CELL}>{fmt(d.revenue)}</td>
                        <td style={{ ...TABLE_CELL, fontWeight: 600, color: COLORS[i % COLORS.length] }}>{revPct}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Category Breakdown */}
        <div style={CHART_CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={SECTION_TITLE}>Category Breakdown</div>
            <ExportBtn onClick={() => downloadTableCSV(
              ['Category', 'Units', 'Revenue'],
              categoryData.map((d) => [d.name, d.units, d.revenue.toFixed(2)]),
              'category-breakdown.csv'
            )} />
          </div>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={categoryData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis type="number" tick={{ fill: '#4a4a62', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#9090aa', fontSize: 11 }} tickLine={false} axisLine={false} width={90} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="units" name="Units" fill="#00e676" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a4a62', fontSize: 13 }}>No data</div>
          )}
          {categoryData.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Category', 'Units', 'Revenue'].map((h) => <th key={h} style={TABLE_HEADER}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {categoryData.map((d) => (
                    <tr key={d.name}>
                      <td style={TABLE_CELL}>{d.name}</td>
                      <td style={TABLE_CELL}>{d.units}</td>
                      <td style={TABLE_CELL_DIM}>{fmt(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Product Type Mix */}
        <div style={CHART_CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={SECTION_TITLE}>Product Type Mix</div>
            <ExportBtn onClick={() => downloadTableCSV(
              ['Type', 'Units', 'Revenue'],
              productTypeData.map((d) => [d.name, d.units, d.revenue.toFixed(2)]),
              'product-type-mix.csv'
            )} />
          </div>
          {productTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={productTypeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" tick={{ fill: '#4a4a62', fontSize: 9 }} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fill: '#4a4a62', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="units" name="Units" radius={[4, 4, 0, 0]}>
                  {productTypeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a4a62', fontSize: 13 }}>No data</div>
          )}
          {productTypeData.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Type', 'Units', 'Revenue'].map((h) => <th key={h} style={TABLE_HEADER}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {productTypeData.map((d) => (
                    <tr key={d.name}>
                      <td style={TABLE_CELL}>{d.name}</td>
                      <td style={TABLE_CELL}>{d.units}</td>
                      <td style={TABLE_CELL_DIM}>{fmt(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Advanced Analytics */}
      <div style={{ ...SECTION_TITLE, fontSize: 14, marginTop: 8, marginBottom: 18 }}>ADVANCED ANALYTICS</div>

      {/* ABC Analysis */}
      <div style={{ ...CHART_CARD, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={SECTION_TITLE}>ABC Analysis — Revenue Contribution</div>
          {abcData.length > 0 && (
            <ExportBtn onClick={() => downloadTableCSV(
              ['Tier', 'SKU', 'Product', 'Revenue', '% of Total', 'Cumulative %'],
              abcData.map((d) => [d.tier, d.skuCode, d.productName, d.revenue.toFixed(2), d.pct, d.cumPct]),
              'abc-analysis.csv'
            )} />
          )}
        </div>
        {abcData.length > 0 ? (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              {['A', 'B', 'C'].map((tier) => {
                const items = abcData.filter((d) => d.tier === tier)
                const rev = items.reduce((s, r) => s + r.revenue, 0)
                const color = tier === 'A' ? '#00e676' : tier === 'B' ? '#fbbf24' : '#ff3333'
                return (
                  <div key={tier} style={{ flex: 1, background: `${color}0a`, border: `1px solid ${color}22`, borderRadius: 10, padding: '10px 14px' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: '"DM Sans"' }}>
                      {tier} <span style={{ fontSize: 11, fontWeight: 500, color: '#9090aa' }}>({items.length} SKUs)</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#9090aa', marginTop: 2 }}>
                      {fmt(rev)} — {totalRevenue > 0 ? ((rev / totalRevenue) * 100).toFixed(1) : 0}% of revenue
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Tier', 'SKU', 'Product', 'Revenue', '%', 'Cum %'].map((h) => <th key={h} style={{ ...TABLE_HEADER, position: 'sticky', top: 0, background: '#111117' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {abcData.slice(0, 30).map((d) => {
                    const color = d.tier === 'A' ? '#00e676' : d.tier === 'B' ? '#fbbf24' : '#ff3333'
                    return (
                      <tr key={d.skuCode}>
                        <td style={TABLE_CELL}><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${color}18`, color }}>{d.tier}</span></td>
                        <td style={TABLE_CELL_DIM}>{d.skuCode}</td>
                        <td style={{ ...TABLE_CELL, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.productName}</td>
                        <td style={TABLE_CELL}>{fmt(d.revenue)}</td>
                        <td style={TABLE_CELL_DIM}>{d.pct}%</td>
                        <td style={TABLE_CELL_DIM}>{d.cumPct}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div style={{ padding: 32, textAlign: 'center', color: '#4a4a62', fontSize: 13 }}>No sales data to analyze</div>
        )}
      </div>

      {/* Sell-through Velocity */}
      <div style={{ ...CHART_CARD, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={SECTION_TITLE}>Sell-Through Velocity — Units/Day</div>
          {velocityData.length > 0 && (
            <ExportBtn onClick={() => downloadTableCSV(
              ['SKU', 'Product', 'Category', 'Days', 'Sold', 'Qty', 'Sell-Through %', 'Velocity', 'Status'],
              velocityData.map((d) => [d.sku, d.name, d.category, d.days, d.sold, d.qty, d.sellThrough, d.velocity, d.status]),
              'velocity.csv'
            )} />
          )}
        </div>
        {velocityData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={velocityData.slice(0, 15)}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="sku" tick={{ fill: '#4a4a62', fontSize: 8 }} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fill: '#4a4a62', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="velocity" name="Units/Day" fill="#c084fc" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 12, marginTop: 14, marginBottom: 10 }}>
              <div style={{ flex: 1, background: 'rgba(0,230,118,0.06)', border: '1px solid rgba(0,230,118,0.15)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#00e676', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Fast Movers</div>
                {velocityData.slice(0, 3).map((d) => (
                  <div key={d.sku} style={{ fontSize: 11, color: '#e4e4f0', marginBottom: 2 }}>
                    {d.name} — <span style={{ color: '#00e676' }}>{d.velocity} u/day</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, background: 'rgba(255,51,51,0.06)', border: '1px solid rgba(255,51,51,0.15)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#ff3333', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Slow Movers</div>
                {velocityData.slice(-3).reverse().map((d) => (
                  <div key={d.sku} style={{ fontSize: 11, color: '#e4e4f0', marginBottom: 2 }}>
                    {d.name} — <span style={{ color: '#ff3333' }}>{d.velocity} u/day</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div style={{ padding: 32, textAlign: 'center', color: '#4a4a62', fontSize: 13 }}>No products to analyze</div>
        )}
      </div>

      {/* Size Curve Analysis */}
      <div style={{ ...CHART_CARD, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={SECTION_TITLE}>Size Curve Analysis</div>
          {visibleSizeCurve && (
            <ExportBtn onClick={() => downloadTableCSV(
              ['Category', 'Size', 'Stocked', 'Sold', 'Sell-Through %'],
              visibleSizeCurve.sizes.map((s) => [visibleSizeCurve.category, s.size, s.stocked, s.sold, s.st]),
              'size-curve.csv'
            )} />
          )}
        </div>
        {sizeCurveData.length > 0 ? (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {sizeCurveData.map((c) => (
                <button key={c.category} type="button" onClick={() => setActiveSizeCategory(c.category)}
                  style={(activeSizeCategory || sizeCurveData[0]?.category) === c.category ? PILL_ACTIVE('#38bdf8') : PILL_INACTIVE}
                >{c.category}</button>
              ))}
            </div>
            {visibleSizeCurve && (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={visibleSizeCurve.sizes}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="size" tick={{ fill: '#9090aa', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: '#4a4a62', fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="stocked" name="Stocked" fill="rgba(56,189,248,0.3)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="sold" name="Sold" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      {['Size', 'Stocked', 'Sold', 'Sell-Through'].map((h) => <th key={h} style={TABLE_HEADER}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {visibleSizeCurve.sizes.map((s) => (
                        <tr key={s.size}>
                          <td style={TABLE_CELL}>{s.size}</td>
                          <td style={TABLE_CELL}>{s.stocked}</td>
                          <td style={TABLE_CELL}>{s.sold}</td>
                          <td style={{
                            ...TABLE_CELL,
                            color: s.st >= 60 ? '#00e676' : s.st >= 30 ? '#fbbf24' : '#ff3333',
                            fontWeight: 600,
                          }}>{s.st}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ padding: 32, textAlign: 'center', color: '#4a4a62', fontSize: 13 }}>No size data available</div>
        )}
      </div>
    </div>
  )
}
