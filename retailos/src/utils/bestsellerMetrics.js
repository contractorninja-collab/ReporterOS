export function enrichBestsellerProducts(products, salesData) {
  return products.map((product) => {
    const event = salesData[product.sku]
    if (!event) {
      return {
        ...product,
        _periodSold: 0,
        _periodRevenue: 0,
        netRevenue: 0,
        returnsCount: 0,
      }
    }

    return {
      ...product,
      _periodSold: event.sold_qty ?? 0,
      _periodRevenue: event.revenue ?? 0,
      netRevenue: event.revenue ?? 0,
      returnsCount: event.return_units ?? 0,
    }
  })
}
