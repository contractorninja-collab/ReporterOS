import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check } from 'lucide-react'
import useStore from '../store/useStore.js'
import { toTitleCase } from '../utils/textFormat.js'
import { IconPlus, IconDownload, IconPrint } from '../utils/icons.js'

const BTN = {
  padding: '7px 14px',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: '"DM Sans"',
  border: 'none',
}

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

function flattenItems(items) {
  const lines = []
  for (const it of items || []) {
    if (Array.isArray(it.sizeBreakdown) && it.sizeBreakdown.length > 0) {
      for (const b of it.sizeBreakdown) {
        lines.push({
          skuCode: it.skuCode,
          productName: it.productName,
          size: b.size,
          qty: Number(b.qty) || 0,
        })
      }
      continue
    }
    lines.push({
      skuCode: it.skuCode,
      productName: it.productName,
      size: it.sizes || 'One Size',
      qty: Number(it.totalQty ?? it.quantity) || 0,
    })
  }
  return lines
}

function QtyCounter({ value, max, onChange, disabled }) {
  return (
    <input
      type="number"
      min="0"
      max={max}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
      style={{
        width: 56,
        border: '1px solid var(--ro-border)',
        borderRadius: 7,
        padding: '5px 6px',
        fontSize: 11,
        color: 'var(--ro-text)',
        background: disabled ? 'var(--ro-fill-soft)' : 'var(--ro-surface)',
      }}
    />
  )
}

function OutletVerificationPanel({ batch, onUpdate }) {
  const lines = useMemo(() => flattenItems(batch.items), [batch.items])
  const savedStatuses = batch.item_statuses || {}
  const [localStatuses, setLocalStatuses] = useState(() => {
    const init = {}
    for (const line of lines) {
      const key = `${line.skuCode}|${line.size}`
      init[key] = savedStatuses[key] || { status: '', received: line.qty, missing: 0, expected: line.qty, comment: '' }
    }
    return init
  })

  const statusesRef = useRef(localStatuses)
  useEffect(() => { statusesRef.current = localStatuses }, [localStatuses])

  const persist = useCallback((next) => {
    statusesRef.current = next
    onUpdate(batch.id, { item_statuses: next })
  }, [batch.id, onUpdate])

  const setReceived = useCallback((key, qty) => {
    setLocalStatuses((prev) => {
      const next = { ...prev, [key]: { ...prev[key], received: qty } }
      persist(next)
      return next
    })
  }, [persist])

  const confirmLine = useCallback((key, expectedQty) => {
    setLocalStatuses((prev) => {
      const entry = prev[key] || {}
      const received = entry.received ?? expectedQty
      const missing = Math.max(0, expectedQty - received)
      const next = {
        ...prev,
        [key]: {
          ...entry,
          status: missing > 0 ? 'partial' : 'done',
          received,
          missing,
          expected: expectedQty,
          comment: '',
        },
      }
      persist(next)
      return next
    })
  }, [persist])

  const markFullMissing = useCallback((key, expectedQty) => {
    setLocalStatuses((prev) => {
      const next = {
        ...prev,
        [key]: { ...prev[key], status: 'missing', received: 0, missing: expectedQty, expected: expectedQty, comment: '' },
      }
      persist(next)
      return next
    })
  }, [persist])

  const allVerified = lines.length > 0 && lines.every((line) => {
    const st = localStatuses[`${line.skuCode}|${line.size}`]
    return st?.status === 'done' || st?.status === 'missing' || st?.status === 'partial'
  })

  const handleComplete = () => {
    const current = statusesRef.current
    const unverified = lines.filter((line) => !current[`${line.skuCode}|${line.size}`]?.status)
    if (unverified.length > 0) {
      const ok = window.confirm('Some outlet transfer lines are not verified. Mark them missing and complete?')
      if (!ok) return
      const finalStatuses = { ...current }
      for (const line of unverified) {
        finalStatuses[`${line.skuCode}|${line.size}`] = {
          status: 'missing',
          received: 0,
          missing: line.qty,
          expected: line.qty,
          comment: '',
        }
      }
      setLocalStatuses(finalStatuses)
      onUpdate(batch.id, { item_statuses: finalStatuses, status: 'completed' })
      return
    }
    onUpdate(batch.id, { item_statuses: current, status: 'completed' })
  }

  return (
    <div style={{ padding: '12px 18px', borderTop: '1px solid var(--ro-border)' }}>
      {lines.map((line) => {
        const key = `${line.skuCode}|${line.size}`
        const entry = localStatuses[key] || { received: line.qty }
        const isConfirmed = !!entry.status
        return (
          <div key={key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--ro-border)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ro-text)' }}>{toTitleCase(line.productName)}</div>
              <div style={{ fontSize: 10, color: 'var(--ro-text-dim)' }}>{line.skuCode} · {line.size} · expected {line.qty}</div>
            </div>
            <QtyCounter value={entry.received ?? line.qty} max={line.qty} disabled={isConfirmed} onChange={(v) => setReceived(key, v)} />
            <button type="button" onClick={() => confirmLine(key, line.qty)} disabled={isConfirmed} style={{ ...BTN, background: isConfirmed ? 'var(--ro-fill-soft)' : '#16a34a', color: isConfirmed ? 'var(--ro-text-muted)' : '#fff' }}>
              <Check size={13} /> {isConfirmed ? 'Confirmed' : 'Done'}
            </button>
            <button type="button" onClick={() => markFullMissing(key, line.qty)} disabled={isConfirmed} style={{ ...BTN, background: isConfirmed ? 'var(--ro-fill-soft)' : '#fef2f2', color: isConfirmed ? 'var(--ro-text-muted)' : '#dc2626', border: '1px solid #fecaca' }}>
              <AlertTriangle size={13} /> Missing
            </button>
          </div>
        )
      })}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="ot-mark-received-btn" disabled={!allVerified} onClick={handleComplete} style={!allVerified ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
          Complete transfer verification
        </button>
      </div>
    </div>
  )
}

