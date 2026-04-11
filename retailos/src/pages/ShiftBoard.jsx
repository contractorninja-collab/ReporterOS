import { useState, useEffect, useMemo } from 'react'
import { Clock, LogIn, LogOut, Users, Download } from 'lucide-react'
import useStore from '../store/useStore.js'
import * as api from '../api/client.js'

const DM = '"DM Sans", sans-serif'
const S = {
  surface: '#111117',
  surface2: '#17171f',
  border: 'rgba(255,255,255,0.055)',
  text: '#e4e4f0',
  text2: '#9090aa',
  muted: '#4a4a62',
  accent: '#ff3333',
  green: '#00e676',
  blue: '#38bdf8',
  purple: '#c084fc',
  orange: '#fbbf24',
}

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

const TH = {
  padding: '8px 10px', textAlign: 'left', fontSize: 9, fontWeight: 700,
  color: S.muted, textTransform: 'uppercase', letterSpacing: '1.5px',
  borderBottom: `1px solid ${S.border}`, whiteSpace: 'nowrap', fontFamily: DM,
}
const TD = {
  padding: '8px 10px', fontSize: 12, color: S.text, fontFamily: DM,
  borderBottom: `1px solid rgba(255,255,255,0.03)`, whiteSpace: 'nowrap',
}

function ShiftRow({ s }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%', background: S.green, flexShrink: 0,
        boxShadow: '0 0 8px rgba(0,230,118,0.4)',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: S.text }}>{s.user_name}</div>
        <div style={{ fontSize: 10, color: S.muted }}>Since {formatTime(s.clock_in)}</div>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: S.green,
        background: 'rgba(0,230,118,0.1)', padding: '2px 8px', borderRadius: 6, fontFamily: DM,
      }}>
        <LiveClock clockIn={s.clock_in} />
      </div>
    </div>
  )
}

