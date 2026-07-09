/**
 * Small reusable "SALE -X%" badge shown on product tiles when a SKU is on sale.
 * variant 'overlay' is for photo corners; 'chip' fits inline chip rows / table cells.
 */
export function SaleBadge({ percent, extraPercent = 0, variant = 'chip' }) {
  const pct = Math.round(Number(percent) || 0)
  const extraPct = Number(extraPercent) === 20 ? 20 : 0
  const label = pct > 0 ? `SALE -${pct}%${extraPct ? ' + EXTRA 20%' : ''}` : 'SALE'
  if (variant === 'overlay') {
    return (
      <div className="sale-badge sale-badge--overlay">{label}</div>
    )
  }
  return (
    <span className="sale-badge sale-badge--chip">{label}</span>
  )
}

export default SaleBadge
