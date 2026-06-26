import { useMemo, useState } from 'react'
import useStore from '../store/useStore'
import { isExecutive } from '../utils/roles'
import { analyzeSeason, getDistinctSeasons } from '../utils/buyPlanAnalyzer'
import KpiCard from '../components/KpiCard'
import { IconLock, IconPrint } from '../utils/icons.js'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

const DM = '"DM Sans", sans-serif'
const SECTION = {
  background: 'var(--ro-surface)',
  border: '1px solid var(--ro-border)',
  borderRadius: 14,
  padding: '18px 20px',
  marginBottom: 18,
}
const TH = {
  textAlign: 'left', padding: '8px 10px', fontSize: 9, fontWeight: 700,
  color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px',
  borderBottom: '1px solid var(--ro-border)',
}
const TD = { padding: '8px 10px', fontSize: 12, color: 'var(--ro-text)', borderBottom: '1px solid var(--ro-border)' }
const TD_DIM = { ...TD, color: 'var(--ro-text-dim)', fontSize: 11 }
const SECTION_TITLE = {
  fontSize: 11, fontWeight: 700, color: 'var(--ro-text-dim)', textTransform: 'uppercase',
  letterSpacing: '1.2px', marginBottom: 14, fontFamily: DM,
}
const PILL_ACTIVE = {
  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', border: 'none', fontFamily: DM,
  background: 'rgba(192,132,252,0.15)', color: '#c084fc',
}
const PILL_INACTIVE = {
  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', border: '1px solid var(--ro-border)',
  background: 'transparent', color: 'var(--ro-text-muted)', fontFamily: DM,
}
const TOOLTIP_STYLE = {
  background: 'var(--ro-surface-deep)', border: '1px solid var(--ro-border-hover)',
  borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--ro-text)',
}

const REC_BADGE = {
  Increase: { bg: 'rgba(0,230,118,0.12)', color: '#00e676' },
  Decrease: { bg: 'rgba(255,51,51,0.12)', color: '#ff3333' },
  Maintain: { bg: 'var(--ro-fill-muted)', color: 'var(--ro-text-dim)' },
  'Increase allocation': { bg: 'rgba(0,230,118,0.12)', color: '#00e676' },
  'Reduce allocation': { bg: 'rgba(255,51,51,0.12)', color: '#ff3333' },
  Balanced: { bg: 'var(--ro-fill-muted)', color: 'var(--ro-text-dim)' },
  Reduce: { bg: 'rgba(255,51,51,0.12)', color: '#ff3333' },
}

function Badge({ text }) {
  const style = REC_BADGE[text] || REC_BADGE.Maintain
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
      padding: '3px 8px', borderRadius: 4, background: style.bg, color: style.color,
    }}>
      {text}
    </span>
  )
}

function fmt(n) { return n >= 1000 ? `€${(n / 1000).toFixed(1)}K` : `€${Math.round(n)}` }

function downloadCSV(headers, rows, filename) {
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
      cursor: 'pointer', border: '1px solid var(--ro-border)',
      background: 'transparent', color: 'var(--ro-text-muted)', fontFamily: DM,
    }}>{label}</button>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || 'var(--ro-text-dim)', fontSize: 11 }}>
          {p.name}: {p.value}{p.name?.includes('%') ? '%' : ''}
        </div>
      ))}
    </div>
  )
}

