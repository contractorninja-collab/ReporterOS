import useStore from '../store/useStore.js'

export default function OutletScopeControl({ className = '' }) {
  const excludeOutlet = useStore((state) => state.excludeOutletAnalytics)
  const setExcludeOutlet = useStore((state) => state.setExcludeOutletAnalytics)

  return (
    <div className={['outlet-scope-control', className].filter(Boolean).join(' ')}>
      <span className="outlet-scope-control__label">Outlet products</span>
      <div className="outlet-scope-control__choices" role="group" aria-label="Outlet product scope">
        <button
          type="button"
          className={`outlet-scope-control__choice${!excludeOutlet ? ' is-active' : ''}`}
          aria-pressed={!excludeOutlet}
          onClick={() => setExcludeOutlet(false)}
        >
          Include Outlet
        </button>
        <button
          type="button"
          className={`outlet-scope-control__choice${excludeOutlet ? ' is-active' : ''}`}
          aria-pressed={excludeOutlet}
          onClick={() => setExcludeOutlet(true)}
        >
          Exclude Outlet
        </button>
      </div>
    </div>
  )
}
