import Database from 'better-sqlite3'
import crypto from 'node:crypto'

let db = null

export function initDb(filePath) {
  db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,
      prompt       TEXT NOT NULL,
      filters      TEXT NOT NULL DEFAULT '{}',
      status       TEXT NOT NULL DEFAULT 'queued',
      stage        TEXT,
      stage_detail TEXT,
      progress     INTEGER NOT NULL DEFAULT 0,
      lead_count   INTEGER NOT NULL DEFAULT 0,
      pages_scraped INTEGER NOT NULL DEFAULT 0,
      error        TEXT,
      created_at   INTEGER NOT NULL,
      finished_at  INTEGER
    );

    CREATE TABLE IF NOT EXISTS leads (
      id           TEXT PRIMARY KEY,
      job_id       TEXT NOT NULL,
      company      TEXT,
      person       TEXT,
      title        TEXT,
      emails       TEXT NOT NULL DEFAULT '[]',
      phones       TEXT NOT NULL DEFAULT '[]',
      website      TEXT,
      linkedin     TEXT,
      twitter      TEXT,
      instagram    TEXT,
      facebook     TEXT,
      location     TEXT,
      source_url   TEXT,
      snippet      TEXT,
      score        REAL NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_leads_job ON leads(job_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
  `)
  return db
}

function getDb() {
  if (!db) throw new Error('DB not initialized')
  return db
}

function newId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
}

export function createJob({ prompt, filters }) {
  const id = newId('j_')
  getDb().prepare(`
    INSERT INTO jobs (id, prompt, filters, status, created_at)
    VALUES (?, ?, ?, 'queued', ?)
  `).run(id, prompt, JSON.stringify(filters || {}), Date.now())
  return id
}

export function updateJob(jobId, patch) {
  const fields = []
  const values = []
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`)
    values.push(v)
  }
  if (!fields.length) return
  values.push(jobId)
  getDb().prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function getJob(jobId) {
  const row = getDb().prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId)
  if (!row) return null
  return {
    ...row,
    filters: safeParse(row.filters, {}),
  }
}

export function listJobs(limit = 50) {
  return getDb().prepare(`
    SELECT id, prompt, status, stage, stage_detail, progress, lead_count, pages_scraped, error, created_at, finished_at
    FROM jobs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit)
}

export function insertLead(jobId, lead) {
  const id = newId('l_')
  const row = {
    id,
    job_id: jobId,
    company: lead.company || null,
    person: lead.person || null,
    title: lead.title || null,
    emails: JSON.stringify(lead.emails || []),
    phones: JSON.stringify(lead.phones || []),
    website: lead.website || null,
    linkedin: lead.linkedin || null,
    twitter: lead.twitter || null,
    instagram: lead.instagram || null,
    facebook: lead.facebook || null,
    location: lead.location || null,
    source_url: lead.source_url || null,
    snippet: lead.snippet || null,
    score: lead.score || 0,
    created_at: Date.now(),
  }
  getDb().prepare(`
    INSERT INTO leads (id, job_id, company, person, title, emails, phones, website,
                       linkedin, twitter, instagram, facebook, location, source_url, snippet, score, created_at)
    VALUES (@id, @job_id, @company, @person, @title, @emails, @phones, @website,
            @linkedin, @twitter, @instagram, @facebook, @location, @source_url, @snippet, @score, @created_at)
  `).run(row)

  getDb().prepare(`UPDATE jobs SET lead_count = lead_count + 1 WHERE id = ?`).run(jobId)
  return { ...row, emails: lead.emails || [], phones: lead.phones || [] }
}

export function getLeadsByJob(jobId) {
  const rows = getDb().prepare(`SELECT * FROM leads WHERE job_id = ? ORDER BY score DESC, created_at ASC`).all(jobId)
  return rows.map(deserializeLead)
}

export function findExistingLeadKey(jobId, key) {
  const row = getDb().prepare(`
    SELECT id FROM leads WHERE job_id = ?
    AND (
      (company IS NOT NULL AND lower(company) = lower(?)) OR
      (source_url IS NOT NULL AND source_url = ?)
    )
    LIMIT 1
  `).get(jobId, key, key)
  return !!row
}

function deserializeLead(row) {
  return {
    ...row,
    emails: safeParse(row.emails, []),
    phones: safeParse(row.phones, []),
  }
}

function safeParse(s, fallback) {
  if (!s) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}
