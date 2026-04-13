import { STATUS_COLORS } from '../utils/lifecycle.js'

const STATUS_BG = {
  'New Arrival': 'rgba(56,189,248,0.1)',
  Active: 'rgba(0,230,118,0.1)',
  Aging: 'rgba(251,191,36,0.1)',
  Risk: 'rgba(255,136,0,0.1)',
  Clearance: 'rgba(255,51,51,0.1)',
  Outlet: 'rgba(192,132,252,0.1)',
}

function StatusChip({ status }) {
  const color = STATUS_COLORS[status] || 'var(--ro-text-dim)'
  const bg = STATUS_BG[status] || 'color-mix(in srgb, var(--ro-text-dim) 14%, transparent)'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        borderRadius: '6px',
        fontSize: '10px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.8px',
        background: bg,
        color: color,
      }}
    >
      <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, flexShrink: 0 }} />
      {status}
    </span>
  )
}

export default StatusChip
