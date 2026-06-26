import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import { getSellThrough, getLifecycleStatus } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import KpiCard from '../components/KpiCard'
import { IconAccessories } from '../utils/icons.js'
import { isExecutive } from '../utils/roles.js'
import { toTitleCase } from '../utils/textFormat.js'

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

function sellThroughThresholdClass(pct) {
  const n = Number(pct) || 0
  if (n >= 40) return 'catalog-threshold--good'
  if (n >= 20) return 'catalog-threshold--mid'
  return 'catalog-threshold--bad'
}

function catalogCardSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
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
      className="catalog-page"
      data-sku-count={products.length}
      data-accessories-count={n}
      data-accessories-avg-sellthrough={avgSellThrough}
      data-peak-catalog-avg={peakCatalogAvg}
      data-accessories-low-stock={lowStockCount}
      data-accessories-clearance-outlet={clearanceOutletCount}
    >
      <div className={`fade-up delay-2 catalog-kpi-grid${exec ? '' : ' catalog-kpi-grid--3'}`}>
        <KpiCard
          className="catalog-kpi-tile catalog-kpi-tile--total"
          label="Total SKUs"
          value={n}
          sub="Accessories"
          accentColor="#60A5FA"
        />
        {exec ? (
          <KpiCard
            className={`catalog-kpi-tile catalog-kpi-tile--sellthrough ${sellThroughThresholdClass(avgSellThrough)}`}
            label="Avg sell-through"
            value={`${peakCatalogAvg}%`}
            sub={`Peak: ${peakCatalog.label}`}
            accentColor="#34D399"
          />
        ) : null}
        <KpiCard
          className="catalog-kpi-tile catalog-kpi-tile--alert"
          label="Low stock items"
          value={lowStockCount}
          sub="Remaining < 3 units"
          accentColor="#F87171"
        />
        <KpiCard
          className="catalog-kpi-tile catalog-kpi-tile--highlight"
          label="Clearance"
          value={clearanceOutletCount}
          sub="Clearance + outlet"
          accentColor="#FBBF24"
        />
      </div>

      {n === 0 ? (
        <div className="catalog-empty fade-up delay-3">
          <IconAccessories className="catalog-empty__icon" size={32} strokeWidth={1.5} aria-hidden />
          <p className="catalog-empty__title">No brands found</p>
          <p className="catalog-empty__hint">Try selecting a different filter above.</p>
        </div>
      ) : (
        <div className="fade-up delay-3 catalog-card-grid catalog-card-grid--3">
          {subcategoryCardStats.map(({ sc, count, avg, atRisk }) => {
            const thresholdClass = sellThroughThresholdClass(avg)
            const cardSlug = catalogCardSlug(sc.name)
            const cardInitial = String(sc.name || '?').charAt(0).toUpperCase()
            return (
              <div
                key={sc.name}
                className="catalog-card"
                data-card={cardSlug}
              >
                <div className="catalog-card__header" data-card={cardSlug}>
                  <span className="catalog-card__initial" aria-hidden="true">{cardInitial}</span>
                </div>

                <div className="catalog-card__body">
                  <div className="catalog-card__name">{toTitleCase(sc.name)}</div>
                  <div className="catalog-card__meta">
                    {count} SKUs · Accessories
                  </div>
                  {exec ? (
                    <>
                      <div className="catalog-card__bar">
                        <div
                          className={`catalog-card__bar-fill ${thresholdClass}`}
                          style={{ width: `${avg}%` }}
                        />
                      </div>
                      <div className="catalog-card__stats">
                        <div className="catalog-stat-chip">
                          <span className={`catalog-stat-chip__val ${thresholdClass}`}>{avg}%</span>
                          <span className="catalog-stat-chip__label">avg sell-through</span>
                        </div>
                        <div className="catalog-stat-chip catalog-stat-chip--right">
                          <span className={`catalog-stat-chip__val${atRisk > 0 ? ' catalog-stat-chip__val--risk' : ' catalog-stat-chip__val--zero'}`}>
                            {atRisk}
                          </span>
                          <span className="catalog-stat-chip__label">at risk</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="catalog-card__stats">
                      <div className="catalog-stat-chip catalog-stat-chip--right catalog-stat-chip--solo">
                        <span className={`catalog-stat-chip__val${atRisk > 0 ? ' catalog-stat-chip__val--risk' : ' catalog-stat-chip__val--zero'}`}>
                          {atRisk}
                        </span>
                        <span className="catalog-stat-chip__label">at risk</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
