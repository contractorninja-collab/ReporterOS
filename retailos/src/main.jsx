import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './theme-light.css'
import App from './App.jsx'
import useStore from './store/useStore.js'
import { applyThemeToDocument } from './themeStorage.js'

applyThemeToDocument('light')

const OPERATIONAL_POLL_MS = 30_000
const REPORTING_POLL_MS = 2 * 60_000
const CATALOG_POLL_MS = 5 * 60_000
const USERS_POLL_MS = 5 * 60_000

async function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
  }
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  }
}

;(async () => {
  await setupServiceWorker()

  await useStore.getState().initFromServer()

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )

  let lastReportingPoll = Date.now()
  let lastCatalogPoll = Date.now()
  let lastUsersPoll = Date.now()

  const isAppActive = () => {
    if (typeof document === 'undefined') return true
    return document.visibilityState !== 'hidden' && document.hasFocus()
  }

  const isBrowserOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

  const pollFocusedData = () => {
    if (!isBrowserOnline()) return
    if (!isAppActive()) return
    const now = Date.now()
    const store = useStore.getState()

    store.syncOperationalData?.().catch(() => {})

    if (now - lastReportingPoll >= REPORTING_POLL_MS) {
      lastReportingPoll = now
      store.syncReportingData?.().catch(() => {})
    }

    if (now - lastCatalogPoll >= CATALOG_POLL_MS) {
      lastCatalogPoll = now
      store.syncCatalogData?.().catch(() => {})
    }

    if (now - lastUsersPoll >= USERS_POLL_MS) {
      lastUsersPoll = now
      store.syncUsers?.().catch(() => {})
    }
  }

  setInterval(() => {
    pollFocusedData()
  }, OPERATIONAL_POLL_MS)

  window.addEventListener('focus', () => pollFocusedData())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') pollFocusedData()
  })
})()
