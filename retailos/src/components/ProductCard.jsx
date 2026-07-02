import { getSellThrough, getDaysInStore, getEffectiveLifecycleImportDate } from '../utils/lifecycle.js'
import { getShipmentDisplayLines, mergeShipmentMeta } from '../utils/shipmentDisplay.js'
import { toTitleCase } from '../utils/textFormat.js'
import useStore from '../store/useStore'
import { IconFootwear, IconApparel, IconAccessories, IconPackage, IconHot, IconTruck } from '../utils/icons.js'
import SaleBadge from './SaleBadge.jsx'
import StatusBadge from './StatusBadge.jsx'

function ProductCard({ sku, rank, onClick, metric, metricLabel, velocity, lowStock, rankTrend, delta, hideSalesCounts = false, className = '', showDayOverlay = false, showBrandPill = false }) {
  const photoMap = useStore((s) => s.photoMap)
  const shipmentMeta = useStore((s) => s.shipmentMeta)
  const activeSeason = useStore((s) => s.activeSeason)
  const photoUrl = photoMap[sku.sku] || null
  const displaySku = mergeShipmentMeta(sku, shipmentMeta, activeSeason)
  const shipmentLines = getShipmentDisplayLines(displaySku)

  const pct = getSellThrough(sku.sold_quantity, sku.quantity)
  const isBestseller = pct >= 40
  const isHot = pct >= 60

  const sellColor = isHot ? '#00e676' : pct >= 40 ? '#38bdf8' : '#ff8800'

  const thumbGradients = {
    Footwear: 'linear-gradient(135deg,#0a1a0a,#1a3a1a)',
    Apparel: 'linear-gradient(135deg,#1a0a2e,#2d1357)',
    Accessories: 'linear-gradient(135deg,#0a1a1a,#0d3333)',
  }
  const thumbBg = thumbGradients[sku.category] || 'linear-gradient(135deg,var(--ro-surface),var(--ro-surface-elevated))'

  const categoryIcon = {
    Footwear: <IconFootwear size={44} strokeWidth={1} />,
    Apparel: <IconApparel size={44} strokeWidth={1} />,
    Accessories: <IconAccessories size={44} strokeWidth={1} />,
  }
  const icon = categoryIcon[sku.category] || <IconPackage size={44} strokeWidth={1} />

  const pctDisplay = pct.toFixed(2)
  const lastImportDisplay = shipmentLines.primaryDate
  const secondaryShipment = shipmentLines.secondary

  const returnsCount = Number(sku.returnsCount) || 0
  const netRevenue = Number(
    sku.netRevenue != null ? sku.netRevenue : sku._salesRevenue
  ) || 0
  const avgSoldPrice = Number(sku.avg_price_sold) || 0
  const isRevenueMetric = metricLabel === 'Revenue'
  const isSellThroughMetric = metricLabel === 'Sell-through'
  const sellThroughPct = isSellThroughMetric
    ? Number(String(metric ?? `${pctDisplay}%`).replace('%', '').trim()) || pct
    : pct
  const sellTier = isSellThroughMetric
    ? (sellThroughPct >= 60 ? 'high' : sellThroughPct >= 30 ? 'mid' : 'low')
    : null
  const isNewToList = rankTrend != null && rankTrend.prevRank == null
  const rankLabel = isNewToList ? `↑ #${rank}` : `#${rank}`
  const rankDelta = (() => {
    if (rankTrend && rankTrend.prevRank != null) {
      const diff = rankTrend.prevRank - rankTrend.currentRank
      if (diff === 0) {
        return <span className="product-card-tile__rank-delta product-card-tile__rank-delta--flat">=</span>
      }
      const up = diff > 0
      return (
        <span className={`product-card-tile__rank-delta product-card-tile__rank-delta--${up ? 'up' : 'down'}`}>
          {up ? '↑' : '↓'}{Math.abs(diff)}
        </span>
      )
    }
    return delta || null
  })()
  const netRevenueDisplay = netRevenue.toLocaleString('en', { maximumFractionDigits: 0 })
  const daysInStore = getDaysInStore(getEffectiveLifecycleImportDate(displaySku))
  const brandLabel = String(sku.brand ?? '').trim()

  return (
    <div
      onClick={onClick}
      className={['product-card-tile', className].filter(Boolean).join(' ')}
      style={{
        background: 'var(--ro-surface)',
        border: '1px solid var(--ro-border)',
        borderRadius: '13px',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)'
        e.currentTarget.style.borderColor = 'var(--ro-border-hover)'
        e.currentTarget.style.boxShadow = 'var(--ro-shadow-card-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = ''
        e.currentTarget.style.borderColor = 'var(--ro-border)'
        e.currentTarget.style.boxShadow = ''
      }}
    >
      {/* Rank badge */}
      <div className="product-card-tile__rank-wrap" style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
        <div className="product-card-tile__rank" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', color: '#fff', fontFamily: '"DM Sans"', fontSize: 12, letterSpacing: '1px', padding: '2px 7px', borderRadius: 4 }}>
          {rankLabel}
        </div>
        {rankDelta && (
          <div className="product-card-tile__rank-delta-wrap">
            {rankDelta}
          </div>
        )}
      </div>

      {/* Top-right badges */}
      <div className="product-card-tile__top-right" style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
        {sku.sale_active ? <SaleBadge percent={sku.sale_percent} variant="overlay" /> : null}
        {!hideSalesCounts && isBestseller && (
          <span className="product-card-tile__hot-icon" aria-hidden>
            <IconHot size={18} strokeWidth={1.5} />
          </span>
        )}
      </div>

      <div
        className="product-card-tile__media"
        style={{
          aspectRatio: '1',
          position: 'relative',
          overflow: 'hidden',
          background: photoUrl ? '#000' : thumbBg,
        }}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={sku.product_name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              display: 'block',
            }}
            onError={(e) => {
              e.target.style.display = 'none'
              e.target.nextSibling.style.display = 'flex'
            }}
          />
        ) : null}

        <div
          style={{
            width: '100%',
            height: '100%',
            display: photoUrl ? 'none' : 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '44px',
            background: thumbBg,
            position: photoUrl ? 'absolute' : 'relative',
            top: 0,
            left: 0,
          }}
        >
          {icon}
        </div>

        <div
          className="product-card-tile__media-shade"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg,transparent 40%,rgba(0,0,0,0.5) 100%)',
            pointerEvents: 'none',
          }}
        />
        {showDayOverlay && (
          <span className="product-card-tile__day-overlay">Day {daysInStore}</span>
        )}
      </div>

      <div className="product-card-tile__body" style={{ padding: '11px 12px' }}>
        <div className="product-card-tile__title" style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ro-text)', marginBottom: '1px' }}>
          {toTitleCase(sku.product_name)}
        </div>
        <div
          className="product-card-tile__meta"
          style={{
            fontFamily: '"DM Sans"',
            fontSize: '9px',
            color: 'var(--ro-text-muted)',
            marginBottom: '7px',
          }}
        >
          {sku.sku} · {sku.category} ·{' '}
          {sku.gender === 'M' ? 'M' : sku.gender === 'F' ? 'F' : sku.gender === 'U' ? 'U' : 'K'}
        </div>

        <div
          className="product-card-tile__lastImport"
          style={{
            fontFamily: '"DM Sans"',
            fontSize: '9px',
            color: 'var(--ro-text-muted)',
            marginBottom: '7px',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexWrap: 'wrap',
          }}
        >
          <IconTruck size={11} strokeWidth={1.5} aria-hidden />
          <span>{shipmentLines.primaryLabel}</span>
          <span style={{ color: 'var(--ro-text-dim)', fontWeight: 600 }}>{lastImportDisplay}</span>
        </div>
        {secondaryShipment && (
          <div
            className="product-card-tile__priorImport"
            style={{
              fontFamily: '"DM Sans"',
              fontSize: '9px',
              color: 'var(--ro-text-muted)',
              marginBottom: '7px',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flexWrap: 'wrap',
            }}
          >
            <IconTruck size={11} strokeWidth={1.5} aria-hidden />
            <span>{secondaryShipment.season}</span>
            <span style={{ color: 'var(--ro-text-dim)', fontWeight: 600 }}>{secondaryShipment.dateDisplay}</span>
          </div>
        )}

        <div
          className="product-card-tile__avgSold"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 8px',
            marginBottom: '8px',
            borderRadius: 6,
            background: 'var(--ro-fill-faint)',
            border: '1px solid var(--ro-border)',
            fontFamily: '"DM Sans"',
          }}
        >
          <span
            style={{
              fontSize: '9px',
              color: 'var(--ro-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              whiteSpace: 'nowrap',
            }}
          >
            AVG sold
          </span>
          <span
            style={{
              fontSize: '12px',
              color: avgSoldPrice > 0 ? '#fbbf24' : 'var(--ro-text-dim)',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {avgSoldPrice.toFixed(2)}
          </span>
        </div>

        <div className="product-card-tile__metrics-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div
              className={`product-card-tile__metric${sellTier ? ` product-card-tile__metric--${sellTier}` : ''}`}
              style={{ fontFamily: '"DM Sans"', fontSize: '22px', color: isSellThroughMetric ? undefined : sellColor, lineHeight: 1 }}
            >
              {metric || `${pctDisplay}%`}
            </div>
            <div className="product-card-tile__metric-label" style={{ fontSize: '9px', color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              {isRevenueMetric ? (
                <span style={{ textTransform: 'none', letterSpacing: '0.2px' }}>
                  {returnsCount > 0
                    ? `€${netRevenueDisplay} net · ${returnsCount} return${returnsCount > 1 ? 's' : ''}`
                    : `€${netRevenueDisplay} revenue`}
                </span>
              ) : (
                metricLabel || 'Sell-through'
              )}
            </div>
            {isRevenueMetric && returnsCount > 0 && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 7px',
                  borderRadius: '20px',
                  background: 'rgba(255,136,0,0.1)',
                  border: '1px solid rgba(255,136,0,0.2)',
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#ff8800',
                  marginTop: '4px',
                }}
              >
                ↩ {returnsCount} return{returnsCount > 1 ? 's' : ''}
              </div>
            )}
          </div>
          {!hideSalesCounts ? (
            <div className="product-card-tile__sold-col" style={{ textAlign: 'right' }}>
              <div className="product-card-tile__sold" style={{ fontFamily: '"DM Sans"', fontSize: '10px', color: 'var(--ro-text-muted)' }}>
                {sku.sold_quantity} of {sku.quantity}
              </div>
              {velocity != null && (
                <div className="product-card-tile__velocity" style={{ fontFamily: '"DM Sans"', fontSize: '9px', color: 'var(--ro-text-dim)', marginTop: 1 }}>
                  {velocity}/wk
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="product-card-tile__chips" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '7px' }}>
          {sku.sale_active ? <SaleBadge percent={sku.sale_percent} /> : null}
          {!hideSalesCounts && isBestseller && (
            <StatusBadge variant="hot" className="product-card-tile__chip product-card-tile__chip--hot">
              Hot
            </StatusBadge>
          )}
          {showBrandPill && brandLabel && (
            <span className="product-card-tile__chip product-card-tile__chip--brand">
              {brandLabel.toUpperCase()}
            </span>
          )}
          {lowStock && (
            <StatusBadge variant="low-stock" className="product-card-tile__chip product-card-tile__chip--low">
              Low Stock
            </StatusBadge>
          )}
          <StatusBadge variant="season" className="product-card-tile__chip product-card-tile__chip--season">
            {sku.season}
          </StatusBadge>
        </div>
      </div>
    </div>
  )
}

export default ProductCard
