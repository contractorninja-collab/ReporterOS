import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../store/useStore.js'
import { toTitleCase } from '../utils/textFormat.js'
import { IconPlus, IconDownload, IconPrint } from '../utils/icons.js'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function downloadCSV(batch) {
  const header = 'SKU,Product,Quantity,Sizes'
  const rows = batch.items.map(
    (it) => `"${it.skuCode}","${it.productName}",${it.quantity},"${it.sizes || ''}"`
  )
  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `outlet-transfer-${batch.createdAt.slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function printBatch(batch, userName) {
  const html = `
    <html>
    <head><title>Outlet Transfer ${batch.createdAt.slice(0, 10)}</title>
    <style>
      body { font-family: 'DM Sans', sans-serif; padding: 24px; color: #222; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      .meta { font-size: 12px; color: #666; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #ddd; font-size: 13px; }
      th { background: #f5f5f5; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
    </style></head>
    <body>
      <h1>Outlet Transfer</h1>
      <div class="meta">Date: ${formatDate(batch.createdAt)} &bull; Status: ${batch.status} &bull; Created by: ${userName}</div>
      <table>
        <tr><th>SKU</th><th>Product</th><th>Qty</th><th>Sizes</th></tr>
        ${batch.items.map((it) => `<tr><td>${it.skuCode}</td><td>${it.productName}</td><td>${it.quantity}</td><td>${it.sizes || '—'}</td></tr>`).join('')}
      </table>
      <div style="margin-top:16px;font-size:11px;color:#888;">Total items: ${batch.items.length} &bull; Total units: ${batch.items.reduce((s, i) => s + i.quantity, 0)}</div>
    </body></html>
  `
  const w = window.open('', '_blank', 'width=700,height=600')
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 400)
}

function renderItemRow(it, idx) {
  if (it.sizeBreakdown && it.sizeBreakdown.length > 0) {
    return (
      <tr key={idx} className="ot-batch-table__row">
        <td className="ot-batch-table__sku">{it.skuCode}</td>
        <td className="ot-batch-table__product">{toTitleCase(it.productName)}</td>
        <td className="ot-batch-table__qty">{it.totalQty ?? it.quantity}</td>
        <td className="ot-batch-table__sizes">
          <div className="ot-batch-table__size-pills">
            {it.sizeBreakdown.map((b) => (
              <span key={b.size} className="ot-batch-table__size-pill">
                {b.size} <span className="ot-batch-table__size-qty">×{b.qty}</span>
              </span>
            ))}
          </div>
        </td>
      </tr>
    )
  }
  return (
    <tr key={idx} className="ot-batch-table__row">
      <td className="ot-batch-table__sku">{it.skuCode}</td>
      <td className="ot-batch-table__product">{toTitleCase(it.productName)}</td>
      <td className="ot-batch-table__qty">{it.quantity}</td>
      <td className="ot-batch-table__sizes">{it.sizes || '—'}</td>
    </tr>
  )
}

export function OutletTransfers() {
  const navigate = useNavigate()
  const transfers = useStore((s) => s.outletTransfers)
  const updateOutletTransfer = useStore((s) => s.updateOutletTransfer)
  const users = useStore((s) => s.users)
  const [expanded, setExpanded] = useState(null)

  const getUserName = (id) => users.find((u) => u.id === id)?.name || id

  const formatAssigneeList = (raw) => {
    if (raw == null || raw === '') return ''
    return String(raw)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((id) => getUserName(id))
      .join(', ')
  }

  const handleReceive = (id) => {
    updateOutletTransfer(id, { status: 'received', receivedAt: new Date().toISOString() })
  }

  return (
    <div className="outlet-transfers-page store-transfers-page">
      <p className="ot-page-subtitle page-hero-mobile-hide">
        Batches of products being moved to the outlet. Each day&apos;s moves are grouped into one batch.
      </p>

      <button type="button" className="ot-new-transfer-btn" onClick={() => navigate('/new-transfer')}>
        <IconPlus size={14} strokeWidth={2} className="ot-new-transfer-btn__icon" />
        New Transfer
      </button>

      {transfers.length === 0 && (
        <div className="ot-empty-state">
          No outlet transfers yet. Move products to outlet from the product detail view.
        </div>
      )}

      <div className="ot-batch-list">
        {transfers.map((batch) => {
          const isExpanded = expanded === batch.id
          const isPending = batch.status === 'pending'
          const totalUnits = batch.items.reduce((s, i) => s + (i.totalQty ?? i.quantity ?? 0), 0)
          return (
            <div key={batch.id} className="ot-batch-card">
              <div
                className="ot-batch-card__head"
                onClick={() => setExpanded(isExpanded ? null : batch.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setExpanded(isExpanded ? null : batch.id)
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="ot-batch-card__info">
                  <div className="ot-batch-card__title">Transfer — {formatDate(batch.createdAt)}</div>
                  <div className="ot-batch-card__meta">
                    {batch.items.length} products · {totalUnits} units · by {getUserName(batch.createdBy)}
                    {batch.assignedTo && (
                      <span> · assigned to {formatAssigneeList(batch.assignedTo)}</span>
                    )}
                  </div>
                  {batch.note && <div className="ot-batch-card__note">{batch.note}</div>}
                </div>
                <span className={`ot-status-badge${isPending ? ' ot-status-badge--pending' : ' ot-status-badge--received'}`}>
                  {isPending ? 'Pending' : 'Received'}
                </span>
                <span className={`ot-batch-card__chevron${isExpanded ? ' ot-batch-card__chevron--expanded' : ''}`} aria-hidden="true">
                  ▼
                </span>
              </div>

              {isExpanded && (
                <div className="ot-batch-card__body">
                  <div className="transfer-batch-table-wrap ot-batch-table-wrap">
                    <table className="ot-batch-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Product</th>
                          <th>Qty</th>
                          <th>Sizes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.items.map((it, idx) => renderItemRow(it, idx))}
                      </tbody>
                    </table>
                  </div>

                  <div className="ot-batch-card__footer">
                    {isPending && (
                      <button type="button" className="ot-mark-received-btn" onClick={() => handleReceive(batch.id)}>
                        Mark Received
                      </button>
                    )}
                    <button type="button" className="ot-export-btn" onClick={() => downloadCSV(batch)}>
                      <IconDownload size={12} strokeWidth={1.75} className="ot-export-btn__icon" />
                      CSV
                    </button>
                    <button type="button" className="ot-export-btn" onClick={() => printBatch(batch, getUserName(batch.createdBy))}>
                      <IconPrint size={12} strokeWidth={1.75} className="ot-export-btn__icon" />
                      PDF / Print
                    </button>
                    {batch.receivedAt && (
                      <span className="ot-batch-card__received">
                        <span className="ot-batch-card__received-dot" aria-hidden="true">●</span>
                        Received {formatDate(batch.receivedAt)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
