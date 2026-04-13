import { useMemo, useState } from 'react'
import useStore from '../store/useStore.js'
import { generateAlerts, dedupeAlertsBySku } from '../utils/alerts.js'
import { aggregateSkus } from '../utils/aggregateSkus.js'
import { SmartAlertsList } from '../components/SmartAlertsList'

const DM_SANS = '"DM Sans", sans-serif'

const FILTER_KEYS = ['all', 'critical', 'warning', 'opportunity', 'info']

function labelForFilter(key) {
  if (key === 'all') return 'All'
  return key.charAt(0).toUpperCase() + key.slice(1)
}

export function SmartAlerts() {
  const skus = useStore((s) => s.skus)
  const activeSeason = useStore((s) => s.activeSeason)
  const [urgencyFilter, setUrgencyFilter] = useState('all')

  const filteredSkus = useMemo(
    () => (activeSeason === 'All' ? skus : skus.filter((s) => s.season === activeSeason)),
    [skus, activeSeason],
  )

  const products = useMemo(() => aggregateSkus(filteredSkus), [filteredSkus])

  const countsByUrgency = useMemo(() => {
    const list = dedupeAlertsBySku(generateAlerts(products))
    const map = { all: list.length, critical: 0, warning: 0, info: 0, opportunity: 0 }
    for (const a of list) {
      if (map[a.urgency] !== undefined) map[a.urgency]++
    }
    return map
  }, [products])

  return (
    <div className="fade-up delay-1">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div
          style={{
            fontFamily: DM_SANS,
            fontSize: 16,
            letterSpacing: '2px',
            color: 'var(--ro-heading)',
          }}
        >
          SMART ALERTS
        </div>
        <div style={{ fontSize: 11, color: 'var(--ro-text-muted)' }}>Ranked by urgency · one row per SKU</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {FILTER_KEYS.map((key) => {
          const active = urgencyFilter === key
          const count = countsByUrgency[key] ?? 0
          return (
            <button
              key={key}
              type="button"
              onClick={() => setUrgencyFilter(key)}
              style={{
                padding: '4px 10px',
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                border: active ? '1px solid #ff3333' : '1px solid var(--ro-border)',
                background: active ? 'rgba(255,51,51,0.1)' : 'var(--ro-surface-elevated)',
                color: active ? '#ff3333' : 'var(--ro-text-muted)',
                fontFamily: DM_SANS,
              }}
            >
              {labelForFilter(key)}
              {key !== 'all' ? ` (${count})` : ` (${countsByUrgency.all})`}
            </button>
          )
        })}
      </div>

      <div
        style={{
          background: 'var(--ro-surface)',
          border: '1px solid var(--ro-border)',
          borderRadius: 13,
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div
          style={{
            fontFamily: DM_SANS,
            fontSize: 14,
            letterSpacing: '2px',
            color: 'var(--ro-heading)',
            marginBottom: 10,
          }}
        >
          All alerts
        </div>
        <div style={{ maxHeight: 'min(70vh, 640px)', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <SmartAlertsList urgencyFilter={urgencyFilter} />
        </div>
      </div>
    </div>
  )
}
