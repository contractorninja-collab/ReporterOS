import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../store/useStore.js'
import { aggregateSkus } from '../utils/aggregateSkus.js'
import { normalizeGenderCodeForFilter } from '../utils/gender.js'
import { toTitleCase } from '../utils/textFormat.js'
import { IconSearch, IconClose, IconWarning, IconCart, IconChevronDown } from '../utils/icons.js'

const DM = '"DM Sans", sans-serif'
const SHOPS = ['Ring Mall', 'Village']
const S = {
  surface: 'var(--ro-surface)',
  surface2: 'var(--ro-surface-elevated)',
  border: 'var(--ro-border)',
  text: 'var(--ro-text)',
  text2: 'var(--ro-text-dim)',
  muted: 'var(--ro-text-muted)',
  accent: '#ff3333',
  green: '#00e676',
  blue: '#38bdf8',
  purple: '#c084fc',
  orange: '#fbbf24',
}

function sameShop(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tb-chip${active ? ' tb-chip--active' : ''}`}
    >
      {label}
    </button>
  )
}

function TypeToggle({ label, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`tb-type-toggle__btn${active ? ' tb-type-toggle__btn--active' : ''}`}>
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
  const [assignedToIds, setAssignedToIds] = useState([])
  const [assignMenuOpen, setAssignMenuOpen] = useState(false)
  const assignMenuRef = useRef(null)
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
      pool = users.filter((u) => u.role === 'manager' && sameShop(u.shop, toShop))
    }
    if (showAllUsers && isExec) return pool
    return pool.filter((u) => onShiftIds.has(u.id))
  }, [users, transferType, toShop, activeShifts, showAllUsers, isExec])

  useEffect(() => {
    const allowed = new Set(assignableUsers.map((u) => u.id))
    setAssignedToIds((prev) => prev.filter((id) => allowed.has(id)))
  }, [assignableUsers])

  useEffect(() => {
    if (!assignMenuOpen) return undefined
    const closeOutside = (event) => {
      if (assignMenuRef.current && !assignMenuRef.current.contains(event.target)) setAssignMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('touchstart', closeOutside, { passive: true })
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('touchstart', closeOutside)
    }
  }, [assignMenuOpen])

  function toggleAssignee(userId) {
    setAssignedToIds((prev) => (
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    ))
  }

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
      const code =
        genderFilter === 'Men' ? 'M' : genderFilter === 'Women' ? 'F' : genderFilter === 'Unisex' ? 'U' : 'K'
      list = list.filter((p) => normalizeGenderCodeForFilter(p.gender) === code)
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
    const remaining = product.quantity - product.sold_quantity
    if (isStagingOverAllocated(product.sku, remaining)) return

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
      payload.assignedToIds = assignedToIds
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

  function getSizeStock(skuCode, size) {
    const row = (rawSkusByProduct[skuCode] || []).find((r) => String(r.size ?? '') === String(size ?? ''))
    if (!row) return 0
    return Math.max(0, row.quantity - row.sold_quantity)
  }

  function isSizeChipInsufficient(skuCode, size) {
    const stock = getSizeStock(skuCode, size)
    const staged = (staging[skuCode] || {})[size] || 0
    return stock <= 0 || staged > stock
  }

  function isStockRowWarning(remaining, skuCode) {
    if (remaining <= 3) return true
    const selected = stagingTotal(skuCode)
    if (selected > 0 && remaining <= selected) return true
    const picks = staging[skuCode] || {}
    return Object.entries(picks).some(([size, qty]) => qty > 0 && qty > getSizeStock(skuCode, size))
  }

  function isStagingOverAllocated(skuCode, remaining) {
    const selected = stagingTotal(skuCode)
    if (selected > remaining) return true
    const picks = staging[skuCode] || {}
    return Object.entries(picks).some(([size, qty]) => qty > getSizeStock(skuCode, size))
  }

  return (
    <div className="transfer-builder-page">
      <p className="tb-page-subtitle page-hero-mobile-hide">
        Select products, pick quantities per size, and assign the transfer.
      </p>

      <div className="transfer-config tb-form-panel">
        <div className="tb-form-field-group tb-form-field-group--type">
          <label className="tb-form-label">Type</label>
          <div className="tb-type-toggle">
            <TypeToggle
              label="Store to Store"
              active={transferType === 'store'}
              onClick={() => {
                setTransferType('store')
                setAssignedToIds([])
                setAssignMenuOpen(false)
              }}
            />
            <TypeToggle
              label="To Outlet"
              active={transferType === 'outlet'}
              onClick={() => {
                setTransferType('outlet')
                setAssignedToIds([])
                setAssignMenuOpen(false)
              }}
            />
          </div>
        </div>

        {transferType === 'store' && (
          <div className="tb-form-field-group tb-form-field-group--route">
            <div className="tb-form-route">
              <div className="tb-form-route__field">
                <label className="tb-form-label">From</label>
                <select
                  className="tb-form-select"
                  value={fromShop}
                  onChange={(e) => {
                    const newFrom = e.target.value
                    setFromShop(newFrom)
                    const newTo = SHOPS.find((s) => s !== newFrom) || SHOPS[0]
                    setToShop(newTo)
                    setAssignedToIds([])
                    setAssignMenuOpen(false)
                  }}
                >
                  {SHOPS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <span className="tb-form-arrow" aria-hidden="true">→</span>
              <div className="tb-form-route__field">
                <label className="tb-form-label">To</label>
                <select
                  className="tb-form-select"
                  value={toShop}
                  onChange={(e) => {
                    setToShop(e.target.value)
                    setAssignedToIds([])
                    setAssignMenuOpen(false)
                  }}
                >
                  {SHOPS.filter((s) => s !== fromShop).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        <div className="tb-form-field-group tb-form-field-group--assign">
          <label className="tb-form-label">
            {transferType === 'outlet' ? 'Assign to (Ring Mall & Village managers)' : `Assign ${toShop} manager`}
          </label>
          {transferType === 'outlet' ? (
            <>
              <div className="tb-outlet-assign-summary">
                {assignableUsers.length === 0 ? (
                  <span className="tb-outlet-assign-summary__empty">
                    No Ring Mall or Village managers available{showAllUsers && isExec ? '' : ' on shift'}.
                  </span>
                ) : (
                  <>
                    Everyone listed gets a task and a notification. Outlet staff are never assigned.
                    <div className="tb-outlet-assign-summary__names">
                      {assignableUsers.map((u) => u.name).join(', ')}
                    </div>
                  </>
                )}
              </div>
              {isExec && (
                <label className="tb-form-checkbox">
                  <input type="checkbox" className="tb-form-checkbox__input pl-bulk-check" checked={showAllUsers} onChange={(e) => setShowAllUsers(e.target.checked)} />
                  Show all Ring Mall &amp; Village managers (include off-shift)
                </label>
              )}
            </>
          ) : (
            <>
              <div className="tb-assignee-menu" ref={assignMenuRef}>
                <button
                  type="button"
                  className={`tb-assignee-menu__trigger${assignMenuOpen ? ' is-open' : ''}`}
                  onClick={() => setAssignMenuOpen((open) => !open)}
                  aria-expanded={assignMenuOpen}
                  aria-haspopup="listbox"
                >
                  <span className={assignedToIds.length ? '' : 'tb-assignee-menu__placeholder'}>
                    {assignedToIds.length
                      ? `${assignedToIds.length} manager${assignedToIds.length === 1 ? '' : 's'} selected`
                      : 'Select managers'}
                  </span>
                  <IconChevronDown size={15} className={assignMenuOpen ? 'is-rotated' : ''} aria-hidden />
                </button>
                {assignMenuOpen && (
                  <div className="tb-assignee-menu__dropdown" role="listbox" aria-multiselectable="true">
                    {assignableUsers.length === 0 ? (
                      <div className="tb-assignee-menu__empty">No available managers</div>
                    ) : assignableUsers.map((u) => (
                      <label key={u.id} className="tb-assignee-menu__option">
                        <input
                          type="checkbox"
                          checked={assignedToIds.includes(u.id)}
                          onChange={() => toggleAssignee(u.id)}
                        />
                        <span>{u.name}</span>
                        <small>{u.shop}</small>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {assignableUsers.length === 0 && !showAllUsers && (
                <div className="tb-form-alert">
                  <IconWarning size={14} strokeWidth={1.75} className="tb-form-alert__icon" />
                  <div>
                    <div className="tb-form-alert__text">No managers on shift at {toShop}</div>
                    {isExec && (
                      <label className="tb-form-checkbox tb-form-checkbox--alert">
                        <input type="checkbox" className="tb-form-checkbox__input pl-bulk-check" checked={showAllUsers} onChange={(e) => setShowAllUsers(e.target.checked)} />
                        Show all users (override)
                      </label>
                    )}
                  </div>
                </div>
              )}
              {isExec && (assignableUsers.length > 0 || showAllUsers) && (
                <label className="tb-form-checkbox">
                  <input type="checkbox" className="tb-form-checkbox__input pl-bulk-check" checked={showAllUsers} onChange={(e) => setShowAllUsers(e.target.checked)} />
                  Show all users (override)
                </label>
              )}
            </>
          )}
        </div>

        <div className="tb-form-field-group tb-form-field-group--note">
          <label className="tb-form-label">Note (optional)</label>
          <input
            type="text"
            className="tb-form-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Low stock replenishment"
          />
        </div>
      </div>

      <div className="transfer-layout">
        <div className="transfer-products">
          <div className="tb-filters">
            <div className="tb-search">
              <IconSearch size={14} strokeWidth={1.75} className="tb-search__icon" />
              <input
                type="text"
                className="tb-search__input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, SKU, or barcode..."
              />
            </div>
            <div className="tb-filter-row">
              {['All', 'Men', 'Women', 'Kids', 'Unisex'].map((g) => (
                <FilterChip key={g} label={g} active={genderFilter === g} onClick={() => setGenderFilter(g)} />
              ))}
            </div>
          </div>
          <div className="tb-filter-row tb-filter-row--category">
            {['All', 'Footwear', 'Apparel', 'Accessories'].map((c) => (
              <FilterChip key={c} label={c} active={categoryFilter === c} onClick={() => setCategoryFilter(c)} />
            ))}
          </div>

          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: S.muted, fontSize: 13, background: S.surface, borderRadius: 14, border: `1px solid ${S.border}` }}>
              No products with available stock match your filters.
            </div>
          )}

          <div className="tb-product-list">
            {filtered.slice(0, 30).map((p) => {
              const inCart = !!cart[p.sku]
              const isExpanded = expandedSku === p.sku
              const sizeRows = getSizeRows(p.sku)
              const remaining = p.quantity - p.sold_quantity
              const lowStock = remaining <= 3
              const stockWarn = isStockRowWarning(remaining, p.sku)
              const overAllocated = isStagingOverAllocated(p.sku, remaining)
              return (
                <div
                  key={p.sku}
                  className={`tb-product-row${isExpanded ? ' tb-product-row--expanded' : ''}${inCart ? ' tb-product-row--incart' : ''}${stockWarn ? ' tb-product-row--stock-warn' : ''}`}
                >
                  <div
                    className="tb-product-row__head"
                    onClick={() => handleToggleExpand(p.sku)}
                  >
                    <div className="tb-product-row__info">
                      <div className="tb-product-row__name">
                        {toTitleCase(p.product_name)}
                        {inCart && <span className="tb-product-row__incart">In cart</span>}
                      </div>
                      <div className="tb-product-row__meta">
                        {p.sku} · {p.brand} · {p.category} ·{' '}
                        <span className={lowStock ? 'tb-product-row__stock tb-product-row__stock--low' : 'tb-product-row__stock'}>
                          {remaining} in stock
                        </span>
                      </div>
                    </div>
                    <div className="tb-product-row__sizes">
                      {(Array.isArray(p.sizes) ? p.sizes : String(p.sizes || '').split(', ')).filter(Boolean).map((sz) => {
                        const insufficient = isSizeChipInsufficient(p.sku, sz)
                        return (
                          <span
                            key={sz}
                            className={`tb-size-chip${insufficient ? ' tb-size-chip--disabled' : ''}`}
                            title={insufficient ? 'Insufficient stock' : undefined}
                          >
                            {sz}
                          </span>
                        )
                      })}
                    </div>
                    <span className={`tb-product-row__chevron${isExpanded ? ' tb-product-row__chevron--expanded' : ''}`} aria-hidden="true">▼</span>
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
                          disabled={stagingTotal(p.sku) === 0 || overAllocated}
                          style={{
                            padding: '7px 16px', borderRadius: 8, border: 'none',
                            background: stagingTotal(p.sku) > 0 && !overAllocated ? S.accent : S.surface2,
                            color: stagingTotal(p.sku) > 0 && !overAllocated ? '#fff' : S.muted,
                            fontSize: 12, fontWeight: 600, fontFamily: DM,
                            cursor: stagingTotal(p.sku) > 0 && !overAllocated ? 'pointer' : 'not-allowed',
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
        <div className="transfer-cart tb-cart">
          <div className="tb-cart__header">
            <div className="tb-cart__title">Transfer cart</div>
            <div className="tb-cart__summary">
              {cartItems.length} product{cartItems.length !== 1 ? 's' : ''} · {grandTotal} unit{grandTotal !== 1 ? 's' : ''}
            </div>
          </div>

          <div className="tb-cart__body">
            {cartItems.length === 0 && (
              <div className="tb-cart__empty">
                <IconCart size={24} strokeWidth={1.5} className="tb-cart__empty-icon" />
                <p>No products added yet. Expand a product on the left and pick sizes.</p>
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
                        background: 'var(--ro-fill-muted)', color: S.text,
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

          <div className="tb-cart__footer">
            <div className="tb-cart__total">
              <span className="tb-cart__total-label">Grand Total</span>
              <span className="tb-cart__total-value">{grandTotal}</span>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                cartItems.length === 0 ||
                (transferType === 'outlet' && assignableUsers.length === 0)
              }
              className={`tb-create-btn${
                cartItems.length > 0 && !(transferType === 'outlet' && assignableUsers.length === 0)
                  ? ' tb-create-btn--active'
                  : ''
              }`}
            >
              Create Transfer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
