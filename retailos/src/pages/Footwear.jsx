import { useState, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { getSellThrough, getLifecycleStatus } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import KpiCard from '../components/KpiCard'
import { IconFootwear } from '../utils/icons.js'
import { isExecutive } from '../utils/roles.js'

const BRAND_GRADIENTS = [
  'linear-gradient(135deg,#0a1a0a,#1a3a1a)',
  'linear-gradient(135deg,#0d1b10,#1a3a20)',
  'linear-gradient(135deg,#0f1923,#1e3a5f)',
  'linear-gradient(135deg,#1a0a2e,#2d1357)',
  'linear-gradient(135deg,#1a1a0a,#3a3a0d)',
  'linear-gradient(135deg,#0a1a1a,#0d3333)',
  'linear-gradient(135deg,#10101a,#1e1e3a)',
  'linear-gradient(135deg,#1a0010,#3d0028)',
]
const BRAND_COLORS = ['#00e676', '#fbbf24', '#38bdf8', '#c084fc', '#f472b6', '#ff8800', '#ff3333', '#34d399']

const sizes = [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46]

export function Footwear() {
  const [brandFilter, setBrandFilter] = useState('All brands')
  const skus = useStore((s) => s.skus)
  const activeUser = useStore((s) => s.activeUser)
  const exec = isExecutive(activeUser)

  const products = useMemo(() => aggregateSkus(skus), [skus])

  const dynamicBrands = useMemo(() => {
    const set = new Set()
    for (const s of products) {
      if (String(s.category || '').toLowerCase() === 'footwear' && s.brand) set.add(s.brand)
    }
    return [...set].sort()
  }, [products])

  const BRANDS = ['All brands', ...dynamicBrands]

  const footwearProducts = products
    .filter((s) => String(s.category || '').toLowerCase() === 'footwear')
    .filter((s) => brandFilter === 'All brands' || s.brand === brandFilter)

  const footwearRawSkus = skus
    .filter((s) => String(s.category || '').toLowerCase() === 'footwear')
    .filter((s) => brandFilter === 'All brands' || s.brand === brandFilter)

  let sellSum = 0
  let riskClearanceCount = 0
  let bestSellThrough = -1
  let bestsellerName = '—'

  for (const s of footwearProducts) {
    const sold = s.sold_quantity || 0
    const qty = s.quantity || 0
    const pct = getSellThrough(sold, qty)
    sellSum += pct

    const status = getLifecycleStatus(s.import_date, sold, qty)
    if (status === 'Risk' || status === 'Clearance') {
      riskClearanceCount += 1
    }

    if (pct > bestSellThrough) {
      bestSellThrough = pct
      bestsellerName = (s.product_name || '').trim() || s.sku || '—'
    }
  }

  const n = footwearProducts.length
  const avgSellThrough = n ? Math.round(sellSum / n) : 0

  return (
    <div
      data-sku-count={products.length}
      data-footwear-count={n}
      data-footwear-risk-clearance={riskClearanceCount}
      data-footwear-avg-sellthrough={avgSellThrough}
    >
      {/* SECTION 1 — Header with brand filter pills */}
      <div
        className="fade-up delay-1"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div
          style={{
            fontFamily: '"DM Sans"',
            fontSize: '16px',
            letterSpacing: '2px',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#38bdf8',
              animation: 'blink 2s infinite',
            }}
          />
          FOOTWEAR CATALOG
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {BRANDS.map((b) => {
            const active = brandFilter === b
            return (
              <button
                key={b}
                type="button"
                onClick={() => setBrandFilter(b)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: '"DM Sans"',
                  border: active ? '1px solid rgba(56,189,248,0.35)' : '1px solid rgba(255,255,255,0.055)',
                  background: active ? 'rgba(56,189,248,0.12)' : '#17171f',
                  color: active ? '#38bdf8' : '#9090aa',
                  transition: 'all 0.18s',
                }}
              >
                {b}
              </button>
            )
          })}
        </div>
      </div>

      {/* SECTION 2 — 4 KPI cards */}
      <div
        className="fade-up delay-2"
        style={{
          display: 'grid',
          gridTemplateColumns: exec ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)',
          gap: '12px',
          marginBottom: '22px',
        }}
      >
        <KpiCard
          label="Total Footwear SKUs"
          value={n}
          sub={brandFilter === 'All brands' ? 'All brands' : brandFilter}
          accentColor="#38bdf8"
        />
        {exec ? (
          <KpiCard
            label="Avg Sell-Through"
            value={n ? `${avgSellThrough}%` : '—'}
            sub="Filtered range"
            accentColor="#00e676"
          />
        ) : null}
        <KpiCard
          label="At Risk / Clearance"
          value={riskClearanceCount}
          sub="Lifecycle"
          accentColor="#ff3333"
        />
        <KpiCard
          label={exec ? 'Bestseller' : 'Highlight style'}
          value={n ? bestsellerName : '—'}
          sub={exec && n && bestSellThrough >= 0 ? `${Math.round(bestSellThrough)}% sell-through` : exec ? '—' : n ? 'Strong performer in filter' : '—'}
          accentColor="#fbbf24"
        />
      </div>

      {/* SECTION 3 — Brand breakdown cards */}
      <div
        className="fade-up delay-2"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(dynamicBrands.length || 1, 4)}, 1fr)`,
          gap: '12px',
          marginBottom: '22px',
        }}
      >
        {dynamicBrands.map((brandName, idx) => {
          const b = { name: brandName, gradient: BRAND_GRADIENTS[idx % BRAND_GRADIENTS.length], barColor: BRAND_COLORS[idx % BRAND_COLORS.length] }
          const brandSkus = footwearProducts.filter((s) => s.brand === b.name)
          const count = brandSkus.length
          const soldQty = (s) => s.sold_quantity || 0
          const qty = (s) => s.quantity || 0
          const avg = Math.round(
            brandSkus.reduce((acc, s) => acc + getSellThrough(soldQty(s), qty(s)), 0) / (count || 1)
          )
          const atRisk = brandSkus.filter((s) =>
            ['Risk', 'Clearance', 'Outlet'].includes(
              getLifecycleStatus(s.import_date, soldQty(s), qty(s))
            )
          ).length

          return (
            <div
              key={b.name}
              style={{
                background: '#111117',
                border: '1px solid rgba(255,255,255,0.055)',
                borderRadius: '13px',
                overflow: 'hidden',
                cursor: 'pointer',
                transition: 'all 0.18s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'
                e.currentTarget.style.boxShadow = '0 12px 30px rgba(0,0,0,0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = ''
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.055)'
                e.currentTarget.style.boxShadow = ''
              }}
            >
              <div
                style={{
                  height: '110px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '46px',
                  background: b.gradient,
                }}
              >
                <IconFootwear size={40} strokeWidth={1.5} color="rgba(255,255,255,0.95)" />
              </div>

              <div style={{ padding: '13px' }}>
                <div
                  style={{
                    fontFamily: '"DM Sans"',
                    fontSize: '17px',
                    letterSpacing: '1.5px',
                    color: '#fff',
                    marginBottom: '2px',
                  }}
                >
                  {b.name}
                </div>
                <div style={{ fontSize: '11px', color: '#4a4a62', marginBottom: '8px' }}>
                  {count} SKUs · Footwear
                </div>
                {exec ? (
                  <>
                    <div style={{ height: '4px', background: '#17171f', borderRadius: '2px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          borderRadius: '2px',
                          background: b.barColor,
                          width: `${avg}%`,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: '8px',
                        fontSize: '10px',
                        color: '#4a4a62',
                      }}
                    >
                      <span>{avg}% avg sell-through</span>
                      <span style={{ color: atRisk > 5 ? '#ff3333' : '#fbbf24' }}>{atRisk} at risk</span>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      marginTop: '8px',
                      fontSize: '10px',
                      color: '#4a4a62',
                    }}
                  >
                    <span style={{ color: atRisk > 5 ? '#ff3333' : '#fbbf24' }}>{atRisk} at risk</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* SECTION 4 — Size Coverage grid */}
      <div
        className="fade-up delay-3"
        style={{
          background: '#111117',
          border: '1px solid rgba(255,255,255,0.055)',
          borderRadius: '13px',
          padding: '18px',
          marginBottom: '22px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span
            style={{
              fontFamily: '"DM Sans"',
              fontSize: '14px',
              letterSpacing: '2px',
              color: '#fff',
              fontWeight: 600,
            }}
          >
            Size Coverage — Footwear
          </span>
        </div>
        <div style={{ fontSize: '11px', color: '#4a4a62', marginBottom: '4px' }}>
          Green = well stocked · Red = low stock · Grey = out of stock
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: '5px',
            marginTop: '10px',
          }}
        >
          {sizes.map((size) => {
            const remaining = footwearRawSkus
              .filter((s) => s.size == size)
              .reduce((a, s) => a + ((s.quantity || 0) - (s.sold_quantity || 0)), 0)
            const cellColor = remaining === 0 ? '#4a4a62' : remaining <= 3 ? '#ff3333' : '#00e676'
            const isOut = remaining === 0
            return (
              <div
                key={size}
                style={{
                  background: '#17171f',
                  border: `1px solid ${
                    remaining <= 3 && !isOut ? 'rgba(255,51,51,0.2)' : 'rgba(255,255,255,0.055)'
                  }`,
                  borderRadius: '6px',
                  padding: '5px 4px',
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: cellColor,
                  textDecoration: isOut ? 'line-through' : 'none',
                }}
              >
                {size}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
