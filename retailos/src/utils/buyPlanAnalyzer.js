import { aggregateSkus } from './aggregateSkus'
import { getDaysInStore, getSellThrough } from './lifecycle'
import { genderBucketKey } from './gender.js'

function inferNextSeason(code) {
  const m = (code || '').match(/^(SS|FW)(\d{2})$/i)
  if (!m) return code ? `Next after ${code}` : '—'
  const prefix = m[1].toUpperCase()
  const yr = parseInt(m[2], 10)
  return `${prefix}${yr + 1}`
}

function pct(n, total) {
  return total > 0 ? (n / total) * 100 : 0
}

/**
 * Analyse a single season's SKU data and produce structured buy-plan recommendations.
 * @param {Array} allSkus - full raw SKU rows (not aggregated)
 * @param {string} seasonCode - e.g. "SS26"
 */
export function analyzeSeason(allSkus, seasonCode) {
  const seasonRows = allSkus.filter((s) => s.season === seasonCode)
  const products = aggregateSkus(seasonRows)

  const totalStocked = products.reduce((s, p) => s + p.quantity, 0)
  const totalSold = products.reduce((s, p) => s + p.sold_quantity, 0)
  const overallST = getSellThrough(totalSold, totalStocked)
  const totalRevenue = products.reduce((s, p) => s + (p.netRevenue ?? 0), 0)

  const overall = {
    totalStocked,
    totalSold,
    sellThrough: Math.round(overallST),
    revenue: Math.round(totalRevenue),
    skuCount: products.length,
  }

  const categories = buildCategoryRecs(products, overallST, totalRevenue)
  const genderMix = buildGenderMix(products)
  const sizeCurve = buildSizeCurve(seasonRows)
  const topPerformers = buildTopPerformers(products)
  const bottomPerformers = buildBottomPerformers(products)
  const brands = buildBrandScorecard(products, totalRevenue)

  const adjustmentCount =
    categories.filter((c) => c.recommendation !== 'Maintain').length +
    genderMix.filter((g) => g.recommendation !== 'Balanced').length

  return {
    season: seasonCode,
    nextSeason: inferNextSeason(seasonCode),
    overall,
    adjustmentCount,
    categories,
    genderMix,
    sizeCurve,
    topPerformers,
    bottomPerformers,
    brands,
  }
}

function buildCategoryRecs(products, overallST, totalRevenue) {
  const catMap = {}
  for (const p of products) {
    const cat = (p.category || 'Other').trim()
    if (!catMap[cat]) catMap[cat] = { stocked: 0, sold: 0, revenue: 0, a: 0, b: 0, c: 0 }
    const e = catMap[cat]
    e.stocked += p.quantity
    e.sold += p.sold_quantity
    e.revenue += p.netRevenue ?? 0
  }

  const sorted = [...Object.entries(catMap)]
    .sort(([, a], [, b]) => b.revenue - a.revenue)

  assignABCTiers(products, catMap)

  return sorted.map(([name, d]) => {
    const st = getSellThrough(d.sold, d.stocked)
    const diff = st - overallST
    let recommendation = 'Maintain'
    let pctChange = 0
    if (diff >= 10) { recommendation = 'Increase'; pctChange = 15 }
    else if (diff <= -10) { recommendation = 'Decrease'; pctChange = -15 }
    return {
      name,
      stocked: d.stocked,
      sold: d.sold,
      sellThrough: Math.round(st),
      revenue: Math.round(d.revenue),
      revenueShare: Math.round(pct(d.revenue, totalRevenue)),
      recommendation,
      pctChange,
      abcBreakdown: { A: d.a, B: d.b, C: d.c },
    }
  })
}

function assignABCTiers(products, catMap) {
  const sorted = [...products].sort(
    (a, b) => (b.netRevenue ?? 0) - (a.netRevenue ?? 0),
  )
  const totalRev = sorted.reduce((s, p) => s + (p.netRevenue ?? 0), 0)
  if (totalRev === 0) return
  let cum = 0
  for (const p of sorted) {
    cum += p.netRevenue ?? 0
    const cumPct = (cum / totalRev) * 100
    const tier = cumPct <= 80 ? 'a' : cumPct <= 95 ? 'b' : 'c'
    const cat = (p.category || 'Other').trim()
    if (catMap[cat]) catMap[cat][tier]++
  }
}

function buildGenderMix(products) {
  const cats = {}
  for (const p of products) {
    const cat = (p.category || 'Other').trim()
    const g = genderBucketKey(p.gender)
    if (!cats[cat]) cats[cat] = {}
    if (!cats[cat][g]) cats[cat][g] = { stocked: 0, sold: 0 }
    cats[cat][g].stocked += p.quantity
    cats[cat][g].sold += p.sold_quantity
  }

  const result = []
  for (const [cat, genders] of Object.entries(cats)) {
    const catStocked = Object.values(genders).reduce((s, g) => s + g.stocked, 0)
    const catSold = Object.values(genders).reduce((s, g) => s + g.sold, 0)
    for (const [gender, d] of Object.entries(genders)) {
      const stockShare = Math.round(pct(d.stocked, catStocked))
      const salesShare = Math.round(pct(d.sold, catSold))
      const st = Math.round(getSellThrough(d.sold, d.stocked))
      let recommendation = 'Balanced'
      if (stockShare - salesShare >= 10) recommendation = 'Reduce allocation'
      else if (salesShare - stockShare >= 10) recommendation = 'Increase allocation'
      result.push({ category: cat, gender, stocked: d.stocked, sold: d.sold, stockShare, salesShare, sellThrough: st, recommendation })
    }
  }
  return result
}

