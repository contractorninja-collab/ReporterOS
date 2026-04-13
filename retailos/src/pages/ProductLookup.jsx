import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import useStore from '../store/useStore'
import { isExecutive } from '../utils/roles'
import { aggregateSkus } from '../utils/aggregateSkus'
import { getLifecycleStatus, getDaysInStore, getReorderVerdict } from '../utils/lifecycle'
import * as api from '../api/client'
import ProductDetailModal from '../components/ProductDetailModal'
import { IconLock } from '../utils/icons.js'

const DM = '"DM Sans", sans-serif'

const GENDER_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'Men', label: 'Men' },
  { key: 'Women', label: 'Women' },
  { key: 'Kids', label: 'Kids' },
]

function genderBucket(g) {
  const x = String(g || '').toUpperCase().trim().slice(0, 1)
  if (x === 'F') return 'Women'
  if (x === 'K') return 'Kids'
  return 'Men'
}

const TH = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 9,
  fontWeight: 700,
  color: 'var(--ro-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  borderBottom: '1px solid var(--ro-border)',
  cursor: 'pointer',
  userSelect: 'none',
}
const TD = { padding: '8px 10px', fontSize: 12, color: 'var(--ro-text)', borderBottom: '1px solid var(--ro-border)' }

const TILES = [
  { status: 'New Arrival', color: '#38bdf8', colorBg: 'rgba(56,189,248,0.1)', icon: '•' },
  { status: 'Active', color: '#00e676', colorBg: 'rgba(0,230,118,0.1)', icon: '●' },
  { status: 'Aging', color: '#fbbf24', colorBg: 'rgba(251,191,36,0.1)', icon: '◐' },
  { status: 'Risk', color: '#ff8800', colorBg: 'rgba(255,136,0,0.1)', icon: '!' },
  { status: 'Clearance', color: '#ff3333', colorBg: 'rgba(255,51,51,0.1)', icon: '↓' },
  { status: 'Outlet', color: '#c084fc', colorBg: 'rgba(192,132,252,0.1)', icon: '◆' },
]

