import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { initDb, listJobs, getJob, getLeadsByJob, createJob } from './src/data/db.js'
import { startJob, attachSseClient, getJobSnapshot } from './src/scraping/scrapeOrchestrator.js'
import Papa from 'papaparse'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT || 3002
const HOST = process.env.LISTEN_HOST || '0.0.0.0'

initDb(path.join(__dirname, 'leads.db'))

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() })
})

// Kick off a new scraping job
app.post('/api/search', async (req, res) => {
  try {
    const { prompt, filters = {}, maxResults = 40 } = req.body || {}
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'Prompt is required (min 3 chars).' })
    }
    const jobId = createJob({ prompt: prompt.trim(), filters })
    // Fire and forget — orchestrator streams updates via SSE
    startJob(jobId, { prompt: prompt.trim(), filters, maxResults }).catch((err) => {
      console.error('[job error]', jobId, err)
    })
    res.json({ jobId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'Internal error' })
  }
})

// SSE — stream live updates for a job
app.get('/api/stream/:jobId', (req, res) => {
  const { jobId } = req.params
  const job = getJob(jobId)
  if (!job) return res.status(404).end()

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()

  const snapshot = getJobSnapshot(jobId)
  if (snapshot) {
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
  }

  const detach = attachSseClient(jobId, (evt) => {
    res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.payload)}\n\n`)
  })

  // Heartbeat
  const hb = setInterval(() => {
    try { res.write(`:hb\n\n`) } catch { /* ignore */ }
  }, 15000)

  req.on('close', () => {
    clearInterval(hb)
    detach()
  })
})

app.get('/api/jobs', (_req, res) => {
  res.json(listJobs())
})

app.get('/api/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  const leads = getLeadsByJob(req.params.jobId)
  res.json({ ...job, leads })
})

app.get('/api/leads/:jobId', (req, res) => {
  res.json(getLeadsByJob(req.params.jobId))
})

app.get('/api/export/:jobId', (req, res) => {
  const leads = getLeadsByJob(req.params.jobId)
  const rows = leads.map((l) => ({
    company: l.company || '',
    person: l.person || '',
    title: l.title || '',
    emails: (l.emails || []).join('; '),
    phones: (l.phones || []).join('; '),
    website: l.website || '',
    linkedin: l.linkedin || '',
    twitter: l.twitter || '',
    instagram: l.instagram || '',
    facebook: l.facebook || '',
    location: l.location || '',
    source_url: l.source_url || '',
    snippet: l.snippet || '',
  }))
  const csv = Papa.unparse(rows)
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="leads-${req.params.jobId}.csv"`,
  })
  res.send(csv)
})

// Serve built frontend in production
const dist = path.join(__dirname, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.listen(PORT, HOST, () => {
  console.log(`\n  LeadGen API listening on http://${HOST}:${PORT}`)
  console.log(`  Frontend dev:  http://localhost:5174\n`)
})