function buildSizeCurve(rawRows) {
  const catMap = {}
  for (const row of rawRows) {
    const cat = (row.category || 'Other').trim()
    const size = (row.size || '').trim()
    if (!size) continue
    if (!catMap[cat]) catMap[cat] = {}
    if (!catMap[cat][size]) catMap[cat][size] = { qty: 0, sold: 0 }
    catMap[cat][size].qty += Number(row.quantity) || 0
    catMap[cat][size].sold += Number(row.sold_quantity) || 0
  }

  const result = []
  for (const [cat, sizes] of Object.entries(catMap)) {
    const entries = Object.entries(sizes).map(([size, d]) => ({
      size,
      stocked: d.qty,
      sold: d.sold,
      sellThrough: d.qty > 0 ? Math.round((d.sold / d.qty) * 100) : 0,
    }))
    entries.sort((a, b) => b.sellThrough - a.sellThrough)
    const avgST = entries.reduce((s, e) => s + e.sellThrough, 0) / (entries.length || 1)
    const overStocked = entries.filter((e) => e.sellThrough < avgST - 15 && e.stocked > 0)
    const underStocked = entries.filter((e) => e.sellThrough > avgST + 15 || (e.sold >= e.stocked && e.stocked > 0))

    let suggestion = 'Size distribution looks balanced.'
    if (underStocked.length && overStocked.length) {
      suggestion = `Shift toward ${underStocked.map((s) => s.size).join(', ')}; reduce ${overStocked.map((s) => s.size).join(', ')}.`
    } else if (underStocked.length) {
      suggestion = `Increase depth in sizes ${underStocked.map((s) => s.size).join(', ')}.`
    } else if (overStocked.length) {
      suggestion = `Reduce sizes ${overStocked.map((s) => s.size).join(', ')}.`
    }

    result.push({ category: cat, sizes: entries, overStocked, underStocked, suggestion })
  }
  return result
}

function buildTopPerformers(products) {
  return products
    .filter((p) => getSellThrough(p.sold_quantity, p.quantity) >= 60)
    .map((p) => {
      const days = Math.max(1, getDaysInStore(p.import_date))
      return {
        sku: p.sku,
        name: p.product_name,
        category: (p.category || 'Other').trim(),
        gender: genderBucketKey(p.gender),
        sellThrough: Math.round(getSellThrough(p.sold_quantity, p.quantity)),
        velocity: +(p.sold_quantity / days).toFixed(2),
      }
    })
    .sort((a, b) => b.sellThrough - a.sellThrough)
    .slice(0, 20)
}

function buildBottomPerformers(products) {
  return products
    .filter((p) => getSellThrough(p.sold_quantity, p.quantity) < 15 && getDaysInStore(p.import_date) > 60)
    .map((p) => ({
      sku: p.sku,
      name: p.product_name,
      category: (p.category || 'Other').trim(),
      gender: genderBucketKey(p.gender),
      sellThrough: Math.round(getSellThrough(p.sold_quantity, p.quantity)),
      daysInStore: getDaysInStore(p.import_date),
    }))
    .sort((a, b) => a.sellThrough - b.sellThrough)
    .slice(0, 20)
}

function buildBrandScorecard(products, totalRevenue) {
  const brandMap = {}
  for (const p of products) {
    const b = (p.brand || 'Unknown').trim()
    if (!brandMap[b]) brandMap[b] = { stocked: 0, sold: 0, revenue: 0, count: 0 }
    const e = brandMap[b]
    e.stocked += p.quantity
    e.sold += p.sold_quantity
    e.revenue += p.netRevenue ?? 0
    e.count++
  }

  return Object.entries(brandMap)
    .map(([brand, d]) => ({
      brand,
      skuCount: d.count,
      sellThrough: Math.round(getSellThrough(d.sold, d.stocked)),
      revenueShare: Math.round(pct(d.revenue, totalRevenue)),
      recommendation:
        getSellThrough(d.sold, d.stocked) >= 50
          ? 'Increase'
          : getSellThrough(d.sold, d.stocked) < 20
            ? 'Reduce'
            : 'Maintain',
    }))
    .sort((a, b) => b.revenueShare - a.revenueShare)
}

export function getDistinctSeasons(skus) {
  const set = new Set()
  for (const s of skus) {
    if (s.season) set.add(s.season)
  }
  return [...set].sort()
}