function buildClientReport(q, skus) {
  const needle = (q || '').trim().toLowerCase()
  const products = aggregateSkus(skus)
  const filtered = needle
    ? products.filter((p) => String(p.product_name || '').toLowerCase().includes(needle))
    : products

  const rows = filtered.map((p) => {
    const qty = Number(p.quantity) || 0
    const soldQty = Number(p.sold_quantity) || 0
    const cogs = p._salesCogs ?? (soldQty * (Number(p.cost_price) || 0))
    const totalRevenue = p._salesRevenue ?? (soldQty * (Number(p.price_sold) || 0))
    const investment = p._totalInvestment ?? (qty * (Number(p.cost_price) || 0))
    const profit = totalRevenue - cogs
    const roi = cogs > 0 ? (profit / cogs) * 100 : 0
    return {
      sku: p.sku,
      product_name: p.product_name,
      gender: p.gender,
      genderBucket: genderBucket(p.gender),
      stock: qty,
      remaining: Math.max(0, qty - soldQty),
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
  const emptyBucket = () => ({ stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0 })
  const byGender = { Men: emptyBucket(), Women: emptyBucket(), Kids: emptyBucket() }
  for (const row of rows) {
    stock += row.stock
    remaining += row.remaining
    sold += row.sold
    cogs += row.cogs
    totalRevenue += row.totalRevenue
    totalInvestment += row.totalInvestment
    const b = byGender[row.genderBucket] || byGender.Men
    b.stock += row.stock
    b.remaining += row.remaining
    b.sold += row.sold
    b.cogs += row.cogs
    b.totalRevenue += row.totalRevenue
    b.totalInvestment += row.totalInvestment
  }

  const totalProfit = totalRevenue - cogs
  const avgRoi = cogs > 0 ? (totalProfit / cogs) * 100 : 0

  return {
    query: q,
    rows,
    totals: { stock, remaining, sold, cogs, totalRevenue, totalProfit, avgRoi, totalInvestment },
    byGender,
    timeline: [],
    _clientOnly: true,
  }
}

export function ProductLookup() {
  const [searchParams, setSearchParams] = useSearchParams()
  const skus = useStore((s) => s.skus)
  const photoMap = useStore((s) => s.photoMap)
  const activeUser = useStore((s) => s.activeUser)

  const [tab, setTab] = useState(() => (searchParams.get('q') ? 'search' : 'all'))
  const [input, setInput] = useState(() => searchParams.get('q') || '')
  const [gender, setGender] = useState('all')
  const [report, setReport] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [sortKey, setSortKey] = useState('product_name')
  const [sortDir, setSortDir] = useState('asc')
  const [modalSku, setModalSku] = useState(null)

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
          Men: { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0 },
          Women: { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0 },
          Kids: { stock: 0, remaining: 0, sold: 0, cogs: 0, totalRevenue: 0, totalInvestment: 0 },
        },
        timeline: [],
      })
      return
    }
    try {
      const data = await api.fetchProductReport(qForApi)
      setReport(data)
    } catch (e) {
      setLoadError(e?.message || 'Offline or API unavailable')
      setReport(buildClientReport(qForApi, skus))
    }
  }, [shouldFetch, qForApi, skus])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const q = searchParams.get('q')
    if (q != null) setInput(q)
    if (q && String(q).trim()) setTab('search')
  }, [searchParams])

  const skuPhoto = useMemo(() => {
    const m = {}
    for (const s of skus) {
      if (s.sku && s.barcode && !m[s.sku] && photoMap[s.barcode]) {
        m[s.sku] = photoMap[s.barcode]
      }
    }
    return m
  }, [skus, photoMap])

  const filteredRows = useMemo(() => {
    if (!report?.rows) return []
    if (gender === 'all') return report.rows
    return report.rows.filter((r) => r.genderBucket === gender)
  }, [report, gender])

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

  const NUMERIC_COLS = new Set(['stock', 'remaining', 'sold', 'cogs', 'totalRevenue', 'avgTicket', 'profit', 'roi'])
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
    const agg = aggregateSkus(skus).find((p) => p.sku === row.sku)
    if (agg) setModalSku(agg)
  }

  const modalStatus = modalSku
    ? getLifecycleStatus(modalSku.import_date, modalSku.sold_quantity, modalSku.quantity)
    : 'Active'
  const tile = TILES.find((t) => t.status === modalStatus) || TILES[1]

  const filteredTotals = useMemo(() => {
    if (gender === 'all' || !report?.totals) return report?.totals
    const b = report.byGender?.[gender]
    if (!b) return report.totals
    const c = b.cogs ?? 0
    const tr = b.totalRevenue ?? 0
    const tp = tr - c
    return { stock: b.stock, remaining: b.remaining, sold: b.sold, cogs: c, totalRevenue: tr, totalProfit: tp, avgRoi: c > 0 ? (tp / c) * 100 : 0, totalInvestment: b.totalInvestment ?? 0 }
  }, [report, gender])

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
    <div style={{ maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontFamily: DM, fontSize: 16, letterSpacing: '2px', color: 'var(--ro-heading)' }}>PRODUCT LOOKUP</div>
        <Link to="/" style={{ fontSize: 12, color: '#38bdf8', fontFamily: DM }}>
          Dashboard
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'search', label: 'Search by name' },
          { key: 'all', label: 'All inventory' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key)
              if (t.key === 'all') setSearchParams({})
            }}
            style={{
              padding: '7px 16px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              border: tab === t.key ? '1px solid rgba(192,132,252,0.4)' : '1px solid var(--ro-border)',
              background: tab === t.key ? 'rgba(192,132,252,0.12)' : 'transparent',
              color: tab === t.key ? '#c084fc' : 'var(--ro-text-muted)',
              fontFamily: DM,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'search' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="e.g. BARREDA"
            style={{
              flex: '1 1 220px',
              maxWidth: 360,
              background: 'var(--ro-surface)',
              border: '1px solid var(--ro-border-hover)',
              borderRadius: 8,
              padding: '10px 12px',
              color: 'var(--ro-text)',
              fontSize: 13,
              fontFamily: DM,
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={runSearch}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: '#c084fc',
              color: '#09090e',
              fontFamily: DM,
            }}
          >
            Search
          </button>
        </div>
      )}

      {loadError && (
        <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 12, fontFamily: DM }}>
          {loadError} — showing local data (import timeline unavailable).
        </div>
      )}

      {report && report._clientOnly && !loadError && (
        <div style={{ fontSize: 11, color: 'var(--ro-text-muted)', marginBottom: 12, fontFamily: DM }}>
          Using catalog from this device; start the server for full import history and shared totals.
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--ro-text-muted)', alignSelf: 'center', marginRight: 4, fontFamily: DM }}>Gender</span>
        {GENDER_FILTERS.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setGender(g.key)}
            style={{
              padding: '5px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              border: gender === g.key ? '1px solid rgba(56,189,248,0.35)' : '1px solid var(--ro-border)',
              background: gender === g.key ? 'rgba(56,189,248,0.1)' : 'transparent',
              color: gender === g.key ? '#38bdf8' : 'var(--ro-text-muted)',
              fontFamily: DM,
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {report && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: 10,
              marginBottom: 20,
            }}
          >
            {[
              ['Import', filteredTotals?.stock ?? 0, null],
              ['On Hand', filteredTotals?.remaining ?? 0, null],
              ['Sold', filteredTotals?.sold ?? 0, null],
              ['Investment', `€${(filteredTotals?.totalInvestment ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, '#fb923c'],
              ['Cost', `€${(filteredTotals?.cogs ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, '#ff8800'],
              ['Revenue', `€${(filteredTotals?.totalRevenue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, '#38bdf8'],
              ['Profit', `€${(filteredTotals?.totalProfit ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, (filteredTotals?.totalProfit ?? 0) >= 0 ? '#00e676' : '#ff3333'],
              ['Margin', `${(filteredTotals?.avgRoi ?? 0).toFixed(1)}%`, (filteredTotals?.avgRoi ?? 0) >= 0 ? '#00e676' : '#ff3333'],
            ].map(([label, val, accentColor]) => (
              <div
                key={label}
                style={{
                  background: 'var(--ro-surface)',
                  border: '1px solid var(--ro-border)',
                  borderRadius: 11,
                  padding: '12px 14px',
                }}
              >
                <div style={{ fontSize: 9, color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontFamily: DM }}>
                  {label}
                </div>
                <div style={{ fontFamily: DM, fontSize: 20, color: accentColor || 'var(--ro-heading)' }}>{val}</div>
              </div>
            ))}
          </div>

          {gender === 'all' && report.byGender && (
            <div style={{ marginBottom: 16, fontSize: 11, color: 'var(--ro-text-dim)', fontFamily: DM }}>
              Men: import {report.byGender.Men?.stock ?? 0}, on hand {report.byGender.Men?.remaining ?? 0}, sold{' '}
              {report.byGender.Men?.sold ?? 0} · Women: import {report.byGender.Women?.stock ?? 0}, on hand{' '}
              {report.byGender.Women?.remaining ?? 0}, sold {report.byGender.Women?.sold ?? 0} · Kids: import{' '}
              {report.byGender.Kids?.stock ?? 0}, on hand {report.byGender.Kids?.remaining ?? 0}, sold{' '}
              {report.byGender.Kids?.sold ?? 0}
            </div>
          )}

          <div style={{ overflowX: 'auto', background: 'var(--ro-surface)', border: '1px solid var(--ro-border)', borderRadius: 12, marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
              <thead>
                <tr>
                  {[
                    ['product_name', 'Product'],
                    ['_photo', ''],
                    ['sku', 'SKU'],
                    ['genderBucket', 'Gender'],
                    ['stock', 'Import'],
                    ['sold', 'Sold'],
                    ['remaining', 'On Hand'],
                    ['cogs', 'Cost'],
                    ['totalRevenue', 'Revenue'],
                    ['avgTicket', 'Avg Ticket'],
                    ['profit', 'Profit'],
                    ['roi', 'Margin %'],
                    ['verdict', 'AI Verdict'],
                  ].map(([key, label]) => (
                    <th key={key} style={key === 'verdict' || key === '_photo' ? { ...TH, cursor: 'default' } : TH} onClick={key !== 'verdict' && key !== '_photo' ? () => toggleSort(key) : undefined}>
                      {label}
                      {sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                  <th style={{ ...TH, cursor: 'default' }}> </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ ...TD, textAlign: 'center', color: 'var(--ro-text-muted)', padding: 28 }}>
                      {tab === 'search' && !qParam
                        ? 'Enter a product name and press Search, or open All inventory for the full catalog.'
                        : `No products match${tab === 'search' && qForApi ? ` “${qForApi}”` : ''}.`}
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => {
                    const verdict = getReorderVerdict(row)
                    return (
                      <tr key={row.sku} className="clickable-row" onClick={() => openModal(row)} style={{ cursor: 'pointer' }}>
                        <td style={{ ...TD, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.product_name}</td>
                        <td style={{ ...TD, padding: '4px 6px', width: 36 }}>
                          {skuPhoto[row.sku] ? (
                            <img src={skuPhoto[row.sku]} alt="" style={{ width: 28, height: 28, borderRadius: 5, objectFit: 'cover', display: 'block' }} />
                          ) : (
                            <div style={{ width: 28, height: 28, borderRadius: 5, background: 'var(--ro-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--ro-text-muted)' }}>—</div>
                          )}
                        </td>
                        <td style={{ ...TD, color: 'var(--ro-text-dim)', fontFamily: DM, fontSize: 11 }}>{row.sku}</td>
                        <td style={TD}>{row.genderBucket}</td>
                        <td style={TD}>{row.stock}</td>
                        <td style={TD}>{row.sold}</td>
                        <td style={TD}>{row.remaining}</td>
                        <td style={{ ...TD, color: '#ff8800' }}>€{(row.cogs ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td style={{ ...TD, color: '#38bdf8' }}>€{(row.totalRevenue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td style={{ ...TD, color: '#c084fc' }}>€{(row.avgTicket ?? 0).toFixed(2)}</td>
                        <td style={{ ...TD, color: (row.profit ?? 0) >= 0 ? '#00e676' : '#ff3333' }}>€{(row.profit ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td style={{ ...TD, color: (row.roi ?? 0) >= 0 ? '#00e676' : '#ff3333' }}>{(row.roi ?? 0).toFixed(1)}%</td>
                        <td style={TD} title={`${verdict.reason} (${verdict.confidence})`}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              background: `${verdict.color}18`,
                              color: verdict.color,
                              border: `1px solid ${verdict.color}40`,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {verdict.recommendation}
                          </span>
                          <div style={{ fontSize: 9, color: 'var(--ro-text-muted)', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {verdict.reason}
                          </div>
                        </td>
                        <td style={TD}>
                          <button
                            type="button"
                            onClick={() => openModal(row)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: 'pointer',
                              border: '1px solid var(--ro-border-hover)',
                              background: 'var(--ro-surface-elevated)',
                              color: 'var(--ro-text-dim)',
                              fontFamily: DM,
                            }}
                          >
                            Details
                          </button>
                        </td>
                      </tr>
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

      {modalSku && (
        <ProductDetailModal
          sku={modalSku}
          status={modalStatus}
          statusData={{ label: modalStatus, color: tile.color, colorBg: tile.colorBg, icon: tile.icon }}
          onClose={() => setModalSku(null)}
        />
      )}
    </div>
  )
}
