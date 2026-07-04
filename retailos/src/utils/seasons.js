/** Default season chips shown even before SKUs exist for those codes. */
export const DEFAULT_SEASON_PRESETS = ['SS26', 'FW26']

/**
 * Normalize user-entered season code (trim; collapse internal whitespace).
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSeasonInput(raw) {
  if (raw == null) return ''
  return String(raw).trim().replace(/\s+/g, ' ')
}

/**
 * Collect distinct non-empty season values from SKU rows.
 * @param {Array<{ season?: string }>} skus
 * @returns {string[]}
 */
export function seasonsFromSkus(skus) {
  const set = new Set()
  if (!Array.isArray(skus)) return []
  for (const row of skus) {
    const s = normalizeSeasonInput(row?.season)
    if (s) set.add(s)
  }
  return [...set]
}

/**
 * Build ordered list for the topbar season switcher: specific seasons (sorted), then "All".
 * Ensures activeSeason appears even if missing from data/presets.
 *
 * @param {Array<{ season?: string }>} skus
 * @param {string[]} extraSeasons — user-added presets (localStorage)
 * @param {string} activeSeason — current filter
 * @returns {string[]}
 */
/**
 * @param {string} code
 * @returns {{ half: 'SS'|'FW', year: number } | null}
 */
export function parseSeasonCode(code) {
  const m = normalizeSeasonInput(code).match(/^(SS|FW)(\d{2})$/i)
  if (!m) return null
  return { half: m[1].toUpperCase(), year: parseInt(m[2], 10) }
}

/**
 * @returns {number} negative if a is earlier, positive if b is earlier, 0 if equal/unknown
 */
export function compareSeasons(a, b) {
  const na = normalizeSeasonInput(a)
  const nb = normalizeSeasonInput(b)
  if (!na || !nb) return 0
  if (na === nb) return 0
  const pa = parseSeasonCode(na)
  const pb = parseSeasonCode(nb)
  if (!pa || !pb) return na.localeCompare(nb, undefined, { sensitivity: 'base' })
  if (pa.year !== pb.year) return pa.year < pb.year ? -1 : 1
  if (pa.half === pb.half) return 0
  return pa.half === 'SS' ? -1 : 1
}

/** True when season a is chronologically before b (e.g. SS26 before FW26). */
export function isEarlierSeason(a, b) {
  return compareSeasons(a, b) < 0
}

/** Whether the global season chip filters to one season (not All). */
export function isSeasonFilterActive(activeSeason) {
  const s = normalizeSeasonInput(activeSeason)
  return Boolean(s && s.toLowerCase() !== 'all')
}

/**
 * Filter SKU rows by the topbar season chip.
 * @template T
 * @param {T[]} rows
 * @param {string} activeSeason
 * @param {(row: T) => string} [getSeason]
 */
export function filterSkusByActiveSeason(rows, activeSeason, getSeason = (r) => r?.season) {
  if (!Array.isArray(rows)) return []
  if (!isSeasonFilterActive(activeSeason)) return rows
  const target = normalizeSeasonInput(activeSeason)
  return rows.filter((r) => normalizeSeasonInput(getSeason(r)) === target)
}

/**
 * Match an aggregated product row against the topbar season chip.
 * When shipment metadata is available, a product belongs to a selected season
 * only if it has a real intake/import line for that season. This prevents
 * prior-season carryover stock from leaking into a newly selected season.
 */
export function productMatchesActiveSeason(row, activeSeason) {
  if (!isSeasonFilterActive(activeSeason)) return true
  const target = normalizeSeasonInput(activeSeason)
  if (normalizeSeasonInput(row?.active_season) === target && row?.active_season_has_shipment != null) {
    return Boolean(row.active_season_has_shipment)
  }
  return normalizeSeasonInput(row?.current_season || row?.season) === target
}

export function buildSeasonSwitcherList(skus, extraSeasons, activeSeason) {
  const set = new Set()
  for (const d of DEFAULT_SEASON_PRESETS) {
    const x = normalizeSeasonInput(d)
    if (x) set.add(x)
  }
  if (Array.isArray(extraSeasons)) {
    for (const e of extraSeasons) {
      const x = normalizeSeasonInput(e)
      if (x && x !== 'All') set.add(x)
    }
  }
  for (const s of seasonsFromSkus(skus)) {
    if (s !== 'All') set.add(s)
  }
  const act = normalizeSeasonInput(activeSeason)
  if (act && act !== 'All') set.add(act)

  const list = [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return [...list, 'All']
}
