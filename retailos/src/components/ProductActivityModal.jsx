import { useEffect, useState } from 'react'
import { fetchSkuActivity, downloadSkuActivity } from '../api/client.js'
import { IconDownload } from '../utils/icons.js'

const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const humanDate = (value) => {
  const date = new Date(String(value || '').slice(0, 10) + 'T00:00:00')
  return Number.isNaN(date.getTime()) ? value || '—' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function ProductActivityModal({ sku, onClose }) {
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')

  useEffect(() => {
    let alive = true
    setActivity(null)
    setError('')
    fetchSkuActivity(sku.sku, { since, until }).then((data) => alive && setActivity(data)).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [sku.sku, since, until])

  const download = async (format) => {
    setDownloading(format)
    try { await downloadSkuActivity(sku.sku, format, { since, until }) } catch (e) { setError(e.message) } finally { setDownloading('') }
  }

  const totals = activity && activity.totals
  const kpis = totals ? [
    ['Imported', totals.imported],
    ['Sold', totals.sold],
    ['Returned', totals.returned],
    ['Net units', totals.netUnits],
    ['Revenue', money(totals.revenue)],
    ['Stock', totals.stock],
  ] : []

  return (
    <div className="product-activity-overlay" role="dialog" aria-modal="true" aria-label="Product sales card" onClick={onClose}>
      <div className="product-activity-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="product-activity-header">
          <div>
            <h2>Product sales card</h2>
            <div className="product-activity-sku">{sku.sku}</div>
            <div className="product-activity-name">{sku.product_name}</div>
          </div>
          <button className="product-activity-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="product-activity-content">
          <div className="product-activity-controls">
            <label><span>From</span><input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
            <label><span>To</span><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
            <div className="product-activity-downloads">
              <button type="button" onClick={() => download('csv')} disabled={!!downloading}><IconDownload size={14} aria-hidden />{downloading === 'csv' ? 'Preparing…' : 'Download CSV'}</button>
              <button type="button" onClick={() => download('xlsx')} disabled={!!downloading}><IconDownload size={14} aria-hidden />{downloading === 'xlsx' ? 'Preparing…' : 'Download XLSX'}</button>
            </div>
          </div>

          {error && <div className="product-activity-error">{error}</div>}
          {!activity && !error && <div className="product-activity-state">Loading activity…</div>}
          {activity && <>
            <div className="product-activity-kpis">
              {kpis.map(([label, value]) => <div className={'product-activity-kpi product-activity-kpi--' + label.toLowerCase().replace(' ', '-')} key={label}><span>{label}</span><strong>{label === 'Stock' && Number(value) < 0 ? '⚠ ' : ''}{value}</strong></div>)}
            </div>

            {activity.events.length === 0 ? <div className="product-activity-state">No import, sale, or return events found for this SKU.</div> : <>
              <div className="product-activity-section-label">Transactions</div>
              <div className="product-activity-table-wrap">
                <table className="product-activity-table">
                  <thead><tr>{['Type', 'Date', 'Size', 'Barcode', 'Qty', 'Amount', 'Stock', 'Source', 'Order / Exchange'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{activity.events.map((e) => <tr key={e.id}><td>{e.eventType}</td><td>{e.eventDate}</td><td>{e.size || '—'}</td><td>{e.barcode || '—'}</td><td>{e.eventType === 'RETURN' ? '-' + e.quantity : e.quantity}</td><td>{e.amount ? money(e.amount) : '—'}</td><td>{e.runningStock}</td><td>{e.sourceFile || e.importId || '—'}</td><td>{e.orderId || e.exchangeGroupId || '—'}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="product-activity-cards">{activity.events.map((e) => <article className="product-activity-card" key={e.id}>
                <div className="product-activity-card-main">
                  <div className="product-activity-card-top"><span className={'product-activity-badge product-activity-badge--' + e.eventType.toLowerCase()}>{e.eventType}</span><span className="product-activity-card-date">{humanDate(e.eventDate)}</span></div>
                  <div className="product-activity-card-detail">Size {e.size || '—'} · Qty {e.eventType === 'RETURN' ? '-' + e.quantity : e.quantity}</div>
                  {e.barcode && <div className="product-activity-card-barcode">{e.barcode}</div>}
                </div>
                <div className={'product-activity-card-amount product-activity-card-amount--' + e.eventType.toLowerCase()}>{e.amount ? '€' + money(e.amount) : '—'}</div>
              </article>)}</div>
            </>}
          </>}
        </div>
      </div>
    </div>
  )
}
