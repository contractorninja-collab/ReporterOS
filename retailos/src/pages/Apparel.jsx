import { useState, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { getSellThrough, getLifecycleStatus } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import KpiCard from '../components/KpiCard'
import { IconApparel } from '../utils/icons.js'
import { isExecutive } from '../utils/roles.js'

const CATS = ['All', 'Tops', 'Bottoms', 'Outerwear', 'Underwear']

const categories = [
  {
    name: 'Outerwear',
    gradient: 'linear-gradient(135deg,#1a0a2e,#2d1357)',
    barColor: '#fbbf24',
    desc: 'Jackets, Windbreakers',
    placeholderCount: 14,
    placeholderAvg: 41,
  },
  {
    name: 'Tops & Tees',
    gradient: 'linear-gradient(135deg,#0f1923,#1e3a5f)',
    barColor: '#00e676',
    desc: 'Polos, Tees, Vests',
    placeholderCount: 28,
    placeholderAvg: 52,
  },
  {
    name: 'Underwear & Sports',
    gradient: 'linear-gradient(135deg,#1a0010,#3d0028)',
    barColor: '#00e676',
    desc: 'Fila Licensed',
    placeholderCount: 19,
    placeholderAvg: 67,
  },
]

function skusForCategoryGroup(skus, groupName) {
  const hay = (s) => `${s.product_name || ''} ${s.sku || ''}`.toLowerCase()
  switch (groupName) {
    case 'Outerwear':
      return skus.filter((s) =>
        /jacket|coat|parka|blazer|anorak|windbreaker|gilet|shell|puffer/.test(hay(s))
      )
    case 'Tops & Tees':
      return skus.filter(
        (s) =>
          /polo|tee|shirt|top|tank|blouse|hoodie|sweater|crop|vest/.test(hay(s)) &&
          !/jacket|coat|parka|blazer|anorak|windbreaker|gilet|puffer/.test(hay(s))
      )
    case 'Underwear & Sports':
      return skus.filter(
        (s) =>
          /bra|underwear|brief|boxer|sport|compression|legging|athletic/.test(hay(s)) ||
          /fila|licensed/.test(hay(s))
      )
    default:
      return []
  }
}

function matchesApparelSubcategory(sku, catFilter) {
  if (catFilter === 'All') return true
  const hay = `${sku.product_name || ''} ${sku.sku || ''}`.toLowerCase()
  switch (catFilter) {
    case 'Tops':
      return /top|shirt|tee|polo|sweater|hoodie|tank|blouse|crop/.test(hay)
    case 'Bottoms':
      return /pant|short|jean|trouser|skirt|legging|jogger/.test(hay)
    case 'Outerwear':
      return /jacket|coat|parka|blazer|anorak|gilet|vest/.test(hay)
    case 'Underwear':
      return /bra|underwear|brief|boxer|lingerie/.test(hay)
    default:
      return true
  }
}

export function Apparel() {
  const [catFilter, setCatFilter] = useState('All')
  const skus = useStore((s) => s.skus)
  const activeUser = useStore((s) => s.activeUser)
  const exec = isExecutive(activeUser)

  const products = useMemo(() => aggregateSkus(skus), [skus])

  const apparelSkus = products
    .filter((s) => String(s.category || '').toLowerCase() === 'apparel')
    .filter((s) => matchesApparelSubcategory(s, catFilter))

  let sellSum = 0
  let slowMovers = 0
  let bestFemaleSellThrough = -1

  for (const s of apparelSkus) {
    const sold = s.sold_quantity || 0
    const qty = s.quantity || 0
    const pct = getSellThrough(sold, qty)
    sellSum += pct

    const st = getLifecycleStatus(s.import_date, sold, qty)
    if (st === 'Aging' || st === 'Risk') {
      slowMovers += 1
    }

    const g = String(s.gender || '').trim().toUpperCase()
    const isFemale = g === 'F' || g === 'FEMALE'
    if (isFemale && pct > bestFemaleSellThrough) {
      bestFemaleSellThrough = pct
    }
  }

  const n = apparelSkus.length
  const avgSellThrough = n ? Math.round(sellSum / n) : 0
  const femaleBestsellerPct = bestFemaleSellThrough >= 0 ? Math.round(bestFemaleSellThrough) : null

  const getSold = (s) => s.sold_quantity || 0
  const getQty = (s) => s.quantity || 0

  const categoryCardStats = categories.map((c) => {
    const groupSkus = skusForCategoryGroup(apparelSkus, c.name)
    const countRaw = groupSkus.length
    const usePlaceholder = countRaw === 0
    const count = usePlaceholder ? c.placeholderCount : countRaw
    const avg = usePlaceholder
      ? c.placeholderAvg
      : Math.round(
          groupSkus.reduce((acc, s) => acc + getSellThrough(getSold(s), getQty(s)), 0) / (countRaw || 1)
        )
    const atRisk = usePlaceholder
      ? Math.min(3, Math.floor(count * 0.08))
      : groupSkus.filter((s) =>
          ['Risk', 'Clearance', 'Outlet'].includes(
            getLifecycleStatus(s.import_date, getSold(s), getQty(s))
          )
        ).length
    return { c, count, avg, atRisk }
  })

  const maxCategoryAvg = Math.max(0, ...categoryCardStats.map((x) => x.avg))

  const largestCategoryName = useMemo(() => {
    if (!categoryCardStats.length) return '—'
    const top = categoryCardStats.reduce((a, b) => (b.count > a.count ? b : a))
    return top.c?.name ?? '—'
  }, [categoryCardStats])

  return (
    <div
      data-sku-count={products.length}
      data-apparel-count={n}
      data-apparel-avg-sellthrough={avgSellThrough}
      data-apparel-slow-movers={slowMovers}
    >
      {/* SECTION 1 — Header with category pills */}
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
              background: '#c084fc',
              animation: 'blink 2s infinite',
            }}
          />
          APPAREL CATALOG
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {CATS.map((c) => {
            const active = catFilter === c
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCatFilter(c)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: '"DM Sans"',
                  border: active ? '1px solid rgba(192,132,252,0.35)' : '1px solid rgba(255,255,255,0.055)',
                  background: active ? 'rgba(192,132,252,0.12)' : '#17171f',
                  color: active ? '#c084fc' : '#9090aa',
                  transition: 'all 0.18s',
                }}
              >
                {c}
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
          label="Total Apparel SKUs"
          value={n}
          sub={catFilter === 'All' ? 'All categories' : catFilter}
          accentColor="#c084fc"
        />
        {exec ? (
          <>
            <KpiCard
              label="Avg Sell-Through"
              value={n ? `${avgSellThrough}%` : '—'}
              sub="Filtered range"
              accentColor="#00e676"
            />
            <KpiCard
              label="Female Bestseller"
              value={femaleBestsellerPct != null ? `${femaleBestsellerPct}%` : '—'}
              sub="Top F sell-through"
              accentColor="#f472b6"
            />
          </>
        ) : (
          <KpiCard
            label="Largest group"
            value={largestCategoryName}
            sub="By SKU count in filter"
            accentColor="#a78bfa"
          />
        )}
        <KpiCard
          label="Slow Movers"
          value={slowMovers}
          sub="Aging + risk"
          accentColor="#ff3333"
        />
      </div>

      {/* SECTION 3 — Category breakdown cards (3 columns) */}
      <div
        className="fade-up delay-3"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
          marginBottom: '22px',
        }}
      >
        {categoryCardStats.map(({ c, count, avg, atRisk }) => {
          const isTopPerformer = avg === maxCategoryAvg && maxCategoryAvg > 0
          return (
            <div
              key={c.name}
              style={{
                background: '#111117',
                border: isTopPerformer
                  ? '1px solid rgba(192,132,252,0.45)'
                  : '1px solid rgba(255,255,255,0.055)',
                borderRadius: '13px',
                overflow: 'hidden',
                cursor: 'pointer',
                transition: 'all 0.18s',
                boxShadow: isTopPerformer ? '0 0 0 1px rgba(192,132,252,0.15)' : undefined,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px)'
                e.currentTarget.style.borderColor = isTopPerformer
                  ? 'rgba(192,132,252,0.55)'
                  : 'rgba(255,255,255,0.09)'
                e.currentTarget.style.boxShadow = '0 12px 30px rgba(0,0,0,0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = ''
                e.currentTarget.style.borderColor = isTopPerformer
                  ? 'rgba(192,132,252,0.45)'
                  : 'rgba(255,255,255,0.055)'
                e.currentTarget.style.boxShadow = isTopPerformer ? '0 0 0 1px rgba(192,132,252,0.15)' : ''
              }}
            >
              <div
                style={{
                  height: '110px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '46px',
                  background: c.gradient,
                }}
              >
                <IconApparel size={40} strokeWidth={1.5} color="rgba(255,255,255,0.95)" />
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
                  {c.name}
                </div>
                <div style={{ fontSize: '11px', color: '#4a4a62', marginBottom: '4px' }}>
                  {count} SKUs · Apparel
                </div>
                <div style={{ fontSize: '10px', color: '#4a4a62', marginBottom: '8px' }}>{c.desc}</div>
                {exec ? (
                  <>
                    <div style={{ height: '4px', background: '#17171f', borderRadius: '2px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          borderRadius: '2px',
                          background: c.barColor,
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
    </div>
  )
}
