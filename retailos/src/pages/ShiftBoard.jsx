import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BarChart3, CalendarDays, Check, ChevronLeft, ChevronRight, Clock,
  Coffee, Copy, Download, Edit3, FileSpreadsheet, GitBranch, LogIn, LogOut, Plus,
  Save, Send, Settings, ShieldCheck, Sparkles, Timer, Trash2, UserCheck, Users, X,
} from 'lucide-react'
import useStore from '../store/useStore.js'
import * as api from '../api/client.js'
import {
  SHIFT_TIME_ZONE, addShiftDays, shiftDateKey, shiftLocalToIso, shiftWeekStart,
} from '../utils/shiftTime.js'

const EXEC_TABS = [
  ['live', 'Live'], ['schedule', 'Schedule'], ['requests', 'Requests'],
  ['reports', 'Reports'], ['history', 'History'], ['settings', 'Settings'],
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

function formatPlannedDuration(startTime, endTime) {
  const [startHour, startMinute] = String(startTime || '').split(':').map(Number)
  const [endHour, endMinute] = String(endTime || '').split(':').map(Number)
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) return '—'
  return formatDuration((endHour * 60 + endMinute) - (startHour * 60 + startMinute))
}

function initials(name) {
  return String(name || '').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '—'
}

function shortName(fullName) {
  const [first, ...rest] = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  const lastInitial = rest.length ? `${rest[rest.length - 1][0]}.` : ''
  return `${first || ''} ${lastInitial}`.trim() || '—'
}

const SHIFT_AVATAR_COLORS = ['#7c3aed', '#2563eb', '#0f9f83', '#db2777', '#d97706', '#4f46e5']

function shiftAvatarStyle(value) {
  const hash = [...String(value || '')].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) | 0, 0)
  return { '--sb2-avatar-color': SHIFT_AVATAR_COLORS[Math.abs(hash) % SHIFT_AVATAR_COLORS.length] }
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

const REPORT_STATUS_LABELS = {
  completed: 'Completed', active: 'Active', scheduled: 'Scheduled', no_show: 'No-show',
  day_off: 'Day off', unscheduled: 'Unscheduled', active_unscheduled: 'Active · unscheduled',
}

