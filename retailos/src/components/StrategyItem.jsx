const badgeMap = {
  critical: { bg: 'rgba(255,51,51,0.1)', color: '#ff3333' },
  warning: { bg: 'rgba(255,136,0,0.1)', color: '#ff8800' },
  opportunity: { bg: 'rgba(0,230,118,0.1)', color: '#00e676' },
  consider: { bg: 'rgba(56,189,248,0.1)', color: '#38bdf8' },
}

function StrategyItem({ icon, title, description, urgency, urgencyLabel }) {
  const b = badgeMap[urgency] || badgeMap.consider

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        background: '#17171f',
        border: '1px solid rgba(255,255,255,0.055)',
        borderRadius: '9px',
        marginBottom: '8px',
        transition: 'border-color 0.13s',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.055)'
      }}
    >
      <span style={{ fontSize: '18px', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
      <div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#e4e4f0', marginBottom: '2px' }}>{title}</div>
        <div style={{ fontSize: '10px', color: '#9090aa', lineHeight: 1.45 }}>{description}</div>
        {urgencyLabel && (
          <div
            style={{
              display: 'inline-block',
              fontSize: '9px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              padding: '2px 7px',
              borderRadius: '20px',
              marginTop: '4px',
              background: b.bg,
              color: b.color,
            }}
          >
            {urgencyLabel}
          </div>
        )}
      </div>
    </div>
  )
}

export default StrategyItem
