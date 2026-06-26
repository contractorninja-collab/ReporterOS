import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../store/useStore.js'
import { aggregateSkus } from '../utils/aggregateSkus.js'
import { normalizeGenderCodeForFilter } from '../utils/gender.js'
import { DISCOUNTS, salePriceOf } from '../utils/saleList.js'
import { IconSearch, IconTag } from '../utils/icons.js'

const DM = '"DM Sans", sans-serif'
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

export default function MarkdownBuilder() {
  const navigate = useNavigate()
  const skus = useStore((s) => s.skus)
  const users = useStore((s) => s.users)
  const activeUser = useStore((s) => s.activeUser)
  const activeShifts = useStore((s) => s.activeShifts)
  const photoMap = useStore((s) => s.photoMap)
  const createMarkdownList = useStore((s) => s.createMarkdownList)

  const products = useMemo(() => aggregateSkus(skus), [skus])

  const [search, setSearch] = useState('')
  const [genderFilter, setGenderFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [brandFilter, setBrandFilter] = useState('All')
  const [seasonFilter, setSeasonFilter] = useState('All')

  const [title, setTitle] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [note, setNote] = useState('')
  const [showAllUsers, setShowAllUsers] = useState(false)
  const isExec = activeUser?.role === 'executive'

  // selection: { [skuCode]: pct }
  const [selected, setSelected] = useState({})

  const brands = useMemo(() => {
    const set = new Set()
    for (const p of products) {
      const b = String(p.brand || '').trim()
      if (b && b !== '—') set.add(b)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [products])

  const seasons = useMemo(() => {
    const set = new Set()
    for (const p of products) {
      const s = String(p.season || '').trim()
      if (s) set.add(s)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [products])

  const assignableUsers = useMemo(() => {
    const onShiftIds = new Set(activeShifts.map((s) => s.user_id))
    let pool = users.filter((u) => u.role !== 'outlet')
    if (activeUser?.shop) pool = pool.filter((u) => u.shop === activeUser.shop)
    if (showAllUsers && isExec) return pool
    return pool.filter((u) => onShiftIds.has(u.id))
  }, [users, activeUser, activeShifts, showAllUsers, isExec])

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
    if (brandFilter !== 'All') {
      list = list.filter((p) => String(p.brand || '').trim() === brandFilter)
    }
    if (seasonFilter !== 'All') {
      list = list.filter((p) => String(p.season || '').trim() === seasonFilter)
    }
    return list
  }, [products, search, genderFilter, categoryFilter, brandFilter, seasonFilter])

  const productsByCode = useMemo(() => {
    const map = {}
    for (const p of products) map[p.sku] = p
    return map
  }, [products])

  const selectedCodes = Object.keys(selected)
  const selectedCount = selectedCodes.length

  function toggleSelect(skuCode) {
    setSelected((prev) => {
      const next = { ...prev }
      if (next[skuCode] != null) delete next[skuCode]
      else next[skuCode] = 30
      return next
    })
  }

  function setPct(skuCode, pct) {
    setSelected((prev) => ({ ...prev, [skuCode]: pct }))
  }

  function handleConfirm() {
    if (selectedCount === 0) return
    const items = selectedCodes
      .map((code) => {
        const p = productsByCode[code]
        if (!p) return null
        const pct = selected[code]
        return {
          skuCode: code,
          productName: p.product_name || '',
          brand: p.brand || '',
          category: p.category || '',
          gender: p.gender || '',
          season: p.season || '',
          priceTag: Number(p.price_tag) || 0,
          salePct: pct,
          salePrice: salePriceOf(p.price_tag, pct),
          sizes: Array.isArray(p.sizes) ? p.sizes.join(', ') : String(p.sizes || ''),
        }
      })
      .filter(Boolean)
    createMarkdownList({
      title: title.trim() || null,
      items,
      assignedTo: assignedTo || null,
      note: note.trim() || null,
    })
    navigate('/markdown')
  }

  return (
    <div className="markdown-builder-page" style={{ maxWidth: 1100, paddingBottom: 90 }}>
      <div className="page-hero-mobile-hide" style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: DM, fontSize: 22, letterSpacing: '2px', color: 'var(--ro-heading)', margin: 0 }}>
          NEW SALE LIST
        </h2>
        <p style={{ fontSize: 12, color: S.muted, margin: '4px 0 0' }}>
          Filter the inventory, tick products, choose a discount per product, then confirm.
        </p>
      </div>

      {/* ── Config bar ─────────────────────────────────────────────────── */}
      <div
        className="md-config"
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
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 5 }}>
            List title (optional)
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Mid-season sale"
            style={{
              width: '100%',
              background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8,
              padding: '6px 10px', color: S.text, fontSize: 12, fontFamily: DM, outline: 'none',
            }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 5 }}>
            Assign to (staff tags the products)
          </label>
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
          {isExec && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 10, color: S.text2, cursor: 'pointer' }}>
              <input type="checkbox" checked={showAllUsers} onChange={(e) => setShowAllUsers(e.target.checked)} style={{ accentColor: S.blue }} />
              Show all users (include off-shift)
            </label>
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
            placeholder="e.g. Tag before Saturday opening"
            style={{
              width: '100%',
              background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8,
              padding: '6px 10px', color: S.text, fontSize: 12, fontFamily: DM, outline: 'none',
            }}
          />
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8,
            padding: '6px 11px', flex: 1, minWidth: 180,
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
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          style={{
            background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8,
            padding: '6px 10px', color: S.text, fontSize: 12, fontFamily: DM, outline: 'none',
          }}
        >
          <option value="All">All brands</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value)}
          style={{
            background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8,
            padding: '6px 10px', color: S.text, fontSize: 12, fontFamily: DM, outline: 'none',
          }}
        >
          <option value="All">All seasons</option>
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {['All', 'Men', 'Women', 'Kids', 'Unisex'].map((g) => (
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

      {/* ── Product rows ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.slice(0, 60).map((p) => {
          const pct = selected[p.sku]
          const isSelected = pct != null
          const remaining = p.quantity - p.sold_quantity
          const photoUrl = photoMap[p.sku] || null
          const priceTag = Number(p.price_tag) || 0
          return (
            <div key={p.sku} className={`md-row${isSelected ? ' md-row--selected' : ''}`}>
              <label className="md-row__main">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(p.sku)}
                  style={{ accentColor: S.accent, width: 15, height: 15, flexShrink: 0, cursor: 'pointer' }}
                />
                {photoUrl ? (
                  <img src={photoUrl} alt="" className="md-row__thumb" />
                ) : (
                  <div className="md-row__thumb md-row__thumb--empty"><IconTag size={14} strokeWidth={1.5} /></div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: S.text, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.product_name}
                    {p.sale_active ? (
                      <span style={{ marginLeft: 8, fontSize: 9, color: S.accent, fontWeight: 700 }}>
                        ALREADY ON SALE −{p.sale_percent}%
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 11, color: S.muted, fontFamily: DM }}>
                    {p.sku} · {p.brand || '—'} · {p.category || '—'} · {p.season || '—'} · {remaining} in stock
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: S.text, fontFamily: DM }}>
                    {priceTag > 0 ? `${priceTag.toFixed(2)}€` : '—'}
                  </div>
                  {isSelected && priceTag > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: S.green, fontFamily: DM }}>
                      → {salePriceOf(priceTag, pct).toFixed(2)}€
                    </div>
                  )}
                </div>
              </label>
              <div className="md-row__pills">
                {DISCOUNTS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`md-pct-pill${isSelected && pct === d ? ' md-pct-pill--active' : ''}`}
                    onClick={() => {
                      if (isSelected && pct === d) toggleSelect(p.sku)
                      else setPct(p.sku, d)
                    }}
                  >
                    -{d}%
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        {filtered.length > 60 && (
          <p style={{ fontSize: 11, color: S.muted, textAlign: 'center', marginTop: 4 }}>
            Showing first 60 of {filtered.length} products. Use search or filters to narrow down.
          </p>
        )}
      </div>

      {/* ── Confirm bar ────────────────────────────────────────────────── */}
      <div className="md-confirm-bar">
        <div style={{ fontSize: 12, color: S.text2, fontFamily: DM }}>
          <strong style={{ color: S.text, fontSize: 14 }}>{selectedCount}</strong> product{selectedCount !== 1 ? 's' : ''} selected
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => setSelected({})}
              style={{
                marginLeft: 10, padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                border: `1px solid ${S.border}`, background: 'transparent', color: S.muted,
                cursor: 'pointer', fontFamily: DM,
              }}
            >
              Clear
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={selectedCount === 0}
          style={{
            padding: '10px 26px', borderRadius: 10, border: 'none',
            background: selectedCount > 0 ? S.accent : S.surface2,
            color: selectedCount > 0 ? '#fff' : S.muted,
            fontSize: 13, fontWeight: 700, fontFamily: DM, letterSpacing: '0.5px',
            cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          Confirm Sale List
        </button>
      </div>
    </div>
  )
}
