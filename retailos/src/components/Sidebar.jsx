import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconDashboard,
  IconLifecycle,
  IconHot,
  IconStrategy,
  IconReports,
  IconSearch,
  IconPlanning,
  IconImport,
  IconPhotos,
  IconFootwear,
  IconApparel,
  IconAccessories,
  IconPlus,
  IconPackage,
  IconUsers,
  IconSun,
  IconLeaf,
  IconClock,
  IconAlert,
} from '../utils/icons.js'
import useStore from '../store/useStore.js'
import { getLifecycleStatus } from '../utils/lifecycle.js'
import { aggregateSkus } from '../utils/aggregateSkus.js'
import { generateAlerts, dedupeAlertsBySku } from '../utils/alerts.js'
import { isExecutive } from '../utils/roles.js'

const GROUP_LABEL_STYLE = {
  fontSize: '9px',
  fontWeight: 700,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color: 'var(--ro-text-muted)',
  padding: '10px 10px 5px',
  display: 'block',
}

const NAV_ITEM_BASE = {
  display: 'flex',
  alignItems: 'center',
  gap: '9px',
  padding: '8px 10px',
  borderRadius: '9px',
  cursor: 'pointer',
  color: 'var(--ro-text-dim)',
  fontSize: '13px',
  fontWeight: 500,
  position: 'relative',
  userSelect: 'none',
  marginBottom: '1px',
  transition: 'all 0.14s ease',
  textDecoration: 'none',
}

const NAV_ICON_BOX = {
  width: '28px',
  height: '28px',
  borderRadius: '7px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
  flexShrink: 0,
  background: 'var(--ro-surface-elevated)',
}

const BADGE_STYLES = {
  red: {
    fontSize: '9px',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '20px',
    flexShrink: 0,
    background: 'rgba(255,51,51,0.18)',
    color: '#ff3333',
  },
  green: {
    fontSize: '9px',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '20px',
    flexShrink: 0,
    background: 'rgba(0,230,118,0.15)',
    color: '#00e676',
  },
  orange: {
    fontSize: '9px',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '20px',
    flexShrink: 0,
    background: 'rgba(255,136,0,0.15)',
    color: '#ff8800',
  },
  blue: {
    fontSize: '9px',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '20px',
    flexShrink: 0,
    background: 'rgba(56,189,248,0.15)',
    color: '#38bdf8',
  },
}

const DIVIDER = (
  <div style={{ height: '1px', background: 'var(--ro-border)', margin: '8px 10px' }} aria-hidden />
)

