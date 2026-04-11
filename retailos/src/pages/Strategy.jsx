import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import { isExecutive } from '../utils/roles'
import { getLifecycleStatus, getSellThrough } from '../utils/lifecycle'
import { aggregateSkus } from '../utils/aggregateSkus'
import StrategyItem from '../components/StrategyItem'
import { IconLock } from '../utils/icons.js'

export function Strategy() {
  const skus = useStore((s) => s.skus)
  const activeUser = useStore((s) => s.activeUser)
  const products = useMemo(() => aggregateSkus(skus), [skus])

  const insights = useMemo(() => {
    const needsAction = products.filter((sku) => {
      const status = getLifecycleStatus(sku.import_date, sku.sold_quantity, sku.quantity)
      return status === 'Clearance' || status === 'Outlet'
    })
    const reorderCount = products.filter(
      (sku) => getSellThrough(sku.sold_quantity, sku.quantity) >= 60
    )
    const merchNeeded = products.filter((sku) => {
      const status = getLifecycleStatus(sku.import_date, sku.sold_quantity, sku.quantity)
      return status === 'Aging' || status === 'Risk'
    })
    return [
      {
        number: needsAction.length,
        label: 'SKUs need immediate action',
        desc: 'Clearance + outlet items — discount pricing required within 7 days to free cash and shelf space.',
        color: '#ff3333',
      },
      {
        number: reorderCount.length,
        label: 'Reorder candidates',
        desc: 'Bestsellers at 60%+ sell-through with strong daily velocity. Stockout risk within 2–3 weeks.',
        color: '#00e676',
      },
      {
        number: merchNeeded.length,
        label: 'Visual merch push needed',
        desc: 'Aging & at-risk SKUs that could be rescued with front-of-store placement and window rotation.',
        color: '#fbbf24',
      },
    ]
  }, [products])

  const rotationActions = useMemo(() => {
    const out = []

    const clearance = products.filter((sku) => {
      const st = getLifecycleStatus(sku.import_date, sku.sold_quantity, sku.quantity)
      return st === 'Clearance'
    })
    for (const sku of clearance) {
      if (out.length >= 6) break
      out.push({
        key: `md-${sku.sku}`,
        icon: null,
        title: `${sku.product_name || 'SKU'} — ${sku.sku}`,
        description: 'Apply aggressive markdown (-30% or more) to move units before the outlet transition.',
        urgency: 'critical',
        urgencyLabel: 'Do today',
      })
    }

    const risk = products.filter((sku) => {
      const st = getLifecycleStatus(sku.import_date, sku.sold_quantity, sku.quantity)
      return st === 'Risk'
    })
    for (const sku of risk) {
      if (out.length >= 6) break
      out.push({
        key: `disp-${sku.sku}`,
        icon: null,
        title: `${sku.product_name || 'SKU'} — ${sku.sku}`,
        description: 'Move to front-of-store display and high-traffic zone to lift sell-through this week.',
        urgency: 'warning',
        urgencyLabel: 'This week',
      })
    }

    for (const sku of products) {
      if (out.length >= 6) break
      const st = getLifecycleStatus(sku.import_date, sku.sold_quantity, sku.quantity)
      const pct = getSellThrough(sku.sold_quantity, sku.quantity)
      if (pct >= 60 && st !== 'Clearance') {
        out.push({
          key: `reorder-${sku.sku}`,
          icon: null,
          title: `${sku.product_name || 'SKU'} — ${sku.sku}`,
          description: 'Strong sell-through — trigger reorder to avoid stockout in the next 2–3 weeks.',
          urgency: 'opportunity',
          urgencyLabel: 'Opportunity',
        })
      }
    }

    const agingByCat = new Map()
    for (const sku of products) {
      const st = getLifecycleStatus(sku.import_date, sku.sold_quantity, sku.quantity)
      if (st !== 'Aging') continue
      const cat = (sku.category || 'Uncategorized').trim()
      if (!agingByCat.has(cat)) agingByCat.set(cat, [])
      agingByCat.get(cat).push(sku)
    }
    for (const [cat, list] of agingByCat) {
      if (out.length >= 6) break
      if (list.length < 2) continue
      const a = list[0]
      const b = list[1]
      out.push({
        key: `bundle-${cat}`,
        icon: null,
        title: `Bundle opportunity — ${cat}`,
        description: `Pair ${a.product_name || a.sku} with ${b.product_name || b.sku} in a -15% bundle to clear aging stock.`,
        urgency: 'consider',
        urgencyLabel: 'Consider',
      })
    }

    return out.slice(0, 6)
  }, [products])

  if (!isExecutive(activeUser)) {
    return (
      <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}><IconLock size={48} strokeWidth={1.5} /></div>
        <h2 style={{ fontFamily: '"DM Sans"', fontSize: 22, letterSpacing: '2px', color: '#fff', margin: '0 0 8px' }}>EXECUTIVE ACCESS ONLY</h2>
        <p style={{ fontSize: 13, color: '#4a4a62' }}>Rotation Strategy is only available to Executive users.</p>
      </div>
    )
  }

  return (
    <div data-sku-count={products.length}>
      {/* SECTION 1 — Header */}
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
              background: '#38bdf8',
              animation: 'blink 2s infinite',
            }}
          />
          ROTATION STRATEGY ENGINE
        </div>
      </div>

      {/* SECTION 2 — 3 Insight cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
          marginBottom: '22px',
        }}
        className="fade-up delay-1"
      >
        {insights.map((ins) => (
          <div
            key={ins.label}
            style={{
              background: '#111117',
              border: '1px solid rgba(255,255,255,0.055)',
              borderRadius: '12px',
              padding: '16px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                bottom: '-10px',
                right: '-10px',
                width: '70px',
                height: '70px',
                borderRadius: '50%',
                background: ins.color,
                opacity: 0.04,
              }}
            />
            <div
              style={{
                fontFamily: '"DM Sans"',
                fontSize: '40px',
                lineHeight: 1,
                color: ins.color,
                marginBottom: '3px',
              }}
            >
              {ins.number}
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#e4e4f0', marginBottom: '3px' }}>
              {ins.label}
            </div>
            <div style={{ fontSize: '10px', color: '#9090aa', lineHeight: 1.5 }}>{ins.desc}</div>
          </div>
        ))}
      </div>

      {/* SECTION 3 — Two-column panels */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '14px',
          marginBottom: '22px',
        }}
        className="fade-up delay-2"
      >
        <div
          style={{
            background: '#111117',
            border: '1px solid rgba(255,255,255,0.055)',
            borderRadius: '13px',
            padding: '18px',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: '#e4e4f0',
              marginBottom: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
            }}
          >
            <div
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '7px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                background: '#17171f',
                flexShrink: 0,
              }}
            >
            </div>
            Immediate Rotation Actions
          </div>
          <div style={{ fontSize: '10px', color: '#9090aa', marginBottom: '12px' }}>
            Rule-based recommendations for this week
          </div>

          {rotationActions.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#9090aa', padding: '12px 0' }}>
              No rotation actions match current inventory — all clear.
            </div>
          ) : (
            rotationActions.map((a) => (
              <StrategyItem
                key={a.key}
                icon={a.icon}
                title={a.title}
                description={a.description}
                urgency={a.urgency}
                urgencyLabel={a.urgencyLabel}
              />
            ))
          )}
        </div>

        <div
          style={{
            background: '#111117',
            border: '1px solid rgba(255,255,255,0.055)',
            borderRadius: '13px',
            padding: '18px',
          }}
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
            <div
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '7px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                background: '#17171f',
                flexShrink: 0,
              }}
            >
            </div>
            Lifecycle Rules Applied
          </div>

          <StrategyItem
            icon={null}
            title="Day 0–30 → New Arrival"
            description="Full-price positioning. Track early velocity to forecast lifecycle trajectory."
          />
          <StrategyItem
            icon={null}
            title="Day 31–90 → Active"
            description="Core window. Benchmark at day 60. Below 30% sell-through flags risk early."
          />
          <StrategyItem
            icon={null}
            title="Day 91–150 → Aging / Risk"
            description="High-traffic merch. Bundle strategy. <20% triggers -10% price nudge automatically."
          />
          <StrategyItem
            icon={null}
            title="Day 150+ → Clearance → Outlet"
            description="Mandatory -20% to -50% by remaining stock %. Outlet after 180 days. Free shelf for new season."
          />
        </div>
      </div>
    </div>
  )
}
