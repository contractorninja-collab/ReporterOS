/**
 * Smart Alerts — Section 6 of CURSOR_CONTEXT.md
 * Generate alerts automatically from SKU lifecycle and sell-through.
 */

import { getDaysInStore, getSellThrough, getLifecycleStatus, getEffectiveLifecycleImportDate } from './lifecycle.js'

/**
 * @typedef {Object} Alert
 * @property {string} type
 * @property {'critical'|'warning'|'info'|'opportunity'} urgency
 * @property {string} skuCode
 * @property {string} productName
 * @property {string} message
 * @property {string} action
 */

/**
 * Generate alerts from SKU data.
 * Uses logic from Section 6 (Smart Alerts — Dashboard Logic).
 * @param {Array<{sku: string, product_name: string, import_date: string|Date, sold_quantity: number, quantity: number}>} skus
 * @returns {Alert[]}
 */
export function generateAlerts(skus) {
  const alerts = []

  for (const sku of skus) {
    const { sku: skuCode, product_name: productName } = sku
    const importDate = getEffectiveLifecycleImportDate(sku)
    const days = getDaysInStore(importDate)
    const sellThrough = getSellThrough(sku.sold_quantity, sku.quantity)
    const status = getLifecycleStatus(importDate, sku.sold_quantity, sku.quantity)

    // 🔴 Clearance tomorrow — days_in_store = 148–150 | Do today (critical)
    if (days >= 148 && days <= 150) {
      alerts.push({
        type: 'clearance_tomorrow',
        urgency: 'critical',
        skuCode,
        productName,
        message: `Enters Clearance in ${151 - days} day(s)`,
        action: 'Apply markdown — do today',
      })
    }

    // 🟠 Aging + low sell-through — days 91–150 AND sell_through < 25% | This week (warning)
    if (days > 90 && days <= 150 && sellThrough < 25) {
      alerts.push({
        type: 'aging_low_sellthrough',
        urgency: 'warning',
        skuCode,
        productName,
        message: `${status} — sell-through ${sellThrough.toFixed(0)}%`,
        action: 'Move to window display / front of store',
      })
    }

    // 🟠 Transition warning — days = 28–30 (leaving New Arrival) | Info
    if (days >= 28 && days <= 30 && status === 'New Arrival') {
      alerts.push({
        type: 'transition_warning',
        urgency: 'info',
        skuCode,
        productName,
        message: `Leaving New Arrival in ${31 - days} day(s)`,
        action: 'Monitor performance',
      })
    }

    // 🟢 Bestseller / reorder — sell_through > 60% | Opportunity
    // Note: Section 6 mentions "in 21 days" but CSV has cumulative sold_quantity; using total sell-through
    if (sellThrough > 60) {
      alerts.push({
        type: 'bestseller_reorder',
        urgency: 'opportunity',
        skuCode,
        productName,
        message: `Sell-through ${sellThrough.toFixed(0)}% — strong demand`,
        action: 'Trigger reorder',
      })
    }

    // 🔵 Status change — SKU crossing a day threshold today
    // Thresholds: 30, 90, 150, 180
    if ([30, 90, 150, 180].includes(days)) {
      const nextStatus =
        days === 30 ? 'Active' : days === 90 ? 'Aging/Risk' : days === 150 ? 'Clearance' : 'Outlet'
      alerts.push({
        type: 'status_change',
        urgency: 'info',
        skuCode,
        productName,
        message: `At ${days}-day threshold — moving to ${nextStatus}`,
        action: 'Review pricing and placement',
      })
    }
  }

  // Sort by urgency: critical > warning > opportunity > info
  const order = { critical: 0, warning: 1, opportunity: 2, info: 3 }
  alerts.sort((a, b) => order[a.urgency] - order[b.urgency])

  return alerts
}

/** Urgency rank (lower = higher priority). */
export const ALERT_URGENCY_ORDER = { critical: 0, warning: 1, opportunity: 2, info: 3 }

/**
 * One row per SKU: keep highest-urgency alert; merge others into messageSecondary for the UI.
 * @param {import('./alerts.js').Alert[]} alerts
 * @returns {Array<import('./alerts.js').Alert & { messageSecondary?: string, mergedTypes?: string[] }>}
 */
export function dedupeAlertsBySku(alerts) {
  const bySku = new Map()
  for (const a of alerts) {
    if (!bySku.has(a.skuCode)) bySku.set(a.skuCode, [])
    bySku.get(a.skuCode).push(a)
  }
  const order = ALERT_URGENCY_ORDER
  const out = []
  for (const list of bySku.values()) {
    list.sort((x, y) => (order[x.urgency] ?? 9) - (order[y.urgency] ?? 9))
    const primary = list[0]
    const others = list.slice(1)
    if (others.length === 0) {
      out.push(primary)
    } else {
      const alsoLine = others.map((o) => o.message).join(' · ')
      out.push({
        ...primary,
        mergedTypes: others.map((o) => o.type),
        messageSecondary: `Also: ${alsoLine}`,
      })
    }
  }
  out.sort((a, b) => (order[a.urgency] ?? 9) - (order[b.urgency] ?? 9))
  return out
}
