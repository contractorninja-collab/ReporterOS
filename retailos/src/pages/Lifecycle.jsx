import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { getLifecycleStatus, STATUS_COLORS } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import SkuTile from '../components/SkuTile'
import ProductDetailModal from '../components/ProductDetailModal'

const filters = ['All', 'Footwear', 'Apparel', 'Male', 'Female', 'Kids']

const LANES = [
  { status: 'New Arrival', color: '#38bdf8' },
  { status: 'Active', color: '#00e676' },
  { status: 'Aging', color: '#fbbf24' },
  { status: 'Risk', color: '#ff8800' },
  { status: 'Clearance', color: '#ff3333' },
  { status: 'Outlet', color: '#c084fc' },
]

const rules = [
  {
    color: '#38bdf8',
    label: 'DAY 0 – 30 → NEW ARRIVAL',
    desc: 'Full-price. Feature in new arrivals zone. Track first-week velocity to project lifecycle.',
  },
  {
    color: '#00e676',
    label: 'DAY 31 – 90 → ACTIVE',
    desc: 'Core selling window. If sell-through <30% at day 60 → early risk flag triggers.',
  },
  {
    color: '#fbbf24',
    label: 'DAY 91 – 150 → AGING / RISK',
    desc: 'Merch to high-traffic. Bundle logic. <20% sell-through triggers risk + -10% nudge.',
  },
  {
    color: '#ff3333',
    label: 'DAY 150+ → CLEARANCE',
    desc: 'Mandatory -20% to -40% markdown. High-visibility sale placement. Free shelf for new season.',
  },
  {
    color: '#c084fc',
    label: 'DAY 180+ → OUTLET',
    desc: 'Final push pricing. Move to outlet channel or bulk lot. Target 100% sell-through at any margin.',
  },
  {
    color: '#4a4a62',
    label: 'STOCK MODIFIER RULE',
    desc: 'High sell-through (>60%) can hold a SKU in Active status longer. Low stock + high demand triggers reorder alert.',
  },
]

function matchesSeason(sku, activeSeason) {
  const s = activeSeason == null ? '' : String(activeSeason)
  if (s === '' || s.toLowerCase() === 'all') return true
  return (sku.season || '') === s
}

function matchesActiveFilter(sku, activeFilter) {
  if (activeFilter === 'All') return true
  const g = (sku.gender || '').toUpperCase().slice(0, 1)
  if (activeFilter.includes('Footwear')) return (sku.category || '') === 'Footwear'
  if (activeFilter.includes('Apparel')) return (sku.category || '') === 'Apparel'
  if (activeFilter.includes('Male') && !activeFilter.includes('Female')) return g === 'M'
  if (activeFilter.includes('Female')) return g === 'F'
  if (activeFilter.includes('Kids')) return g === 'K'
  return true
}

const STATUS_ICONS = {
  'New Arrival': '●',
  Active: '●',
  Aging: '●',
  Risk: '●',
  Clearance: '●',
  Outlet: '●',
}

export function Lifecycle() {
  const skus = useStore((s) => s.skus)
  const activeSeason = useStore((s) => s.activeSeason)
  const [activeFilter, setActiveFilter] = useState('All')
  const [selectedSku, setSelectedSku] = useState(null)
  const [selectedStatus, setSelectedStatus] = useState(null)

  const products = useMemo(() => aggregateSkus(skus), [skus])

  const filteredSkus = useMemo(
    () =>
      products
        .filter((sku) => matchesSeason(sku, activeSeason))
        .filter((sku) => matchesActiveFilter(sku, activeFilter)),
    [products, activeSeason, activeFilter]
  )

  return (
    <div>
      {/* SECTION 1 — Header row with filter pills */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px',
        }}
        className="fade-up delay-1"
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
              background: '#ff3333',
              animation: 'blink 2s infinite',
            }}
          />
          SKU LIFECYCLE BOARD
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {filters.map((f) => (
            <div
              key={f}
              onClick={() => setActiveFilter(f)}
              style={{
                padding: '5px 11px',
                borderRadius: '20px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.13s',
                background: activeFilter === f ? 'rgba(255,51,51,0.1)' : '#17171f',
                border:
                  activeFilter === f
                    ? '1px solid rgba(255,51,51,0.25)'
                    : '1px solid rgba(255,255,255,0.055)',
                color: activeFilter === f ? '#ff3333' : '#4a4a62',
              }}
            >
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 2 — Kanban board */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: '8px',
          marginBottom: '22px',
        }}
        className="fade-up delay-2"
      >
        {LANES.map((lane) => {
          const laneSkus = filteredSkus.filter(
            (s) => getLifecycleStatus(s.import_date, s.sold_quantity, s.quantity) === lane.status
          )
          return (
            <div
              key={lane.status}
              style={{
                background: '#111117',
                border: '1px solid rgba(255,255,255,0.055)',
                borderRadius: '12px',
                padding: '12px',
                minHeight: '340px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '11px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1.5px',
                    color: lane.color,
                  }}
                >
                  <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: lane.color }} />
                  {lane.status}
                </div>
                <div
                  style={{
                    fontFamily: '"DM Sans"',
                    fontSize: '10px',
                    color: '#4a4a62',
                    background: '#17171f',
                    padding: '2px 6px',
                    borderRadius: '4px',
                  }}
                >
                  {laneSkus.length}
                </div>
              </div>

              {laneSkus.map((sku) => (
                <SkuTile
                  key={sku.id ?? sku.sku}
                  sku={sku}
                  onClick={() => {
                    setSelectedSku(sku)
                    setSelectedStatus(lane.status)
                  }}
                />
              ))}

              {laneSkus.length === 0 && (
                <div style={{ textAlign: 'center', color: '#4a4a62', fontSize: '11px', marginTop: '20px' }}>No SKUs</div>
              )}
            </div>
          )
        })}
      </div>

      {/* SECTION 3 — Rule engine explainer panel */}
      <div
        style={{
          background: '#111117',
          border: '1px solid rgba(255,255,255,0.055)',
          borderRadius: '13px',
          padding: '18px',
          marginBottom: '14px',
        }}
        className="fade-up delay-3"
      >
        <div
          style={{
            fontSize: '13px',
            fontWeight: 700,
            color: '#e4e4f0',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
          }}
        >
          Lifecycle Rule Engine — How Status is Assigned Automatically
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {rules.map((r) => (
            <div
              key={r.label}
              style={{
                background: '#17171f',
                border: '1px solid rgba(255,255,255,0.055)',
                borderRadius: '9px',
                padding: '13px',
              }}
            >
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: r.color,
                  marginBottom: '5px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {r.label}
              </div>
              <div style={{ fontSize: '11px', color: '#9090aa', lineHeight: 1.5 }}>{r.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {selectedSku && selectedStatus && (
        <ProductDetailModal
          sku={selectedSku}
          status={selectedStatus}
          statusData={{
            label: selectedStatus,
            color: STATUS_COLORS[selectedStatus] ?? '#9090aa',
            colorBg: `${STATUS_COLORS[selectedStatus] ?? '#9090aa'}1a`,
            icon: STATUS_ICONS[selectedStatus] ?? '',
          }}
          onClose={() => {
            setSelectedSku(null)
            setSelectedStatus(null)
          }}
        />
      )}
    </div>
  )
}