export function BuyPlanning() {
  const skus = useStore((s) => s.skus)
  const activeUser = useStore((s) => s.activeUser)
  const seasons = useMemo(() => getDistinctSeasons(skus), [skus])
  const [selectedSeason, setSelectedSeason] = useState(() => seasons[0] || '')
  const [activeSizeCategory, setActiveSizeCategory] = useState(null)
  const [showTop, setShowTop] = useState(true)
  const [showBottom, setShowBottom] = useState(true)

  const plan = useMemo(() => {
    if (!selectedSeason) return null
    return analyzeSeason(skus, selectedSeason)
  }, [skus, selectedSeason])

  if (!isExecutive(activeUser)) {
    return (
      <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}><IconLock size={48} strokeWidth={1.5} /></div>
        <h2 style={{ fontFamily: '"DM Sans"', fontSize: 22, letterSpacing: '2px', color: 'var(--ro-heading)', margin: '0 0 8px' }}>EXECUTIVE ACCESS ONLY</h2>
        <p style={{ fontSize: 13, color: 'var(--ro-text-muted)' }}>Buy Planning is only available to Executive users.</p>
      </div>
    )
  }

  if (!seasons.length) {
    return (
      <div style={{ maxWidth: 900 }}>
        <div style={SECTION}>
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--ro-text-muted)', fontSize: 14 }}>
            No season data available. Import CSV data with a season column to use the Buy Planning assistant.
          </div>
        </div>
      </div>
    )
  }

  const exportFullPlan = () => {
    if (!plan) return
    const headers = ['Section', 'Detail', 'Value', 'Recommendation']
    const rows = []
    rows.push(['Overall', 'SKUs', plan.overall.skuCount, ''])
    rows.push(['Overall', 'Stocked', plan.overall.totalStocked, ''])
    rows.push(['Overall', 'Sold', plan.overall.totalSold, ''])
    rows.push(['Overall', 'Sell-through', `${plan.overall.sellThrough}%`, ''])
    rows.push(['Overall', 'Revenue', `€${plan.overall.revenue}`, ''])
    for (const c of plan.categories) {
      rows.push(['Category', c.name, `ST ${c.sellThrough}% | Rev ${fmt(c.revenue)}`, `${c.recommendation} ${c.pctChange ? c.pctChange + '%' : ''}`])
    }
    for (const g of plan.genderMix) {
      rows.push(['Gender', `${g.category} - ${g.gender}`, `Stock ${g.stockShare}% / Sales ${g.salesShare}%`, g.recommendation])
    }
    for (const s of plan.sizeCurve) {
      rows.push(['Size Curve', s.category, '', s.suggestion])
    }
    for (const t of plan.topPerformers) {
      rows.push(['Top Performer', `${t.sku} - ${t.name}`, `ST ${t.sellThrough}%`, 'Increase depth'])
    }
    for (const b of plan.bottomPerformers) {
      rows.push(['Bottom Performer', `${b.sku} - ${b.name}`, `ST ${b.sellThrough}%`, 'Reduce / Drop'])
    }
    for (const br of plan.brands) {
      rows.push(['Brand', br.brand, `ST ${br.sellThrough}% | Rev share ${br.revenueShare}%`, br.recommendation])
    }
    downloadCSV(headers, rows, `buy-plan-${plan.nextSeason}.csv`)
  }

  const visibleSizeCurve = plan?.sizeCurve?.find((c) => c.category === activeSizeCategory) || plan?.sizeCurve?.[0]

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div className="page-hero-mobile-hide" style={{ fontFamily: DM, fontSize: 16, letterSpacing: '2px', color: 'var(--ro-heading)', display: 'flex', alignItems: 'center', gap: 8 }}>
          BUY PLANNING ASSISTANT
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportBtn onClick={exportFullPlan} label="Export full plan" />
          <button type="button" onClick={() => window.print()} style={{
            padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
            cursor: 'pointer', border: '1px solid var(--ro-border)',
            background: 'transparent', color: 'var(--ro-text-muted)', fontFamily: DM,
          }}><IconPrint size={12} strokeWidth={1.5} style={{ verticalAlign: 'middle', marginRight: 4 }} />Print</button>
        </div>
      </div>

      {/* Season selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--ro-text-muted)', fontFamily: DM }}>Analyse season:</span>
        {seasons.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setSelectedSeason(s); setActiveSizeCategory(null) }}
            style={selectedSeason === s ? PILL_ACTIVE : PILL_INACTIVE}
          >
            {s}
          </button>
        ))}
        {plan && (
          <span style={{ fontSize: 12, color: '#c084fc', fontFamily: DM, marginLeft: 8 }}>
            Recommendations for <strong>{plan.nextSeason}</strong>
          </span>
        )}
      </div>

      {!plan && (
        <div style={SECTION}>
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--ro-text-muted)', fontSize: 14 }}>
            Select a season above to generate buy recommendations.
          </div>
        </div>
      )}

      {plan && (
        <>
          {/* KPI summary */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 18,
          }}>
            <KpiCard
              label="Sell-through"
              value={`${plan.overall.sellThrough}%`}
              sub={`${plan.overall.totalSold} of ${plan.overall.totalStocked} units`}
              accentColor="#c084fc"
            />
            <KpiCard
              label="Revenue"
              value={fmt(plan.overall.revenue)}
              sub={`${plan.overall.skuCount} SKUs analysed`}
              accentColor="#38bdf8"
            />
            <KpiCard
              label="Adjustments"
              value={plan.adjustmentCount}
              sub="Recommended changes"
              accentColor={plan.adjustmentCount > 5 ? '#ff8800' : '#00e676'}
              tag={plan.adjustmentCount > 5 ? 'Significant' : 'Moderate'}
              tagBg={plan.adjustmentCount > 5 ? 'rgba(255,136,0,0.12)' : 'rgba(0,230,118,0.12)'}
              tagColor={plan.adjustmentCount > 5 ? '#ff8800' : '#00e676'}
            />
            <KpiCard
              label="Next season"
              value={plan.nextSeason}
              sub={`Based on ${plan.season} data`}
              accentColor="#fbbf24"
            />
          </div>

          {/* Category recommendations */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>Category Recommendations</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    {['Category', 'Stocked', 'Sold', 'Sell-through', 'Revenue', 'ABC (A/B/C)', 'Action'].map((h) => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.categories.map((c) => (
                    <tr key={c.name}>
                      <td style={{ ...TD, fontWeight: 600 }}>{c.name}</td>
                      <td style={TD}>{c.stocked}</td>
                      <td style={TD}>{c.sold}</td>
                      <td style={TD}>{c.sellThrough}%</td>
                      <td style={TD}>{fmt(c.revenue)}</td>
                      <td style={TD_DIM}>{c.abcBreakdown.A}/{c.abcBreakdown.B}/{c.abcBreakdown.C}</td>
                      <td style={TD}>
                        <Badge text={c.recommendation} />
                        {c.pctChange !== 0 && (
                          <span style={{ fontSize: 10, color: c.pctChange > 0 ? '#00e676' : '#ff3333', marginLeft: 6 }}>
                            {c.pctChange > 0 ? '+' : ''}{c.pctChange}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {plan.categories.length === 0 && (
                    <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: 'var(--ro-text-muted)', padding: 24 }}>No category data.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Gender mix */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>Gender Mix Analysis</div>
            {plan.genderMix.length === 0 ? (
              <div style={{ color: 'var(--ro-text-muted)', fontSize: 13, padding: 16 }}>No gender data.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {plan.genderMix.map((g) => (
                  <div key={`${g.category}-${g.gender}`} style={{
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    padding: '10px 12px', borderRadius: 8, background: 'var(--ro-table-row-hover)',
                    border: g.recommendation !== 'Balanced' ? '1px solid var(--ro-border)' : '1px solid transparent',
                  }}>
                    <div style={{ minWidth: 140, fontSize: 12, fontWeight: 600, color: 'var(--ro-text)' }}>
                      {g.gender} — {g.category}
                    </div>
                    <div style={{ flex: 1, minWidth: 200, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ flex: 1, position: 'relative', height: 14, borderRadius: 4, overflow: 'hidden', background: 'var(--ro-fill-soft)' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, height: '50%', width: `${g.stockShare}%`, background: '#38bdf8', borderRadius: '4px 4px 0 0' }} />
                        <div style={{ position: 'absolute', bottom: 0, left: 0, height: '50%', width: `${g.salesShare}%`, background: '#c084fc', borderRadius: '0 0 4px 4px' }} />
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--ro-text-dim)', minWidth: 90, fontFamily: DM }}>
                        Stock {g.stockShare}% / Sales {g.salesShare}%
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ro-text-dim)', minWidth: 40 }}>{g.sellThrough}% ST</div>
                    <Badge text={g.recommendation} />
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 16, fontSize: 9, color: 'var(--ro-text-muted)', marginTop: 4 }}>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#38bdf8', marginRight: 4 }} />Stock share</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#c084fc', marginRight: 4 }} />Sales share</span>
                </div>
              </div>
            )}
          </div>

          {/* Size curve */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>Size Curve Recommendations</div>
            {plan.sizeCurve.length === 0 ? (
              <div style={{ color: 'var(--ro-text-muted)', fontSize: 13, padding: 16 }}>No size data.</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                  {plan.sizeCurve.map((c) => (
                    <button
                      key={c.category}
                      type="button"
                      onClick={() => setActiveSizeCategory(c.category)}
                      style={(activeSizeCategory || plan.sizeCurve[0]?.category) === c.category ? PILL_ACTIVE : PILL_INACTIVE}
                    >
                      {c.category}
                    </button>
                  ))}
                </div>
                {visibleSizeCurve && (
                  <>
                    <div style={{ height: 220, marginBottom: 12 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={visibleSizeCurve.sizes} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--ro-chart-grid)" vertical={false} />
                          <XAxis dataKey="size" tick={{ fontSize: 10, fill: 'var(--ro-text-dim)' }} axisLine={{ stroke: 'var(--ro-chart-axis)' }} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: 'var(--ro-text-dim)' }} axisLine={false} tickLine={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="stocked" name="Stocked" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="sold" name="Sold" fill="#c084fc" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ro-text)', marginBottom: 10 }}>
                      {visibleSizeCurve.suggestion}
                    </div>
                    {visibleSizeCurve.underStocked.length > 0 && (
                      <div style={{ fontSize: 11, color: '#00e676', marginBottom: 4 }}>
                        High demand (increase): {visibleSizeCurve.underStocked.map((s) => s.size).join(', ')}
                      </div>
                    )}
                    {visibleSizeCurve.overStocked.length > 0 && (
                      <div style={{ fontSize: 11, color: '#ff3333' }}>
                        Over-stocked (reduce): {visibleSizeCurve.overStocked.map((s) => s.size).join(', ')}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Top performers */}
          <div style={SECTION}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={SECTION_TITLE}>Top Performers — Increase Buy Depth</div>
              <button type="button" onClick={() => setShowTop(!showTop)} style={{
                fontSize: 10, color: 'var(--ro-text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: DM,
              }}>{showTop ? '▲ Collapse' : '▼ Expand'}</button>
            </div>
            {plan.topPerformers.length === 0 && (
              <div style={{ color: 'var(--ro-text-muted)', fontSize: 13, padding: 8 }}>No products with sell-through above 60%.</div>
            )}
            {showTop && plan.topPerformers.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead>
                    <tr>
                      {['SKU', 'Product', 'Category', 'Gender', 'Sell-through', 'Velocity', 'Action'].map((h) => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.topPerformers.map((p) => (
                      <tr key={p.sku}>
                        <td style={TD_DIM}>{p.sku}</td>
                        <td style={{ ...TD, fontWeight: 600 }}>{p.name}</td>
                        <td style={TD}>{p.category}</td>
                        <td style={TD}>{p.gender}</td>
                        <td style={TD}><span style={{ color: '#00e676' }}>{p.sellThrough}%</span></td>
                        <td style={TD}>{p.velocity} u/day</td>
                        <td style={TD}><Badge text="Increase" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Bottom performers */}
          <div style={SECTION}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={SECTION_TITLE}>Bottom Performers — Reduce or Drop</div>
              <button type="button" onClick={() => setShowBottom(!showBottom)} style={{
                fontSize: 10, color: 'var(--ro-text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: DM,
              }}>{showBottom ? '▲ Collapse' : '▼ Expand'}</button>
            </div>
            {plan.bottomPerformers.length === 0 && (
              <div style={{ color: 'var(--ro-text-muted)', fontSize: 13, padding: 8 }}>No underperforming products found (sell-through below 15%, 60+ days in store).</div>
            )}
            {showBottom && plan.bottomPerformers.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead>
                    <tr>
                      {['SKU', 'Product', 'Category', 'Gender', 'Sell-through', 'Days in store', 'Action'].map((h) => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.bottomPerformers.map((p) => (
                      <tr key={p.sku}>
                        <td style={TD_DIM}>{p.sku}</td>
                        <td style={{ ...TD, fontWeight: 600 }}>{p.name}</td>
                        <td style={TD}>{p.category}</td>
                        <td style={TD}>{p.gender}</td>
                        <td style={TD}><span style={{ color: '#ff3333' }}>{p.sellThrough}%</span></td>
                        <td style={TD}>{p.daysInStore}d</td>
                        <td style={TD}><Badge text="Reduce" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Brand scorecard */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>Brand Scorecard</div>
            {plan.brands.length === 0 ? (
              <div style={{ color: 'var(--ro-text-muted)', fontSize: 13, padding: 8 }}>No brand data.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                  <thead>
                    <tr>
                      {['Brand', 'SKUs', 'Sell-through', 'Revenue share', 'Action'].map((h) => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.brands.map((b) => (
                      <tr key={b.brand}>
                        <td style={{ ...TD, fontWeight: 600 }}>{b.brand}</td>
                        <td style={TD}>{b.skuCount}</td>
                        <td style={TD}>{b.sellThrough}%</td>
                        <td style={TD}>{b.revenueShare}%</td>
                        <td style={TD}><Badge text={b.recommendation} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
