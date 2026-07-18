/**
 * RetailOS photo storage — server-backed via /api/photos.
 * Maintains the same export signatures as the old IndexedDB version
 * so Photos.jsx and other consumers work without changes.
 */

import * as api from '../api/client.js'

const THUMB_MAX = 600
const THUMB_QUALITY = 0.85

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    // Preserve AVIF uploads as AVIF. Some browsers cannot decode AVIF for a
    // canvas resize, and converting it would also discard the original format.
    if (file?.type === 'image/avif' || /\.avif$/i.test(file?.name || '')) {
      resolve(file)
      return
    }
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width <= THUMB_MAX && height <= THUMB_MAX) {
        resolve(file)
        return
      }
      const ratio = Math.min(THUMB_MAX / width, THUMB_MAX / height)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
        'image/jpeg',
        THUMB_QUALITY,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

export async function savePhoto(skuCode, file) {
  const thumb = await resizeImage(file)
  await api.uploadPhoto(skuCode, thumb)
  const url = api.getPhotoUrl(skuCode) + `?t=${Date.now()}`
  return { sku: skuCode, filename: file.name, url, size: thumb.size, addedAt: new Date().toISOString() }
}

export async function savePhotos(fileArray) {
  const results = []
  let saved = 0
  let failed = 0
  for (const item of fileArray) {
    try {
      if (!item.skuCode || !item.file) { failed++; results.push({ error: 'Missing skuCode or file' }); continue }
      const out = await savePhoto(item.skuCode, item.file)
      saved++
      results.push(out)
    } catch (e) {
      failed++
      results.push({ error: e?.message ?? String(e), skuCode: item?.skuCode })
    }
  }
  return { saved, failed, results }
}

export async function getAllPhotos() {
  try {
    const codes = await api.fetchPhotoList()
    return codes.map((sku) => ({
      sku,
      filename: `${sku}.jpg`,
      url: api.getPhotoUrl(sku),
      size: 0,
      addedAt: '',
    }))
  } catch { return [] }
}

export async function deletePhoto(skuCode) {
  try { await api.deletePhoto(skuCode); return true } catch { return false }
}

export async function getPhotoUrl(skuCode) {
  return api.getPhotoUrl(skuCode)
}

export async function getPhotoCount() {
  try {
    const codes = await api.fetchPhotoList()
    return codes.length
  } catch { return 0 }
}

export function matchFilenameToSku(filename, skusArray) {
  if (!filename || !skusArray?.length) return null
  const base = String(filename).replace(/\.[^./\\]+$/, '').trim()
  if (!base) return null
  const normalized = base.toUpperCase()
  for (const entry of skusArray) {
    const sku = typeof entry === 'string' ? entry : entry?.sku
    if (sku == null || String(sku).trim() === '') continue
    if (String(sku).trim().toUpperCase() === normalized) return String(sku).trim()
  }
  return null
}
