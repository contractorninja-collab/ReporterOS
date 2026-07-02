import { useEffect, useState } from 'react'
import {
  getDaysInStore,
  getEffectiveLifecycleImportDate,
  getSellThrough,
} from '../utils/lifecycle.js'
import { getShipmentDisplayLines, mergeShipmentMeta } from '../utils/shipmentDisplay.js'
import { toTitleCase } from '../utils/textFormat.js'
import useStore from '../store/useStore'
import { IconFootwear, IconApparel, IconAccessories, IconPackage, IconClock, IconTruck } from '../utils/icons.js'

const categoryIcon = {
  Footwear: <IconFootwear size={20} strokeWidth={1} />,
  Apparel: <IconApparel size={20} strokeWidth={1} />,
  Accessories: <IconAccessories size={20} strokeWidth={1} />,
}

function getSellThroughDisplay(pct) {
  if (pct >= 60) {
    return { textColor: '#15803D', barColor: '#16A34A', tier: 'high' }
  }
  if (pct >= 30) {
    return { textColor: '#D97706', barColor: '#D97706', tier: 'mid' }
  }
  return { textColor: '#DC2626', barColor: '#DC2626', tier: 'low' }
}

function SkuTile({ sku, onClick }) {
  const photoUrl = useStore((s) => s.photoMap[sku.sku]) || null
  const shipmentMeta = useStore((s) => s.shipmentMeta)
  const activeSeason = useStore((s) => s.activeSeason)
  const displaySku = mergeShipmentMeta(sku, shipmentMeta, activeSeason)
  const shipmentLines = getShipmentDisplayLines(displaySku)

  const days = getDaysInStore(getEffectiveLifecycleImportDate(displaySku))
  const pct = getSellThrough(sku.sold_quantity, sku.quantity)
  const sellDisplay = getSellThroughDisplay(pct)
  const lastImportDisplay = shipmentLines.primaryDate
  const secondaryShipment = shipmentLines.secondary

  const [barWidth, setBarWidth] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setBarWidth(pct), 100)
    return () => clearTimeout(id)
  }, [pct])

  const icon = categoryIcon[sku.category] || <IconPackage size={20} strokeWidth={1} />

  return (
    <div className="sku-tile-card" onClick={onClick}>
      <div className="sku-tile-card__inner">
        <div className="sku-tile-card__media">
          {photoUrl ? (
            <img src={photoUrl} alt={sku.product_name} className="sku-tile-card__photo" />
          ) : (
            <span className="sku-tile-card__placeholder" aria-hidden>
              {icon}
            </span>
          )}
        </div>

        <div className="sku-tile-card__body">
          <div className="sku-tile-card__title">{toTitleCase(sku.product_name)}</div>
          <div className="sku-tile-card__sku">{sku.sku}</div>

          <div className="sku-tile-card__lastImport">
            <IconClock size={10} strokeWidth={1.5} aria-hidden />
            <span>{shipmentLines.primaryLabel} {lastImportDisplay}</span>
          </div>
          {secondaryShipment && (
            <div className="sku-tile-card__priorImport">
              <IconTruck size={10} strokeWidth={1.5} aria-hidden />
              <span>{secondaryShipment.season} · {secondaryShipment.dateDisplay}</span>
            </div>
          )}

          <div className="sku-tile-card__stats">
            <span className="sku-tile-card__days">Day {days}</span>
            <span
              className={`sku-tile-card__pct sku-tile-card__pct--${sellDisplay.tier}`}
              style={{ color: sellDisplay.textColor }}
            >
              {Math.round(pct)}%
            </span>
          </div>

          <div className="sku-tile-card__bar-track">
            <div
              className="sku-tile-card__bar-fill"
              style={{ width: `${barWidth}%`, background: sellDisplay.barColor }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SkuTile