export function OutletTransfers() {
  const navigate = useNavigate()
  const transfers = useStore((s) => s.outletTransfers)
  const updateOutletTransfer = useStore((s) => s.updateOutletTransfer)
  const deleteOutletTransfer = useStore((s) => s.deleteOutletTransfer)
  const users = useStore((s) => s.users)
  const activeUser = useStore((s) => s.activeUser)
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

  const handleDeleteTransfer = (batch) => {
    const isFinal = batch.status === 'completed' || batch.status === 'received'
    const ok = window.confirm(
      `${isFinal ? 'Delete confirmed' : 'Discard'} outlet transfer?\nThis removes the transfer list for everyone${batch.status === 'received' ? ' and clears its linked E-commerce sale list.' : '.'}`,
    )
    if (!ok) return
    deleteOutletTransfer(batch.id).catch(() => {})
  }

  const canVerifyOutletTransfer = (batch) => {
    if (activeUser?.role === 'executive') return batch.status === 'pending'
    return batch.status === 'pending' && (
      batch.createdBy === activeUser?.id ||
      String(batch.assignedTo || '').split(',').map((id) => id.trim()).includes(activeUser?.id) ||
      (batch.fromShop && batch.fromShop === activeUser?.shop)
    )
  }

  const canConfirmOutletReceipt = (batch) => {
    return batch.status === 'completed' && (activeUser?.role === 'outlet' || activeUser?.role === 'executive')
  }

  const canDeleteOutletTransfer = (batch) => {
    if (activeUser?.role === 'executive') return true
    return batch.createdBy === activeUser?.id ||
      String(batch.assignedTo || '').split(',').map((id) => id.trim()).includes(activeUser?.id) ||
      Boolean(batch.fromShop && batch.fromShop === activeUser?.shop)
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
          const isCompleted = batch.status === 'completed'
          const isReceived = batch.status === 'received'
          const totalUnits = batch.items.reduce((s, i) => s + (i.totalQty ?? i.quantity ?? 0), 0)
          const statusLabel = isPending ? 'Pending verification' : isCompleted ? 'Awaiting Outlet' : 'Received'
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
                    {batch.fromShop && <span> · from {batch.fromShop}</span>}
                    {batch.assignedTo && (
                      <span> · assigned to {formatAssigneeList(batch.assignedTo)}</span>
                    )}
                  </div>
                  {batch.note && <div className="ot-batch-card__note">{batch.note}</div>}
                </div>
                <span className={`ot-status-badge${isReceived ? ' ot-status-badge--received' : ' ot-status-badge--pending'}`}>
                  {statusLabel}
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

                  {canVerifyOutletTransfer(batch) && (
                    <OutletVerificationPanel batch={batch} onUpdate={updateOutletTransfer} />
                  )}

                  <div className="ot-batch-card__footer">
                    {canConfirmOutletReceipt(batch) && (
                      <button type="button" className="ot-mark-received-btn" onClick={() => handleReceive(batch.id)}>
                        Confirm Outlet received
                      </button>
                    )}
                    {canDeleteOutletTransfer(batch) && (
                      <button
                        type="button"
                        className="ot-delete-transfer-btn"
                        onClick={() => handleDeleteTransfer(batch)}
                      >
                        {isCompleted || isReceived ? 'Delete' : 'Discard'}
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
