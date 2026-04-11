import { useMemo, useState } from 'react'
import useStore from '../store/useStore.js'

const STATUS_CFG = {
  pending: { label: 'Pending', color: '#ff8800', bg: 'rgba(255,136,0,0.10)' },
  in_progress: { label: 'In Progress', color: '#38bdf8', bg: 'rgba(56,189,248,0.10)' },
  done: { label: 'Done', color: '#00e676', bg: 'rgba(0,230,118,0.10)' },
}
const TYPE_ICONS = {
  sale: '',
  markdown: '',
  reorder: '',
  display_move: '',
  outlet_move: '',
  photo_needed: '',
  store_transfer: '',
  alert_action: '',
}

export function MyTasks() {
  const assignments = useStore((s) => s.assignments)
  const activeUser = useStore((s) => s.activeUser)
  const users = useStore((s) => s.users)
  const updateAssignment = useStore((s) => s.updateAssignment)
  const [filter, setFilter] = useState('all')

  const myTasks = useMemo(() => {
    let list = activeUser
      ? assignments.filter((a) => a.assignedTo === activeUser.id)
      : assignments
    if (filter !== 'all') list = list.filter((a) => a.status === filter)
    return list
  }, [assignments, activeUser, filter])

  const counts = useMemo(() => {
    const base = activeUser
      ? assignments.filter((a) => a.assignedTo === activeUser.id)
      : assignments
    return {
      all: base.length,
      pending: base.filter((a) => a.status === 'pending').length,
      in_progress: base.filter((a) => a.status === 'in_progress').length,
      done: base.filter((a) => a.status === 'done').length,
    }
  }, [assignments, activeUser])

  const getUserName = (id) => users.find((u) => u.id === id)?.name || id

  const nextStatus = (current) => {
    if (current === 'pending') return 'in_progress'
    if (current === 'in_progress') return 'done'
    return null
  }

  const handleAdvance = (task) => {
    const ns = nextStatus(task.status)
    if (!ns) return
    const changes = { status: ns }
    if (ns === 'done') changes.completedAt = new Date().toISOString()
    updateAssignment(task.id, changes)
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: '"DM Sans"', fontSize: 22, letterSpacing: '2px', color: '#fff', margin: 0 }}>
          MY TASKS
        </h2>
        <p style={{ fontSize: 12, color: '#4a4a62', margin: '4px 0 0' }}>
          Assignments for {activeUser?.name || 'you'}. Mark them as you work.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: 'All' },
          { key: 'pending', label: 'Pending' },
          { key: 'in_progress', label: 'In Progress' },
          { key: 'done', label: 'Done' },
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: '"DM Sans"',
              border: filter === f.key ? '1px solid rgba(255,51,51,0.25)' : '1px solid rgba(255,255,255,0.055)',
              background: filter === f.key ? 'rgba(255,51,51,0.1)' : '#17171f',
              color: filter === f.key ? '#ff3333' : '#9090aa',
            }}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
      </div>

      {myTasks.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: 48,
            background: '#111117',
            border: '1px solid rgba(255,255,255,0.055)',
            borderRadius: 14,
            color: '#4a4a62',
            fontSize: 14,
          }}
        >
          No tasks{filter !== 'all' ? ` with status "${STATUS_CFG[filter]?.label || filter}"` : ''}.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {myTasks.map((t) => {
          const cfg = STATUS_CFG[t.status] || STATUS_CFG.pending
          const ns = nextStatus(t.status)
          const nsCfg = ns ? STATUS_CFG[ns] : null
          return (
            <div
              key={t.id}
              style={{
                background: '#111117',
                border: '1px solid rgba(255,255,255,0.055)',
                borderRadius: 14,
                padding: '16px 18px',
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
              }}
            >
              <div style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>
                {TYPE_ICONS[t.type] || ''}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#e4e4f0' }}>
                    {t.productName}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: cfg.bg,
                      color: cfg.color,
                    }}
                  >
                    {cfg.label}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#4a4a62', fontFamily: '"DM Sans"', marginBottom: 4 }}>
                  {t.skuCode}
                </div>
                <div style={{ fontSize: 11, color: '#9090aa', marginBottom: 2 }}>
                  <strong style={{ color: '#e4e4f0' }}>Action:</strong>{' '}
                  {t.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  {t.shop ? ` — ${t.shop}` : ''}
                </div>
                {t.note && (
                  <div style={{ fontSize: 11, color: '#9090aa', fontStyle: 'italic' }}>
                    &quot;{t.note}&quot;
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#4a4a62', marginTop: 4 }}>
                  Assigned by {getUserName(t.assignedBy)} — {new Date(t.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  {t.completedAt && (
                    <span style={{ color: '#00e676', marginLeft: 8 }}>
                      Completed {new Date(t.completedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </span>
                  )}
                </div>
              </div>
              {nsCfg && (
                <button
                  type="button"
                  onClick={() => handleAdvance(t)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: 'none',
                    background: nsCfg.bg,
                    color: nsCfg.color,
                    fontFamily: '"DM Sans"',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {ns === 'in_progress' ? 'Start' : 'Done'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
