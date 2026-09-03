import { isOutletOwnedProduct } from '../utils/outletHub.js'

export default function ProductLocationBadge({ product, className = '' }) {
  if (!isOutletOwnedProduct(product)) return null
  return (
    <span className={['product-location-badge', className].filter(Boolean).join(' ')}>
      Location · Outlet
    </span>
  )
}
