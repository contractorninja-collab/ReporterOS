/** Unified status pill tokens — light tint bg, full-opacity text. No solid fills. */

export const badgeStyles = {
  'low-stock': { bg: '#FEE2E2', color: '#DC2626', fontSize: '10px', fontWeight: 700, padding: '2px 8px' },
  hot: { bg: '#FEF2F2', color: '#DC2626', fontSize: '10px', fontWeight: 700, padding: '2px 8px' },
  season: { bg: '#EFF6FF', color: '#2563EB', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  ss26: { bg: '#EFF6FF', color: '#2563EB', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  fw26: { bg: '#EFF6FF', color: '#2563EB', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  completed: { bg: '#DCFCE7', color: '#15803D', fontSize: '11px', fontWeight: 600, padding: '2px 10px' },
  pending: { bg: '#FEF3C7', color: '#92400E', fontSize: '11px', fontWeight: 600, padding: '2px 10px' },
  archived: { bg: '#F3F4F6', color: '#6B7280', fontSize: '11px', fontWeight: 600, padding: '2px 10px' },
  processing: { bg: '#FEF3C7', color: '#92400E', fontSize: '11px', fontWeight: 600, padding: '2px 10px' },
  failed: { bg: '#FEE2E2', color: '#DC2626', fontSize: '11px', fontWeight: 600, padding: '2px 10px' },
  success: { bg: '#DCFCE7', color: '#15803D', fontSize: '11px', fontWeight: 600, padding: '2px 10px' },
  'dead-stock': { bg: '#FEE2E2', color: '#DC2626', fontSize: '10px', fontWeight: 600, padding: '1px 6px' },
  'carry-over': { bg: '#FEF3C7', color: '#92400E', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  active: { bg: '#ECFDF5', color: '#059669', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  aging: { bg: '#FFFBEB', color: '#D97706', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  risk: { bg: '#FEF2F2', color: '#DC2626', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  clearance: { bg: '#FDF4FF', color: '#9333EA', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  'new-arrival': { bg: '#EFF6FF', color: '#2563EB', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  outlet: { bg: '#FFF7ED', color: '#EA580C', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  default: { bg: '#F3F4F6', color: '#6B7280', fontSize: '10px', fontWeight: 600, padding: '2px 8px' },
  ended: { bg: '#F3F4F6', color: '#6B7280', fontSize: '11px', fontWeight: 600, padding: '2px 10px' },
  warn: { bg: '#FFFBEB', color: '#92400E', fontSize: '11px', fontWeight: 600, padding: '2px 10px' },
  received: { bg: '#DCFCE7', color: '#15803D', fontSize: '11px', fontWeight: 600, padding: '2px 10px' },
}

const LIFECYCLE_STATUS_VARIANT = {
  'New Arrival': 'new-arrival',
  Active: 'active',
  Aging: 'aging',
  Risk: 'risk',
  Clearance: 'clearance',
  Outlet: 'outlet',
}

const IMPORT_STATUS_VARIANT = {
  archived: 'archived',
  processing: 'processing',
  failed: 'failed',
  imported: 'success',
  success: 'success',
}

const MD_VARIANTS = new Set(['completed', 'pending', 'ended', 'warn'])

function normalizeVariant(variant) {
  return String(variant || 'default')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

function badgeSizeForVariant(variant, size) {
  if (size === 'md' || size === 'compact') return size
  const v = normalizeVariant(variant)
  if (v === 'dead-stock') return 'compact'
  const style = badgeStyles[v]
  if (style && parseInt(style.fontSize, 10) >= 11) return 'md'
  return 'sm'
}

/** CSS class names for unified status pills. */
export function statusBadgeClass(variant, opts = {}) {
  const { className = '' } = opts
  const v = normalizeVariant(variant)
  const size = badgeSizeForVariant(v, opts.size)
  const parts = ['ro-status-badge', `ro-status-badge--${badgeStyles[v] ? v : 'default'}`]
  if (size === 'md') parts.push('ro-status-badge--md')
  if (size === 'compact') parts.push('ro-status-badge--compact')
  if (className) parts.push(className)
  return parts.join(' ')
}

export function lifecycleStatusBadgeClass(status) {
  const variant = LIFECYCLE_STATUS_VARIANT[status] || 'default'
  return statusBadgeClass(variant)
}

export function importStatusBadgeClass(status) {
  const variant = IMPORT_STATUS_VARIANT[status] || 'archived'
  return statusBadgeClass(variant, { size: 'md' })
}

export function saleListStatusBadgeClass(statusKey) {
  const key = normalizeVariant(statusKey)
  const variant = MD_VARIANTS.has(key) ? key : 'default'
  return statusBadgeClass(variant, { size: 'md' })
}

/** Inline style fallback when a class cannot be used. */
export function statusBadgeStyle(variant) {
  const v = normalizeVariant(variant)
  const t = badgeStyles[v] || badgeStyles.default
  return {
    background: t.bg,
    color: t.color,
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    padding: t.padding,
    borderRadius: '99px',
    border: 'none',
  }
}
