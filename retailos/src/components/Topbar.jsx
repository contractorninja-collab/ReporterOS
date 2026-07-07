import { useState, useRef, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, PackageCheck, AlertTriangle, CheckCircle, Truck, Clock, LogIn, LogOut, UserCheck, Sun, Moon, Plus, ChevronDown, Tag } from 'lucide-react'
import { IconSearch } from '../utils/icons.js'
import useStore from '../store/useStore.js'
import { localDateKey } from '../utils/saleList.js'
import { isExecutive } from '../utils/roles.js'
import { applyThemeToDocument, readStoredTheme } from '../themeStorage.js'
import { buildSeasonSwitcherList, normalizeSeasonInput } from '../utils/seasons.js'

const ROLE_COLORS = { manager: '#38bdf8', executive: '#c084fc', outlet: '#fbbf24' }

const NOTIF_ICONS = {
  transfer_created: Truck,
  transfer_received: PackageCheck,
  transfer_completed: CheckCircle,
  transfer_missing_items: AlertTriangle,
  shift_clock_in: LogIn,
  shift_clock_out: LogOut,
  alert_assigned: UserCheck,
  sale_pct_changed: Tag,
}
const NOTIF_COLORS = {
  transfer_created: '#c084fc',
  transfer_received: '#38bdf8',
  transfer_completed: '#00e676',
  transfer_missing_items: '#fbbf24',
  shift_clock_in: '#00e676',
  shift_clock_out: 'var(--ro-text-dim)',
  alert_assigned: '#ff3333',
  sale_pct_changed: '#c084fc',
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
  const navigate = useNavigate()
  const notifications = useVisibleNotifications()
  const markNotificationRead = useStore((s) => s.markNotificationRead)
  const markAllNotificationsRead = useStore((s) => s.markAllNotificationsRead)
  const saleChangeReports = useStore((s) => s.saleChangeReports)

  function handleNotificationClick(n) {
    if (!n.read) markNotificationRead(n.id)
    if (n.type === 'sale_pct_changed' && n.relatedId) {
      const report = saleChangeReports.find((r) => r.id === n.relatedId)
      const date = report ? localDateKey(report.createdAt) : null
      navigate(date ? `/markdown?tab=changes&date=${encodeURIComponent(date)}` : '/markdown?tab=changes')
      onClose?.()
    }
  }

  return (
    <div
      className="notification-dropdown-panel"
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
              onClick={() => handleNotificationClick(n)}
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
  const containerRef = useRef(null)

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

  useEffect(() => {
    if (!open) return
    const closeIfOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', closeIfOutside)
    document.addEventListener('touchstart', closeIfOutside, { passive: true })
    return () => {
      document.removeEventListener('mousedown', closeIfOutside)
      document.removeEventListener('touchstart', closeIfOutside)
    }
  }, [open])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`topbar-icon-btn topbar-bell-btn${ringing ? ' bell-ring' : ''}`}
      >
        <Bell size={16} strokeWidth={1.5} />
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
      className="topbar-icon-btn topbar-theme-toggle"
      onClick={() => {
        const next = light ? 'dark' : 'light'
        applyThemeToDocument(next)
        setLight(next === 'light')
      }}
      aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
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

  if (!activeUser || activeUser.role === 'executive' || activeUser.role === 'marketing') return null

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
  const addExtraSeason = useStore((s) => s.addExtraSeason)
  const skus = useStore((s) => s.skus)
  const extraSeasons = useStore((s) => s.extraSeasons)
  const activeUser = useStore((s) => s.activeUser)
  const setActiveUser = useStore((s) => s.setActiveUser)
  const execUser = isExecutive(activeUser)

  const [seasonAddOpen, setSeasonAddOpen] = useState(false)
  const [seasonDraft, setSeasonDraft] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef(null)

  const seasonSwitcherList = useMemo(
    () => buildSeasonSwitcherList(skus, extraSeasons, activeSeason),
    [skus, extraSeasons, activeSeason],
  )

  const titleMap = {
    '/': { title: 'Dashboard', titleVariant: 'sentence' },
    '/smart-alerts': { title: 'SMART ALERTS' },
    '/lifecycle': { title: 'SKU Lifecycle', titleVariant: 'sentence' },
    '/bestsellers': { title: 'Bestsellers', titleVariant: 'sentence' },
    '/reports': { title: 'Reports', titleVariant: 'sentence' },
    '/activity-log': { title: 'Activity Log', titleVariant: 'sentence' },
    '/lookup': { title: 'Product Lookup', titleVariant: 'sentence' },
    '/buy-planning': { title: 'BUY PLANNING' },
    '/import': { title: 'IMPORT CSV' },
    '/photos': { title: 'Product Photos', titleVariant: 'sentence' },
    '/catalog/footwear': { title: 'Footwear Catalog', titleVariant: 'sentence' },
    '/catalog/apparel': { title: 'Apparel Catalog', titleVariant: 'sentence' },
    '/catalog/accessories': { title: 'Accessories Catalog', titleVariant: 'sentence' },
    '/tasks': { title: 'My Tasks', titleVariant: 'sentence' },
    '/new-transfer': { title: 'New Transfer', titleVariant: 'sentence' },
    '/outlet': { title: 'Outlet Transfers', titleVariant: 'sentence' },
    '/transfers': { title: 'Store Transfers', titleVariant: 'sentence' },
    '/markdown': { title: 'Sale Lists', titleVariant: 'sentence' },
    '/new-markdown': { title: 'NEW SALE LIST' },
    '/bin': { title: 'Recycle bin', titleVariant: 'sentence' },
    '/users': { title: 'User Management', titleVariant: 'sentence' },
    '/shift-board': { title: 'Shift Board', titleVariant: 'sentence' },
  }
  const current = titleMap[location.pathname] || { title: 'RETAILOS' }

  const handleAddSeason = () => {
    if (!normalizeSeasonInput(seasonDraft)) return
    addExtraSeason(seasonDraft)
    setSeasonDraft('')
    setSeasonAddOpen(false)
  }

  useEffect(() => {
    if (!userMenuOpen) return
    const closeIfOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', closeIfOutside)
    document.addEventListener('touchstart', closeIfOutside, { passive: true })
    return () => {
      document.removeEventListener('mousedown', closeIfOutside)
      document.removeEventListener('touchstart', closeIfOutside)
    }
  }, [userMenuOpen])

  return (
    <div
      className="topbar-root"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <div className="topbar-page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <div
          className={`topbar-page-title__text${current.titleVariant === 'sentence' ? ' topbar-page-title__text--sentence' : ''}${current.mobileTitle ? ' topbar-page-title__text--responsive' : ''}`}
        >
          {current.mobileTitle ? (
            <>
              <span className="topbar-page-title__text-full">{current.title}</span>
              <span className="topbar-page-title__text-short">{current.mobileTitle}</span>
            </>
          ) : (
            current.title
          )}
        </div>
      </div>

      <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        {execUser && (
          <div className="topbar-search-wrap topbar-desktop-only">
            <span className="topbar-search-icon" aria-hidden>
              <IconSearch size={14} strokeWidth={1.5} />
            </span>
            <input
              className="topbar-search-input"
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
            />
          </div>
        )}

        <div className="topbar-season-switcher">
          {seasonSwitcherList.map((s) => (
            <div
              key={s}
              className={`topbar-season-chip${activeSeason === s ? ' topbar-season-chip--active' : ''}`}
              onClick={() => setActiveSeason(s)}
            >
              {s}
            </div>
          ))}
          {execUser && (
            <>
              {!seasonAddOpen ? (
                <button
                  type="button"
                  className="topbar-season-add-toggle"
                  onClick={() => setSeasonAddOpen(true)}
                  aria-label="Add season"
                  title="Add season"
                >
                  <Plus size={14} strokeWidth={1.5} />
                </button>
              ) : (
                <div className="topbar-season-add-inline" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <input
                    type="text"
                    value={seasonDraft}
                    onChange={(e) => setSeasonDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddSeason()
                      if (e.key === 'Escape') {
                        setSeasonAddOpen(false)
                        setSeasonDraft('')
                      }
                    }}
                    placeholder="e.g. SS27"
                    autoFocus
                    style={{
                      width: 72,
                      padding: '4px 8px',
                      borderRadius: 8,
                      border: '1px solid var(--ro-border)',
                      background: 'var(--ro-surface-elevated)',
                      color: 'var(--ro-text)',
                      fontSize: 11,
                      fontFamily: '"DM Sans"',
                    }}
                  />
                  <button
                    type="button"
                    className="topbar-season-add-submit"
                    onClick={handleAddSeason}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 8,
                      border: '1px solid rgba(255,51,51,0.25)',
                      background: 'rgba(255,51,51,0.1)',
                      color: '#ff3333',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: '"DM Sans"',
                    }}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="topbar-season-add-cancel"
                    onClick={() => {
                      setSeasonAddOpen(false)
                      setSeasonDraft('')
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 8,
                      border: '1px solid var(--ro-border)',
                      background: 'transparent',
                      color: 'var(--ro-text-muted)',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: '"DM Sans"',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <ThemeToggle />
        <ShiftButton />
        <NotificationBell />

        {activeUser && (
          <>
            <div className="topbar-user-desktop">
              <span className="topbar-user-desktop__dot" aria-hidden />
              <span className="topbar-user-desktop__name">{activeUser.name}</span>
              <button
                type="button"
                className="topbar-user-desktop__switch"
                onClick={() => setActiveUser(null)}
              >
                Switch
              </button>
            </div>

            <div ref={userMenuRef} className="topbar-user-mobile" style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--ro-border)',
                  background: 'var(--ro-surface-elevated)',
                  cursor: 'pointer',
                  fontFamily: '"DM Sans"',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--ro-text)',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: ROLE_COLORS[activeUser.role] || 'var(--ro-text-dim)',
                    flexShrink: 0,
                  }}
                />
                You
                <ChevronDown size={14} style={{ color: 'var(--ro-text-muted)', flexShrink: 0 }} aria-hidden />
              </button>
              {userMenuOpen && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 6,
                    minWidth: 140,
                    padding: '6px 0',
                    background: 'var(--ro-surface-elevated)',
                    border: '1px solid var(--ro-border-hover)',
                    borderRadius: 10,
                    boxShadow: 'var(--ro-dropdown-shadow)',
                    zIndex: 1000,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveUser(null)
                      setUserMenuOpen(false)
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 14px',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: '"DM Sans"',
                      color: 'var(--ro-text)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <button
          type="button"
          className="topbar-desktop-only topbar-import-csv"
          onClick={() => navigate('/import')}
        >
          Import CSV
        </button>
      </div>
    </div>
  )
}
