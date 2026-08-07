export function normalizeBrandInput(value) {
  return String(value ?? '').trim()
}

export function brandKey(value) {
  return normalizeBrandInput(value).toLocaleLowerCase('en-US')
}

function isAllUppercase(value) {
  const upper = value.toLocaleUpperCase('en-US')
  const lower = value.toLocaleLowerCase('en-US')
  return value === upper && value !== lower
}

/**
 * Build a case-insensitive lookup while preserving the established spelling.
 * When case-only duplicates already exist, prefer the all-caps variant used by
 * the catalog (for example, DIADORA over Diadora).
 */
export function buildCanonicalBrandMap(values = []) {
  const groups = new Map()

  values.forEach((value, index) => {
    const brand = normalizeBrandInput(value)
    if (!brand) return
    const key = brandKey(brand)
    if (!groups.has(key)) groups.set(key, new Map())
    const variants = groups.get(key)
    const current = variants.get(brand) || { value: brand, count: 0, firstIndex: index }
    current.count += 1
    variants.set(brand, current)
  })

  const canonical = new Map()
  for (const [key, variants] of groups) {
    const choice = [...variants.values()].sort((a, b) => {
      const uppercaseDiff = Number(isAllUppercase(b.value)) - Number(isAllUppercase(a.value))
      if (uppercaseDiff !== 0) return uppercaseDiff
      if (b.count !== a.count) return b.count - a.count
      return a.firstIndex - b.firstIndex
    })[0]
    canonical.set(key, choice.value)
  }
  return canonical
}

/**
 * Resolve a brand against a canonical lookup. New brands keep their supplied
 * spelling and become the canonical spelling for the remainder of the batch.
 */
export function canonicalizeBrand(value, canonicalBrands) {
  const brand = normalizeBrandInput(value)
  if (!brand) return ''
  const key = brandKey(brand)
  const existing = canonicalBrands?.get(key)
  if (existing) return existing
  canonicalBrands?.set(key, brand)
  return brand
}
