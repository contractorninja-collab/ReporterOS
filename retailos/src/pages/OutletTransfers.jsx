import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, Globe2, ImageOff, X } from 'lucide-react'
import useStore from '../store/useStore.js'
import { toTitleCase } from '../utils/textFormat.js'
import { IconPlus, IconDownload, IconPrint } from '../utils/icons.js'
import {
  buildOutletVerificationEntry,
  outletShortageDraftError,
  outletVerificationEntryError,
} from '../utils/outletTransfers.js'

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

function OutletThumb({ src, size = 38 }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const style = { width: size, height: size }
  if (!src || failed) {
    return (
      <div className="ot-product-thumb ot-product-thumb--empty" style={style} aria-label="No product image">
        <ImageOff size={Math.max(14, Math.round(size * 0.42))} />
      </div>
    )
  }
  return <img className="ot-product-thumb" style={style} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
}

function renderItemRow(it, idx, photoMap) {
  if (it.sizeBreakdown && it.sizeBreakdown.length > 0) {
    return (
      <tr key={idx} className="ot-batch-table__row">
        <td className="ot-batch-table__photo"><OutletThumb src={photoMap?.[it.skuCode] || null} /></td>
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
      <td className="ot-batch-table__photo"><OutletThumb src={photoMap?.[it.skuCode] || null} /></td>
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

function ShortageDialog({ line, entry, photoUrl, saving, onClose, onSave }) {
  const [missing, setMissing] = useState(entry?.missing > 0 ? String(entry.missing) : '1')
  const [comment, setComment] = useState(entry?.missing > 0 ? String(entry.comment || '') : '')
  const [error, setError] = useState('')

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  const submit = async (event) => {
    event.preventDefault()
    const validationError = outletShortageDraftError({ expected: line.qty, missing, comment })
    if (validationError) {
      setError(validationError)
      return
    }
    try {
      await onSave({ missing: Number(missing), comment: comment.trim() })
    } catch (saveError) {
      setError(saveError?.message || 'Could not save this shortage. Try again.')
    }
  }

  const received = Number.isInteger(Number(missing))
    ? Math.max(0, line.qty - Number(missing))
    : line.qty

  return (
    <div className="ot-shortage-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <form className="ot-shortage-dialog" role="dialog" aria-modal="true" aria-labelledby="ot-shortage-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="ot-shortage-dialog__head">
          <div>
            <span className="ot-shortage-dialog__eyebrow">Report shortage</span>
            <h2 id="ot-shortage-title">How many are missing?</h2>
          </div>
          <button type="button" className="ot-shortage-dialog__close" aria-label="Close" disabled={saving} onClick={onClose}><X size={17} /></button>
        </div>

        <div className="ot-shortage-dialog__product">
          <OutletThumb src={photoUrl} size={46} />
          <div>
            <strong>{toTitleCase(line.productName)}</strong>
            <span>{line.skuCode} · {line.size} · {line.qty} expected</span>
          </div>
        </div>

        <label className="ot-shortage-field">
          <span>Missing quantity</span>
          <input autoFocus type="number" min="1" max={line.qty} step="1" inputMode="numeric" value={missing} disabled={saving} onChange={(event) => { setMissing(event.target.value); setError('') }} />
        </label>

        <div className="ot-shortage-dialog__accounting" aria-live="polite">
          <span><strong>{received}</strong> confirmed</span>
          <span><strong>{missing || '—'}</strong> missing</span>
        </div>

        <label className="ot-shortage-field">
          <span>Why is it missing? <em>Required</em></span>
          <textarea rows="3" maxLength="1000" placeholder="Briefly explain what happened…" value={comment} disabled={saving} onChange={(event) => { setComment(event.target.value); setError('') }} />
        </label>

        {error && <p className="ot-shortage-dialog__error" role="alert">{error}</p>}

        <div className="ot-shortage-dialog__actions">
          <button type="button" className="ot-shortage-dialog__cancel" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="submit" className="ot-shortage-dialog__save" disabled={saving}>{saving ? 'Saving…' : 'Save shortage'}</button>
        </div>
      </form>
    </div>
  )
}

function OutletVerificationPanel({ batch, onUpdate, photoMap }) {
  const lines = useMemo(() => flattenItems(batch.items), [batch.items])
  const savedStatuses = useMemo(() => batch.item_statuses || {}, [batch.item_statuses])
  const [localStatuses, setLocalStatuses] = useState(savedStatuses)
  const [shortageLine, setShortageLine] = useState(null)
  const [savingKey, setSavingKey] = useState('')
  const [completing, setCompleting] = useState(false)
  const [panelError, setPanelError] = useState('')

  const statusesRef = useRef(localStatuses)
  useEffect(() => { statusesRef.current = localStatuses }, [localStatuses])
  useEffect(() => {
    setLocalStatuses(savedStatuses)
    statusesRef.current = savedStatuses
  }, [batch.id, savedStatuses])

  const persist = useCallback(async (next, previous) => {
    statusesRef.current = next
    setLocalStatuses(next)
    try {
      await onUpdate(batch.id, { item_statuses: next })
    } catch (error) {
      statusesRef.current = previous
      setLocalStatuses(previous)
      throw error
    }
  }, [batch.id, onUpdate])

  const confirmLine = useCallback(async (line) => {
    const key = `${line.skuCode}|${line.size}`
    const previous = statusesRef.current
    const next = { ...previous, [key]: buildOutletVerificationEntry({ expected: line.qty }) }
    setSavingKey(key)
    setPanelError('')
    try {
      await persist(next, previous)
    } catch (error) {
      setPanelError(error?.message || 'Could not save this line. Try again.')
    } finally {
      setSavingKey('')
    }
  }, [persist])

  const saveShortage = useCallback(async ({ missing, comment }) => {
    if (!shortageLine) return
    const key = `${shortageLine.skuCode}|${shortageLine.size}`
    const previous = statusesRef.current
    const next = {
      ...previous,
      [key]: buildOutletVerificationEntry({ expected: shortageLine.qty, missing, comment }),
    }
    setSavingKey(key)
    setPanelError('')
    try {
      await persist(next, previous)
      setShortageLine(null)
    } finally {
      setSavingKey('')
    }
  }, [persist, shortageLine])

  const allVerified = lines.length > 0 && lines.every((line) => {
    const entry = localStatuses[`${line.skuCode}|${line.size}`]
    return !outletVerificationEntryError(entry, line.qty)
  })

  const handleComplete = async () => {
    const current = statusesRef.current
    if (!allVerified || completing) return
    setCompleting(true)
    setPanelError('')
    try {
      await onUpdate(batch.id, { item_statuses: current, status: 'completed' })
    } catch (error) {
      setPanelError(error?.message || 'Could not complete this transfer. Try again.')
    } finally {
      setCompleting(false)
    }
  }

  return (
    <section className="ot-verification" aria-label="Outlet transfer verification">
      <div className="ot-verification__intro">
        <div><strong>Verify transfer</strong><span>Confirm each size or report a shortage.</span></div>
        <span>{lines.filter((line) => !outletVerificationEntryError(localStatuses[`${line.skuCode}|${line.size}`], line.qty)).length}/{lines.length} resolved</span>
      </div>
      {lines.map((line) => {
        const key = `${line.skuCode}|${line.size}`
        const entry = localStatuses[key]
        const isDone = entry?.status === 'done'
        const hasShortage = entry?.status === 'partial' || entry?.status === 'missing'
        const isSaving = savingKey === key
        const result = entry?.status
          ? `${Number(entry.received) || 0} confirmed · ${Number(entry.missing) || 0} missing`
          : 'Not verified'
        return (
          <div key={key} className={`ot-verification-line${isDone ? ' is-done' : ''}${hasShortage ? ' has-shortage' : ''}`}>
            <div className="ot-verification-line__identity">
              <OutletThumb src={photoMap?.[line.skuCode] || null} />
              <div>
                <strong>{toTitleCase(line.productName)}</strong>
                <span>{line.skuCode} · {line.size} · {line.qty} expected</span>
              </div>
            </div>
            <div className={`ot-verification-line__result${hasShortage ? ' has-shortage' : ''}`}>{result}</div>
            <div className="ot-verification-line__actions">
              <button type="button" className={`ot-line-action ot-line-action--done${isDone ? ' is-active' : ''}`} disabled={isSaving || completing} onClick={() => confirmLine(line)}>
                <Check size={13} /> {isSaving && !hasShortage ? 'Saving…' : 'Done'}
              </button>
              <button type="button" className={`ot-line-action ot-line-action--missing${hasShortage ? ' is-active' : ''}`} disabled={isSaving || completing} onClick={() => setShortageLine(line)}>
                <AlertTriangle size={13} /> Missing
              </button>
            </div>
          </div>
        )
      })}
      {panelError && <p className="ot-verification__error" role="alert">{panelError}</p>}
      <div className="ot-verification__finish">
        {!allVerified && <span>Resolve every size and explain each shortage.</span>}
        <button type="button" className="ot-mark-received-btn" disabled={!allVerified || completing} onClick={handleComplete}>
          {completing ? 'Completing…' : 'Complete transfer verification'}
        </button>
      </div>
      {shortageLine && (
        <ShortageDialog
          key={`${shortageLine.skuCode}|${shortageLine.size}`}
          line={shortageLine}
          entry={localStatuses[`${shortageLine.skuCode}|${shortageLine.size}`]}
          photoUrl={photoMap?.[shortageLine.skuCode] || null}
          saving={savingKey === `${shortageLine.skuCode}|${shortageLine.size}`}
          onClose={() => setShortageLine(null)}
          onSave={saveShortage}
        />
      )}
    </section>
  )
}

function WebLocationPhoto({ src, skuCode }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) {
    return (
      <div className="md-sale-card__img-empty" aria-label={`No product image for ${skuCode}`}>
        <ImageOff size={28} strokeWidth={1.25} />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={`Product ${skuCode}`}
      loading="lazy"
      className="md-sale-card__img"
      onError={() => setFailed(true)}
    />
  )
}

function WebLocationChecklist({ list, photoMap, onToggle }) {
  const [markingSku, setMarkingSku] = useState('')
  const [error, setError] = useState('')
  const items = list.items || []
  const statuses = list.item_statuses || {}
  const markedCount = items.filter(
    (item) => statuses[item.skuCode]?.['E-commerce']?.status === 'tagged',
  ).length
  const isComplete = list.status === 'completed' && items.length > 0 && markedCount === items.length

  const toggleItem = async (skuCode) => {
    if (markingSku) return
    setMarkingSku(skuCode)
    setError('')
    try {
      await onToggle(list.id, skuCode, 'E-commerce')
    } catch (saveError) {
      setError(saveError?.message || 'Could not save this website location update. Try again.')
    } finally {
      setMarkingSku('')
    }
  }

  return (
    <section className="ot-web-location" aria-label="Change Location Web checklist">
      <div className="ot-web-location__head">
        <div>
          <span className="ot-web-location__eyebrow">E-commerce handoff</span>
          <h3>Change Location Web</h3>
          <p>Mark each SKU after its website location has been changed to Outlet.</p>
        </div>
        <span className={`ot-web-location__progress${isComplete ? ' is-complete' : ''}`}>
          {isComplete ? 'Completed' : `${markedCount}/${items.length} marked`}
        </span>
      </div>
      <div className="ot-web-location__track" aria-hidden="true">
        <span style={{ width: `${items.length ? (markedCount / items.length) * 100 : 0}%` }} />
      </div>
      {error && <p className="ot-web-location__error" role="alert">{error}</p>}
      <div className="md-sale-list-grid ot-web-location__grid">
        {items.map((item) => {
          const marked = statuses[item.skuCode]?.['E-commerce']?.status === 'tagged'
          const saving = markingSku === item.skuCode
          return (
            <article key={item.skuCode} className={`md-sale-card ot-web-location-card${marked ? ' is-marked' : ''}`}>
              <div className="md-sale-card__media">
                <WebLocationPhoto src={photoMap?.[item.skuCode] || null} skuCode={item.skuCode} />
              </div>
              <div className="md-sale-card__body">
                <div className="md-sale-card__info ot-web-location-card__info">
                  {marked && <span className="md-sale-card__tagged-pill">✓ Marked</span>}
                  <h3 className="ot-web-location-card__sku">{item.skuCode}</h3>
                </div>
                <div className="md-sale-card__footer">
                  <button
                    type="button"
                    className={`md-sale-card__mark-btn${marked ? ' md-sale-card__mark-btn--done' : ''}`}
                    disabled={Boolean(markingSku)}
                    onClick={() => toggleItem(item.skuCode)}
                  >
                    {saving ? 'Saving…' : marked ? '✓ Marked' : 'Mark'}
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export function OutletTransfers() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedTransferId = searchParams.get('transfer')
  const transfers = useStore((s) => s.outletTransfers)
  const updateOutletTransfer = useStore((s) => s.updateOutletTransfer)
  const deleteOutletTransfer = useStore((s) => s.deleteOutletTransfer)
  const users = useStore((s) => s.users)
  const activeUser = useStore((s) => s.activeUser)
  const photoMap = useStore((s) => s.photoMap)
  const markdownLists = useStore((s) => s.markdownLists)
  const toggleMarkdownListItemTagged = useStore((s) => s.toggleMarkdownListItemTagged)
  const [expanded, setExpanded] = useState(null)
  const [webLocationOpen, setWebLocationOpen] = useState(null)

  useEffect(() => {
    if (requestedTransferId && transfers.some((transfer) => transfer.id === requestedTransferId)) {
      setExpanded(requestedTransferId)
    }
  }, [requestedTransferId, transfers])

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
    updateOutletTransfer(id, { status: 'received', receivedAt: new Date().toISOString() }).catch(() => {})
  }

  const handleDeleteTransfer = (batch) => {
    const isFinal = batch.status === 'completed' || batch.status === 'received'
    const ok = window.confirm(
      `${isFinal ? 'Delete confirmed' : 'Discard'} outlet transfer?\nThis removes the transfer list for everyone${batch.status === 'received' ? ' and clears its linked E-commerce sale and Change Location Web lists.' : '.'}`,
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

  const canDeleteOutletTransfer = () => activeUser?.role === 'executive'

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
          const locationChange = activeUser?.role === 'executive' && isReceived
            ? markdownLists.find((list) => list.kind === 'location_change' && list.sourceTransferId === batch.id)
            : null
          const locationItems = locationChange?.items || []
          const locationMarked = locationItems.filter(
            (item) => locationChange?.item_statuses?.[item.skuCode]?.['E-commerce']?.status === 'tagged',
          ).length
          const locationComplete = locationChange?.status === 'completed' && locationItems.length > 0 && locationMarked === locationItems.length
          const isWebLocationOpen = webLocationOpen === batch.id
          return (
            <div key={batch.id} className="ot-batch-card">
              <div
                className="ot-batch-card__head"
                onClick={() => setExpanded(isExpanded ? null : batch.id)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
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
                  {locationChange && (
                    <button
                      type="button"
                      className={`ot-web-location-chip${locationComplete ? ' is-complete' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setExpanded(batch.id)
                        setWebLocationOpen(isWebLocationOpen ? null : batch.id)
                      }}
                    >
                      <Globe2 size={13} strokeWidth={1.8} />
                      Change Location Web · {locationComplete ? 'Completed' : `${locationMarked}/${locationItems.length}`}
                    </button>
                  )}
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
                          <th aria-label="Product image" />
                          <th>SKU</th>
                          <th>Product</th>
                          <th>Qty</th>
                          <th>Sizes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.items.map((it, idx) => renderItemRow(it, idx, photoMap))}
                      </tbody>
                    </table>
                  </div>

                  {canVerifyOutletTransfer(batch) && (
                    <OutletVerificationPanel batch={batch} onUpdate={updateOutletTransfer} photoMap={photoMap} />
                  )}

                  {locationChange && isWebLocationOpen && (
                    <WebLocationChecklist
                      list={locationChange}
                      photoMap={photoMap}
                      onToggle={toggleMarkdownListItemTagged}
                    />
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
