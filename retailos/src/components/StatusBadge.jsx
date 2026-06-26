import { statusBadgeClass } from '../utils/statusBadge.js'

/** Unified status pill — tint background, semantic text color. */
export function StatusBadge({ variant, size, className = '', children }) {
  if (children == null || children === '') return null
  return (
    <span className={statusBadgeClass(variant, { size, className })}>
      {children}
    </span>
  )
}

export default StatusBadge
