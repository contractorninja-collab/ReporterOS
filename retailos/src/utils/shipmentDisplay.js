import { formatShortImportDate } from './lifecycle.js'

function toMs(value) {
  if (!value) return NaN
  const d = value instanceof Date ? value : new Date(value)
  return d.getTime()
}

/**
 * Primary + optional secondary truck lines for product tiles.
 * @param {object} sku aggregated product row, optionally merged with shipment meta
 */
export function getShipmentDisplayLines(sku) {
  const lastRaw = sku.last_shipment_date ?? sku.last_import_date ?? sku.import_date
  const season = String(sku.current_season || sku.season || '').trim()

  const secondary = (() => {
    const lastMs = toMs(lastRaw)

    if (sku.prior_same_season_shipment) {
      const priorMs = toMs(sku.prior_same_season_shipment)
      if (!Number.isNaN(priorMs) && priorMs !== lastMs) {
        return {
          season,
          dateDisplay: formatShortImportDate(sku.prior_same_season_shipment),
        }
      }
    }

    if (sku.has_prior_season_carryover && sku.current_season_first_shipment) {
      const firstMs = toMs(sku.current_season_first_shipment)
      if (!Number.isNaN(firstMs) && firstMs !== lastMs) {
        return {
          season,
          dateDisplay: formatShortImportDate(sku.current_season_first_shipment),
        }
      }
    }

    return null
  })()

  return {
    primaryLabel: 'Last import',
    primaryDate: formatShortImportDate(lastRaw),
    secondary,
  }
}

/** Merge shipment meta map fields onto an aggregated SKU row. */
export function mergeShipmentMeta(sku, shipmentMetaBySku) {
  if (!sku || !shipmentMetaBySku) return sku
  const meta = shipmentMetaBySku[sku.sku]
  if (!meta) return sku
  return {
    ...sku,
    first_arrival_date: meta.first_arrival_date ?? sku.import_date,
    last_shipment_date: meta.last_shipment_date ?? sku.last_import_date,
    current_season: meta.current_season ?? sku.season,
    current_season_first_shipment: meta.current_season_first_shipment ?? null,
    current_season_last_shipment: meta.current_season_last_shipment ?? null,
    prior_same_season_shipment: meta.prior_same_season_shipment ?? null,
    has_prior_season_carryover: Boolean(meta.has_prior_season_carryover),
    shipment_count: meta.shipment_count ?? 0,
    last_import_date: meta.last_shipment_date ?? sku.last_import_date,
    import_date: meta.first_arrival_date ?? sku.import_date,
  }
}
