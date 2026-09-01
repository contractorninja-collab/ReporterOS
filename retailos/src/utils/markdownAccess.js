export function markdownListVisibleToUser(list, user) {
  if (list?.kind === 'location_change') return user?.role === 'executive'
  if (user?.role === 'executive') return true
  if (user?.role === 'manager' || user?.role === 'marketing') return true
  if (!String(list?.assignedTo || '').trim()) return true
  return (
    (list?.shop && list.shop === user?.shop) ||
    list?.createdBy === user?.id ||
    list?.assignedTo === user?.id
  )
}
