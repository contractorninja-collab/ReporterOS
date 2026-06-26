// Multi-engine SERP scraper.
// We prefer DuckDuckGo (rarely captchas) and Bing as fallbacks because
// Google aggressively challenges headless traffic. The "engine" name is
// kept as `google` only for legacy/naming reasons in the orchestrator.

import { newContext, sleep } from './browser.js'

const BLOCKED_HOSTS = new Set([
  'duckduckgo.com', 'bing.com', 'google.com', 'youtube.com',
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'pinterest.com',
])

/**
 * @param {{ engine: 'ddg'|'bing'|'google', query: string }} q
 * @returns {Promise<Array<{title:string, url:string, snippet:string}>>}
 */
export async function searchSerp({ engine, query }, { limit = 10 } = {}) {
  const ctx = await newContext()
  const page = await ctx.newPage()
  try {
    if (engine === 'ddg') return await ddg(page, query, limit)
    if (engine === 'bing') return await bing(page, query, limit)
    return await ddg(page, query, limit) // default
  } finally {
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
  }
}

async function ddg(page, query, limit) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
  await sleep(800, 1600)
  const items = await page.$$eval('.result', (nodes) => {
    return nodes.map((n) => {
      const a = n.querySelector('a.result__a')
      const snippetEl = n.querySelector('.result__snippet')
      const href = a?.getAttribute('href') || ''
      const title = a?.textContent?.trim() || ''
      const snippet = snippetEl?.textContent?.trim() || ''
      return { title, url: href, snippet }
    })
  })
  return cleanResults(items, limit)
}

async function bing(page, query, limit) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
  await sleep(800, 1600)
  const items = await page.$$eval('#b_results > li.b_algo', (nodes) => {
    return nodes.map((n) => {
      const a = n.querySelector('h2 a')
      const snippetEl = n.querySelector('.b_caption p, .b_snippet, .b_lineclamp4, .b_paractl')
      const href = a?.getAttribute('href') || ''
      const title = a?.textContent?.trim() || ''
      const snippet = snippetEl?.textContent?.trim() || ''
      return { title, url: href, snippet }
    })
  })
  return cleanResults(items, limit)
}

function cleanResults(items, limit) {
  const out = []
  const seen = new Set()
  for (const it of items) {
    let url = decodeDdgUrl(it.url)
    if (!url || !url.startsWith('http')) continue
    let host = ''
    try { host = new URL(url).hostname.replace(/^www\./, '') } catch { continue }
    if (BLOCKED_HOSTS.has(host) && !host.includes('linkedin')) continue
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ title: it.title, url, snippet: it.snippet })
    if (out.length >= limit) break
  }
  return out
}

// DuckDuckGo HTML wraps target URLs in /l/?uddg=<encoded>
function decodeDdgUrl(href) {
  if (!href) return ''
  if (href.startsWith('//')) href = 'https:' + href
  try {
    const u = new URL(href)
    if (u.hostname.includes('duckduckgo.com') && u.pathname.startsWith('/l/')) {
      const real = u.searchParams.get('uddg')
      return real ? decodeURIComponent(real) : href
    }
  } catch { /* */ }
  return href
}
