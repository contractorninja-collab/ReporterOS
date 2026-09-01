import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Globe2,
  ImageOff,
  PackageCheck,
  Search,
  Store,
  Truck,
} from 'lucide-react'
import useStore from '../store/useStore.js'
import { isExecutive } from '../utils/roles.js'
import { buildOutletInventory, outletWebChecklistProgress } from '../utils/outletHub.js'
import { toTitleCase } from '../utils/textFormat.js'

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function OutletImage({ src, sku }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) {
    return <div className="oh-product-image oh-product-image--empty" aria-label={`No image for ${sku}`}><ImageOff size={22} /></div>
  }
  return <img className="oh-product-image" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
}

function MetricCard({ icon, label, value, detail, tone = 'neutral' }) {
  return (
    <article className={`oh-metric oh-metric--${tone}`}>
      <div className="oh-metric__icon">{icon}</div>
      <div className="oh-metric__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  )
}

function TransferStatus({ status }) {
  const label = status === 'received' ? 'Received' : status === 'completed' ? 'Awaiting Outlet' : 'Verification'
  return <span className={`oh-status oh-status--${status || 'pending'}`}>{label}</span>
}

export function OutletHub() {
  const navigate = useNavigate()
  const skus = useStore((state) => state.skus)
  const shipmentMeta = useStore((state) => state.shipmentMeta)
  const transfers = useStore((state) => state.outletTransfers)
  const markdownLists = useStore((state) => state.markdownLists)
  const photoMap = useStore((state) => state.photoMap)
  const activeUser = useStore((state) => state.activeUser)
  const executive = isExecutive(activeUser)
  const [tab, setTab] = useState('overview')
  const [query, setQuery] = useState('')

  const inventory = useMemo(() => buildOutletInventory({
    skus,
    shipmentMeta,
    transfers,
    markdownLists,
  }), [markdownLists, shipmentMeta, skus, transfers])

  const webProgress = useMemo(
    () => outletWebChecklistProgress(markdownLists),
    [markdownLists],
  )

  const sortedTransfers = useMemo(
    () => [...transfers].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [transfers],
  )

  const filteredInventory = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return inventory
    return inventory.filter((item) => [item.sku, item.product_name, item.brand, item.category]
      .some((value) => String(value || '').toLocaleLowerCase().includes(needle)))
  }, [inventory, query])

  const pendingVerification = transfers.filter((transfer) => transfer.status === 'pending').length
  const awaitingOutlet = transfers.filter((transfer) => transfer.status === 'completed').length
  const outletUnits = inventory.reduce((sum, product) => sum + (Number(product.outletUnits) || 0), 0)
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'inventory', label: 'Inventory', count: inventory.length },
    { id: 'transfers', label: 'Transfers', count: pendingVerification + awaitingOutlet },
    ...(executive ? [{ id: 'web', label: 'Web Location', count: webProgress.remainingItems }] : []),
  ]

  const openTransfer = (id) => navigate(`/outlet?transfer=${encodeURIComponent(id)}`)

  return (
    <div className="oh-page">
      <header className="oh-hero">
        <div>
          <div className="oh-eyebrow"><Store size={14} /> OUTLET OPERATIONS</div>
          <h1>Everything Outlet, in one place.</h1>
          <p>Physical stock, incoming transfers and website-location work across every season.</p>
        </div>
        <div className="oh-all-seasons"><span /> All seasons combined</div>
      </header>

      <nav className="oh-tabs" aria-label="Outlet sections">
        {tabs.map((item) => (
          <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
            {item.label}
            {item.count > 0 && <span>{item.count}</span>}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="oh-panel-stack">
          <section className="oh-metrics" aria-label="Outlet summary">
            <MetricCard icon={<PackageCheck size={21} />} label="Outlet SKUs" value={inventory.length} detail="Officially located in Outlet" tone="violet" />
            <MetricCard icon={<Store size={21} />} label="Tracked units" value={outletUnits} detail="Verified units received" tone="blue" />
            <MetricCard icon={<Truck size={21} />} label="Incoming" value={pendingVerification + awaitingOutlet} detail={`${pendingVerification} verifying · ${awaitingOutlet} awaiting receipt`} tone="amber" />
            {executive && (
              <MetricCard icon={<Globe2 size={21} />} label="Web updates" value={webProgress.remainingItems} detail={`${webProgress.markedItems}/${webProgress.totalItems} products marked`} tone="green" />
            )}
          </section>

          <section className="oh-grid-2">
            <article className="oh-card">
              <div className="oh-card__head">
                <div><span className="oh-card__eyebrow">Live workflow</span><h2>What needs attention</h2></div>
              </div>
              <div className="oh-action-list">
                <button type="button" onClick={() => setTab('transfers')}>
                  <span className="oh-action-list__icon oh-action-list__icon--amber"><Clock3 size={18} /></span>
                  <span><strong>Transfer verification</strong><small>{pendingVerification ? `${pendingVerification} transfer${pendingVerification === 1 ? '' : 's'} waiting` : 'Nothing waiting'}</small></span>
                  <ArrowRight size={17} />
                </button>
                <button type="button" onClick={() => setTab('transfers')}>
                  <span className="oh-action-list__icon oh-action-list__icon--blue"><PackageCheck size={18} /></span>
                  <span><strong>Outlet receipt</strong><small>{awaitingOutlet ? `${awaitingOutlet} transfer${awaitingOutlet === 1 ? '' : 's'} ready to receive` : 'Everything received'}</small></span>
                  <ArrowRight size={17} />
                </button>
                {executive && (
                  <button type="button" onClick={() => setTab('web')}>
                    <span className="oh-action-list__icon oh-action-list__icon--green"><Globe2 size={18} /></span>
                    <span><strong>Change Location Web</strong><small>{webProgress.remainingItems ? `${webProgress.remainingItems} product${webProgress.remainingItems === 1 ? '' : 's'} remaining` : 'Website locations are up to date'}</small></span>
                    <ArrowRight size={17} />
                  </button>
                )}
              </div>
            </article>

            <article className="oh-card">
              <div className="oh-card__head">
                <div><span className="oh-card__eyebrow">Recent activity</span><h2>Latest transfers</h2></div>
                <button type="button" className="oh-text-button" onClick={() => setTab('transfers')}>View all</button>
              </div>
              <div className="oh-recent-list">
                {sortedTransfers.slice(0, 4).map((transfer) => (
                  <button key={transfer.id} type="button" onClick={() => openTransfer(transfer.id)}>
                    <span><strong>{transfer.fromShop || 'Shop'} → Outlet</strong><small>{formatDate(transfer.createdAt)} · {(transfer.items || []).length} SKUs</small></span>
                    <TransferStatus status={transfer.status} />
                  </button>
                ))}
                {!sortedTransfers.length && <div className="oh-empty-inline">No Outlet transfers yet.</div>}
              </div>
            </article>
          </section>

          <section className="oh-card oh-preview">
            <div className="oh-card__head">
              <div><span className="oh-card__eyebrow">Physical Outlet</span><h2>Recently located products</h2></div>
              <button type="button" className="oh-text-button" onClick={() => setTab('inventory')}>Open inventory</button>
            </div>
            <div className="oh-preview-grid">
              {inventory.slice(0, 6).map((product) => (
                <article key={product.sku}>
                  <OutletImage src={photoMap?.[product.sku]} sku={product.sku} />
                  <div><strong>{product.sku}</strong><span>{product.outletUnits} units</span></div>
                </article>
              ))}
              {!inventory.length && <div className="oh-empty-inline">Products appear here after Outlet receipt or full three-party confirmation.</div>}
            </div>
          </section>

          <div className="oh-data-note">
            <Globe2 size={17} />
            <span><strong>Outlet sales reporting is next.</strong> It will become accurate once imported sales include the selling location and channel; this module does not guess those figures.</span>
          </div>
        </div>
      )}

      {tab === 'inventory' && (
        <section className="oh-card oh-inventory-card">
          <div className="oh-card__head oh-card__head--responsive">
            <div><span className="oh-card__eyebrow">All seasons</span><h2>Outlet inventory</h2><p>Only products officially located in Outlet are shown.</p></div>
            <label className="oh-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU or product" /></label>
          </div>
          <div className="oh-inventory-table-wrap">
            <table className="oh-inventory-table">
              <thead><tr><th>Product</th><th>Outlet units</th><th>Source</th><th>Season info</th></tr></thead>
              <tbody>
                {filteredInventory.map((product) => (
                  <tr key={product.sku}>
                    <td><div className="oh-product-cell"><OutletImage src={photoMap?.[product.sku]} sku={product.sku} /><span><strong>{product.sku}</strong><small>{toTitleCase(product.product_name)}</small></span></div></td>
                    <td><strong className="oh-unit-count">{product.outletUnits}</strong></td>
                    <td><span className="oh-source"><CheckCircle2 size={14} /> {product.sourceLabel}</span>{product.fromShop && <small className="oh-source-shop">From {product.fromShop}</small>}</td>
                    <td><span className="oh-season-meta">{product.season || product.current_season || 'Not recorded'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredInventory.length && <div className="oh-empty-state">{query ? 'No Outlet products match this search.' : 'No products are officially located in Outlet yet.'}</div>}
          </div>
        </section>
      )}

      {tab === 'transfers' && (
        <section className="oh-card">
          <div className="oh-card__head oh-card__head--responsive">
            <div><span className="oh-card__eyebrow">Physical movement</span><h2>Outlet transfers</h2><p>Follow products from a main shop through verification and Outlet receipt.</p></div>
            <button type="button" className="oh-primary-button" onClick={() => navigate('/outlet')}>Open full workflow <ArrowRight size={16} /></button>
          </div>
          <div className="oh-transfer-list">
            {sortedTransfers.map((transfer) => {
              const unitCount = (transfer.items || []).reduce((sum, item) => sum + (Number(item.totalQty ?? item.quantity) || 0), 0)
              return (
                <button key={transfer.id} type="button" onClick={() => openTransfer(transfer.id)}>
                  <span className="oh-transfer-list__route"><span><Truck size={18} /></span><span><strong>{transfer.fromShop || 'Shop'} → Outlet</strong><small>{formatDate(transfer.createdAt)}</small></span></span>
                  <span className="oh-transfer-list__counts"><strong>{(transfer.items || []).length}</strong><small>SKUs</small></span>
                  <span className="oh-transfer-list__counts"><strong>{unitCount}</strong><small>Units</small></span>
                  <TransferStatus status={transfer.status} />
                  <ArrowRight className="oh-transfer-list__arrow" size={17} />
                </button>
              )
            })}
            {!sortedTransfers.length && <div className="oh-empty-state">No Outlet transfers yet.</div>}
          </div>
        </section>
      )}

      {tab === 'web' && executive && (
        <section className="oh-card">
          <div className="oh-card__head">
            <div><span className="oh-card__eyebrow">Executive only</span><h2>Change Location Web</h2><p>Website-location checklists created after Outlet receipt.</p></div>
          </div>
          <div className="oh-web-list">
            {webProgress.lists.map((list) => {
              const transfer = transfers.find((item) => item.id === list.sourceTransferId)
              const percent = list.itemCount ? Math.round((list.markedCount / list.itemCount) * 100) : 0
              return (
                <button key={list.id} type="button" onClick={() => openTransfer(list.sourceTransferId)}>
                  <span className="oh-web-list__icon"><Globe2 size={20} /></span>
                  <span className="oh-web-list__copy"><strong>{transfer?.fromShop || 'Shop'} → Outlet</strong><small>Created {formatDate(list.createdAt || transfer?.receivedAt)}</small><span className="oh-progress"><i style={{ width: `${percent}%` }} /></span></span>
                  <span className="oh-web-list__number"><strong>{list.markedCount}/{list.itemCount}</strong><small>{list.remainingCount ? 'Remaining' : 'Completed'}</small></span>
                  <ArrowRight size={17} />
                </button>
              )
            })}
            {!webProgress.lists.length && <div className="oh-empty-state">No website-location checklists yet.</div>}
          </div>
        </section>
      )}
    </div>
  )
}
