import { useMemo, useState, useEffect } from 'react'
import useStore from '../store/useStore.js'
import { isExecutive } from '../utils/roles.js'
import { ALERT_ASSIGN_SHOPS, getAssignableUsersForAlertShop, defaultAlertShopForUser } from '../utils/alertAssignees.js'

const DM = '"DM Sans", sans-serif'
const S = {
  overlay: 'rgba(0,0,0,0.65)',
  surface: 'var(--ro-surface)',
  border: 'var(--ro-border-hover)',
  text: 'var(--ro-text)',
  muted: 'var(--ro-text-muted)',
  accent: '#ff3333',
  blue: '#38bdf8',
}

export function AlertAssignModal({ alert, onClose, onConfirm }) {
  const users = useStore((s) => s.users)
  const activeShifts = useStore((s) => s.activeShifts)
  const activeUser = useStore((s) => s.activeUser)

  const isExec = isExecutive(activeUser)
  const initialShop = defaultAlertShopForUser(activeUser)

  const [shop, setShop] = useState(initialShop)
  const [showAllUsers, setShowAllUsers] = useState(false)
  const [assigneeId, setAssigneeId] = useState('')

  useEffect(() => {
    setShop(initialShop)
    setShowAllUsers(false)
    setAssigneeId('')
  }, [alert, initialShop])

  const assignable = useMemo(
    () => getAssignableUsersForAlertShop(users, activeShifts, shop, { showAllUsers, isExecutive: isExec }),
    [users, activeShifts, shop, showAllUsers, isExec],
  )

  useEffect(() => {
    if (assignable.length && !assignable.some((u) => u.id === assigneeId)) {
      setAssigneeId(assignable[0].id)
    }
    if (!assignable.length) setAssigneeId('')
  }, [assignable, assigneeId])

  if (!alert) return null

  const handleConfirm = () => {
    if (!assigneeId) return
    const u = users.find((x) => x.id === assigneeId)
    onConfirm({ userId: assigneeId, shop: u?.shop || shop })
  }

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: S.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(400px, 100%)',
          background: S.surface,
          border: `1px solid ${S.border}`,
          borderRadius: 14,
          padding: '20px 22px',
          fontFamily: DM,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: S.text, marginBottom: 6 }}>
          Assign alert
        </div>
        <div style={{ fontSize: 11, color: S.muted, marginBottom: 16, lineHeight: 1.4 }}>
          {alert.productName} — {alert.skuCode}
        </div>

        {isExec && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
              Shop
            </label>
            <select
              value={shop}
              onChange={(e) => setShop(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--ro-surface-elevated)',
                border: `1px solid ${S.border}`,
                borderRadius: 8,
                padding: '8px 10px',
                color: S.text,
                fontSize: 12,
                fontFamily: DM,
              }}
            >
              {ALERT_ASSIGN_SHOPS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        {isExec && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11, color: S.text, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAllUsers} onChange={(e) => setShowAllUsers(e.target.checked)} style={{ accentColor: S.blue }} />
            Show all users (override shift)
          </label>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
            Assign to
          </label>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--ro-surface-elevated)',
              border: `1px solid ${S.border}`,
              borderRadius: 8,
              padding: '8px 10px',
              color: S.text,
              fontSize: 12,
              fontFamily: DM,
            }}
          >
            {assignable.length === 0 ? (
              <option value="">No one on shift</option>
            ) : (
              assignable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.shop ? ` · ${u.shop}` : ''}
                </option>
              ))
            )}
          </select>
          {assignable.length === 0 && !showAllUsers && isExec && (
            <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 6 }}>
              Enable &quot;Show all users&quot; or wait until staff clock in.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: `1px solid ${S.border}`,
              background: 'transparent',
              color: S.muted,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: DM,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!assigneeId}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: assigneeId ? S.accent : '#333',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: assigneeId ? 'pointer' : 'not-allowed',
              fontFamily: DM,
            }}
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  )
}
