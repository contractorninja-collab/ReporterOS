import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import useStore from '../store/useStore.js'
import { DISCOUNTS, salePriceOf, localDateKey } from '../utils/saleList.js'
import { isExecutive } from '../utils/roles.js'
import { toTitleCase } from '../utils/textFormat.js'
import { IconTag, IconDownload } from '../utils/icons.js'

const MARKDOWN_LANES = ['Ring Mall', 'Village', 'E-commerce']
const ECOMMERCE_LANES = ['E-commerce']

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
  orange: '#fbbf24',
}

function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadListCSV(list) {
  const doneLabel = list.kind === 'removal' ? 'Removed' : 'Tagged'
  const headers = [
    'SKU', 'Product', 'Brand', 'Category', 'Gender', 'Season', 'Price Tag', 'Sale %', 'Extra Sale %', 'Sale Price', 'Sizes',
    ...MARKDOWN_LANES.map((lane) => `${lane} ${doneLabel}`),
    'Legacy Marked',
  ]
  const statuses = list.item_statuses || {}
  const rows = (list.items || []).map((it) => [
    it.skuCode, it.productName, it.brand, it.category, it.gender, it.season,
    it.priceTag, it.salePct, it.extraSalePct || 0, it.salePrice, it.sizes,
    ...MARKDOWN_LANES.map((lane) => laneStatus(statuses, it.skuCode, lane)?.status === 'tagged' ? 'Yes' : 'No'),
    legacyMarked(statuses, it.skuCode) ? 'Yes' : 'No',
  ])
  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `sale-list-${(list.title || list.id).replace(/[^a-z0-9-_]+/gi, '_')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function displayListTitle(title) {
  if (!title) return 'Sale list'
  return title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function displayListStatus(status) {
  if (!status || status === 'pending') return 'Pending'
  if (status === 'completed') return 'Completed'
  if (status === 'ended') return 'Sale ended'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function dateTabLabel(dateKey) {
  if (!dateKey) return '—'
  const today = localDateKey(new Date())
  if (dateKey === today) return 'Today'
  const yesterday = localDateKey(new Date(Date.now() - 86400000))
  if (dateKey === yesterday) return 'Yesterday'
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function countMarkedAtShop(changes, shop) {
  return changes.filter((c) => c.shopStatuses?.[shop]?.status === 'marked').length
}

function userMarkdownLane(user) {
  if (user?.role === 'marketing') return 'E-commerce'
  if (user?.role === 'manager' && MARKDOWN_LANES.includes(user.shop)) return user.shop
  return null
}

function userMarkableLanes(user) {
  if (isExecutive(user)) return MARKDOWN_LANES
  const lane = userMarkdownLane(user)
  return lane ? [lane] : []
}

function laneStatus(statuses, skuCode, lane) {
  return statuses?.[skuCode]?.[lane] || null
}

function legacyMarked(statuses, skuCode) {
  return statuses?.[skuCode]?.__legacy?.status === 'tagged'
}

function laneTaggedCount(list, lane) {
  const statuses = list.item_statuses || {}
  return (list.items || []).filter((it) => laneStatus(statuses, it.skuCode, lane)?.status === 'tagged').length
}

function listLaneProgress(list, lanes) {
  const total = (list.items || []).length
  return lanes.map((lane) => ({ lane, done: laneTaggedCount(list, lane), total }))
}

function requiredLanesForList(list) {
  return list?.kind === 'ecommerce_sale' ? ECOMMERCE_LANES : MARKDOWN_LANES
}

function visibleLanesForList(user, list) {
  const required = requiredLanesForList(list)
  if (isExecutive(user)) return required
  const lane = userMarkdownLane(user)
  return lane && required.includes(lane) ? [lane] : []
}

function splitAssignedTo(value) {
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

function buildChangeDateGroups(reports) {
  const map = new Map()
  for (const report of reports) {
    const dk = localDateKey(report.createdAt)
    if (!dk) continue
    if (!map.has(dk)) map.set(dk, { dateKey: dk, reports: [], changes: [] })
    const group = map.get(dk)
    group.reports.push(report)
    for (const ch of report.changes || []) {
      const shopStatuses = (report.item_statuses || {})[ch.skuCode] || {}
      group.changes.push({
        ...ch,
        reportId: report.id,
        listTitle: report.listTitle,
        changedAt: report.createdAt,
        changedBy: ch.changedBy || report.createdBy,
        shopStatuses,
      })
    }
  }
  return Array.from(map.values())
    .map((g) => ({
      ...g,
      changes: g.changes.sort((a, b) => (b.changedAt || '').localeCompare(a.changedAt || '')),
    }))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
}

function ChangeDateTabs({ groups, activeDateKey, onDateChange }) {
  if (!groups.length) return null
  return (
    <div className="md-change-date-tabs">
      {groups.map((g) => (
        <button
          key={g.dateKey}
          type="button"
          className={`md-change-date-tabs__btn${activeDateKey === g.dateKey ? ' md-change-date-tabs__btn--active' : ''}`}
          onClick={() => onDateChange(g.dateKey)}
        >
          {dateTabLabel(g.dateKey)}
          <span className="md-change-date-tabs__count">{g.changes.length}</span>
        </button>
      ))}
    </div>
  )
}

function ChangeReportTiles({
  changes,
  photoMap,
  userName,
  onMarkTagged,
  onUndoTagged,
  onDiscardProduct,
  markingKey,
  discardingKey,
  markableLanes,
}) {
  const [openMenuKey, setOpenMenuKey] = useState('')

  return (
    <div className="md-change-report-grid">
      {changes.map((ch) => {
        const photoUrl = photoMap[ch.skuCode] || null
        const salePct = Math.round(Number(ch.newSalePct) || 0)
        const extraSalePct = Number(ch.newExtraSalePct) === 20 ? 20 : 0
        const allTagged = MARKDOWN_LANES.every((shop) => ch.shopStatuses?.[shop]?.status === 'marked')
        const menuKey = `${ch.reportId}-${ch.skuCode}`
        const rawSeason = String(ch.listTitle || '').match(/\b(?:SS|FW|S)\d{2}\b/i)?.[0]?.toUpperCase() || ''
        const season = /^S\d{2}$/.test(rawSeason) ? `SS${rawSeason.slice(1)}` : rawSeason
        const meta = [ch.skuCode, ch.brand, season].filter(Boolean).join(' · ')
        const discountHistory = `-${Number(ch.oldSalePct) || 0}%${Number(ch.oldExtraSalePct) === 20 ? ' + Extra 20%' : ''} → -${salePct}%${extraSalePct ? ' + Extra 20%' : ''}`
        return (
          <article key={ch.reportId + '-' + ch.skuCode} className={`md-change-card${allTagged ? ' md-change-card--complete' : ''}`}>
            {onDiscardProduct && (
              <div className="md-change-card__overflow">
                <button
                  type="button"
                  className="md-change-card__more-btn"
                  onClick={() => setOpenMenuKey(openMenuKey === menuKey ? '' : menuKey)}
                  aria-label="More sale change options"
                  aria-expanded={openMenuKey === menuKey}
                >
                  ...
                </button>
                {openMenuKey === menuKey && (
                  <div className="md-change-card__menu">
                    <button
                      type="button"
                      className="md-change-card__menu-discard"
                      disabled={discardingKey === menuKey}
                      onClick={() => {
                        setOpenMenuKey('')
                        onDiscardProduct(ch)
                      }}
                    >
                      {discardingKey === menuKey ? 'Discarding...' : 'Discard this change'}
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="md-change-card__media">
              {photoUrl ? (
                <img src={photoUrl} alt={ch.productName} loading="lazy" className="md-change-card__img" />
              ) : (
                <div className="md-change-card__img-empty">
                  <IconTag size={28} strokeWidth={1} />
                </div>
              )}
              {salePct > 0 && (
                <span className="md-change-card__sale-pill">-{salePct}%{extraSalePct ? ' + Extra 20%' : ''}</span>
              )}
            </div>
            <div className="md-change-card__body">
              <div className="md-change-card__info">
                <h3 className="md-change-card__name" title={ch.productName}>
                  {toTitleCase(ch.productName)}
                </h3>
                <p className="md-change-card__meta">
                  {meta}
                </p>
                <div className="md-change-card__price" title={`Discount changed ${discountHistory}`}>
                  {ch.priceTag > 0 && (
                    <span className="md-change-card__price-old">
                      {Number(ch.priceTag).toFixed(2)}€
                    </span>
                  )}
                  {ch.priceTag > 0 && ch.newSalePrice > 0 && (
                    <span className="md-change-card__price-arrow">→</span>
                  )}
                  {ch.newSalePrice > 0 && (
                    <span className="md-change-card__price-new">
                      {Number(ch.newSalePrice).toFixed(2)}€
                    </span>
                  )}
                </div>
                <div className="md-change-card__changed" title={ch.changedBy ? userName(ch.changedBy) : ''}>
                  <span>{ch.changedBy ? userName(ch.changedBy) : '—'}</span>
                </div>
                <div className="md-change-card__shops">
                  {MARKDOWN_LANES.map((shop) => {
                    const st = ch.shopStatuses?.[shop]
                    const isMarked = st?.status === 'marked'
                    const detail = isMarked
                      ? `${userName(st.markedBy)}${st.markedAt ? ` · ${fmtDateTime(st.markedAt)}` : ''}`
                      : 'Pending'
                    const isMarkable = markableLanes.includes(shop)
                    const markKey = `${ch.reportId}-${ch.skuCode}-${shop}`
                    const isMarking = markingKey === markKey
                    const toggle = () => (isMarked
                      ? onUndoTagged(ch.reportId, ch.skuCode, shop)
                      : onMarkTagged(ch.reportId, ch.skuCode, shop))
                    return (
                      <div key={shop} className="md-change-card__channel-row" title={detail}>
                        <span className="md-change-card__channel-name">{shop}</span>
                        {isMarkable ? (
                          <button
                            type="button"
                            className={`md-change-card__status-dot${isMarked ? ' md-change-card__status-dot--done' : ''}`}
                            disabled={isMarking}
                            onClick={toggle}
                            aria-label={isMarked ? `Undo ${shop} tagged status` : `Mark ${shop} as tagged`}
                          >
                            {isMarked ? '✓' : ''}
                          </button>
                        ) : (
                          <span
                            className={`md-change-card__status-dot md-change-card__status-dot--readonly${isMarked ? ' md-change-card__status-dot--done' : ''}`}
                            aria-label={isMarked ? `${shop} tagged` : `${shop} pending`}
                          >
                            {isMarked ? '✓' : ''}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function PageTabs({ activeTab, onTabChange }) {
  return (
    <div className="md-page-tabs">
      <button
        type="button"
        className={`md-page-tabs__btn${activeTab === 'lists' ? ' md-page-tabs__btn--active' : ''}`}
        onClick={() => onTabChange('lists')}
      >
        Lists
      </button>
      <button
        type="button"
        className={`md-page-tabs__btn${activeTab === 'changes' ? ' md-page-tabs__btn--active' : ''}`}
        onClick={() => onTabChange('changes')}
      >
        Change Reports
      </button>
    </div>
  )
}

export default function MarkdownLists() {
  const [searchParams, setSearchParams] = useSearchParams()
  const markdownLists = useStore((s) => s.markdownLists)
  const saleChangeReports = useStore((s) => s.saleChangeReports)
  const fetchSaleChangeReports = useStore((s) => s.fetchSaleChangeReports)
  const changeSaleListItemPct = useStore((s) => s.changeSaleListItemPct)
  const removeSaleListItem = useStore((s) => s.removeSaleListItem)
  const toggleSaleChangeItemMarked = useStore((s) => s.toggleSaleChangeItemMarked)
  const discardSaleChangeReportProduct = useStore((s) => s.discardSaleChangeReportProduct)
  const toggleMarkdownListItemTagged = useStore((s) => s.toggleMarkdownListItemTagged)
  const deleteMarkdownList = useStore((s) => s.deleteMarkdownList)
  const endSaleList = useStore((s) => s.endSaleList)
  const createMarkdownList = useStore((s) => s.createMarkdownList)
  const users = useStore((s) => s.users)
  const activeUser = useStore((s) => s.activeUser)
  const photoMap = useStore((s) => s.photoMap)
  const activeShifts = useStore((s) => s.activeShifts)

  const [openId, setOpenId] = useState(null)
  const [showEmptyForm, setShowEmptyForm] = useState(false)
  const [emptyTitle, setEmptyTitle] = useState('')
  const [emptyAssignedTo, setEmptyAssignedTo] = useState('')
  const [editingSkuCode, setEditingSkuCode] = useState(null)
  const [editingPct, setEditingPct] = useState(30)
  const [editingExtraPct, setEditingExtraPct] = useState(0)
  const [changingSale, setChangingSale] = useState(false)
  const [changeSaleError, setChangeSaleError] = useState('')
  const [markingKey, setMarkingKey] = useState('')
  const [discardingKey, setDiscardingKey] = useState('')
  const canManage = activeUser?.role === 'executive' || activeUser?.role === 'manager'
  const isExec = isExecutive(activeUser)
  const myLane = userMarkdownLane(activeUser)
  const viewLanes = userMarkableLanes(activeUser)

  const activeTab = searchParams.get('tab') === 'changes' ? 'changes' : 'lists'
  const reportId = searchParams.get('report') || null
  const dateParam = searchParams.get('date') || null

  const changeDateGroups = useMemo(
    () => buildChangeDateGroups(saleChangeReports),
    [saleChangeReports],
  )

  const activeChangeDateKey = useMemo(() => {
    if (dateParam && changeDateGroups.some((g) => g.dateKey === dateParam)) return dateParam
    if (reportId) {
      const report = saleChangeReports.find((r) => r.id === reportId)
      if (report) {
        const dk = localDateKey(report.createdAt)
        if (changeDateGroups.some((g) => g.dateKey === dk)) return dk
      }
    }
    return changeDateGroups[0]?.dateKey || null
  }, [dateParam, reportId, saleChangeReports, changeDateGroups])

  const activeChangeGroup = changeDateGroups.find((g) => g.dateKey === activeChangeDateKey) || null

  useEffect(() => {
    if (!saleChangeReports.length) fetchSaleChangeReports().catch(() => {})
  }, [saleChangeReports.length, fetchSaleChangeReports])

  useEffect(() => {
    if (activeTab !== 'changes' || !activeChangeDateKey) return
    if (dateParam === activeChangeDateKey && !reportId) return
    const next = new URLSearchParams()
    next.set('tab', 'changes')
    next.set('date', activeChangeDateKey)
    setSearchParams(next, { replace: true })
  }, [activeTab, activeChangeDateKey, dateParam, reportId, setSearchParams])

  function setPageTab(tab, date = null) {
    const next = new URLSearchParams()
    if (tab === 'changes') {
      next.set('tab', 'changes')
      const dk = date || changeDateGroups[0]?.dateKey
      if (dk) next.set('date', dk)
    }
    setSearchParams(next, { replace: false })
    if (tab === 'lists') setOpenId(null)
  }

  function setChangeDate(dateKey) {
    const next = new URLSearchParams()
    next.set('tab', 'changes')
    next.set('date', dateKey)
    setSearchParams(next, { replace: false })
  }

  const assignableUsers = useMemo(() => {
    const onShiftIds = new Set(activeShifts.map((s) => s.user_id))
    let pool = users.filter((u) => u.role !== 'outlet')
    if (activeUser?.shop) pool = pool.filter((u) => u.shop === activeUser.shop)
    return pool.filter((u) => onShiftIds.has(u.id))
  }, [users, activeUser, activeShifts])

  const userName = useMemo(() => {
    const map = {}
    for (const u of users) map[u.id] = u.name
    return (id) => map[id] || '—'
  }, [users])

  const assigneeNames = useMemo(() => {
    const map = {}
    for (const u of users) map[u.id] = u.name
    return (value) => {
      const ids = splitAssignedTo(value)
      if (!ids.length) return ''
      return ids.map((id) => map[id] || '—').join(', ')
    }
  }, [users])

  const openList = markdownLists.find((l) => l.id === openId) || null

  async function toggleTagged(list, skuCode, lane) {
    if (!lane || markingKey) return
    const key = `${list.id}-${skuCode}-${lane}`
    setMarkingKey(key)
    try {
      await toggleMarkdownListItemTagged(list.id, skuCode, lane)
    } catch {
      /* store refetches on failure */
    } finally {
      setMarkingKey('')
    }
  }

  function endSale(list) {
    const n = (list.items || []).length
    const ok = window.confirm(
      `End the sale for "${list.title || 'this list'}"?\nThe SALE badge will be removed from all ${n} products and a removal list will be created so the team can take the sale tags off.`,
    )
    if (!ok) return
    endSaleList(list.id)
    const removalId = createMarkdownList({
      kind: 'removal',
      title: `Remove sale: ${list.title || 'Sale list'}`,
      items: list.items || [],
      assignedTo: list.assignedTo || null,
      shop: list.shop || undefined,
      note: 'Sale ended — remove the sale tags from these products',
    })
    setOpenId(removalId)
  }

  function removeList(list) {
    const activeSale = list.kind !== 'removal' && list.status !== 'ended'
    const ok = window.confirm(
      activeSale
        ? `Delete "${list.title || 'this sale list'}"?\nThe SALE badge will be removed from all ${(list.items || []).length} products.`
        : `Delete "${list.title || 'this list'}"?`,
    )
    if (!ok) return
    if (openId === list.id) setOpenId(null)
    deleteMarkdownList(list.id)
  }

  function handleCreateEmpty() {
    const title = emptyTitle.trim()
    if (!title) return
    const id = createMarkdownList({
      items: [],
      title,
      assignedTo: emptyAssignedTo || null,
    })
    setEmptyTitle('')
    setEmptyAssignedTo('')
    setShowEmptyForm(false)
    setOpenId(id)
  }

  async function confirmChangeSale(list, skuCode) {
    if (!editingPct || changingSale) return
    const item = (list.items || []).find((i) => i.skuCode === skuCode)
    const currentExtraPct = Number(item?.extraSalePct) === 20 ? 20 : 0
    if (!item || (Number(item.salePct) === editingPct && currentExtraPct === editingExtraPct)) return
    setChangingSale(true)
    setChangeSaleError('')
    try {
      await changeSaleListItemPct(list.id, skuCode, editingPct, editingExtraPct)
      setEditingSkuCode(null)
    } catch (e) {
      setChangeSaleError(e?.message || 'Failed to update sale %')
    } finally {
      setChangingSale(false)
    }
  }

  async function confirmRemoveSaleItem(list, item) {
    if (!item || changingSale) return
    const ok = window.confirm(`Remove ${item.productName || item.skuCode} from this sale?`)
    if (!ok) return
    setChangingSale(true)
    setChangeSaleError('')
    try {
      await removeSaleListItem(list.id, item.skuCode)
      setEditingSkuCode(null)
    } catch (e) {
      setChangeSaleError(e?.message || 'Failed to remove sale')
    } finally {
      setChangingSale(false)
    }
  }

  async function handleToggleChangeMarked(reportId, skuCode, shop) {
    const key = `${reportId}-${skuCode}-${shop}`
    if (markingKey) return
    setMarkingKey(key)
    try {
      await toggleSaleChangeItemMarked(reportId, skuCode, shop)
    } catch {
      /* store refetches on failure */
    } finally {
      setMarkingKey('')
    }
  }

  async function handleMarkChangeTagged(reportId, skuCode, shop) {
    return handleToggleChangeMarked(reportId, skuCode, shop)
  }

  async function handleDiscardChangeProduct(change) {
    if (!change || discardingKey) return
    const key = change.reportId + '-' + change.skuCode
    const ok = window.confirm(
      'Discard this sale change? This reverts the discount for all locations.',
    )
    if (!ok) return
    setDiscardingKey(key)
    try {
      await discardSaleChangeReportProduct(change.reportId, change.skuCode)
    } catch (e) {
      window.alert(e?.message || 'Could not discard this product change')
    } finally {
      setDiscardingKey('')
    }
  }

  // ── Change reports (grouped by date) ─────────────────────────────────────
  if (activeTab === 'changes' && !openId) {
    return (
      <div className="markdown-lists-page" style={{ maxWidth: 1100 }}>
        <PageTabs activeTab={activeTab} onTabChange={setPageTab} />
        <div style={{ margin: '16px 0 20px' }}>
          <h2 style={{ fontFamily: DM, fontSize: 22, letterSpacing: '2px', color: 'var(--ro-heading)', margin: 0 }}>
            SALE CHANGE REPORTS
          </h2>
          <p style={{ fontSize: 12, color: S.muted, margin: '4px 0 0' }}>
            Sale % updates grouped by day. Mark down the new sale tag on each product when done.
          </p>
        </div>
        {changeDateGroups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: S.muted, fontSize: 13, background: S.surface, borderRadius: 14, border: `1px solid ${S.border}` }}>
            No sale changes recorded yet.
          </div>
        ) : (
          <>
            <ChangeDateTabs
              groups={changeDateGroups}
              activeDateKey={activeChangeDateKey}
              onDateChange={setChangeDate}
            />
            {activeChangeGroup && (
              <>
                <div style={{ margin: '16px 0' }}>
                  <p style={{ fontSize: 12, color: S.muted, margin: 0 }}>
                    {dateTabLabel(activeChangeGroup.dateKey)} · {activeChangeGroup.changes.length} change{activeChangeGroup.changes.length !== 1 ? 's' : ''}
                    {activeChangeGroup.reports.length > 1 ? ` · ${activeChangeGroup.reports.length} lists` : ''}
                    {' · '}
                    {isExec ? (
                      <strong style={{ color: S.text }}>
                        {MARKDOWN_LANES.map((shop) => {
                          const n = countMarkedAtShop(activeChangeGroup.changes, shop)
                          const total = activeChangeGroup.changes.length
                          const done = n === total && total > 0
                          return (
                            <span key={shop} style={{ color: done ? S.green : S.text, marginRight: 10 }}>
                              {shop} {n}/{total}
                            </span>
                          )
                        })}
                      </strong>
                    ) : myLane ? (
                      <strong style={{
                        color: countMarkedAtShop(activeChangeGroup.changes, myLane) === activeChangeGroup.changes.length
                          && activeChangeGroup.changes.length > 0
                          ? S.green
                          : S.text,
                      }}
                      >
                        {myLane} · Marked: {countMarkedAtShop(activeChangeGroup.changes, myLane)}/{activeChangeGroup.changes.length}
                      </strong>
                    ) : null}
                  </p>
                </div>
                <ChangeReportTiles
                  changes={activeChangeGroup.changes}
                  photoMap={photoMap}
                  userName={userName}
                  onMarkTagged={handleMarkChangeTagged}
                  onUndoTagged={handleToggleChangeMarked}
                  onDiscardProduct={isExec ? handleDiscardChangeProduct : undefined}
                  markingKey={markingKey}
                  discardingKey={discardingKey}
                  markableLanes={viewLanes}
                />
              </>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Open list: verification grid ─────────────────────────────────────────
  if (openList) {
    const items = openList.items || []
    const statuses = openList.item_statuses || {}
    const isRemoval = openList.kind === 'removal'
    const isEnded = openList.status === 'ended'
    const isCompleted = openList.status === 'completed' || isEnded
    const listRequiredLanes = requiredLanesForList(openList)
    const listViewLanes = visibleLanesForList(activeUser, openList)
    const progressLanes = listLaneProgress(openList, listViewLanes.length ? listViewLanes : listRequiredLanes)
    const pcts = items.map((i) => i.salePct).filter((v) => v > 0)
    const pctLabel = pcts.length
      ? (Math.min(...pcts) === Math.max(...pcts) ? `-${pcts[0]}%` : `-${Math.min(...pcts)}% to -${Math.max(...pcts)}%`)
      : '—'
    const extraLabel = items.some((i) => Number(i.extraSalePct) === 20) ? ' · Extra 20% on selected items' : ''

    return (
      <div className="markdown-lists-page md-sale-list-page" style={{ maxWidth: 1100 }}>
        <button type="button" className="md-sale-list-back" onClick={() => setOpenId(null)}>
          ← All sale lists
        </button>

        <div className="md-sale-list-header">
          <div className="md-sale-list-header__main">
            <h2 className="md-sale-list-header__title">
              {displayListTitle(openList.title)}
              {isRemoval && (
                <span className="md-sale-list-header__flag md-sale-list-header__flag--warn">Remove tags</span>
              )}
              {isEnded && (
                <span className="md-sale-list-header__flag">Sale ended</span>
              )}
            </h2>
            <p className="md-sale-list-header__subtitle">
              {items.length} products · {pctLabel}{extraLabel} · created {fmtDate(openList.createdAt)}
              {openList.assignedTo ? ` · assigned to ${assigneeNames(openList.assignedTo)}` : ''}
              {openList.note ? ` · ${openList.note}` : ''}
            </p>
          </div>
          <div className="md-sale-list-header__actions">
            <button type="button" className="md-sale-list-btn md-sale-list-btn--neutral" onClick={() => downloadListCSV(openList)}>
              <IconDownload size={14} strokeWidth={1.5} aria-hidden />
              Download CSV
            </button>
            {isExec && !isRemoval && !isEnded && (
              <button type="button" className="md-sale-list-btn md-sale-list-btn--warn" onClick={() => endSale(openList)}>
                End sale → removal list
              </button>
            )}
            {isExec && (
              <button type="button" className="md-sale-list-btn md-sale-list-btn--danger" onClick={() => removeList(openList)}>
                {isRemoval || isEnded ? 'Delete list' : 'Delete & end sale'}
              </button>
            )}
          </div>
        </div>

        <div className="md-sale-list-progress" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isExec ? 'repeat(auto-fit, minmax(180px, 1fr))' : 'minmax(0, 1fr)' }}>
            {progressLanes.map(({ lane, done, total }) => (
              <div key={lane} style={{ display: 'grid', gap: 5 }}>
                <span className="md-sale-list-progress__label">
                  {lane}: {done} / {total} {isRemoval ? 'removed' : 'tagged'}
                </span>
                <div className="md-sale-list-progress__track">
                  <div
                    className="md-sale-list-progress__fill"
                    style={{ width: `${total ? (done / total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {isCompleted ? (
            <span className={`md-sale-list-progress__badge${isEnded ? ' md-sale-list-progress__badge--muted' : ''}`}>
              {isEnded ? 'Sale ended' : `Completed ${fmtDate(openList.completedAt)}`}
            </span>
          ) : (
            <span className="md-sale-list-progress__badge md-sale-list-progress__badge--muted">
              Completes when all lanes finish
            </span>
          )}
        </div>

        {items.length === 0 && !isRemoval && !isEnded && (
          <div className="md-sale-list-empty">
            0 products — go to <Link to="/lookup">Product Lookup</Link> and use <strong>Assign Sale</strong> to add items to this list.
          </div>
        )}

        <div className="md-sale-list-grid">
          {items.map((it) => {
            const visibleItemLanes = listViewLanes
            const primaryDone = visibleItemLanes.length === 1
              ? laneStatus(statuses, it.skuCode, visibleItemLanes[0])?.status === 'tagged'
              : listRequiredLanes.every((lane) => laneStatus(statuses, it.skuCode, lane)?.status === 'tagged')
            const photoUrl = photoMap[it.skuCode] || null
            const canChangeSale = isExec && !isRemoval && !isEnded
            const isEditing = editingSkuCode === it.skuCode
            const currentPct = Number(it.salePct) || 0
            const currentExtraPct = Number(it.extraSalePct) === 20 ? 20 : 0
            const salePct = Math.round(currentPct)
            return (
              <article key={it.skuCode} className="md-sale-card">
                <div className="md-sale-card__media">
                  {photoUrl ? (
                    <img src={photoUrl} alt={it.productName} loading="lazy" className="md-sale-card__img" />
                  ) : (
                    <div className="md-sale-card__img-empty">
                      <IconTag size={28} strokeWidth={1} />
                    </div>
                  )}
                  {salePct > 0 && (
                    <span className="md-sale-card__sale-pill">-{salePct}%{currentExtraPct ? ' + Extra 20%' : ''}</span>
                  )}
                </div>
                <div className="md-sale-card__body">
                  <div className="md-sale-card__info">
                    {primaryDone && (
                      <span className="md-sale-card__tagged-pill">
                        ✓ {isRemoval ? 'Removed' : 'Tagged'}
                      </span>
                    )}
                    <h3 className="md-sale-card__name" title={it.productName}>{it.productName}</h3>
                    <p className="md-sale-card__meta">
                      {it.skuCode}{it.brand ? ` · ${it.brand}` : ''}
                    </p>
                    {it.sizes && <p className="md-sale-card__sizes">{it.sizes}</p>}
                    <div className="md-sale-card__price">
                      {it.priceTag > 0 && (
                        <span className="md-sale-card__price-old">
                          {Number(it.priceTag).toFixed(2)}€
                        </span>
                      )}
                      {it.salePrice > 0 && (
                        <span className="md-sale-card__price-new">
                          {Number(it.salePrice).toFixed(2)}€
                        </span>
                      )}
                    </div>
                    {canChangeSale && isEditing && (
                      <div className="md-change-sale-editor md-sale-card__editor">
                        <div className="md-change-sale-editor__summary">
                          <div className="md-change-sale-editor__thumb">
                            {photoUrl ? (
                              <img src={photoUrl} alt="" loading="lazy" className="md-change-sale-editor__thumb-img" />
                            ) : (
                              <div className="md-change-sale-editor__thumb-empty">
                                <IconTag size={20} strokeWidth={1} />
                              </div>
                            )}
                          </div>
                          <div className="md-change-sale-editor__details">
                            <h4 className="md-change-sale-editor__name" title={it.productName}>{it.productName}</h4>
                            <p className="md-change-sale-editor__meta">
                              {it.skuCode}{it.brand ? ` · ${it.brand}` : ''}
                            </p>
                            {it.sizes && <p className="md-change-sale-editor__sizes">{it.sizes}</p>}
                            <div className="md-change-sale-editor__price">
                              {it.priceTag > 0 && (
                                <span className="md-change-sale-editor__price-old">
                                  {Number(it.priceTag).toFixed(2)}€
                                </span>
                              )}
                              {it.salePrice > 0 && (
                                <span className="md-change-sale-editor__price-new">
                                  {Number(it.salePrice).toFixed(2)}€
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="md-change-sale-editor__label">Select discount</div>
                        <div className="md-change-sale-editor__pills">
                          {DISCOUNTS.map((d) => (
                            <button
                              key={d}
                              type="button"
                              className={`md-change-sale-editor__pill${editingPct === d ? ' md-change-sale-editor__pill--active' : ''}`}
                              onClick={() => setEditingPct(d)}
                            >
                              -{d}%
                            </button>
                          ))}
                        </div>
                        {editingPct > 0 && (
                          <label className="sale-extra-toggle sale-extra-toggle--editor">
                            <input
                              type="checkbox"
                              checked={editingExtraPct === 20}
                              onChange={(e) => setEditingExtraPct(e.target.checked ? 20 : 0)}
                            />
                            Extra 20% off sale price
                          </label>
                        )}
                        {it.priceTag > 0 && editingPct > 0 && (
                          <div className="md-change-sale-editor__preview">
                            <span className="md-change-sale-editor__preview-text">
                              Discount: -{editingPct}%{editingExtraPct === 20 ? ' + Extra 20%' : ''} → New price: {salePriceOf(it.priceTag, editingPct, editingExtraPct).toFixed(2)}€
                            </span>
                            {editingPct === currentPct && editingExtraPct === currentExtraPct && (
                              <span className="md-change-sale-editor__same-pill">Same as current</span>
                            )}
                          </div>
                        )}
                        <div className="md-change-sale-editor__actions">
                          <button
                            type="button"
                            className="md-change-sale-editor__confirm"
                            disabled={changingSale || (editingPct === currentPct && editingExtraPct === currentExtraPct)}
                            onClick={() => confirmChangeSale(openList, it.skuCode)}
                          >
                            {changingSale ? 'Saving…' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            className="md-change-sale-editor__remove"
                            disabled={changingSale}
                            onClick={() => confirmRemoveSaleItem(openList, it)}
                          >
                            Remove
                          </button>
                          <button
                            type="button"
                            className="md-change-sale-editor__cancel"
                            onClick={() => {
                              setEditingSkuCode(null)
                              setChangeSaleError('')
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                        {changeSaleError && (
                          <div className="md-change-sale-editor__error">{changeSaleError}</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="md-sale-card__footer">
                    <div className="md-change-card__shops" style={{ width: '100%' }}>
                      {listViewLanes.map((lane) => {
                        const st = laneStatus(statuses, it.skuCode, lane)
                        const done = st?.status === 'tagged'
                        const detail = done
                          ? `${userName(st.markedBy)}${st.markedAt ? ` · ${fmtDateTime(st.markedAt)}` : ''}`
                          : 'Pending'
                        return (
                          <span
                            key={lane}
                            className={`md-change-card__shop-pill${done ? ' md-change-card__shop-pill--done' : ''}`}
                            title={detail}
                          >
                            {lane} {done ? '✓ Tagged' : 'Pending'}
                          </span>
                        )
                      })}
                      {!listViewLanes.length && !isExec && (
                        <span className="md-change-card__shop-pill">No lane assigned</span>
                      )}
                      {legacyMarked(statuses, it.skuCode) && (
                        <span className="md-change-card__shop-pill md-change-card__shop-pill--done" title="Imported from an older single-status sale list">
                          Legacy marked
                        </span>
                      )}
                    </div>
                    {canChangeSale && !isEditing && (
                      <button
                        type="button"
                        className="md-sale-card__change-btn"
                        onClick={() => {
                          setEditingSkuCode(it.skuCode)
                          setEditingPct(currentPct || 30)
                          setEditingExtraPct(currentExtraPct)
                          setChangeSaleError('')
                        }}
                      >
                        Change sale
                      </button>
                    )}
                    {!isCompleted && listViewLanes.map((lane) => {
                      const isTagged = laneStatus(statuses, it.skuCode, lane)?.status === 'tagged'
                      const key = `${openList.id}-${it.skuCode}-${lane}`
                      const isMarking = markingKey === key
                      return (
                        <button
                          key={lane}
                          type="button"
                          className={`md-sale-card__mark-btn${isTagged ? ' md-sale-card__mark-btn--done' : ''}`}
                          disabled={isMarking}
                          onClick={() => toggleTagged(openList, it.skuCode, lane)}
                        >
                          {isMarking
                            ? 'Saving...'
                            : isRemoval
                              ? (isTagged ? 'Undo removed' : '✓ Mark removed')
                              : (isTagged ? 'Undo tagged' : '✓ Mark tagged')}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    )
  }

  // ── List cards ───────────────────────────────────────────────────────────
  return (
    <div className="markdown-lists-page md-lists-index" style={{ maxWidth: 1100 }}>
      <PageTabs activeTab={activeTab} onTabChange={setPageTab} />
      <div className="md-lists-index-header">
        <div className="md-lists-index-header__main page-hero-mobile-hide">
          <p className="md-lists-index-header__subtitle">
            Products marked for sale. Open a list to tick off items as they are physically tagged.
          </p>
        </div>
        {canManage && (
          <div className="md-lists-index-header__actions">
            <button
              type="button"
              className="md-lists-btn md-lists-btn--neutral"
              onClick={() => setShowEmptyForm((v) => !v)}
            >
              <IconTag size={14} strokeWidth={1.5} aria-hidden />
              New empty list
            </button>
            <Link to="/new-markdown" className="md-lists-btn md-lists-btn--primary">
              <IconTag size={14} strokeWidth={1.5} aria-hidden />
              Create sale list
            </Link>
          </div>
        )}
      </div>

      {showEmptyForm && canManage && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end',
          background: S.surface, border: `1px solid ${S.border}`, borderRadius: 12,
          padding: '14px 16px', marginBottom: 16,
        }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 5 }}>
              List title
            </label>
            <input
              type="text"
              value={emptyTitle}
              onChange={(e) => setEmptyTitle(e.target.value)}
              placeholder="e.g. Weekend sale"
              style={{
                width: '100%', background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8,
                padding: '6px 10px', color: S.text, fontSize: 12, fontFamily: DM, outline: 'none',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 5 }}>
              Assign to (optional)
            </label>
            <select
              value={emptyAssignedTo}
              onChange={(e) => setEmptyAssignedTo(e.target.value)}
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
          </div>
          <button
            type="button"
            onClick={handleCreateEmpty}
            disabled={!emptyTitle.trim()}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: emptyTitle.trim() ? S.blue : S.surface2,
              color: emptyTitle.trim() ? '#04151f' : S.muted,
              fontSize: 12, fontWeight: 700, fontFamily: DM,
              cursor: emptyTitle.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Create empty list
          </button>
          <button
            type="button"
            onClick={() => { setShowEmptyForm(false); setEmptyTitle(''); setEmptyAssignedTo('') }}
            style={{
              padding: '8px 14px', borderRadius: 8, border: `1px solid ${S.border}`,
              background: 'transparent', color: S.text2, fontSize: 12, fontFamily: DM, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {markdownLists.length === 0 && (
        <div className="md-lists-empty">
          <IconTag size={32} strokeWidth={1} className="md-lists-empty__icon" aria-hidden />
          <p className="md-lists-empty__title">No sale lists yet</p>
          <p className="md-lists-empty__sub">Create a sale list to start marking products.</p>
          {canManage && (
            <Link to="/new-markdown" className="md-lists-btn md-lists-btn--primary md-lists-empty__cta">
              <IconTag size={14} strokeWidth={1.5} aria-hidden />
              Create sale list
            </Link>
          )}
        </div>
      )}

      <div className="md-lists-grid">
        {markdownLists.map((list) => {
          const items = list.items || []
          const cardViewLanes = visibleLanesForList(activeUser, list)
          const cardRequiredLanes = requiredLanesForList(list)
          const cardProgress = listLaneProgress(list, cardViewLanes.length ? cardViewLanes : cardRequiredLanes)
          const totalTagged = cardProgress.reduce((sum, p) => sum + p.done, 0)
          const totalRequired = cardProgress.reduce((sum, p) => sum + p.total, 0)
          const isRemoval = list.kind === 'removal'
          const statusKey = list.status === 'ended' ? 'ended' : (list.status || 'pending')
          const pcts = items.map((i) => i.salePct).filter((v) => v > 0)
          const pctLabel = pcts.length
            ? (Math.min(...pcts) === Math.max(...pcts) ? `-${pcts[0]}%` : `-${Math.min(...pcts)}% to -${Math.max(...pcts)}%`)
            : '—'
          const extraLabel = items.some((i) => Number(i.extraSalePct) === 20) ? ' · Extra 20% on selected items' : ''
          return (
            <div
              key={list.id}
              className="md-lists-card"
              onClick={() => { setPageTab('lists'); setOpenId(list.id) }}
            >
              <div className="md-lists-card__head">
                <div className="md-lists-card__title">
                  {displayListTitle(list.title)}
                </div>
                <div className="md-lists-card__badges">
                  {isRemoval && (
                    <span className="md-lists-card__badge md-lists-card__badge--warn">
                      Remove tags
                    </span>
                  )}
                  <span className={`md-lists-card__badge md-lists-card__badge--${statusKey}`}>
                    {displayListStatus(list.status)}
                  </span>
                </div>
              </div>
              <div className="md-lists-card__meta">
                {items.length} products · {pctLabel}{extraLabel} · {fmtDate(list.createdAt)}
                {list.assignedTo ? ` · ${assigneeNames(list.assignedTo)}` : ''}
              </div>
              <div className="md-lists-card__progress">
                <div className="md-lists-card__progress-track">
                  <div
                    className="md-lists-card__progress-fill"
                    style={{ width: `${totalRequired ? (totalTagged / totalRequired) * 100 : 0}%` }}
                  />
                </div>
                <span className="md-lists-card__progress-label">
                  {totalTagged}/{totalRequired} {isRemoval ? 'removed' : 'tagged'}
                </span>
              </div>
              <div className="md-lists-card__lane-chips">
                {cardProgress.map(({ lane, done, total }) => (
                  <span
                    key={lane}
                    className={`md-lists-card__lane-chip${
                      done === 0
                        ? ' md-lists-card__lane-chip--empty'
                        : done >= total
                          ? ' md-lists-card__lane-chip--done'
                          : ' md-lists-card__lane-chip--progress'
                    }`}
                  >
                    {done >= total && total > 0 && <span className="md-lists-card__lane-check">✓</span>}
                    <span className="md-lists-card__lane-name">{lane}:</span> {done}/{total} {isRemoval ? 'removed' : 'tagged'}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
