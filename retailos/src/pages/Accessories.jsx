import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import { getSellThrough, getLifecycleStatus } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import KpiCard from '../components/KpiCard'
import { IconAccessories } from '../utils/icons.js'
import { isExecutive } from '../utils/roles.js'

function avgSellThroughForSkus(list) {
  if (!list.length) return 0
  const sum = list.reduce(
    (acc, s) => acc + getSellThrough(s.sold_quantity || 0, s.quantity || 0),
    0
  )
  return Math.round(sum / list.length)
}

const subcategories = [
  {
    name: 'Caps & Headwear',
    gradient: 'linear-gradient(135deg,#0a1a1a,#0d3333)',
    barColor: '#00e676',
    highlight: 'Hot',
    highlightColor: '#00e676',
    placeholderCount: 9,
    placeholderAvg: 46,
  },
  {
    name: 'Bags & Backpacks',
    gradient: 'linear-gradient(135deg,#1a1a0a,#3a3a0d)',
    barColor: '#00e676',
    highlight: 'Normal',
    highlightColor: '#38bdf8',
    placeholderCount: 7,
    placeholderAvg: 38,
  },
  {
    name: 'Socks & Basics',
    gradient: 'linear-gradient(135deg,#10101a,#1e1e3a)',
    barColor: '#00e676',
    highlight: 'Strong',
    highlightColor: '#00e676',
    placeholderCount: 12,
    placeholderAvg: 52,
  },
]

function skusForAccessorySubcategory(skus, groupName) {
  const hay = (s) => `${s.product_name || ''} ${s.sku || ''}`.toLowerCase()
  switch (groupName) {
    case 'Caps & Headwear':
      return skus.filter((s) =>
        /cap|hat|beanie|headband|headwear|visor|bucket|snapback|trucker/.test(hay(s))
      )
    case 'Bags & Backpacks':
      return skus.filter((s) =>
        /bag|backpack|tote|duffel|pouch|luggage|rucksack|satchel/.test(hay(s))
      )
    case 'Socks & Basics':
      return skus.filter((s) => /sock|liner|ankle|crew|basic|invisible/.test(hay(s)))
    default:
      return []
  }
}

