import { getSellThrough } from '../utils/lifecycle.js'
import useStore from '../store/useStore'
import { IconFootwear, IconApparel, IconAccessories, IconPackage, IconHot, IconWarning } from '../utils/icons.js'

function ProductCard({ sku, rank, onClick, metric, metricLabel, velocity, lowStock, delta, hideSalesCounts = false }) {
  const photoMap = useStore((s) => s.photoMap)
  const photoUrl = photoMap[sku.sku] || null

  const pct = getSellThrough(sku.sold_quantity, sku.quantity)
  const isBestseller = pct >= 40
  const isHot = pct >= 60

  const sellColor = isHot ? '#00e676' : pct >= 40 ? '#38bdf8' : '#ff8800'

  const thumbGradients = {
    Footwear: 'linear-gradient(135deg,#0a1a0a,#1a3a1a)',
    Apparel: 'linear-gradient(135deg,#1a0a2e,#2d1357)',
    Accessories: 'linear-gradient(135deg,#0a1a1a,#0d3333)',
  }
  const thumbBg = thumbGradients[sku.category] || 'linear-gradient(135deg,#111117,#17171f)'

  const categoryIcon = {
    Footwear: <IconFootwear size={44} strokeWidth={1} />,
    Apparel: <IconApparel size={44} strokeWidth={1} />,
    Accessories: <IconAccessories size={44} strokeWidth={1} />,
  }
  const icon = categoryIcon[sku.category] || <IconPackage size={44} strokeWidth={1} />

  const pctDisplay = pct.toFixed(2)

  return (
    <div
      onClick={onClick}
      style={{
        background: '#111117',
        border: '1px solid rgba(255,255,255,0.055)',
        borderRadius: '13px',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)'
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'
        e.currentTarget.style.boxShadow = '0 18px 40px rgba(0,0,0,0.4)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = ''
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.055)'
        e.currentTarget.style.boxShadow = ''
      }}
    >
      {/* Rank badge */}
      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', color: '#fff', fontFamily: '"DM Sans"', fontSize: 12, letterSpacing: '1px', padding: '2px 7px', borderRadius: 4 }}>
          #{rank}
        </div>
        {delta && (
          <div style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', padding: '2px 5px', borderRadius: 4 }}>
            {delta}
          </div>
        )}
      </div>

      {/* Top-right badges */}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
        {lowStock && (
          <div style={{ background: 'rgba(255,51,51,0.85)', backdropFilter: 'blur(8px)', padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 3, fontFamily: '"DM Sans"', letterSpacing: '0.5px' }}>
            <IconWarning size={10} strokeWidth={2} /> LOW
          </div>
        )}
        {!hideSalesCounts && isBestseller && <IconHot size={18} strokeWidth={1.5} />}
      </div>

      <div
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
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg,transparent 40%,rgba(0,0,0,0.5) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      <div style={{ padding: '11px 12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#e4e4f0', marginBottom: '1px' }}>
          {sku.product_name}
        </div>
        <div
          style={{
            fontFamily: '"DM Sans"',
            fontSize: '9px',
            color: '#4a4a62',
            marginBottom: '7px',
          }}
        >
          {sku.sku} · {sku.category} · {sku.gender === 'M' ? 'M' : sku.gender === 'F' ? 'F' : 'K'}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontFamily: '"DM Sans"', fontSize: '22px', color: sellColor, lineHeight: 1 }}>
              {metric || `${pctDisplay}%`}
            </div>
            <div style={{ fontSize: '9px', color: '#4a4a62', textTransform: 'uppercase', letterSpacing: '1px' }}>
              {metricLabel || 'Sell-through'}
            </div>
          </div>
          {!hideSalesCounts ? (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: '"DM Sans"', fontSize: '10px', color: '#4a4a62' }}>
                {sku.sold_quantity} of {sku.quantity}
              </div>
              {velocity != null && (
                <div style={{ fontFamily: '"DM Sans"', fontSize: '9px', color: '#9090aa', marginTop: 1 }}>
                  {velocity}/wk
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '7px' }}>
          {!hideSalesCounts && isBestseller && (
            <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(0,230,118,0.1)', color: '#00e676' }}>
              Hot
            </span>
          )}
          {lowStock && (
            <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,51,51,0.1)', color: '#ff3333' }}>
              Low Stock
            </span>
          )}
          <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(56,189,248,0.1)', color: '#38bdf8' }}>
            {sku.season}
          </span>
        </div>
      </div>
    </div>
  )
}

export default ProductCard
