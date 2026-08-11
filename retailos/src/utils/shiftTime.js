export const SHIFT_TIME_ZONE = 'Europe/Belgrade'

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHIFT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function partsObject(formatter, value) {
  return Object.fromEntries(
    formatter.formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
}

export function shiftDateKey(value = new Date()) {
  const parts = partsObject(dateFormatter, value instanceof Date ? value : new Date(value))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function addShiftDays(dateKey, days) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)))
  return date.toISOString().slice(0, 10)
}

export function shiftWeekStart(value = new Date()) {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : shiftDateKey(value)
  const [year, month, day] = key.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  const mondayOffset = (utc.getUTCDay() + 6) % 7
  return addShiftDays(key, -mondayOffset)
}

function timeZoneOffsetMs(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = partsObject(formatter, date)
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - date.getTime()
}

/** Convert a Kosovo-local calendar date/time to an unambiguous ISO instant. */
export function shiftLocalToIso(dateKey, time, timeZone = SHIFT_TIME_ZONE) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  const [hour, minute] = String(time).split(':').map(Number)
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  let candidate = new Date(wallClockUtc)
  let offset = timeZoneOffsetMs(candidate, timeZone)
  candidate = new Date(wallClockUtc - offset)
  const correctedOffset = timeZoneOffsetMs(candidate, timeZone)
  if (correctedOffset !== offset) candidate = new Date(wallClockUtc - correctedOffset)
  return candidate.toISOString()
}

export function shiftMinutesBetween(startIso, endIso) {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000))
}

export function shiftTimeLabel(iso) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SHIFT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
