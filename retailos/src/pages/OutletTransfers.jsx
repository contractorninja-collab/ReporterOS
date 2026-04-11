import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../store/useStore.js'

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
      <tr key={idx}>
        <td style={{ padding: '8px 14px', fontSize: 11, color: '#9090aa', fontFamily: '"DM Sans"' }}>{it.skuCode}</td>
        <td style={{ padding: '8px 14px', fontSize: 12, color: '#e4e4f0', fontWeight: 600 }}>{it.productName}</td>
        <td style={{ padding: '8px 14px', fontSize: 12, color: '#e4e4f0' }}>{it.totalQty ?? it.quantity}</td>
        <td style={{ padding: '8px 14px' }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {it.sizeBreakdown.map((b) => (
              <span key={b.size} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#e4e4f0', fontFamily: '"DM Sans"', fontWeight: 600 }}>
                {b.size} <span style={{ color: '#9090aa' }}>×{b.qty}</span>
              </span>
            ))}
          </div>
        </td>
      </tr>
    )
  }
  return (
    <tr key={idx}>
      <td style={{ padding: '8px 14px', fontSize: 11, color: '#9090aa', fontFamily: '"DM Sans"' }}>{it.skuCode}</td>
      <td style={{ padding: '8px 14px', fontSize: 12, color: '#e4e4f0', fontWeight: 600 }}>{it.productName}</td>
      <td style={{ padding: '8px 14px', fontSize: 12, color: '#e4e4f0' }}>{it.quantity}</td>
      <td style={{ padding: '8px 14px', fontSize: 11, color: '#9090aa' }}>{it.sizes || '—'}</td>
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
    <div style={{ maxWidth: 700 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: '"DM Sans"', fontSize: 22, letterSpacing: '2px', color: '#fff', margin: 0 }}>
          OUTLET TRANSFERS
        </h2>
        <p style={{ fontSize: 12, color: '#4a4a62', margin: '4px 0 0' }}>
          Batches of products being moved to the outlet. Each day's moves are grouped into one batch.
        </p>
      </div>

      <button
        type="button"
        onClick={() => navigate('/new-transfer')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px',
          borderRadius: 8, border: 'none', background: '#ff3333', color: '#fff',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: '"DM Sans"', marginBottom: 16,
        }}
      >
        + New Transfer
      </button>

      {transfers.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: 48,
            background: '#111117',
            border: '1px solid rgba(255,255,255,0.055)',
            borderRadius: 14,
            color: '#4a4a62',
            fontSize: 14,
          }}
        >
          No outlet transfers yet. Move products to outlet from the product detail view.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {transfers.map((batch) => {
          const isExpanded = expanded === batch.id
          const isPending = batch.status === 'pending'
          const totalUnits = batch.items.reduce((s, i) => s + (i.totalQty ?? i.quantity ?? 0), 0)
          return (
            <div
              key={batch.id}
              style={{
                background: '#111117',
                border: `1px solid ${isPending ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.055)'}`,
                borderRadius: 14,
                overflow: 'hidden',
              }}
            >
              <div
                onClick={() => setExpanded(isExpanded ? null : batch.id)}
                style={{
                  padding: '16px 18px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <div style={{ fontSize: 22 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e4e4f0', marginBottom: 3 }}>
                    Transfer — {formatDate(batch.createdAt)}
                  </div>
                  <div style={{ fontSize: 11, color: '#4a4a62' }}>
                    {batch.items.length} products · {totalUnits} units · by {getUserName(batch.createdBy)}
                    {batch.assignedTo && (
                      <span> · assigned to {formatAssigneeList(batch.assignedTo)}</span>
                    )}
                  </div>
                  {batch.note && (
                    <div style={{ fontSize: 10, color: '#9090aa', marginTop: 2, fontStyle: 'italic' }}>{batch.note}</div>
                  )}
                </div>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '3px 8px',
                    borderRadius: 4,
                    background: isPending ? 'rgba(251,191,36,0.12)' : 'rgba(0,230,118,0.12)',
                    color: isPending ? '#fbbf24' : '#00e676',
                  }}
                >
                  {isPending ? 'Pending' : 'Received'}
                </span>
                <span style={{ fontSize: 14, color: '#4a4a62', transform: isExpanded ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }}>
                  ▼
                </span>
              </div>

              {isExpanded && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['SKU', 'Product', 'Qty', 'Sizes'].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: 'left',
                                padding: '8px 14px',
                                fontSize: 9,
                                fontWeight: 700,
                                color: '#4a4a62',
                                textTransform: 'uppercase',
                                letterSpacing: '0.8px',
                                borderBottom: '1px solid rgba(255,255,255,0.04)',
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {batch.items.map((it, idx) => renderItemRow(it, idx))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    {isPending && (
                      <button
                        type="button"
                        onClick={() => handleReceive(batch.id)}
                        style={{
                          padding: '7px 14px',
                          borderRadius: 8,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          border: 'none',
                          background: '#00e676',
                          color: '#09090e',
                          fontFamily: '"DM Sans"',
                        }}
                      >
                        Mark Received
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => downloadCSV(batch)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,0.08)',
                        background: 'none',
                        color: '#9090aa',
                        fontFamily: '"DM Sans"',
                      }}
                    >
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => printBatch(batch, getUserName(batch.createdBy))}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,0.08)',
                        background: 'none',
                        color: '#9090aa',
                        fontFamily: '"DM Sans"',
                      }}
                    >
                      PDF / Print
                    </button>
                    {batch.receivedAt && (
                      <span style={{ fontSize: 10, color: '#4a4a62', marginLeft: 'auto', alignSelf: 'center' }}>
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
