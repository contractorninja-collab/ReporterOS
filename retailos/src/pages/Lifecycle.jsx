import { useMemo, useState } from 'react'
import { normalizeGenderCodeForFilter } from '../utils/gender.js'
import { useStore } from '../store/useStore'
import { STATUS_COLORS, getProductLifecycleStatus } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import SkuTile from '../components/SkuTile'
import ProductDetailModal from '../components/ProductDetailModal'
import { IconPackage } from '../utils/icons.js'

const filters = ['All', 'Footwear', 'Apparel', 'Male', 'Female', 'Kids', 'Unisex']

const LANES = [
  { status: 'New Arrival', color: '#38bdf8' },
  { status: 'Active', color: '#00e676' },
  { status: 'Aging', color: '#fbbf24' },
  { status: 'Risk', color: '#ff8800' },
  { status: 'Clearance', color: '#ff3333' },
  { status: 'Outlet', color: '#c084fc' },
]

const LANE_CLASS = {
  'New Arrival': 'lifecycle-lane--new-arrival',
  Active: 'lifecycle-lane--active',
  Aging: 'lifecycle-lane--aging',
  Risk: 'lifecycle-lane--risk',
  Clearance: 'lifecycle-lane--clearance',
  Outlet: 'lifecycle-lane--outlet',
}

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
    color: 'var(--ro-text-muted)',
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
  const g = normalizeGenderCodeForFilter(sku.gender)
  if (activeFilter.includes('Footwear')) return (sku.category || '') === 'Footwear'
  if (activeFilter.includes('Apparel')) return (sku.category || '') === 'Apparel'
  if (activeFilter.includes('Male') && !activeFilter.includes('Female')) return g === 'M'
  if (activeFilter.includes('Female')) return g === 'F'
  if (activeFilter.includes('Kids')) return g === 'K'
  if (activeFilter.includes('Unisex')) return g === 'U'
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
  const shipmentMeta = useStore((s) => s.shipmentMeta)
  const activeSeason = useStore((s) => s.activeSeason)
  const [activeFilter, setActiveFilter] = useState('All')
  const [selectedSku, setSelectedSku] = useState(null)
  const [selectedStatus, setSelectedStatus] = useState(null)

  const products = useMemo(() => aggregateSkus(skus, shipmentMeta), [skus, shipmentMeta])

  const filteredSkus = useMemo(
    () =>
      products
        .filter((sku) => matchesSeason(sku, activeSeason))
        .filter((sku) => matchesActiveFilter(sku, activeFilter)),
    [products, activeSeason, activeFilter]
  )

  return (
    <div className="lifecycle-page">
      {/* SECTION 1 — Header row with filter pills */}
      <div className="lc-board-header fade-up delay-1">
        <div className="lc-board-header__label page-hero-mobile-hide">SKU Lifecycle Board</div>

        <div className="lifecycle-filter-row">
          {filters.map((f) => (
            <div
              key={f}
              className={`lc-filter-chip${activeFilter === f ? ' lc-filter-chip--active' : ''}`}
              onClick={() => setActiveFilter(f)}
            >
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 2 — Kanban board (each lane scrolls independently) */}
      <div className="fade-up delay-2 lifecycle-kanban-root">
        {LANES.map((lane) => {
          const laneSkus = filteredSkus.filter(
            (s) => getProductLifecycleStatus(s) === lane.status
          )
          return (
            <div
              key={lane.status}
              className={`lifecycle-lane ${LANE_CLASS[lane.status] || ''}`}
            >
              <div className="lifecycle-lane__header">
                <div className="lifecycle-lane__title">{lane.status}</div>
                <div className="lifecycle-lane__count">{laneSkus.length}</div>
              </div>

              <div className="lifecycle-lane__scroll">
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
                  <div className="lifecycle-lane__empty">
                    <IconPackage size={28} strokeWidth={1.25} aria-hidden />
                    <span>No SKUs</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* SECTION 3 — Rule engine explainer panel */}
      <div
        style={{
          background: 'var(--ro-surface)',
          border: '1px solid var(--ro-border)',
          borderRadius: '13px',
          padding: '18px',
          marginBottom: '14px',
        }}
        className="fade-up delay-3 lifecycle-rule-panel"
      >
        <div
          style={{
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--ro-text)',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
          }}
        >
          Lifecycle Rule Engine — How Status is Assigned Automatically
        </div>

        <div className="lifecycle-rule-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {rules.map((r) => (
            <div
              key={r.label}
              className="lifecycle-rule-card"
              style={{
                background: 'var(--ro-surface-elevated)',
                border: '1px solid var(--ro-border)',
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
              <div style={{ fontSize: '11px', color: 'var(--ro-text-dim)', lineHeight: 1.5 }}>{r.desc}</div>
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
            color: STATUS_COLORS[selectedStatus] ?? 'var(--ro-text-dim)',
            colorBg: `${STATUS_COLORS[selectedStatus] ?? '#64748b'}1a`,
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
