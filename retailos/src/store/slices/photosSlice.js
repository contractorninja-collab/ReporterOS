import * as api from '../../api/client.js'
import { notifyLocalWriteFailure, resyncAfterWriteFailure } from '../storeHelpers.js'

/** Product photo map cache + deletions. */
export function createPhotosSlice(set, get) {
  return {
    setPhotoMap: (map) => set({ photoMap: map }),

    addPhotoToMap: (skuCode, url) =>
      set((state) => ({ photoMap: { ...state.photoMap, [skuCode]: url } })),

    removePhotoFromMap: (skuCode) => {
      const prevPhotoMap = get().photoMap
      set((state) => {
        const next = { ...state.photoMap }
        delete next[skuCode]
        return { photoMap: next }
      })
      api.deletePhoto(skuCode).catch((err) => {
        set({ photoMap: prevPhotoMap })
        notifyLocalWriteFailure(set, get, 'Photo delete was not saved', err)
        resyncAfterWriteFailure(get)
      })
    },

    setPhotoCount: (count) => set({ photoCount: count }),

    getPhotoUrl: (skuCode) => get().photoMap[skuCode] ?? null,
  }
}
