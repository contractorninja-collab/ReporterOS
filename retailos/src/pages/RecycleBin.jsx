import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../api/client.js'
import useStore from '../store/useStore'
import { IconDelete, IconReorder } from '../utils/icons.js'
import { toTitleCase } from '../utils/textFormat.js'

function formatWhen(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const datePart = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const timePart = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    return `${datePart}, ${timePart}`
  } catch {
    return iso
  }
}

function formatDeletedDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function countdownTone(daysLeft) {
  if (daysLeft < 7) return 'danger'
  if (daysLeft <= 14) return 'warn'
  return 'safe'
}

function TimeLeftBadge({ daysLeft }) {
  const tone = countdownTone(daysLeft)
  const label = daysLeft <= 0 ? 'Purging…' : `${daysLeft} day${daysLeft === 1 ? '' : 's'}`
  return <span className={`rb-chip rb-chip--${tone}`}>{label}</span>
}

function BinItemActions({ item, pendingCode, pendingAction, onRestore, onPurgeRequest, layout = 'table' }) {
  const busy = pendingCode === item.sku
  return (
    <div className={`rb-item-actions rb-item-actions--${layout}`}>
      <button
        type="button"
        className="rb-btn rb-btn--restore"
        disabled={busy}
        onClick={() => onRestore(item)}
      >
        <IconReorder size={14} strokeWidth={2} aria-hidden />
        {busy && pendingAction === 'restore' ? 'Restoring…' : 'Restore'}
      </button>
      <button
        type="button"
        className="rb-btn rb-btn--purge"
        disabled={busy}
        onClick={() => onPurgeRequest(item)}
        aria-label={`Permanently delete ${item.product_name || item.sku}`}
        title="Delete permanently"
      >
        <IconDelete size={15} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  )
}

