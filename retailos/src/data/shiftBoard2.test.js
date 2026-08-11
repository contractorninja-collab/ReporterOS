import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shiftLocalToIso } from '../utils/shiftTime.js'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-shift-board-'))
process.env.DATA_DIR = dataDir
const db = await import('./db.js')

test('supports planner settings, split shifts, attendance flags, and correction approval', () => {
  const ringUsers = db.getAllUsers().filter((user) => user.shop === 'Ring Mall')
  const villageUser = db.getAllUsers().find((user) => user.shop === 'Village')
  const executive = db.getAllUsers().find((user) => user.role === 'executive')
  const [manager, backup] = ringUsers

  const settings = db.saveShiftSetting('Ring Mall', {
    primary_planner_id: manager.id,
    backup_planner_id: backup.id,
    late_grace_min: 10,
    no_show_after_min: 30,
    early_departure_grace_min: 15,
    overrun_grace_min: 15,
    tracking_start_date: '2026-08-01',
  }, executive.id)
  assert.equal(settings.primary_planner_id, manager.id)
  assert.equal(db.isShiftPlanner(backup.id, 'Ring Mall'), true)

  const first = db.createShiftPlan({
    id: 'plan-morning', user_id: manager.id, shop: 'Ring Mall',
    shift_date: '2026-08-11', start_time: '09:00', end_time: '13:00',
  }, manager.id)
  const second = db.createShiftPlan({
    id: 'plan-evening', user_id: manager.id, shop: 'Ring Mall',
    shift_date: '2026-08-11', start_time: '16:00', end_time: '21:00',
  }, manager.id)
  assert.equal(first.status, 'draft')
  assert.equal(second.start_time, '16:00')
  assert.throws(() => db.createShiftPlan({
    user_id: manager.id, shop: 'Ring Mall', shift_date: '2026-08-11',
    start_time: '12:30', end_time: '17:00',
  }, manager.id), /overlaps/)
  assert.throws(() => db.createShiftPlan({
    user_id: backup.id, shop: 'Ring Mall', shift_date: '2026-08-11',
    start_time: '22:00', end_time: '01:00',
  }, manager.id), /same day/)

  const published = db.publishShiftPlanWeek('Ring Mall', '2026-08-10', manager.id)
  assert.equal(published.length, 2)
  const lateShift = db.clockIn('actual-morning', manager, shiftLocalToIso('2026-08-11', '09:15'))
  assert.equal(lateShift.planned_shift_id, 'plan-morning')
  assert.deepEqual(lateShift.attendance_flags, ['late'])
  assert.equal(lateShift.user_name, manager.name)
  assert.equal(lateShift.shop, 'Ring Mall')

  const early = db.clockOut('actual-morning', 'manual', shiftLocalToIso('2026-08-11', '12:30'))
  assert.ok(early.attendance_flags.includes('early_departure'))
  const evening = db.clockIn('actual-evening', manager, shiftLocalToIso('2026-08-11', '15:58'))
  assert.equal(evening.planned_shift_id, 'plan-evening')
  db.clockOut('actual-evening', 'manual', shiftLocalToIso('2026-08-11', '21:00'))

  const unscheduled = db.clockIn('actual-unscheduled', villageUser, shiftLocalToIso('2026-08-11', '10:00'))
  assert.deepEqual(unscheduled.attendance_flags, ['unscheduled'])
  db.clockOut('actual-unscheduled', 'manual', shiftLocalToIso('2026-08-11', '18:00'))

  const correction = db.createShiftCorrectionRequest({
    id: 'correction-1', shift_id: early.id,
    proposed_clock_in: shiftLocalToIso('2026-08-11', '09:00'),
    proposed_clock_out: shiftLocalToIso('2026-08-11', '13:00'),
    reason: 'Clock terminal was unavailable at opening.',
  }, manager)
  assert.equal(correction.status, 'pending')
  const reviewed = db.reviewShiftCorrectionRequest(correction.id, 'approved', executive, 'Confirmed with shop log.')
  assert.equal(reviewed.status, 'approved')
  const correctedShift = db.getShiftById(early.id)
  assert.equal(correctedShift.duration_min, 240)
  assert.equal(correctedShift.clock_out_reason, 'approved_correction')
})

test('deduplicates no-show evaluation and copies a published week as drafts', () => {
  const villageUser = db.getAllUsers().find((user) => user.shop === 'Village')
  const executive = db.getAllUsers().find((user) => user.role === 'executive')
  db.saveShiftSetting('Village', { tracking_start_date: '2026-08-01' }, executive.id)
  db.createShiftPlan({
    id: 'no-show-plan', user_id: villageUser.id, shop: 'Village',
    shift_date: '2026-08-12', start_time: '10:00', end_time: '18:00',
  }, executive.id)
  db.publishShiftPlanWeek('Village', '2026-08-10', executive.id)
  const first = db.evaluateShiftAttendance(shiftLocalToIso('2026-08-12', '10:31'))
  const second = db.evaluateShiftAttendance(shiftLocalToIso('2026-08-12', '11:00'))
  assert.equal(first.notifications, 1)
  assert.equal(second.notifications, 0)
  assert.ok(db.getShiftPlanById('no-show-plan').no_show_notified_at)

  const copied = db.copyShiftPlanWeek('Village', '2026-08-10', '2026-08-17', executive.id)
  assert.equal(copied.length, 1)
  assert.equal(copied[0].shift_date, '2026-08-19')
  assert.equal(copied[0].status, 'draft')
})

