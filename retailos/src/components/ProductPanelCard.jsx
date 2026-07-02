import { getSellThrough, getDaysInStore, getEffectiveLifecycleImportDate } from '../utils/lifecycle'
import { getShipmentDisplayLines, mergeShipmentMeta } from '../utils/shipmentDisplay.js'
import useStore from '../store/useStore'
import { useState, useEffect } from 'react'
import { IconFootwear, IconApparel, IconAccessories, IconPackage, IconHot, IconTruck } from '../utils/icons.js'
import SaleBadge from './SaleBadge.jsx'
import StatusBadge from './StatusBadge.jsx'

export default function ProductPanelCard({
  sku,
  status,
  color,
  colorBg,
  statusLabel,
  statusIcon,
  onClick,
  totalImported = 0,
  salesVisible = true,
  layout = 'tile',
}) {
  const photoMap = useStore((s) => s.photoMap)
  const shipmentMeta = useStore((s) => s.shipmentMeta)
  const activeSeason = useStore((s) => s.activeSeason)
  const photoUrl = photoMap[sku.sku] || null
  const displaySku = mergeShipmentMeta(sku, shipmentMeta, activeSeason)
  const shipmentLines = getShipmentDisplayLines(displaySku)
  const pct = getSellThrough(sku.sold_quantity, sku.quantity)
  const pctDisplay = pct.toFixed(2)
  const days = getDaysInStore(getEffectiveLifecycleImportDate(displaySku))
  const remaining = Math.max(0, (Number(sku.quantity) || 0) - (Number(sku.sold_quantity) || 0))
  const lowStock = remaining <= 3 && remaining > 0
  const outOfStock = remaining === 0
  const isFire = salesVisible && pct >= 60
  const stockColor = outOfStock ? '#ff3333' : lowStock ? '#ff8800' : '#00e676'

  const categoryIcon = {
    Footwear: <IconFootwear size={42} strokeWidth={1} />,
    Apparel: <IconApparel size={42} strokeWidth={1} />,
    Accessories: <IconAccessories size={42} strokeWidth={1} />,
  }
  const categoryIconRow = {
    Footwear: <IconFootwear size={28} strokeWidth={1} />,
    Apparel: <IconApparel size={28} strokeWidth={1} />,
    Accessories: <IconAccessories size={28} strokeWidth={1} />,
  }
  const categoryGrad = {
    Footwear: 'linear-gradient(135deg,#0a1a0a,#1a3a1a)',
    Apparel: 'linear-gradient(135deg,#1a0a2e,#2d1357)',
    Accessories: 'linear-gradient(135deg,#0a1a1a,#0d3333)',
  }
  const thumbBg = categoryGrad[sku.category] || 'linear-gradient(135deg,var(--ro-surface),var(--ro-surface-elevated))'
  const icon = categoryIcon[sku.category] || <IconPackage size={42} strokeWidth={1} />
  const iconRow = categoryIconRow[sku.category] || <IconPackage size={28} strokeWidth={1} />

  const [barWidth, setBarWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setBarWidth(pct), 100)
    return () => clearTimeout(t)
  }, [pct])

  const [hover, setHover] = useState(false)

  const lastImportDisplay = shipmentLines.primaryDate
  const secondaryShipment = shipmentLines.secondary

  const outerStyle = {
    background: 'var(--ro-surface-elevated)',
    border: hover ? '1px solid var(--ro-border-hover)' : '1px solid var(--ro-border)',
    borderRadius: '11px',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'all 0.18s',
    position: 'relative',
    transform: hover ? 'translateY(-3px)' : 'none',
    boxShadow: hover ? 'var(--ro-shadow-card-hover)' : 'none',
  }

  const outerRowStyle = {
    ...outerStyle,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'stretch',
    transform: hover ? 'translateY(-1px)' : 'none',
  }

  if (layout === 'row') {
    return (
      <div
        data-status={status}
        className="product-panel-card-row"
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={outerRowStyle}
      >
        <div
          style={{
            width: 100,
            flexShrink: 0,
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
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
              }}
            >
              {iconRow}
            </div>
          )}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg,transparent 50%,rgba(0,0,0,0.45) 100%)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 5,
              left: 5,
              zIndex: 2,
              fontSize: 8,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              padding: '2px 5px',
              borderRadius: 4,
              background: colorBg,
              color,
            }}
          >
            {statusIcon} {statusLabel}
          </div>
          {isFire && (
            <div style={{ position: 'absolute', top: 5, right: 5, zIndex: 2, fontSize: 12 }}>
              <IconHot size={12} strokeWidth={1.5} />
            </div>
          )}
          <div
            style={{
              position: 'absolute',
              bottom: 5,
              right: 6,
              zIndex: 2,
              fontFamily: '"DM Sans"',
              fontSize: 8,
              color: 'color-mix(in srgb, var(--ro-text) 62%, transparent)',
            }}
          >
            Day {days}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, padding: '10px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--ro-text)',
              marginBottom: 4,
              lineHeight: 1.3,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {sku.product_name}
          </div>
          <div
            style={{
              fontFamily: '"DM Sans"',
              fontSize: 9,
              color: 'var(--ro-text-muted)',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <span>{sku.sku}</span>
            {salesVisible && sku.price_tag > 0 && (
              <span style={{ color: 'var(--ro-text-dim)', fontWeight: 600 }}>€{sku.price_tag}</span>
            )}
          </div>
          <div
            className="product-panel-card-row__lastImport"
            style={{
              fontFamily: '"DM Sans"',
              fontSize: 8,
              color: 'var(--ro-text-muted)',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flexWrap: 'wrap',
            }}
          >
            <IconTruck size={10} strokeWidth={1.5} aria-hidden />
            <span>{shipmentLines.primaryLabel}</span>
            <span style={{ color: 'var(--ro-text-dim)', fontWeight: 600 }}>{lastImportDisplay}</span>
          </div>
          {secondaryShipment && (
            <div
              className="product-panel-card-row__priorImport"
              style={{
                fontFamily: '"DM Sans"',
                fontSize: 8,
                color: 'var(--ro-text-muted)',
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                flexWrap: 'wrap',
              }}
            >
              <IconTruck size={10} strokeWidth={1.5} aria-hidden />
              <span>{secondaryShipment.season}</span>
              <span style={{ color: 'var(--ro-text-dim)', fontWeight: 600 }}>{secondaryShipment.dateDisplay}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <div>
              {salesVisible ? (
                <>
                  <div
                    style={{
                      fontFamily: '"DM Sans"',
                      fontSize: 16,
                      lineHeight: 1,
                      color: 'var(--ro-heading)',
                      letterSpacing: '0.5px',
                    }}
                  >
                    €{sku.price_tag || 0}
                  </div>
                  {sku.sold_quantity > 0 && sku.avg_price_sold > 0 && (
                    <div
                      style={{
                        fontFamily: '"DM Sans"',
                        fontSize: 9,
                        color: sku.avg_price_sold < sku.price_tag ? '#fbbf24' : '#00e676',
                        marginTop: 2,
                      }}
                    >
                      Avg sold €{sku.avg_price_sold.toFixed(2)}
                    </div>
                  )}
                </>
              ) : null}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: '"DM Sans"', fontSize: 10, fontWeight: 600, color: stockColor }}>
                {remaining} left
              </div>
              {salesVisible ? (
                <>
                  <div style={{ fontSize: 8, color: 'var(--ro-text-muted)' }}>
                    {sku.sold_quantity}/{sku.quantity} sold
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--ro-text-muted)', marginTop: 2, fontFamily: '"DM Sans"' }}>
                    Total units: {totalImported}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 8, color: 'var(--ro-text-muted)', marginTop: 2, fontFamily: '"DM Sans"' }}>
                  Total units: {totalImported}
                </div>
              )}
            </div>
          </div>
          {salesVisible ? (
            <>
              <div
                style={{
                  height: 3,
                  background: 'var(--ro-track-bg)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  marginTop: 6,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    borderRadius: 2,
                    background: color,
                    width: `${barWidth}%`,
                    transition: 'width 1s ease',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 6 }}>
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    padding: '2px 5px',
                    borderRadius: 4,
                    background: colorBg,
                    color,
                  }}
                >
                  {pctDisplay}% sold
                </span>
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '2px 5px',
                    borderRadius: 4,
                    background: 'var(--ro-track-bg)',
                    color: 'var(--ro-text-dim)',
                  }}
                >
                  {sku.brand}
                </span>
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '2px 5px',
                    borderRadius: 4,
                    background: 'var(--ro-track-bg)',
                    color: 'var(--ro-text-dim)',
                  }}
                >
                  {sku.size}
                </span>
                {sku.sale_active ? <SaleBadge percent={sku.sale_percent} /> : null}
                {lowStock && (
                  <StatusBadge variant="low-stock" className="product-panel-card-tile__chip">
                    Low stock
                  </StatusBadge>
                )}
                {outOfStock && (
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      padding: '2px 5px',
                      borderRadius: 4,
                      background: 'rgba(255,51,51,0.12)',
                      color: '#ff3333',
                    }}
                  >
                    Out
                  </span>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 6 }}>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  padding: '2px 5px',
                  borderRadius: 4,
                  background: 'var(--ro-track-bg)',
                  color: 'var(--ro-text-dim)',
                }}
              >
                {sku.brand}
              </span>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 5px',
                  borderRadius: 4,
                  background: 'var(--ro-track-bg)',
                  color: 'var(--ro-text-dim)',
                }}
              >
                {sku.size}
              </span>
              {sku.sale_active ? <SaleBadge percent={sku.sale_percent} /> : null}
              {lowStock && (
                <StatusBadge variant="low-stock" className="product-panel-card-tile__chip">
                  Low stock
                </StatusBadge>
              )}
              {outOfStock && (
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    padding: '2px 5px',
                    borderRadius: 4,
                    background: 'rgba(255,51,51,0.12)',
                    color: '#ff3333',
                  }}
                >
                  Out
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      data-status={status}
      className="product-panel-card-tile"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={outerStyle}
    >
      <div
        className="product-panel-card-tile__media"
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
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '42px',
            }}
          >
            {icon}
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg,transparent 50%,rgba(0,0,0,0.55) 100%)',
            pointerEvents: 'none',
          }}
        />
        <div
          className="product-panel-card-tile__badge"
          style={{
            position: 'absolute',
            top: 7,
            left: 7,
            zIndex: 2,
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            padding: '2px 7px',
            borderRadius: 4,
            background: colorBg,
            color,
          }}
        >
          {statusIcon} {statusLabel}
        </div>
        {isFire && (
          <div
            className="product-panel-card-tile__hot"
            style={{ position: 'absolute', top: 7, right: 7, zIndex: 2, fontSize: 15 }}
          >
            <IconHot size={15} strokeWidth={1.5} />
          </div>
        )}
        {sku.sale_active ? (
          <div style={{ position: 'absolute', bottom: 7, left: 7, zIndex: 2 }}>
            <SaleBadge percent={sku.sale_percent} variant="overlay" />
          </div>
        ) : null}
        <div
          className="product-panel-card-tile__day"
          style={{
            position: 'absolute',
            bottom: 7,
            right: 8,
            zIndex: 2,
            fontFamily: '"DM Sans"',
            fontSize: 9,
            color: 'color-mix(in srgb, var(--ro-text) 62%, transparent)',
          }}
        >
          Day {days}
        </div>
      </div>

      <div className="product-panel-card-tile__body" style={{ padding: '10px 11px 11px' }}>
        <div
          className="product-panel-card-tile__title"
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--ro-text)',
            marginBottom: 3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {sku.product_name}
        </div>
        <div
          className="product-panel-card-tile__meta"
          style={{
            fontFamily: '"DM Sans"',
            fontSize: 9,
            color: 'var(--ro-text-muted)',
            marginBottom: 8,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>{sku.sku}</span>
          {salesVisible && sku.price_tag > 0 && (
            <span style={{ color: 'var(--ro-text-dim)', fontWeight: 600 }}>€{sku.price_tag}</span>
          )}
        </div>
        <div
          className="product-panel-card-tile__lastImport"
          style={{
            fontFamily: '"DM Sans"',
            fontSize: 9,
            color: 'var(--ro-text-muted)',
            marginBottom: 8,
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
            className="product-panel-card-tile__priorImport"
            style={{
              fontFamily: '"DM Sans"',
              fontSize: 9,
              color: 'var(--ro-text-muted)',
              marginBottom: 8,
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
          className="product-panel-card-tile__priceRow"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 6 }}
        >
          <div>
            {salesVisible ? (
              <>
                <div
                  className="product-panel-card-tile__priceMain"
                  style={{
                    fontFamily: '"DM Sans"',
                    fontSize: 18,
                    lineHeight: 1,
                    color: 'var(--ro-heading)',
                    letterSpacing: '0.5px',
                  }}
                >
                  €{sku.price_tag || 0}
                </div>
                {sku.sold_quantity > 0 && sku.avg_price_sold > 0 && (
                  <div
                    className="product-panel-card-tile__avg"
                    style={{
                      fontFamily: '"DM Sans"',
                      fontSize: 10,
                      color: sku.avg_price_sold < sku.price_tag ? '#fbbf24' : '#00e676',
                      marginTop: 3,
                    }}
                  >
                    Avg sold €{sku.avg_price_sold.toFixed(2)}
                  </div>
                )}
              </>
            ) : null}
          </div>
          <div className="product-panel-card-tile__stats" style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: '"DM Sans"', fontSize: 11, fontWeight: 600, color: stockColor }}>
              {remaining} left
            </div>
            {salesVisible ? (
              <>
                <div style={{ fontSize: 9, color: 'var(--ro-text-muted)' }}>
                  {sku.sold_quantity}/{sku.quantity} sold
                </div>
                <div
                  className="product-panel-card-tile__imported"
                  style={{ fontSize: 9, color: 'var(--ro-text-muted)', marginTop: 4, fontFamily: '"DM Sans"' }}
                >
                  Total units: {totalImported}
                </div>
              </>
            ) : (
              <div
                className="product-panel-card-tile__imported"
                style={{ fontSize: 9, color: 'var(--ro-text-muted)', marginTop: 4, fontFamily: '"DM Sans"' }}
              >
                Total units: {totalImported}
              </div>
            )}
          </div>
        </div>
        {salesVisible ? (
          <>
            <div
              className="product-panel-card-tile__bar"
              style={{
                height: 3,
                background: 'var(--ro-track-bg)',
                borderRadius: 2,
                overflow: 'hidden',
                marginTop: 8,
              }}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: 2,
                  background: color,
                  width: `${barWidth}%`,
                  transition: 'width 1s ease',
                }}
              />
            </div>
            <div className="product-panel-card-tile__chips" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7 }}>
              <span
                className="product-panel-card-tile__chip"
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: colorBg,
                  color,
                }}
              >
                {pctDisplay}% sold
              </span>
          <span
            className="product-panel-card-tile__chip"
            style={{
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--ro-track-bg)',
              color: 'var(--ro-text-dim)',
            }}
          >
            {sku.brand}
          </span>
          <span
            className="product-panel-card-tile__chip"
            style={{
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--ro-track-bg)',
              color: 'var(--ro-text-dim)',
            }}
          >
            {sku.size}
          </span>
          {lowStock && (
            <StatusBadge variant="low-stock" className="product-panel-card-tile__chip">
              Low stock
            </StatusBadge>
          )}
          {outOfStock && (
            <span
              className="product-panel-card-tile__chip"
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(255,51,51,0.12)',
                color: '#ff3333',
              }}
            >
              Out
            </span>
          )}
            </div>
          </>
        ) : (
          <div className="product-panel-card-tile__chips" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7 }}>
            <span
              className="product-panel-card-tile__chip"
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--ro-track-bg)',
                color: 'var(--ro-text-dim)',
              }}
            >
              {sku.brand}
            </span>
            <span
              className="product-panel-card-tile__chip"
              style={{
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--ro-track-bg)',
                color: 'var(--ro-text-dim)',
              }}
            >
              {sku.size}
            </span>
            {lowStock && (
              <StatusBadge variant="low-stock" className="product-panel-card-tile__chip">
                Low stock
              </StatusBadge>
            )}
            {outOfStock && (
              <span
                className="product-panel-card-tile__chip"
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(255,51,51,0.12)',
                  color: '#ff3333',
                }}
              >
                Out
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
