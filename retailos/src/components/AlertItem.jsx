const colorMap = {
  critical: { bg: 'rgba(255,51,51,0.05)', border: 'rgba(255,51,51,0.18)' },
  warning: { bg: 'rgba(255,136,0,0.05)', border: 'rgba(255,136,0,0.18)' },
  info: { bg: 'rgba(56,189,248,0.05)', border: 'rgba(56,189,248,0.18)' },
  opportunity: { bg: 'rgba(0,230,118,0.05)', border: 'rgba(0,230,118,0.18)' },
}

function AlertItem({ urgency, icon, title, description, messageSecondary, onAssign, onViewProduct, assigned }) {
  const c = colorMap[urgency] || colorMap.info

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: '9px',
        border: `1px solid ${c.border}`,
        background: c.bg,
        marginBottom: '7px',
        transition: 'transform 0.13s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateX(3px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = ''
      }}
    >
      <span style={{ fontSize: '15px', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {onViewProduct ? (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onViewProduct()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onViewProduct()
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '2px', color: 'var(--ro-text)' }}>{title}</div>
          </div>
        ) : (
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '2px', color: 'var(--ro-text)' }}>{title}</div>
        )}
        <div style={{ fontSize: '10px', color: 'var(--ro-text-dim)', lineHeight: 1.45 }}>{description}</div>
        {messageSecondary ? (
          <div style={{ fontSize: '9px', color: 'var(--ro-text-muted)', marginTop: 4, lineHeight: 1.4 }}>{messageSecondary}</div>
        ) : null}
        {onViewProduct ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onViewProduct()
            }}
            style={{
              marginTop: 6,
              padding: 0,
              border: 'none',
              background: 'none',
              fontSize: 10,
              fontWeight: 600,
              color: '#38bdf8',
              cursor: 'pointer',
              fontFamily: '"DM Sans"',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            View product
          </button>
        ) : null}
      </div>
      {onAssign && (
        assigned ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 5,
              background: 'rgba(0,230,118,0.15)',
              color: '#00e676',
              fontFamily: '"DM Sans"',
              flexShrink: 0,
              alignSelf: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            Assigned
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAssign() }}
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 5,
              border: 'none',
              background: 'rgba(255,51,51,0.15)',
              color: '#ff3333',
              cursor: 'pointer',
              fontFamily: '"DM Sans"',
              flexShrink: 0,
              alignSelf: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            Assign
          </button>
        )
      )}
    </div>
  )
}

export default AlertItem
