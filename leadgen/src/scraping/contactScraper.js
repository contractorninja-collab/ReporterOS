// Visit a target URL and extract contact data. Tries the home page first,
// then probes likely "contact" / "about" / "team" subpaths if needed.

import { newContext, sleep } from './browser.js'
import {
  extractEmails, extractPhones,
  extractLinkedIn, extractTwitter, extractInstagram, extractFacebook,
  extractTitle, extractLocation, domainFromUrl, companyFromDomain, isFreeMailDomain,
} from './extractor.js'

const SUBPATHS = ['/contact', '/contact-us', '/about', '/about-us', '/team', '/leadership', '/people']

/**
 * Scrape a single domain. Returns an array of leads (often 1, sometimes more
 * when a /team page lists multiple people).
 */
export async function scrapeContactPage(seedUrl, { initialSnippet = '', timeout = 18000 } = {}) {
  const ctx = await newContext()
  const page = await ctx.newPage()
  const collected = {
    emails: new Set(),
    phones: new Set(),
    linkedin: new Set(),
    twitter: new Set(),
    instagram: new Set(),
    facebook: new Set(),
    titles: new Set(),
    location: null,
    visitedUrls: [],
  }
  try {
    const seedHost = safeHost(seedUrl)
    if (!seedHost) return []

    const seedOrigin = `https://${seedHost}`

    // Visit the seed URL plus common contact paths.
    const urlsToTry = uniq([seedUrl, ...SUBPATHS.map((p) => seedOrigin + p)]).slice(0, 5)

    for (const u of urlsToTry) {
      const ok = await scrapeOne(page, u, collected, timeout)
      // If we've got at least one email + phone after the seed, stop probing.
      if (collected.emails.size > 0 && collected.phones.size > 0) break
      if (!ok) await sleep(400, 900)
      else await sleep(900, 1800)
    }

    const domain = seedHost
    const emails = [...collected.emails]
    const phones = [...collected.phones]

    if (!emails.length && !phones.length && !collected.linkedin.size) {
      // Nothing usable — fall back to a synthetic lead from the snippet so the
      // user still sees the company in the table.
      if (initialSnippet || domain) {
        return [{
          company: companyFromDomain(domain),
          website: seedOrigin,
          source_url: seedUrl,
          snippet: initialSnippet.slice(0, 240),
          emails: [], phones: [],
          linkedin: [...collected.linkedin][0] || null,
          score: 0.2,
        }]
      }
      return []
    }

    return [{
      company: companyFromDomain(domain),
      website: seedOrigin,
      emails,
      phones,
      linkedin: [...collected.linkedin][0] || null,
      twitter: [...collected.twitter][0] || null,
      instagram: [...collected.instagram][0] || null,
      facebook: [...collected.facebook][0] || null,
      title: [...collected.titles][0] || null,
      location: collected.location,
      source_url: seedUrl,
      snippet: initialSnippet.slice(0, 240),
      score: scoreLead({ emails, phones, domain }),
    }]
  } catch (err) {
    console.warn(`[contactScraper] ${seedUrl} failed:`, err.message)
    return []
  } finally {
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
  }
}

async function scrapeOne(page, url, c, timeout) {
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
    if (!resp || !resp.ok()) return false
    c.visitedUrls.push(url)
    // Pull both visible text and full HTML to also catch mailto: / tel: links.
    const text = await page.evaluate(() => document.body?.innerText || '')
    const html = await page.content()

    // Extract from text
    for (const e of extractEmails(text)) c.emails.add(e)
    for (const p of extractPhones(text)) c.phones.add(p)
    for (const l of extractLinkedIn(text)) c.linkedin.add(l)
    for (const l of extractTwitter(text)) c.twitter.add(l)
    for (const l of extractInstagram(text)) c.instagram.add(l)
    for (const l of extractFacebook(text)) c.facebook.add(l)

    // Also from raw HTML (mailto:/tel: links, hidden attributes)
    const mailtos = html.match(/mailto:([^"'\s<>]+)/gi) || []
    for (const m of mailtos) {
      const addr = m.replace(/^mailto:/i, '').split('?')[0].toLowerCase()
      if (addr.includes('@')) c.emails.add(addr)
    }
    const tels = html.match(/tel:([^"'\s<>]+)/gi) || []
    for (const t of tels) {
      const num = t.replace(/^tel:/i, '').trim()
      if (num.length >= 7) c.phones.add(num)
    }

    const title = extractTitle(text)
    if (title) c.titles.add(title)

    const loc = extractLocation(text)
    if (loc && !c.location) c.location = loc

    return true
  } catch (err) {
    return false
  }
}

function safeHost(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function uniq(arr) { return [...new Set(arr)] }

function scoreLead({ emails, phones, domain }) {
  let s = 0
  if (emails.length) s += 0.4 + Math.min(emails.length, 3) * 0.08
  if (phones.length) s += 0.25 + Math.min(phones.length, 2) * 0.05
  // Penalize freemail-only contact info
  if (emails.length && emails.every((e) => isFreeMailDomain(e.split('@')[1] || ''))) s -= 0.15
  if (domain && !isFreeMailDomain(domain)) s += 0.1
  return Math.max(0, Math.min(1, s))
}
