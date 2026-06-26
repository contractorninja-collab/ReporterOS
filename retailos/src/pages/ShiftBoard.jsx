import { useState, useEffect, useMemo } from 'react'
import { Clock, LogIn, LogOut, Users, Download } from 'lucide-react'
import useStore from '../store/useStore.js'
import * as api from '../api/client.js'

function formatElapsed(clockInIso) {
  const ms = Math.max(0, Date.now() - new Date(clockInIso).getTime())
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`
}

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDuration(mins) {
  if (mins == null) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function LiveClock({ clockIn }) {
  const [text, setText] = useState(() => formatElapsed(clockIn))
  useEffect(() => {
    setText(formatElapsed(clockIn))
    const iv = setInterval(() => setText(formatElapsed(clockIn)), 1000)
    return () => clearInterval(iv)
  }, [clockIn])
  return <span>{text}</span>
}

function ShiftRow({ s }) {
  return (
    <div className="sb-shift-row">
      <span className="sb-shift-row__dot" aria-hidden="true" />
      <div className="sb-shift-row__info">
        <div className="sb-shift-row__name">{s.user_name}</div>
        <div className="sb-shift-row__since">Since {formatTime(s.clock_in)}</div>
      </div>
      <div className="sb-shift-row__elapsed">
        <LiveClock clockIn={s.clock_in} />
      </div>
    </div>
  )
}

function ShopCard({ shop, onShift }) {
  const active = onShift.length > 0
  return (
    <div className="sb-location-card">
      <div className="sb-location-card__header">
        <div>
          <div className="sb-location-card__name">{shop}</div>
          <div className={`sb-location-card__count${active ? ' sb-location-card__count--active' : ''}`}>
            {onShift.length} currently on shift
          </div>
        </div>
        <div className={`sb-location-card__icon${active ? ' sb-location-card__icon--active' : ''}`}>
          <Users size={16} strokeWidth={1.75} />
        </div>
      </div>
      <div className="sb-location-card__body">
        {onShift.length === 0 ? (
          <div className="sb-location-card__empty">No active shifts</div>
        ) : (
          onShift.map((s) => <ShiftRow key={s.id} s={s} />)
        )}
      </div>
    </div>
  )
}

function HistoryTable({ history, loading, historyDays, setHistoryDays, exportCsv }) {
  return (
    <div className="sb-history-panel">
      <div className="sb-history-panel__header">
        <div className="sb-history-panel__title">Shift History</div>
        <div className="sb-history-panel__controls">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              className={`sb-period-chip${historyDays === d ? ' sb-period-chip--active' : ''}`}
              onClick={() => setHistoryDays(d)}
            >
              {d}d
            </button>
          ))}
          {exportCsv && (
            <button type="button" className="sb-csv-btn" onClick={exportCsv}>
              <Download size={11} strokeWidth={1.75} />
              ↓ CSV
            </button>
          )}
        </div>
      </div>

      <div className="sb-history-table-wrap">
        <table className="sb-history-table">
          <thead>
            <tr>
              {['Date', 'User', 'Shop', 'Clock in', 'Clock out', 'Duration'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="sb-history-table__loading">Loading...</td>
              </tr>
            ) : history.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="sb-history-empty">
                    <Clock size={24} strokeWidth={1.5} className="sb-history-empty__icon" />
                    No shift history for this period.
                  </div>
                </td>
              </tr>
            ) : (
              history.map((s) => (
                <tr key={s.id} className="sb-history-table__row">
                  <td className="sb-history-table__date">{formatDate(s.clock_in)}</td>
                  <td className="sb-history-table__user">{s.user_name}</td>
                  <td className="sb-history-table__shop">{s.shop}</td>
                  <td className="sb-history-table__time">{formatTime(s.clock_in)}</td>
                  <td className="sb-history-table__time">
                    {s.clock_out ? formatTime(s.clock_out) : (
                      <span className="sb-history-table__active">Active</span>
                    )}
                  </td>
                  <td className="sb-history-table__duration">
                    <span className={s.duration_min && s.duration_min > 480 ? 'sb-history-table__duration--ot' : ''}>
                      {s.clock_out ? formatDuration(s.duration_min) : (
                        <span className="sb-history-table__live"><LiveClock clockIn={s.clock_in} /></span>
                      )}
                      {s.duration_min && s.duration_min > 480 && (
                        <span className="sb-history-table__ot-tag">OT</span>
                      )}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ManagerView() {
  const activeUser = useStore((s) => s.activeUser)
  const myShift = useStore((s) => s.myShift)
  const activeShifts = useStore((s) => s.activeShifts)
  const doClockIn = useStore((s) => s.clockIn)
  const doClockOut = useStore((s) => s.clockOut)
  const [elapsed, setElapsed] = useState('')

  const [history, setHistory] = useState([])
  const [historyDays, setHistoryDays] = useState(7)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!myShift?.clock_in) { setElapsed(''); return }
    setElapsed(formatElapsed(myShift.clock_in))
    const iv = setInterval(() => setElapsed(formatElapsed(myShift.clock_in)), 1000)
    return () => clearInterval(iv)
  }, [myShift])

  useEffect(() => {
    setLoading(true)
    api.fetchShiftHistory(historyDays)
      .then((d) => {
        const arr = Array.isArray(d) ? d : []
        setHistory(arr.filter((s) => s.shop === activeUser?.shop))
      })
      .catch(() => setHistory([]))
      .finally(() => setLoading(false))
  }, [historyDays, activeUser?.shop])

  const onShift = !!myShift
  const myShop = activeUser?.shop || ''
  const shopShifts = activeShifts.filter((s) => s.shop === myShop)
  const colleagues = shopShifts.filter((s) => s.user_id !== activeUser?.id)
  const shopActive = shopShifts.length > 0

  const handleClockAction = () => {
    if (onShift) {
      if (window.confirm('End your shift?')) doClockOut()
    } else {
      doClockIn()
    }
  }

  return (
    <div className="sb-page sb-page--manager">
      <p className="sb-page-subtitle page-hero-mobile-hide">
        Track your shift and see who else is working at {myShop}.
      </p>

      <div
        style={{
          background: 'var(--ro-surface)',
          border: `1px solid ${onShift ? 'rgba(0,230,118,0.2)' : 'var(--ro-border)'}`,
          borderRadius: 16,
          padding: '28px 24px',
          marginBottom: 24,
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {onShift && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, transparent, rgba(0,230,118,0.5), transparent)',
          }} />
        )}

        <div style={{
          width: 64, height: 64, borderRadius: 16, margin: '0 auto 16px',
          background: onShift ? 'rgba(0,230,118,0.1)' : 'var(--ro-fill-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${onShift ? 'rgba(0,230,118,0.2)' : 'var(--ro-border)'}`,
        }}>
          <Clock size={28} style={{ color: onShift ? '#00e676' : 'var(--ro-text-muted)' }} />
        </div>

        {onShift ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#00e676', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 6 }}>
              On Shift
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--ro-heading)', fontFamily: '"DM Sans", sans-serif', marginBottom: 4 }}>
              {elapsed}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ro-text-muted)', marginBottom: 20 }}>
              Since {formatTime(myShift.clock_in)} at {myShop}
            </div>
            <button
              type="button"
              onClick={handleClockAction}
              style={{
                padding: '12px 32px', borderRadius: 10, border: 'none',
                background: 'rgba(255,51,51,0.12)', color: '#ff3333',
                fontSize: 13, fontWeight: 700, fontFamily: '"DM Sans", sans-serif', cursor: 'pointer',
                letterSpacing: '0.5px', transition: 'all 0.15s',
              }}
            >
              <LogOut size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
              End Shift
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ro-text-muted)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 6 }}>
              Not Clocked In
            </div>
            <div style={{ fontSize: 14, color: 'var(--ro-text-dim)', marginBottom: 20 }}>
              Start your shift to appear as available for transfers and tasks.
            </div>
            <button
              type="button"
              onClick={handleClockAction}
              style={{
                padding: '14px 40px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #00e676, #00c853)',
                color: '#000', fontSize: 14, fontWeight: 700, fontFamily: '"DM Sans", sans-serif',
                cursor: 'pointer', letterSpacing: '0.5px',
                boxShadow: '0 8px 30px rgba(0,230,118,0.25)',
                transition: 'all 0.15s',
              }}
            >
              <LogIn size={15} style={{ marginRight: 8, verticalAlign: -2 }} />
              Clock In
            </button>
          </>
        )}
      </div>

      <div className="sb-location-card" style={{ marginBottom: 24 }}>
        <div className="sb-location-card__header">
          <div>
            <div className="sb-location-card__name">{myShop}</div>
            <div className={`sb-location-card__count${shopActive ? ' sb-location-card__count--active' : ''}`}>
              {shopShifts.length} currently on shift
            </div>
          </div>
          <div className={`sb-location-card__icon${shopActive ? ' sb-location-card__icon--active' : ''}`}>
            <Users size={16} strokeWidth={1.75} />
          </div>
        </div>
        <div className="sb-location-card__body">
          {colleagues.length === 0 && !onShift ? (
            <div className="sb-location-card__empty">No colleagues on shift</div>
          ) : (
            <>
              {onShift && <ShiftRow s={myShift} />}
              {colleagues.map((s) => <ShiftRow key={s.id} s={s} />)}
            </>
          )}
        </div>
      </div>

      <HistoryTable
        history={history}
        loading={loading}
        historyDays={historyDays}
        setHistoryDays={setHistoryDays}
        exportCsv={null}
      />
    </div>
  )
}

