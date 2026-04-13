import { useState } from 'react'

export default function LifecycleTile({ status, count, sub, tag, color, colorBg, isSelected, onClick }) {
  const [hover, setHover] = useState(false)

  const outerStyle = (() => {
    const base = {
      background: 'var(--ro-surface)',
      borderRadius: '12px',
      padding: '16px',
      position: 'relative',
      overflow: 'hidden',
      cursor: 'pointer',
      transition: 'transform 0.18s, border-color 0.18s, box-shadow 0.18s',
      userSelect: 'none',
    }
    if (hover) {
      return {
        ...base,
        border: `1px solid ${color}`,
        transform: 'translateY(-3px)',
        boxShadow: `var(--ro-shadow-ambient-hover), 0 0 0 1px ${color}`,
      }
    }
    if (isSelected) {
      return {
        ...base,
        border: `1px solid ${color}`,
        transform: 'translateY(-2px)',
        boxShadow: `0 0 0 2px ${color}, var(--ro-shadow-ambient-selected)`,
      }
    }
    return {
      ...base,
      border: '1px solid var(--ro-border)',
      transform: '',
      boxShadow: '',
    }
  })()

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={outerStyle}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '2px',
          background: color,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-20px',
          right: '-20px',
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: color,
          opacity: isSelected ? 0.12 : 0.05,
        }}
      />

      <div
        className="lc-tile-status"
        style={{
          fontSize: '9px',
          color: 'var(--ro-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '8px',
        }}
      >
        {status}
      </div>
      <div
        className="lc-tile-count"
        style={{
          fontFamily: '"DM Sans"',
          fontSize: '36px',
          color: 'var(--ro-heading)',
          letterSpacing: '1px',
          lineHeight: 1,
        }}
      >
        {count}
      </div>
      <div className="lc-tile-sub" style={{ fontSize: '10px', color: 'var(--ro-text-muted)', marginTop: '4px' }}>{sub}</div>
      <div
        className="lc-tile-tag"
        style={{
          display: 'inline-block',
          fontSize: '9px',
          fontWeight: 700,
          padding: '2px 7px',
          borderRadius: '20px',
          marginTop: '7px',
          background: colorBg,
          color,
        }}
      >
        {tag}
      </div>

      <div
        className="lc-tile-arrow"
        style={{
          position: 'absolute',
          bottom: '12px',
          right: '12px',
          fontSize: '11px',
          color: isSelected ? color : 'var(--ro-text-muted)',
          transition: 'transform 0.18s',
          transform: hover ? 'translateX(3px)' : 'none',
        }}
      >
        →
      </div>
    </div>
  )
}