function NavRow({ to, end, icon, label, badge, onNavigate }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={() => onNavigate?.()}
      style={({ isActive }) => ({
        ...NAV_ITEM_BASE,
        background: isActive ? 'rgba(255,51,51,0.1)' : 'transparent',
        color: isActive ? 'var(--ro-heading)' : 'var(--ro-text-dim)',
        textDecoration: 'none',
        display: 'flex',
      })}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: '20%',
                bottom: '20%',
                width: '2px',
                background: '#ff3333',
                borderRadius: '0 2px 2px 0',
              }}
              aria-hidden
            />
          )}
          <div
            style={{
              ...NAV_ICON_BOX,
              background: isActive ? 'rgba(255,51,51,0.15)' : 'var(--ro-surface-elevated)',
              position: 'relative',
              zIndex: 1,
            }}
          >
            {icon}
          </div>
          <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
          {badge != null && <span style={{ ...BADGE_STYLES[badge.type] }}>{badge.text}</span>}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar({ onNavigate }) {
  const skus = useStore((s) => s.skus)
  const activeSeason = useStore((s) => s.activeSeason)
  const activeUser = useStore((s) => s.activeUser)
  const assignments = useStore((s) => s.assignments)
  const outletTransfers = useStore((s) => s.outletTransfers)
  const storeTransfers = useStore((s) => s.storeTransfers)
  const activeShifts = useStore((s) => s.activeShifts)

  const products = useMemo(() => aggregateSkus(skus), [skus])

  const pendingTasks = useMemo(() => {
    if (!activeUser) return 0
    return assignments.filter((a) => a.assignedTo === activeUser.id && a.status !== 'done').length
  }, [assignments, activeUser])

  const pendingTransfers = useMemo(
    () => outletTransfers.filter((t) => t.status === 'pending').length,
    [outletTransfers],
  )

  const pendingStoreTransfers = useMemo(() => {
    if (!activeUser?.shop) return 0
    return storeTransfers.filter((t) => t.status === 'pending' && t.toShop === activeUser.shop).length
  }, [storeTransfers, activeUser])

  const shiftBadgeCount = useMemo(() => {
    if (!activeUser) return 0
    if (isExecutive(activeUser)) return activeShifts.length
    return activeShifts.filter((s) => s.shop === activeUser.shop).length
  }, [activeShifts, activeUser])

  const smartAlertsUrgentCount = useMemo(() => {
    const filteredSkus =
      activeSeason === 'All' ? skus : skus.filter((s) => s.season === activeSeason)
    const agg = aggregateSkus(filteredSkus)
    const list = dedupeAlertsBySku(generateAlerts(agg))
    return list.filter((a) => a.urgency === 'critical' || a.urgency === 'warning').length
  }, [skus, activeSeason])

  const { atRiskCount, footwearCount, apparelCount, accessoriesCount } = useMemo(() => {
    let atRisk = 0
    for (const p of products) {
      if (getLifecycleStatus(p.import_date, p.sold_quantity, p.quantity) === 'Risk') {
        atRisk += 1
      }
    }
    const norm = (c) => (c || '').toLowerCase().trim()
    let footwear = 0
    let apparel = 0
    let accessories = 0
    for (const p of products) {
      const c = norm(p.category)
      if (c === 'footwear') footwear += 1
      else if (c === 'apparel') apparel += 1
      else if (c === 'accessories') accessories += 1
    }
    return { atRiskCount: atRisk, footwearCount: footwear, apparelCount: apparel, accessoriesCount: accessories }
  }, [products])

  return (
    <>
      <div style={{ padding: '26px 20px 20px', borderBottom: '1px solid var(--ro-border)', flexShrink: 0 }}>
        <div
          style={{
            fontFamily: '"DM Sans"',
            fontSize: '21px',
            letterSpacing: '-0.3px',
            color: 'var(--ro-heading)',
            display: 'flex',
            alignItems: 'center',
            lineHeight: 1,
          }}
        >
          <span style={{ fontWeight: 300, color: 'var(--ro-text-muted)' }}>intel</span>
          <span style={{ fontWeight: 700 }}>Retail</span>
        </div>
        <div
          style={{
            fontSize: '9px',
            color: 'var(--ro-text-muted)',
            letterSpacing: '2.5px',
            textTransform: 'uppercase',
            marginTop: '2px',
          }}
        >
          Your Intelligent Retail Assistant
        </div>
      </div>

      <div style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
        <div style={GROUP_LABEL_STYLE}>Overview</div>
        <NavRow to="/" end icon={<IconDashboard size={14} strokeWidth={1.5} />} label="Dashboard" onNavigate={onNavigate} />
        <NavRow
          to="/smart-alerts"
          icon={<IconAlert size={14} strokeWidth={1.5} />}
          label="Smart Alerts"
          badge={
            smartAlertsUrgentCount > 0
              ? { type: 'orange', text: String(smartAlertsUrgentCount) }
              : undefined
          }
          onNavigate={onNavigate}
        />
        <NavRow
          to="/lifecycle"
          icon={<IconLifecycle size={14} strokeWidth={1.5} />}
          label="SKU Lifecycle"
          badge={{ type: 'red', text: String(atRiskCount) }}
          onNavigate={onNavigate}
        />
        <NavRow to="/bestsellers" icon={<IconHot size={14} strokeWidth={1.5} />} label="Bestsellers" badge={{ type: 'green', text: 'Top 5' }} onNavigate={onNavigate} />
        {isExecutive(activeUser) && (
          <NavRow
            to="/strategy"
            icon={<IconStrategy size={14} strokeWidth={1.5} />}
            label="Rotation Strategy"
            badge={{ type: 'orange', text: '4 actions' }}
            onNavigate={onNavigate}
          />
        )}

        {DIVIDER}

        {isExecutive(activeUser) && (
          <>
            <div style={GROUP_LABEL_STYLE}>Data</div>
            <NavRow to="/reports" icon={<IconReports size={14} strokeWidth={1.5} />} label="Reports" onNavigate={onNavigate} />
            <NavRow to="/lookup" icon={<IconSearch size={14} strokeWidth={1.5} />} label="Product lookup" onNavigate={onNavigate} />
            <NavRow to="/buy-planning" icon={<IconPlanning size={14} strokeWidth={1.5} />} label="Buy Planning" onNavigate={onNavigate} />
            <NavRow to="/import" icon={<IconImport size={14} strokeWidth={1.5} />} label="Import CSV" badge={{ type: 'blue', text: 'Ready' }} onNavigate={onNavigate} />
            <NavRow to="/photos" icon={<IconPhotos size={14} strokeWidth={1.5} />} label="Product Photos" onNavigate={onNavigate} />
            {DIVIDER}
          </>
        )}

        <div style={GROUP_LABEL_STYLE}>Catalog</div>
        <NavRow
          to="/catalog/footwear"
          icon={<IconFootwear size={14} strokeWidth={1.5} />}
          label="Footwear"
          badge={{ type: 'blue', text: String(footwearCount) }}
          onNavigate={onNavigate}
        />
        <NavRow
          to="/catalog/apparel"
          icon={<IconApparel size={14} strokeWidth={1.5} />}
          label="Apparel"
          badge={{ type: 'blue', text: String(apparelCount) }}
          onNavigate={onNavigate}
        />
        <NavRow
          to="/catalog/accessories"
          icon={<IconAccessories size={14} strokeWidth={1.5} />}
          label="Accessories"
          badge={{ type: 'blue', text: String(accessoriesCount) }}
          onNavigate={onNavigate}
        />

        {DIVIDER}

        <div style={GROUP_LABEL_STYLE}>Workflow</div>
        <NavRow
          to="/tasks"
          icon={<IconPlanning size={14} strokeWidth={1.5} />}
          label="My Tasks"
          badge={pendingTasks > 0 ? { type: 'orange', text: String(pendingTasks) } : undefined}
          onNavigate={onNavigate}
        />
        <NavRow to="/new-transfer" icon={<IconPlus size={14} strokeWidth={1.5} />} label="New Transfer" badge={{ type: 'red', text: 'Create' }} onNavigate={onNavigate} />
        <NavRow
          to="/outlet"
          icon={<IconPackage size={14} strokeWidth={1.5} />}
          label="Outlet Transfers"
          badge={pendingTransfers > 0 ? { type: 'orange', text: String(pendingTransfers) } : undefined}
          onNavigate={onNavigate}
        />
        <NavRow
          to="/transfers"
          icon={<IconLifecycle size={14} strokeWidth={1.5} />}
          label="Store Transfers"
          badge={pendingStoreTransfers > 0 ? { type: 'blue', text: String(pendingStoreTransfers) } : undefined}
          onNavigate={onNavigate}
        />
        {activeUser?.role === 'executive' && (
          <NavRow to="/users" icon={<IconUsers size={14} strokeWidth={1.5} />} label="Users" onNavigate={onNavigate} />
        )}
        <NavRow
          to="/shift-board"
          icon={<IconClock size={14} strokeWidth={1.5} />}
          label="Shift Board"
          badge={shiftBadgeCount > 0 ? { type: 'green', text: `${shiftBadgeCount} on` } : undefined}
          onNavigate={onNavigate}
        />
      </div>

      <div style={{ padding: '12px 10px 16px', borderTop: '1px solid var(--ro-border)', flexShrink: 0 }}>
        <div
          style={{
            background: 'var(--ro-surface-elevated)',
            border: '1px solid var(--ro-border)',
            borderRadius: '11px',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '9px',
                color: 'var(--ro-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '1.5px',
              }}
            >
              Active Season
            </div>
            <div
              style={{
                fontFamily: '"DM Sans"',
                fontSize: '22px',
                color: '#ff8800',
                letterSpacing: '2px',
                lineHeight: 1,
              }}
            >
              {activeSeason}
            </div>
          </div>
          <div style={{ fontSize: '22px' }}>
            {activeSeason === 'SS26' ? <IconSun size={20} strokeWidth={1.5} /> : <IconLeaf size={20} strokeWidth={1.5} />}
          </div>
        </div>
      </div>
    </>
  )
}
