import { aggregateSkus } from './aggregateSkus.js'
import { outletSkuLocationOwnership } from './outletTransfers.js'

function skuCode(value) {
  return String(value ?? '').trim()
}

function itemExpectedQuantity(item) {
  if (Array.isArray(item?.sizeBreakdown) && item.sizeBreakdown.length) {
    return item.sizeBreakdown.reduce((sum, line) => sum + (Number(line?.qty) || 0), 0)
  }
  return Number(item?.totalQty ?? item?.quantity) || 0
}

function itemReceivedQuantity(transfer, item) {
  const statuses = transfer?.item_statuses || {}
  const code = skuCode(item?.skuCode ?? item?.sku)
  if (Array.isArray(item?.sizeBreakdown) && item.sizeBreakdown.length) {
    return item.sizeBreakdown.reduce((sum, line) => {
      const expected = Number(line?.qty) || 0
      const saved = statuses[`${code}|${line?.size}`]
      return sum + (Number.isInteger(Number(saved?.received)) ? Number(saved.received) : expected)
    }, 0)
  }
  const expected = itemExpectedQuantity(item)
  const size = item?.sizes || 'One Size'
  const saved = statuses[`${code}|${size}`]
  return Number.isInteger(Number(saved?.received)) ? Number(saved.received) : expected
}

export function receivedTransferUnitsBySku(transfers) {
  const units = new Map()
  for (const transfer of Array.isArray(transfers) ? transfers : []) {
    if (transfer?.status !== 'received') continue
    for (const item of Array.isArray(transfer.items) ? transfer.items : []) {
      const code = skuCode(item?.skuCode ?? item?.sku)
      if (!code) continue
      units.set(code, (units.get(code) || 0) + itemReceivedQuantity(transfer, item))
    }
  }
  return units
}

export function buildOutletInventory({ skus, shipmentMeta, transfers, markdownLists }) {
  const products = aggregateSkus(skus, shipmentMeta, 'All')
  const productBySku = new Map(products.map((product) => [skuCode(product.sku), product]))
  const ownership = outletSkuLocationOwnership(transfers, markdownLists)
  const receivedUnits = receivedTransferUnitsBySku(transfers)

  return [...ownership.values()]
    .map((owner) => {
      const product = productBySku.get(owner.skuCode) || {}
      const totalOnHand = Math.max(0, (Number(product.quantity) || 0) - (Number(product.sold_quantity) || 0))
      return {
        ...product,
        sku: owner.skuCode,
        product_name: product.product_name || 'Product details unavailable',
        outletUnits: owner.source === 'outlet_transfer'
          ? (receivedUnits.get(owner.skuCode) || 0)
          : totalOnHand,
        source: owner.source,
        sourceLabel: owner.source === 'outlet_transfer' ? 'Received transfer' : 'Markdown complete',
        transferId: owner.transferId || null,
        fromShop: owner.fromShop || '',
      }
    })
    .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))
}

export function outletWebChecklistProgress(markdownLists) {
  const lists = (Array.isArray(markdownLists) ? markdownLists : [])
    .filter((list) => list?.kind === 'location_change')
    .map((list) => {
      const items = Array.isArray(list.items) ? list.items : []
      const marked = items.filter((item) => (
        list.item_statuses?.[item?.skuCode]?.['E-commerce']?.status === 'tagged'
      )).length
      return { ...list, itemCount: items.length, markedCount: marked, remainingCount: Math.max(0, items.length - marked) }
    })

  return {
    lists,
    pendingLists: lists.filter((list) => list.remainingCount > 0).length,
    totalItems: lists.reduce((sum, list) => sum + list.itemCount, 0),
    markedItems: lists.reduce((sum, list) => sum + list.markedCount, 0),
    remainingItems: lists.reduce((sum, list) => sum + list.remainingCount, 0),
  }
}
