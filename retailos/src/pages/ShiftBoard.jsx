import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock,
  Copy, Download, Edit3, LogIn, LogOut, Plus, Save, Settings, ShieldCheck,
  Trash2, UserCheck, Users, X,
} from 'lucide-react'
import useStore from '../store/useStore.js'
import * as api from '../api/client.js'
import {
  SHIFT_TIME_ZONE, addShiftDays, shiftDateKey, shiftLocalToIso, shiftWeekStart,
} from '../utils/shiftTime.js'

const EXEC_TABS = [
  ['live', 'Live'], ['schedule', 'Schedule'], ['requests', 'Requests'],
  ['history', 'History'], ['settings', 'Settings'],
]

function formatElapsed(clockInIso) {
  const totalSec = Math.max(0, Math.floor((Date.now() - new Date(clockInIso).getTime()) / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (value) => String(value).padStart(2, '0')
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`
}

function formatTime(iso) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SHIFT_TIME_ZONE, hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

function formatDate(isoOrKey, options = {}) {
  if (!isoOrKey) return '—'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(isoOrKey))
    ? new Date(`${isoOrKey}T12:00:00Z`)
    : new Date(isoOrKey)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SHIFT_TIME_ZONE, day: 'numeric', month: 'short',
    ...(options.weekday ? { weekday: 'short' } : {}),
    ...(options.year === false ? {} : { year: 'numeric' }),
  }).format(date)
}

function formatDuration(mins) {
  if (mins == null) return '—'
  const h = Math.floor(Number(mins) / 60)
  const m = Number(mins) % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

function isoToLocalInput(iso) {
  if (!iso) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: SHIFT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function localInputToIso(value) {
  const [date, time] = String(value || '').split('T')
  return shiftLocalToIso(date, time)
}

function LiveClock({ clockIn }) {
  const [text, setText] = useState(() => formatElapsed(clockIn))
  useEffect(() => {
    setText(formatElapsed(clockIn))
    const timer = setInterval(() => setText(formatElapsed(clockIn)), 1000)
    return () => clearInterval(timer)
  }, [clockIn])
  return <span>{text}</span>
}

function Notice({ type = 'error', children }) {
  if (!children) return null
  return <div className={`sb2-notice sb2-notice--${type}`}>{children}</div>
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div className="sb2-tabs" role="tablist" aria-label="Shift Board sections">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={active === id}
          className={`sb2-tab${active === id ? ' sb2-tab--active' : ''}`} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  )
}

const FLAG_LABELS = {
  late: 'Late', no_show: 'No-show', unscheduled: 'Unscheduled',
  early_departure: 'Early departure', overrun: 'Overrun', auto_stale: 'Auto-closed',
}

function FlagPill({ flag }) {
  return <span className={`sb2-flag sb2-flag--${flag}`}>{FLAG_LABELS[flag] || flag}</span>
}

function KpiGrid({ counts = {} }) {
  const items = [
    ['active', 'Active now', <Users size={18} />], ['late', 'Late today', <Clock size={18} />],
    ['missing', 'Missing', <AlertTriangle size={18} />], ['unscheduled', 'Unscheduled', <CalendarDays size={18} />],
    ['overrun', 'Overrun', <AlertTriangle size={18} />], ['pending', 'Requests', <ShieldCheck size={18} />],
  ]
  return (
    <div className="sb2-kpis">
      {items.map(([key, label, icon]) => (
        <div className={`sb2-kpi sb2-kpi--${key}`} key={key}>
          <div><div className="sb2-kpi__label">{label}</div><div className="sb2-kpi__value">{counts[key] || 0}</div></div>
          {icon}
        </div>
      ))}
    </div>
  )
}

function WeeklyHours({ rows = [] }) {
  return <section className="sb2-card sb2-hours"><header className="sb2-section-header"><div><h2>Hours this week</h2><p>Completed time plus currently active shifts, Monday through Sunday.</p></div></header>{rows.length ? <div className="sb2-hours__grid">{rows.map((row) => <div key={row.user_id}><strong>{row.user_name}</strong><span>{row.shop}</span><b>{(row.minutes / 60).toFixed(1)}h</b></div>)}</div> : <div className="sb2-empty-cell">No recorded hours this week.</div>}</section>
}

function ShiftRow({ shift, showTiming = true }) {
  const flags = Array.isArray(shift.attendance_flags) ? shift.attendance_flags : []
  return (
    <div className="sb2-person-row">
      <span className="sb2-live-dot" aria-hidden="true" />
      <div className="sb2-person-row__main">
        <strong>{shift.user_name}</strong>
        <span>{showTiming ? `Since ${formatTime(shift.clock_in)}` : 'Active now'}</span>
        {!!flags.length && <div className="sb2-flags">{flags.map((flag) => <FlagPill key={flag} flag={flag} />)}</div>}
      </div>
      {showTiming && <span className="sb2-person-row__elapsed"><LiveClock clockIn={shift.clock_in} /></span>}
    </div>
  )
}

function CoverageGrid({ shifts, shops, showTiming = true }) {
  const groups = useMemo(() => {
    const value = {}
    for (const shop of shops) value[shop] = []
    for (const shift of shifts || []) (value[shift.shop] ||= []).push(shift)
    return value
  }, [shifts, shops])
  return (
    <div className="sb2-coverage-grid">
      {Object.keys(groups).sort().map((shop) => (
        <article className="sb2-card sb2-shop-card" key={shop}>
          <header><div><h3>{shop}</h3><p className={groups[shop].length ? 'is-active' : ''}>{groups[shop].length} currently on shift</p></div><Users size={18} /></header>
          {groups[shop].length ? groups[shop].map((shift) => <ShiftRow key={shift.id} shift={shift} showTiming={showTiming} />)
            : <div className="sb2-empty-small">No active shifts</div>}
        </article>
      ))}
    </div>
  )
}

function HistoryPanel({ activeUser, shopFilter = '', allowCorrection = false }) {
  const [days, setDays] = useState(7)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [userFilter, setUserFilter] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => {
    setLoading(true)
    api.fetchShiftHistory(days).then((rows) => setHistory(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err.message)).finally(() => setLoading(false))
  }, [days])
  useEffect(() => { load() }, [load])
  const rows = history.filter((shift) => (!shopFilter || shift.shop === shopFilter) && (!userFilter || shift.user_id === userFilter))
  const users = [...new Map(history.map((shift) => [shift.user_id, shift.user_name])).entries()]
  const exportCsv = () => {
    const cell = (value) => {
      const text = value == null ? '' : String(value)
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const lines = [['Date', 'User', 'Shop', 'Clock In', 'Clock Out', 'Duration', 'Planned', 'Exceptions']]
    rows.forEach((shift) => lines.push([
      formatDate(shift.clock_in), shift.user_name, shift.shop, formatTime(shift.clock_in),
      shift.clock_out ? formatTime(shift.clock_out) : 'Active', formatDuration(shift.duration_min),
      shift.planned_start_time ? `${shift.planned_start_time}-${shift.planned_end_time}` : '',
      (shift.attendance_flags || []).map((flag) => FLAG_LABELS[flag] || flag).join('; '),
    ]))
    const blob = new Blob(['\uFEFF' + lines.map((line) => line.map(cell).join(',')).join('\r\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `shift-history-${days}d.csv`; anchor.click(); URL.revokeObjectURL(url)
  }
  return (
    <section className="sb2-card sb2-history">
      <header className="sb2-section-header">
        <div><h2>Shift History</h2><p>Actual hours, planned periods, and attendance exceptions.</p></div>
        <div className="sb2-toolbar">
          {activeUser?.role === 'executive' && <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)}><option value="">All users</option>{users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}
          {[7, 14, 30].map((value) => <button key={value} type="button" className={days === value ? 'is-active' : ''} onClick={() => setDays(value)}>{value}d</button>)}
          <button type="button" onClick={exportCsv}><Download size={13} /> CSV</button>
        </div>
      </header>
      <Notice>{error}</Notice>
      <div className="sb2-table-wrap">
        <table className="sb2-table">
          <thead><tr><th>Date</th><th>User</th><th>Shop</th><th>Actual</th><th>Planned</th><th>Duration</th><th>Exceptions</th>{allowCorrection && <th />}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8}>Loading…</td></tr> : rows.length ? rows.map((shift) => (
              <tr key={shift.id}>
                <td>{formatDate(shift.clock_in)}</td><td><strong>{shift.user_name}</strong></td><td>{shift.shop}</td>
                <td>{formatTime(shift.clock_in)}–{shift.clock_out ? formatTime(shift.clock_out) : <span className="sb2-active-text">Active</span>}</td>
                <td>{shift.planned_start_time ? `${shift.planned_start_time}–${shift.planned_end_time}` : '—'}</td>
                <td>{shift.clock_out ? formatDuration(shift.duration_min) : <LiveClock clockIn={shift.clock_in} />}</td>
                <td><div className="sb2-flags">{(shift.attendance_flags || []).map((flag) => <FlagPill key={flag} flag={flag} />)}</div></td>
                {allowCorrection && <td>{shift.clock_out && shift.user_id === activeUser?.id ? <a className="sb2-link" href="#shift-correction">Correct</a> : null}</td>}
              </tr>
            )) : <tr><td colSpan={8} className="sb2-empty-cell">No shift history for this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ScheduleEditor({ shop, users, canCrossShop = false }) {
  const [weekStart, setWeekStart] = useState(() => shiftWeekStart())
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState('')
  const [form, setForm] = useState({ user_id: '', shift_date: shiftWeekStart(), start_time: '09:00', end_time: '17:00' })
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addShiftDays(weekStart, index)), [weekStart])
  const eligibleUsers = useMemo(() => users.filter((user) => user.role !== 'executive' && (canCrossShop || user.shop === shop)), [users, shop, canCrossShop])
  const load = useCallback(() => {
    if (!shop) return
    setLoading(true); setError('')
    api.fetchShiftPlans(weekStart, shop).then((rows) => setPlans(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err.message)).finally(() => setLoading(false))
  }, [weekStart, shop])
  useEffect(() => { load() }, [load])
  useEffect(() => setForm((current) => ({ ...current, shift_date: weekStart, user_id: eligibleUsers.some((user) => user.id === current.user_id) ? current.user_id : (eligibleUsers[0]?.id || '') })), [weekStart, eligibleUsers])
  const reset = () => { setEditingId(''); setForm({ user_id: eligibleUsers[0]?.id || '', shift_date: weekStart, start_time: '09:00', end_time: '17:00' }) }
  const save = async (event) => {
    event.preventDefault(); setError(''); setMessage('')
    try {
      const payload = { ...form, shop }
      if (editingId) await api.putShiftPlan(editingId, payload)
      else await api.postShiftPlan(payload)
      setMessage(editingId ? 'Planned shift updated.' : 'Draft shift added.')
      reset(); load()
    } catch (err) { setError(err.message) }
  }
  const edit = (plan) => { setEditingId(plan.id); setForm({ user_id: plan.user_id, shift_date: plan.shift_date, start_time: plan.start_time, end_time: plan.end_time }) }
  const remove = async (plan) => {
    if (!window.confirm(`${plan.status === 'published' ? 'Cancel' : 'Delete'} this planned shift?`)) return
    try { await api.deleteShiftPlan(plan.id); reset(); load() } catch (err) { setError(err.message) }
  }
  const copyPrevious = async () => {
    if (!window.confirm('Copy the previous week into this week as drafts?')) return
    try { await api.postCopyShiftWeek({ shop, sourceWeekStart: addShiftDays(weekStart, -7), targetWeekStart: weekStart }); setMessage('Previous week copied as drafts.'); load() }
    catch (err) { setError(err.message) }
  }
  const publish = async () => {
    if (!window.confirm(`Publish this week for ${shop}? Scheduled users will be notified.`)) return
    try { await api.postPublishShiftWeek({ shop, weekStart }); setMessage('Schedule published and users notified.'); load() }
    catch (err) { setError(err.message) }
  }
  return (
    <section className="sb2-schedule">
      <div className="sb2-card sb2-schedule-toolbar">
        <div className="sb2-week-nav"><button type="button" onClick={() => setWeekStart(addShiftDays(weekStart, -7))}><ChevronLeft size={16} /></button><strong>{formatDate(weekStart, { year: false })} – {formatDate(addShiftDays(weekStart, 6))}</strong><button type="button" onClick={() => setWeekStart(addShiftDays(weekStart, 7))}><ChevronRight size={16} /></button></div>
        <div className="sb2-toolbar"><button type="button" onClick={copyPrevious}><Copy size={13} /> Copy previous</button><button type="button" className="sb2-button--primary" onClick={publish}><Check size={13} /> Publish week</button></div>
      </div>
      <Notice>{error}</Notice><Notice type="success">{message}</Notice>
      <form className="sb2-card sb2-plan-form" onSubmit={save}>
        <div className="sb2-plan-form__title">{editingId ? <Edit3 size={16} /> : <Plus size={16} />} {editingId ? 'Edit planned shift' : 'Add planned shift'}</div>
        <label>User<select required value={form.user_id} onChange={(event) => setForm({ ...form, user_id: event.target.value })}><option value="">Choose user</option>{eligibleUsers.map((user) => <option key={user.id} value={user.id}>{user.name}{canCrossShop ? ` · ${user.shop}` : ''}</option>)}</select></label>
        <label>Date<input required type="date" min={weekStart} max={addShiftDays(weekStart, 6)} value={form.shift_date} onChange={(event) => setForm({ ...form, shift_date: event.target.value })} /></label>
        <label>Start<input required type="time" value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></label>
        <label>End<input required type="time" value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></label>
        <button type="submit" className="sb2-button--primary"><Save size={14} /> {editingId ? 'Save' : 'Add draft'}</button>
        {editingId && <button type="button" onClick={reset}><X size={14} /> Cancel</button>}
      </form>
      <div className="sb2-week-grid" aria-busy={loading}>
        {days.map((day) => {
          const dayPlans = plans.filter((plan) => plan.shift_date === day)
          return <article className={`sb2-day${day === shiftDateKey() ? ' sb2-day--today' : ''}`} key={day}><header><strong>{formatDate(day, { weekday: true, year: false })}</strong><span>{dayPlans.length} shift{dayPlans.length === 1 ? '' : 's'}</span></header><div className="sb2-day__body">{dayPlans.length ? dayPlans.map((plan) => <div className={`sb2-plan sb2-plan--${plan.status}`} key={plan.id}><div><strong>{plan.user_name}</strong><span>{plan.start_time}–{plan.end_time}</span>{canCrossShop && <small>{plan.shop}</small>}</div><span className="sb2-plan__status">{plan.status}</span><div className="sb2-plan__actions"><button type="button" aria-label="Edit planned shift" onClick={() => edit(plan)}><Edit3 size={12} /></button><button type="button" aria-label="Delete planned shift" onClick={() => remove(plan)}><Trash2 size={12} /></button></div></div>) : <div className="sb2-day__empty">No shifts</div>}</div></article>
        })}
      </div>
    </section>
  )
}

function RequestsPanel({ executive }) {
  const activeUser = useStore((state) => state.activeUser)
  const [requests, setRequests] = useState([])
  const [history, setHistory] = useState([])
  const [form, setForm] = useState({ shift_id: '', proposed_clock_in: '', proposed_clock_out: '', reason: '' })
  const [error, setError] = useState('')
  const load = useCallback(() => {
    api.fetchShiftCorrections().then((rows) => setRequests(Array.isArray(rows) ? rows : [])).catch((err) => setError(err.message))
    if (!executive) api.fetchShiftHistory(30).then((rows) => setHistory((rows || []).filter((shift) => shift.clock_out && shift.user_id === activeUser?.id))).catch(() => {})
  }, [executive, activeUser?.id])
  useEffect(() => { load() }, [load])
  const chooseShift = (id) => {
    const shift = history.find((row) => row.id === id)
    setForm({ shift_id: id, proposed_clock_in: isoToLocalInput(shift?.clock_in), proposed_clock_out: isoToLocalInput(shift?.clock_out), reason: '' })
  }
  const submit = async (event) => {
    event.preventDefault(); setError('')
    try { await api.postShiftCorrection({ ...form, proposed_clock_in: localInputToIso(form.proposed_clock_in), proposed_clock_out: localInputToIso(form.proposed_clock_out) }); setForm({ shift_id: '', proposed_clock_in: '', proposed_clock_out: '', reason: '' }); load() }
    catch (err) { setError(err.message) }
  }
  const review = async (request, decision) => {
    const reviewNote = window.prompt(`${decision === 'approved' ? 'Approve' : 'Reject'} request. Optional review note:`, '')
    if (reviewNote == null) return
    try { await api.putShiftCorrectionReview(request.id, { decision, reviewNote }); load() } catch (err) { setError(err.message) }
  }
  return (
    <div id="shift-correction" className="sb2-requests-layout">
      {!executive && <form className="sb2-card sb2-correction-form" onSubmit={submit}><header><h2>Request a correction</h2><p>Executives review every requested clock-time change.</p></header><Notice>{error}</Notice><label>Shift<select required value={form.shift_id} onChange={(event) => chooseShift(event.target.value)}><option value="">Choose a completed shift</option>{history.map((shift) => <option key={shift.id} value={shift.id}>{formatDate(shift.clock_in)} · {formatTime(shift.clock_in)}–{formatTime(shift.clock_out)}</option>)}</select></label><div className="sb2-form-grid"><label>Proposed clock-in<input required type="datetime-local" value={form.proposed_clock_in} onChange={(event) => setForm({ ...form, proposed_clock_in: event.target.value })} /></label><label>Proposed clock-out<input required type="datetime-local" value={form.proposed_clock_out} onChange={(event) => setForm({ ...form, proposed_clock_out: event.target.value })} /></label></div><label>Reason<textarea required rows={3} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Explain what was recorded incorrectly" /></label><button className="sb2-button--primary" type="submit">Submit request</button></form>}
      <section className="sb2-card sb2-request-list"><header className="sb2-section-header"><div><h2>{executive ? 'Correction Requests' : 'My Requests'}</h2><p>{executive ? 'Review proposed changes with their original values.' : 'Track executive review decisions.'}</p></div></header><Notice>{executive ? error : ''}</Notice>{requests.length ? requests.map((request) => <article className="sb2-request" key={request.id}><div className="sb2-request__top"><div><strong>{request.requested_by_name}</strong><span>{formatDate(request.created_at)} · {request.reason}</span></div><span className={`sb2-status sb2-status--${request.status}`}>{request.status}</span></div><div className="sb2-request__times"><div><small>Original</small><strong>{formatTime(request.original_clock_in)}–{formatTime(request.original_clock_out)}</strong></div><ChevronRight size={15} /><div><small>Proposed</small><strong>{formatTime(request.proposed_clock_in)}–{formatTime(request.proposed_clock_out)}</strong></div></div>{request.review_note && <p className="sb2-review-note">Review: {request.review_note}</p>}{executive && request.status === 'pending' && <div className="sb2-request__actions"><button type="button" className="sb2-button--success" onClick={() => review(request, 'approved')}><Check size={13} /> Approve</button><button type="button" className="sb2-button--danger" onClick={() => review(request, 'rejected')}><X size={13} /> Reject</button></div>}</article>) : <div className="sb2-empty-cell">No correction requests.</div>}</section>
    </div>
  )
}

function SettingsPanel({ settings, users, onSaved }) {
  const [drafts, setDrafts] = useState({})
  const [error, setError] = useState('')
  useEffect(() => setDrafts(Object.fromEntries(settings.map((setting) => [setting.shop, { ...setting }]))), [settings])
  const change = (shop, key, value) => setDrafts((current) => ({ ...current, [shop]: { ...current[shop], [key]: value } }))
  const save = async (shop) => {
    try { setError(''); await api.putShiftSetting(shop, drafts[shop]); onSaved() } catch (err) { setError(err.message) }
  }
  return <div className="sb2-settings"><Notice>{error}</Notice><div className="sb2-settings__intro"><Settings size={18} /><div><h2>Shift settings</h2><p>Choose schedule owners and attendance thresholds. Times use Kosovo time ({SHIFT_TIME_ZONE}).</p></div></div>{settings.map((setting) => { const draft = drafts[setting.shop] || setting; const shopUsers = users.filter((user) => user.role !== 'executive' && user.shop === setting.shop); return <section className="sb2-card sb2-setting-card" key={setting.shop}><header><div><h3>{setting.shop}</h3><p>One primary planner and an optional backup.</p></div><button type="button" className="sb2-button--primary" onClick={() => save(setting.shop)}><Save size={13} /> Save</button></header><div className="sb2-settings-grid"><label>Primary planner<select value={draft.primary_planner_id || ''} onChange={(event) => change(setting.shop, 'primary_planner_id', event.target.value)}><option value="">Not assigned</option>{shopUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label>Backup planner<select value={draft.backup_planner_id || ''} onChange={(event) => change(setting.shop, 'backup_planner_id', event.target.value)}><option value="">Not assigned</option>{shopUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label>Late grace<input type="number" min="0" max="120" value={draft.late_grace_min} onChange={(event) => change(setting.shop, 'late_grace_min', Number(event.target.value))} /><span>minutes</span></label><label>No-show after<input type="number" min="1" max="240" value={draft.no_show_after_min} onChange={(event) => change(setting.shop, 'no_show_after_min', Number(event.target.value))} /><span>minutes</span></label><label>Early departure grace<input type="number" min="0" max="120" value={draft.early_departure_grace_min} onChange={(event) => change(setting.shop, 'early_departure_grace_min', Number(event.target.value))} /><span>minutes</span></label><label>Overrun grace<input type="number" min="0" max="240" value={draft.overrun_grace_min} onChange={(event) => change(setting.shop, 'overrun_grace_min', Number(event.target.value))} /><span>minutes</span></label></div></section>})}</div>
}

function ExecutiveView() {
  const users = useStore((state) => state.users)
  const activeShifts = useStore((state) => state.activeShifts)
  const activeUser = useStore((state) => state.activeUser)
  const [tab, setTab] = useState('live')
  const [settings, setSettings] = useState([])
  const [shop, setShop] = useState('')
  const [overview, setOverview] = useState({ counts: {}, plans: [], actuals: [] })
  const [error, setError] = useState('')
  const loadSettings = useCallback(() => api.fetchShiftSettings().then((rows) => { const values = Array.isArray(rows) ? rows : []; setSettings(values); setShop((current) => current || values[0]?.shop || '') }).catch((err) => setError(err.message)), [])
  const loadOverview = useCallback(() => api.fetchShiftOverview(shiftDateKey(), '').then(setOverview).catch((err) => setError(err.message)), [])
  useEffect(() => { loadSettings() }, [loadSettings])
  useEffect(() => { loadOverview(); const timer = setInterval(loadOverview, 30000); return () => clearInterval(timer) }, [loadOverview])
  const shops = settings.map((setting) => setting.shop)
  const exceptions = [...(overview.plans || []).filter((plan) => plan.exception), ...(overview.actuals || []).filter((shift) => shift.attendance_flags?.length)]
  return <div className="sb2-page"><div className="sb2-hero"><div><p>Planned versus actual staffing in Kosovo time.</p><h1>Today’s operations</h1></div>{['schedule', 'history'].includes(tab) && <label className="sb2-shop-filter">Shop<select value={shop} onChange={(event) => setShop(event.target.value)}>{shops.map((name) => <option key={name}>{name}</option>)}</select></label>}</div><Tabs tabs={EXEC_TABS} active={tab} onChange={setTab} /><Notice>{error}</Notice>{tab === 'live' && <><KpiGrid counts={overview.counts} /><section className="sb2-section"><div className="sb2-section-header"><div><h2>Live coverage</h2><p>Who is available across every shop right now.</p></div><span className="sb2-timezone">{SHIFT_TIME_ZONE}</span></div><CoverageGrid shifts={activeShifts} shops={shops} /></section><WeeklyHours rows={overview.weekly_hours} /><section className="sb2-card sb2-exceptions"><header className="sb2-section-header"><div><h2>Attendance exceptions</h2><p>Late, missing, unscheduled, early, and overrun activity requiring attention.</p></div></header>{exceptions.length ? exceptions.map((item) => { const shift = item.actual || item; const flags = item.exception ? [item.exception] : shift.attendance_flags; return <div className="sb2-exception-row" key={item.id}><div><strong>{item.user_name || shift.user_name}</strong><span>{item.shop || shift.shop} · {item.start_time ? `${item.start_time}–${item.end_time}` : formatTime(shift.clock_in)}</span></div><div className="sb2-flags">{flags.map((flag) => <FlagPill key={flag} flag={flag} />)}</div></div> }) : <div className="sb2-empty-cell"><UserCheck size={24} /> No attendance exceptions today.</div>}</section></>}{tab === 'schedule' && <ScheduleEditor shop={shop} users={users} canCrossShop />}{tab === 'requests' && <RequestsPanel executive />}{tab === 'history' && <HistoryPanel activeUser={activeUser} shopFilter={shop} />}{tab === 'settings' && <SettingsPanel settings={settings} users={users} onSaved={loadSettings} />}</div>
}

function ManagerToday({ activeUser, myShift, activeShifts, overview, onClock, shops }) {
  const todayPlans = overview.plans || []
  return <><div className="sb2-manager-top"><section className={`sb2-card sb2-clock-card${myShift ? ' is-active' : ''}`}><div className="sb2-clock-card__icon"><Clock size={26} /></div><div><span className="sb2-eyebrow">{myShift ? 'On shift' : 'Not clocked in'}</span><h2>{myShift ? <LiveClock clockIn={myShift.clock_in} /> : 'Ready to start?'}</h2><p>{myShift ? `Working at ${myShift.shop}` : 'Clock in to appear as available for transfers and tasks.'}</p></div><button type="button" className={myShift ? 'sb2-button--danger' : 'sb2-button--clock'} onClick={onClock}>{myShift ? <><LogOut size={15} /> End shift</> : <><LogIn size={15} /> Clock in</>}</button></section><section className="sb2-card sb2-today-plan"><header><div><span className="sb2-eyebrow">Today</span><h2>Planned shifts</h2></div><CalendarDays size={20} /></header>{todayPlans.length ? todayPlans.map((plan) => <div className="sb2-timeline" key={plan.id}><span /><div><strong>{plan.start_time}–{plan.end_time}</strong><small>{plan.shop}</small></div><span className={`sb2-status sb2-status--${plan.actual ? 'approved' : plan.exception ? 'rejected' : 'pending'}`}>{plan.actual ? 'Clocked' : plan.exception ? 'Missing' : 'Scheduled'}</span></div>) : <div className="sb2-empty-small">No published shift today. Clock-in is still allowed and will be flagged as unscheduled.</div>}</section></div><section className="sb2-section"><div className="sb2-section-header"><div><h2>Live coverage</h2><p>Managers currently available across all shops.</p></div></div><CoverageGrid shifts={activeShifts} shops={shops.length ? shops : [activeUser.shop]} showTiming={false} /></section></>
}

function MyWeek({ plans }) {
  const start = shiftWeekStart()
  const days = Array.from({ length: 7 }, (_, index) => addShiftDays(start, index))
  return <section className="sb2-card sb2-my-week"><header className="sb2-section-header"><div><h2>My week</h2><p>Your published and draft work periods.</p></div></header><div className="sb2-my-week__grid">{days.map((day) => <article className={day === shiftDateKey() ? 'is-today' : ''} key={day}><header><strong>{formatDate(day, { weekday: true, year: false })}</strong></header>{plans.filter((plan) => plan.shift_date === day).map((plan) => <div className="sb2-my-shift" key={plan.id}><strong>{plan.start_time}–{plan.end_time}</strong><span>{plan.shop}</span><small>{plan.status}</small></div>)}{!plans.some((plan) => plan.shift_date === day) && <span className="sb2-day-off">No shift</span>}</article>)}</div></section>
}

function ManagerView() {
  const activeUser = useStore((state) => state.activeUser)
  const myShift = useStore((state) => state.myShift)
  const activeShifts = useStore((state) => state.activeShifts)
  const users = useStore((state) => state.users)
  const doClockIn = useStore((state) => state.clockIn)
  const doClockOut = useStore((state) => state.clockOut)
  const [tab, setTab] = useState('today')
  const [settings, setSettings] = useState([])
  const [overview, setOverview] = useState({ plans: [], counts: {} })
  const [plans, setPlans] = useState([])
  const shop = activeUser?.shop || ''
  const currentWeek = shiftWeekStart()
  const load = useCallback(() => Promise.all([
    api.fetchShiftSettings().then((rows) => setSettings(Array.isArray(rows) ? rows : [])),
    api.fetchShiftOverview(shiftDateKey(), shop).then(setOverview),
    api.fetchShiftPlans(currentWeek, shop).then((rows) => setPlans(Array.isArray(rows) ? rows : [])),
  ]).catch(() => {}), [shop, currentWeek])
  useEffect(() => { load(); const timer = setInterval(load, 30000); return () => clearInterval(timer) }, [load])
  const setting = settings.find((row) => row.shop === shop)
  const planner = [setting?.primary_planner_id, setting?.backup_planner_id].includes(activeUser?.id)
  const tabs = [['today', 'Today'], ['week', 'My Week'], ...(planner ? [['schedule', 'Schedule']] : []), ['requests', 'Requests'], ['history', 'History']]
  const myOverview = { ...overview, plans: (overview.plans || []).filter((plan) => plan.user_id === activeUser?.id) }
  const myPlans = plans.filter((plan) => plan.user_id === activeUser?.id)
  const shops = [...new Set(users.map((user) => user.shop).filter(Boolean))]
  const onClock = async () => {
    if (myShift) { if (!window.confirm('End your shift?')) return; await doClockOut() } else await doClockIn()
    load()
  }
  return <div className="sb2-page"><div className="sb2-hero"><div><p>{planner ? `You manage the ${shop} schedule.` : `Your attendance and schedule at ${shop}.`}</p><h1>{planner ? 'Shop operations' : 'My shift'}</h1></div>{planner && <span className="sb2-planner-badge"><ShieldCheck size={14} /> Schedule planner</span>}</div><Tabs tabs={tabs} active={tab} onChange={setTab} />{tab === 'today' && <ManagerToday activeUser={activeUser} myShift={myShift} activeShifts={activeShifts} overview={myOverview} onClock={onClock} shops={shops} />}{tab === 'week' && <MyWeek plans={myPlans} />}{tab === 'schedule' && planner && <ScheduleEditor shop={shop} users={users} />}{tab === 'requests' && <RequestsPanel executive={false} />}{tab === 'history' && <HistoryPanel activeUser={activeUser} shopFilter={shop} allowCorrection />}</div>
}

export function ShiftBoard() {
  const activeUser = useStore((state) => state.activeUser)
  return activeUser?.role === 'executive' ? <ExecutiveView /> : <ManagerView />
}
