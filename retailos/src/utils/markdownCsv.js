const MARKDOWN_LANES = ['Ring Mall', 'Village', 'E-commerce']

function csvEscape(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function isoDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
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
    'List Created Date', 'List Completed Date',
    'SKU', 'SKU Added Date', 'Product', 'Brand', 'Category', 'Gender', 'Season', 'Price Tag', 'Sale %', 'Extra Sale %', 'Sale Price', 'Sizes',
    ...MARKDOWN_LANES.flatMap((lane) => [`${lane} ${doneLabel}`, `${lane} ${doneLabel} Date`]),
    'Legacy Marked', 'Legacy Marked Date',
  ]
  const statuses = list?.item_statuses || {}
  const createdAt = isoDate(list?.createdAt)
  const completedAt = isoDate(list?.completedAt)
  const rows = (list?.items || []).map((item) => [
    createdAt, completedAt,
    item.skuCode, isoDate(item.addedAt || list?.createdAt), item.productName, item.brand, item.category, item.gender, item.season,
    item.priceTag, item.salePct, item.extraSalePct || 0, item.salePrice, item.sizes,
    ...MARKDOWN_LANES.flatMap((lane) => {
      const status = laneStatus(statuses, item.skuCode, lane)
      return [status?.status === 'tagged' ? 'Yes' : 'No', isoDate(status?.markedAt)]
    }),
    legacyStatus(statuses, item.skuCode)?.status === 'tagged' ? 'Yes' : 'No',
    isoDate(legacyStatus(statuses, item.skuCode)?.markedAt),
  ])
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
}
