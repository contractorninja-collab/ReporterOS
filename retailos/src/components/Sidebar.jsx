import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconDashboard,
  IconLifecycle,
  IconHot,
  IconReports,
  IconSearch,
  IconPlanning,
  IconImport,
  IconPhotos,
  IconFootwear,
  IconApparel,
  IconTag,
  IconPlus,
  IconPackage,
  IconUsers,
  IconSun,
  IconLeaf,
  IconClock,
  IconAlert,
  IconHistory,
  IconDelete,
  IconSale,
} from '../utils/icons.js'
import useStore from '../store/useStore.js'
import { getProductLifecycleStatus } from '../utils/lifecycle.js'
import { aggregateSkus } from '../utils/aggregateSkus.js'
import { generateAlerts, dedupeAlertsBySku } from '../utils/alerts.js'
import { isExecutive } from '../utils/roles.js'
import { productMatchesActiveSeason } from '../utils/seasons.js'

function NavRow({ to, end, icon, label, badge, onNavigate, catalog = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={() => onNavigate?.()}
      className={({ isActive }) =>
        `ro-nav-row${catalog ? ' ro-nav-row--catalog' : ''}${isActive ? ' is-active' : ''}`
      }
    >
      <span className="ro-nav-row__rail" aria-hidden />
      <span className="ro-nav-row__icon">{icon}</span>
      <span className="ro-nav-row__label">{label}</span>
      {badge != null && <span className={`ro-nav-badge ro-nav-badge--${badge.type}`}>{badge.text}</span>}
    </NavLink>
  )
}

function SectionCard({ label, children, catalog = false }) {
  return (
    <div className={`ro-nav-section${catalog ? ' ro-nav-section--catalog' : ''}`}>
      <div className="ro-nav-section__label">{label}</div>
      <div className="ro-nav-section__items">{children}</div>
    </div>
  )
}

