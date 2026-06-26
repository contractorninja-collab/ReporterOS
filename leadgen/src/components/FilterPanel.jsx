export function FilterPanel({ filters, onChange, maxResults, onMaxResultsChange, disabled }) {
  const fields = [
    { key: 'role', label: 'Role / Title', placeholder: 'e.g. CMO, Founder, Head of Sales' },
    { key: 'industry', label: 'Industry', placeholder: 'e.g. fintech, fashion, SaaS' },
    { key: 'location', label: 'Location', placeholder: 'e.g. London, Berlin' },
    { key: 'company', label: 'Company name', placeholder: 'optional' },
  ]
  return (
    <div className="lg-card" style={{ marginTop: 12 }}>
      <div className="lg-section-title">Refine search</div>
      <div className="lg-filters">
        {fields.map((f) => (
          <div className="lg-filter" key={f.key}>
            <label htmlFor={`f-${f.key}`}>{f.label}</label>
            <input
              id={`f-${f.key}`}
              className="lg-input"
              value={filters[f.key] || ''}
              placeholder={f.placeholder}
              disabled={disabled}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          </div>
        ))}
        <div className="lg-filter">
          <label htmlFor="f-max">Max results</label>
          <input
            id="f-max"
            type="number"
            min={5}
            max={200}
            className="lg-input"
            value={maxResults}
            disabled={disabled}
            onChange={(e) => onMaxResultsChange(Number(e.target.value) || 40)}
          />
        </div>
      </div>
    </div>
  )
}
