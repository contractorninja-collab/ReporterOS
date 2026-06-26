import { useEffect, useState, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { getSellThrough, getLifecycleStatus } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import KpiCard from '../components/KpiCard'
import { IconApparel } from '../utils/icons.js'
import { isExecutive } from '../utils/roles.js'
import { toTitleCase } from '../utils/textFormat.js'
import * as api from '../api/client'

const CATS = ['All', 'Tops', 'Bottoms', 'Outerwear', 'Underwear']
const PRODUCT_TYPE_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'tshirt', label: 'T-shirts' },
  { key: 'shorts', label: 'Shorts' },
  { key: 'pants', label: 'Pants' },
  { key: 'skirt', label: 'Skirts' },
  { key: 'hoodie', label: 'Hoodies' },
  { key: 'jacket', label: 'Jackets' },
  { key: 'dress', label: 'Dresses' },
  { key: 'swimwear', label: 'Swimwear' },
  { key: 'other', label: 'Other' },
]

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

function productTypeFromText(sku) {
  const hay = `${sku.product_name || ''} ${sku.category || ''} ${sku.sku || ''}`.toLowerCase()
  if (/short|sho\b|sh\b/.test(hay)) return 'shorts'
  if (/skirt|\bski\b/.test(hay)) return 'skirt'
  if (/pant|trouser|jogger|legging|tight/.test(hay)) return 'pants'
  if (/hoodie|hoody|sweater|sweatshirt|crew|crw|fleece|ft hd/.test(hay)) return 'hoodie'
  if (/jacket|coat|track jacket|windbreaker|bomber|gilet|vest/.test(hay)) return 'jacket'
  if (/dress|\bdre\b/.test(hay)) return 'dress'
  if (/swim|breaker/.test(hay)) return 'swimwear'
  if (/tee|shirt|t-shirt|tshirt|top|polo|tank/.test(hay)) return 'tshirt'
  return 'other'
}

