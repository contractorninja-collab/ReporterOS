import { aggregateSkus } from './aggregateSkus.js'
import {
  outletSkuLocationOwnership,
  receivedOutletTransferUnitsBySku,
} from './outletTransfers.js'

function skuCode(value) {
  return String(value ?? '').trim()
}

export function isOutletOwnedProduct(product) {
  if (product?.outlet_location_source === 'markdown_list') return false
  if (product?.outlet_location_source === 'outlet_transfer' && product.outlet_units != null && Number(product.outlet_units) <= 0) return false
  return String(product?.stock_location || '').trim().toLocaleLowerCase() === 'outlet'
}

export function excludeOutletOwnedProducts(products) {
  return (Array.isArray(products) ? products : []).filter((product) => !isOutletOwnedProduct(product))
}

export function filterProductsByOutletScope(products, excludeOutlet = false) {
  const rows = Array.isArray(products) ? products : []
  return excludeOutlet ? excludeOutletOwnedProducts(rows) : rows
}

export const receivedTransferUnitsBySku = receivedOutletTransferUnitsBySku

export function buildOutletSourceReview({ skus, shipmentMeta, transfers, markdownLists }) {
  const products = aggregateSkus(skus, shipmentMeta, 'All')
  const productBySku = new Map(products.map((product) => [skuCode(product.sku), product]))
  const received = outletSkuLocationOwnership(transfers)
  return (Array.isArray(markdownLists) ? markdownLists : [])
    .filter((list) => Number(list.outlet_legacy_review) === 1 && !list.outlet_review_removed_at)
    .map((list) => {
      const items = [...new Map((list.items || []).map((item) => [skuCode(item.skuCode), item])).entries()]
        .filter(([code]) => code && !received.has(code) && !isOutletOwnedProduct(productBySku.get(code)))
        .map(([code, item]) => ({
          sku: code,
          productName: productBySku.get(code)?.product_name || item.productName || 'Product details unavailable',
        }))
      return { id: list.id, title: list.title || 'Markdown list', createdAt: list.createdAt, completedAt: list.completedAt, items }
    })
    .filter((group) => group.items.length)
}

export function buildOutletInventory({ skus, shipmentMeta, transfers, markdownLists }) {
  const products = aggregateSkus(skus, shipmentMeta, 'All')
  const productBySku = new Map(products.map((product) => [skuCode(product.sku), product]))
  const ownership = outletSkuLocationOwnership(transfers, markdownLists)
  const receivedUnits = receivedOutletTransferUnitsBySku(transfers)
  const officialOutletCodes = new Set(products
    .filter((product) => isOutletOwnedProduct(product) && (
      !receivedUnits.has(skuCode(product.sku)) || receivedUnits.get(skuCode(product.sku)) > 0 || Number(product.outlet_units) > 0
    ))
    .map((product) => skuCode(product.sku))
    .filter(Boolean))
  for (const code of ownership.keys()) officialOutletCodes.add(code)

  return [...officialOutletCodes]
    .map((code) => {
      const product = productBySku.get(code) || {}
      const owner = ownership.get(code) || null
      const source = owner?.source || product.outlet_location_source || 'outlet_stock'
      const totalOnHand = Math.max(0, (Number(product.quantity) || 0) - (Number(product.sold_quantity) || 0))
      const serverUnits = product.outlet_units
      const hasServerUnits = serverUnits != null && serverUnits !== '' && Number.isFinite(Number(serverUnits))
      const outletUnits = hasServerUnits
        ? Math.max(0, Number(serverUnits))
        : source === 'outlet_transfer'
          ? (receivedUnits.get(code) || 0)
          : totalOnHand
      const unitBasis = product.outlet_units_basis || (source === 'outlet_transfer' ? 'received' : 'catalog_on_hand')
      return {
        ...product,
        sku: code,
        product_name: product.product_name || 'Product details unavailable',
        outletUnits,
        unitBasis,
        unitBasisLabel: unitBasis === 'received' ? 'Received' : 'Current on hand',
        source,
        sourceLabel: source === 'outlet_transfer'
          ? 'Received transfer'
          : 'Outlet stock',
        transferId: owner?.transferId || product.outlet_transfer_id || null,
        fromShop: owner?.fromShop || product.outlet_from_shop || '',
        locatedAt: owner?.locatedAt || product.outlet_located_at || '',
      }
    })
    .sort((a, b) => {
      const aTime = new Date(a.locatedAt || 0).getTime() || 0
      const bTime = new Date(b.locatedAt || 0).getTime() || 0
      return bTime - aTime || a.sku.localeCompare(b.sku, undefined, { numeric: true })
    })
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
