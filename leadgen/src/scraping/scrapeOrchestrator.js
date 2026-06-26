// Orchestrates a single search job:
//   prompt + filters
//     -> queryBuilder -> N queries
//     -> SERP scrape -> candidate URLs
//     -> contactScraper -> leads
//     -> SQLite persist + SSE updates
//
// Exposes:
//   startJob(jobId, opts) — kicks off async job
//   attachSseClient(jobId, cb) — registers an SSE listener
//   getJobSnapshot(jobId) — current state for late-joining SSE clients

import { buildQueries } from './queryBuilder.js'
import { searchSerp } from './googleScraper.js'
import { scrapeContactPage } from './contactScraper.js'
import { insertLead, updateJob, getJob, findExistingLeadKey } from '../data/db.js'
import { sleep } from './browser.js'

const sseClients = new Map() // jobId -> Set<(evt)=>void>
const snapshots = new Map()  // jobId -> { status, stage, progress, leadCount, pagesScraped }

function emit(jobId, type, payload) {
  const listeners = sseClients.get(jobId)
  if (!listeners) return
  for (const cb of listeners) {
    try { cb({ type, payload }) } catch { /* ignore */ }
  }
}

export function attachSseClient(jobId, cb) {
  if (!sseClients.has(jobId)) sseClients.set(jobId, new Set())
  sseClients.get(jobId).add(cb)
  return () => {
    sseClients.get(jobId)?.delete(cb)
  }
}

export function getJobSnapshot(jobId) {
  return snapshots.get(jobId) || null
}

function setSnapshot(jobId, patch) {
  const cur = snapshots.get(jobId) || {}
  const next = { ...cur, ...patch }
  snapshots.set(jobId, next)
  return next
}