export function Sidebar({ onNavigate }) {
  const skus = useStore((s) => s.skus)
  const activeSeason = useStore((s) => s.activeSeason)
  const activeUser = useStore((s) => s.activeUser)
  const assignments = useStore((s) => s.assignments)
  const outletTransfers = useStore((s) => s.outletTransfers)
  const storeTransfers = useStore((s) => s.storeTransfers)
  const markdownLists = useStore((s) => s.markdownLists)
  const activeShifts = useStore((s) => s.activeShifts)

  const shipmentMeta = useStore((s) => s.shipmentMeta)
  const products = useMemo(
    () => aggregateSkus(skus, shipmentMeta, activeSeason).filter((p) => productMatchesActiveSeason(p, activeSeason)),
    [skus, shipmentMeta, activeSeason],
  )

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

  const pendingMarkdownLists = useMemo(
    () => markdownLists.filter((l) => l.status === 'pending').length,
    [markdownLists],
  )

  const shiftBadgeCount = useMemo(() => {
    if (!activeUser) return 0
    if (isExecutive(activeUser)) return activeShifts.length
    return activeShifts.filter((s) => s.shop === activeUser.shop).length
  }, [activeShifts, activeUser])

  const smartAlertsUrgentCount = useMemo(() => {
    const agg = aggregateSkus(skus, shipmentMeta, activeSeason)
      .filter((p) => productMatchesActiveSeason(p, activeSeason))
    const list = dedupeAlertsBySku(generateAlerts(agg))
    return list.filter((a) => a.urgency === 'critical' || a.urgency === 'warning').length
  }, [skus, activeSeason, shipmentMeta])

  const atRiskCount = useMemo(() => {
    let atRisk = 0
    for (const p of products) {
      if (getProductLifecycleStatus(p) === 'Risk') {
        atRisk += 1
      }
    }
    return atRisk
  }, [products])

  const activeSeasonUpper = String(activeSeason || '').toUpperCase()
  const seasonWidgetSun = activeSeasonUpper === 'ALL' || activeSeasonUpper.startsWith('SS')

  return (
    <>
      <div className="ro-sidebar-header">
        <div className="ro-sidebar-brand">intelRetail</div>
      </div>

      <div className="ro-sidebar-nav">
        <SectionCard label="Overview">
          <NavRow to="/" end icon={<IconDashboard size={16} strokeWidth={1.75} />} label="Dashboard" onNavigate={onNavigate} />
          <NavRow
            to="/smart-alerts"
            icon={<IconAlert size={16} strokeWidth={1.75} />}
            label="Smart Alerts"
            badge={
              smartAlertsUrgentCount > 0
                ? { type: 'urgent', text: String(smartAlertsUrgentCount) }
                : undefined
            }
            onNavigate={onNavigate}
          />
          <NavRow
            to="/lifecycle"
            icon={<IconLifecycle size={16} strokeWidth={1.75} />}
            label="SKU Lifecycle"
            badge={{ type: 'info', text: String(atRiskCount) }}
            onNavigate={onNavigate}
          />
          <NavRow to="/bestsellers" icon={<IconHot size={16} strokeWidth={1.75} />} label="Bestsellers" onNavigate={onNavigate} />
        </SectionCard>

        {isExecutive(activeUser) && (
          <SectionCard label="Data">
            <NavRow to="/reports" icon={<IconReports size={16} strokeWidth={1.75} />} label="Reports" onNavigate={onNavigate} />
            <NavRow to="/lookup" icon={<IconSearch size={16} strokeWidth={1.75} />} label="Product lookup" onNavigate={onNavigate} />
            <NavRow to="/buy-planning" icon={<IconPlanning size={16} strokeWidth={1.75} />} label="Buy Planning" onNavigate={onNavigate} />
            <NavRow to="/import" icon={<IconImport size={16} strokeWidth={1.75} />} label="Import CSV" onNavigate={onNavigate} />
            <NavRow to="/photos" icon={<IconPhotos size={16} strokeWidth={1.75} />} label="Product Photos" onNavigate={onNavigate} />
            <NavRow to="/bin" icon={<IconDelete size={16} strokeWidth={1.75} />} label="Recycle Bin" onNavigate={onNavigate} />
            <NavRow to="/activity-log" icon={<IconHistory size={16} strokeWidth={1.75} />} label="Activity log" onNavigate={onNavigate} />
          </SectionCard>
        )}

        <SectionCard label="Catalog" catalog>
          <NavRow
            to="/catalog/footwear"
            icon={<IconFootwear size={14} strokeWidth={1.75} />}
            label="Footwear"
            catalog
            onNavigate={onNavigate}
          />
          <NavRow
            to="/catalog/apparel"
            icon={<IconApparel size={14} strokeWidth={1.75} />}
            label="Apparel"
            catalog
            onNavigate={onNavigate}
          />
          <NavRow
            to="/catalog/accessories"
            icon={<IconTag size={14} strokeWidth={1.75} />}
            label="Accessories"
            catalog
            onNavigate={onNavigate}
          />
        </SectionCard>

        <SectionCard label="Workflow">
          <NavRow
            to="/tasks"
            icon={<IconPlanning size={16} strokeWidth={1.75} />}
            label="My Tasks"
            badge={pendingTasks > 0 ? { type: 'orange', text: String(pendingTasks) } : undefined}
            onNavigate={onNavigate}
          />
          <NavRow to="/new-transfer" icon={<IconPlus size={16} strokeWidth={1.75} />} label="New Transfer" onNavigate={onNavigate} />
          <NavRow
            to="/outlet"
            icon={<IconPackage size={16} strokeWidth={1.75} />}
            label="Outlet Transfers"
            badge={pendingTransfers > 0 ? { type: 'orange', text: String(pendingTransfers) } : undefined}
            onNavigate={onNavigate}
          />
          <NavRow
            to="/transfers"
            icon={<IconLifecycle size={16} strokeWidth={1.75} />}
            label="Store Transfers"
            badge={pendingStoreTransfers > 0 ? { type: 'blue', text: String(pendingStoreTransfers) } : undefined}
            onNavigate={onNavigate}
          />
          <NavRow
            to="/markdown"
            icon={<IconSale size={16} strokeWidth={1.75} />}
            label="Sale / Markdown"
            badge={pendingMarkdownLists > 0 ? { type: 'red', text: String(pendingMarkdownLists) } : undefined}
            onNavigate={onNavigate}
          />
          {activeUser?.role === 'executive' && (
            <NavRow to="/users" icon={<IconUsers size={16} strokeWidth={1.75} />} label="Users" onNavigate={onNavigate} />
          )}
          <NavRow
            to="/shift-board"
            icon={<IconClock size={16} strokeWidth={1.75} />}
            label="Shift Board"
            badge={shiftBadgeCount > 0 ? { type: 'green', text: `${shiftBadgeCount} on` } : undefined}
            onNavigate={onNavigate}
          />
        </SectionCard>
      </div>

      <div className="ro-sidebar-footer">
        <div className="ro-season-card">
          <div className="ro-season-card__copy">
            <span className="ro-season-card__label">Active season</span>
            <span className="ro-season-card__value">{activeSeason}</span>
          </div>
          <div className="ro-season-card__icon">
            {seasonWidgetSun ? <IconSun size={16} strokeWidth={1.75} /> : <IconLeaf size={16} strokeWidth={1.75} />}
          </div>
        </div>
      </div>
    </>
  )
}
