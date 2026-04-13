function KpiCard({
  label,
  value,
  sub,
  tag,
  tagBg,
  tagColor,
  accentColor,
  onClick,
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--ro-surface)',
        border: '1px solid var(--ro-border)',
        borderRadius: '11px',
        padding: '14px 16px',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'transform 0.18s, border-color 0.18s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.borderColor = 'var(--ro-border-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = ''
        e.currentTarget.style.borderColor = 'var(--ro-border)'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '2px',
          background: accentColor,
        }}
      />

      <div
        style={{
          fontSize: '9px',
          color: 'var(--ro-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '6px',
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontFamily: '"DM Sans"',
          fontSize: '30px',
          color: 'var(--ro-heading)',
          letterSpacing: '1px',
          lineHeight: 1,
        }}
      >
        {value}
      </div>

      <div style={{ fontSize: '10px', color: 'var(--ro-text-muted)', marginTop: '3px' }}>{sub}</div>

      {tag && (
        <div
          style={{
            display: 'inline-block',
            fontSize: '9px',
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: '20px',
            marginTop: '5px',
            background: tagBg || 'var(--ro-fill-muted)',
            color: tagColor || 'var(--ro-text-dim)',
          }}
        >
          {tag}
        </div>
      )}
    </div>
  )
}

export default KpiCard
