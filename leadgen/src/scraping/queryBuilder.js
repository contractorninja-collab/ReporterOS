// Translate a natural-language prompt + structured filters into a set of
// targeted Google search queries that maximize the chance of yielding leads
// with contact information.

const ROLE_HINTS = [
  'CEO', 'CTO', 'CMO', 'CFO', 'COO', 'CIO', 'CHRO', 'CPO',
  'founder', 'co-founder', 'owner', 'president', 'director',
  'head of', 'VP', 'vice president', 'manager', 'lead',
  'marketing', 'sales', 'engineer', 'designer', 'product',
]

const INDUSTRY_HINTS = [
  'fintech', 'saas', 'ecommerce', 'e-commerce', 'retail', 'fashion',
  'crypto', 'health', 'healthcare', 'medtech', 'biotech', 'edtech',
  'logistics', 'real estate', 'manufacturing', 'gaming', 'media',
  'agency', 'consulting', 'B2B', 'startup', 'enterprise',
]

const LOCATION_HINTS = [
  'london', 'new york', 'paris', 'berlin', 'amsterdam', 'dubai',
  'beirut', 'tokyo', 'singapore', 'tel aviv', 'austin', 'sf',
  'san francisco', 'los angeles', 'usa', 'uk', 'europe', 'middle east',
  'germany', 'france', 'lebanon', 'spain', 'italy',
]

export function parsePrompt(prompt) {
  const lower = prompt.toLowerCase()
  const role = ROLE_HINTS.find((r) => lower.includes(r.toLowerCase())) || null
  const industry = INDUSTRY_HINTS.find((i) => lower.includes(i)) || null
  const location = LOCATION_HINTS.find((l) => lower.includes(l)) || null
  return { role, industry, location }
}

function dedupe(arr) {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))]
}

// Returns array of { engine, query } where engine is one of: google, bing, ddg
export function buildQueries(prompt, filters = {}) {
  const parsed = parsePrompt(prompt)
  const role = filters.role || parsed.role
  const industry = filters.industry || parsed.industry
  const location = filters.location || parsed.location
  const company = filters.company || null

  const roleQ = role ? `"${role}"` : ''
  const industryQ = industry ? `"${industry}"` : ''
  const locationQ = location ? location : ''
  const companyQ = company ? `"${company}"` : ''

  const base = [roleQ, industryQ, locationQ, companyQ].filter(Boolean).join(' ').trim()

  // If we couldn't parse anything specific, fall back to the raw prompt.
  const fallback = base || prompt.replace(/["']/g, '').slice(0, 120)

  const queries = []

  // 1. LinkedIn profile searches (best for people)
  queries.push(`${fallback} site:linkedin.com/in`)
  if (role && industry) {
    queries.push(`${roleQ} ${industryQ} site:linkedin.com/in`)
  }
  if (role && location) {
    queries.push(`${roleQ} ${locationQ} site:linkedin.com/in`)
  }

  // 2. LinkedIn company searches (for company names)
  if (industry) queries.push(`${industryQ} ${locationQ} site:linkedin.com/company`.trim())

  // 3. Direct contact/email finders (yields company pages and team pages)
  queries.push(`${fallback} email contact`)
  queries.push(`${fallback} "@" contact`)
  queries.push(`${fallback} "phone" OR "tel:" contact`)

  // 4. About / team pages
  queries.push(`${fallback} (about OR team OR leadership) inurl:about`)
  queries.push(`${fallback} inurl:team`)

  // 5. Plain web search using the user's wording (catches anything else)
  if (prompt && prompt.length < 200) {
    queries.push(prompt)
  }

  return dedupe(queries).slice(0, 8).map((q) => ({ engine: pickEngine(q), query: q }))
}

// Alternate between engines to spread load and avoid hammering one source.
let engineRotation = 0
function pickEngine(_q) {
  const engines = ['ddg', 'bing', 'ddg'] // DDG more often (lighter / less captcha)
  const e = engines[engineRotation % engines.length]
  engineRotation += 1
  return e
}
