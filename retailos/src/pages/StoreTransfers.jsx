import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, AlertTriangle, PackageCheck, CheckCircle2, Clock, ArrowLeftRight, ImageOff } from 'lucide-react'
import useStore from '../store/useStore.js'
import ProductDetailModal from '../components/ProductDetailModal.jsx'
import { aggregateSkus } from '../utils/aggregateSkus.js'
import { getProductLifecycleStatus, STATUS_COLORS } from '../utils/lifecycle.js'
import { toTitleCase } from '../utils/textFormat.js'
import { IconPlus, IconDownload, IconPrint } from '../utils/icons.js'

const THUMB_SIZE = 36

function Thumb({ src, onClick }) {
  const interactive = !!onClick
  const base = {
    width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 6, flexShrink: 0,
    background: 'var(--ro-fill-soft)',
    ...(interactive ? { cursor: 'pointer', transition: 'opacity 0.15s' } : {}),
  }
  if (!src) {
    return (
      <div style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClick}>
        <ImageOff size={16} style={{ color: 'var(--ro-text-muted)' }} />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      style={{ ...base, objectFit: 'cover' }}
      onClick={onClick}
      onError={(e) => { e.target.style.display = 'none' }}
    />
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function downloadCSV(batch) {
  const header = 'SKU,Product,Quantity,Sizes,From,To'
  const rows = batch.items.map(
    (it) => `"${it.skuCode}","${it.productName}",${it.quantity},"${it.sizes || ''}","${batch.fromShop}","${batch.toShop}"`
  )
  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `store-transfer-${batch.createdAt.slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function printBatch(batch, userName) {
  const html = `
    <html>
    <head><title>Store Transfer ${batch.createdAt.slice(0, 10)}</title>
    <style>
      body { font-family: 'DM Sans', sans-serif; padding: 24px; color: #222; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      .meta { font-size: 12px; color: #666; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #ddd; font-size: 13px; }
      th { background: #f5f5f5; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
    </style></head>
    <body>
      <h1>Store Transfer — ${batch.fromShop} → ${batch.toShop}</h1>
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

const BTN = {
  padding: '7px 14px',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: '"DM Sans"',
  border: 'none',
}

function batchStatusBadge(status, hasIssues) {
  if ((status === 'completed' || status === 'received') && hasIssues) {
    return { label: 'Issue', className: 'st-status-badge st-status-badge--issue' }
  }
  if (status === 'completed' || status === 'received') {
    return { label: 'Received', className: 'st-status-badge st-status-badge--received' }
  }
  if (status === 'in_progress') {
    return { label: 'Active', className: 'st-status-badge st-status-badge--active' }
  }
  return { label: 'Pending', className: 'st-status-badge st-status-badge--pending' }
}

function emptyStateCopy(tab, isExec, myShop) {
  if (tab === 'issues') {
    return {
      icon: CheckCircle2,
      title: 'No transfer issues',
      hint: 'All transfers are processing correctly.',
      hintClass: 'st-empty__hint--success',
      showCta: false,
    }
  }
  if (tab === 'history') {
    return {
      icon: Clock,
      title: 'No completed transfers yet',
      hint: 'Completed transfers will appear here.',
      showCta: false,
    }
  }
  if (tab === 'outgoing') {
    return {
      icon: ArrowLeftRight,
      title: 'No outgoing transfers',
      hint: myShop ? `No products being sent from ${myShop} yet.` : 'No outgoing store transfers yet.',
      showCta: true,
    }
  }
  return {
    icon: ArrowLeftRight,
    title: isExec ? 'No active transfers' : 'No incoming transfers',
    hint: isExec
      ? 'Create a new transfer to move products between Ring Mall and Village.'
      : (myShop ? `No products incoming to ${myShop} yet.` : 'No incoming store transfers yet.'),
    showCta: true,
  }
}

function flattenItems(items) {
  const lines = []
  for (const it of items) {
    if (it.sizeBreakdown && it.sizeBreakdown.length > 0) {
      for (const sb of it.sizeBreakdown) {
        lines.push({ skuCode: it.skuCode, productName: it.productName, size: sb.size, qty: sb.qty })
      }
    } else {
      const sizes = (it.sizes || '').split(',').map((s) => s.trim()).filter(Boolean)
      if (sizes.length > 0) {
        const perSize = Math.ceil((it.totalQty ?? it.quantity ?? 0) / sizes.length)
        for (const s of sizes) {
          lines.push({ skuCode: it.skuCode, productName: it.productName, size: s, qty: perSize })
        }
      } else {
        lines.push({ skuCode: it.skuCode, productName: it.productName, size: 'One Size', qty: it.totalQty ?? it.quantity ?? 0 })
      }
    }
  }
  return lines
}

function QtyCounter({ value, max, onChange, disabled }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, borderRadius: 6, border: '1px solid var(--ro-border-hover)', overflow: 'hidden' }}>
      <button
        type="button"
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
        style={{
          width: 26, height: 26, border: 'none', background: 'var(--ro-fill-muted)',
          color: disabled ? '#333' : 'var(--ro-text-dim)', fontSize: 14, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"DM Sans"',
        }}
      >
        −
      </button>
      <span style={{
        minWidth: 30, textAlign: 'center', fontSize: 12, fontWeight: 700,
        color: value === max ? '#00e676' : value === 0 ? '#fbbf24' : '#38bdf8',
        fontFamily: '"DM Sans"', background: 'var(--ro-surface)', height: 26, lineHeight: '26px',
      }}>
        {value}
      </span>
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        style={{
          width: 26, height: 26, border: 'none', background: 'var(--ro-fill-muted)',
          color: disabled ? '#333' : 'var(--ro-text-dim)', fontSize: 14, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"DM Sans"',
        }}
      >
        +
      </button>
    </div>
  )
}

function ReceivingPanel({ batch, onUpdate, onCompleted, onSkuClick }) {
  const addNotification = useStore((s) => s.addNotification)
  const completeAssignmentsForTransfer = useStore((s) => s.completeAssignmentsForTransfer)
  const activeUser = useStore((s) => s.activeUser)
  const photoMap = useStore((s) => s.photoMap)

  const lines = useMemo(() => flattenItems(batch.items), [batch.items])
  const savedStatuses = batch.item_statuses || {}

  const [localStatuses, setLocalStatuses] = useState(() => {
    const init = {}
    for (const line of lines) {
      const key = `${line.skuCode}|${line.size}`
      const saved = savedStatuses[key]
      init[key] = saved || { status: '', comment: '', received: line.qty, expected: line.qty }
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
      if (received < expectedQty) {
        const diff = expectedQty - received
        const ok = window.confirm(`You counted ${received} out of ${expectedQty}.\n${diff} unit(s) missing — confirm?`)
        if (!ok) return prev
        const next = { ...prev, [key]: { ...entry, status: 'partial', received, missing: diff, comment: entry.comment || '' } }
        persist(next)
        return next
      }
      const next = { ...prev, [key]: { ...entry, status: 'done', received, missing: 0, comment: '' } }
      persist(next)
      return next
    })
  }, [persist])

  const markFullMissing = useCallback((key, expectedQty) => {
    setLocalStatuses((prev) => {
      const entry = prev[key] || {}
      const next = { ...prev, [key]: { ...entry, status: 'missing', received: 0, missing: expectedQty, comment: entry.comment || '' } }
      persist(next)
      return next
    })
  }, [persist])

  const setLineComment = useCallback((key, comment) => {
    setLocalStatuses((prev) => {
      const next = { ...prev, [key]: { ...prev[key], comment } }
      persist(next)
      return next
    })
  }, [persist])

  const handleSelectAllDone = useCallback((skuCode) => {
    setLocalStatuses((prev) => {
      const next = { ...prev }
      for (const line of lines) {
        if (line.skuCode === skuCode) {
          const key = `${line.skuCode}|${line.size}`
          if (!next[key]?.status) {
            const received = next[key]?.received ?? line.qty
            next[key] = { ...next[key], status: 'done', received, missing: 0, comment: '' }
          }
        }
      }
      persist(next)
      return next
    })
  }, [lines, persist])

  const skuGroups = useMemo(() => {
    const map = new Map()
    for (const line of lines) {
      if (!map.has(line.skuCode)) map.set(line.skuCode, { skuCode: line.skuCode, productName: line.productName, sizes: [] })
      map.get(line.skuCode).sizes.push(line)
    }
    return [...map.values()]
  }, [lines])

  const allVerified = lines.every((l) => {
    const st = localStatuses[`${l.skuCode}|${l.size}`]
    return st?.status === 'done' || st?.status === 'missing' || st?.status === 'partial'
  })

  const fireCompletionNotifications = useCallback((finalStatuses) => {
    const totalReceived = Object.values(finalStatuses).reduce((s, v) => s + (v.received ?? 0), 0)
    const totalMissing = Object.values(finalStatuses).reduce((s, v) => s + (v.missing ?? 0), 0)

    addNotification({
      type: 'transfer_completed',
      title: 'Transfer Completed',
      message: `Transfer from ${batch.fromShop} to ${batch.toShop} completed. ${totalReceived} units received${totalMissing > 0 ? `, ${totalMissing} units missing` : ''}.`,
      userId: 'all',
      relatedId: batch.id,
    })

    if (totalMissing > 0) {
      const missingLines = Object.entries(finalStatuses)
        .filter(([, v]) => (v.missing ?? 0) > 0)
        .map(([key, v]) => { const [sku, size] = key.split('|'); return `${sku} ${size} ×${v.missing}` })
        .join(', ')
      addNotification({
        type: 'transfer_missing_items',
        title: 'Missing Items Reported',
        message: `${missingLines} reported missing by ${activeUser?.name || 'Unknown'}`,
        userId: batch.createdBy || 'all',
        relatedId: batch.id,
      })
    }

    completeAssignmentsForTransfer(batch.id)
    if (onCompleted) onCompleted(totalReceived, totalMissing)
  }, [addNotification, activeUser, batch, onCompleted, completeAssignmentsForTransfer])

  const handleComplete = () => {
    const current = statusesRef.current
    const unverified = lines.filter((l) => {
      const st = current[`${l.skuCode}|${l.size}`]
      return !st?.status
    })
    if (unverified.length > 0) {
      const skuList = [...new Set(unverified.map((u) => `${u.skuCode} (${u.size})`))]
      const confirmMissing = window.confirm(
        `The following have not been verified:\n${skuList.join('\n')}\n\nAre these products missing?`
      )
      if (confirmMissing) {
        const finalStatuses = { ...current }
        for (const line of unverified) {
          const key = `${line.skuCode}|${line.size}`
          finalStatuses[key] = { status: 'missing', received: 0, missing: line.qty, expected: line.qty, comment: '' }
        }
        statusesRef.current = finalStatuses
        setLocalStatuses(finalStatuses)
        onUpdate(batch.id, { item_statuses: finalStatuses, status: 'completed' })
        fireCompletionNotifications(finalStatuses)
      }
      return
    }

    onUpdate(batch.id, { status: 'completed', item_statuses: current })
    fireCompletionNotifications(current)
  }

  return (
    <div style={{ padding: '0 0 12px' }}>
      {skuGroups.map((group) => (
        <div key={group.skuCode} style={{ borderBottom: '1px solid var(--ro-border)', padding: '10px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Thumb src={photoMap?.[group.skuCode] || null} onClick={onSkuClick ? (e) => { e.stopPropagation(); onSkuClick(group.skuCode) } : undefined} />
              <div onClick={onSkuClick ? (e) => { e.stopPropagation(); onSkuClick(group.skuCode) } : undefined} style={onSkuClick ? { cursor: 'pointer' } : undefined}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ro-text)' }}>{group.productName}</span>
                <span style={{ fontSize: 10, color: 'var(--ro-text-dim)', marginLeft: 8 }}>{group.skuCode}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSelectAllDone(group.skuCode)}
              style={{ ...BTN, background: 'var(--ro-fill-muted)', color: 'var(--ro-text-dim)', fontSize: 10, padding: '4px 10px' }}
            >
              All sizes done
            </button>
          </div>
          {group.sizes.map((line) => {
            const key = `${line.skuCode}|${line.size}`
            const st = localStatuses[key] || {}
            const isDone = st.status === 'done'
            const isPartial = st.status === 'partial'
            const isMissing = st.status === 'missing'
            const isConfirmed = isDone || isPartial || isMissing
            const received = st.received ?? line.qty
            return (
              <div key={key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--ro-border)' }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--ro-text)', background: 'var(--ro-fill-muted)',
                  padding: '2px 8px', borderRadius: 4, minWidth: 54, textAlign: 'center',
                }}>
                  {line.size} <span style={{ color: 'var(--ro-text-dim)', fontWeight: 400 }}>×{line.qty}</span>
                </span>

                <QtyCounter value={received} max={line.qty} onChange={(v) => setReceived(key, v)} disabled={isConfirmed} />

                {!isConfirmed && (
                  <>
                    <button
                      type="button"
                      onClick={() => confirmLine(key, line.qty)}
                      style={{ ...BTN, background: 'rgba(0,230,118,0.12)', color: '#00e676', fontSize: 10, padding: '4px 10px' }}
                    >
                      <Check size={12} style={{ marginRight: 3, verticalAlign: 'middle' }} /> Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => markFullMissing(key, line.qty)}
                      style={{ ...BTN, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', fontSize: 10, padding: '4px 10px' }}
                    >
                      <AlertTriangle size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} /> Missing
                    </button>
                  </>
                )}

                {isDone && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#00e676', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Check size={13} /> {received}/{line.qty} received
                  </span>
                )}
                {isPartial && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <AlertTriangle size={13} /> {received}/{line.qty} — {st.missing} missing
                  </span>
                )}
                {isMissing && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#ff5555', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <AlertTriangle size={13} /> All {line.qty} missing
                  </span>
                )}

                {(isPartial || isMissing) && (
                  <input
                    type="text"
                    placeholder="Comment (e.g. not in box)"
                    value={st.comment || ''}
                    onChange={(e) => setLineComment(key, e.target.value)}
                    style={{
                      flex: '1 1 100%', minWidth: 0, fontSize: 11, padding: '5px 8px', borderRadius: 6,
                      border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.05)',
                      color: '#fbbf24', fontFamily: '"DM Sans"', outline: 'none', marginTop: 2,
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      ))}

      <div style={{ padding: '14px 18px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={handleComplete}
          style={{
            ...BTN,
            background: allVerified ? '#00e676' : 'rgba(0,230,118,0.15)',
            color: allVerified ? '#09090e' : '#00e676',
          }}
        >
          <PackageCheck size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Complete Transfer
        </button>
        {!allVerified && (
          <span style={{ fontSize: 10, color: 'var(--ro-text-muted)' }}>
            {lines.filter((l) => !localStatuses[`${l.skuCode}|${l.size}`]?.status).length} items still need verification
          </span>
        )}
      </div>
    </div>
  )
}

function renderItemRow(it, idx, onSkuClick, fromShop, toShop) {
  const clickable = !!onSkuClick
  const handleClick = clickable ? (e) => { e.stopPropagation(); onSkuClick(it.skuCode) } : undefined
  if (it.sizeBreakdown && it.sizeBreakdown.length > 0) {
    return (
      <tr key={idx} className="ot-batch-table__row">
        <td className="ot-batch-table__sku">{it.skuCode}</td>
        <td className={`ot-batch-table__product${clickable ? ' ot-batch-table__product--link' : ''}`} onClick={handleClick}>{toTitleCase(it.productName)}</td>
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
        <td className="st-batch-table__route">{fromShop}</td>
        <td className="st-batch-table__route">{toShop}</td>
      </tr>
    )
  }
  return (
    <tr key={idx} className="ot-batch-table__row">
      <td className="ot-batch-table__sku">{it.skuCode}</td>
      <td className={`ot-batch-table__product${clickable ? ' ot-batch-table__product--link' : ''}`} onClick={handleClick}>{toTitleCase(it.productName)}</td>
      <td className="ot-batch-table__qty">{it.quantity}</td>
      <td className="ot-batch-table__sizes">{it.sizes || '—'}</td>
      <td className="st-batch-table__route">{fromShop}</td>
      <td className="st-batch-table__route">{toShop}</td>
    </tr>
  )
}

function renderMobileItem(it, idx, onSkuClick, fromShop, toShop) {
  const clickable = !!onSkuClick
  const handleClick = clickable ? (e) => { e.stopPropagation(); onSkuClick(it.skuCode) } : undefined
  const qty = it.totalQty ?? it.quantity ?? 0
  const sizes = it.sizeBreakdown?.length
    ? it.sizeBreakdown.map((b) => `${b.size}×${b.qty}`).join(', ')
    : (it.sizes || '—')
  return (
    <div key={idx} className="st-mobile-item">
      <div className="st-mobile-item__top">
        <span
          className={`st-mobile-item__product${clickable ? ' st-mobile-item__product--link' : ''}`}
          onClick={handleClick}
        >
          {toTitleCase(it.productName)}
        </span>
        <span className="st-mobile-item__qty">{qty}</span>
      </div>
      <div className="st-mobile-item__meta">{it.skuCode} · {sizes}</div>
      <div className="st-mobile-item__route">
        <span>{fromShop}</span>
        <span className="st-mobile-item__arrow" aria-hidden>→</span>
        <span>{toShop}</span>
      </div>
    </div>
  )
}

function StoreTransferTable({ batch, onSkuClick }) {
  return (
    <>
      <div className="transfer-batch-table-wrap ot-batch-table-wrap st-batch-table-wrap">
        <table className="ot-batch-table st-batch-table">
          <thead>
            <tr>
              {['SKU', 'Product', 'Qty', 'Sizes', 'From', 'To'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batch.items.map((it, idx) => renderItemRow(it, idx, onSkuClick, batch.fromShop, batch.toShop))}
          </tbody>
        </table>
      </div>
      <div className="st-mobile-item-list">
        {batch.items.map((it, idx) => renderMobileItem(it, idx, onSkuClick, batch.fromShop, batch.toShop))}
      </div>
    </>
  )
}

function CompletedSummary({ batch, expanded: forceExpanded, onSkuClick }) {
  const photoMap = useStore((s) => s.photoMap)
  const statuses = batch.item_statuses || {}
  const entries = Object.entries(statuses)
  const hasVerificationData = entries.length > 0 && entries.some(([, v]) => v.status)

  const itemTotalUnits = batch.items.reduce((s, i) => s + (i.totalQty ?? i.quantity ?? 0), 0)

  const totalReceived = hasVerificationData
    ? entries.reduce((s, [, v]) => s + (v.received ?? 0), 0)
    : itemTotalUnits
  const totalMissing = hasVerificationData
    ? entries.reduce((s, [, v]) => s + (v.missing ?? 0), 0)
    : 0
  const totalExpected = hasVerificationData
    ? entries.reduce((s, [, v]) => s + ((v.received ?? 0) + (v.missing ?? 0)), 0)
    : itemTotalUnits
  const itemsWithMissing = entries.filter(([, v]) => (v.missing ?? 0) > 0)
  const allItems = entries.filter(([, v]) => v.status)

  return (
    <div style={{ padding: '12px 18px' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        {hasVerificationData ? (
          <>
            <div style={{ fontSize: 12, color: totalMissing > 0 ? '#fbbf24' : '#00e676', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Check size={13} />
              {totalReceived}/{totalExpected} units received
            </div>
            {totalMissing > 0 && (
              <div style={{ fontSize: 12, color: '#ff5555', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
                <AlertTriangle size={13} />
                {totalMissing} units missing
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--ro-text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={13} />
            {itemTotalUnits} units transferred — no item-level verification recorded
          </div>
        )}
        {batch.receivedAt && (
          <div style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <Clock size={11} /> Received {formatDate(batch.receivedAt)}
          </div>
        )}
      </div>

      {!hasVerificationData && (
        <>
          <StoreTransferTable batch={batch} onSkuClick={onSkuClick} />
          <div className="st-completed-note">
            Completed before item-level verification was available.
          </div>
        </>
      )}

      {hasVerificationData && (forceExpanded || allItems.length <= 20) && (
        <div className="transfer-batch-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <thead>
              <tr>
                {['', 'SKU', 'Size', 'Sent', 'Received', 'Missing', 'Status', 'Comment'].map((h) => (
                  <th key={h || '_img'} style={{
                    textAlign: 'left', padding: '6px 10px', fontSize: 9, fontWeight: 700,
                    color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px',
                    borderBottom: '1px solid var(--ro-border)',
                    ...(h === '' ? { width: THUMB_SIZE + 16 } : {}),
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allItems.map(([key, val]) => {
                const [sku, size] = key.split('|')
                const sent = (val.received ?? 0) + (val.missing ?? 0)
                const isDone = val.status === 'done'
                const isPartial = val.status === 'partial'
                const isMissing = val.status === 'missing'
                return (
                  <tr key={key}>
                    <td style={{ padding: '5px 10px', width: THUMB_SIZE + 16 }}><Thumb src={photoMap?.[sku] || null} onClick={onSkuClick ? (e) => { e.stopPropagation(); onSkuClick(sku) } : undefined} /></td>
                    <td style={{ padding: '5px 10px', fontSize: 11, color: onSkuClick ? '#38bdf8' : 'var(--ro-text-dim)', cursor: onSkuClick ? 'pointer' : 'default' }} onClick={onSkuClick ? (e) => { e.stopPropagation(); onSkuClick(sku) } : undefined}>{sku}</td>
                    <td style={{ padding: '5px 10px', fontSize: 11, color: 'var(--ro-text)', fontWeight: 600 }}>{size}</td>
                    <td style={{ padding: '5px 10px', fontSize: 11, color: 'var(--ro-text)' }}>{sent}</td>
                    <td style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, color: isDone ? '#00e676' : isPartial ? '#38bdf8' : '#ff5555' }}>{val.received ?? 0}</td>
                    <td style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, color: (val.missing ?? 0) > 0 ? '#fbbf24' : 'var(--ro-text-muted)' }}>{val.missing ?? 0}</td>
                    <td style={{ padding: '5px 10px' }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4,
                        background: isDone ? 'rgba(0,230,118,0.1)' : isPartial ? 'rgba(56,189,248,0.1)' : 'rgba(255,85,85,0.1)',
                        color: isDone ? '#00e676' : isPartial ? '#38bdf8' : '#ff5555',
                      }}>
                        {isDone ? 'Full' : isPartial ? 'Partial' : isMissing ? 'Missing' : val.status}
                      </span>
                    </td>
                    <td style={{ padding: '5px 10px', fontSize: 10, color: 'var(--ro-text-dim)', fontStyle: 'italic' }}>{val.comment || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {itemsWithMissing.length > 0 && (
        <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: 8, padding: 10, marginTop: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', marginBottom: 6 }}>Missing Items Summary</div>
          {itemsWithMissing.map(([key, val]) => {
            const [sku, size] = key.split('|')
            return (
              <div key={key} style={{ fontSize: 11, color: 'var(--ro-text)', padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{sku} — {size}</span>
                <span style={{ color: '#fbbf24', fontWeight: 700 }}>×{val.missing}</span>
                {val.comment && <span style={{ color: 'var(--ro-text-dim)', fontStyle: 'italic' }}>{val.comment}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ExecIssueSummary({ issues, getUserName }) {
  const totalMissingUnits = issues.reduce((sum, t) => {
    const vals = Object.values(t.item_statuses || {})
    return sum + vals.reduce((s, v) => s + (v.missing ?? 0), 0)
  }, 0)

  const allMissingItems = []
  for (const t of issues) {
    const st = t.item_statuses || {}
    for (const [key, val] of Object.entries(st)) {
      if ((val.missing ?? 0) > 0) {
        const [sku, size] = key.split('|')
        allMissingItems.push({
          sku, size,
          missing: val.missing,
          comment: val.comment || '',
          fromShop: t.fromShop,
          toShop: t.toShop,
          date: t.createdAt,
          createdBy: t.createdBy,
        })
      }
    }
  }

  return (
    <div className="st-issue-overview">
      <div className="st-issue-overview__head">
        <AlertTriangle size={18} className="st-issue-overview__icon" aria-hidden />
        <span className="st-issue-overview__title">Missing Items Overview</span>
      </div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#ff5555' }}>{issues.length}</div>
          <div style={{ fontSize: 10, color: 'var(--ro-text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Transfers with issues</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fbbf24' }}>{totalMissingUnits}</div>
          <div style={{ fontSize: 10, color: 'var(--ro-text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total units missing</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ro-text)' }}>{allMissingItems.length}</div>
          <div style={{ fontSize: 10, color: 'var(--ro-text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Affected SKU/size lines</div>
        </div>
      </div>
      {allMissingItems.length > 0 && (
        <div className="transfer-batch-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['SKU', 'Size', 'Missing', 'Route', 'Date', 'Created by', 'Comment'].map((h) => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '6px 8px', fontSize: 9, fontWeight: 700,
                    color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px',
                    borderBottom: '1px solid var(--ro-border)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allMissingItems.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '5px 8px', fontSize: 11, color: 'var(--ro-text)', fontWeight: 600 }}>{item.sku}</td>
                  <td style={{ padding: '5px 8px', fontSize: 11, color: 'var(--ro-text)' }}>{item.size}</td>
                  <td style={{ padding: '5px 8px', fontSize: 11, fontWeight: 700, color: '#ff5555' }}>×{item.missing}</td>
                  <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--ro-text-dim)' }}>{item.fromShop} → {item.toShop}</td>
                  <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--ro-text-dim)' }}>{formatDate(item.date)}</td>
                  <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--ro-text-dim)' }}>{getUserName(item.createdBy)}</td>
                  <td style={{ padding: '5px 8px', fontSize: 10, color: '#fbbf24', fontStyle: 'italic' }}>{item.comment || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SuccessToast({ message, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div style={{
      position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--ro-surface)', border: '1px solid rgba(0,230,118,0.3)',
      borderRadius: 12, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 9999, animation: 'fadeUp 0.3s ease',
    }}>
      <CheckCircle2 size={20} style={{ color: '#00e676', flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#00e676', marginBottom: 2 }}>Transfer Completed</div>
        <div style={{ fontSize: 11, color: 'var(--ro-text-dim)' }}>{message}</div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', color: 'var(--ro-text-muted)', cursor: 'pointer', fontSize: 16, padding: '0 0 0 8px' }}
      >
        ×
      </button>
    </div>
  )
}

export function StoreTransfers() {
  const navigate = useNavigate()
  const transfers = useStore((s) => s.storeTransfers)
  const updateStoreTransfer = useStore((s) => s.updateStoreTransfer)
  const addNotification = useStore((s) => s.addNotification)
  const users = useStore((s) => s.users)
  const activeUser = useStore((s) => s.activeUser)
  const myShop = activeUser?.shop || ''
  const isExec = activeUser?.role === 'executive'

  const skus = useStore((s) => s.skus)

  const [tab, setTab] = useState(isExec ? 'history' : 'incoming')
  const [expanded, setExpanded] = useState(null)
  const [toast, setToast] = useState(null)
  const [detailSku, setDetailSku] = useState(null)

  const skuMap = useMemo(() => {
    const products = aggregateSkus(skus)
    const m = {}
    for (const p of products) m[p.sku] = p
    return m
  }, [skus])

  const handleSkuClick = useCallback((skuCode) => {
    const product = skuMap[skuCode]
    if (product) setDetailSku(product)
  }, [skuMap])

  const myTransfers = useMemo(() => isExec ? transfers : transfers.filter((t) => t.toShop === myShop || t.fromShop === myShop), [transfers, myShop, isExec])
  const incoming = useMemo(() => myTransfers.filter((t) => (isExec || t.toShop === myShop) && t.status !== 'completed' && t.status !== 'received'), [myTransfers, myShop, isExec])
  const outgoing = useMemo(() => myTransfers.filter((t) => (isExec || t.fromShop === myShop) && t.status !== 'completed' && t.status !== 'received'), [myTransfers, myShop, isExec])
  const history = useMemo(() => myTransfers.filter((t) => t.status === 'completed' || t.status === 'received').sort((a, b) => (b.receivedAt || b.createdAt || '').localeCompare(a.receivedAt || a.createdAt || '')), [myTransfers])

  const getUserName = (id) => users.find((u) => u.id === id)?.name || id

  const handleMarkReceived = (batch) => {
    updateStoreTransfer(batch.id, { status: 'in_progress', receivedAt: new Date().toISOString() })
    addNotification({
      type: 'transfer_received',
      title: 'Transfer Received',
      message: `Transfer to ${batch.toShop} has been received by ${activeUser?.name || 'Unknown'}`,
      userId: batch.createdBy || 'all',
      relatedId: batch.id,
    })
  }

  const handleTransferUpdate = (transferId, changes) => {
    updateStoreTransfer(transferId, changes)
  }

  const handleTransferCompleted = useCallback((received, missing) => {
    setToast(`${received} units verified${missing > 0 ? `, ${missing} units reported missing` : '. All items accounted for.'}`)
  }, [])

  const issues = useMemo(() => history.filter((t) => {
    const st = t.item_statuses || {}
    const vals = Object.values(st)
    return vals.length > 0 && vals.some((v) => (v.missing ?? 0) > 0 || v.status === 'missing' || v.status === 'partial')
  }), [history])

  const tabs = isExec
    ? [
        { key: 'incoming', label: 'Active', count: incoming.length },
        { key: 'issues', label: 'Issues', count: issues.length },
        { key: 'history', label: 'History', count: history.length },
      ]
    : [
        { key: 'incoming', label: 'Incoming', count: incoming.length },
        { key: 'outgoing', label: 'Outgoing', count: outgoing.length },
        { key: 'history', label: 'History', count: history.length },
      ]

  const visible = tab === 'incoming' ? incoming : tab === 'outgoing' ? outgoing : tab === 'issues' ? issues : history
  const emptyCopy = emptyStateCopy(tab, isExec, myShop)
  const EmptyIcon = emptyCopy.icon

  return (
    <div className="store-transfers-page outlet-transfers-page">
      {toast && <SuccessToast message={toast} onDismiss={() => setToast(null)} />}

      <p className="ot-page-subtitle page-hero-mobile-hide">
        Products being moved between retail shops. Each day&apos;s transfers per destination are grouped into one batch.
      </p>

      <button type="button" className="ot-new-transfer-btn st-new-transfer-btn" onClick={() => navigate('/new-transfer')}>
        <IconPlus size={14} strokeWidth={2} className="ot-new-transfer-btn__icon" />
        New Transfer
      </button>

      <div className="st-transfer-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`st-transfer-tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => { setTab(t.key); setExpanded(null) }}
          >
            <span className="st-transfer-tab__label">{t.label}</span>
            <span className="st-transfer-tab__count"> ({t.count})</span>
          </button>
        ))}
      </div>

      <div className="st-transfer-panel">
        {isExec && tab === 'issues' && issues.length > 0 && (
          <ExecIssueSummary issues={issues} getUserName={getUserName} />
        )}

        {visible.length === 0 ? (
          <div className="st-empty">
            <EmptyIcon className="st-empty__icon" size={32} strokeWidth={1.5} aria-hidden />
            <p className="st-empty__title">{emptyCopy.title}</p>
            <p className={`st-empty__hint${emptyCopy.hintClass ? ` ${emptyCopy.hintClass}` : ''}`}>{emptyCopy.hint}</p>
            {emptyCopy.showCta ? (
              <button type="button" className="ot-new-transfer-btn st-empty__cta" onClick={() => navigate('/new-transfer')}>
                <IconPlus size={14} strokeWidth={2} className="ot-new-transfer-btn__icon" />
                New Transfer
              </button>
            ) : null}
          </div>
        ) : (
          <div className="ot-batch-list">
            {visible.map((batch) => {
              const isExpanded = expanded === batch.id || (tab === 'issues' && expanded === null)
              const status = batch.status || 'pending'
              const totalUnits = batch.items.reduce((s, i) => s + (i.totalQty ?? i.quantity ?? 0), 0)
              const isIncoming = isExec ? true : batch.toShop === myShop
              const isInProgress = status === 'in_progress'
              const isCompleted = status === 'completed' || status === 'received'
              const isPending = status === 'pending'

              const statuses = batch.item_statuses || {}
              const statusEntries = Object.values(statuses)
              const hasVerification = isCompleted && statusEntries.length > 0 && statusEntries.some((v) => v.status)
              const completedReceived = hasVerification
                ? statusEntries.reduce((s, v) => s + (v.received ?? 0), 0)
                : (isCompleted ? totalUnits : 0)
              const completedMissing = hasVerification
                ? statusEntries.reduce((s, v) => s + (v.missing ?? 0), 0)
                : 0
              const hasIssues = completedMissing > 0
              const badge = batchStatusBadge(status, hasIssues)

              return (
                <div key={batch.id} className={`ot-batch-card st-batch-card${tab === 'issues' && hasIssues ? ' st-batch-card--issue' : ''}`}>
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
                        {batch.assignedTo && <span> · assigned to {getUserName(batch.assignedTo)}</span>}
                        {!isExec && (
                          <span> · {isIncoming ? `from ${batch.fromShop}` : `to ${batch.toShop}`}</span>
                        )}
                      </div>
                      {batch.note && <div className="ot-batch-card__note">{batch.note}</div>}
                      {isCompleted && (tab === 'history' || tab === 'issues') && (
                        <div className="st-batch-card__summary">
                          {hasVerification ? (
                            <>
                              <span className={hasIssues ? 'st-batch-card__summary-warn' : 'st-batch-card__summary-ok'}>
                                {completedReceived} received
                              </span>
                              {hasIssues && (
                                <span className="st-batch-card__summary-missing">
                                  <AlertTriangle size={11} /> {completedMissing} missing
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="st-batch-card__summary-muted">{totalUnits} units — no verification data</span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className={badge.className}>{badge.label}</span>
                    <span className={`ot-batch-card__chevron${isExpanded ? ' ot-batch-card__chevron--expanded' : ''}`} aria-hidden>
                      ▼
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="ot-batch-card__body">
                      {(isPending || (!isInProgress && !isCompleted)) && (
                        <StoreTransferTable batch={batch} onSkuClick={handleSkuClick} />
                      )}

                      {isInProgress && isIncoming && tab !== 'history' && (
                        <ReceivingPanel
                          batch={batch}
                          onUpdate={handleTransferUpdate}
                          onCompleted={handleTransferCompleted}
                          onSkuClick={handleSkuClick}
                        />
                      )}

                      {isInProgress && !isIncoming && (
                        <StoreTransferTable batch={batch} onSkuClick={handleSkuClick} />
                      )}

                      {isCompleted && (
                        <CompletedSummary batch={batch} expanded={tab === 'history'} onSkuClick={handleSkuClick} />
                      )}

                      <div className="ot-batch-card__footer transfer-batch-actions">
                        {isPending && isIncoming && (
                          <button type="button" className="ot-mark-received-btn" onClick={() => handleMarkReceived(batch)}>
                            Mark as Received
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
                            <span className="ot-batch-card__received-dot" aria-hidden>●</span>
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
        )}
      </div>

      {detailSku && (() => {
        const st = getProductLifecycleStatus(detailSku)
        return (
          <ProductDetailModal
            sku={detailSku}
            status={st}
            statusData={{ color: STATUS_COLORS[st] || 'var(--ro-text-dim)', colorBg: `${STATUS_COLORS[st] || '#64748b'}18` }}
            onClose={() => setDetailSku(null)}
          />
        )
      })()}
    </div>
  )
}
