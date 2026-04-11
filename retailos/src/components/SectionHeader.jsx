function SectionHeader({ title, dotColor, children }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '14px',
      }}
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
            background: dotColor || '#ff3333',
            animation: 'blink 2s infinite',
            flexShrink: 0,
          }}
        />
        {title}
      </div>
      {children && <div>{children}</div>}
    </div>
  )
}

export default SectionHeader
