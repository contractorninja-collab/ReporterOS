function accentClassForUrgency(urgency) {
  if (urgency === 'critical') return 'smart-alert-item--critical'
  if (urgency === 'warning') return 'smart-alert-item--warning'
  return 'smart-alert-item--info'
}

function AlertItem({
  urgency,
  title,
  message,
  action,
  messageTone,
  onAssign,
  onViewProduct,
  assigned,
}) {
  return (
    <div className={`smart-alert-item ${accentClassForUrgency(urgency)}`}>
      <div className="smart-alert-item__body">
        {onViewProduct ? (
          <button
            type="button"
            className="smart-alert-item__title-btn"
            onClick={(e) => {
              e.stopPropagation()
              onViewProduct()
            }}
          >
            {title}
          </button>
        ) : (
          <div className="smart-alert-item__title">{title}</div>
        )}
        {message ? (
          <div
            className={`smart-alert-item__message${messageTone === 'positive' ? ' smart-alert-item__message--positive' : ''}`}
          >
            {message}
          </div>
        ) : null}
        {action ? <div className="smart-alert-item__action">{action}</div> : null}
        {onViewProduct ? (
          <button
            type="button"
            className="smart-alert-item__link"
            onClick={(e) => {
              e.stopPropagation()
              onViewProduct()
            }}
          >
            View product
          </button>
        ) : null}
      </div>
      {onAssign && (
        assigned ? (
          <span className="smart-alert-item__assigned">Assigned</span>
        ) : (
          <button
            type="button"
            className="smart-alert-item__assign"
            onClick={(e) => {
              e.stopPropagation()
              onAssign()
            }}
          >
            Assign
          </button>
        )
      )}
    </div>
  )
}

export default AlertItem