export function RecycleBin() {
  const setSkus = useStore((s) => s.setSkus)
  const [items, setItems] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [pendingCode, setPendingCode] = useState(null)
  const [pendingAction, setPendingAction] = useState(null) // 'restore' | 'purge'
  const [purgeConfirm, setPurgeConfirm] = useState(null)
  const [banner, setBanner] = useState('')
  const [autoPurged, setAutoPurged] = useState([])

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const data = await api.fetchBinnedSkus()
      const list = Array.isArray(data?.items) ? data.items : []
      setItems(list)
      if (Array.isArray(data?.autoPurgedCodes) && data.autoPurgedCodes.length) {
        setAutoPurged(data.autoPurgedCodes)
      }
    } catch (e) {
      setLoadError(e?.message || 'Failed to load recycle bin')
      setItems([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const refreshActiveSkus = useCallback(async () => {
    const fresh = await api.fetchSkus().catch(() => null)
    if (Array.isArray(fresh)) setSkus(fresh)
  }, [setSkus])

  const handleRestore = useCallback(async (item) => {
    setPendingCode(item.sku)
    setPendingAction('restore')
    try {
      await api.restoreSku(item.sku)
      setBanner(`Restored “${item.product_name || item.sku}” to active catalog.`)
      await Promise.all([load(), refreshActiveSkus()])
    } catch (e) {
      setLoadError(e?.message || 'Restore failed')
    } finally {
      setPendingCode(null)
      setPendingAction(null)
    }
  }, [load, refreshActiveSkus])

  const handlePurge = useCallback(async () => {
    if (!purgeConfirm) return
    const item = purgeConfirm
    setPendingCode(item.sku)
    setPendingAction('purge')
    try {
      await api.purgeSku(item.sku)
      setBanner(`Permanently deleted “${item.product_name || item.sku}”.`)
      setPurgeConfirm(null)
      await Promise.all([load(), refreshActiveSkus()])
    } catch (e) {
      setLoadError(e?.message || 'Permanent delete failed')
    } finally {
      setPendingCode(null)
      setPendingAction(null)
    }
  }, [purgeConfirm, load, refreshActiveSkus])

  useEffect(() => {
    if (!banner) return undefined
    const t = setTimeout(() => setBanner(''), 6000)
    return () => clearTimeout(t)
  }, [banner])

  const isEmpty = items != null && items.length === 0
  const totalUnits = useMemo(
    () => (items || []).reduce((sum, i) => sum + (Number(i.totalQuantity) || 0), 0),
    [items],
  )

  const renderItemRows = () => items.map((it) => {
    const displayName = toTitleCase(it.product_name) || '—'
    const sizesLabel = (it.sizes || []).join(', ') || '—'
    const units = it.totalQuantity ?? 0
    return (
      <tr key={it.sku} className="rb-table-row">
        <td className="rb-td-name" title={displayName}>{displayName}</td>
        <td className="rb-td-sku">{it.sku}</td>
        <td className="rb-td-brand">{it.brand || '—'}</td>
        <td className="rb-td-sizes">{sizesLabel}</td>
        <td className="rb-td-units">{units}</td>
        <td className="rb-td-when">{formatWhen(it.deletedAt)}</td>
        <td className="rb-td-by">{it.deletedBy || '—'}</td>
        <td className="rb-td-time">
          <TimeLeftBadge daysLeft={it.daysLeft} />
        </td>
        <td className="rb-td-actions">
          <BinItemActions
            item={it}
            pendingCode={pendingCode}
            pendingAction={pendingAction}
            onRestore={handleRestore}
            onPurgeRequest={setPurgeConfirm}
            layout="table"
          />
        </td>
      </tr>
    )
  })

  const renderMobileCards = () => items.map((it) => {
    const displayName = toTitleCase(it.product_name) || '—'
    const sizesLabel = (it.sizes || []).join(', ') || '—'
    const units = it.totalQuantity ?? 0
    const deletedMeta = `Deleted: ${formatDeletedDate(it.deletedAt)}${it.deletedBy ? ` by ${it.deletedBy}` : ''}`
    return (
      <div key={it.sku} className="rb-mobile-card">
        <div className="rb-mobile-card__main">
          <div className="rb-mobile-card__left">
            <div className="rb-mobile-card__name">{displayName}</div>
            <div className="rb-mobile-card__meta">
              <span className="rb-mobile-card__sku">{it.sku}</span>
              <span className="rb-mobile-card__meta-sep"> · </span>
              <span>{it.brand || '—'}</span>
            </div>
            <div className="rb-mobile-card__sizes">Sizes: {sizesLabel}</div>
            <div className="rb-mobile-card__deleted">{deletedMeta}</div>
          </div>
          <div className="rb-mobile-card__right">
            <TimeLeftBadge daysLeft={it.daysLeft} />
            <div className="rb-mobile-card__units">{units} unit{units === 1 ? '' : 's'}</div>
          </div>
        </div>
        <BinItemActions
          item={it}
          pendingCode={pendingCode}
          pendingAction={pendingAction}
          onRestore={handleRestore}
          onPurgeRequest={setPurgeConfirm}
          layout="mobile"
        />
      </div>
    )
  })

  return (
    <div className="recycle-bin-page">
      <div className="rb-page-header">
        <Link to="/lookup" className="rb-back-link">← Back to Product Lookup</Link>
      </div>

      <div className="rb-hero">
        <div className="rb-hero__left">
          <IconDelete className="rb-hero__icon" size={20} strokeWidth={1.5} aria-hidden />
          <p className="rb-hero__text">
            Items stay here for <strong>30 days</strong>, are hidden from dashboards and reports, then auto-delete.
            Restore at any time to return them to active catalog.
          </p>
        </div>
        <div className="rb-hero__stats">
          <div className="rb-hero__stat">
            <span className="rb-hero__stat-num">{items == null ? '—' : items.length}</span>
            <span className="rb-hero__stat-label">in bin</span>
          </div>
          <div className="rb-hero__stat-divider" aria-hidden />
          <div className="rb-hero__stat">
            <span className="rb-hero__stat-num">{items == null ? '—' : totalUnits}</span>
            <span className="rb-hero__stat-label">units</span>
          </div>
        </div>
      </div>

      {banner && (
        <div className="rb-banner">
          {banner}
          <button type="button" className="rb-banner__dismiss" onClick={() => setBanner('')} aria-label="Dismiss">×</button>
        </div>
      )}

      {autoPurged.length > 0 && (
        <div className="rb-autopurge">
          Auto-deleted {autoPurged.length} expired SKU{autoPurged.length === 1 ? '' : 's'}: {autoPurged.slice(0, 6).join(', ')}{autoPurged.length > 6 ? '…' : ''}
          <button type="button" className="rb-banner__dismiss" onClick={() => setAutoPurged([])} aria-label="Dismiss">×</button>
        </div>
      )}

      {loadError && (
        <div className="rb-error">{loadError}</div>
      )}

      {items == null ? (
        <div className="rb-empty rb-empty--loading">Loading…</div>
      ) : isEmpty ? (
        <div className="rb-empty">
          <IconDelete className="rb-empty__icon" size={36} strokeWidth={1.25} aria-hidden />
          <div className="rb-empty__title">Recycle bin is empty</div>
          <div className="rb-empty__sub">
            Deleted products will appear here for 30 days before being permanently removed.
          </div>
          <Link to="/lookup" className="rb-empty__back">Back to Product Lookup</Link>
        </div>
      ) : (
        <>
          <div className="rb-table-wrap">
            <table className="rb-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Brand</th>
                  <th>Sizes</th>
                  <th className="rb-th-units">Units</th>
                  <th>Deleted</th>
                  <th className="rb-col-by">By</th>
                  <th>Time left</th>
                  <th className="rb-th-actions" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {renderItemRows()}
              </tbody>
            </table>
          </div>

          <div className="rb-mobile-list">
            {renderMobileCards()}
          </div>
        </>
      )}

      {purgeConfirm && (
        <div className="pl-delete-modal-backdrop" role="presentation" onClick={() => pendingCode !== purgeConfirm.sku && setPurgeConfirm(null)}>
          <div className="pl-delete-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="pl-delete-modal__eyebrow">Delete forever</div>
            <div className="pl-delete-modal__title">{toTitleCase(purgeConfirm.product_name) || purgeConfirm.sku}</div>
            <div className="pl-delete-modal__meta">
              <span>SKU</span><strong>{purgeConfirm.sku}</strong>
              {purgeConfirm.brand ? (<><span>Brand</span><strong>{purgeConfirm.brand}</strong></>) : null}
            </div>
            <p className="pl-delete-modal__body">
              Permanently delete <strong>{toTitleCase(purgeConfirm.product_name) || purgeConfirm.sku}</strong>?
              {' '}This cannot be undone.
            </p>
            <div className="pl-delete-modal__actions">
              <button
                type="button"
                className="pl-delete-modal__btn pl-delete-modal__btn--ghost"
                disabled={pendingCode === purgeConfirm.sku}
                onClick={() => setPurgeConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pl-delete-modal__btn pl-delete-modal__btn--danger"
                disabled={pendingCode === purgeConfirm.sku}
                onClick={handlePurge}
              >
                {pendingCode === purgeConfirm.sku ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
