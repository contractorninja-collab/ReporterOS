function Panel({ icon, title, children, style }) {
  return (
    <div
      style={{
        background: 'var(--ro-surface)',
        border: '1px solid var(--ro-border)',
        borderRadius: '13px',
        padding: '18px',
        marginBottom: '14px',
        ...style,
      }}
    >
      <div
        style={{
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--ro-text)',
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          fontFamily: '"DM Sans", sans-serif',
        }}
      >
        {icon && (
          <div
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '7px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              background: 'var(--ro-surface-elevated)',
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        {title}
      </div>
      {children}
    </div>
  )
}

export default Panel
