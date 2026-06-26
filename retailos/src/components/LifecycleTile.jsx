import { useState } from 'react'

export default function LifecycleTile({ status, count, sub, tag, tileKey, isSelected, onClick }) {
  const [hover, setHover] = useState(false)

  return (
    <div
      className={[
        'lc-tile',
        tileKey ? `lc-tile--${tileKey}` : '',
        isSelected ? 'lc-tile--selected' : '',
        hover ? 'lc-tile--hover' : '',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="lc-tile__accent" aria-hidden />
      <div className="lc-tile-status">{status}</div>
      <div className="lc-tile-count">{count}</div>
      <div className="lc-tile-sub">{sub}</div>
      <div className="lc-tile-tag">{tag}</div>
      <div className="lc-tile-arrow" aria-hidden>→</div>
    </div>
  )
}
