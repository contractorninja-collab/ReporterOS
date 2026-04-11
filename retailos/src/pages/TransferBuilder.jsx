import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../store/useStore.js'
import { aggregateSkus } from '../utils/aggregateSkus.js'
import { IconSearch, IconClose } from '../utils/icons.js'

const DM = '"DM Sans", sans-serif'
const SHOPS = ['Ring Mall', 'Village']
const S = {
  surface: '#111117',
  surface2: '#17171f',
  border: 'rgba(255,255,255,0.055)',
  text: '#e4e4f0',
  text2: '#9090aa',
  muted: '#4a4a62',
  accent: '#ff3333',
  green: '#00e676',
  blue: '#38bdf8',
  purple: '#c084fc',
  orange: '#fbbf24',
}

const pillBase = {
  padding: '5px 14px',
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: DM,
  transition: 'all 0.14s',
  border: '1px solid',
}

function Pill({ label, active, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...pillBase,
        background: active ? `${color}18` : 'transparent',
        color: active ? color : S.muted,
        borderColor: active ? `${color}33` : S.border,
      }}
    >
      {label}
    </button>
  )
}

function SizeStepper({ size, stock, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: S.text2, fontFamily: DM, minWidth: 32 }}>
        {size}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value <= 0}
        style={{
          width: 22, height: 22, borderRadius: 6, border: `1px solid ${S.border}`,
          background: S.surface2, color: value > 0 ? S.text : S.muted,
          cursor: value > 0 ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }}
      >
        -
      </button>
      <span style={{ fontFamily: DM, fontSize: 13, fontWeight: 700, color: S.text, minWidth: 18, textAlign: 'center' }}>
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(stock, value + 1))}
        disabled={value >= stock}
        style={{
          width: 22, height: 22, borderRadius: 6, border: `1px solid ${S.border}`,
          background: S.surface2, color: value < stock ? S.text : S.muted,
          cursor: value < stock ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }}
      >
        +
      </button>
      <span style={{ fontSize: 9, color: S.muted, fontFamily: DM }}>/ {stock}</span>
    </div>
  )
}

