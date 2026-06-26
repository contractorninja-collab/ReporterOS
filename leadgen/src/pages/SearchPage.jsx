import { useEffect, useState } from 'react'
import { Radar } from 'lucide-react'
import { useStore } from '../store/useStore.js'
import { PromptBar } from '../components/PromptBar.jsx'
import { FilterPanel } from '../components/FilterPanel.jsx'
import { JobProgress } from '../components/JobProgress.jsx'
import { ResultsTable } from '../components/ResultsTable.jsx'
import { ExportButton } from '../components/ExportButton.jsx'
import { HistorySidebar } from '../components/HistorySidebar.jsx'

export function SearchPage() {
  const [filtersOpen, setFiltersOpen] = useState(false)

  const prompt = useStore((s) => s.prompt)
  const filters = useStore((s) => s.filters)
  const maxResults = useStore((s) => s.maxResults)
  const status = useStore((s) => s.status)
  const stage = useStore((s) => s.stage)
  const stageDetail = useStore((s) => s.stageDetail)
  const progress = useStore((s) => s.progress)
  const leadCount = useStore((s) => s.leadCount)
  const pagesScraped = useStore((s) => s.pagesScraped)
  const leads = useStore((s) => s.leads)
  const error = useStore((s) => s.error)
  const history = useStore((s) => s.history)
  const jobId = useStore((s) => s.jobId)

  const setPrompt = useStore((s) => s.setPrompt)
  const setFilter = useStore((s) => s.setFilter)
  const setMaxResults = useStore((s) => s.setMaxResults)
  const runSearch = useStore((s) => s.runSearch)
  const loadHistory = useStore((s) => s.loadHistory)
  const loadJob = useStore((s) => s.loadJob)

  useEffect(() => { loadHistory() }, [loadHistory])

  const isRunning = status === 'running'

  return (
    <div className="lg-shell">
      <header className="lg-header">
        <div className="lg-brand">
          <div className="lg-brand-mark"><Radar size={20} color="#fff" /></div>
          <div>
            <div className="lg-brand-title">LeadGen</div>
            <div className="lg-brand-sub">AI-powered lead discovery</div>
          </div>
        </div>
        <ExportButton jobId={jobId} leadCount={leads.length} />
      </header>

      <section className="lg-hero">
        <h1>Find anyone. Anywhere on the web.</h1>
        <p>
          Describe the leads you want in plain English. We&apos;ll search the web,
          visit their sites, and extract verified emails, phone numbers, and contact
          details — streaming results back live.
        </p>
      </section>

      <div>
        <PromptBar
          value={prompt}
          onChange={setPrompt}
          onSubmit={runSearch}
          disabled={isRunning}
          onToggleFilters={() => setFiltersOpen((v) => !v)}
          filtersOpen={filtersOpen}
        />
        {filtersOpen && (
          <FilterPanel
            filters={filters}
            onChange={setFilter}
            maxResults={maxResults}
            onMaxResultsChange={setMaxResults}
            disabled={isRunning}
          />
        )}
      </div>

      {error && <div className="lg-error">{error}</div>}

      <JobProgress
        status={status}
        stage={stage}
        stageDetail={stageDetail}
        progress={progress}
        leadCount={leadCount}
        pagesScraped={pagesScraped}
      />

      <div className="lg-grid-main">
        <div className="lg-results">
          <div className="lg-results-header">
            <div className="lg-results-title">
              Results
              {leads.length > 0 && <span className="lg-badge">{leads.length}</span>}
            </div>
            <ExportButton jobId={jobId} leadCount={leads.length} />
          </div>
          <ResultsTable leads={leads} loading={isRunning} />
        </div>

        <HistorySidebar
          history={history}
          currentJobId={jobId}
          onSelect={(id) => loadJob(id)}
        />
      </div>
    </div>
  )
}
