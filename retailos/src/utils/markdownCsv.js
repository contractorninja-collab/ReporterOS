const MARKDOWN_LANES = ['Ring Mall', 'Village', 'E-commerce']

function csvEscape(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function isoTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function laneStatus(statuses, skuCode, lane) {
  return statuses?.[skuCode]?.[lane] || null
}

function legacyStatus(statuses, skuCode) {
  return statuses?.[skuCode]?.__legacy || null
}

export function buildMarkdownListCSV(list) {
  const doneLabel = list?.kind === 'removal' ? 'Removed' : 'Tagged'
  const headers = [
    'List Created At (UTC)', 'List Completed At (UTC)',
    'SKU', 'SKU Added At (UTC)', 'Product', 'Brand', 'Category', 'Gender', 'Season', 'Price Tag', 'Sale %', 'Extra Sale %', 'Sale Price', 'Sizes',
    ...MARKDOWN_LANES.flatMap((lane) => [`${lane} ${doneLabel}`, `${lane} ${doneLabel} At (UTC)`]),
    'Legacy Marked', 'Legacy Marked At (UTC)',
  ]
  const statuses = list?.item_statuses || {}
  const createdAt = isoTimestamp(list?.createdAt)
  const completedAt = isoTimestamp(list?.completedAt)
  const rows = (list?.items || []).map((item) => [
    createdAt, completedAt,
    item.skuCode, isoTimestamp(item.addedAt || list?.createdAt), item.productName, item.brand, item.category, item.gender, item.season,
    item.priceTag, item.salePct, item.extraSalePct || 0, item.salePrice, item.sizes,
    ...MARKDOWN_LANES.flatMap((lane) => {
      const status = laneStatus(statuses, item.skuCode, lane)
      return [status?.status === 'tagged' ? 'Yes' : 'No', isoTimestamp(status?.markedAt)]
    }),
    legacyStatus(statuses, item.skuCode)?.status === 'tagged' ? 'Yes' : 'No',
    isoTimestamp(legacyStatus(statuses, item.skuCode)?.markedAt),
  ])
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
}
