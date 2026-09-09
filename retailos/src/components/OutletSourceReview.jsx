import { useState } from 'react'
import { Search, Trash2 } from 'lucide-react'

function dateLabel(value) {
  if (!value) return 'Date not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : date.toLocaleDateString('en-GB')
}

export default function OutletSourceReview({ groups, onRemove }) {
  const [query, setQuery] = useState('')
  const [removing, setRemoving] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const visible = groups.filter((group) => !needle || [group.title, ...group.items.flatMap((item) => [item.sku, item.productName])]
    .some((value) => String(value || '').toLocaleLowerCase().includes(needle)))

  async function remove(group) {
    if (!window.confirm(`Remove the incorrect Outlet entry from “${group.title}” (${group.items.length} SKUs)?\nThis clears the review entry. Product stock, prices, markdown confirmations and real transfers are preserved.`)) return
    setRemoving(group.id)
    setError('')
    setNotice('')
    try {
      await onRemove(group.id)
      setNotice(`Removed the incorrect Outlet entry from “${group.title}”.`)
    } catch (err) {
      setError(err?.message || 'The entry could not be removed. Please try again.')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <section className="oh-card">
      <div className="oh-card__head oh-card__head--responsive">
        <div>
          <span className="oh-card__eyebrow">Review incorrect entries</span>
          <h2>Markdown sources shown as Outlet</h2>
          <p>These products were labelled Outlet when a markdown list was completed. They have no confirmed Outlet receipt and are now excluded from physical stock. Review each source, then remove the incorrect entry.</p>
        </div>
        <label className="oh-search"><Search size={16} /><input aria-label="Search incorrect Outlet entries" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU or list" /></label>
      </div>
      {error && <p className="oh-review-error" role="alert">{error}</p>}
      {notice && <p className="oh-review-notice" role="status">{notice}</p>}
      <div className="oh-review-list">
        {visible.map((group) => (
          <details className="oh-review-source" key={group.id}>
            <summary>
              <span><strong>{group.title}</strong><small>Markdown list · {dateLabel(group.completedAt || group.createdAt)}</small></span>
              <span>{group.items.length} SKUs · View products</span>
            </summary>
            <ul className="oh-review-products">
              {group.items.map((item) => <li key={item.sku}><strong>{item.sku}</strong><span>{item.productName}</span></li>)}
            </ul>
            <button type="button" className="oh-remove-entry" disabled={Boolean(removing)} onClick={() => remove(group)}>
              <Trash2 size={14} /> {removing === group.id ? 'Removing…' : 'Remove incorrect entry'}
            </button>
          </details>
        ))}
        {!visible.length && <p className="oh-empty-state">{query ? 'No incorrect entries match this search.' : 'No incorrect Outlet entries remain to review.'}</p>}
      </div>
    </section>
  )
}
