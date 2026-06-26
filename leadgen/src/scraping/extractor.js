// Pure regex / heuristic extractors. No external deps.

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi

// International-ish phone matcher: tolerates +country, spaces, dots, dashes, parens.
const PHONE_RE = /(?:(?:\+|00)\d{1,3}[ .\-]?)?(?:\(?\d{2,4}\)?[ .\-]?){2,4}\d{2,4}/g

const LINKEDIN_PROFILE_RE = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub|company)\/[A-Za-z0-9_\-./%]+/gi
const TWITTER_RE = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/(?!intent|share|i\/|home|search)[A-Za-z0-9_]{1,30}\b/gi
const INSTAGRAM_RE = /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore\/|stories\/)[A-Za-z0-9_.]{1,30}/gi
const FACEBOOK_RE = /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|tr|dialog|plugins|login|events\/)[A-Za-z0-9_.\-]{2,60}/gi

const BAD_EMAIL_PARTS = [
  'sentry', 'wixpress', 'example.com', 'yourdomain', 'domain.com',
  'sample.com', 'test.com', 'email@', 'name@', 'firstname',
]
const BAD_EMAIL_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf']

export function extractEmails(text) {
  if (!text) return []
  const set = new Set()
  const matches = text.match(EMAIL_RE) || []
  for (const m of matches) {
    const e = m.toLowerCase().trim()
    if (BAD_EMAIL_PARTS.some((b) => e.includes(b))) continue
    if (BAD_EMAIL_EXT.some((b) => e.endsWith(b))) continue
    // Strip trailing punctuation
    const cleaned = e.replace(/[.,;:'"\)]+$/, '')
    if (cleaned.length > 80) continue
    set.add(cleaned)
  }
  return [...set]
}

export function extractPhones(text) {
  if (!text) return []
  const set = new Set()
  const matches = text.match(PHONE_RE) || []
  for (const raw of matches) {
    const digits = raw.replace(/[^\d+]/g, '')
    // Require enough digits to plausibly be a phone (>= 9)
    const digitCount = digits.replace(/\D/g, '').length
    if (digitCount < 9 || digitCount > 15) continue
    // Skip obvious garbage like long ID-looking sequences with no separators
    if (raw.length < 9) continue
    const normalized = normalizePhone(raw.trim())
    set.add(normalized)
  }
  return [...set]
}

function normalizePhone(s) {
  // Collapse runs of whitespace
  return s.replace(/\s+/g, ' ').trim()
}

export function extractLinkedIn(text) {
  if (!text) return []
  return uniq((text.match(LINKEDIN_PROFILE_RE) || []).map(cleanUrl))
}

export function extractTwitter(text) {
  if (!text) return []
  return uniq((text.match(TWITTER_RE) || []).map(cleanUrl))
}

export function extractInstagram(text) {
  if (!text) return []
  return uniq((text.match(INSTAGRAM_RE) || []).map(cleanUrl))
}

export function extractFacebook(text) {
  if (!text) return []
  return uniq((text.match(FACEBOOK_RE) || []).map(cleanUrl))
}

function cleanUrl(u) {
  return u.replace(/[)\].,;:"']+$/, '').replace(/\?.*$/, '')
}

function uniq(arr) { return [...new Set(arr)] }

// Try to guess a person's name + title from a SERP snippet or page text.
// Snippets often look like: "Jane Doe — Chief Marketing Officer at AcmeCo · London..."
export function extractPersonName(text) {
  if (!text) return null
  // Two- or three-token capitalized name at the start, optionally followed by separators.
  const m = text.match(/(?:^|[\.|·•—–\-]\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/)
  return m ? m[1].trim() : null
}

export function extractTitle(text) {
  if (!text) return null
  const titleKeywords = [
    'CEO', 'CTO', 'CFO', 'COO', 'CMO', 'CIO', 'CHRO', 'CISO', 'CPO',
    'Founder', 'Co-Founder', 'Co-founder', 'Owner',
    'President', 'Vice President', 'VP',
    'Director', 'Head of', 'Manager', 'Lead',
    'Engineer', 'Designer', 'Architect', 'Analyst',
    'Marketing', 'Sales', 'Operations', 'Product', 'Engineering',
    'Chief Executive', 'Chief Marketing', 'Chief Technology', 'Chief Operating', 'Chief Financial',
  ]
  for (const kw of titleKeywords) {
    const re = new RegExp(`\\b([A-Za-z][A-Za-z &/\\-]{0,40}?${escapeRe(kw)}[A-Za-z &/\\-]{0,40})\\b`)
    const m = text.match(re)
    if (m) return m[1].trim().replace(/\s+/g, ' ').slice(0, 80)
  }
  return null
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export function extractLocation(text) {
  if (!text) return null
  // Look for "based in X" / "located in X" / "HQ in X"
  const m = text.match(/\b(?:based|located|headquartered|HQ)\s+(?:in|at)\s+([A-Z][A-Za-z .,\-]{2,40})/)
  if (m) return m[1].trim()
  return null
}

// Domain helpers
export function domainFromUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export function companyFromDomain(domain) {
  if (!domain) return ''
  const base = domain.split('.')[0]
  return base.charAt(0).toUpperCase() + base.slice(1)
}

// Filter out generic / personal email providers when we want company emails
export function isFreeMailDomain(domain) {
  return new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
    'icloud.com', 'aol.com', 'protonmail.com', 'gmx.com', 'mail.com',
    'yandex.com', 'msn.com',
  ]).has(domain)
}