function MonthlyReportKpi({ icon, label, value, note, tone = 'violet' }) {
  return <article className={`sb2-report-kpi is-${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>
}

function MonthlyAttendanceReport({ users, shops }) {
  const [month, setMonth] = useState(() => shiftDateKey().slice(0, 7))
  const [shop, setShop] = useState('')
  const [userId, setUserId] = useState('')
  const [detailView, setDetailView] = useState('all')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const employeeOptions = useMemo(
    () => users.filter((user) => user.role !== 'executive' && (!shop || user.shop === shop)),
    [users, shop],
  )
  useEffect(() => {
    if (userId && !employeeOptions.some((user) => user.id === userId)) setUserId('')
  }, [employeeOptions, userId])
  const load = useCallback(() => {
    setLoading(true); setError('')
    api.fetchMonthlyShiftReport({ month, shop, userId }).then(setReport)
      .catch((err) => setError(err.message)).finally(() => setLoading(false))
  }, [month, shop, userId])
  useEffect(() => { load() }, [load])
  const download = (format) => {
    const anchor = document.createElement('a')
    anchor.href = api.monthlyShiftReportExportUrl(format, { month, shop, userId })
    anchor.download = `RetailOS_Attendance_${month}.${format}`
    document.body.appendChild(anchor); anchor.click(); anchor.remove()
  }
  const summary = report?.summary || {}
  const rows = report?.rows || []
  const visibleRows = detailView === 'exceptions' ? rows.filter((row) => row.flags?.length) : rows
  return <section className="sb2-monthly-report">
    <div className="sb2-report-hero">
      <div className="sb2-report-hero__title"><span><BarChart3 size={20} /></span><div><small>Executive intelligence</small><h2>Monthly attendance report</h2><p>Calendar-month performance, punctuality, exceptions, and worked hours in Kosovo time.</p></div></div>
      <div className="sb2-report-filters">
        <label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label>Shop<select value={shop} onChange={(event) => setShop(event.target.value)}><option value="">All shops</option>{shops.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label>Employee<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">All employees</option>{employeeOptions.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.shop}</option>)}</select></label>
      </div>
      <div className="sb2-report-export"><div><small>Reporting period</small><strong>{report?.month_label || month}</strong><span>{shop || 'All shops'}{userId ? ` · ${employeeOptions.find((user) => user.id === userId)?.name || 'Employee'}` : ''}</span></div><button type="button" onClick={() => download('csv')} disabled={loading}><Download size={14} /> CSV</button><button type="button" className="is-excel" onClick={() => download('xlsx')} disabled={loading}><FileSpreadsheet size={14} /> Excel</button></div>
    </div>
    <Notice>{error}</Notice>
    <div className="sb2-report-kpis" aria-busy={loading}>
      <MonthlyReportKpi icon={<BarChart3 size={18} />} label="Attendance rate" value={summary.attendance_rate == null ? '—' : `${summary.attendance_rate}%`} note={`${summary.attended_periods || 0} of ${summary.attendance_due || 0} due periods attended`} />
      <MonthlyReportKpi icon={<CalendarDays size={18} />} label="Scheduled" value={summary.scheduled_periods || 0} note={`${summary.day_off_count || 0} published days off`} tone="blue" />
      <MonthlyReportKpi icon={<Timer size={18} />} label="Late arrivals" value={summary.late_count || 0} note={`${summary.late_minutes || 0} total late minutes`} tone="amber" />
      <MonthlyReportKpi icon={<AlertTriangle size={18} />} label="No-shows" value={summary.no_show_count || 0} note="Published periods not attended" tone="red" />
      <MonthlyReportKpi icon={<Clock size={18} />} label="Worked hours" value={`${((summary.worked_minutes || 0) / 60).toFixed(1)}h`} note={`${summary.early_departure_count || 0} early departures`} tone="mint" />
      <MonthlyReportKpi icon={<Users size={18} />} label="Unscheduled" value={summary.unscheduled_count || 0} note={`${summary.overrun_count || 0} shift overruns`} tone="slate" />
    </div>
    <div className="sb2-report-exception-strip"><div><span>Early departure</span><strong>{summary.early_departure_count || 0}</strong><small>{summary.early_departure_minutes || 0} min early</small></div><div><span>Overrun</span><strong>{summary.overrun_count || 0}</strong><small>{summary.overrun_minutes || 0} min over</small></div><div><span>Attendance due</span><strong>{summary.attendance_due || 0}</strong><small>Periods elapsed this month</small></div><div><span>Protected rest</span><strong>{summary.day_off_count || 0}</strong><small>Published days off</small></div></div>
    <section className="sb2-card sb2-report-table-card"><header><div><small>Team comparison</small><h3>Employee summary</h3><p>Attendance and exception totals by employee for {report?.month_label || month}.</p></div><span>{report?.employee_summaries?.length || 0} employees</span></header><div className="sb2-table-wrap"><table className="sb2-table sb2-report-table"><thead><tr><th>Employee</th><th>Shop</th><th>Attendance</th><th>Scheduled</th><th>Late</th><th>No-show</th><th>Early</th><th>Overrun</th><th>Unscheduled</th><th>Hours</th></tr></thead><tbody>{loading ? <tr><td colSpan="10">Loading report…</td></tr> : report?.employee_summaries?.length ? report.employee_summaries.map((row) => <tr key={row.user_id}><td><strong>{row.user_name}</strong></td><td>{row.shop}</td><td><span className={`sb2-attendance-rate${row.attendance_rate != null && row.attendance_rate < 90 ? ' is-low' : ''}`}>{row.attendance_rate == null ? '—' : `${row.attendance_rate}%`}</span><small>{row.attended_periods}/{row.attendance_due} due</small></td><td>{row.scheduled_periods}</td><td>{row.late_count}<small>{row.late_minutes} min</small></td><td>{row.no_show_count}</td><td>{row.early_departure_count}<small>{row.early_departure_minutes} min</small></td><td>{row.overrun_count}<small>{row.overrun_minutes} min</small></td><td>{row.unscheduled_count}</td><td><strong>{(row.worked_minutes / 60).toFixed(1)}h</strong></td></tr>) : <tr><td colSpan="10" className="sb2-empty-cell">No published schedules or attendance records for this selection.</td></tr>}</tbody></table></div></section>
    <section className="sb2-card sb2-report-table-card"><header><div><small>Audit detail</small><h3>Attendance records</h3><p>Planned and actual activity with exact exception minutes.</p></div><div className="sb2-report-view-toggle"><button type="button" className={detailView === 'all' ? 'is-active' : ''} onClick={() => setDetailView('all')}>All records</button><button type="button" className={detailView === 'exceptions' ? 'is-active' : ''} onClick={() => setDetailView('exceptions')}>Exceptions</button></div></header><div className="sb2-table-wrap"><table className="sb2-table sb2-report-table"><thead><tr><th>Date</th><th>Employee</th><th>Shop</th><th>Planned</th><th>Actual</th><th>Worked</th><th>Status</th><th>Exceptions</th><th>Variance</th></tr></thead><tbody>{loading ? <tr><td colSpan="9">Loading report…</td></tr> : visibleRows.length ? visibleRows.map((row) => <tr key={row.id}><td>{formatDate(row.date, { weekday: true, year: false })}</td><td><strong>{row.user_name}</strong></td><td>{row.shop}</td><td>{row.plan_type === 'shift' ? `${row.planned_start}–${row.planned_end}` : row.plan_type === 'day_off' ? 'Day off' : '—'}</td><td>{row.actual_clock_in ? `${formatTime(row.actual_clock_in)}–${row.actual_clock_out ? formatTime(row.actual_clock_out) : 'Active'}` : '—'}</td><td>{row.worked_minutes ? formatDuration(row.worked_minutes) : '—'}</td><td><span className={`sb2-report-status is-${row.status}`}>{REPORT_STATUS_LABELS[row.status] || row.status}</span></td><td><div className="sb2-flags">{row.flags.map((flag) => <FlagPill key={flag} flag={flag} />)}</div></td><td><div className="sb2-report-variance">{row.late_minutes > 0 && <span>+{row.late_minutes}m late</span>}{row.early_departure_minutes > 0 && <span>{row.early_departure_minutes}m early</span>}{row.overrun_minutes > 0 && <span>+{row.overrun_minutes}m over</span>}{!row.late_minutes && !row.early_departure_minutes && !row.overrun_minutes && '—'}</div></td></tr>) : <tr><td colSpan="9" className="sb2-empty-cell">No {detailView === 'exceptions' ? 'exceptions' : 'attendance records'} for this selection.</td></tr>}</tbody></table></div></section>
  </section>
}

function ScheduleEditor({ shop, users }) {
  const [weekStart, setWeekStart] = useState(() => shiftWeekStart())
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [composerMode, setComposerMode] = useState('')
  const [form, setForm] = useState({ user_id: '', shift_date: shiftWeekStart(), start_time: '09:00', end_time: '17:00', plan_type: 'shift' })
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addShiftDays(weekStart, index)), [weekStart])
  const eligibleUsers = useMemo(
    () => users.filter((user) => user.role !== 'executive' && user.shop === shop),
    [users, shop],
  )
  const usersByAvailability = useMemo(() => {
    const dayPlans = plans.filter((plan) => plan.shift_date === form.shift_date && plan.id !== editingId)
    const plannedCount = new Map()
    const offUserIds = new Set(dayPlans.filter((plan) => plan.plan_type === 'day_off').map((plan) => plan.user_id))
    for (const plan of dayPlans.filter((plan) => plan.plan_type !== 'day_off')) plannedCount.set(plan.user_id, (plannedCount.get(plan.user_id) || 0) + 1)
    return {
      available: eligibleUsers.filter((user) => !plannedCount.has(user.id) && !offUserIds.has(user.id)),
      scheduled: eligibleUsers.filter((user) => plannedCount.has(user.id) && !offUserIds.has(user.id)).map((user) => ({ ...user, plannedCount: plannedCount.get(user.id) })),
    }
  }, [eligibleUsers, plans, form.shift_date, editingId])
  const composerUsers = composerMode === 'split' ? usersByAvailability.scheduled : usersByAvailability.available
  const shiftPlans = plans.filter((plan) => plan.plan_type !== 'day_off')
  const dayOffPlans = plans.filter((plan) => plan.plan_type === 'day_off')
  const draftCount = plans.filter((plan) => plan.status === 'draft').length
  const staffedDays = new Set(shiftPlans.map((plan) => plan.shift_date)).size
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) || null
  const selectedUserPeriods = selectedPlan ? shiftPlans.filter((plan) => plan.user_id === selectedPlan.user_id && plan.shift_date === selectedPlan.shift_date) : []
  const selectedPeriodIndex = selectedPlan ? selectedUserPeriods.findIndex((plan) => plan.id === selectedPlan.id) : -1
  const load = useCallback(() => {
    if (!shop) return
    setLoading(true); setError('')
    api.fetchShiftPlans(weekStart, shop).then((rows) => setPlans(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err.message)).finally(() => setLoading(false))
  }, [weekStart, shop])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    setEditingId(''); setSelectedPlanId(''); setComposerMode('')
    setForm({ user_id: '', shift_date: weekStart, start_time: '09:00', end_time: '17:00', plan_type: 'shift' })
  }, [weekStart, shop])
  useEffect(() => {
    if (!composerMode || editingId) return
    if (!composerUsers.some((user) => user.id === form.user_id)) {
      setForm((current) => ({ ...current, user_id: composerUsers[0]?.id || '' }))
    }
  }, [composerMode, composerUsers, editingId, form.user_id])
  const reset = () => {
    setEditingId(''); setComposerMode('')
    setForm({ user_id: '', shift_date: weekStart, start_time: '09:00', end_time: '17:00', plan_type: 'shift' })
  }
  const openComposer = (mode, date = form.shift_date, userId = '') => {
    const dayPlans = plans.filter((plan) => plan.shift_date === date)
    const plannedIds = new Set(dayPlans.filter((plan) => plan.plan_type !== 'day_off').map((plan) => plan.user_id))
    const offIds = new Set(dayPlans.filter((plan) => plan.plan_type === 'day_off').map((plan) => plan.user_id))
    const candidates = mode === 'split'
      ? eligibleUsers.filter((user) => plannedIds.has(user.id) && !offIds.has(user.id))
      : eligibleUsers.filter((user) => !plannedIds.has(user.id) && !offIds.has(user.id))
    setError(''); setMessage(''); setEditingId(''); setComposerMode(mode)
    setForm({
      user_id: candidates.some((user) => user.id === userId) ? userId : (candidates[0]?.id || ''),
      shift_date: date, start_time: mode === 'split' ? '17:00' : '09:00',
      end_time: mode === 'split' ? '21:00' : '17:00', plan_type: mode === 'day_off' ? 'day_off' : 'shift',
    })
  }
  const save = async (event) => {
    event.preventDefault(); setError(''); setMessage('')
    try {
      const payload = { ...form, shop }
      const saved = editingId ? await api.putShiftPlan(editingId, payload) : await api.postShiftPlan(payload)
      setSelectedPlanId(saved.id)
      setMessage(editingId ? 'Schedule entry updated.' : form.plan_type === 'day_off' ? 'Day off added to the draft.' : composerMode === 'split' ? 'Split shift added to the draft.' : 'Shift added to the draft.')
      reset(); load()
    } catch (err) { setError(err.message) }
  }
  const edit = (plan) => {
    setError(''); setMessage(''); setSelectedPlanId(plan.id); setEditingId(plan.id); setComposerMode(plan.plan_type === 'day_off' ? 'day_off' : 'shift')
    setForm({ user_id: plan.user_id, shift_date: plan.shift_date, start_time: plan.start_time, end_time: plan.end_time, plan_type: plan.plan_type || 'shift' })
  }
  const remove = async (plan) => {
    const entryName = plan.plan_type === 'day_off' ? 'day-off entry' : 'planned shift'
    if (!window.confirm(`${plan.status === 'published' ? 'Cancel' : 'Delete'} this ${entryName}?`)) return
    try { await api.deleteShiftPlan(plan.id); if (selectedPlanId === plan.id) setSelectedPlanId(''); reset(); load() } catch (err) { setError(err.message) }
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
  const modeDetails = {
    shift: { icon: <Plus size={18} />, eyebrow: 'New coverage', title: 'Add a shift', help: 'Assign an employee who has no shift on the selected day.', submit: 'Add shift' },
    split: { icon: <GitBranch size={18} />, eyebrow: 'Second period', title: 'Add split shift', help: 'Add another non-overlapping work period for an already scheduled employee.', submit: 'Add split shift' },
    day_off: { icon: <Coffee size={18} />, eyebrow: 'Protected rest', title: 'Mark day off', help: 'Create a visible, publishable day-off entry in the weekly schedule.', submit: 'Add day off' },
  }
  const activeMode = modeDetails[composerMode] || modeDetails.shift
  return (
    <section className="sb2-schedule">
      <div className="sb2-schedule-command">
        <div className="sb2-schedule-command__top">
          <div><span className="sb2-command-eyebrow"><Sparkles size={12} /> Schedule studio</span><h2>{shop} workforce plan</h2><p>Build coverage, split periods, and protected days off in one operational view.</p></div>
          <div className="sb2-week-nav sb2-week-nav--glass"><button type="button" aria-label="Previous week" onClick={() => setWeekStart(addShiftDays(weekStart, -7))}><ChevronLeft size={16} /></button><div><small>Week of</small><strong>{formatDate(weekStart, { year: false })} – {formatDate(addShiftDays(weekStart, 6))}</strong></div><button type="button" aria-label="Next week" onClick={() => setWeekStart(addShiftDays(weekStart, 7))}><ChevronRight size={16} /></button></div>
        </div>
        <div className="sb2-schedule-command__bottom">
          <div className="sb2-schedule-stats"><div><strong>{shiftPlans.length}</strong><span>Shift periods</span></div><div><strong>{dayOffPlans.length}</strong><span>Days off</span></div><div><strong>{staffedDays}/7</strong><span>Days covered</span></div><div className={draftCount ? 'has-drafts' : ''}><strong>{draftCount}</strong><span>Unpublished</span></div></div>
          <div className="sb2-command-actions"><button type="button" onClick={copyPrevious}><Copy size={14} /> Copy last week</button><button type="button" className="sb2-publish-button" onClick={publish}><Send size={14} /> Publish schedule</button></div>
        </div>
      </div>
      <Notice>{error}</Notice><Notice type="success">{message}</Notice>
      <div className="sb2-schedule-actions" aria-label="Schedule actions">
        <button type="button" className={composerMode === 'shift' && !editingId ? 'is-active' : ''} onClick={() => openComposer('shift')}><span><Plus size={18} /></span><div><strong>Add shift</strong><small>New work period</small></div></button>
        <button type="button" className={composerMode === 'split' ? 'is-active' : ''} onClick={() => openComposer('split')}><span><GitBranch size={18} /></span><div><strong>Split shift</strong><small>Second work period</small></div></button>
        <button type="button" className={composerMode === 'day_off' && !editingId ? 'is-active' : ''} onClick={() => openComposer('day_off')}><span><Coffee size={18} /></span><div><strong>Day off</strong><small>Protected rest day</small></div></button>
      </div>
      {composerMode && <form className={`sb2-card sb2-plan-composer sb2-plan-composer--${composerMode}`} onSubmit={save}>
        <div className="sb2-plan-composer__intro"><span className="sb2-plan-composer__icon">{editingId ? <Edit3 size={18} /> : activeMode.icon}</span><div><span>{editingId ? 'Edit schedule' : activeMode.eyebrow}</span><h3>{editingId ? `Edit ${form.plan_type === 'day_off' ? 'day off' : 'shift'}` : activeMode.title}</h3><p>{activeMode.help}</p></div><button type="button" aria-label="Close composer" onClick={reset}><X size={17} /></button></div>
        <div className="sb2-plan-composer__fields">
          <label>Employee<select required value={form.user_id} disabled={editingId && form.plan_type === 'day_off'} onChange={(event) => setForm({ ...form, user_id: event.target.value })}><option value="">{composerUsers.length || editingId ? 'Choose employee' : composerMode === 'split' ? 'No scheduled employees on this date' : 'Everyone already has an entry'}</option>{editingId && !composerUsers.some((user) => user.id === form.user_id) && <option value={form.user_id}>{eligibleUsers.find((user) => user.id === form.user_id)?.name || 'Current employee'}</option>}{composerUsers.map((user) => <option key={user.id} value={user.id}>{user.name}{user.plannedCount ? ` · ${user.plannedCount} shift${user.plannedCount === 1 ? '' : 's'}` : ''}</option>)}</select></label>
          <label>Date<input required type="date" min={weekStart} max={addShiftDays(weekStart, 6)} value={form.shift_date} onChange={(event) => setForm({ ...form, shift_date: event.target.value })} /></label>
          {form.plan_type !== 'day_off' && <><label>Starts<input required type="time" value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></label><label>Ends<input required type="time" value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></label></>}
        </div>
        <div className="sb2-plan-composer__footer"><span>{form.plan_type === 'day_off' ? <><Coffee size={13} /> No attendance alerts will run for this entry.</> : <><ShieldCheck size={13} /> Overlapping periods are blocked automatically.</>}</span><div>{editingId && <button type="button" onClick={reset}>Cancel</button>}<button type="submit" className="sb2-button--primary" disabled={!form.user_id}><Save size={14} /> {editingId ? 'Save changes' : activeMode.submit}</button></div></div>
      </form>}
      {selectedPlan && <aside className={`sb2-plan-inspector${selectedPlan.plan_type === 'day_off' ? ' is-day-off' : ''}`} aria-label="Schedule entry details">
        <div className="sb2-plan-inspector__identity"><span className="sb2-plan-inspector__avatar">{initials(selectedPlan.user_name)}</span><div><span>Selected schedule entry</span><h3>{selectedPlan.user_name}</h3><p>{selectedPlan.shop} · {formatDate(selectedPlan.shift_date, { weekday: true })}</p></div><button type="button" aria-label="Close shift details" onClick={() => setSelectedPlanId('')}><X size={17} /></button></div>
        <div className="sb2-plan-inspector__facts"><div><span>Date</span><strong>{formatDate(selectedPlan.shift_date, { weekday: true })}</strong></div><div><span>Schedule</span><strong>{selectedPlan.plan_type === 'day_off' ? 'Day off' : `${selectedPlan.start_time}–${selectedPlan.end_time}`}</strong><small>{selectedPlan.plan_type === 'day_off' ? 'Attendance alerts paused' : formatPlannedDuration(selectedPlan.start_time, selectedPlan.end_time)}</small></div><div><span>Entry type</span><strong>{selectedPlan.plan_type === 'day_off' ? 'Protected rest' : selectedUserPeriods.length > 1 ? `Split period ${selectedPeriodIndex + 1} of ${selectedUserPeriods.length}` : 'Standard shift'}</strong></div><div><span>Publication</span><strong className={`sb2-plan-inspector__status is-${selectedPlan.status}`}>{selectedPlan.status}</strong><small>{selectedPlan.status === 'draft' ? 'Not visible as final yet' : 'Visible to employee'}</small></div></div>
        {selectedUserPeriods.length > 1 && <div className="sb2-plan-inspector__timeline"><span><GitBranch size={12} /> Daily split timeline</span><div>{selectedUserPeriods.map((period, index) => <button type="button" className={period.id === selectedPlan.id ? 'is-selected' : ''} key={period.id} onClick={() => setSelectedPlanId(period.id)}><small>Period {index + 1}</small><strong>{period.start_time}–{period.end_time}</strong><span>{formatPlannedDuration(period.start_time, period.end_time)}</span></button>)}</div></div>}
        <div className="sb2-plan-inspector__actions"><span>Click any schedule card to inspect its full details.</span><div>{selectedPlan.plan_type !== 'day_off' && <button type="button" onClick={() => openComposer('split', selectedPlan.shift_date, selectedPlan.user_id)}><GitBranch size={13} /> Add split</button>}<button type="button" onClick={() => edit(selectedPlan)}><Edit3 size={13} /> Edit</button><button type="button" className="is-danger" onClick={() => remove(selectedPlan)}><Trash2 size={13} /> Delete</button></div></div>
      </aside>}
      <div className="sb2-week-grid-shell">
        <div className="sb2-week-grid" aria-busy={loading}>
          {days.map((day) => {
            const dayPlans = plans.filter((plan) => plan.shift_date === day)
            const dayShifts = dayPlans.filter((plan) => plan.plan_type !== 'day_off')
            return (
              <article className={`sb2-day${day === shiftDateKey() ? ' sb2-day--today' : ''}`} key={day}>
                <header>
                  <div><span>{formatDate(day, { weekday: true, year: false }).split(' ')[0]}</span><strong>{formatDate(day, { weekday: true, year: false }).replace(/^\w+\s/, '')}</strong></div>
                  <span>{dayShifts.length ? `${dayShifts.length} period${dayShifts.length === 1 ? '' : 's'}` : 'Open'}</span>
                </header>
                <div className="sb2-day__quick">
                  <button type="button" aria-label={`Add shift on ${formatDate(day)}`} onClick={() => openComposer('shift', day)}><Plus size={11} /> Shift</button>
                  <button type="button" aria-label={`Add day off on ${formatDate(day)}`} onClick={() => openComposer('day_off', day)}><Coffee size={11} /> Off</button>
                </div>
                <div className="sb2-day__body">
                  {dayPlans.length ? dayPlans.map((plan) => (
                    <div
                      role="button" tabIndex="0" aria-label={`View details for ${plan.user_name}`} aria-pressed={selectedPlanId === plan.id}
                      className={`sb2-plan sb2-plan--${plan.status}${plan.plan_type === 'day_off' ? ' sb2-plan--day-off' : ''}${selectedPlanId === plan.id ? ' is-selected' : ''}`}
                      key={plan.id} onClick={() => setSelectedPlanId(plan.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedPlanId(plan.id) } }}
                    >
                      <span className="sb2-plan__avatar" style={shiftAvatarStyle(plan.user_id || plan.user_name)}>{initials(plan.user_name)}</span>
                      <strong className="sb2-plan__name" title={plan.user_name}>{shortName(plan.user_name)}</strong>
                      {plan.plan_type === 'day_off' ? (
                        <><span className="sb2-plan__day-off-label">Day off</span><Coffee className="sb2-plan__day-off-icon" size={13} /></>
                      ) : (
                        <>
                          <span className="sb2-plan__range">{plan.start_time}–{plan.end_time}</span>
                          <small className="sb2-plan__duration">{formatPlannedDuration(plan.start_time, plan.end_time).replace(/\s0m$/, '')}</small>
                          {plan.status === 'draft' && <span className="sb2-plan__status">Draft</span>}
                        </>
                      )}
                    </div>
                  )) : (
                    <button type="button" className="sb2-day__empty" onClick={() => openComposer('shift', day)}><Plus size={12} /> Build this day</button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
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
  return <div className="sb2-page"><div className="sb2-hero"><div><p>Planned versus actual staffing in Kosovo time.</p><h1>Today’s operations</h1></div>{['schedule', 'history'].includes(tab) && <label className="sb2-shop-filter">Shop<select value={shop} onChange={(event) => setShop(event.target.value)}>{shops.map((name) => <option key={name}>{name}</option>)}</select></label>}</div><Tabs tabs={EXEC_TABS} active={tab} onChange={setTab} /><Notice>{error}</Notice>{tab === 'live' && <><KpiGrid counts={overview.counts} /><section className="sb2-section"><div className="sb2-section-header"><div><h2>Live coverage</h2><p>Who is available across every shop right now.</p></div><span className="sb2-timezone">{SHIFT_TIME_ZONE}</span></div><CoverageGrid shifts={activeShifts} shops={shops} /></section><WeeklyHours rows={overview.weekly_hours} /><section className="sb2-card sb2-exceptions"><header className="sb2-section-header"><div><h2>Attendance exceptions</h2><p>Late, missing, unscheduled, early, and overrun activity requiring attention.</p></div></header>{exceptions.length ? exceptions.map((item) => { const shift = item.actual || item; const flags = item.exception ? [item.exception] : shift.attendance_flags; return <div className="sb2-exception-row" key={item.id}><div><strong>{item.user_name || shift.user_name}</strong><span>{item.shop || shift.shop} · {item.start_time ? `${item.start_time}–${item.end_time}` : formatTime(shift.clock_in)}</span></div><div className="sb2-flags">{flags.map((flag) => <FlagPill key={flag} flag={flag} />)}</div></div> }) : <div className="sb2-empty-cell"><UserCheck size={24} /> No attendance exceptions today.</div>}</section></>}{tab === 'schedule' && <ScheduleEditor shop={shop} users={users} />}{tab === 'requests' && <RequestsPanel executive />}{tab === 'reports' && <MonthlyAttendanceReport users={users} shops={shops} />}{tab === 'history' && <HistoryPanel activeUser={activeUser} shopFilter={shop} />}{tab === 'settings' && <SettingsPanel settings={settings} users={users} onSaved={loadSettings} />}</div>
}

function ManagerToday({ activeUser, myShift, activeShifts, overview, onClock, shops }) {
  const todayPlans = overview.plans || []
  return <><div className="sb2-manager-top"><section className={`sb2-card sb2-clock-card${myShift ? ' is-active' : ''}`}><div className="sb2-clock-card__icon"><Clock size={26} /></div><div><span className="sb2-eyebrow">{myShift ? 'On shift' : 'Not clocked in'}</span><h2>{myShift ? <LiveClock clockIn={myShift.clock_in} /> : 'Ready to start?'}</h2><p>{myShift ? `Working at ${myShift.shop}` : 'Clock in to appear as available for transfers and tasks.'}</p></div><button type="button" className={myShift ? 'sb2-button--danger' : 'sb2-button--clock'} onClick={onClock}>{myShift ? <><LogOut size={15} /> End shift</> : <><LogIn size={15} /> Clock in</>}</button></section><section className="sb2-card sb2-today-plan"><header><div><span className="sb2-eyebrow">Today</span><h2>Planned shifts</h2></div><CalendarDays size={20} /></header>{todayPlans.length ? todayPlans.map((plan) => <div className={`sb2-timeline${plan.plan_type === 'day_off' ? ' is-day-off' : ''}`} key={plan.id}><span /><div><strong>{plan.plan_type === 'day_off' ? 'Day off' : `${plan.start_time}–${plan.end_time}`}</strong><small>{plan.shop}</small></div><span className={`sb2-status sb2-status--${plan.plan_type === 'day_off' || plan.actual ? 'approved' : plan.exception ? 'rejected' : 'pending'}`}>{plan.plan_type === 'day_off' ? 'Rest day' : plan.actual ? 'Clocked' : plan.exception ? 'Missing' : 'Scheduled'}</span></div>) : <div className="sb2-empty-small">No published shift today. Clock-in is still allowed and will be flagged as unscheduled.</div>}</section></div><section className="sb2-section"><div className="sb2-section-header"><div><h2>Live coverage</h2><p>Managers currently available across all shops.</p></div></div><CoverageGrid shifts={activeShifts} shops={shops.length ? shops : [activeUser.shop]} showTiming={false} /></section></>
}

function MyWeek({ plans }) {
  const start = shiftWeekStart()
  const days = Array.from({ length: 7 }, (_, index) => addShiftDays(start, index))
  return <section className="sb2-card sb2-my-week"><header className="sb2-section-header"><div><h2>My week</h2><p>Your published and draft work periods.</p></div></header><div className="sb2-my-week__grid">{days.map((day) => <article className={day === shiftDateKey() ? 'is-today' : ''} key={day}><header><strong>{formatDate(day, { weekday: true, year: false })}</strong></header>{plans.filter((plan) => plan.shift_date === day).map((plan) => <div className={`sb2-my-shift${plan.plan_type === 'day_off' ? ' is-day-off' : ''}`} key={plan.id}><strong>{plan.plan_type === 'day_off' ? 'Day off' : `${plan.start_time}–${plan.end_time}`}</strong><span>{plan.shop}</span><small>{plan.status}</small></div>)}{!plans.some((plan) => plan.shift_date === day) && <span className="sb2-day-off">No schedule entry</span>}</article>)}</div></section>
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
