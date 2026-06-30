import { useMemo, useState, useEffect, useRef } from 'react'
import useStore from '../store/useStore.js'
import { IconLock, IconManager, IconPackage, IconPlus, IconDelete, IconView } from '../utils/icons.js'

const ROLE_OPTIONS = [
  { value: 'manager', label: 'Shop Manager' },
  { value: 'executive', label: 'Executive' },
  { value: 'outlet', label: 'Outlet' },
]
const SHOP_OPTIONS = ['Ring Mall', 'Village', 'Outlet']

function roleBadgeClass(role) {
  if (role === 'executive') return 'um-role-badge um-role-badge--executive'
  if (role === 'manager') return 'um-role-badge um-role-badge--manager'
  return 'um-role-badge um-role-badge--outlet'
}

function avatarClass(role) {
  if (role === 'executive') return 'um-user-avatar um-user-avatar--executive'
  if (role === 'manager') return 'um-user-avatar um-user-avatar--manager'
  return 'um-user-avatar um-user-avatar--outlet'
}

function nextPreviewUserCode(users) {
  const max = users.reduce((m, u) => {
    const n = Number(u.user_code)
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, 10000)
  return String(max + 1)
}

function PinDisplay({ userId, pin, revealedUserId, onToggleReveal }) {
  const isRevealed = revealedUserId === userId
  return (
    <span className={`um-user-row__pin${isRevealed ? ' um-user-row__pin--revealed' : ''}`}>
      New PIN {isRevealed ? pin : '••••'}
      <button
        type="button"
        className="um-pin-toggle"
        onClick={() => onToggleReveal(userId)}
        aria-label={isRevealed ? 'Hide PIN' : 'Show PIN'}
        title={isRevealed ? 'Hide PIN' : 'Show PIN'}
      >
        <IconView size={12} strokeWidth={1.75} />
      </button>
    </span>
  )
}

export function UserManagement() {
  const users = useStore((s) => s.users)
  const addUser = useStore((s) => s.addUser)
  const removeUser = useStore((s) => s.removeUser)
  const updateUser = useStore((s) => s.updateUser)
  const regenerateUserPin = useStore((s) => s.regenerateUserPin)
  const activeUser = useStore((s) => s.activeUser)

  const [name, setName] = useState('')
  const [role, setRole] = useState('manager')
  const [shop, setShop] = useState('Ring Mall')
  const [deleteConfirmUser, setDeleteConfirmUser] = useState(null)
  const [revealedPinUserId, setRevealedPinUserId] = useState(null)
  const pinRevealTimerRef = useRef(null)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('manager')
  const [editShop, setEditShop] = useState('Ring Mall')

  const isExec = activeUser?.role === 'executive'
  const previewUserCode = useMemo(() => nextPreviewUserCode(users), [users])

  const handleAdd = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    addUser({ name: trimmed, role, shop: role === 'executive' ? null : shop })
    setName('')
  }

  const handleRemove = (userId) => {
    removeUser(userId)
    setDeleteConfirmUser(null)
    if (revealedPinUserId === userId) {
      setRevealedPinUserId(null)
    }
  }

  const togglePinReveal = (userId) => {
    if (revealedPinUserId === userId) {
      setRevealedPinUserId(null)
      if (pinRevealTimerRef.current) clearTimeout(pinRevealTimerRef.current)
      return
    }
    setRevealedPinUserId(userId)
    if (pinRevealTimerRef.current) clearTimeout(pinRevealTimerRef.current)
    pinRevealTimerRef.current = setTimeout(() => setRevealedPinUserId(null), 5000)
  }

  useEffect(() => () => {
    if (pinRevealTimerRef.current) clearTimeout(pinRevealTimerRef.current)
  }, [])

  const startEdit = (u) => {
    setEditingId(u.id)
    setEditName(u.name)
    setEditRole(u.role)
    setEditShop(u.shop || 'Ring Mall')
    setDeleteConfirmUser(null)
  }

  const saveEdit = () => {
    const trimmed = editName.trim()
    if (!trimmed || !editingId) return
    const payload = {
      name: trimmed,
      role: editRole,
      shop: editRole === 'executive' ? null : editShop,
    }
    updateUser(editingId, payload)
    setEditingId(null)
  }

  if (!isExec) {
    return (
      <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>
          <IconLock size={48} strokeWidth={1.5} />
        </div>
        <h2 style={{ fontFamily: '"DM Sans"', fontSize: 22, letterSpacing: '2px', color: 'var(--ro-heading)', margin: '0 0 8px' }}>
          EXECUTIVE ACCESS ONLY
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ro-text-muted)' }}>
          Only users with the Executive role can manage users. You are signed in as <strong style={{ color: 'var(--ro-text)' }}>{activeUser?.name}</strong>.
        </p>
      </div>
    )
  }

  return (
    <div className="user-management-page">
      <p className="um-page-subtitle page-hero-mobile-hide">
        Add, edit, or remove system users.
      </p>

      <div className="um-add-panel">
        <div className="um-add-panel__title">Add new user</div>
        <div className="user-form-grid um-form-grid">
          <div className="um-field">
            <label className="um-label">Name</label>
            <input
              type="text"
              className="um-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Full name"
            />
          </div>
          <div className="um-field um-field--role">
            <label className="um-label">Role</label>
            <select className="um-select" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          {role !== 'executive' && (
            <div className="um-field um-field--shop">
              <label className="um-label">Shop</label>
              <select className="um-select" value={shop} onChange={(e) => setShop(e.target.value)}>
                {SHOP_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div className="um-field um-field--code">
            <label className="um-label">Next Login Code</label>
            <div className="um-code-preview">{previewUserCode}</div>
          </div>
          <div className="um-pin-helper">
            PIN is generated automatically and appears in the user list after creation.
          </div>
          <button
            type="button"
            className={`um-add-btn${name.trim() ? ' um-add-btn--active' : ''}`}
            onClick={handleAdd}
            disabled={!name.trim()}
          >
            <IconPlus size={14} strokeWidth={2} className="um-add-btn__icon" />
            Add User
          </button>
        </div>
      </div>

      <div className="um-users-section">
        <div className="um-users-section__title">Registered users ({users.length})</div>
        <div className="um-user-list">
        {users.map((u) => {
          const isSelf = activeUser?.id === u.id
          const isEditing = editingId === u.id

          if (isEditing) {
            return (
              <div key={u.id} className="um-user-row um-user-row--editing">
                <div className="um-edit-form">
                  <div className="user-form-grid um-form-grid um-form-grid--inline">
                    <div className="um-field">
                      <label className="um-label">Name</label>
                      <input
                        type="text"
                        className="um-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                        autoFocus
                      />
                    </div>
                    <div className="um-field um-field--role">
                      <label className="um-label">Role</label>
                      <select className="um-select" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    {editRole !== 'executive' && (
                      <div className="um-field um-field--shop">
                        <label className="um-label">Shop</label>
                        <select className="um-select" value={editShop} onChange={(e) => setEditShop(e.target.value)}>
                          {SHOP_OPTIONS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="um-field um-field--code">
                      <label className="um-label">Login Code</label>
                      <div className="um-code-preview um-code-preview--readonly">{u.user_code || '—'}</div>
                    </div>
                    <div className="um-field um-field--pin">
                      <label className="um-label">PIN</label>
                      {u.one_time_pin ? (
                        <PinDisplay
                          userId={u.id}
                          pin={u.one_time_pin}
                          revealedUserId={revealedPinUserId}
                          onToggleReveal={togglePinReveal}
                        />
                      ) : (
                        <div className="um-code-preview um-code-preview--readonly">Reset to show once</div>
                      )}
                    </div>
                  </div>
                  <div className="um-user-actions user-action-row">
                    <button
                      type="button"
                      className={`um-btn um-btn--save${editName.trim() ? ' um-btn--save-active' : ''}`}
                      onClick={saveEdit}
                      disabled={!editName.trim()}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="um-btn um-btn--new-pin"
                      onClick={() => regenerateUserPin(u.id)}
                    >
                      Generate New PIN
                    </button>
                    <button
                      type="button"
                      className="um-btn um-btn--edit"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div key={u.id} className="um-user-row user-list-row">
              <div className={avatarClass(u.role)}>
                {u.role === 'outlet' ? (
                  <IconPackage size={14} strokeWidth={1.5} />
                ) : (
                  <IconManager size={14} strokeWidth={1.5} />
                )}
              </div>
              <div className="um-user-row__info">
                <div className="um-user-row__name-line">
                  <span className="um-user-row__name">{u.name}</span>
                  {isSelf && <span className="um-you-badge">YOU</span>}
                </div>
                <div className="um-user-row__meta">
                  <span className={roleBadgeClass(u.role)}>
                    {ROLE_OPTIONS.find((r) => r.value === u.role)?.label || u.role}
                  </span>
                  {u.shop && <span className="um-user-row__shop">{u.shop}</span>}
                  {u.user_code && (
                    <span className="um-user-row__id">ID #{u.user_code}</span>
                  )}
                  {u.one_time_pin && (
                    <PinDisplay
                      userId={u.id}
                      pin={u.one_time_pin}
                      revealedUserId={revealedPinUserId}
                      onToggleReveal={togglePinReveal}
                    />
                  )}
                </div>
              </div>
              <div className="um-user-actions user-action-row">
                <button
                  type="button"
                  className="um-btn um-btn--new-pin"
                  onClick={() => regenerateUserPin(u.id)}
                >
                  New PIN
                </button>
                <button
                  type="button"
                  className="um-btn um-btn--edit"
                  onClick={() => startEdit(u)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="um-btn um-btn--remove"
                  onClick={() => setDeleteConfirmUser(u)}
                  aria-label={`Remove ${u.name}`}
                  title={`Remove ${u.name}`}
                >
                  <IconDelete size={14} strokeWidth={1.75} />
                </button>
              </div>
            </div>
          )
        })}
        {users.length === 0 && (
          <div className="um-empty">No users yet. Add one above.</div>
        )}
        </div>
      </div>

      {deleteConfirmUser && (
        <div
          className="um-delete-modal-backdrop"
          role="presentation"
          onClick={() => setDeleteConfirmUser(null)}
        >
          <div
            className="um-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="um-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="um-delete-modal__title" id="um-delete-title">
              Remove {deleteConfirmUser.name}?
            </div>
            <p className="um-delete-modal__body">
              They will lose access immediately. This cannot be undone.
            </p>
            <div className="um-delete-modal__actions">
              <button
                type="button"
                className="um-delete-modal__btn um-delete-modal__btn--ghost"
                onClick={() => setDeleteConfirmUser(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="um-delete-modal__btn um-delete-modal__btn--danger"
                onClick={() => handleRemove(deleteConfirmUser.id)}
              >
                Remove user
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
