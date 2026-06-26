import { useState, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { getSellThrough, getLifecycleStatus } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import KpiCard from '../components/KpiCard'
import { IconFootwear } from '../utils/icons.js'
import { isExecutive } from '../utils/roles.js'
import { toTitleCase } from '../utils/textFormat.js'

const sizes = [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46]

function sellThroughThresholdClass(pct) {
  const n = Number(pct) || 0
  if (n >= 40) return 'catalog-threshold--good'
  if (n >= 20) return 'catalog-threshold--mid'
  return 'catalog-threshold--bad'
}

function brandSlug(name) {
  return String(name || '').toLowerCase().trim()
}

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
  const avgStClass = sellThroughThresholdClass(avgSellThrough)
  const showEmptyBrands = dynamicBrands.length === 0
    || (brandFilter !== 'All brands' && footwearProducts.length === 0)

  return (
    <div
      className="catalog-page"
      data-sku-count={products.length}
      data-footwear-count={n}
      data-footwear-risk-clearance={riskClearanceCount}
      data-footwear-avg-sellthrough={avgSellThrough}
    >
      <div className="fade-up delay-1 catalog-page-header">
        <div className="catalog-filter-chips">
          {BRANDS.map((b) => {
            const active = brandFilter === b
            return (
              <button
                key={b}
                type="button"
                className={`catalog-filter-chip${active ? ' is-active' : ''}`}
                onClick={() => setBrandFilter(b)}
              >
                {b === 'All brands' ? b : toTitleCase(b)}
              </button>
            )
          })}
        </div>
      </div>

      <div className={`fade-up delay-2 catalog-kpi-grid${exec ? '' : ' catalog-kpi-grid--3'}`}>
        <KpiCard
          className="catalog-kpi-tile catalog-kpi-tile--total"
          label="Total SKUs"
          value={n}
          sub={brandFilter === 'All brands' ? 'All brands' : toTitleCase(brandFilter)}
          accentColor="#60A5FA"
        />
        {exec ? (
          <KpiCard
            className={`catalog-kpi-tile catalog-kpi-tile--sellthrough ${avgStClass}`}
            label="Avg sell-through"
            value={n ? `${avgSellThrough}%` : '—'}
            sub="Filtered range"
            accentColor="#34D399"
          />
        ) : null}
        <KpiCard
          className="catalog-kpi-tile catalog-kpi-tile--alert"
          label="At risk / clearance"
          value={riskClearanceCount}
          sub="Lifecycle"
          accentColor="#F87171"
        />
        <KpiCard
          className={`catalog-kpi-tile catalog-kpi-tile--highlight catalog-kpi-tile--compact-value${exec && n && bestSellThrough >= 0 ? ' catalog-kpi-tile--sub-positive' : ''}`}
          label={exec ? 'Bestseller' : 'Highlight style'}
          value={n ? bestsellerName : '—'}
          sub={exec && n && bestSellThrough >= 0 ? `${Math.round(bestSellThrough)}% sell-through` : exec ? '—' : n ? 'Strong performer in filter' : '—'}
          accentColor="#FBBF24"
        />
      </div>

      {showEmptyBrands ? (
        <div className="catalog-empty fade-up delay-2">
          <IconFootwear className="catalog-empty__icon" size={32} strokeWidth={1.5} aria-hidden />
          <p className="catalog-empty__title">No brands found</p>
          <p className="catalog-empty__hint">Try selecting a different filter above.</p>
        </div>
      ) : (
        <div className="fade-up delay-2 catalog-card-grid">
          {dynamicBrands.map((brandName) => {
            const brandSkus = footwearProducts.filter((s) => s.brand === brandName)
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

            const thresholdClass = sellThroughThresholdClass(avg)
            const slug = brandSlug(brandName)

            return (
              <div
                key={brandName}
                className="catalog-card"
                data-brand={slug}
              >
                <div className="catalog-card__header" data-brand={slug}>
                  <span className="catalog-card__initial" aria-hidden="true">
                    {String(brandName || '?').charAt(0).toUpperCase()}
                  </span>
                </div>

                <div className="catalog-card__body">
                  <div className="catalog-card__name">{toTitleCase(brandName)}</div>
                  <div className="catalog-card__meta">
                    {count} SKUs · Footwear
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

      <div className="fade-up delay-3 catalog-size-panel">
        <div className="catalog-size-panel__title">Size Coverage — Footwear</div>
        <div className="catalog-size-panel__hint">
          Green = well stocked · Red = low stock · Grey = out of stock
        </div>

        <div className="catalog-size-grid">
          {sizes.map((size) => {
            const remaining = footwearRawSkus
              .filter((s) => s.size == size)
              .reduce((a, s) => a + ((s.quantity || 0) - (s.sold_quantity || 0)), 0)
            const cellColor = remaining === 0 ? 'var(--ro-text-muted)' : remaining <= 3 ? '#ff3333' : '#00e676'
            const isOut = remaining === 0
            return (
              <div
                key={size}
                className="catalog-size-cell"
                style={{
                  color: cellColor,
                  textDecoration: isOut ? 'line-through' : 'none',
                  borderColor: remaining <= 3 && !isOut ? 'rgba(255,51,51,0.2)' : undefined,
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