function productTypeForSku(sku, productTypeMap) {
  return productTypeMap?.[sku.sku]?.product_type || productTypeFromText(sku)
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

export function Apparel() {
  const [catFilter, setCatFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('all')
  const [productTypeMap, setProductTypeMap] = useState({})
  const [isClassifying, setIsClassifying] = useState(false)
  const [classificationStatus, setClassificationStatus] = useState('')
  const skus = useStore((s) => s.skus)
  const activeUser = useStore((s) => s.activeUser)
  const exec = isExecutive(activeUser)

  useEffect(() => {
    let cancelled = false
    api.fetchProductTypeLabels()
      .then((labels) => {
        if (!cancelled && labels && typeof labels === 'object') setProductTypeMap(labels)
      })
      .catch(() => {
        if (!cancelled) setProductTypeMap({})
      })
    return () => {
      cancelled = true
    }
  }, [])

  const products = useMemo(() => aggregateSkus(skus), [skus])

  const apparelSkus = products
    .filter((s) => {
      const cat = String(s.category || '').toLowerCase()
      return cat === 'apparel' || cat === 'app'
    })
    .filter((s) => matchesApparelSubcategory(s, catFilter))
    .filter((s) => typeFilter === 'all' || productTypeForSku(s, productTypeMap) === typeFilter)

  const classifyMissingTypes = async () => {
    if (isClassifying) return
    setIsClassifying(true)
    setClassificationStatus('')
    try {
      const result = await api.classifyProductTypesBulk({ limit: 10 })
      if (result?.labels) setProductTypeMap(result.labels)
      const processed = Number(result?.processed) || 0
      setClassificationStatus(
        result?.status === 'missing_api_key'
          ? `No OpenAI key found. Used cached/fallback labels for ${processed} SKU(s).`
          : `Classified ${processed} SKU(s).`,
      )
    } catch (e) {
      setClassificationStatus(e?.message || 'Classification failed')
    } finally {
      setIsClassifying(false)
    }
  }

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

  const largestCategoryName = useMemo(() => {
    if (!categoryCardStats.length) return '—'
    const top = categoryCardStats.reduce((a, b) => (b.count > a.count ? b : a))
    return top.c?.name ?? '—'
  }, [categoryCardStats])

  return (
    <div
      className="catalog-page"
      data-sku-count={products.length}
      data-apparel-count={n}
      data-apparel-avg-sellthrough={avgSellThrough}
      data-apparel-slow-movers={slowMovers}
    >
      <div className="fade-up delay-1 catalog-page-header">
        <div className="catalog-filter-chips">
          {CATS.map((c) => {
            const active = catFilter === c
            return (
              <button
                key={c}
                type="button"
                className={`catalog-filter-chip${active ? ' is-active' : ''}`}
                onClick={() => setCatFilter(c)}
              >
                {c}
              </button>
            )
          })}
          {PRODUCT_TYPE_FILTERS.map((t) => {
            const active = typeFilter === t.key
            return (
              <button
                key={t.key}
                type="button"
                className={`catalog-filter-chip${active ? ' is-active' : ''}`}
                onClick={() => setTypeFilter(t.key)}
              >
                {t.label}
              </button>
            )
          })}
          {exec && (
            <button
              type="button"
              className="catalog-filter-chip catalog-filter-chip--action"
              onClick={classifyMissingTypes}
              disabled={isClassifying}
            >
              {isClassifying ? 'Classifying...' : 'AI classify'}
            </button>
          )}
        </div>
      </div>
      {classificationStatus && (
        <div className="catalog-classify-status">{classificationStatus}</div>
      )}

      <div className={`fade-up delay-2 catalog-kpi-grid${exec ? '' : ' catalog-kpi-grid--3'}`}>
        <KpiCard
          className="catalog-kpi-tile catalog-kpi-tile--total"
          label="Total SKUs"
          value={n}
          sub={catFilter === 'All' ? 'All categories' : catFilter}
          accentColor="#60A5FA"
        />
        {exec ? (
          <>
            <KpiCard
              className={`catalog-kpi-tile catalog-kpi-tile--sellthrough ${sellThroughThresholdClass(avgSellThrough)}`}
              label="Avg sell-through"
              value={n ? `${avgSellThrough}%` : '—'}
              sub="Filtered range"
              accentColor="#34D399"
            />
            <KpiCard
              className="catalog-kpi-tile catalog-kpi-tile--highlight"
              label="Female bestseller"
              value={femaleBestsellerPct != null ? `${femaleBestsellerPct}%` : '—'}
              sub="Top F sell-through"
              accentColor="#FBBF24"
            />
          </>
        ) : (
          <KpiCard
            className="catalog-kpi-tile catalog-kpi-tile--highlight catalog-kpi-tile--compact-value"
            label="Largest group"
            value={largestCategoryName}
            sub="By SKU count in filter"
            accentColor="#FBBF24"
          />
        )}
        <KpiCard
          className="catalog-kpi-tile catalog-kpi-tile--alert"
          label="Slow movers"
          value={slowMovers}
          sub="Aging + risk"
          accentColor="#F87171"
        />
      </div>

      {n === 0 ? (
        <div className="catalog-empty fade-up delay-3">
          <IconApparel className="catalog-empty__icon" size={32} strokeWidth={1.5} aria-hidden />
          <p className="catalog-empty__title">No brands found</p>
          <p className="catalog-empty__hint">Try selecting a different filter above.</p>
        </div>
      ) : (
        <div className="fade-up delay-3 catalog-card-grid catalog-card-grid--3">
          {categoryCardStats.map(({ c, count, avg, atRisk }) => {
            const thresholdClass = sellThroughThresholdClass(avg)
            const cardSlug = catalogCardSlug(c.name)
            const cardInitial = String(c.name || '?').charAt(0).toUpperCase()
            return (
              <div
                key={c.name}
                className="catalog-card"
                data-card={cardSlug}
              >
                <div className="catalog-card__header" data-card={cardSlug}>
                  <span className="catalog-card__initial" aria-hidden="true">{cardInitial}</span>
                </div>

                <div className="catalog-card__body">
                  <div className="catalog-card__name">{toTitleCase(c.name)}</div>
                  <div className="catalog-card__meta">
                    {count} SKUs · Apparel
                  </div>
                  <div className="catalog-card__desc">{c.desc}</div>
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
