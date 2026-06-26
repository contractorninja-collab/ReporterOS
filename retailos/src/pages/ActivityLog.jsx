import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchActivityLog } from '../api/client.js'
import { IconManager } from '../utils/icons.js'

const PAGE_SIZE = 50

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

const CATEGORIES = [
  { key: '', label: 'All' },
  { key: 'import', label: 'Import' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'user', label: 'Users' },
  { key: 'assignment', label: 'Tasks' },
  { key: 'transfer_outlet', label: 'Outlet transfer' },
  { key: 'transfer_store', label: 'Store transfer' },
  { key: 'shift', label: 'Shifts' },
  { key: 'sales_snapshot', label: 'Snapshots' },
  { key: 'sales_event', label: 'Sales events' },
  { key: 'photo', label: 'Photos' },
  { key: 'notification', label: 'Notifications' },
]

const CAT_BADGE_CLASS = {
  import: 'al-badge--import',
  inventory: 'al-badge--inventory',
  user: 'al-badge--users',
  assignment: 'al-badge--tasks',
  transfer_outlet: 'al-badge--outlet-transfer',
  transfer_store: 'al-badge--store-transfer',
  shift: 'al-badge--shifts',
  sales_snapshot: 'al-badge--snapshots',
  sales_event: 'al-badge--sales-event',
  photo: 'al-badge--photos',
  notification: 'al-badge--notifications',
}

const CAT_BADGE_LABEL = {
  import: 'IMPORT',
  inventory: 'INVENTORY',
  user: 'USERS',
  assignment: 'TASKS',
  transfer_outlet: 'OUTLET TRANSFER',
  transfer_store: 'STORE TRANSFER',
  shift: 'SHIFTS',
  sales_snapshot: 'SNAPSHOTS',
  sales_event: 'SALES EVENT',
  photo: 'PHOTOS',
  notification: 'NOTIFICATIONS',
}

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

function actorKey(row) {
  return row.actorUserId || row.actorName || 'Unknown'
}

/** Consecutive same-actor events within 5s are treated as one user action. */
const BATCH_WINDOW_MS = 5000

function clusterFeedRows(rows) {
  const result = []
  let i = 0
  while (i < rows.length) {
    const start = rows[i]
    const cluster = [start]
    let j = i + 1
    while (j < rows.length) {
      const next = rows[j]
      if (actorKey(next) !== actorKey(start)) break
      const times = cluster.map((r) => new Date(r.createdAt).getTime()).filter((t) => !Number.isNaN(t))
      const nextTime = new Date(next.createdAt).getTime()
      if (Number.isNaN(nextTime)) break
      const minT = Math.min(...times, nextTime)
      const maxT = Math.max(...times, nextTime)
      if (maxT - minT > BATCH_WINDOW_MS) break
      cluster.push(next)
      j++
    }
    if (cluster.length >= 2) {
      result.push({ type: 'batch', rows: cluster, key: cluster.map((r) => r.id).join('-') })
    } else {
      result.push({ type: 'single', row: start })
    }
    i = j
  }
  return result
}

function inferBatchLabel(rows) {
  const categories = new Set(rows.map((r) => r.category))
  const actions = new Set(rows.map((r) => r.action))

  if (
    categories.has('import')
    || (categories.has('inventory') && actions.has('csv_archived'))
    || (categories.has('sales_event') && actions.has('imported'))
  ) {
    if (
      categories.has('import')
      || actions.has('csv_archived')
      || (categories.has('sales_event') && actions.has('imported'))
    ) {
      return 'Import batch'
    }
  }

  if (categories.size === 1) {
    const cat = [...categories][0]
    const label = CATEGORIES.find((c) => c.key === cat)?.label
    if (label) return `${label} batch`
  }

  if (categories.has('transfer_store') || categories.has('transfer_outlet')) {
    return 'Transfer batch'
  }

  return 'Action batch'
}

function truncateText(text, max = 48) {
  const s = String(text || '').trim()
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

function batchItemSummary(row) {
  const summary = String(row.summary || '').trim()
  if (!summary) return ''

  const withoutUuid = summary.replace(new RegExp(UUID_RE.source, 'gi'), '').replace(/\s+/g, ' ').trim()
  if (row.action === 'csv_archived') {
    return truncateText(withoutUuid.replace(/^Archived source CSV for import\s*/i, ''))
  }
  if (row.action === 'imported' && row.category === 'sales_event') {
    const match = summary.match(/(\d+)\s*rows?/i)
    return match ? `${match[1]} row${match[1] === '1' ? '' : 's'}` : truncateText(withoutUuid)
  }
  if (summary.includes(':')) {
    return truncateText(summary.split(':').slice(1).join(':').trim())
  }
  if (summary.includes('—')) {
    return truncateText(summary.split('—').pop().trim())
  }
  return truncateText(withoutUuid || summary)
}

function dateGroupLabel(iso) {
  if (!iso) return 'Unknown date'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return 'Unknown date'
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return 'Unknown date'
  }
}

