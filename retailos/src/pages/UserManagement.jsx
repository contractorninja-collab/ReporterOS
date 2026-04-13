import { useState } from 'react'
import useStore from '../store/useStore.js'
import { IconLock, IconManager, IconExecutive, IconPackage } from '../utils/icons.js'

const ROLE_OPTIONS = [
  { value: 'manager', label: 'Shop Manager' },
  { value: 'executive', label: 'Executive' },
  { value: 'outlet', label: 'Outlet' },
]
const SHOP_OPTIONS = ['Ring Mall', 'Village', 'Outlet']
const ROLE_COLORS = { manager: '#38bdf8', executive: '#c084fc', outlet: '#fbbf24' }

function generateUserCode(existingUsers) {
  const existing = new Set(existingUsers.map((u) => u.user_code).filter(Boolean))
  let code
  do {
    code = String(Math.floor(10000 + Math.random() * 90000))
  } while (existing.has(code))
  return code
}

const inputStyle = {
  background: 'var(--ro-surface-elevated)',
  border: '1px solid var(--ro-border-hover)',
  borderRadius: 8,
  padding: '8px 12px',
  color: 'var(--ro-text)',
  fontSize: 13,
  fontFamily: '"DM Sans"',
  outline: 'none',
  width: '100%',
}

export function UserManagement() {
  const users = useStore((s) => s.users)
  const addUser = useStore((s) => s.addUser)
  const removeUser = useStore((s) => s.removeUser)
  const updateUser = useStore((s) => s.updateUser)
  const activeUser = useStore((s) => s.activeUser)

  const [name, setName] = useState('')
  const [role, setRole] = useState('manager')
  const [shop, setShop] = useState('Ring Mall')
  const [pin, setPin] = useState('')
  const [userCode, setUserCode] = useState(() => generateUserCode(users))
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('manager')
  const [editShop, setEditShop] = useState('Ring Mall')
  const [editPin, setEditPin] = useState('')
  const [editUserCode, setEditUserCode] = useState('')

  const isExec = activeUser?.role === 'executive'

  const pinValid = (p) => /^\d{4}$/.test(p)

  const handleAdd = () => {
    const trimmed = name.trim()
    if (!trimmed || !pinValid(pin)) return
    addUser({ name: trimmed, role, shop: role === 'executive' ? null : shop, pin, user_code: userCode })
    setName('')
    setPin('')
    setUserCode(generateUserCode([...users, { user_code: userCode }]))
  }

  const handleRemove = (userId) => {
    removeUser(userId)
    setConfirmDelete(null)
  }

  const startEdit = (u) => {
    setEditingId(u.id)
    setEditName(u.name)
    setEditRole(u.role)
    setEditShop(u.shop || 'Ring Mall')
    setEditPin('')
    setEditUserCode(u.user_code || '')
    setConfirmDelete(null)
  }

  const saveEdit = () => {
    const trimmed = editName.trim()
    if (!trimmed || !editingId) return
    if (editPin.length > 0 && !pinValid(editPin)) return
    const payload = {
      name: trimmed,
      role: editRole,
      shop: editRole === 'executive' ? null : editShop,
      user_code: editUserCode,
    }
    if (pinValid(editPin)) payload.pin = editPin
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
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: '"DM Sans"', fontSize: 22, letterSpacing: '2px', color: 'var(--ro-heading)', margin: 0 }}>
          USER MANAGEMENT
        </h2>
        <p style={{ fontSize: 12, color: 'var(--ro-text-muted)', margin: '4px 0 0' }}>
          Add, edit, or remove system users.
        </p>
      </div>

      <div
        style={{
          background: 'var(--ro-surface)',
          border: '1px solid var(--ro-border)',
          borderRadius: 14,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ro-text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12 }}>
          Add New User
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'block', marginBottom: 4 }}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Full name"
              style={inputStyle}
            />
          </div>
          <div style={{ flex: '0 0 140px' }}>
            <label style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'block', marginBottom: 4 }}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          {role !== 'executive' && (
            <div style={{ flex: '0 0 120px' }}>
              <label style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'block', marginBottom: 4 }}>Shop</label>
              <select value={shop} onChange={(e) => setShop(e.target.value)} style={inputStyle}>
                {SHOP_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ flex: '0 0 90px' }}>
            <label style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'block', marginBottom: 4 }}>PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4 digits"
              style={inputStyle}
            />
          </div>
          <div style={{ flex: '0 0 130px' }}>
            <label style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'block', marginBottom: 4 }}>Login Code</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                value={userCode}
                readOnly
                style={{ ...inputStyle, fontFamily: '"DM Sans"', letterSpacing: '2px', fontWeight: 700, color: '#38bdf8', flex: 1 }}
              />
              <button
                type="button"
                onClick={() => setUserCode(generateUserCode(users))}
                title="Generate new code"
                style={{
                  padding: '0 8px',
                  borderRadius: 8,
                  border: '1px solid var(--ro-border-hover)',
                  background: 'none',
                  color: 'var(--ro-text-dim)',
                  cursor: 'pointer',
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                ↻
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!name.trim() || !pinValid(pin)}
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: name.trim() && pinValid(pin) ? 'pointer' : 'not-allowed',
              border: 'none',
              background: name.trim() && pinValid(pin) ? '#ff3333' : '#222',
              color: name.trim() && pinValid(pin) ? '#fff' : '#555',
              fontFamily: '"DM Sans"',
              whiteSpace: 'nowrap',
            }}
          >
            + Add User
          </button>
        </div>
      </div>

      <div
        style={{
          background: 'var(--ro-surface)',
          border: '1px solid var(--ro-border)',
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--ro-border)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ro-text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Registered Users ({users.length})
          </span>
        </div>
        {users.map((u) => {
          const accent = ROLE_COLORS[u.role] || '#64748b'
          const isSelf = activeUser?.id === u.id
          const isEditing = editingId === u.id

          if (isEditing) {
            return (
              <div
                key={u.id}
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--ro-border)',
                  background: 'var(--ro-table-row-hover)',
                }}
              >
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <label style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'block', marginBottom: 4 }}>Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                      style={inputStyle}
                      autoFocus
                    />
                  </div>
                  <div style={{ flex: '0 0 140px' }}>
                    <label style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'block', marginBottom: 4 }}>Role</label>
                    <select value={editRole} onChange={(e) => setEditRole(e.target.value)} style={inputStyle}>
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  {editRole !== 'executive' && (
                    <div style={{ flex: '0 0 120px' }}>
                      <label style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'block', marginBottom: 4 }}>Shop</label>
                      <select value={editShop} onChange={(e) => setEditShop(e.target.value)} style={inputStyle}>
                        {SHOP_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div style={{ flex: '0 0 120px' }}>
                    <label style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'block', marginBottom: 4 }}>New PIN</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={editPin}
                      onChange={(e) => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="Leave blank to keep"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: '0 0 130px' }}>
                    <label style={{ fontSize: 10, color: 'var(--ro-text-muted)', display: 'block', marginBottom: 4 }}>Login Code</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="text"
                        value={editUserCode}
                        readOnly
                        style={{ ...inputStyle, fontFamily: '"DM Sans"', letterSpacing: '2px', fontWeight: 700, color: '#38bdf8', flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={() => setEditUserCode(generateUserCode(users))}
                        title="Generate new code"
                        style={{
                          padding: '0 8px',
                          borderRadius: 8,
                          border: '1px solid var(--ro-border-hover)',
                          background: 'none',
                          color: 'var(--ro-text-dim)',
                          cursor: 'pointer',
                          fontSize: 14,
                          flexShrink: 0,
                        }}
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={!editName.trim() || (editPin.length > 0 && !pinValid(editPin))}
                    style={{
                      fontSize: 11,
                      padding: '6px 14px',
                      borderRadius: 6,
                      border: 'none',
                      background: '#00e676',
                      color: '#09090e',
                      cursor: 'pointer',
                      fontFamily: '"DM Sans"',
                      fontWeight: 700,
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    style={{
                      fontSize: 11,
                      padding: '6px 14px',
                      borderRadius: 6,
                      border: '1px solid var(--ro-border-hover)',
                      background: 'none',
                      color: 'var(--ro-text-dim)',
                      cursor: 'pointer',
                      fontFamily: '"DM Sans"',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )
          }

          return (
            <div
              key={u.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 20px',
                borderBottom: '1px solid var(--ro-border)',
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: accent + '1a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                {u.role === 'manager' ? (
                  <IconManager size={14} strokeWidth={1.5} />
                ) : u.role === 'executive' ? (
                  <IconExecutive size={14} strokeWidth={1.5} />
                ) : (
                  <IconPackage size={14} strokeWidth={1.5} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ro-text)' }}>
                  {u.name}
                  {isSelf && (
                    <span style={{ fontSize: 9, color: '#00e676', marginLeft: 6 }}>YOU</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 3, alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: accent + '1a',
                      color: accent,
                    }}
                  >
                    {ROLE_OPTIONS.find((r) => r.value === u.role)?.label || u.role}
                  </span>
                  {u.shop && <span style={{ fontSize: 10, color: 'var(--ro-text-muted)' }}>{u.shop}</span>}
                  {u.user_code && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#38bdf8', letterSpacing: '1px', fontFamily: '"DM Sans"' }}>
                      #{u.user_code}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => startEdit(u)}
                  style={{
                    fontSize: 11,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--ro-border)',
                    background: 'none',
                    color: 'var(--ro-text-dim)',
                    cursor: 'pointer',
                    fontFamily: '"DM Sans"',
                  }}
                >
                  Edit
                </button>
                {confirmDelete === u.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleRemove(u.id)}
                      style={{
                        fontSize: 11,
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: 'none',
                        background: '#ff3333',
                        color: '#fff',
                        cursor: 'pointer',
                        fontFamily: '"DM Sans"',
                        fontWeight: 600,
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      style={{
                        fontSize: 11,
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--ro-border-hover)',
                        background: 'none',
                        color: 'var(--ro-text-dim)',
                        cursor: 'pointer',
                        fontFamily: '"DM Sans"',
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(u.id)}
                    style={{
                      fontSize: 11,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--ro-border)',
                      background: 'none',
                      color: 'var(--ro-text-muted)',
                      cursor: 'pointer',
                      fontFamily: '"DM Sans"',
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {users.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--ro-text-muted)', fontSize: 13 }}>
            No users yet. Add one above.
          </div>
        )}
      </div>
    </div>
  )
}
