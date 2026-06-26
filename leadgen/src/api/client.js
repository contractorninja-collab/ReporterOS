const BASE = '/api'

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!res.ok) {
    let body
    try { body = await res.json() } catch { body = { error: res.statusText } }
    const e = new Error(body.error || res.statusText)
    e.status = res.status
    throw e
  }
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

export const startSearch = (prompt, filters = {}, maxResults = 40) =>
  request('/search', { method: 'POST', body: JSON.stringify({ prompt, filters, maxResults }) })

export const listJobs = () => request('/jobs')
export const fetchJob = (jobId) => request(`/jobs/${jobId}`)
export const fetchLeads = (jobId) => request(`/leads/${jobId}`)

export const exportCsvUrl = (jobId) => `${BASE}/export/${jobId}`

export function openJobStream(jobId, { onProgress, onLead, onDone, onError, onSnapshot } = {}) {
  const ev = new EventSource(`${BASE}/stream/${jobId}`)
  ev.addEventListener('snapshot', (e) => onSnapshot?.(JSON.parse(e.data)))
  ev.addEventListener('progress', (e) => onProgress?.(JSON.parse(e.data)))
  ev.addEventListener('lead', (e) => onLead?.(JSON.parse(e.data)))
  ev.addEventListener('done', (e) => { onDone?.(JSON.parse(e.data)); ev.close() })
  // Server-sent 'error' events carry data; the built-in connection-error
  // event has no data and should not fail the job.
  ev.addEventListener('error', (e) => {
    if (!e.data) return
    try { onError?.(JSON.parse(e.data)) } catch { onError?.(null) }
  })
  return ev
}
