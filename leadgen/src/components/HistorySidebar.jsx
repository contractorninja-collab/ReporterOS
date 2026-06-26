import { Clock } from 'lucide-react'

export function HistorySidebar({ history, currentJobId, onSelect }) {
  return (
    <div className="lg-card" style={{ position: 'sticky', top: 20 }}>
      <div className="lg-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock size={12} /> Recent searches
      </div>
      <div className="lg-history">
        {history.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '6px 0' }}>
            Your past searches will appear here.
          </div>
        )}
        {history.map((j) => (
          <button
            key={j.id}
            type="button"
            className="lg-history-item"
            onClick={() => onSelect(j.id)}
            style={{
              textAlign: 'left',
              borderColor: j.id === currentJobId ? 'var(--accent)' : 'var(--border)',
            }}
          >
            <div className="lg-history-prompt">{j.prompt}</div>
            <div className="lg-history-meta">
              <span>{j.lead_count || 0} lead{(j.lead_count || 0) === 1 ? '' : 's'}</span>
              <span>·</span>
              <span>{formatAgo(j.created_at)}</span>
              <span>·</span>
              <span style={{ color: statusColor(j.status) }}>{j.status}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function statusColor(s) {
  if (s === 'running') return 'var(--info)'
  if (s === 'completed') return 'var(--success)'
  if (s === 'error') return 'var(--accent)'
  return 'var(--text-muted)'
}

function formatAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
