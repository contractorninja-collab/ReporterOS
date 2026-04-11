/**
 * Users eligible for Smart Alert assignment at a given shop,
 * aligned with Transfer Builder (on-shift filter + executive override).
 */

const SHOPS = ['Ring Mall', 'Village', 'Outlet']

export { SHOPS as ALERT_ASSIGN_SHOPS }

/**
 * @param {Array<{id: string, role: string, shop: string|null}>} users
 * @param {Array<{user_id: string}>} activeShifts
 * @param {string} shop — 'Ring Mall' | 'Village' | 'Outlet'
 * @param {{ showAllUsers?: boolean, isExecutive?: boolean }} opts
 */
export function getAssignableUsersForAlertShop(users, activeShifts, shop, opts = {}) {
  const { showAllUsers = false, isExecutive = false } = opts
  const onShiftIds = new Set((activeShifts || []).map((s) => s.user_id))
  let pool
  if (shop === 'Outlet') {
    pool = users.filter((u) => u.role === 'outlet' || u.shop === 'Outlet')
  } else {
    pool = users.filter((u) => u.shop === shop && u.role !== 'executive')
  }
  if (showAllUsers && isExecutive) return pool
  return pool.filter((u) => onShiftIds.has(u.id))
}

export function defaultAlertShopForUser(activeUser) {
  if (!activeUser?.shop) return 'Ring Mall'
  if (activeUser.shop === 'Outlet' || activeUser.role === 'outlet') return 'Outlet'
  return activeUser.shop
}
