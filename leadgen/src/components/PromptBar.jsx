import { Search, Sparkles, SlidersHorizontal } from 'lucide-react'

const EXAMPLES = [
  'CMOs at fintech startups in London',
  'Owners of fashion boutiques in Paris',
  'Founders of SaaS companies in Berlin',
  'Heads of marketing at e-commerce brands',
]

export function PromptBar({
  value, onChange, onSubmit, disabled, onToggleFilters, filtersOpen,
}) {
  function handleKey(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onSubmit()
    }
  }
  return (
    <div className="lg-prompt-wrap">
      <textarea
        className="lg-prompt"
        placeholder="Describe the leads you want. e.g. ‘Find CMOs at fintech startups in London with phone numbers’"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        rows={3}
        disabled={disabled}
      />
      <div className="lg-prompt-actions">
        <button
          type="button"
          className="lg-btn-ghost"
          onClick={onToggleFilters}
          disabled={disabled}
        >
          <SlidersHorizontal size={13} />
          {filtersOpen ? 'Hide filters' : 'Filters'}
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>⌘+↵ to run</span>
          <button
            type="button"
            className="lg-btn-primary"
            onClick={onSubmit}
            disabled={disabled || !value || value.trim().length < 3}
          >
            <Search size={15} />
            {disabled ? 'Searching…' : 'Find leads'}
          </button>
        </div>
      </div>
      <div className="lg-chip-row" style={{ marginTop: 12 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, alignSelf: 'center', marginRight: 4 }}>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="lg-chip"
            onClick={() => onChange(ex)}
            disabled={disabled}
          >
            <span className="lg-chip-icon"><Sparkles size={11} /> {ex}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
