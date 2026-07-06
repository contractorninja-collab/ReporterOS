import * as api from '../../api/client.js'
import {
  asArray,
  generateId,
  notifyLocalWriteFailure,
  resyncAfterWriteFailure,
} from '../storeHelpers.js'

/** Clock-in / clock-out and active shift tracking. */
export function createShiftsSlice(set, get) {
  return {
    clockIn: async () => {
      const user = get().activeUser
      if (!user || user.role === 'executive') return null
      const id = generateId()
      const shift = { id, user_id: user.id, user_name: user.name, shop: user.shop, clock_in: new Date().toISOString(), clock_out: null, duration_min: null }
      set((s) => ({
        activeShifts: [...s.activeShifts, shift],
        myShift: shift,
      }))
      try {
        await api.postClockIn({ id, userId: user.id, userName: user.name, shop: user.shop })
        get().syncOperationalData?.().catch(() => {})
      } catch (err) {
        set((s) => ({
          activeShifts: s.activeShifts.filter((sh) => sh.id !== id),
          myShift: s.myShift?.id === id ? null : s.myShift,
        }))
        notifyLocalWriteFailure(set, get, 'Clock-in was not saved', err)
        resyncAfterWriteFailure(get)
        return null
      }
      get().addNotification({
        type: 'shift_clock_in',
        title: 'Shift Started',
        message: `${user.name} clocked in at ${user.shop}`,
        userId: 'executives',
        relatedId: id,
      })
      return shift
    },

    clockOut: async () => {
      const shift = get().myShift
      if (!shift) return null
      const user = get().activeUser
      const now = new Date()
      const durationMin = Math.round((now.getTime() - new Date(shift.clock_in).getTime()) / 60000)
      const updated = { ...shift, clock_out: now.toISOString(), duration_min: durationMin }
      set((s) => ({
        activeShifts: s.activeShifts.filter((sh) => sh.id !== shift.id),
        myShift: null,
      }))
      try {
        await api.putClockOut(shift.id)
      } catch (err) {
        set((s) => ({
          activeShifts: s.activeShifts.some((sh) => sh.id === shift.id) ? s.activeShifts : [...s.activeShifts, shift],
          myShift: shift,
        }))
        notifyLocalWriteFailure(set, get, 'Clock-out was not saved', err)
        resyncAfterWriteFailure(get)
        return null
      }
      get().addNotification({
        type: 'shift_clock_out',
        title: 'Shift Ended',
        message: `${user?.name || 'User'} clocked out from ${shift.shop} (${Math.floor(durationMin / 60)}h ${durationMin % 60}m)`,
        userId: 'executives',
        relatedId: shift.id,
      })
      return updated
    },

    fetchActiveShifts: async () => {
      try {
        const data = await api.fetchActiveShifts()
        const arr = asArray(data)
        const me = get().activeUser
        set({ activeShifts: arr, myShift: me ? arr.find((s) => s.user_id === me.id) || null : null })
      } catch { /* ignore */ }
    },
  }
}