function ExecutiveView() {
  const activeShifts = useStore((s) => s.activeShifts)
  const users = useStore((s) => s.users)

  const [history, setHistory] = useState([])
  const [historyDays, setHistoryDays] = useState(7)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.fetchShiftHistory(historyDays)
      .then((d) => setHistory(Array.isArray(d) ? d : []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false))
  }, [historyDays])

  const shopGroups = useMemo(() => {
    const map = {}
    for (const s of activeShifts) {
      const shop = s.shop || 'Unknown'
      if (!map[shop]) map[shop] = []
      map[shop].push(s)
    }
    return map
  }, [activeShifts])

  const shops = useMemo(() => {
    const set = new Set()
    for (const u of users) { if (u.shop && u.role !== 'executive') set.add(u.shop) }
    for (const s of activeShifts) { if (s.shop) set.add(s.shop) }
    return [...set].sort()
  }, [users, activeShifts])

  const historyWeeklyHours = useMemo(() => {
    const map = {}
    for (const s of history) {
      if (!s.duration_min) continue
      const key = s.user_name || s.user_id
      map[key] = (map[key] || 0) + s.duration_min
    }
    return Object.entries(map)
      .map(([name, mins]) => ({ name, hours: (mins / 60).toFixed(1), mins }))
      .sort((a, b) => b.mins - a.mins)
  }, [history])

  const exportCsv = () => {
    const header = 'Date,User,Shop,Clock In,Clock Out,Duration\n'
    const rows = history.map((s) =>
      `${formatDate(s.clock_in)},${s.user_name},${s.shop},${formatTime(s.clock_in)},${formatTime(s.clock_out)},${formatDuration(s.duration_min)}`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `shift-history-${historyDays}d.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="sb-page sb-page--executive">
      <p className="sb-page-subtitle page-hero-mobile-hide">
        Live view of who is currently on shift across all shops.
      </p>

      <div className="sb-location-grid">
        {shops.map((shop) => (
          <ShopCard
            key={shop}
            shop={shop}
            onShift={shopGroups[shop] || []}
          />
        ))}
      </div>

      {historyWeeklyHours.length > 0 && (
        <div style={{
          background: 'var(--ro-surface)', border: '1px solid var(--ro-border)', borderRadius: 14,
          overflow: 'hidden', marginBottom: 24,
        }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ro-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ro-text)', fontFamily: '"DM Sans", sans-serif' }}>
              Hours Summary (Last {historyDays} days)
            </div>
          </div>
          <div style={{ padding: '12px 18px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {historyWeeklyHours.map((u) => (
              <div key={u.name} style={{
                background: 'var(--ro-surface-elevated)', border: '1px solid var(--ro-border)', borderRadius: 10,
                padding: '10px 14px', minWidth: 140,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ro-text)', marginBottom: 4 }}>{u.name}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#7c3aed', fontFamily: '"DM Sans", sans-serif' }}>{u.hours}h</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <HistoryTable
        history={history}
        loading={loading}
        historyDays={historyDays}
        setHistoryDays={setHistoryDays}
        exportCsv={exportCsv}
      />
    </div>
  )
}

export function ShiftBoard() {
  const activeUser = useStore((s) => s.activeUser)
  const isExec = activeUser?.role === 'executive'
  return isExec ? <ExecutiveView /> : <ManagerView />
}
