import { useEffect, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import { PartyPopper, X } from 'lucide-react'

const START_DATE = '2026-07-10'
const END_DATE = '2026-07-31'
const STORAGE_PREFIX = 'saleSeasonFired_'

function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isInSeason(date) {
  return date >= START_DATE && date <= END_DATE
}

function isForced() {
  return new URLSearchParams(window.location.search).get('forceSaleSeason') === '1'
}

function fireFullScreenConfetti() {
  const colors = ['#7C3AED', '#A78BFA', '#FBBF24', '#FFFFFF']
  const end = Date.now() + 3000

  function frame() {
    confetti({
      particleCount: 6,
      startVelocity: 30,
      spread: 100,
      origin: { x: Math.random(), y: -0.1 },
      colors,
      gravity: 0.8,
      scalar: 0.9,
      drift: (Math.random() - 0.5) * 0.6,
      ticks: 250,
      disableForReducedMotion: true,
    })
    if (Date.now() < end) requestAnimationFrame(frame)
  }

  frame()
}

export default function SaleSeasonExperience() {
  const [inSeason, setInSeason] = useState(false)
  const [showGlow, setShowGlow] = useState(false)
  const [showBanner, setShowBanner] = useState(true)
  const firedRef = useRef(false)

  useEffect(() => {
    const today = todayLocal()
    const forced = isForced()
    if (!forced && !isInSeason(today)) return undefined

    setInSeason(true)
    const key = STORAGE_PREFIX + today
    let alreadyFiredToday = false

    try {
      alreadyFiredToday = localStorage.getItem(key) === '1'
    } catch {
      // Storage can be unavailable in strict privacy modes; the ref still gates this mount.
    }

    if ((!forced && alreadyFiredToday) || firedRef.current) return undefined

    firedRef.current = true
    if (!forced) {
      try {
        // Claim today's animation before starting it so refreshes do not replay it.
        localStorage.setItem(key, '1')
      } catch {
        // The animation can still run once for this mounted session.
      }
    }

    let secondFrame
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setShowGlow(true))
    })
    fireFullScreenConfetti()
    const glowTimer = window.setTimeout(() => setShowGlow(false), 2500)
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame) cancelAnimationFrame(secondFrame)
      window.clearTimeout(glowTimer)
    }
  }, [])

  if (!inSeason) return null

  return (
    <>
      <div
        aria-hidden="true"
        className={`sale-season-glow${showGlow ? ' sale-season-glow--visible' : ''}`}
      />
      {showBanner && (
        <aside className="sale-season-banner" aria-label="Sale season announcement">
          <div className="sale-season-banner__icon" aria-hidden="true">
            <PartyPopper size={19} strokeWidth={1.8} />
          </div>
          <div className="sale-season-banner__copy">
            <strong>Happy Sale Season!</strong>
            <span>Wishing the whole team a strong sales season.</span>
          </div>
          <button
            type="button"
            className="sale-season-banner__dismiss"
            onClick={() => setShowBanner(false)}
            aria-label="Dismiss sale season announcement"
            title="Dismiss"
          >
            <X size={17} />
          </button>
        </aside>
      )}
    </>
  )
}
