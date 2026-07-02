import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSellThrough, getDaysInStore, STATUS_COLORS, getEffectiveLifecycleImportDate } from '../utils/lifecycle'
import useStore from '../store/useStore'
import { mergeShipmentMeta } from '../utils/shipmentDisplay.js'
import { fetchSalesBySku, fetchSalesSummaryForSku } from '../api/client.js'
import { isExecutive } from '../utils/roles.js'
import { DISCOUNTS, salePriceOf } from '../utils/saleList.js'
import {
  IconFootwear,
  IconApparel,
  IconAccessories,
  IconPackage,
  IconHot,
  IconClose,
} from '../utils/icons.js'
import { genderShortLabel } from '../utils/gender.js'

const ACTION_BTN = {
  padding: '8px 14px',
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  fontFamily: '"DM Sans"',
}

const ASSIGN_TYPES = {
  markdown: { label: 'Apply Markdown', type: 'markdown' },
  reorder: { label: 'Place Reorder', type: 'reorder' },
  display_move: { label: 'Move to Display', type: 'display_move' },
  sale: { label: 'Assign Sale', type: 'sale' },
  store_transfer: { label: 'Transfer to Shop', type: 'store_transfer' },
}

const SHOPS = ['Ring Mall', 'Village']

function suggestMarkdownTier(days) {
  if (days <= 120) return 20
  if (days <= 150) return 30
  if (days <= 170) return 50
  return 70
}

