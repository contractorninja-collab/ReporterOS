import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import useStore from '../store/useStore.js'
import { generateAlerts, dedupeAlertsBySku } from '../utils/alerts.js'
import { aggregateSkus } from '../utils/aggregateSkus.js'
import { getLifecycleStatus } from '../utils/lifecycle.js'
import AlertItem from './AlertItem.jsx'
import ProductDetailModal from './ProductDetailModal.jsx'
import { AlertAssignModal } from './AlertAssignModal.jsx'
import { IconCircle, IconAlert } from '../utils/icons.js'

const DM_SANS = '"DM Sans", sans-serif'

const URGENCY_ICON = {
  critical: <IconCircle size={10} fill="#ff3333" color="#ff3333" />,
  warning: <IconCircle size={10} fill="#ff8800" color="#ff8800" />,
  info: <IconCircle size={10} fill="#38bdf8" color="#38bdf8" />,
  opportunity: <IconCircle size={10} fill="#00e676" color="#00e676" />,
}

const STATUS_LABELS = {
  'New Arrival': 'New Arrivals',
  Active: 'Active SKUs',
  Aging: 'Aging',
  Risk: 'At Risk',
  Clearance: 'Clearance',
  Outlet: 'Outlet',
}

function modalStatusData(status) {
  const tiles = {
    'New Arrival': { color: '#38bdf8', colorBg: 'rgba(56,189,248,0.1)', icon: '•' },
    Active: { color: '#00e676', colorBg: 'rgba(0,230,118,0.1)', icon: '●' },
    Aging: { color: '#fbbf24', colorBg: 'rgba(251,191,36,0.1)', icon: '◐' },
    Risk: { color: '#ff8800', colorBg: 'rgba(255,136,0,0.1)', icon: '!' },
    Clearance: { color: '#ff3333', colorBg: 'rgba(255,51,51,0.1)', icon: '▼' },
    Outlet: { color: '#c084fc', colorBg: 'rgba(192,132,252,0.1)', icon: '◆' },
  }
  const t = tiles[status] || tiles.Active
  return {
    label: STATUS_LABELS[status] ?? status,
    color: t.color,
    colorBg: t.colorBg,
    icon: t.icon,
  }
}

/**
 * @param {{ limit?: number, showViewAllLink?: boolean, urgencyFilter?: string }} props
 */
export function SmartAlertsList({ limit, showViewAllLink, urgencyFilter = 'all' }) {
  const skus = useStore((s) => s.skus)
  const activeSeason = useStore((s) => s.activeSeason)
  const assignments = useStore((s) => s.assignments)
  const activeUser = useStore((s) => s.activeUser)
  const users = useStore((s) => s.users)
  const addAssignment = useStore((s) => s.addAssignment)
  const addNotification = useStore((s) => s.addNotification)

  const [assignModalAlert, setAssignModalAlert] = useState(null)
  const [detailSku, setDetailSku] = useState(null)

  const filteredSkus = useMemo(
    () => (activeSeason === 'All' ? skus : skus.filter((s) => s.season === activeSeason)),
    [skus, activeSeason],
  )

  const products = useMemo(() => aggregateSkus(filteredSkus), [filteredSkus])

  const allAlerts = useMemo(() => dedupeAlertsBySku(generateAlerts(products)), [products])

  const filteredAlerts = useMemo(() => {
    if (urgencyFilter === 'all') return allAlerts
    return allAlerts.filter((a) => a.urgency === urgencyFilter)
  }, [allAlerts, urgencyFilter])

  const displayedAlerts = useMemo(() => {
    if (limit == null) return filteredAlerts
    return filteredAlerts.slice(0, limit)
  }, [filteredAlerts, limit])

  const assignedSkuSet = useMemo(() => {
    const set = new Set()
    for (const a of assignments) {
      if (a.type === 'alert_action' && a.skuCode && a.status !== 'done') {
        set.add(a.skuCode)
      }
    }
    return set
  }, [assignments])

  const detailLifecycleStatus = detailSku
    ? getLifecycleStatus(detailSku.import_date, detailSku.sold_quantity, detailSku.quantity)
    : null

  const openProductDetail = (skuCode) => {
    const p = products.find((x) => x.sku === skuCode)
    if (p) setDetailSku(p)
  }

  const handleConfirmAssign = ({ userId, shop }) => {
    if (!assignModalAlert) return
    const a = assignModalAlert
    const assignee = users.find((u) => u.id === userId)
    const assigneeName = assignee?.name || 'Team member'
    addAssignment({
      type: 'alert_action',
      skuCode: a.skuCode,
      productName: `${a.productName} — ${a.message}`,
      assignedTo: userId,
      assignedBy: activeUser?.id || '',
      shop: shop || assignee?.shop || '',
      status: 'pending',
      note: a.action,
    })
    const detailMsg = `${a.productName} — ${a.action}. Assigned to ${assigneeName}.`
    addNotification({
      type: 'alert_assigned',
      title: 'Alert assigned',
      message: detailMsg,
      userId,
      relatedId: a.skuCode,
    })
    addNotification({
      type: 'alert_assigned',
      title: 'Alert assigned (audit)',
      message: `${activeUser?.name || 'User'} → ${assigneeName}: ${a.productName} (${a.skuCode})`,
      userId: 'executives',
      relatedId: a.skuCode,
    })
    setAssignModalAlert(null)
  }

  return (
    <>
      {displayedAlerts.length === 0 ? (
        <div style={{ fontSize: 12, color: '#4a4a62', padding: '8px 0' }}>No alerts right now.</div>
      ) : (
        displayedAlerts.map((a) => (
          <AlertItem
            key={`${a.skuCode}-${a.type}`}
            urgency={a.urgency}
            icon={
              URGENCY_ICON[a.urgency] ?? (
                <IconCircle size={10} fill="#38bdf8" color="#38bdf8" />
              )
            }
            title={`${a.productName} — ${a.skuCode}`}
            description={`${a.message} · ${a.action}`}
            messageSecondary={a.messageSecondary}
            assigned={assignedSkuSet.has(a.skuCode)}
            onAssign={() => setAssignModalAlert(a)}
            onViewProduct={() => openProductDetail(a.skuCode)}
          />
        ))
      )}
      {showViewAllLink && limit != null && filteredAlerts.length > limit && (
        <Link
          to="/smart-alerts"
          style={{
            display: 'inline-block',
            marginTop: 10,
            fontSize: 11,
            fontWeight: 600,
            color: '#38bdf8',
            fontFamily: DM_SANS,
            textDecoration: 'none',
          }}
        >
          View all alerts →
        </Link>
      )}
      {assignModalAlert && (
        <AlertAssignModal
          alert={assignModalAlert}
          onClose={() => setAssignModalAlert(null)}
          onConfirm={handleConfirmAssign}
        />
      )}
      {detailSku && detailLifecycleStatus && (
        <ProductDetailModal
          sku={detailSku}
          status={detailLifecycleStatus}
          statusData={modalStatusData(detailLifecycleStatus)}
          onClose={() => setDetailSku(null)}
        />
      )}
    </>
  )
}

export function SmartAlertsHeaderTitle() {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <IconAlert size={14} strokeWidth={1.5} /> Smart Alerts — Today
    </span>
  )
}
