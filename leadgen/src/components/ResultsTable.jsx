import { Mail, Phone, Linkedin, Globe, Inbox, ExternalLink, Twitter, Instagram } from 'lucide-react'

export function ResultsTable({ leads, loading }) {
  if (!leads || leads.length === 0) {
    return (
      <div className="lg-empty">
        <div className="lg-empty-icon"><Inbox size={22} /></div>
        <div style={{ fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>
          {loading ? 'Scraping the web…' : 'No leads yet'}
        </div>
        <div>{loading ? 'Results will stream in as we find them.' : 'Run a search to see results here.'}</div>
      </div>
    )
  }
  return (
    <div className="lg-table-wrap">
      <table className="lg-table">
        <thead>
          <tr>
            <th>Company / Person</th>
            <th>Title</th>
            <th>Emails</th>
            <th>Phones</th>
            <th>Links</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id}>
              <td>
                <div className="lg-cell-company">
                  <div className="lg-avatar">{initials(l.company || l.person)}</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{l.company || '—'}</div>
                    {l.person && <div className="lg-cell-meta">{l.person}</div>}
                    {l.location && <div className="lg-cell-meta">{l.location}</div>}
                  </div>
                </div>
              </td>
              <td>{l.title || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
              <td>
                {(l.emails || []).length ? (l.emails || []).slice(0, 3).map((e) => (
                  <a key={e} className="lg-chip-data" href={`mailto:${e}`}>
                    <Mail size={11} />{e}
                  </a>
                )) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                {l.emails && l.emails.length > 3 && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> +{l.emails.length - 3} more</span>
                )}
              </td>
              <td>
                {(l.phones || []).length ? (l.phones || []).slice(0, 2).map((p) => (
                  <a key={p} className="lg-chip-data" href={`tel:${p.replace(/\s+/g, '')}`}>
                    <Phone size={11} />{p}
                  </a>
                )) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </td>
              <td>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {l.website && <a className="lg-chip-data" href={l.website} target="_blank" rel="noreferrer"><Globe size={11} /> site</a>}
                  {l.linkedin && <a className="lg-chip-data" href={l.linkedin} target="_blank" rel="noreferrer"><Linkedin size={11} /> in</a>}
                  {l.twitter && <a className="lg-chip-data" href={l.twitter} target="_blank" rel="noreferrer"><Twitter size={11} /> x</a>}
                  {l.instagram && <a className="lg-chip-data" href={l.instagram} target="_blank" rel="noreferrer"><Instagram size={11} /> ig</a>}
                </div>
              </td>
              <td>
                {l.source_url ? (
                  <a className="lg-chip-data" href={l.source_url} target="_blank" rel="noreferrer">
                    <ExternalLink size={11} />{hostOf(l.source_url)}
                  </a>
                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function initials(s) {
  if (!s) return '?'
  return s.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || s[0].toUpperCase()
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u }
}
