import { useEffect, useState } from 'react'

function ProgressBar({ value, color, width = '100%', style, className = '' }) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setW(value), 100)
    return () => clearTimeout(t)
  }, [value])

  return (
    <div
      className={['progress-bar', className].filter(Boolean).join(' ')}
      style={{
        height: '3px',
        background: 'var(--ro-track-bg)',
        borderRadius: '2px',
        overflow: 'hidden',
        marginTop: '6px',
        width: width || '100%',
        ...style,
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: '2px',
          background: color,
          width: `${w}%`,
          transition: 'width 1.1s ease',
        }}
      />
    </div>
  )
}

export default ProgressBar
