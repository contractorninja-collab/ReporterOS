function Panel({ icon, title, children, style }) {
  return (
    <div
      style={{
        background: '#111117',
        border: '1px solid rgba(255,255,255,0.055)',
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
          color: '#e4e4f0',
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
              background: '#17171f',
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