export function TransferBuilder() {
  const navigate = useNavigate()
  const skus = useStore((s) => s.skus)
  const users = useStore((s) => s.users)
  const activeUser = useStore((s) => s.activeUser)
  const activeShifts = useStore((s) => s.activeShifts)
  const createTransferBatch = useStore((s) => s.createTransferBatch)

  const products = useMemo(() => aggregateSkus(skus), [skus])

  const rawSkusByProduct = useMemo(() => {
    const map = {}
    for (const row of skus) {
      if (!map[row.sku]) map[row.sku] = []
      map[row.sku].push(row)
    }
    return map
  }, [skus])

  const [transferType, setTransferType] = useState('store')
  const [fromShop, setFromShop] = useState(activeUser?.shop || 'Ring Mall')
  const [toShop, setToShop] = useState(() => {
    const other = SHOPS.find((s) => s !== (activeUser?.shop || 'Ring Mall'))
    return other || 'Village'
  })
  const [assignedTo, setAssignedTo] = useState('')
  const [note, setNote] = useState('')

  const [search, setSearch] = useState('')
  const [genderFilter, setGenderFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')

  // cart: Map<skuCode, { skuCode, productName, brand, category, sizeBreakdown: [{size, qty}] }>
  const [cart, setCart] = useState({})
  // staging: per-size picks before adding to cart
  const [staging, setStaging] = useState({})
  const [expandedSku, setExpandedSku] = useState(null)

  const [showAllUsers, setShowAllUsers] = useState(false)
  const isExec = activeUser?.role === 'executive'

  /** Ring Mall & Village managers only (never outlet staff). Used for "To Outlet" recipients. */
  const assignableUsers = useMemo(() => {
    const onShiftIds = new Set(activeShifts.map((s) => s.user_id))
    let pool
    if (transferType === 'outlet') {
      pool = users.filter(
        (u) =>
          u.role === 'manager' &&
          (u.shop === 'Ring Mall' || u.shop === 'Village') &&
          u.shop !== 'Outlet' &&
          u.role !== 'outlet',
      )
    } else {
      pool = users.filter((u) => u.shop === toShop)
    }
    if (showAllUsers && isExec) return pool
    return pool.filter((u) => onShiftIds.has(u.id))
  }, [users, transferType, toShop, activeShifts, showAllUsers, isExec])

  const filtered = useMemo(() => {
    let list = products.filter((p) => (p.quantity - p.sold_quantity) > 0)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (p) =>
          p.product_name?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q),
      )
    }
    if (genderFilter !== 'All') {
      const code = genderFilter === 'Men' ? 'M' : genderFilter === 'Women' ? 'F' : 'K'
      list = list.filter((p) => {
        const g = (p.gender || '').toUpperCase().trim().slice(0, 1)
        return g === code
      })
    }
    if (categoryFilter !== 'All') {
      list = list.filter((p) => (p.category || '').toLowerCase() === categoryFilter.toLowerCase())
    }
    return list
  }, [products, search, genderFilter, categoryFilter])

  function getSizeRows(skuCode) {
    return (rawSkusByProduct[skuCode] || []).filter((r) => (r.quantity - r.sold_quantity) > 0)
  }

  function handleToggleExpand(skuCode) {
    if (expandedSku === skuCode) {
      setExpandedSku(null)
      return
    }
    setExpandedSku(skuCode)
    if (!staging[skuCode]) {
      const rows = getSizeRows(skuCode)
      const init = {}
      for (const r of rows) init[r.size] = 0
      setStaging((prev) => ({ ...prev, [skuCode]: init }))
    }
  }

  function handleStagingChange(skuCode, size, qty) {
    setStaging((prev) => ({
      ...prev,
      [skuCode]: { ...prev[skuCode], [size]: qty },
    }))
  }

  function handleSelectAll(skuCode) {
    const rows = getSizeRows(skuCode)
    const all = {}
    for (const r of rows) all[r.size] = r.quantity - r.sold_quantity
    setStaging((prev) => ({ ...prev, [skuCode]: all }))
  }

  function handleClearSizes(skuCode) {
    const rows = getSizeRows(skuCode)
    const zeroed = {}
    for (const r of rows) zeroed[r.size] = 0
    setStaging((prev) => ({ ...prev, [skuCode]: zeroed }))
  }

  function handleAddToCart(product) {
    const picks = staging[product.sku] || {}
    const breakdown = Object.entries(picks)
      .filter(([, qty]) => qty > 0)
      .map(([size, qty]) => ({ size, qty }))
    if (breakdown.length === 0) return

    setCart((prev) => ({
      ...prev,
      [product.sku]: {
        skuCode: product.sku,
        productName: product.product_name,
        brand: product.brand || '',
        category: product.category || '',
        sizeBreakdown: breakdown,
        totalQty: breakdown.reduce((s, b) => s + b.qty, 0),
      },
    }))
    setExpandedSku(null)
    setStaging((prev) => {
      const next = { ...prev }
      delete next[product.sku]
      return next
    })
  }

  function handleRemoveFromCart(skuCode) {
    setCart((prev) => {
      const next = { ...prev }
      delete next[skuCode]
      return next
    })
  }

  const cartItems = Object.values(cart)
  const grandTotal = cartItems.reduce((s, i) => s + i.totalQty, 0)

  function handleSubmit() {
    if (cartItems.length === 0) return
    const items = cartItems.map((c) => ({
      skuCode: c.skuCode,
      productName: c.productName,
      brand: c.brand,
      category: c.category,
      sizeBreakdown: c.sizeBreakdown,
      totalQty: c.totalQty,
      quantity: c.totalQty,
      sizes: c.sizeBreakdown.map((b) => b.size).join(', '),
    }))
    const payload = { items, note: note.trim() || null }
    if (transferType === 'outlet') {
      payload.assignedToIds = assignableUsers.map((u) => u.id)
      payload.fromShop = activeUser?.shop || fromShop
    } else {
      payload.assignedTo = assignedTo || null
    }
    if (transferType === 'store') {
      payload.fromShop = fromShop
      payload.toShop = toShop
    }
    createTransferBatch(transferType, payload)
    navigate(transferType === 'outlet' ? '/outlet' : '/transfers')
  }

  const stagingTotal = (skuCode) => {
    const picks = staging[skuCode] || {}
    return Object.values(picks).reduce((s, v) => s + v, 0)
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: DM, fontSize: 22, letterSpacing: '2px', color: '#fff', margin: 0 }}>
          NEW TRANSFER
        </h2>
        <p style={{ fontSize: 12, color: S.muted, margin: '4px 0 0' }}>
          Select products, pick quantities per size, and assign the transfer.
        </p>
      </div>

      {/* ── Config bar ─────────────────────────────────────────────────── */}
      <div
        className="transfer-config"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          padding: '16px 18px',
          background: S.surface,
          border: `1px solid ${S.border}`,
          borderRadius: 14,
          marginBottom: 18,
          alignItems: 'flex-end',
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 5 }}>
            Type
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Pill
              label="Store to Store"
              active={transferType === 'store'}
              color={S.blue}
              onClick={() => {
                setTransferType('store')
                setAssignedTo('')
              }}
            />
            <Pill
              label="To Outlet"
              active={transferType === 'outlet'}
              color={S.orange}
              onClick={() => {
                setTransferType('outlet')
                setAssignedTo('')
              }}
            />
          </div>
        </div>

        {transferType === 'store' && (
          <>
            <div>
              <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 5 }}>
                From
              </label>
              <select
                value={fromShop}
                onChange={(e) => {
                  const newFrom = e.target.value
                  setFromShop(newFrom)
                  const newTo = SHOPS.find((s) => s !== newFrom) || SHOPS[0]
                  setToShop(newTo)
                  setAssignedTo('')
                }}
                style={{
                  background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8,
                  padding: '6px 10px', color: S.text, fontSize: 12, fontFamily: DM, outline: 'none',
                }}
              >
                {SHOPS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 16, color: S.muted, alignSelf: 'center', paddingBottom: 2 }}>→</div>
            <div>
              <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 5 }}>
                To
              </label>
              <select
                value={toShop}
                onChange={(e) => {
                  setToShop(e.target.value)
                  setAssignedTo('')
                }}
                style={{
                  background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8,
                  padding: '6px 10px', color: S.text, fontSize: 12, fontFamily: DM, outline: 'none',
                }}
              >
                {SHOPS.filter((s) => s !== fromShop).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </>
        )}

        <div>
          <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 5 }}>
            {transferType === 'outlet' ? 'Assign to (Ring Mall & Village managers)' : 'Assign to'}
          </label>
          {transferType === 'outlet' ? (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: S.text2,
                  lineHeight: 1.45,
                  maxWidth: 320,
                  padding: '8px 10px',
                  background: S.surface2,
                  border: `1px solid ${S.border}`,
                  borderRadius: 8,
                  fontFamily: DM,
                }}
              >
                {assignableUsers.length === 0 ? (
                  <span style={{ color: S.orange }}>
                    No Ring Mall or Village managers available{showAllUsers && isExec ? '' : ' on shift'}.
                  </span>
                ) : (
                  <>
                    Everyone listed gets a task and a notification. Outlet staff are never assigned.
                    <div style={{ marginTop: 6, color: S.text, fontWeight: 600 }}>
                      {assignableUsers.map((u) => u.name).join(', ')}
                    </div>
                  </>
                )}
              </div>
              {isExec && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 10, color: S.text2, cursor: 'pointer' }}>
                  <input type="checkbox" checked={showAllUsers} onChange={(e) => setShowAllUsers(e.target.checked)} style={{ accentColor: S.blue }} />
                  Show all Ring Mall &amp; Village managers (include off-shift)
                </label>
              )}
            </>
          ) : (
            <>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                style={{
                  background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8,
                  padding: '6px 10px', color: S.text, fontSize: 12, fontFamily: DM, outline: 'none', minWidth: 160,
                }}
              >
                <option value="">— none —</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              {assignableUsers.length === 0 && !showAllUsers && (
                <div style={{ fontSize: 10, color: S.orange, marginTop: 4 }}>
                  No managers on shift at {toShop}
                </div>
              )}
              {isExec && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 10, color: S.text2, cursor: 'pointer' }}>
                  <input type="checkbox" checked={showAllUsers} onChange={(e) => setShowAllUsers(e.target.checked)} style={{ accentColor: S.blue }} />
                  Show all users (override)
                </label>
              )}
            </>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 5 }}>
            Note (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Low stock replenishment"
            style={{
              width: '100%',
              background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8,
              padding: '6px 10px', color: S.text, fontSize: 12, fontFamily: DM, outline: 'none',
            }}
          />
        </div>
      </div>

      {/* ── Two-column layout ──────────────────────────────────────────── */}
      <div className="transfer-layout" style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        {/* Left: product search */}
        <div className="transfer-products" style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                background: S.surface2,
                border: `1px solid ${S.border}`,
                borderRadius: 8,
                padding: '6px 11px',
                flex: 1,
                minWidth: 180,
              }}
            >
              <span style={{ color: S.muted, fontSize: 13 }}>
                <IconSearch size={13} strokeWidth={1.5} />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, SKU, or barcode..."
                style={{
                  background: 'none', border: 'none', outline: 'none',
                  color: S.text, fontSize: 12, fontFamily: DM, width: '100%',
                }}
              />
            </div>
            {['All', 'Men', 'Women', 'Kids'].map((g) => (
              <Pill key={g} label={g} active={genderFilter === g} color={S.purple} onClick={() => setGenderFilter(g)} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {['All', 'Footwear', 'Apparel', 'Accessories'].map((c) => (
              <Pill key={c} label={c} active={categoryFilter === c} color={S.blue} onClick={() => setCategoryFilter(c)} />
            ))}
          </div>

          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: S.muted, fontSize: 13, background: S.surface, borderRadius: 14, border: `1px solid ${S.border}` }}>
              No products with available stock match your filters.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.slice(0, 30).map((p) => {
              const inCart = !!cart[p.sku]
              const isExpanded = expandedSku === p.sku
              const sizeRows = getSizeRows(p.sku)
              const remaining = p.quantity - p.sold_quantity
              return (
                <div
                  key={p.sku}
                  style={{
                    background: S.surface,
                    border: `1px solid ${inCart ? 'rgba(0,230,118,0.25)' : S.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    onClick={() => handleToggleExpand(p.sku)}
                    style={{
                      padding: '12px 16px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: S.text, marginBottom: 2 }}>
                        {p.product_name}
                        {inCart && <span style={{ marginLeft: 8, fontSize: 9, color: S.green, fontWeight: 700 }}>IN CART</span>}
                      </div>
                      <div style={{ fontSize: 11, color: S.muted, fontFamily: DM }}>
                        {p.sku} · {p.brand} · {p.category} · {remaining} in stock
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(Array.isArray(p.sizes) ? p.sizes : String(p.sizes || '').split(', ')).filter(Boolean).map((sz) => (
                        <span
                          key={sz}
                          style={{
                            fontSize: 9, padding: '2px 6px', borderRadius: 4,
                            background: 'rgba(255,255,255,0.05)', color: S.text2,
                            fontFamily: DM, fontWeight: 600,
                          }}
                        >
                          {sz}
                        </span>
                      ))}
                    </div>
                    <span style={{ fontSize: 13, color: S.muted, transform: isExpanded ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }}>▼</span>
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop: `1px solid ${S.border}`, padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px' }}>
                          Pick quantities per size
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => handleSelectAll(p.sku)}
                            style={{
                              padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                              border: `1px solid ${S.blue}33`, background: `${S.blue}12`,
                              color: S.blue, cursor: 'pointer', fontFamily: DM,
                            }}
                          >
                            Select all sizes
                          </button>
                          {stagingTotal(p.sku) > 0 && (
                            <button
                              type="button"
                              onClick={() => handleClearSizes(p.sku)}
                              style={{
                                padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                                border: `1px solid ${S.border}`, background: 'transparent',
                                color: S.muted, cursor: 'pointer', fontFamily: DM,
                              }}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                        {sizeRows.map((r) => (
                          <SizeStepper
                            key={r.size}
                            size={r.size}
                            stock={r.quantity - r.sold_quantity}
                            value={(staging[p.sku] || {})[r.size] || 0}
                            onChange={(v) => handleStagingChange(p.sku, r.size, v)}
                          />
                        ))}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: S.text2, fontFamily: DM }}>
                          Selected: <strong style={{ color: S.text }}>{stagingTotal(p.sku)}</strong> units
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddToCart(p)}
                          disabled={stagingTotal(p.sku) === 0}
                          style={{
                            padding: '7px 16px', borderRadius: 8, border: 'none',
                            background: stagingTotal(p.sku) > 0 ? S.accent : S.surface2,
                            color: stagingTotal(p.sku) > 0 ? '#fff' : S.muted,
                            fontSize: 12, fontWeight: 600, fontFamily: DM,
                            cursor: stagingTotal(p.sku) > 0 ? 'pointer' : 'not-allowed',
                          }}
                        >
                          + Add to transfer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {filtered.length > 30 && (
              <p style={{ fontSize: 11, color: S.muted, textAlign: 'center', marginTop: 4 }}>
                Showing first 30 of {filtered.length} products. Use search to narrow down.
              </p>
            )}
          </div>
        </div>

        {/* Right: transfer cart */}
        <div
          className="transfer-cart"
          style={{
            width: 320,
            flexShrink: 0,
            position: 'sticky',
            top: 80,
            background: S.surface,
            border: `1px solid ${S.border}`,
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${S.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: S.text, textTransform: 'uppercase', letterSpacing: '1.5px' }}>
              Transfer Cart
            </div>
            <div style={{ fontSize: 10, color: S.muted, marginTop: 2 }}>
              {cartItems.length} product{cartItems.length !== 1 ? 's' : ''} · {grandTotal} unit{grandTotal !== 1 ? 's' : ''}
            </div>
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {cartItems.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: S.muted, fontSize: 12 }}>
                No products added yet. Expand a product on the left and pick sizes.
              </div>
            )}

            {cartItems.map((item) => (
              <div key={item.skuCode} style={{ padding: '12px 16px', borderBottom: `1px solid ${S.border}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: S.text, marginBottom: 2 }}>
                      {item.productName}
                    </div>
                    <div style={{ fontSize: 10, color: S.muted, fontFamily: DM }}>{item.skuCode}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveFromCart(item.skuCode)}
                    style={{
                      background: 'rgba(255,51,51,0.08)', border: '1px solid rgba(255,51,51,0.18)',
                      borderRadius: 6, padding: '2px 6px', fontSize: 10, color: S.accent,
                      cursor: 'pointer', fontFamily: DM, fontWeight: 600, flexShrink: 0,
                    }}
                  >
                    <IconClose size={14} strokeWidth={1.5} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                  {item.sizeBreakdown.map((b) => (
                    <span
                      key={b.size}
                      style={{
                        fontSize: 10, padding: '2px 7px', borderRadius: 4,
                        background: 'rgba(255,255,255,0.06)', color: S.text,
                        fontFamily: DM, fontWeight: 600,
                      }}
                    >
                      {b.size} <span style={{ color: S.text2 }}>×{b.qty}</span>
                    </span>
                  ))}
                  <span style={{ fontSize: 10, fontWeight: 700, color: S.green, padding: '2px 4px' }}>
                    = {item.totalQty}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: '14px 16px', borderTop: `1px solid ${S.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: S.text }}>Grand Total</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: S.text, fontFamily: DM }}>{grandTotal}</span>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                cartItems.length === 0 ||
                (transferType === 'outlet' && assignableUsers.length === 0)
              }
              style={{
                width: '100%',
                padding: '10px 0',
                borderRadius: 10,
                border: 'none',
                background: cartItems.length > 0 && !(transferType === 'outlet' && assignableUsers.length === 0) ? S.accent : S.surface2,
                color: cartItems.length > 0 && !(transferType === 'outlet' && assignableUsers.length === 0) ? '#fff' : S.muted,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: DM,
                cursor: cartItems.length > 0 && !(transferType === 'outlet' && assignableUsers.length === 0) ? 'pointer' : 'not-allowed',
                letterSpacing: '0.5px',
              }}
            >
              Create Transfer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