export default function ProductDetailModal({ sku, status, statusData, onClose, saleListAssign = false }) {
  const photoUrl = useStore((s) => s.photoMap[sku.sku]) || null
  const rawSkus = useStore((s) => s.skus)
  const users = useStore((s) => s.users)
  const activeUser = useStore((s) => s.activeUser)
  const activeSeason = useStore((s) => s.activeSeason)
  const shipmentMeta = useStore((s) => s.shipmentMeta)
  const markdownLists = useStore((s) => s.markdownLists)
  const showSalesMetrics = isExecutive(activeUser)
  const addAssignment = useStore((s) => s.addAssignment)
  const addItemToMarkdownList = useStore((s) => s.addItemToMarkdownList)
  const addItemToTodayTransfer = useStore((s) => s.addItemToTodayTransfer)
  const addItemToStoreTransfer = useStore((s) => s.addItemToStoreTransfer)
  const activeShifts = useStore((s) => s.activeShifts)
  const displaySku = mergeShipmentMeta(sku, shipmentMeta, activeSeason)

  const canManage = activeUser?.role === 'executive' || activeUser?.role === 'manager'

  const [assignPanel, setAssignPanel] = useState(null)
  const [assignTo, setAssignTo] = useState('')
  const [assignNote, setAssignNote] = useState('')
  const [assignDone, setAssignDone] = useState(null)
  const [markdownTier, setMarkdownTier] = useState(null)
  const [customMarkdown, setCustomMarkdown] = useState('')
  const [transferShop, setTransferShop] = useState('')
  const [selectedSaleListId, setSelectedSaleListId] = useState('')
  const [salePct, setSalePct] = useState(30)
  const [summaryBySku, setSummaryBySku] = useState(() => ({}))

  const pendingSaleLists = useMemo(
    () => markdownLists.filter((l) => l.kind !== 'removal' && l.status === 'pending'),
    [markdownLists],
  )

  useEffect(() => {
    if (!sku?.sku) return
    let cancelled = false
    const code = sku.sku
    const fallbackQty = Number(sku.sold_quantity) || 0
    const since = '1970-01-01'
    const until = new Date().toISOString().slice(0, 10)
    Promise.all([fetchSalesBySku(since, until), fetchSalesSummaryForSku(code)])
      .then(([bySku, retSummary]) => {
        if (cancelled) return
        const row = Array.isArray(bySku) ? bySku.find((r) => r.sku === code) : null
        setSummaryBySku((prev) => ({
          ...prev,
          [code]: {
            netQtySold: row?.sold_qty ?? 0,
            netRevenue: row?.revenue ?? 0,
            returnsCount: retSummary?.returnsCount ?? 0,
          },
        }))
      })
      .catch(() => {
        if (cancelled) return
        setSummaryBySku((prev) => ({
          ...prev,
          [code]: { netRevenue: 0, netQtySold: fallbackQty, returnsCount: 0 },
        }))
      })
    return () => {
      cancelled = true
    }
  }, [sku.sku, sku.sold_quantity])

  const summaryData = summaryBySku[sku.sku]
  const netSoldQty = summaryData
    ? summaryData.netQtySold
    : (Number(sku.sold_quantity) || 0)
  const returnsCount = summaryData?.returnsCount ?? 0

  const openAssignPanel = (actionType) => {
    setAssignPanel(actionType)
    setAssignTo(users[0]?.id || '')
    setAssignNote('')
    setAssignDone(null)
    setMarkdownTier(null)
    setCustomMarkdown('')
    const otherShops = SHOPS.filter((s) => s !== (activeUser?.shop || ''))
    setTransferShop(otherShops[0] || SHOPS[0])
    if (actionType === 'sale_list') {
      setSelectedSaleListId(pendingSaleLists[0]?.id || '')
      setSalePct(30)
    }
  }

  const handleSaleListAssign = () => {
    if (!selectedSaleListId || !salePct) return
    if (sku.sale_active && sku.sale_list_id && sku.sale_list_id !== selectedSaleListId) return

    const item = {
      skuCode: sku.sku,
      productName: sku.product_name || '',
      brand: sku.brand || '',
      category: sku.category || '',
      gender: sku.gender || '',
      season: sku.season || '',
      priceTag: Number(sku.price_tag) || 0,
      salePct,
      salePrice: salePriceOf(sku.price_tag, salePct),
      sizes: Array.isArray(sku.sizes) ? sku.sizes.join(', ') : String(sku.sizes || ''),
    }
    const ok = addItemToMarkdownList(selectedSaleListId, item)
    if (!ok) return
    const listTitle = pendingSaleLists.find((l) => l.id === selectedSaleListId)?.title || 'sale list'
    setAssignPanel(null)
    setAssignDone(`Added to ${listTitle} at -${salePct}%`)
    setTimeout(() => setAssignDone(null), 1600)
  }

  const handleAssign = () => {
    if (!assignTo || !assignPanel) return
    if (assignPanel === 'markdown' && !markdownTier) return
    const target = users.find((u) => u.id === assignTo)
    let note = assignNote
    if (assignPanel === 'markdown') {
      const pct = markdownTier === 'custom' ? customMarkdown : markdownTier
      note = `Markdown: -${pct}%${assignNote ? ' — ' + assignNote : ''}`
    }
    addAssignment({
      type: ASSIGN_TYPES[assignPanel]?.type || assignPanel,
      skuCode: sku.sku,
      productName: sku.product_name,
      assignedTo: assignTo,
      assignedBy: activeUser?.id || '',
      shop: target?.shop || '',
      status: 'pending',
      note,
    })
    setAssignDone(ASSIGN_TYPES[assignPanel]?.label || assignPanel)
    setTimeout(() => { setAssignPanel(null); setAssignDone(null) }, 1400)
  }

  const handleStoreTransfer = () => {
    if (!transferShop) return
    const remaining = Math.max(0, sku.quantity - netSoldQty)
    addItemToStoreTransfer(
      { skuCode: sku.sku, productName: sku.product_name, quantity: remaining, sizes: (sku.sizes || []).join(', ') },
      activeUser?.shop || 'Ring Mall',
      transferShop,
      activeUser?.id || '',
    )
    const targetMgr = users.find((u) => u.role === 'manager' && u.shop === transferShop)
    if (targetMgr) {
      addAssignment({
        type: 'store_transfer',
        skuCode: sku.sku,
        productName: sku.product_name,
        assignedTo: targetMgr.id,
        assignedBy: activeUser?.id || '',
        shop: transferShop,
        status: 'pending',
        note: `Incoming transfer from ${activeUser?.shop || 'Ring Mall'}`,
      })
    }
    setAssignDone(`Transferred to ${transferShop}`)
    setTimeout(() => setAssignDone(null), 1800)
  }

  const handleOutletMove = () => {
    addItemToTodayTransfer(
      {
        skuCode: sku.sku,
        productName: sku.product_name,
        quantity: Math.max(0, sku.quantity - netSoldQty),
        sizes: (sku.sizes || []).join(', '),
      },
      activeUser?.id || '',
    )
    const onShiftIds = new Set((activeShifts || []).map((s) => s.user_id))
    const outletManagers = users.filter(
      (u) =>
        u.role === 'manager' &&
        (u.shop === 'Ring Mall' || u.shop === 'Village') &&
        onShiftIds.has(u.id),
    )
    for (const m of outletManagers) {
      addAssignment({
        type: 'outlet_move',
        skuCode: sku.sku,
        productName: sku.product_name,
        assignedTo: m.id,
        assignedBy: activeUser?.id || '',
        shop: 'Outlet',
        status: 'pending',
        note: 'Moved to outlet transfer batch',
      })
    }
    setAssignDone('Moved to Outlet')
    setTimeout(() => setAssignDone(null), 1800)
  }

  const sizeBreakdown = useMemo(() => {
    const rows = rawSkus.filter((r) => r.sku === sku.sku)
    if (!rows.length) return []
    const map = new Map()
    for (const r of rows) {
      const key = (r.size || '—').toString().trim()
      const prev = map.get(key)
      const qty = Number(r.quantity) || 0
      const sold = Number(r.sold_quantity) || 0
      if (prev) {
        prev.qty += qty
        prev.sold += sold
        prev.remaining = Math.max(0, prev.qty - prev.sold)
      } else {
        map.set(key, { size: key, qty, sold, remaining: Math.max(0, qty - sold) })
      }
    }
    return [...map.values()]
  }, [rawSkus, sku.sku])
  const pct = getSellThrough(netSoldQty, sku.quantity)
  const lifecycleArrivalDate = getEffectiveLifecycleImportDate(displaySku)
  const days = getDaysInStore(lifecycleArrivalDate)
  const remaining = Math.max(0, (Number(sku.quantity) || 0) - (Number(netSoldQty) || 0))
  const totalStock = Number(displaySku.total_stock_units ?? remaining) || 0
  const activeSeasonLabel = String(displaySku.active_season || displaySku.current_season || sku.season || '').trim()
  const carryoverSeasonLabel = String(displaySku.first_season || '').trim()
  const activeSeasonStock = Number(displaySku.active_season_stock_units) || 0
  const carryoverStock = Number(displaySku.carryover_stock_units) || 0
  const showStockSplit = Boolean(activeSeasonLabel && (activeSeasonStock > 0 || carryoverStock > 0))
  const stockColor =
    totalStock <= 3 && totalStock > 0 ? '#ff8800' : totalStock === 0 ? '#ff3333' : '#00e676'
  const isFire = pct >= 60

  const STATUS_ORDER = ['New Arrival', 'Active', 'Aging', 'Risk', 'Clearance', 'Outlet']

  const categoryGrad = {
    Footwear: 'linear-gradient(135deg,#0a1a0a,#1a3a1a)',
    Apparel: 'linear-gradient(135deg,#1a0a2e,#2d1357)',
    Accessories: 'linear-gradient(135deg,#0a1a1a,#0d3333)',
  }
  const categoryIcon = {
    Footwear: <IconFootwear size={56} strokeWidth={1} />,
    Apparel: <IconApparel size={56} strokeWidth={1} />,
    Accessories: <IconAccessories size={56} strokeWidth={1} />,
  }

  const thumbBg = categoryGrad[sku.category] || 'linear-gradient(135deg,var(--ro-surface),var(--ro-surface-elevated))'
  const icon = categoryIcon[sku.category] || <IconPackage size={56} strokeWidth={1} />

  const activeIdx = STATUS_ORDER.indexOf(status)
  const accentColor = statusData.color ?? STATUS_COLORS[status] ?? 'var(--ro-text-dim)'
  const ticketPrice = Number(sku.price_tag) || 0
  const avgSoldPrice = Number(sku.avg_price_sold) || 0

  const showMarkdown = status === 'Clearance' || status === 'Outlet'
  const showReorder = status === 'Active' && pct >= 60
  const showDisplay = status === 'Aging' || status === 'Risk'
  const onOtherSaleList = Boolean(sku.sale_active && sku.sale_list_id && sku.sale_list_id !== selectedSaleListId)
  const priceTag = Number(sku.price_tag) || 0

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        zIndex: 999,
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="fade-up product-detail-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '480px',
          maxWidth: '92vw',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--ro-surface)',
          border: '1px solid var(--ro-border-hover)',
          borderRadius: '18px',
        }}
      >
        {/* 1. Hero */}
        <div
          style={{
            aspectRatio: '1',
            position: 'relative',
            overflow: 'hidden',
            background: photoUrl ? '#000' : thumbBg,
          }}
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={sku.product_name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
                display: 'block',
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '56px',
              }}
            >
              {icon}
            </div>
          )}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg,transparent 40%,rgba(0,0,0,0.5) 100%)',
              pointerEvents: 'none',
            }}
          />

          <div
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              zIndex: 2,
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              padding: '3px 8px',
              borderRadius: 4,
              background: statusData.colorBg,
              color: statusData.color,
            }}
          >
            {statusData.icon} {statusData.label}
          </div>

          {isFire && (
            <div style={{ position: 'absolute', top: 10, right: 48, zIndex: 2, fontSize: 18 }}>
              <IconHot size={18} strokeWidth={1.5} />
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 3,
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid var(--ro-border-hover)',
              background: 'rgba(0,0,0,0.45)',
              color: 'var(--ro-text)',
              fontSize: 16,
              lineHeight: 1,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconClose size={16} strokeWidth={1.5} />
          </button>

          <div
            style={{
              position: 'absolute',
              bottom: 10,
              right: 12,
              zIndex: 2,
              fontFamily: '"DM Sans"',
              fontSize: 11,
              color: 'color-mix(in srgb, var(--ro-text) 85%, transparent)',
            }}
          >
            Day {days} in store
          </div>
        </div>

        {/* 2. Body */}
        <div style={{ padding: '20px 22px 22px' }}>
          <div
            style={{
              fontFamily: '"DM Sans"',
              fontSize: 22,
              letterSpacing: '0.5px',
              color: 'var(--ro-heading)',
              lineHeight: 1.15,
              marginBottom: 6,
            }}
          >
            {sku.product_name}
          </div>
          <div
            style={{
              fontFamily: '"DM Sans"',
              fontSize: 11,
              color: 'var(--ro-text-muted)',
              marginBottom: 18,
            }}
          >
            {sku.sku}
          </div>

          <div
            className="product-detail-kpi-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: showSalesMetrics ? 'repeat(3, 1fr)' : '1fr',
              gap: 8,
              marginBottom: 18,
            }}
          >
            {(showSalesMetrics
              ? [
                  { label: 'Price', value: `€${ticketPrice.toFixed(2)}`, color: 'var(--ro-heading)' },
                  { label: 'Stock', value: String(totalStock), color: stockColor },
                  { label: 'Sold', value: `${Math.round(pct)}%`, color: statusData.color },
                ]
              : [{ label: 'Available', value: String(totalStock), color: stockColor }]
            ).map((c) => (
              <div
                key={c.label}
                style={{
                  background: 'var(--ro-surface-elevated)',
                  border: '1px solid var(--ro-border)',
                  borderRadius: 10,
                  padding: 12,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ro-text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                  {c.label}
                </div>
                <div style={{ fontFamily: '"DM Sans"', fontSize: c.label === 'Price' ? 22 : 26, lineHeight: 1, color: c.color, letterSpacing: '0.5px' }}>
                  {c.value}
                </div>
                {c.label === 'Sold' && showSalesMetrics && returnsCount > 0 ? (
                  <div
                    style={{
                      marginTop: 6,
                      display: 'inline-block',
                      background: 'rgba(255,136,0,0.1)',
                      border: '1px solid rgba(255,136,0,0.2)',
                      color: '#ff8800',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 20,
                    }}
                  >
                    ↩ {returnsCount} return{returnsCount > 1 ? 's' : ''}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {showStockSplit ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 8,
                marginTop: '-8px',
                marginBottom: 18,
              }}
            >
              {[
                { label: carryoverSeasonLabel ? `Carried from ${carryoverSeasonLabel}` : 'Carried stock', value: carryoverStock, tone: 'var(--ro-text-dim)' },
                { label: `${activeSeasonLabel} stock`, value: activeSeasonStock, tone: '#3b82f6' },
              ].map((row) => (
                <div
                  key={row.label}
                  style={{
                    background: 'var(--ro-surface-elevated)',
                    border: '1px solid var(--ro-border)',
                    borderRadius: 10,
                    padding: '9px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {row.label}
                  </span>
                  <span style={{ fontFamily: '"DM Sans"', fontSize: 16, fontWeight: 700, color: row.tone }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {showSalesMetrics ? (
            <div
              className="product-detail-avg-row"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                background: 'var(--ro-surface-elevated)',
                border: '1px solid var(--ro-border)',
                borderRadius: 10,
                padding: '10px 14px',
                marginTop: '-8px',
                marginBottom: 18,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--ro-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                }}
              >
                AVG sold price
              </span>
              <span
                style={{
                  fontFamily: '"DM Sans"',
                  fontSize: 16,
                  fontWeight: 700,
                  color: avgSoldPrice > 0 ? '#fbbf24' : 'var(--ro-text-dim)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {avgSoldPrice.toFixed(2)}
              </span>
            </div>
          ) : null}

          {showSalesMetrics ? (
            <div style={{ marginBottom: 18 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ro-text-dim)' }}>Sell-through progress</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: accentColor, fontFamily: '"DM Sans"' }}>
                  {netSoldQty} of {sku.quantity} units
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--ro-fill-muted)', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    borderRadius: 3,
                    background: accentColor,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          ) : null}

          <div
            style={{
              background: 'var(--ro-surface-elevated)',
              border: '1px solid var(--ro-border)',
              borderRadius: 10,
              overflow: 'hidden',
              marginBottom: 18,
            }}
          >
            {[
              ['Brand', sku.brand ?? '—'],
              ['Category', sku.category ?? '—'],
              ['Gender', genderShortLabel(sku.gender)],
              ['Arrival Date', lifecycleArrivalDate ? new Date(lifecycleArrivalDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'],
              ['Days in store', String(days)],
              ['Season', sku.season ?? '—'],
            ].map(([key, val], idx, arr) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '9px 14px',
                  borderBottom: idx < arr.length - 1 ? '1px solid var(--ro-border)' : 'none',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--ro-text-muted)', flexShrink: 0 }}>{key}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ro-text)', textAlign: 'right' }}>{val}</span>
              </div>
            ))}
          </div>

          {sizeBreakdown.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                Size stock
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {sizeBreakdown.map((s) => {
                  const soldOut = s.remaining === 0
                  const low = !soldOut && s.remaining <= 2
                  return (
                    <div
                      key={s.size}
                      style={{
                        minWidth: 52,
                        padding: '8px 6px',
                        borderRadius: 8,
                        textAlign: 'center',
                        background: soldOut ? 'var(--ro-fill-faint)' : 'var(--ro-surface-elevated)',
                        border: `1px solid ${soldOut ? 'var(--ro-border)' : low ? 'rgba(255,136,0,0.25)' : 'var(--ro-border)'}`,
                        opacity: soldOut ? 0.4 : 1,
                      }}
                    >
                      <div style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: soldOut ? 'var(--ro-text-muted)' : 'var(--ro-text)',
                        textDecoration: soldOut ? 'line-through' : 'none',
                        marginBottom: 3,
                      }}>
                        {s.size}
                      </div>
                      <div style={{
                        fontSize: 10,
                        fontFamily: '"DM Sans"',
                        fontWeight: 600,
                        color: soldOut ? 'var(--ro-text-muted)' : low ? '#ff8800' : '#00e676',
                      }}>
                        {soldOut ? '—' : s.remaining}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              {STATUS_ORDER.map((st, i) => {
                const isActive = i === activeIdx
                return (
                  <div
                    key={st}
                    style={{
                      flex: 1,
                      height: 5,
                      borderRadius: 3,
                      background: isActive ? accentColor : 'var(--ro-fill-muted)',
                      boxShadow: isActive ? `0 0 10px ${accentColor}66` : 'none',
                      transition: 'background 0.2s',
                    }}
                  />
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 8, color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>New</span>
              <span style={{ fontSize: 8, color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Outlet</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {showMarkdown && (
              <button type="button" onClick={() => openAssignPanel('markdown')} style={{ ...ACTION_BTN, background: '#ff3333', color: '#fff' }}>
                Apply Markdown
              </button>
            )}
            {showReorder && (
              <button type="button" onClick={() => openAssignPanel('reorder')} style={{ ...ACTION_BTN, background: '#00e676', color: '#09090e' }}>
                Place Reorder
              </button>
            )}
            {showDisplay && (
              <button type="button" onClick={() => openAssignPanel('display_move')} style={{ ...ACTION_BTN, background: '#ff8800', color: '#09090e' }}>
                Move to Display
              </button>
            )}
            {saleListAssign && canManage && (
              <button type="button" onClick={() => openAssignPanel('sale_list')} style={{ ...ACTION_BTN, background: '#c084fc', color: '#09090e' }}>
                Assign Sale
              </button>
            )}
            {saleListAssign && !canManage && (status === 'Aging' || status === 'Risk') && (
              <button type="button" onClick={() => openAssignPanel('sale')} style={{ ...ACTION_BTN, background: '#c084fc', color: '#09090e' }}>
                Assign Sale
              </button>
            )}
            {!saleListAssign && (status === 'Aging' || status === 'Risk') && (
              <button type="button" onClick={() => openAssignPanel('sale')} style={{ ...ACTION_BTN, background: '#c084fc', color: '#09090e' }}>
                Assign Sale
              </button>
            )}
            {(status === 'Aging' || status === 'Risk' || status === 'Clearance') && (
              <button type="button" onClick={() => openAssignPanel('store_transfer')} style={{ ...ACTION_BTN, background: '#38bdf8', color: '#09090e' }}>
                Transfer to Shop
              </button>
            )}
            {(status === 'Clearance' || status === 'Outlet') && (
              <button type="button" onClick={handleOutletMove} style={{ ...ACTION_BTN, background: '#fbbf24', color: '#09090e' }}>
                Move to Outlet
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{ ...ACTION_BTN, background: 'transparent', color: 'var(--ro-text-dim)', border: '1px solid var(--ro-border)' }}
            >
              Close
            </button>
          </div>

          {assignDone && !assignPanel && (
            <div style={{ marginTop: 10, padding: '8px 14px', borderRadius: 10, background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.2)', fontSize: 12, color: '#00e676', fontWeight: 600 }}>
              {assignDone}
            </div>
          )}

          {assignPanel && assignPanel === 'store_transfer' && !assignDone && (
            <div style={{ marginTop: 10, background: 'var(--ro-surface-elevated)', border: '1px solid var(--ro-border-hover)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ro-text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
                Transfer to Shop
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {SHOPS.filter((s) => s !== (activeUser?.shop || '')).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTransferShop(s)}
                    style={{
                      ...ACTION_BTN,
                      padding: '6px 14px',
                      background: transferShop === s ? 'rgba(56,189,248,0.15)' : 'var(--ro-fill-soft)',
                      color: transferShop === s ? '#38bdf8' : 'var(--ro-text-dim)',
                      border: `1px solid ${transferShop === s ? 'rgba(56,189,248,0.3)' : 'var(--ro-border)'}`,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={handleStoreTransfer} style={{ ...ACTION_BTN, background: '#38bdf8', color: '#09090e', padding: '7px 16px' }}>
                  Transfer
                </button>
                <button type="button" onClick={() => setAssignPanel(null)} style={{ ...ACTION_BTN, background: 'none', color: 'var(--ro-text-muted)', border: '1px solid var(--ro-border)', padding: '7px 16px' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {assignPanel && assignPanel === 'sale_list' && !assignDone && (
            <div style={{ marginTop: 10, background: 'var(--ro-surface-elevated)', border: '1px solid var(--ro-border-hover)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ro-text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
                Assign to sale list
              </div>
              {pendingSaleLists.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ro-text-dim)', marginBottom: 10 }}>
                  No open sale lists yet.{' '}
                  <Link to="/markdown" style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 600 }}>Create one first</Link>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--ro-text-muted)', marginBottom: 6 }}>Select sale list:</div>
                    <select
                      value={selectedSaleListId}
                      onChange={(e) => setSelectedSaleListId(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'var(--ro-surface)',
                        border: '1px solid var(--ro-border-hover)',
                        borderRadius: 8,
                        padding: '7px 10px',
                        color: 'var(--ro-text)',
                        fontSize: 12,
                        fontFamily: '"DM Sans"',
                        outline: 'none',
                      }}
                    >
                      {pendingSaleLists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title || 'Sale list'} ({(l.items || []).length} products)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--ro-text-muted)', marginBottom: 6 }}>Select discount:</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {DISCOUNTS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSalePct(d)}
                          style={{
                            ...ACTION_BTN,
                            padding: '5px 12px',
                            fontSize: 11,
                            background: salePct === d ? 'rgba(192,132,252,0.15)' : 'var(--ro-fill-soft)',
                            color: salePct === d ? '#c084fc' : 'var(--ro-text-dim)',
                            border: `1px solid ${salePct === d ? 'rgba(192,132,252,0.3)' : 'var(--ro-border)'}`,
                          }}
                        >
                          -{d}%
                        </button>
                      ))}
                    </div>
                    {priceTag > 0 && salePct > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--ro-text-dim)', marginTop: 8, fontFamily: '"DM Sans"' }}>
                        {priceTag.toFixed(2)}€ → <span style={{ color: '#00e676', fontWeight: 700 }}>{salePriceOf(priceTag, salePct).toFixed(2)}€</span>
                      </div>
                    )}
                  </div>
                  {onOtherSaleList && (
                    <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)' }}>
                      This product is already on another active sale list. End that sale first or choose the same list to update the discount.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={handleSaleListAssign}
                      disabled={!selectedSaleListId || !salePct || onOtherSaleList}
                      style={{ ...ACTION_BTN, background: '#c084fc', color: '#09090e', padding: '7px 16px', opacity: !selectedSaleListId || !salePct || onOtherSaleList ? 0.4 : 1 }}
                    >
                      Add to list
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignPanel(null)}
                      style={{ ...ACTION_BTN, background: 'none', color: 'var(--ro-text-muted)', border: '1px solid var(--ro-border)', padding: '7px 16px' }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {assignPanel && assignPanel !== 'store_transfer' && assignPanel !== 'sale_list' && (
            <div style={{ marginTop: 10, background: 'var(--ro-surface-elevated)', border: '1px solid var(--ro-border-hover)', borderRadius: 12, padding: 14 }}>
              {assignDone ? (
                <div style={{ fontSize: 13, color: '#00e676', fontWeight: 600 }}>Assigned: {assignDone}</div>
              ) : (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ro-text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
                    Assign &quot;{ASSIGN_TYPES[assignPanel]?.label || assignPanel}&quot;
                  </div>

                  {assignPanel === 'markdown' && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: 'var(--ro-text-muted)', marginBottom: 6 }}>Select discount tier:</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {[20, 30, 50, 70].map((pct) => {
                          const suggested = suggestMarkdownTier(days)
                          const isSelected = markdownTier === pct
                          const isSuggested = pct === suggested
                          return (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => { setMarkdownTier(pct); setCustomMarkdown('') }}
                              style={{
                                ...ACTION_BTN,
                                padding: '5px 12px',
                                fontSize: 11,
                                background: isSelected ? 'rgba(255,51,51,0.15)' : 'var(--ro-fill-soft)',
                                color: isSelected ? '#ff3333' : 'var(--ro-text-dim)',
                                border: `1px solid ${isSelected ? 'rgba(255,51,51,0.3)' : isSuggested ? 'rgba(255,51,51,0.15)' : 'var(--ro-border)'}`,
                                position: 'relative',
                              }}
                            >
                              -{pct}%
                              {isSuggested && (
                                <span style={{ position: 'absolute', top: -7, right: -4, fontSize: 7, background: '#ff3333', color: '#fff', padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>
                                  REC
                                </span>
                              )}
                            </button>
                          )
                        })}
                        <button
                          type="button"
                          onClick={() => setMarkdownTier('custom')}
                          style={{
                            ...ACTION_BTN,
                            padding: '5px 12px',
                            fontSize: 11,
                            background: markdownTier === 'custom' ? 'rgba(255,51,51,0.15)' : 'var(--ro-fill-soft)',
                            color: markdownTier === 'custom' ? '#ff3333' : 'var(--ro-text-dim)',
                            border: `1px solid ${markdownTier === 'custom' ? 'rgba(255,51,51,0.3)' : 'var(--ro-border)'}`,
                          }}
                        >
                          Custom
                        </button>
                      </div>
                      {markdownTier === 'custom' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                          <span style={{ fontSize: 12, color: 'var(--ro-text-dim)' }}>-</span>
                          <input
                            type="number"
                            min="1"
                            max="99"
                            value={customMarkdown}
                            onChange={(e) => setCustomMarkdown(e.target.value)}
                            placeholder="e.g. 15"
                            style={{
                              width: 64,
                              background: 'var(--ro-surface)',
                              border: '1px solid var(--ro-border-hover)',
                              borderRadius: 8,
                              padding: '5px 8px',
                              color: 'var(--ro-text)',
                              fontSize: 12,
                              fontFamily: '"DM Sans"',
                              outline: 'none',
                            }}
                          />
                          <span style={{ fontSize: 12, color: 'var(--ro-text-dim)' }}>%</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    <select
                      value={assignTo}
                      onChange={(e) => setAssignTo(e.target.value)}
                      style={{
                        flex: '1 1 160px',
                        background: 'var(--ro-surface)',
                        border: '1px solid var(--ro-border-hover)',
                        borderRadius: 8,
                        padding: '7px 10px',
                        color: 'var(--ro-text)',
                        fontSize: 12,
                        fontFamily: '"DM Sans"',
                        outline: 'none',
                      }}
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}{u.shop ? ` (${u.shop})` : ''}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Note (optional)"
                      value={assignNote}
                      onChange={(e) => setAssignNote(e.target.value)}
                      style={{
                        flex: '1 1 120px',
                        background: 'var(--ro-surface)',
                        border: '1px solid var(--ro-border-hover)',
                        borderRadius: 8,
                        padding: '7px 10px',
                        color: 'var(--ro-text)',
                        fontSize: 12,
                        fontFamily: '"DM Sans"',
                        outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={handleAssign}
                      disabled={assignPanel === 'markdown' && !markdownTier}
                      style={{ ...ACTION_BTN, background: '#ff3333', color: '#fff', padding: '7px 16px', opacity: assignPanel === 'markdown' && !markdownTier ? 0.4 : 1 }}
                    >
                      Assign
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignPanel(null)}
                      style={{ ...ACTION_BTN, background: 'none', color: 'var(--ro-text-muted)', border: '1px solid var(--ro-border)', padding: '7px 16px' }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
