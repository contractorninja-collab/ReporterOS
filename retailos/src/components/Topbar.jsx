import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, PackageCheck, AlertTriangle, CheckCircle, Truck, Clock, LogIn, LogOut, UserCheck, Sun, Moon } from 'lucide-react'
import { IconSearch } from '../utils/icons.js'
import useStore from '../store/useStore.js'
import { isExecutive } from '../utils/roles.js'
import { applyThemeToDocument, readStoredTheme } from '../themeStorage.js'

const ROLE_COLORS = { manager: '#38bdf8', executive: '#c084fc', outlet: '#fbbf24' }

const NOTIF_ICONS = {
  transfer_created: Truck,
  transfer_received: PackageCheck,
  transfer_completed: CheckCircle,
  transfer_missing_items: AlertTriangle,
  shift_clock_in: LogIn,
  shift_clock_out: LogOut,
  alert_assigned: UserCheck,
}
const NOTIF_COLORS = {
  transfer_created: '#c084fc',
  transfer_received: '#38bdf8',
  transfer_completed: '#00e676',
  transfer_missing_items: '#fbbf24',
  shift_clock_in: '#00e676',
  shift_clock_out: 'var(--ro-text-dim)',
  alert_assigned: '#ff3333',
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function useVisibleNotifications() {
  const notifications = useStore((s) => s.notifications)
  const activeUser = useStore((s) => s.activeUser)
  const isExec = activeUser?.role === 'executive'
  const uid = activeUser?.id
  if (isExec) return notifications
  return notifications.filter((n) => {
    if (n.userId === 'executives') return false
    if (
      n.type === 'alert_assigned' &&
      n.userId &&
      n.userId !== 'all' &&
      uid &&
      n.userId !== uid
    ) {
      return false
    }
    return true
  })
}

function NotificationDropdown({ onClose }) {
  const notifications = useVisibleNotifications()
  const markNotificationRead = useStore((s) => s.markNotificationRead)
  const markAllNotificationsRead = useStore((s) => s.markAllNotificationsRead)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: '100%', right: 0, marginTop: 8,
        width: 340, maxHeight: 420, overflowY: 'auto',
        background: 'var(--ro-surface-elevated)', border: '1px solid var(--ro-border-hover)',
        borderRadius: 12, boxShadow: 'var(--ro-dropdown-shadow)',
        zIndex: 1000,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid var(--ro-border)',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ro-text)', fontFamily: '"DM Sans"' }}>Notifications</span>
        <button
          type="button"
          onClick={() => markAllNotificationsRead()}
          style={{
            background: 'none', border: 'none', fontSize: 10, color: '#38bdf8',
            cursor: 'pointer', fontFamily: '"DM Sans"', fontWeight: 600,
          }}
        >
          Mark all as read
        </button>
      </div>
      {notifications.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--ro-text-muted)', fontSize: 12 }}>No notifications</div>
      ) : (
        notifications.slice(0, 50).map((n) => {
          const Icon = NOTIF_ICONS[n.type] || Bell
          const iconColor = NOTIF_COLORS[n.type] || 'var(--ro-text-dim)'
          return (
            <div
              key={n.id}
              onClick={() => { if (!n.read) markNotificationRead(n.id) }}
              style={{
                display: 'flex', gap: 10, padding: '10px 16px', cursor: 'pointer',
                borderBottom: '1px solid var(--ro-border)',
                background: n.read ? 'transparent' : 'rgba(56,189,248,0.04)',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ flexShrink: 0, marginTop: 2 }}>
                <Icon size={16} style={{ color: iconColor }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ro-text)', marginBottom: 2 }}>
                  {n.title}
                  {!n.read && (
                    <span style={{
                      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                      background: '#38bdf8', marginLeft: 6, verticalAlign: 'middle',
                    }} />
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--ro-text-dim)', lineHeight: 1.4 }}>{n.message}</div>
                <div style={{ fontSize: 9, color: 'var(--ro-text-muted)', marginTop: 3 }}>{timeAgo(n.createdAt)}</div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const visible = useVisibleNotifications()
  const unreadCount = visible.filter((n) => !n.read).length
  const prevCount = useRef(unreadCount)
  const [ringing, setRinging] = useState(false)

  useEffect(() => {
    if (unreadCount > prevCount.current) {
      setRinging(true)
      const t = setTimeout(() => setRinging(false), 1200)
      return () => clearTimeout(t)
    }
    prevCount.current = unreadCount
  }, [unreadCount])

  useEffect(() => {
    prevCount.current = unreadCount
  }, [unreadCount])

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={ringing ? 'bell-ring' : ''}
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 34, borderRadius: 8, border: '1px solid var(--ro-border)',
          background: open ? 'rgba(56,189,248,0.08)' : 'var(--ro-surface-elevated)',
          cursor: 'pointer', padding: 0, transformOrigin: 'top center',
        }}
      >
        <Bell size={16} style={{ color: unreadCount > 0 ? '#38bdf8' : 'var(--ro-text-dim)' }} />
        {unreadCount > 0 && (
          <span className={ringing ? 'badge-pop' : ''} style={{
            position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16,
            borderRadius: 8, background: '#ff3333', color: '#fff',
            fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px', fontFamily: '"DM Sans"',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && <NotificationDropdown onClose={() => setOpen(false)} />}
    </div>
  )
}

function formatElapsed(clockInIso) {
  const ms = Math.max(0, Date.now() - new Date(clockInIso).getTime())
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`
}

function ThemeToggle() {
  const [light, setLight] = useState(() => readStoredTheme() === 'light')
  return (
    <button
      type="button"
      className="topbar-theme-toggle"
      onClick={() => {
        const next = light ? 'dark' : 'light'
        applyThemeToDocument(next)
        setLight(next === 'light')
      }}
      aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 34,
        height: 30,
        padding: 0,
        borderRadius: 8,
        border: '1px solid var(--ro-border-hover)',
        background: 'var(--ro-surface-elevated)',
        color: 'var(--ro-text-dim)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {light ? <Moon size={16} strokeWidth={1.5} /> : <Sun size={16} strokeWidth={1.5} />}
    </button>
  )
}

function ShiftButton() {
  const activeUser = useStore((s) => s.activeUser)
  const myShift = useStore((s) => s.myShift)
  const doClockIn = useStore((s) => s.clockIn)
  const doClockOut = useStore((s) => s.clockOut)
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    if (!myShift?.clock_in) { setElapsed(''); return }
    setElapsed(formatElapsed(myShift.clock_in))
    const iv = setInterval(() => setElapsed(formatElapsed(myShift.clock_in)), 1000)
    return () => clearInterval(iv)
  }, [myShift])

  if (!activeUser || activeUser.role === 'executive') return null

  const onShift = !!myShift

  const handleClick = () => {
    if (onShift) {
      if (window.confirm('End your shift?')) doClockOut()
    } else {
      doClockIn()
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 8,
        border: onShift ? '1px solid rgba(0,230,118,0.25)' : '1px solid var(--ro-border)',
        background: onShift ? 'rgba(0,230,118,0.08)' : 'var(--ro-surface-elevated)',
        color: onShift ? '#00e676' : 'var(--ro-text-dim)',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: '"DM Sans"',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}
    >
      <Clock size={13} strokeWidth={1.5} />
      {onShift ? (
        <>
          <span style={{ fontSize: 10 }}>On Shift</span>
          <span style={{
            fontSize: 10, fontWeight: 700, color: 'var(--ro-heading)',
            background: 'rgba(0,230,118,0.2)', padding: '1px 6px', borderRadius: 4,
          }}>
            {elapsed}
          </span>
        </>
      ) : (
        <span>Clock In</span>
      )}
    </button>
  )
}

export function Topbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const activeSeason = useStore((s) => s.activeSeason)
  const setActiveSeason = useStore((s) => s.setActiveSeason)
  const activeUser = useStore((s) => s.activeUser)
  const setActiveUser = useStore((s) => s.setActiveUser)
  const execUser = isExecutive(activeUser)

  const titleMap = {
    '/': { title: 'DASHBOARD', crumb: 'RetailOS / Overview / Dashboard' },
    '/smart-alerts': { title: 'SMART ALERTS', crumb: 'RetailOS / Overview / Smart Alerts' },
    '/lifecycle': { title: 'SKU LIFECYCLE', crumb: 'RetailOS / Overview / Lifecycle' },
    '/bestsellers': { title: 'BESTSELLERS', crumb: 'RetailOS / Overview / Bestsellers' },
    '/strategy': { title: 'ROTATION STRATEGY', crumb: 'RetailOS / Overview / Strategy' },
    '/reports': { title: 'REPORTS', crumb: 'RetailOS / Data / Reports' },
    '/lookup': { title: 'PRODUCT LOOKUP', crumb: 'RetailOS / Data / Product lookup' },
    '/buy-planning': { title: 'BUY PLANNING', crumb: 'RetailOS / Data / Buy Planning' },
    '/import': { title: 'IMPORT CSV', crumb: 'RetailOS / Data / Import' },
    '/photos': { title: 'PRODUCT PHOTOS', crumb: 'RetailOS / Data / Photos' },
    '/catalog/footwear': { title: 'FOOTWEAR CATALOG', crumb: 'RetailOS / Catalog / Footwear' },
    '/catalog/apparel': { title: 'APPAREL CATALOG', crumb: 'RetailOS / Catalog / Apparel' },
    '/catalog/accessories': { title: 'ACCESSORIES', crumb: 'RetailOS / Catalog / Accessories' },
    '/tasks': { title: 'MY TASKS', crumb: 'RetailOS / Workflow / My Tasks' },
    '/new-transfer': { title: 'NEW TRANSFER', crumb: 'RetailOS / Workflow / New Transfer' },
    '/outlet': { title: 'OUTLET TRANSFERS', crumb: 'RetailOS / Workflow / Outlet Transfers' },
    '/transfers': { title: 'STORE TRANSFERS', crumb: 'RetailOS / Workflow / Store Transfers' },
    '/users': { title: 'USER MANAGEMENT', crumb: 'RetailOS / Workflow / Users' },
    '/shift-board': { title: 'SHIFT BOARD', crumb: 'RetailOS / Workflow / Shift Board' },
  }
  const current = titleMap[location.pathname] || { title: 'RETAILOS', crumb: 'RetailOS' }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <div style={{ fontFamily: '"DM Sans"', fontSize: '19px', letterSpacing: '2px', color: 'var(--ro-heading)', whiteSpace: 'nowrap' }}>
          {current.title}
        </div>
        <div className="topbar-crumb" style={{ fontSize: '11px', color: 'var(--ro-text-muted)' }}>{current.crumb}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {execUser && (
          <div
            className="topbar-desktop-only"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              background: 'var(--ro-surface-elevated)',
              border: '1px solid var(--ro-border)',
              borderRadius: '8px',
              padding: '6px 11px',
              width: '210px',
            }}
          >
            <span style={{ color: 'var(--ro-text-muted)', fontSize: '13px' }}>
              <IconSearch size={13} strokeWidth={1.5} />
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const q = searchInput.trim()
                const path = q ? `/lookup?q=${encodeURIComponent(q)}` : '/lookup'
                navigate(path)
              }}
              placeholder="Search SKU, product, barcode…"
              style={{
                background: 'none',
                border: 'none',
                outline: 'none',
                color: 'var(--ro-text)',
                fontSize: '12px',
                fontFamily: '"DM Sans"',
                width: '100%',
              }}
            />
          </div>
        )}

        {['SS26', 'FW26', 'All'].map((s) => (
          <div
            key={s}
            className="topbar-desktop-only"
            onClick={() => setActiveSeason(s)}
            style={{
              padding: '5px 11px',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.13s',
              background: activeSeason === s ? 'rgba(255,51,51,0.1)' : 'var(--ro-surface-elevated)',
              border:
                activeSeason === s
                  ? '1px solid rgba(255,51,51,0.25)'
                  : '1px solid var(--ro-border)',
              color: activeSeason === s ? '#ff3333' : 'var(--ro-text-muted)',
            }}
          >
            {s}
          </div>
        ))}

        <ThemeToggle />
        <ShiftButton />
        <NotificationBell />

        {activeUser && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--ro-surface-elevated)',
              border: '1px solid var(--ro-border)',
              borderRadius: 8,
              padding: '5px 10px',
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: ROLE_COLORS[activeUser.role] || 'var(--ro-text-dim)',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--ro-text)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {activeUser.name}
            </span>
            <button
              type="button"
              onClick={() => setActiveUser(null)}
              style={{
                fontSize: 10,
                color: 'var(--ro-text-muted)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: '"DM Sans"',
                padding: '2px 4px',
                whiteSpace: 'nowrap',
              }}
            >
              Switch
            </button>
          </div>
        )}

        <button
          type="button"
          className="topbar-desktop-only"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 13px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid var(--ro-border)',
            background: 'var(--ro-surface-elevated)',
            color: 'var(--ro-text-dim)',
            fontFamily: '"DM Sans"',
            whiteSpace: 'nowrap',
          }}
        >
          Export
        </button>

        <button
          type="button"
          className="topbar-desktop-only"
          onClick={() => navigate('/import')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 13px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            border: 'none',
            background: '#ff3333',
            color: '#fff',
            fontFamily: '"DM Sans"',
            whiteSpace: 'nowrap',
          }}
        >
          + Import CSV
        </button>
      </div>
    </>
  )
}