export async function startJob(jobId, { prompt, filters, maxResults = 40 }) {
  const job = getJob(jobId)
  if (!job) throw new Error(`Job ${jobId} not found`)

  setSnapshot(jobId, {
    status: 'running', stage: 'planning',
    stageDetail: 'Generating search strategy',
    progress: 0, leadCount: 0, pagesScraped: 0,
  })
  updateJob(jobId, { status: 'running', stage: 'planning', stage_detail: 'Generating search strategy', progress: 1 })
  emit(jobId, 'progress', snapshots.get(jobId))

  try {
    const queries = buildQueries(prompt, filters)
    setSnapshot(jobId, { stage: 'searching', stageDetail: `Running ${queries.length} searches` })
    updateJob(jobId, { stage: 'searching', stage_detail: `Running ${queries.length} searches`, progress: 5 })
    emit(jobId, 'progress', snapshots.get(jobId))

    // Phase 1 — collect candidate URLs from all queries
    /** @type {Array<{title:string, url:string, snippet:string, query:string}>} */
    const candidates = []
    const seenUrls = new Set()
    const seenHosts = new Set()

    for (let qi = 0; qi < queries.length; qi += 1) {
      const q = queries[qi]
      setSnapshot(jobId, { stageDetail: `Searching: ${truncate(q.query, 60)}` })
      emit(jobId, 'progress', snapshots.get(jobId))

      try {
        const items = await searchSerp(q, { limit: 10 })
        for (const it of items) {
          if (seenUrls.has(it.url)) continue
          seenUrls.add(it.url)

          // Dedupe by host so we don't hit the same domain twice
          let host = ''
          try { host = new URL(it.url).hostname.replace(/^www\./, '') } catch { continue }
          if (host.includes('linkedin.com')) {
            // Keep LinkedIn separate — we don't follow into linkedin.com (blocked)
            // but the snippet often contains name + title.
            candidates.push({ ...it, query: q.query, isLinkedIn: true })
            continue
          }
          if (seenHosts.has(host)) continue
          seenHosts.add(host)
          candidates.push({ ...it, query: q.query, isLinkedIn: false })
        }
      } catch (err) {
        console.warn(`[orchestrator] SERP failed for "${q.query}":`, err.message)
      }

      const pct = 5 + Math.round(((qi + 1) / queries.length) * 25)
      setSnapshot(jobId, { progress: pct, pagesScraped: qi + 1 })
      updateJob(jobId, { progress: pct, pages_scraped: qi + 1 })
      emit(jobId, 'progress', snapshots.get(jobId))

      await sleep(800, 1800)

      if (candidates.length >= maxResults * 2) break
    }

    // Phase 2 — turn LinkedIn-only candidates into leads from their snippets.
    setSnapshot(jobId, { stage: 'extracting', stageDetail: 'Extracting LinkedIn snippets' })
    updateJob(jobId, { stage: 'extracting', stage_detail: 'Extracting LinkedIn snippets', progress: 32 })
    emit(jobId, 'progress', snapshots.get(jobId))

    for (const c of candidates) {
      if (!c.isLinkedIn) continue
      const lead = leadFromLinkedInSnippet(c)
      if (!lead) continue
      if (findExistingLeadKey(jobId, lead.company || lead.source_url)) continue
      const saved = insertLead(jobId, lead)
      const ls = setSnapshot(jobId, { leadCount: (snapshots.get(jobId).leadCount || 0) + 1 })
      updateJob(jobId, { lead_count: ls.leadCount })
      emit(jobId, 'lead', saved)
    }

    // Phase 3 — scrape contact pages for the non-LinkedIn candidates
    const sites = candidates.filter((c) => !c.isLinkedIn).slice(0, Math.max(8, Math.floor(maxResults * 1.2)))
    setSnapshot(jobId, { stage: 'scraping', stageDetail: `Visiting ${sites.length} websites` })
    updateJob(jobId, { stage: 'scraping', stage_detail: `Visiting ${sites.length} websites`, progress: 35 })
    emit(jobId, 'progress', snapshots.get(jobId))

    const CONCURRENCY = 3
    let idx = 0
    let pagesDone = 0

    async function worker() {
      while (true) {
        const myIdx = idx++
        if (myIdx >= sites.length) return
        const c = sites[myIdx]
        try {
          const leads = await scrapeContactPage(c.url, { initialSnippet: c.snippet })
          for (const lead of leads) {
            const key = lead.company || lead.source_url
            if (findExistingLeadKey(jobId, key)) continue
            const merged = mergeWithSnippet(lead, c)
            const saved = insertLead(jobId, merged)
            const ls = setSnapshot(jobId, { leadCount: (snapshots.get(jobId).leadCount || 0) + 1 })
            updateJob(jobId, { lead_count: ls.leadCount })
            emit(jobId, 'lead', saved)
          }
        } catch (err) {
          console.warn(`[orchestrator] scrape ${c.url} failed:`, err.message)
        }
        pagesDone += 1
        const pct = 35 + Math.round((pagesDone / Math.max(1, sites.length)) * 60)
        const snap = setSnapshot(jobId, {
          progress: pct,
          pagesScraped: queries.length + pagesDone,
          stageDetail: `Scraping ${pagesDone} / ${sites.length} sites`,
        })
        updateJob(jobId, { progress: pct, pages_scraped: queries.length + pagesDone, stage_detail: snap.stageDetail })
        emit(jobId, 'progress', snap)

        if (snap.leadCount >= maxResults) {
          idx = sites.length
          return
        }
        await sleep(500, 1200)
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    const final = setSnapshot(jobId, {
      status: 'completed', stage: 'done',
      stageDetail: `Found ${snapshots.get(jobId).leadCount} lead(s)`,
      progress: 100,
    })
    updateJob(jobId, {
      status: 'completed', stage: 'done', stage_detail: final.stageDetail,
      progress: 100, finished_at: Date.now(),
    })
    emit(jobId, 'progress', final)
    emit(jobId, 'done', final)
  } catch (err) {
    console.error('[orchestrator] fatal', err)
    const snap = setSnapshot(jobId, {
      status: 'error', stage: 'error',
      stageDetail: err.message || String(err),
    })
    updateJob(jobId, {
      status: 'error', stage: 'error', stage_detail: snap.stageDetail,
      error: err.message || String(err), finished_at: Date.now(),
    })
    emit(jobId, 'progress', snap)
    emit(jobId, 'error', { error: snap.stageDetail })
  }
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// LinkedIn pages can't be scraped, but their SERP snippet gives us
// "Name — Title at Company · Location · ..."
function leadFromLinkedInSnippet(c) {
  const title = c.title || ''
  const snippet = c.snippet || ''
  // Try to parse "Jane Doe - CMO at AcmeCo | LinkedIn"
  const titleMatch = title.match(/^([^|\-—–·]+?)\s*[\-—–|]\s*(.+?)(?:\s+(?:at|@)\s+(.+?))?\s*[\-|–·]\s*LinkedIn/i)
  let person = null
  let role = null
  let company = null

  if (titleMatch) {
    person = clean(titleMatch[1])
    role = clean(titleMatch[2])
    if (titleMatch[3]) company = clean(titleMatch[3])
    if (role && /\s+at\s+/.test(role)) {
      const parts = role.split(/\s+at\s+/)
      role = clean(parts[0])
      company = clean(parts[1])
    }
  } else {
    // Loose fallback
    const m = title.match(/^([A-Z][\w']+(?:\s+[A-Z][\w']+){1,2})/)
    if (m) person = m[1]
  }
  if (!person) return null
  return {
    company: company || null,
    person,
    title: role || null,
    linkedin: c.url,
    snippet,
    source_url: c.url,
    score: 0.55,
  }
}

function clean(s) {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null
}

function mergeWithSnippet(lead, candidate) {
  return {
    ...lead,
    snippet: (lead.snippet || candidate.snippet || '').slice(0, 240),
  }
}