export function Accessories() {
  const skus = useStore((s) => s.skus)
  const activeUser = useStore((s) => s.activeUser)
  const exec = isExecutive(activeUser)

  const products = useMemo(() => aggregateSkus(skus), [skus])

  const accessoriesSkus = products.filter(
    (s) => String(s.category || '').toLowerCase() === 'accessories'
  )
  const footwearSkus = products.filter(
    (s) => String(s.category || '').toLowerCase() === 'footwear'
  )
  const apparelSkus = products.filter((s) => String(s.category || '').toLowerCase() === 'apparel')

  const avgFootwear = avgSellThroughForSkus(footwearSkus)
  const avgApparel = avgSellThroughForSkus(apparelSkus)
  const avgAccessoriesOnly = avgSellThroughForSkus(accessoriesSkus)

  const peakSegments = [
    { label: 'Footwear', val: avgFootwear },
    { label: 'Apparel', val: avgApparel },
    { label: 'Accessories', val: avgAccessoriesOnly },
  ]
  const peakCatalog = peakSegments.reduce((a, b) => (b.val > a.val ? b : a))
  const peakCatalogAvg = peakCatalog.val

  let sellSum = 0
  let lowStockCount = 0
  let clearanceOutletCount = 0
  for (const s of accessoriesSkus) {
    const sold = s.sold_quantity || 0
    const qty = s.quantity || 0
    sellSum += getSellThrough(sold, qty)
    const remaining = qty - sold
    if (remaining < 3) lowStockCount += 1
    const st = getLifecycleStatus(s.import_date, sold, qty)
    if (st === 'Clearance' || st === 'Outlet') clearanceOutletCount += 1
  }
  const n = accessoriesSkus.length
  const avgSellThrough = n ? Math.round(sellSum / n) : 0

  const getSold = (s) => s.sold_quantity || 0
  const getQty = (s) => s.quantity || 0

  const subcategoryCardStats = subcategories.map((sc) => {
    const groupSkus = skusForAccessorySubcategory(accessoriesSkus, sc.name)
    const countRaw = groupSkus.length
    const usePlaceholder = countRaw === 0
    const count = usePlaceholder ? sc.placeholderCount : countRaw
    const avg = usePlaceholder
      ? sc.placeholderAvg
      : Math.round(
          groupSkus.reduce((acc, s) => acc + getSellThrough(getSold(s), getQty(s)), 0) / (countRaw || 1)
        )
    const atRisk = usePlaceholder
      ? 0
      : groupSkus.filter((s) =>
          ['Risk', 'Clearance', 'Outlet'].includes(
            getLifecycleStatus(s.import_date, getSold(s), getQty(s))
          )
        ).length
    return { sc, count, avg, atRisk }
  })

  return (
    <div
      data-sku-count={products.length}
      data-accessories-count={n}
      data-accessories-avg-sellthrough={avgSellThrough}
      data-peak-catalog-avg={peakCatalogAvg}
      data-accessories-low-stock={lowStockCount}
      data-accessories-clearance-outlet={clearanceOutletCount}
    >
      {/* SECTION 1 — Header (no filter pills) */}
      <div
        className="fade-up delay-1"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px',
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
              background: '#2dd4bf',
              animation: 'blink 2s infinite',
            }}
          />
          ACCESSORIES CATALOG
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
          label="Total Accessory SKUs"
          value={n}
          sub="Accessories"
          accentColor="#2dd4bf"
        />
        {exec ? (
          <KpiCard
            label="Avg Sell-Through"
            value={`${peakCatalogAvg}%`}
            sub={`Peak: ${peakCatalog.label}`}
            accentColor="#00e676"
          />
        ) : null}
        <KpiCard
          label="Low Stock Items"
          value={lowStockCount}
          sub="Remaining < 3 units"
          accentColor="#ff3333"
        />
        <KpiCard
          label="Clearance"
          value={clearanceOutletCount}
          sub="Clearance + outlet"
          accentColor="#fbbf24"
        />
      </div>

      {/* SECTION 3 — Sub-category cards (3 columns) */}
      <div
        className="fade-up delay-3"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
          marginBottom: '22px',
        }}
      >
        {subcategoryCardStats.map(({ sc, count, avg, atRisk }) => (
          <div
            key={sc.name}
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
                background: sc.gradient,
              }}
            >
              <IconAccessories size={40} strokeWidth={1.5} color="rgba(255,255,255,0.95)" />
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
                {sc.name}
              </div>
              <div style={{ fontSize: '11px', color: '#4a4a62', marginBottom: '8px' }}>
                {count} SKUs · Accessories
              </div>
              {exec ? (
                <>
                  <div style={{ height: '4px', background: '#17171f', borderRadius: '2px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: '2px',
                        background: sc.barColor,
                        width: `${avg}%`,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: '8px',
                      fontSize: '10px',
                      color: '#4a4a62',
                    }}
                  >
                    <span>{avg}% avg sell-through</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {atRisk > 0 && (
                        <span style={{ color: atRisk > 5 ? '#ff3333' : '#fbbf24' }}>{atRisk} at risk</span>
                      )}
                      <span style={{ color: sc.highlightColor, fontWeight: 700 }}>{sc.highlight}</span>
                    </div>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '8px',
                    fontSize: '10px',
                    color: '#4a4a62',
                  }}
                >
                  {atRisk > 0 && (
                    <span style={{ color: atRisk > 5 ? '#ff3333' : '#fbbf24' }}>{atRisk} at risk</span>
                  )}
                  <span style={{ color: sc.highlightColor, fontWeight: 700 }}>{sc.highlight}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
