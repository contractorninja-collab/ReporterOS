import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './theme-light.css'
import App from './App.jsx'
import useStore from './store/useStore.js'
import { applyThemeToDocument, readStoredTheme } from './themeStorage.js'

applyThemeToDocument(readStoredTheme())

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (import.meta.env.DEV) {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
    return
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
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

  setInterval(() => {
    useStore.getState().syncFromServer()
  }, 30_000)
})()
