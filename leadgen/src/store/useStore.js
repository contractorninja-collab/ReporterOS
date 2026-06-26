import { create } from 'zustand'
import * as api from '../api/client.js'

export const useStore = create((set, get) => ({
  prompt: '',
  filters: { role: '', industry: '', location: '', company: '' },
  maxResults: 40,
  jobId: null,
  status: 'idle',     // 'idle' | 'running' | 'completed' | 'error'
  stage: null,
  stageDetail: null,
  progress: 0,
  leadCount: 0,
  pagesScraped: 0,
  error: null,
  leads: [],
  history: [],
  stream: null,

  setPrompt: (prompt) => set({ prompt }),
  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  setMaxResults: (n) => set({ maxResults: n }),

  async loadHistory() {
    try {
      const history = await api.listJobs()
      set({ history })
    } catch (err) {
      console.warn('history load failed', err)
    }
  },

  async runSearch() {
    const { prompt, filters, maxResults, stream } = get()
    if (!prompt || prompt.trim().length < 3) {
      set({ error: 'Please enter a prompt with at least 3 characters.' })
      return
    }
    if (stream) { try { stream.close() } catch { /* */ } }
    set({
      status: 'running', stage: 'queued', stageDetail: 'Submitting…',
      progress: 0, leadCount: 0, pagesScraped: 0,
      leads: [], error: null, jobId: null, stream: null,
    })
    try {
      const { jobId } = await api.startSearch(prompt.trim(), filters, maxResults)
      const es = api.openJobStream(jobId, {
        onSnapshot: (snap) => set((s) => mergeSnapshot(s, snap)),
        onProgress: (snap) => set((s) => mergeSnapshot(s, snap)),
        onLead: (lead) => set((s) => ({ leads: [...s.leads, lead] })),
        onDone: (snap) => {
          set((s) => ({ ...mergeSnapshot(s, snap), status: 'completed', stream: null }))
          get().loadHistory()
        },
        onError: (data) => set({ status: 'error', error: data?.error || 'Job failed', stream: null }),
      })
      set({ jobId, stream: es })
      get().loadHistory()
    } catch (err) {
      set({ status: 'error', error: err.message || 'Failed to start search' })
    }
  },

  async loadJob(jobId) {
    const { stream } = get()
    if (stream) { try { stream.close() } catch { /* */ } }
    set({ jobId, leads: [], status: 'running', stage: 'loading', progress: 0, error: null })
    try {
      const job = await api.fetchJob(jobId)
      set({
        prompt: job.prompt,
        filters: { ...get().filters, ...(job.filters || {}) },
        leads: job.leads || [],
        leadCount: job.lead_count || (job.leads || []).length,
        progress: job.progress || 100,
        status: job.status === 'running' ? 'running' : (job.status === 'error' ? 'error' : 'completed'),
        stage: job.stage,
        stageDetail: job.stage_detail,
        error: job.error,
        stream: null,
      })
      if (job.status === 'running') {
        const es = api.openJobStream(jobId, {
          onProgress: (snap) => set((s) => mergeSnapshot(s, snap)),
          onLead: (lead) => set((s) => ({ leads: [...s.leads, lead] })),
          onDone: (snap) => set((s) => ({ ...mergeSnapshot(s, snap), status: 'completed', stream: null })),
          onError: (data) => set({ status: 'error', error: data?.error, stream: null }),
        })
        set({ stream: es })
      }
    } catch (err) {
      set({ status: 'error', error: err.message })
    }
  },

  reset() {
    const { stream } = get()
    if (stream) { try { stream.close() } catch { /* */ } }
    set({
      jobId: null, status: 'idle', stage: null, stageDetail: null,
      progress: 0, leadCount: 0, pagesScraped: 0, error: null, leads: [], stream: null,
    })
  },
}))

function mergeSnapshot(s, snap) {
  if (!snap) return {}
  return {
    status: snap.status || s.status,
    stage: snap.stage ?? s.stage,
    stageDetail: snap.stageDetail ?? snap.stage_detail ?? s.stageDetail,
    progress: typeof snap.progress === 'number' ? snap.progress : s.progress,
    leadCount: typeof snap.leadCount === 'number' ? snap.leadCount : s.leadCount,
    pagesScraped: typeof snap.pagesScraped === 'number' ? snap.pagesScraped : s.pagesScraped,
  }
}
