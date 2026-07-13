export const isExecutive = (user) => user?.role === 'executive'

export const canUseProductLookup = (user) =>
  ['executive', 'manager', 'marketing'].includes(user?.role)
