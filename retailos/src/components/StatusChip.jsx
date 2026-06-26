import { lifecycleStatusBadgeClass } from '../utils/statusBadge.js'

function StatusChip({ status }) {
  return (
    <span className={lifecycleStatusBadgeClass(status)}>
      {status}
    </span>
  )
}

export default StatusChip
