/**
 * SKU Lifecycle Logic — Section 3 of CURSOR_CONTEXT.md
 * Status is calculated automatically from import_date and sell-through %.
 * The user never manually sets a status.
 */

export const STATUS_COLORS = {
  'New Arrival': '#38bdf8',
  Active: '#00e676',
  Aging: '#fbbf24',
  Risk: '#ff8800',
  Clearance: '#ff3333',
  Outlet: '#c084fc',
}

/** Kanban column order (lifecycle stages). */
export const STATUS_ORDER = ['New Arrival', 'Active', 'Aging', 'Risk', 'Clearance', 'Outlet']

/**
 * Get number of days since import date.
 * @param {string|Date} importDate - Date stock arrived in store
 * @returns {number} Days since import (0 = same day)
 */
export function getDaysInStore(importDate) {
  const importMs = importDate instanceof Date ? importDate.getTime() : new Date(importDate).getTime()
  if (Number.isNaN(importMs)) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()
  const importDay = new Date(importMs)
  importDay.setHours(0, 0, 0, 0)
  const importDayMs = importDay.getTime()
  return Math.floor((todayMs - importDayMs) / (24 * 60 * 60 * 1000))
}

/**
 * Get sell-through percentage.
 * @param {number} soldQty - Units sold
 * @param {number} totalQty - Total units
 * @returns {number} 0–100
 */
export function getSellThrough(soldQty, totalQty) {
  if (totalQty <= 0) return 0
  return Math.min(100, (soldQty / totalQty) * 100)
}

/**
 * Get lifecycle status from days in store and sell-through.
 * Rules applied in order per Section 3.
 * @param {string|Date} importDate - Date stock arrived
 * @param {number} soldQty - sold_quantity
 * @param {number} totalQty - quantity
 * @returns {string} One of: New Arrival, Active, Aging, Risk, Clearance, Outlet
 */
export function getLifecycleStatus(importDate, soldQty, totalQty) {
  const days = getDaysInStore(importDate)
  const sellThrough = getSellThrough(soldQty, totalQty)

  if (days <= 30) return 'New Arrival'
  if (days <= 90) return 'Active'
  if (days <= 150) {
    return sellThrough >= 20 ? 'Aging' : 'Risk'
  }
  if (days <= 180) return 'Clearance'
  return 'Outlet'
}

/** Sell-through ≥ 60% — reorder flag (CURSOR_CONTEXT §3 Stock Modifier Rules). */
export function isReorderCandidate(soldQty, totalQty) {
  return getSellThrough(soldQty, totalQty) >= 60
}

/** Sell-through < 10% and in store > 120 days — high urgency (CURSOR_CONTEXT §3). */
export function isHighUrgency(importDate, soldQty, totalQty) {
  return getDaysInStore(importDate) > 120 && getSellThrough(soldQty, totalQty) < 10
}

/**
 * AI reorder verdict for a product row from the product report.
 * Scores on sell-through, ROI, velocity, and margin to produce a recommendation.
 *
 * @param {{ sold: number, stock: number, totalRevenue: number, profit: number, roi: number, first_import_date: string }} row
 * @returns {{ recommendation: string, confidence: string, reason: string, color: string }}
 */
export function getReorderVerdict(row) {
  const sold = Number(row.sold) || 0
  const stocked = Number(row.stock) || 0
  const sellThrough = stocked > 0 ? (sold / stocked) * 100 : 0
  const roi = Number(row.roi) || 0
  const totalCost = Number(row.totalCost) || 0
  const profit = Number(row.profit) || 0
  const days = getDaysInStore(row.first_import_date)
  const velocity = days > 0 ? sold / days : 0
  const marginPerUnit = sold > 0 ? profit / sold : 0

  if (days < 30 || stocked < 3) {
    return {
      recommendation: 'Monitor',
      confidence: 'weak',
      reason: days < 30
        ? `Only ${days} day${days === 1 ? '' : 's'} in store — too early to judge`
        : 'Very small sample size',
      color: '#38bdf8',
    }
  }

  if (sellThrough >= 50 && roi >= 30) {
    const conf = sellThrough >= 70 && roi >= 60 ? 'strong' : 'moderate'
    return {
      recommendation: 'Reorder',
      confidence: conf,
      reason: `${sellThrough.toFixed(0)}% sell-through, ${roi.toFixed(0)}% ROI — strong performer`,
      color: '#00e676',
    }
  }

  if (sellThrough < 20 && roi < 10) {
    const conf = sellThrough < 10 && roi < 0 ? 'strong' : 'moderate'
    return {
      recommendation: 'Drop',
      confidence: conf,
      reason: `${sellThrough.toFixed(0)}% sell-through, ${roi.toFixed(0)}% ROI — poor performance`,
      color: '#ff3333',
    }
  }

  if (velocity < 0.05 && days > 90) {
    return {
      recommendation: 'Drop',
      confidence: 'moderate',
      reason: `${velocity.toFixed(2)} units/day over ${days} days — stagnant`,
      color: '#ff3333',
    }
  }

  const conf = (sellThrough >= 30 && sellThrough < 50) || (roi >= 15 && roi < 30) ? 'moderate' : 'weak'
  return {
    recommendation: 'Reduce qty',
    confidence: conf,
    reason: `${sellThrough.toFixed(0)}% sell-through, ${roi.toFixed(0)}% ROI — moderate demand`,
    color: '#fbbf24',
  }
}
