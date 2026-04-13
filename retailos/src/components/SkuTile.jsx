import { useEffect, useState } from 'react'
import {
  getLifecycleStatus,
  getDaysInStore,
  getSellThrough,
  STATUS_COLORS,
} from '../utils/lifecycle.js'
import useStore from '../store/useStore'
import { IconFootwear, IconApparel, IconAccessories, IconPackage } from '../utils/icons.js'

const categoryIcon = {
  Footwear: <IconFootwear size={20} strokeWidth={1} />,
  Apparel: <IconApparel size={20} strokeWidth={1} />,
  Accessories: <IconAccessories size={20} strokeWidth={1} />,
}
const categoryGrad = {
  Footwear: 'linear-gradient(135deg,#0a1a0a,#1a3a1a)',
  Apparel: 'linear-gradient(135deg,#1a0a2e,#2d1357)',
  Accessories: 'linear-gradient(135deg,#0a1a1a,#0d3333)',
}

function SkuTile({ sku, onClick }) {
  const photoUrl = useStore((s) => s.photoMap[sku.sku]) || null

  const days = getDaysInStore(sku.import_date)
  const pct = getSellThrough(sku.sold_quantity, sku.quantity)
  const status = getLifecycleStatus(sku.import_date, sku.sold_quantity, sku.quantity)
  const color = STATUS_COLORS[status]

  const [barWidth, setBarWidth] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setBarWidth(pct), 100)
    return () => clearTimeout(id)
  }, [pct])

  const icon = categoryIcon[sku.category] || <IconPackage size={20} strokeWidth={1} />
  const thumbBg = categoryGrad[sku.category] || 'linear-gradient(135deg,var(--ro-surface),var(--ro-surface-elevated))'

  return (
    <div
      style={{
        background: 'var(--ro-surface-elevated)',
        border: '1px solid var(--ro-border)',
        borderRadius: '8px',
        marginBottom: '7px',
        cursor: 'pointer',
        transition: 'all 0.14s',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--ro-border-hover)'
        e.currentTarget.style.transform = 'translateX(2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--ro-border)'
        e.currentTarget.style.transform = ''
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '2px', background: color }} />

      <div style={{ flex: 1, padding: '9px 10px 9px 8px', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--ro-text)',
            marginBottom: '2px',
            paddingLeft: '6px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {sku.product_name}
        </div>

        <div
          style={{
            fontFamily: '"DM Sans"',
            fontSize: '9px',
            color: 'var(--ro-text-muted)',
            marginBottom: '5px',
            paddingLeft: '6px',
          }}
        >
          {sku.sku}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingLeft: '6px',
          }}
        >
          <span style={{ fontFamily: '"DM Sans"', fontSize: '9px', color: 'var(--ro-text-muted)' }}>Day {days}</span>
          <span style={{ fontSize: '9px', fontWeight: 700, color }}>
            {Math.round(pct)}%
          </span>
        </div>

        <div
          style={{
            height: '3px',
            background: 'var(--ro-track-bg)',
            borderRadius: '2px',
            overflow: 'hidden',
            marginTop: '6px',
            marginLeft: '6px',
          }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: '2px',
              background: color,
              width: `${barWidth}%`,
              transition: 'width 1.1s ease',
            }}
          />
        </div>
      </div>

      <div
        style={{
          width: '56px',
          aspectRatio: '1',
          flexShrink: 0,
          alignSelf: 'center',
          overflow: 'hidden',
          background: photoUrl ? '#000' : thumbBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '0 7px 7px 0',
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
          <span style={{ fontSize: '20px' }}>{icon}</span>
        )}
      </div>
    </div>
  )
}

export default SkuTile