test('stores day off as a publishable schedule entry without attendance alerts', () => {
  const outletUser = db.getAllUsers().find((user) => user.shop === 'Outlet')
  const executive = db.getAllUsers().find((user) => user.role === 'executive')
  db.saveShiftSetting('Outlet', { tracking_start_date: '2026-08-01' }, executive.id)

  const dayOff = db.createShiftPlan({
    id: 'outlet-day-off', user_id: outletUser.id, shop: 'Outlet',
    shift_date: '2026-08-13', plan_type: 'day_off',
  }, executive.id)
  assert.equal(dayOff.plan_type, 'day_off')
  assert.equal(dayOff.start_time, '00:00')
  assert.throws(() => db.createShiftPlan({
    user_id: outletUser.id, shop: 'Outlet', shift_date: '2026-08-13',
    start_time: '09:00', end_time: '17:00',
  }, executive.id), /day-off entry/)

  db.publishShiftPlanWeek('Outlet', '2026-08-10', executive.id)
  const evaluation = db.evaluateShiftAttendance(shiftLocalToIso('2026-08-13', '18:00'))
  assert.equal(evaluation.evaluated, 0)
  assert.equal(db.getShiftPlanById(dayOff.id).no_show_notified_at, null)

  const unscheduled = db.clockIn('day-off-clock-in', outletUser, shiftLocalToIso('2026-08-13', '10:00'))
  assert.deepEqual(unscheduled.attendance_flags, ['unscheduled'])
  assert.equal(unscheduled.planned_shift_id, null)
  db.clockOut(unscheduled.id, 'manual', shiftLocalToIso('2026-08-13', '11:00'))
})

test('builds calendar-month attendance summaries with minutes and exceptions', () => {
  const [manager, backup] = db.getAllUsers().filter((user) => user.shop === 'Ring Mall')
  const executive = db.getAllUsers().find((user) => user.role === 'executive')
  db.createShiftPlan({ id: 'month-late', user_id: manager.id, shop: 'Ring Mall', shift_date: '2026-09-07', start_time: '09:00', end_time: '17:00' }, executive.id)
  db.createShiftPlan({ id: 'month-no-show', user_id: manager.id, shop: 'Ring Mall', shift_date: '2026-09-08', start_time: '09:00', end_time: '17:00' }, executive.id)
  db.createShiftPlan({ id: 'month-overrun', user_id: manager.id, shop: 'Ring Mall', shift_date: '2026-09-09', start_time: '09:00', end_time: '17:00' }, executive.id)
  db.createShiftPlan({ id: 'month-day-off', user_id: manager.id, shop: 'Ring Mall', shift_date: '2026-09-10', plan_type: 'day_off' }, executive.id)
  db.publishShiftPlanWeek('Ring Mall', '2026-09-07', executive.id)

  db.clockIn('month-late-actual', manager, shiftLocalToIso('2026-09-07', '09:20'))
  db.clockOut('month-late-actual', 'manual', shiftLocalToIso('2026-09-07', '16:30'))
  db.clockIn('month-overrun-actual', manager, shiftLocalToIso('2026-09-09', '09:00'))
  db.clockOut('month-overrun-actual', 'manual', shiftLocalToIso('2026-09-09', '17:30'))
  db.clockIn('month-unscheduled-actual', backup, shiftLocalToIso('2026-09-09', '12:00'))
  db.clockOut('month-unscheduled-actual', 'manual', shiftLocalToIso('2026-09-09', '14:00'))

  const report = db.getMonthlyAttendanceReport({ month: '2026-09', shop: 'Ring Mall' }, shiftLocalToIso('2026-09-30', '12:00'))
  const managerSummary = report.employee_summaries.find((row) => row.user_id === manager.id)
  assert.equal(report.month_label, 'September 2026')
  assert.equal(managerSummary.scheduled_periods, 3)
  assert.equal(managerSummary.attended_periods, 2)
  assert.equal(managerSummary.attendance_rate, 66.7)
  assert.equal(managerSummary.late_count, 1)
  assert.equal(managerSummary.late_minutes, 20)
  assert.equal(managerSummary.no_show_count, 1)
  assert.equal(managerSummary.early_departure_minutes, 30)
  assert.equal(managerSummary.overrun_minutes, 30)
  assert.equal(managerSummary.day_off_count, 1)
  assert.equal(report.summary.unscheduled_count, 1)
  assert.ok(report.rows.some((row) => row.status === 'no_show'))
})

test.after(() => {
  db.closeDatabaseForTests()
  fs.rmSync(dataDir, { recursive: true, force: true })
})