function categoryBadgeClass(category) {
  return CAT_BADGE_CLASS[category] || 'al-badge--default'
}

function categoryBadgeLabel(category) {
  if (CAT_BADGE_LABEL[category]) return CAT_BADGE_LABEL[category]
  return String(category || '—').replace(/_/g, ' ').toUpperCase()
}

function parseSummaryParts(text) {
  if (!text) return [{ type: 'text', value: '—' }]
  const parts = []
  const re = new RegExp(UUID_RE.source, 'gi')
  let last = 0
  let match = re.exec(text)
  while (match) {
    if (match.index > last) {
      const chunk = text.slice(last, match.index).trim()
      if (chunk) parts.push({ type: 'text', value: chunk })
    }
    parts.push({ type: 'ref', value: match[0] })
    last = match.index + match[0].length
    match = re.exec(text)
  }
  const tail = text.slice(last).trim()
  if (tail) parts.push({ type: 'text', value: tail })
  if (parts.length === 0) parts.push({ type: 'text', value: text })
  return parts
}

function looksLikeReference(value) {
  if (!value) return false
  const re = new RegExp(UUID_RE.source, 'i')
  if (re.test(value)) return true
  return value.length > 48 && /[0-9a-f-]{20,}/i.test(value)
}

function ActivitySummary({ text }) {
  const [more, setMore] = useState(false)
  const parts = parseSummaryParts(text)
  const refText = parts.filter((p) => p.type === 'ref').map((p) => p.value).join(' ')
  const longRef = refText.length > 36 || parts.some((p) => p.type === 'ref' && p.value.length > 36)

  return (
    <div className="al-entry__summary">
      {parts.map((part, index) => {
        if (part.type === 'ref' || looksLikeReference(part.value)) {
          return (
            <span
              key={`${part.type}-${index}`}
              className={`al-entry__ref${!more && longRef ? ' al-entry__ref--clamp' : ''}`}
            >
              {part.value}
            </span>
          )
        }
        return (
          <span key={`${part.type}-${index}`} className="al-entry__text">
            {part.value}
          </span>
        )
      })}
      {longRef ? (
        <button
          type="button"
          className="al-entry__more"
          onClick={() => setMore((v) => !v)}
        >
          {more ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  )
}

function ActivityEntry({ row, expanded, onToggleExpand, variant = 'single' }) {
  const open = expanded.has(row.id)
  const hasMeta = row.meta && Object.keys(row.meta).length > 0
  const summarySnippet = batchItemSummary(row)

  if (variant === 'batch-child') {
    return (
      <li className="al-batch__item">
        <span className="al-batch__arrow" aria-hidden>↳</span>
        <div className="al-batch__item-main">
          <div className="al-batch__item-line">
            <span className={`al-badge ${categoryBadgeClass(row.category)}`}>
              {categoryBadgeLabel(row.category)}
            </span>
            {row.action ? (
              <span className="al-entry__action">{row.action}</span>
            ) : null}
            {summarySnippet ? (
              <span className="al-batch__item-summary"> — {summarySnippet}</span>
            ) : null}
          </div>
          {hasMeta ? (
            <button
              type="button"
              className="al-entry__details al-batch__details"
              onClick={() => onToggleExpand(row.id)}
            >
              {open ? 'Hide details' : 'Details →'}
            </button>
          ) : null}
          {open && row.meta ? (
            <pre className="al-entry__meta-json">
              {JSON.stringify(row.meta, null, 2)}
            </pre>
          ) : null}
        </div>
      </li>
    )
  }

  return (
    <article className="al-entry">
      <time className="al-entry__time" dateTime={row.createdAt}>
        {formatWhen(row.createdAt)}
      </time>
      <div className="al-entry__meta-row">
        <span className={`al-badge ${categoryBadgeClass(row.category)}`}>
          {categoryBadgeLabel(row.category)}
        </span>
        {row.action ? (
          <span className="al-entry__action">{row.action}</span>
        ) : null}
      </div>
      <ActivitySummary text={row.summary} />
      <div className="al-entry__footer">
        <span className="al-entry__actor">
          <IconManager size={12} strokeWidth={2} aria-hidden />
          {row.actorName || '—'}
        </span>
        {hasMeta ? (
          <button
            type="button"
            className="al-entry__details"
            onClick={() => onToggleExpand(row.id)}
          >
            {open ? 'Hide details' : 'Details →'}
          </button>
        ) : null}
      </div>
      {open && row.meta ? (
        <pre className="al-entry__meta-json">
          {JSON.stringify(row.meta, null, 2)}
        </pre>
      ) : null}
    </article>
  )
}

function ActivityBatch({ batch, expanded, onToggleExpand }) {
  const when = formatWhen(batch.rows[0]?.createdAt)
  const actorName = batch.rows[0]?.actorName || '—'
  const label = inferBatchLabel(batch.rows)

  return (
    <article className="al-batch">
      <header className="al-batch__header">
        <time className="al-batch__when" dateTime={batch.rows[0]?.createdAt}>
          {when}
        </time>
        <span className="al-batch__sep" aria-hidden>—</span>
        <span className="al-batch__actor">
          <IconManager size={12} strokeWidth={2} aria-hidden />
          {actorName}
        </span>
        <span className="al-batch__sep" aria-hidden>—</span>
        <span className="al-batch__label">
          {label} ({batch.rows.length} events)
        </span>
      </header>
      <ul className="al-batch__items">
        {batch.rows.map((row) => (
          <ActivityEntry
            key={row.id}
            row={row}
            expanded={expanded}
            onToggleExpand={onToggleExpand}
            variant="batch-child"
          />
        ))}
      </ul>
    </article>
  )
}

export function ActivityLog() {
  const [category, setCategory] = useState('')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const categoryRef = useRef(category)
  categoryRef.current = category

  const fetchSlice = useCallback(async (offset) => {
    const cat = categoryRef.current || undefined
    return fetchActivityLog({
      limit: PAGE_SIZE,
      offset,
      category: cat,
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setItems([])
    ;(async () => {
      try {
        const res = await fetchSlice(0)
        if (cancelled) return
        const next = res?.items ?? []
        setTotal(typeof res?.total === 'number' ? res.total : next.length)
        setItems(next)
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load activity log')
          setItems([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [category, fetchSlice])

  const loadMore = useCallback(async () => {
    if (loadingMore || items.length >= total) return
    setLoadingMore(true)
    setError(null)
    try {
      const res = await fetchSlice(items.length)
      const next = res?.items ?? []
      setItems((prev) => [...prev, ...next])
      if (typeof res?.total === 'number') setTotal(res.total)
    } catch (e) {
      setError(e?.message || 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }, [fetchSlice, items.length, loadingMore, total])

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const groupedItems = useMemo(() => {
    const groups = []
    let current = null
    for (const row of items) {
      const key = dateGroupLabel(row.createdAt)
      if (!current || current.key !== key) {
        current = { key, items: [] }
        groups.push(current)
      }
      current.items.push(row)
    }
    return groups.map((group) => ({
      ...group,
      feed: clusterFeedRows(group.items),
    }))
  }, [items])

  const hasMore = total > 0 && items.length < total

  return (
    <div className="activity-log-page">
      <div className="al-page-header">
        <p className="al-page-subtitle">
          Operational history with timestamps and users.
          <span className="al-exec-badge">Executives only</span>
        </p>
      </div>

      <div className="al-filters">
        {CATEGORIES.map((c) => (
          <button
            key={c.key || 'all'}
            type="button"
            className={`al-filter-chip${category === c.key ? ' al-filter-chip--active' : ''}`}
            onClick={() => setCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="al-error">{error}</div>
      )}

      <div className="activity-log-feed">
        {groupedItems.map((group) => (
          <section key={group.key} className="al-date-group">
            <h3 className="al-date-group__label">{group.key}</h3>
            {group.feed.map((block) => (
              block.type === 'batch' ? (
                <ActivityBatch
                  key={block.key}
                  batch={block}
                  expanded={expanded}
                  onToggleExpand={toggleExpand}
                />
              ) : (
                <ActivityEntry
                  key={block.row.id}
                  row={block.row}
                  expanded={expanded}
                  onToggleExpand={toggleExpand}
                />
              )
            ))}
          </section>
        ))}
      </div>

      {loading && items.length === 0 ? (
        <div className="al-empty">Loading…</div>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <div className="al-empty">No events yet.</div>
      ) : null}

      {hasMore && !loading ? (
        <button
          type="button"
          className="al-load-more"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading…' : `Load more (${items.length} / ${total})`}
        </button>
      ) : null}
    </div>
  )
}
