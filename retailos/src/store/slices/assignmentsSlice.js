import * as api from '../../api/client.js'
import {
  generateId,
  notifyLocalWriteFailure,
  resyncAfterWriteFailure,
} from '../storeHelpers.js'

/** Task/assignment workflow (incl. photo-task completion). */
export function createAssignmentsSlice(set, get) {
  return {
    addAssignment: (assignment) => {
      const full = { ...assignment, id: assignment.id || generateId(), createdAt: new Date().toISOString(), completedAt: null }
      set((state) => ({ assignments: [full, ...state.assignments] }))
      api.postAssignment(full).catch((err) => {
        set((state) => ({ assignments: state.assignments.filter((a) => a.id !== full.id) }))
        notifyLocalWriteFailure(set, get, 'Task was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    /** Many tasks in one React update + one API call (e.g. large CSV import photo reminders). */
    addAssignments: (assignments) => {
      if (!assignments?.length) return
      const enriched = assignments.map((a) => ({
        ...a,
        id: a.id || generateId(),
        createdAt: new Date().toISOString(),
        completedAt: null,
      }))
      set((state) => ({ assignments: [...enriched, ...state.assignments] }))
      api.postAssignmentsBulk(enriched).catch((err) => {
        const ids = new Set(enriched.map((a) => a.id))
        set((state) => ({ assignments: state.assignments.filter((a) => !ids.has(a.id)) }))
        notifyLocalWriteFailure(set, get, 'Tasks were not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    updateAssignment: (assignmentId, changes) => {
      const prev = get().assignments.find((a) => a.id === assignmentId)
      set((state) => ({
        assignments: state.assignments.map((a) => (a.id === assignmentId ? { ...a, ...changes } : a)),
      }))
      api.putAssignment(assignmentId, changes).catch((err) => {
        if (prev) {
          set((state) => ({
            assignments: state.assignments.map((a) => (a.id === assignmentId ? prev : a)),
          }))
        }
        notifyLocalWriteFailure(set, get, 'Task update was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    completePhotoAssignmentsForSkus: (skuCodes) => {
      const codeSet = new Set((skuCodes || []).map((x) => String(x ?? '').trim()).filter(Boolean))
      if (codeSet.size === 0) return
      const now = new Date().toISOString()
      const prevAssignments = get().assignments
      set((state) => ({
        assignments: state.assignments.map((a) => (
          a.type === 'photo_needed' && a.status === 'pending' && codeSet.has(String(a.skuCode ?? '').trim())
            ? { ...a, status: 'done', completedAt: now }
            : a
        )),
      }))
      api.completePhotoTasks([...codeSet]).catch((err) => {
        set({ assignments: prevAssignments })
        notifyLocalWriteFailure(set, get, 'Photo task update was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    completeAssignmentsForTransfer: (transferId) => {
      const now = new Date().toISOString()
      for (const a of get().assignments) {
        if ((a.type === 'store_transfer' || a.type === 'outlet_move') && a.skuCode === transferId && a.status !== 'done') {
          get().updateAssignment(a.id, { status: 'done', completedAt: now })
        }
      }
    },
  }
}
