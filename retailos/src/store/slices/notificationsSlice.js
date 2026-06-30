import * as api from '../../api/client.js'
import {
  asArray,
  generateId,
  notifyLocalWriteFailure,
  resyncAfterWriteFailure,
} from '../storeHelpers.js'

/** In-app notifications and unread tracking. */
export function createNotificationsSlice(set, get) {
  return {
    fetchNotifications: async () => {
      try {
        const data = await api.fetchNotifications()
        const arr = asArray(data)
        set({ notifications: arr, unreadCount: arr.filter((n) => !n.read).length })
      } catch { /* ignore */ }
    },

    addNotification: async (notification) => {
      const n = { ...notification, id: notification.id || generateId(), createdAt: notification.createdAt || new Date().toISOString(), read: 0 }
      set((state) => ({
        notifications: [n, ...state.notifications],
        unreadCount: state.unreadCount + 1,
      }))
      try {
        await api.postNotification(n)
      } catch (err) {
        set((state) => ({
          notifications: state.notifications.filter((item) => item.id !== n.id),
          unreadCount: Math.max(0, state.unreadCount - (!n.read ? 1 : 0)),
        }))
        notifyLocalWriteFailure(set, get, 'Notification was not saved', err)
        resyncAfterWriteFailure(get)
      }
    },

    markNotificationRead: async (id) => {
      const prevNotifications = get().notifications
      const prevUnreadCount = get().unreadCount
      set((state) => ({
        notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: 1 } : n)),
        unreadCount: Math.max(0, state.unreadCount - (state.notifications.find((n) => n.id === id && !n.read) ? 1 : 0)),
      }))
      try {
        await api.putNotificationRead(id)
      } catch (err) {
        set({ notifications: prevNotifications, unreadCount: prevUnreadCount })
        notifyLocalWriteFailure(set, get, 'Notification update was not saved', err)
        resyncAfterWriteFailure(get)
      }
    },

    markAllNotificationsRead: async () => {
      const prevNotifications = get().notifications
      const prevUnreadCount = get().unreadCount
      try {
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: 1 })),
          unreadCount: 0,
        }))
        await api.putNotificationsReadAll()
        const notifs = await api.fetchNotifications()
        const arr = asArray(notifs)
        set({
          notifications: arr,
          unreadCount: arr.filter((n) => !n.read).length,
        })
      } catch (err) {
        set({ notifications: prevNotifications, unreadCount: prevUnreadCount })
        notifyLocalWriteFailure(set, get, 'Notifications were not marked read', err)
        resyncAfterWriteFailure(get)
      }
    },
  }
}
