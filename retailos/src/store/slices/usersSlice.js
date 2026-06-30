import * as api from '../../api/client.js'
import {
  generateId,
  notifyLocalWriteFailure,
  publicUser,
  resyncAfterWriteFailure,
} from '../storeHelpers.js'

/** Users + active session identity. */
export function createUsersSlice(set, get) {
  return {
    addUser: (user) => {
      const full = { ...user, id: user.id || generateId() }
      const optimistic = publicUser(full)
      set((state) => ({ users: [...state.users, optimistic] }))
      api.postUser(full)
        .then((created) => {
          set((state) => ({
            users: state.users.map((u) => (u.id === optimistic.id ? created : u)),
          }))
        })
        .catch(() => {
          set((state) => ({ users: state.users.filter((u) => u.id !== optimistic.id) }))
          notifyLocalWriteFailure(set, get, 'User was not saved')
          resyncAfterWriteFailure(get)
        })
    },

    removeUser: (userId) => {
      const wasActive = get().activeUser?.id === userId
      set((state) => ({
        users: state.users.filter((u) => u.id !== userId),
        activeUser: state.activeUser?.id === userId ? null : state.activeUser,
      }))
      if (wasActive) {
        try { localStorage.removeItem('retailos_active_user') } catch { /* */ }
        api.authLogout().catch(() => {})
      }
      api.deleteUser(userId).catch((err) => {
        notifyLocalWriteFailure(set, get, 'User delete was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    updateUser: (userId, changes) => {
      const prev = get().users.find((u) => u.id === userId)
      const localChanges = publicUser({ ...changes })
      set((state) => {
        const merged = state.activeUser?.id === userId ? publicUser({ ...state.activeUser, ...localChanges }) : state.activeUser
        if (state.activeUser?.id === userId) {
          try { localStorage.setItem('retailos_active_user', JSON.stringify(merged)) } catch { /* */ }
        }
        return {
          users: state.users.map((u) => (u.id === userId ? publicUser({ ...u, ...localChanges }) : u)),
          activeUser: merged,
        }
      })
      api.putUser(userId, changes)
        .then((serverUser) => {
          if (!serverUser) return
          set((state) => ({
            users: state.users.map((u) => (u.id === userId ? serverUser : u)),
            activeUser: state.activeUser?.id === userId ? serverUser : state.activeUser,
          }))
          if (get().activeUser?.id === userId) {
            try { localStorage.setItem('retailos_active_user', JSON.stringify(publicUser(serverUser))) } catch { /* */ }
          }
        })
        .catch(() => {
          if (prev) {
            set((state) => {
              const rolledBack = state.activeUser?.id === userId ? prev : state.activeUser
              if (state.activeUser?.id === userId) {
                try { localStorage.setItem('retailos_active_user', JSON.stringify(publicUser(rolledBack))) } catch { /* */ }
              }
              return {
                users: state.users.map((u) => (u.id === userId ? prev : u)),
                activeUser: rolledBack,
              }
            })
          }
          notifyLocalWriteFailure(set, get, 'User update was not saved')
          resyncAfterWriteFailure(get)
        })
    },

    regenerateUserPin: (userId) => {
      api.regenerateUserPin(userId)
        .then((serverUser) => {
          if (!serverUser) return
          set((state) => ({
            users: state.users.map((u) => (u.id === userId ? serverUser : u)),
            activeUser: state.activeUser?.id === userId ? publicUser(serverUser) : state.activeUser,
          }))
          if (get().activeUser?.id === userId) {
            try { localStorage.setItem('retailos_active_user', JSON.stringify(publicUser(serverUser))) } catch { /* */ }
          }
        })
        .catch((err) => {
          notifyLocalWriteFailure(set, get, 'PIN reset was not saved', err)
          resyncAfterWriteFailure(get)
        })
    },

    setActiveUser: (user) => {
      if (!user) {
        api.authLogout().catch(() => {})
        try { localStorage.removeItem('retailos_active_user') } catch { /* */ }
        set({ activeUser: null })
        return
      }
      const safe = publicUser(user)
      set({ activeUser: safe })
      try { localStorage.setItem('retailos_active_user', JSON.stringify(safe)) } catch { /* */ }
    },
  }
}
