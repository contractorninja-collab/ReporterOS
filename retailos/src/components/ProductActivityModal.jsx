import { useEffect, useState } from 'react'
import { fetchSkuActivity, downloadSkuActivity } from '../api/client.js'

const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ProductActivityModal({ sku, onClose }) {
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')

  useEffect(() => {
    let alive = true
    setActivity(null); setError('')
    fetchSkuActivity(sku.sku, { since, until }).then((data) => alive && setActivity(data)).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [sku.sku, since, until])

  const download = async (format) => {
    setDownloading(format)
    try { await downloadSkuActivity(sku.sku, format, { since, until }) } catch (e) { setError(e.message) } finally { setDownloading('') }
  }

  return <div role="dialog" aria-modal="true" aria-label="Product sales card" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
    <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1200px, 100%)', maxHeight: '92vh', overflow: 'auto', background: 'var(--ro-surface)', border: '1px solid var(--ro-border)', borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div><div style={{ fontSize: 20, fontWeight: 800 }}>Product sales card</div><div style={{ color: 'var(--ro-text-muted)', fontSize: 11 }}>{sku.sku}</div><div style={{ marginTop: 4, color: 'var(--ro-text-dim)', fontSize: 12 }}>{sku.product_name}</div></div>
        <button type="button" onClick={onClose} style={{ fontSize: 20, background: 'none', border: 0, color: 'var(--ro-text)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0' }}><label>From <input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label><label>To <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label><button type="button" onClick={() => download('csv')} disabled={!!downloading}>{downloading === 'csv' ? 'Preparing…' : 'Download CSV'}</button><button type="button" onClick={() => download('xlsx')} disabled={!!downloading}>{downloading === 'xlsx' ? 'Preparing…' : 'Download XLSX'}</button></div>
      {error && <div style={{ color: '#ff6b6b', marginBottom: 12 }}>{error}</div>}
      {!activity && !error && <div>Loading activity…</div>}
      {activity && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(0,1fr))', gap: 8, marginBottom: 18 }}>{[['Imported', activity.totals.imported], ['Sold', activity.totals.sold], ['Returned', activity.totals.returned], ['Net units', activity.totals.netUnits], ['Revenue', money(activity.totals.revenue)], ['Stock', activity.totals.stock]].map(([label, value]) => <div key={label} style={{ background: 'var(--ro-fill-faint)', padding: 10, borderRadius: 9 }}><div style={{ fontSize: 10, color: 'var(--ro-text-muted)' }}>{label}</div><strong>{value}</strong></div>)}</div>
        {activity.events.length === 0 ? <div style={{ color: 'var(--ro-text-muted)' }}>No import, sale, or return events found for this SKU.</div> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}><thead><tr>{['Type', 'Date', 'Size', 'Barcode', 'Qty', 'Amount', 'Stock', 'Source', 'Order / Exchange'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--ro-border)' }}>{h}</th>)}</tr></thead><tbody>{activity.events.map((e) => <tr key={e.id}><td style={{ padding: 8, fontWeight: 700 }}>{e.eventType}</td><td style={{ padding: 8 }}>{e.eventDate}</td><td style={{ padding: 8 }}>{e.size || '—'}</td><td style={{ padding: 8 }}>{e.barcode || '—'}</td><td style={{ padding: 8 }}>{e.eventType === 'RETURN' ? `-${e.quantity}` : e.quantity}</td><td style={{ padding: 8 }}>{e.amount ? money(e.amount) : '—'}</td><td style={{ padding: 8 }}>{e.runningStock}</td><td style={{ padding: 8 }}>{e.sourceFile || e.importId || '—'}</td><td style={{ padding: 8 }}>{e.orderId || e.exchangeGroupId || '—'}</td></tr>)}</tbody></table></div>}
      </>}
    </div>
  </div>
}
