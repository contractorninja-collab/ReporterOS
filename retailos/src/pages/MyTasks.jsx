import { useMemo, useState } from 'react'
import useStore from '../store/useStore.js'
import { IconPlanning } from '../utils/icons.js'

const STATUS_LABEL = {
  pending: 'Pending',
  in_progress: 'In Progress',
  done: 'Done',
}

const EMPTY_HINT = {
  all: 'You have no assigned tasks.',
  pending: 'No pending tasks.',
  in_progress: 'Nothing in progress.',
  done: 'No completed tasks yet.',
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
]

function formatTaskType(type) {
  return String(type || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function priorityBadgeClass(priority) {
  const p = String(priority || '').toLowerCase()
  if (p === 'high') return 'mt-task-badge--priority-high'
  if (p === 'medium') return 'mt-task-badge--priority-medium'
  return 'mt-task-badge--priority-low'
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

  const taskDescription = (task) => {
    if (task.note) return task.note
    const action = formatTaskType(task.type)
    return task.shop ? `${action} — ${task.shop}` : action
  }

  return (
    <div className="my-tasks-page">
      <div className="mt-page-header">
        <p className="mt-page-subtitle">
          Assignments for {activeUser?.name || 'you'}. Mark them as you work.
        </p>
      </div>

      <div className="mt-task-tabs">
        {TABS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`mt-task-tab${filter === f.key ? ' is-active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            <span className="mt-task-tab__label">{f.label}</span>
            <span className="mt-task-tab__count"> ({counts[f.key]})</span>
          </button>
        ))}
      </div>

      <div className="mt-task-panel">
        {myTasks.length === 0 ? (
          <div className="mt-task-empty">
            <IconPlanning className="mt-task-empty__icon" size={36} strokeWidth={1.5} aria-hidden />
            <p className="mt-task-empty__title">No tasks yet</p>
            <p className="mt-task-empty__hint">{EMPTY_HINT[filter] || EMPTY_HINT.all}</p>
          </div>
        ) : (
          <div className="mt-task-list">
            {myTasks.map((t) => {
              const status = t.status || 'pending'
              const ns = nextStatus(status)
              const isDone = status === 'done'
              return (
                <article
                  key={t.id}
                  className={`mt-task-card mt-task-card--${status}${isDone ? ' mt-task-card--completed' : ''}`}
                >
                  <div className="mt-task-card__body">
                    <div className="mt-task-card__head">
                      <h3 className="mt-task-card__title">{t.productName}</h3>
                      <span className={`mt-task-badge mt-task-badge--status mt-task-badge--status-${status}`}>
                        {STATUS_LABEL[status] || STATUS_LABEL.pending}
                      </span>
                    </div>
                    <p className="mt-task-card__desc">{taskDescription(t)}</p>
                    {t.skuCode ? (
                      <p className="mt-task-card__sku">{t.skuCode}</p>
                    ) : null}
                    <div className="mt-task-card__meta">
                      <span>Assigned by {getUserName(t.assignedBy)}</span>
                      {t.dueDate ? (
                        <span>
                          Due{' '}
                          {new Date(t.dueDate).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      ) : null}
                      {t.priority ? (
                        <span className={`mt-task-badge ${priorityBadgeClass(t.priority)}`}>
                          {String(t.priority).charAt(0).toUpperCase() + String(t.priority).slice(1)}
                        </span>
                      ) : null}
                    </div>
                    {t.completedAt ? (
                      <p className="mt-task-card__completed">
                        {t.completedBy ? `Completed by ${getUserName(t.completedBy)} · ` : 'Completed '}
                        {new Date(t.completedAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-task-card__actions">
                    {ns ? (
                      <button
                        type="button"
                        className={ns === 'done' ? 'mt-task-card__done-btn' : 'mt-task-card__start-btn'}
                        onClick={() => handleAdvance(t)}
                      >
                        {ns === 'done' ? 'Mark as done' : 'Start'}
                      </button>
                    ) : null}
                    <button type="button" className="mt-task-card__details">
                      View details
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