function ShopCard({ shop, onShift, totalManagers }) {
  return (
    <div style={{
      flex: '1 1 260px', minWidth: 260,
      background: S.surface, border: `1px solid ${S.border}`, borderRadius: 14,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 16px', borderBottom: `1px solid ${S.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: S.text, fontFamily: DM }}>{shop}</div>
          <div style={{ fontSize: 10, color: S.muted, marginTop: 1 }}>
            {onShift.length} / {totalManagers} on shift
          </div>
        </div>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: onShift.length > 0 ? 'rgba(0,230,118,0.1)' : 'rgba(255,51,51,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Users size={16} style={{ color: onShift.length > 0 ? S.green : S.accent }} />
        </div>
      </div>
      <div style={{ padding: '10px 16px' }}>
        {onShift.length === 0 ? (
          <div style={{ fontSize: 11, color: S.muted, padding: '8px 0', textAlign: 'center' }}>
            No active shifts
          </div>
        ) : onShift.map((s) => <ShiftRow key={s.id} s={s} />)}
      </div>
    </div>
  )
}

function HistoryTable({ history, loading, historyDays, setHistoryDays, exportCsv }) {
  return (
    <div style={{
      background: S.surface, border: `1px solid ${S.border}`, borderRadius: 14,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: `1px solid ${S.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: S.text, fontFamily: DM }}>
          Shift History
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[7, 14, 30].map((d) => (
            <button key={d} type="button" onClick={() => setHistoryDays(d)} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
              border: `1px solid ${historyDays === d ? `${S.blue}33` : S.border}`,
              background: historyDays === d ? `${S.blue}12` : 'transparent',
              color: historyDays === d ? S.blue : S.muted,
              cursor: 'pointer', fontFamily: DM,
            }}>{d}d</button>
          ))}
          {exportCsv && (
            <button type="button" onClick={exportCsv} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
              border: `1px solid ${S.border}`, background: 'transparent',
              color: S.text2, cursor: 'pointer', fontFamily: DM,
            }}>
              <Download size={11} /> CSV
            </button>
          )}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Date', 'User', 'Shop', 'Clock In', 'Clock Out', 'Duration'].map((h) => (
                <th key={h} style={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: S.muted, padding: 28 }}>Loading...</td></tr>
            ) : history.length === 0 ? (
              <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: S.muted, padding: 28 }}>No shift history for this period.</td></tr>
            ) : (
              history.map((s) => (
                <tr key={s.id}>
                  <td style={TD}>{formatDate(s.clock_in)}</td>
                  <td style={{ ...TD, fontWeight: 600 }}>{s.user_name}</td>
                  <td style={TD}>{s.shop}</td>
                  <td style={TD}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <LogIn size={11} style={{ color: S.green }} /> {formatTime(s.clock_in)}
                    </span>
                  </td>
                  <td style={TD}>
                    {s.clock_out ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <LogOut size={11} style={{ color: S.muted }} /> {formatTime(s.clock_out)}
                      </span>
                    ) : (
                      <span style={{ color: S.green, fontWeight: 600, fontSize: 11 }}>Active</span>
                    )}
                  </td>
                  <td style={TD}>
                    <span style={{
                      color: s.duration_min && s.duration_min > 480 ? S.orange : S.text2,
                      fontWeight: s.duration_min && s.duration_min > 480 ? 700 : 400,
                    }}>
                      {s.clock_out ? formatDuration(s.duration_min) : (
                        <span style={{ color: S.green }}><LiveClock clockIn={s.clock_in} /></span>
                      )}
                      {s.duration_min && s.duration_min > 480 && (
                        <span style={{ fontSize: 9, marginLeft: 4, color: S.orange }}>OT</span>
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
  const users = useStore((s) => s.users)
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
  const totalManagers = users.filter((u) => u.shop === myShop && u.role !== 'executive').length

  const handleClockAction = () => {
    if (onShift) {
      if (window.confirm('End your shift?')) doClockOut()
    } else {
      doClockIn()
    }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: DM, fontSize: 22, letterSpacing: '2px', color: '#fff', margin: 0 }}>
          SHIFT BOARD
        </h2>
        <p style={{ fontSize: 12, color: S.muted, margin: '4px 0 0' }}>
          Track your shift and see who else is working at {myShop}.
        </p>
      </div>

      {/* Clock-in / Clock-out hero card */}
      <div style={{
        background: S.surface, border: `1px solid ${onShift ? 'rgba(0,230,118,0.2)' : S.border}`,
        borderRadius: 16, padding: '28px 24px', marginBottom: 24, textAlign: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        {onShift && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, transparent, rgba(0,230,118,0.5), transparent)',
          }} />
        )}

        <div style={{
          width: 64, height: 64, borderRadius: 16, margin: '0 auto 16px',
          background: onShift ? 'rgba(0,230,118,0.1)' : 'rgba(255,255,255,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${onShift ? 'rgba(0,230,118,0.2)' : S.border}`,
        }}>
          <Clock size={28} style={{ color: onShift ? S.green : S.muted }} />
        </div>

        {onShift ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: S.green, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 6 }}>
              On Shift
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: '#fff', fontFamily: DM, marginBottom: 4 }}>
              {elapsed}
            </div>
            <div style={{ fontSize: 11, color: S.muted, marginBottom: 20 }}>
              Since {formatTime(myShift.clock_in)} at {myShop}
            </div>
            <button
              type="button"
              onClick={handleClockAction}
              style={{
                padding: '12px 32px', borderRadius: 10, border: 'none',
                background: 'rgba(255,51,51,0.12)', color: S.accent,
                fontSize: 13, fontWeight: 700, fontFamily: DM, cursor: 'pointer',
                letterSpacing: '0.5px', transition: 'all 0.15s',
              }}
            >
              <LogOut size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
              End Shift
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 6 }}>
              Not Clocked In
            </div>
            <div style={{ fontSize: 14, color: S.text2, marginBottom: 20 }}>
              Start your shift to appear as available for transfers and tasks.
            </div>
            <button
              type="button"
              onClick={handleClockAction}
              style={{
                padding: '14px 40px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #00e676, #00c853)',
                color: '#000', fontSize: 14, fontWeight: 700, fontFamily: DM,
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

      {/* Shop colleagues */}
      <div style={{
        background: S.surface, border: `1px solid ${S.border}`, borderRadius: 14,
        overflow: 'hidden', marginBottom: 24,
      }}>
        <div style={{
          padding: '14px 16px', borderBottom: `1px solid ${S.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: S.text, fontFamily: DM }}>{myShop}</div>
            <div style={{ fontSize: 10, color: S.muted, marginTop: 1 }}>
              {shopShifts.length} / {totalManagers} on shift right now
            </div>
          </div>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: shopShifts.length > 0 ? 'rgba(0,230,118,0.1)' : 'rgba(255,51,51,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Users size={16} style={{ color: shopShifts.length > 0 ? S.green : S.accent }} />
          </div>
        </div>
        <div style={{ padding: '10px 16px' }}>
          {colleagues.length === 0 && !onShift ? (
            <div style={{ fontSize: 11, color: S.muted, padding: '8px 0', textAlign: 'center' }}>
              No colleagues on shift
            </div>
          ) : (
            <>
              {onShift && <ShiftRow s={myShift} />}
              {colleagues.map((s) => <ShiftRow key={s.id} s={s} />)}
            </>
          )}
        </div>
      </div>

      {/* My shift history */}
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
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: DM, fontSize: 22, letterSpacing: '2px', color: '#fff', margin: 0 }}>
          SHIFT BOARD
        </h2>
        <p style={{ fontSize: 12, color: S.muted, margin: '4px 0 0' }}>
          Live view of who is currently on shift across all shops.
        </p>
      </div>

      {/* Live board */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 28 }}>
        {shops.map((shop) => (
          <ShopCard
            key={shop}
            shop={shop}
            onShift={shopGroups[shop] || []}
            totalManagers={users.filter((u) => u.shop === shop && u.role !== 'executive').length}
          />
        ))}
      </div>

      {/* Weekly Hours Summary */}
      {historyWeeklyHours.length > 0 && (
        <div style={{
          background: S.surface, border: `1px solid ${S.border}`, borderRadius: 14,
          overflow: 'hidden', marginBottom: 24,
        }}>
          <div style={{ padding: '14px 18px', borderBottom: `1px solid ${S.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: S.text, fontFamily: DM }}>
              Hours Summary (Last {historyDays} days)
            </div>
          </div>
          <div style={{ padding: '12px 18px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {historyWeeklyHours.map((u) => (
              <div key={u.name} style={{
                background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 10,
                padding: '10px 14px', minWidth: 140,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: S.text, marginBottom: 4 }}>{u.name}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: S.blue, fontFamily: DM }}>{u.hours}h</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History log */}
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
