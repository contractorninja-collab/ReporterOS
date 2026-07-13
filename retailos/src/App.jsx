import { useState, useEffect, Component, lazy, Suspense } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore'
import { Sidebar } from './components/Sidebar.jsx'
import { Topbar } from './components/Topbar.jsx'
import SaleSeasonExperience from './components/SaleSeasonExperience.jsx'
import { IconDashboard, IconPlanning, IconPlus, IconImport, IconMenu } from './utils/icons.js'
import { RequireExecutive } from './components/RequireExecutive.jsx'
import { isExecutive } from './utils/roles.js'
import * as api from './api/client.js'

const lazyNamed = (loader, exportName) =>
  lazy(() => loader().then((mod) => ({ default: mod[exportName] })))

const Dashboard = lazyNamed(() => import('./pages/Dashboard.jsx'), 'Dashboard')
const Lifecycle = lazyNamed(() => import('./pages/Lifecycle.jsx'), 'Lifecycle')
const Bestsellers = lazyNamed(() => import('./pages/Bestsellers.jsx'), 'Bestsellers')
const Reports = lazyNamed(() => import('./pages/Reports.jsx'), 'Reports')
const ImportCSV = lazyNamed(() => import('./pages/ImportCSV.jsx'), 'ImportCSV')
const Photos = lazyNamed(() => import('./pages/Photos.jsx'), 'Photos')
const Footwear = lazyNamed(() => import('./pages/Footwear.jsx'), 'Footwear')
const Apparel = lazyNamed(() => import('./pages/Apparel.jsx'), 'Apparel')
const Accessories = lazyNamed(() => import('./pages/Accessories.jsx'), 'Accessories')
const MyTasks = lazyNamed(() => import('./pages/MyTasks.jsx'), 'MyTasks')
const OutletTransfers = lazyNamed(() => import('./pages/OutletTransfers.jsx'), 'OutletTransfers')
const StoreTransfers = lazyNamed(() => import('./pages/StoreTransfers.jsx'), 'StoreTransfers')
const UserManagement = lazyNamed(() => import('./pages/UserManagement.jsx'), 'UserManagement')
const ProductLookup = lazyNamed(() => import('./pages/ProductLookup.jsx'), 'ProductLookup')
const BuyPlanning = lazyNamed(() => import('./pages/BuyPlanning.jsx'), 'BuyPlanning')
const TransferBuilder = lazyNamed(() => import('./pages/TransferBuilder.jsx'), 'TransferBuilder')
const MarkdownBuilder = lazy(() => import('./pages/MarkdownBuilder.jsx'))
const MarkdownLists = lazy(() => import('./pages/MarkdownLists.jsx'))
const ShiftBoard = lazyNamed(() => import('./pages/ShiftBoard.jsx'), 'ShiftBoard')
const SmartAlerts = lazyNamed(() => import('./pages/SmartAlerts.jsx'), 'SmartAlerts')
const ActivityLog = lazyNamed(() => import('./pages/ActivityLog.jsx'), 'ActivityLog')
const RecycleBin = lazyNamed(() => import('./pages/RecycleBin.jsx'), 'RecycleBin')

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err, info) {
    console.error(err, info)
  }

  render() {
    if (this.state.err) {
      const msg = String(this.state.err?.message || this.state.err)
      return (
        <div
          style={{
            padding: 32,
            background: '#09090e',
            color: 'var(--ro-text)',
            minHeight: '100vh',
            fontFamily: '"DM Sans", sans-serif',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Something went wrong</div>
          <pre style={{ fontSize: 12, color: '#ff8888', whiteSpace: 'pre-wrap', marginBottom: 20 }}>{msg}</pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: '#ff3333',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
              fontFamily: '"DM Sans", sans-serif',
            }}
          >
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function GlowBackground({ children }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#06060a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: '"DM Sans"',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}

function LoginScreen() {
  const _apiOnline = useStore((s) => s._apiOnline)
  const setActiveUser = useStore((s) => s.setActiveUser)
  const initFromServer = useStore((s) => s.initFromServer)
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)

  const canSubmit = code.length === 5 && pin.length === 4

  const handleLogin = async () => {
    if (!canSubmit || busy) return
    setError('')
    if (_apiOnline) {
      setBusy(true)
      try {
        const { user } = await api.authLogin(code, pin)
        setActiveUser(user)
        setCode('')
        setPin('')
        await initFromServer()
      } catch {
        setError('Invalid code or PIN')
        setShake(true)
        setTimeout(() => setShake(false), 500)
      } finally {
        setBusy(false)
      }
      return
    }
    setError('Server unavailable. Please reconnect to sign in.')
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }

  const loginInputStyle = {
    width: '100%',
    background: 'var(--ro-fill-faint)',
    border: '1px solid var(--ro-border-hover)',
    borderRadius: 12,
    padding: '14px 16px',
    color: 'var(--ro-text)',
    fontSize: 18,
    fontWeight: 600,
    fontFamily: '"DM Sans"',
    outline: 'none',
    textAlign: 'center',
    letterSpacing: '6px',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    backdropFilter: 'blur(8px)',
  }

  return (
    <GlowBackground>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div className="glow-pulse" style={{ position: 'absolute', top: '-25%', left: '50%', transform: 'translateX(-50%)', width: '120%', height: '55%', background: 'radial-gradient(ellipse, rgba(56,189,248,0.07) 0%, transparent 65%)', filter: 'blur(50px)' }} />
        <div style={{ position: 'absolute', bottom: '-15%', right: '10%', width: '50%', height: '45%', background: 'radial-gradient(ellipse, rgba(192,132,252,0.05) 0%, transparent 65%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', top: '40%', left: '-10%', width: '35%', height: '35%', background: 'radial-gradient(circle, rgba(251,191,36,0.03) 0%, transparent 65%)', filter: 'blur(50px)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(var(--ro-fill-faint) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      </div>

      <div
        style={{
          width: 360,
          position: 'relative',
          zIndex: 2,
          animation: shake ? 'shake 0.4s ease' : undefined,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 38, letterSpacing: '-0.5px', lineHeight: 1, marginBottom: 10 }}>
            <span style={{ fontWeight: 300, color: '#6b6b80' }}>intel</span>
            <span style={{ fontWeight: 700, color: '#fff' }}>Retail</span>
          </div>
          <div
            style={{
              fontSize: 7.5,
              fontWeight: 500,
              letterSpacing: '1.1px',
              textTransform: 'uppercase',
              background: 'linear-gradient(90deg, #5a5a72, #8888aa, #5a5a72)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              lineHeight: 1.25,
            }}
          >
            Your Intelligent Retail Assistant
          </div>
        </div>

        <div
          style={{
            background: 'var(--ro-table-row-hover)',
            border: '1px solid var(--ro-border)',
            borderRadius: 20,
            padding: '36px 32px 32px',
            backdropFilter: 'blur(16px)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.4), transparent)',
            }}
          />

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#5a5a72', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>
              User Code
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={5}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 5)); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="00000"
              autoFocus
              style={{
                ...loginInputStyle,
                borderColor: error ? 'rgba(255,51,51,0.4)' : code.length === 5 ? 'rgba(56,189,248,0.3)' : 'var(--ro-border-hover)',
                boxShadow: code.length === 5 && !error ? '0 0 20px rgba(56,189,248,0.08)' : error ? '0 0 20px rgba(255,51,51,0.08)' : 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: 28 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#5a5a72', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>
              PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="0000"
              style={{
                ...loginInputStyle,
                borderColor: error ? 'rgba(255,51,51,0.4)' : pin.length === 4 ? 'rgba(192,132,252,0.3)' : 'var(--ro-border-hover)',
                boxShadow: pin.length === 4 && !error ? '0 0 20px rgba(192,132,252,0.08)' : error ? '0 0 20px rgba(255,51,51,0.08)' : 'none',
              }}
            />
          </div>

          {error && (
            <div style={{ textAlign: 'center', fontSize: 12, color: '#ff4455', fontWeight: 600, marginBottom: 16, textShadow: '0 0 12px rgba(255,68,85,0.4)' }}>
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleLogin}
            disabled={!canSubmit || busy}
            style={{
              width: '100%',
              padding: '14px 0',
              borderRadius: 12,
              border: 'none',
              background: canSubmit && !busy
                ? 'linear-gradient(135deg, #ff3333, #ff5544)'
                : 'var(--ro-fill-soft)',
              color: canSubmit && !busy ? '#fff' : 'var(--ro-text-muted)',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: '"DM Sans"',
              letterSpacing: '1px',
              cursor: canSubmit && !busy ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              boxShadow: canSubmit && !busy ? '0 8px 30px rgba(255,51,51,0.25)' : 'none',
            }}
            onMouseEnter={(e) => { if (canSubmit && !busy) e.currentTarget.style.boxShadow = '0 12px 40px rgba(255,51,51,0.35)' }}
            onMouseLeave={(e) => { if (canSubmit && !busy) e.currentTarget.style.boxShadow = '0 8px 30px rgba(255,51,51,0.25)' }}
          >
            {busy ? 'Signing in…' : 'LOG IN'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 10, color: '#3a3a4a' }}>
          Contact your administrator for login credentials
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </GlowBackground>
  )
}

function BottomNav({ onMorePress }) {
  const activeUser = useStore((s) => s.activeUser)
  const exec = isExecutive(activeUser)
  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
        <IconDashboard size={20} strokeWidth={1.5} />
        <span>Home</span>
      </NavLink>
      <NavLink to="/tasks" className={({ isActive }) => isActive ? 'active' : ''}>
        <IconPlanning size={20} strokeWidth={1.5} />
        <span>Tasks</span>
      </NavLink>
      <NavLink to="/new-transfer" className={({ isActive }) => isActive ? 'active' : ''}>
        <IconPlus size={20} strokeWidth={1.5} />
        <span>Transfer</span>
      </NavLink>
      {exec && (
        <NavLink
          to="/import"
          className={({ isActive }) => `bottom-nav-import${isActive ? ' active' : ''}`}
        >
          <IconImport size={20} strokeWidth={1.5} />
          <span>Import</span>
        </NavLink>
      )}
      <button type="button" onClick={onMorePress}>
        <IconMenu size={20} strokeWidth={1.5} />
        <span>More</span>
      </button>
    </nav>
  )
}

function ApiOfflineBanner() {
  const apiOnline = useStore((s) => s._apiOnline)
  const [dismissed, setDismissed] = useState(false)
  if (apiOnline || dismissed) return null
  return (
    <div
      className="api-offline-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: '#ff3333',
        color: '#fff',
        padding: '10px 16px',
        fontSize: '13px',
        fontWeight: 600,
        fontFamily: '"DM Sans", sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        textAlign: 'center',
      }}
    >
      <span>Backend server is offline -- your data is not loading. Start the server (node server.js) and reload.</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{
          background: 'rgba(0,0,0,0.2)',
          border: 'none',
          color: '#fff',
          borderRadius: '4px',
          padding: '2px 8px',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        Dismiss
      </button>
    </div>
  )
}

function RouteLoading() {
  return (
    <div
      style={{
        minHeight: 240,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ro-text-muted)',
        fontFamily: '"DM Sans", sans-serif',
        fontSize: 14,
      }}
    >
      Loading page…
    </div>
  )
}

function App() {
  const location = useLocation()
  const skus = useStore((s) => s.skus)
  const activeSeason = useStore((s) => s.activeSeason)
  const activeUser = useStore((s) => s.activeUser)
  const _ready = useStore((s) => s._ready)
  const _apiOnline = useStore((s) => s._apiOnline)
  const syncFromServer = useStore((s) => s.syncFromServer)
  const setActiveUser = useStore((s) => s.setActiveUser)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [browserOnline, setBrowserOnline] = useState(
    () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  )

  const connectivityLive = browserOnline && _apiOnline

  useEffect(() => {
    const onUnauth = () => setActiveUser(null)
    window.addEventListener('retailos:unauthorized', onUnauth)
    return () => window.removeEventListener('retailos:unauthorized', onUnauth)
  }, [setActiveUser])

  useEffect(() => {
    const onOnline = () => {
      setBrowserOnline(true)
      syncFromServer()
    }
    const onOffline = () => setBrowserOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [syncFromServer])

  if (!_ready) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#06060a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ro-text-muted)',
          fontFamily: '"DM Sans", sans-serif',
          fontSize: 14,
        }}
      >
        Loading intelRetail…
      </div>
    )
  }

  if (!activeUser) return <><ApiOfflineBanner /><LoginScreen /></>

  const closeSidebar = () => setSidebarOpen(false)
  const exec = isExecutive(activeUser)
  const hideFooterImport = location.pathname === '/bin'

  return (
    <AppErrorBoundary>
    <div
      className="min-h-screen app-root"
      style={{ background: 'var(--ro-page-bg)' }}
    >
      <ApiOfflineBanner />
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={closeSidebar}
        aria-hidden
      />

      {/* Sidebar wrapper */}
      <aside
        className={`app-sidebar app-sidebar--glass${sidebarOpen ? ' open' : ''}`}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: '200px',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 200,
          overflow: 'hidden',
        }}
      >
        <Sidebar onNavigate={closeSidebar} />
      </aside>

      {/* Main wrapper */}
      <div
        className="app-main"
        style={{
          marginLeft: '200px',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Topbar wrapper */}
        <div
          className="app-topbar"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 100,
            background: 'rgba(9,9,14,0.88)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderBottom: '1px solid var(--ro-border)',
            padding: '0 28px',
            height: '58px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <button
            type="button"
            className="hamburger-btn"
            style={{ flexShrink: 0 }}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <IconMenu size={20} strokeWidth={1.5} />
          </button>
          <Topbar />
        </div>

        {/* Content wrapper */}
        <main
          className="app-content"
          style={{
            padding: '24px 28px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <SaleSeasonExperience />
          <div style={{ flex: 1, minHeight: 0 }}>
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/smart-alerts" element={<SmartAlerts />} />
                <Route path="/lifecycle" element={<Lifecycle />} />
                <Route path="/bestsellers" element={<Bestsellers />} />
                <Route path="/reports" element={<RequireExecutive><Reports /></RequireExecutive>} />
                <Route path="/activity-log" element={<RequireExecutive><ActivityLog /></RequireExecutive>} />
                <Route path="/lookup" element={<ProductLookup />} />
                <Route path="/buy-planning" element={<RequireExecutive><BuyPlanning /></RequireExecutive>} />
                <Route path="/import" element={<RequireExecutive><ImportCSV /></RequireExecutive>} />
                <Route path="/photos" element={<RequireExecutive><Photos /></RequireExecutive>} />
                <Route path="/bin" element={<RequireExecutive><RecycleBin /></RequireExecutive>} />
                <Route path="/catalog/footwear" element={<Footwear />} />
                <Route path="/catalog/apparel" element={<Apparel />} />
                <Route path="/catalog/accessories" element={<Accessories />} />
                <Route path="/tasks" element={<MyTasks />} />
                <Route path="/new-transfer" element={<TransferBuilder />} />
                <Route path="/outlet" element={<OutletTransfers />} />
                <Route path="/transfers" element={<StoreTransfers />} />
                <Route path="/markdown" element={<MarkdownLists />} />
                <Route path="/new-markdown" element={<MarkdownBuilder />} />
                <Route path="/users" element={<RequireExecutive><UserManagement /></RequireExecutive>} />
                <Route path="/shift-board" element={<ShiftBoard />} />
              </Routes>
            </Suspense>
          </div>

          <div className="app-footer">
            <div className="app-footer__left">
              <strong>RetailOS v1.2.1</strong> · Built for Driloni Sportswear Sh.P.K · Season & Markdown Intelligence
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {exec && !hideFooterImport && (
                <NavLink to="/import" className="app-footer-import">
                  <IconImport size={14} strokeWidth={1.5} />
                  Import CSV
                </NavLink>
              )}
              <div className="app-footer__meta">
                Last sync: Today · {skus.length} SKUs · {activeSeason} Active ·{' '}
                {connectivityLive ? (
                  <span className="app-footer__live">● Live</span>
                ) : (
                  <span style={{ color: '#dc2626', fontWeight: 600 }}>● Offline</span>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav onMorePress={() => setSidebarOpen(true)} />
    </div>
    </AppErrorBoundary>
  )
}

export default App
