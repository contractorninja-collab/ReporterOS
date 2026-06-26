export function JobProgress({ status, stage, stageDetail, progress, leadCount, pagesScraped }) {
  if (status === 'idle') return null

  const dot =
    status === 'running' ? 'lg-status-running'
    : status === 'completed' ? 'lg-status-done'
    : 'lg-status-error'

  const label =
    status === 'running' ? (stage ? capitalize(stage) : 'Searching')
    : status === 'completed' ? 'Completed'
    : 'Error'

  return (
    <div className="lg-progress">
      {status === 'running' ? <div className="lg-progress-spinner" /> : <span className={`lg-status-dot ${dot}`} />}
      <div className="lg-progress-text">
        <div className="lg-progress-stage">{label}</div>
        <div className="lg-progress-detail">{stageDetail || '\u00A0'}</div>
        <div className="lg-progress-bar">
          <div className="lg-progress-bar-fill" style={{ width: `${progress || 0}%` }} />
        </div>
      </div>
      <div className="lg-progress-stat">
        <span className="lg-progress-stat-val">{leadCount || 0}</span>
        <span className="lg-progress-stat-label">Leads</span>
      </div>
      <div className="lg-progress-stat">
        <span className="lg-progress-stat-val">{pagesScraped || 0}</span>
        <span className="lg-progress-stat-label">Pages</span>
      </div>
    </div>
  )
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}
