import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react'
import useStore from '../store/useStore'
import { aggregateSkus } from '../utils/aggregateSkus'
import {
  savePhoto,
  savePhotos,
  getAllPhotos,
  deletePhoto,
  matchFilenameToSku,
  getPhotoCount,
} from '../utils/photoStorage'
import { toTitleCase } from '../utils/textFormat.js'
import {
  IconCamera,
  IconFolder,
  IconImageOff,
  IconClose,
  IconList,
  IconSearch,
  IconEdit,
  IconDelete,
  IconDisplay,
  IconPlanning,
} from '../utils/icons.js'

const S = {
  surface: 'var(--ro-surface)',
  surface2: 'var(--ro-surface-elevated)',
  border: 'var(--ro-border)',
  text2: 'var(--ro-text-dim)',
  muted: 'var(--ro-text-muted)',
  accent: '#ff3333',
  teal: '#2dd4bf',
}

const ITEMS_PER_PAGE = 60

export function Photos() {
  const skus = useStore((s) => s.skus)
  const photoMap = useStore((s) => s.photoMap)
  const setPhotoMap = useStore((s) => s.setPhotoMap)
  const addPhotoToMap = useStore((s) => s.addPhotoToMap)
  const removePhotoFromMap = useStore((s) => s.removePhotoFromMap)
  const setPhotoCount = useStore((s) => s.setPhotoCount)
  const completePhotoAssignmentsForSkus = useStore((s) => s.completePhotoAssignmentsForSkus)

  const productCount = useMemo(() => aggregateSkus(skus).length, [skus])

  const [photos, setPhotos] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const [isDropHover, setIsDropHover] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStats, setUploadStats] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [viewMode, setViewMode] = useState('grid')
  const [selectedSku, setSelectedSku] = useState(null)
  const [showNamingGuide, setShowNamingGuide] = useState(false)
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE)
  const [selectedPhotoSkus, setSelectedPhotoSkus] = useState(() => new Set())
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [deleteConfirmSku, setDeleteConfirmSku] = useState(null)
  const fileInputRef = useRef(null)
  const replaceInputRef = useRef(null)
  const replaceSkuRef = useRef(null)
  const selectAllFilteredRef = useRef(null)

  useEffect(() => {
    getAllPhotos().then((list) => {
      setPhotos(list)
      const map = {}
      list.forEach((p) => {
        map[p.sku] = p.url
      })
      useStore.getState().setPhotoMap(map)
      useStore.getState().setPhotoCount(list.length)
    })
  }, [])

  const filteredPhotos = useMemo(() => {
    return photos.filter((p) => {
      const matchesSearch =
        !searchQuery ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.filename.toLowerCase().includes(searchQuery.toLowerCase())

      const skuRecord = skus.find((s) => s.sku === p.sku)
      const matchesProductName =
        !searchQuery ||
        (skuRecord && skuRecord.product_name.toLowerCase().includes(searchQuery.toLowerCase()))

      const matchesFilter =
        filterStatus === 'all'
          ? true
          : filterStatus === 'matched'
            ? !!skuRecord
            : filterStatus === 'unmatched'
              ? !skuRecord
              : true

      return (matchesSearch || matchesProductName) && matchesFilter
    })
  }, [photos, searchQuery, filterStatus, skus])

  const visiblePhotos = filteredPhotos.slice(0, visibleCount)

  const filteredSkus = useMemo(() => filteredPhotos.map((p) => p.sku), [filteredPhotos])
  const allFilteredSelected =
    filteredSkus.length > 0 && filteredSkus.every((s) => selectedPhotoSkus.has(s))
  const selectedInViewCount = useMemo(
    () => filteredSkus.filter((s) => selectedPhotoSkus.has(s)).length,
    [filteredSkus, selectedPhotoSkus],
  )

  useLayoutEffect(() => {
    const el = selectAllFilteredRef.current
    if (!el) return
    const n = selectedInViewCount
    const total = filteredSkus.length
    el.indeterminate = total > 0 && n > 0 && n < total
  }, [selectedInViewCount, filteredSkus.length])

  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE)
  }, [searchQuery, filterStatus])

  const togglePhotoSelected = useCallback((sku) => {
    setSelectedPhotoSkus((prev) => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
  }, [])

  const toggleSelectAllFiltered = useCallback(() => {
    setSelectedPhotoSkus((prev) => {
      const next = new Set(prev)
      const allOn = filteredSkus.length > 0 && filteredSkus.every((s) => next.has(s))
      if (allOn) {
        filteredSkus.forEach((s) => next.delete(s))
      } else {
        filteredSkus.forEach((s) => next.add(s))
      }
      return next
    })
  }, [filteredSkus])

  const handleBulkDelete = useCallback(async () => {
    const toDelete = [...selectedPhotoSkus].filter((sku) => photos.some((p) => p.sku === sku))
    if (toDelete.length === 0) return
    if (!window.confirm(`Delete ${toDelete.length} photo(s)? This cannot be undone.`)) return
    setIsBulkDeleting(true)
    try {
      for (const sku of toDelete) {
        await deletePhoto(sku)
        removePhotoFromMap(sku)
      }
      setPhotos((prev) => prev.filter((p) => !toDelete.includes(p.sku)))
      setPhotoCount((prev) => Math.max(0, prev - toDelete.length))
      setSelectedPhotoSkus(new Set())
      if (selectedSku && toDelete.includes(selectedSku)) setSelectedSku(null)
    } finally {
      setIsBulkDeleting(false)
    }
  }, [selectedPhotoSkus, photos, removePhotoFromMap, setPhotoCount, selectedSku])

  const handleFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList).filter(
        (f) => f.type.startsWith('image/') || f.name.match(/\.(jpg|jpeg|png|webp)$/i),
      )
      if (!files.length) return

      setIsUploading(true)
      setUploadProgress(0)
      setUploadStats(null)

      const toSave = []
      let unmatchedCount = 0
      const unmatchedNames = []

      files.forEach((file) => {
        const skuCode = matchFilenameToSku(file.name, skus)
        if (skuCode) {
          toSave.push({ skuCode, file })
        } else {
          const base = file.name.replace(/\.[^./\\]+$/, '').trim()
          if (base) {
            toSave.push({ skuCode: base, file })
          }
          unmatchedCount++
          unmatchedNames.push(file.name)
        }
      })

      let saved = 0
      let failed = 0
      const batchSize = 20
      const newPhotoMap = { ...photoMap }

      for (let i = 0; i < toSave.length; i += batchSize) {
        const batch = toSave.slice(i, i + batchSize)
        const results = await savePhotos(batch)
        saved += results.saved
        failed += results.failed

        results.results.forEach((r) => {
          if (r && r.sku && r.url) newPhotoMap[r.sku] = r.url
        })

        const progress = Math.round(((i + batch.length) / toSave.length) * 100)
        setUploadProgress(progress)

        await new Promise((r) => setTimeout(r, 0))
      }

      const allPhotos = await getAllPhotos()
      setPhotos(allPhotos)
      const mapFromDb = {}
      allPhotos.forEach((p) => {
        mapFromDb[p.sku] = p.url
      })
      setPhotoMap(mapFromDb)
      setPhotoCount(allPhotos.length)
      completePhotoAssignmentsForSkus(Object.keys(newPhotoMap))
      setUploadStats({
        saved,
        failed,
        unmatched: unmatchedCount,
        unmatchedNames: unmatchedNames.slice(0, 5),
      })
      setIsUploading(false)
      setUploadProgress(100)
    },
    [skus, photoMap, setPhotoMap, setPhotoCount, completePhotoAssignmentsForSkus],
  )

  const handleDelete = async (skuCode) => {
    await deletePhoto(skuCode)
    setPhotos((prev) => prev.filter((p) => p.sku !== skuCode))
    removePhotoFromMap(skuCode)
    setPhotoCount((prev) => prev - 1)
    setSelectedPhotoSkus((prev) => {
      if (!prev.has(skuCode)) return prev
      const next = new Set(prev)
      next.delete(skuCode)
      return next
    })
    if (selectedSku === skuCode) setSelectedSku(null)
    setDeleteConfirmSku(null)
  }

  const requestDeletePhoto = (skuCode) => {
    setDeleteConfirmSku(skuCode)
  }

  const confirmDeletePhoto = async () => {
    if (!deleteConfirmSku) return
    await handleDelete(deleteConfirmSku)
  }

  const onReplaceClick = (skuCode) => {
    replaceSkuRef.current = skuCode
    replaceInputRef.current?.click()
  }

  const onReplaceChange = async (e) => {
    const f = e.target.files?.[0]
    const skuCode = replaceSkuRef.current
    e.target.value = ''
    if (!f || !skuCode) return
    const prev = photoMap[skuCode]
    if (prev) URL.revokeObjectURL(prev)
    const out = await savePhoto(skuCode, f)
    addPhotoToMap(skuCode, out.url)
    completePhotoAssignmentsForSkus([skuCode])
    setPhotos((prevList) => {
      const i = prevList.findIndex((p) => p.sku === skuCode)
      if (i < 0) return [...prevList, out]
      const next = [...prevList]
      next[i] = out
      return next
    })
    setPhotoCount(await getPhotoCount())
  }

  return (
    <div className="photos-page" data-sku-count={productCount}>
      <div className="photos-page-header fade-up delay-1">
        <div className="photos-page-header__actions">
          <span className="photos-count-chip">{photos.length} photos stored</span>
          <button type="button" className="photos-naming-guide-btn" onClick={() => setShowNamingGuide(true)}>
            <IconPlanning size={14} strokeWidth={1.75} className="photos-naming-guide-btn__icon" />
            Naming Guide
          </button>
          <button type="button" className="photos-upload-btn" onClick={() => fileInputRef.current?.click()}>
            + Upload Photos
          </button>
        </div>
        <input
          ref={replaceInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onReplaceChange}
        />
      </div>

      <div className="photos-info-banner fade-up delay-1">
        <IconCamera size={18} strokeWidth={1.75} className="photos-info-banner__icon" />
        <div className="photos-info-banner__body">
          Name your photo files using the SKU code and drop them here — the system links them to product cards instantly.{' '}
          <span className="photos-info-banner__strong">Accepted formats: JPG, PNG, WEBP, AVIF.</span>{' '}
          Example filename:{' '}
          <code className="photos-info-banner__code">FIL-TRN-BRA-F-M.jpg</code>
          {' '}
          <span className="photos-info-banner__arrow">→</span> auto-matches SKU{' '}
          <code className="photos-info-banner__code">FIL-TRN-BRA-F-M</code>
        </div>
      </div>

      {/* SECTION 3 — Drop zone + upload stats */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div
        className={`photos-dropzone fade-up delay-1${isDragging ? ' photos-dropzone--drag' : isDropHover ? ' photos-dropzone--hover' : ''}`}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
          setIsDragging(true)
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setIsDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          if (!isUploading && e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files)
        }}
        onMouseEnter={() => setIsDropHover(true)}
        onMouseLeave={() => setIsDropHover(false)}
        style={{ cursor: isUploading ? 'default' : 'pointer' }}
      >
        {isUploading ? (
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ro-text)', marginBottom: '12px' }}>
              Uploading photos… {uploadProgress}%
            </div>
            <div
              style={{
                height: '4px',
                background: 'var(--ro-track-bg)',
                borderRadius: '2px',
                overflow: 'hidden',
                maxWidth: '300px',
                margin: '0 auto',
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: '#7C3AED',
                  borderRadius: '2px',
                  width: `${uploadProgress}%`,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        ) : (
          <div className="photos-dropzone__inner">
            <div className="photos-dropzone__icon">
              <IconFolder size={32} strokeWidth={1.5} />
            </div>
            <div className="photos-dropzone__label">Drop photos here or click to browse</div>
            <div className="photos-dropzone__hint">Drop hundreds at once — bulk upload supported · JPG, PNG, WEBP</div>
          </div>
        )}
      </div>

      {/* Empty state — no photos yet */}
      {photos.length === 0 && !isUploading && (
        <div
          style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--ro-text-muted)' }}
          className="fade-up delay-2"
        >
          <div style={{ fontSize: '48px', marginBottom: '14px', opacity: 0.4 }}>
            <IconImageOff size={36} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ro-text-dim)', marginBottom: '6px' }}>
            No photos uploaded yet
          </div>
          <div style={{ fontSize: '12px', marginBottom: '20px', lineHeight: 1.6 }}>
            Drop your product photos above.
            <br />
            Name each file with its SKU code and the system does the rest.
          </div>
          <div
            style={{
              background: 'var(--ro-surface-elevated)',
              border: '1px solid var(--ro-border)',
              borderRadius: '10px',
              padding: '12px 16px',
              display: 'inline-block',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                fontSize: '10px',
                color: 'var(--ro-text-muted)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              Naming example
            </div>
            {['FIL-TRN-BRA-F-M.jpg', 'DIA-SPD-800-BLK.jpg', 'GRS-TRL-K-28-GRN.png'].map((ex) => (
              <div
                key={ex}
                style={{ fontFamily: '"DM Sans"', fontSize: '11px', color: '#38bdf8', marginBottom: '3px' }}
              >
                {ex}
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadStats && !isUploading && (
        <div
          style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}
          className="fade-up delay-1"
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              background: 'rgba(0,230,118,0.06)',
              border: '1px solid rgba(0,230,118,0.18)',
              borderRadius: '9px',
              fontSize: '12px',
            }}
          >
            <span>
              <strong style={{ color: '#00e676' }}>{uploadStats.saved}</strong>
              <span style={{ color: 'var(--ro-text-dim)' }}> photos saved</span>
            </span>
          </div>

          {uploadStats.unmatched > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                padding: '8px 14px',
                background: 'rgba(255,136,0,0.06)',
                border: '1px solid rgba(255,136,0,0.18)',
                borderRadius: '9px',
                fontSize: '12px',
                maxWidth: '420px',
              }}
            >
              <div>
                <span>
                  <strong style={{ color: '#ff8800' }}>{uploadStats.unmatched}</strong>
                  <span style={{ color: 'var(--ro-text-dim)' }}> files didn&apos;t match any SKU</span>
                </span>
                {uploadStats.unmatchedNames?.length > 0 && (
                  <div
                    style={{
                      fontFamily: '"DM Sans"',
                      fontSize: '9px',
                      color: 'var(--ro-text-muted)',
                      marginTop: '4px',
                      lineHeight: 1.6,
                    }}
                  >
                    {uploadStats.unmatchedNames.join(', ')}
                    {uploadStats.unmatched > 5 ? ` +${uploadStats.unmatched - 5} more` : ''}
                  </div>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setUploadStats(null)}
            style={{
              padding: '8px 12px',
              borderRadius: '9px',
              fontSize: '11px',
              cursor: 'pointer',
              background: 'transparent',
              color: 'var(--ro-text-muted)',
              border: '1px solid var(--ro-border)',
              fontFamily: '"DM Sans"',
            }}
          >
            <IconClose size={14} strokeWidth={1.5} /> Dismiss
          </button>
        </div>
      )}

      <div className="photos-toolbar fade-up delay-2">
        <div className="photos-search">
          <span className="photos-search__icon">
            <IconSearch size={13} strokeWidth={1.5} />
          </span>
          <input
            type="text"
            className="photos-search__input"
            placeholder="Search SKU or product name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery ? (
            <button type="button" className="photos-search__clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
              <IconClose size={14} strokeWidth={1.5} />
            </button>
          ) : null}
        </div>

        {[
          { filterKey: 'all', label: `All (${photos.length})` },
          {
            filterKey: 'matched',
            label: `Matched (${photos.filter((p) => skus.find((s) => s.sku === p.sku)).length})`,
          },
          {
            filterKey: 'unmatched',
            label: `No SKU (${photos.filter((p) => !skus.find((s) => s.sku === p.sku)).length})`,
          },
        ].map((f) => (
          <button
            key={f.filterKey}
            type="button"
            className={`photos-filter-chip${filterStatus === f.filterKey ? ' photos-filter-chip--active' : ''}`}
            onClick={() => setFilterStatus(f.filterKey)}
          >
            {f.label}
          </button>
        ))}

        <div className="photos-toolbar__spacer" />

        {photos.length > 0 ? (
          <div className="photos-bulk-toolbar">
            <label className="photos-bulk-toolbar__select">
              <input
                ref={selectAllFilteredRef}
                type="checkbox"
                checked={allFilteredSelected}
                disabled={filteredSkus.length === 0}
                onChange={toggleSelectAllFiltered}
                className="pl-bulk-check"
              />
              Select all{filteredSkus.length !== photos.length ? ` (${filteredSkus.length} filtered)` : ''}
            </label>
            {selectedPhotoSkus.size > 0 ? (
              <button type="button" className="photos-bulk-clear" onClick={() => setSelectedPhotoSkus(new Set())}>
                Clear selection ({selectedPhotoSkus.size})
              </button>
            ) : null}
            <button
              type="button"
              disabled={selectedPhotoSkus.size === 0 || isBulkDeleting}
              onClick={handleBulkDelete}
              className={`photos-bulk-delete${selectedPhotoSkus.size > 0 ? ' photos-bulk-delete--active' : ''}`}
            >
              <IconDelete size={13} strokeWidth={1.75} />
              {isBulkDeleting ? 'Deleting…' : `Delete selected (${selectedPhotoSkus.size})`}
            </button>
          </div>
        ) : null}

        <div className="photos-toolbar__count">{filteredPhotos.length} photos</div>

        <div className="photos-view-toggle">
          <button
            type="button"
            className={`photos-view-toggle__btn${viewMode === 'grid' ? ' photos-view-toggle__btn--active' : ''}`}
            onClick={() => setViewMode('grid')}
          >
            <IconDisplay size={14} strokeWidth={1.75} />
            Grid
          </button>
          <button
            type="button"
            className={`photos-view-toggle__btn${viewMode === 'list' ? ' photos-view-toggle__btn--active' : ''}`}
            onClick={() => setViewMode('list')}
          >
            <IconList size={14} strokeWidth={1.75} />
            List
          </button>
        </div>
      </div>

      {viewMode === 'grid' && (
        <div className="photos-grid fade-up delay-2">
          {visiblePhotos.map((photo) => {
            const skuRecord = skus.find((s) => s.sku === photo.sku)
            const isMatched = !!skuRecord
            const fileSizeKb = (photo.size ?? 0) / 1024
            const showFileSize = fileSizeKb > 0

            return (
              <div key={photo.sku} className={`photos-grid-card${isMatched ? '' : ' photos-grid-card--unmatched'}`}>
                <label className="photos-grid-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedPhotoSkus.has(photo.sku)}
                    onChange={() => togglePhotoSelected(photo.sku)}
                    onClick={(e) => e.stopPropagation()}
                    className="photos-grid-check__input pl-bulk-check"
                  />
                </label>

                <div className="photos-grid-card__media">
                  {!isMatched && <span className="photos-grid-badge photos-grid-badge--nosku">No SKU</span>}
                  {isMatched && <span className="photos-grid-badge photos-grid-badge--matched">Matched</span>}
                  <img
                    src={photo.url}
                    alt={photo.sku}
                    className="photos-grid-card__img"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedSku(photo.sku)
                    }}
                  />
                </div>

                <div className="photos-grid-card__body">
                  <div className="photos-grid-card__title">
                    {skuRecord ? toTitleCase(skuRecord.product_name) : photo.filename}
                  </div>
                  <div className="photos-grid-card__sku">{photo.sku}</div>
                  {showFileSize && (
                    <div className="photos-grid-card__size">{fileSizeKb.toFixed(0)} KB</div>
                  )}

                  <div className="photos-grid-card__actions">
                    <button
                      type="button"
                      className="photos-grid-card__replace"
                      onClick={(e) => {
                        e.stopPropagation()
                        onReplaceClick(photo.sku)
                      }}
                    >
                      <IconEdit size={12} strokeWidth={1.75} className="photos-grid-card__replace-icon" />
                      Replace
                    </button>
                    <button
                      type="button"
                      className="photos-grid-card__delete"
                      title={`Delete photo for ${photo.sku}`}
                      aria-label={`Delete photo for ${photo.sku}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        requestDeletePhoto(photo.sku)
                      }}
                    >
                      <IconDelete size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          <button type="button" className="photos-grid-add" onClick={() => fileInputRef.current?.click()}>
            <span className="photos-grid-add__icon">＋</span>
            <span className="photos-grid-add__label">Add more</span>
          </button>
        </div>
      )}

      {/* SECTION 5B — List view */}
      {viewMode === 'list' && (
        <div
          className="fade-up delay-2"
          style={{
            background: 'var(--ro-surface)',
            border: '1px solid var(--ro-border)',
            borderRadius: '13px',
            overflow: 'hidden',
            marginBottom: '22px',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ro-border)' }}>
                <th
                  className="photos-list-select-header"
                  style={{
                    padding: '9px 10px',
                    textAlign: 'center',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1.5px',
                    color: 'var(--ro-text-muted)',
                    whiteSpace: 'nowrap',
                    width: '44px',
                  }}
                />
                {['Photo', 'SKU Code', 'Product Name', 'Brand', 'Size', 'Match Status', 'Actions'].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '9px 14px',
                      textAlign: 'left',
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '1.5px',
                      color: 'var(--ro-text-muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiblePhotos.map((photo) => {
                const skuRecord = skus.find((s) => s.sku === photo.sku)
                return (
                  <tr
                    key={photo.sku}
                    style={{
                      borderBottom: '1px solid var(--ro-border)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--ro-surface-elevated)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = ''
                    }}
                  >
                    <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle', width: '44px' }}>
                      <input
                        type="checkbox"
                        checked={selectedPhotoSkus.has(photo.sku)}
                        onChange={() => togglePhotoSelected(photo.sku)}
                        className="photos-list-select__input"
                        style={{ width: 15, height: 15, cursor: 'pointer', verticalAlign: 'middle' }}
                      />
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedSku(photo.sku)}
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          background: 'var(--ro-surface-elevated)',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          display: 'block',
                        }}
                      >
                        <img
                          src={photo.url}
                          alt={photo.sku}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      </button>
                    </td>

                    <td
                      style={{
                        padding: '9px 14px',
                        fontFamily: '"DM Sans"',
                        fontSize: '11px',
                        color: 'var(--ro-text-dim)',
                      }}
                    >
                      {photo.sku}
                    </td>

                    <td style={{ padding: '9px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--ro-text)' }}>
                      {skuRecord?.product_name || (
                        <span style={{ color: 'var(--ro-text-muted)', fontStyle: 'italic' }}>Not found in catalog</span>
                      )}
                    </td>

                    <td style={{ padding: '9px 14px', fontSize: '12px', color: 'var(--ro-text-dim)' }}>
                      {skuRecord?.brand || '—'}
                    </td>

                    <td
                      style={{
                        padding: '9px 14px',
                        fontFamily: '"DM Sans"',
                        fontSize: '11px',
                        color: 'var(--ro-text-dim)',
                      }}
                    >
                      {skuRecord?.size || '—'}
                    </td>

                    <td style={{ padding: '9px 14px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '10px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.8px',
                          background: skuRecord ? 'rgba(0,230,118,0.1)' : 'rgba(255,136,0,0.1)',
                          color: skuRecord ? '#00e676' : '#ff8800',
                        }}
                      >
                        <span
                          style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            background: skuRecord ? '#00e676' : '#ff8800',
                          }}
                        />
                        {skuRecord ? 'Matched' : 'No SKU'}
                      </span>
                    </td>

                    <td style={{ padding: '9px 14px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => onReplaceClick(photo.sku)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '3px 9px',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: 'var(--ro-surface-elevated)',
                            color: 'var(--ro-text-dim)',
                            border: '1px solid var(--ro-border)',
                            fontFamily: '"DM Sans"',
                          }}
                        >
                          <IconEdit size={14} strokeWidth={1.5} /> Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDeletePhoto(photo.sku)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '3px 9px',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: 'rgba(255,51,51,0.08)',
                            color: '#ff3333',
                            border: '1px solid rgba(255,51,51,0.2)',
                            fontFamily: '"DM Sans"',
                          }}
                        >
                          <IconDelete size={14} strokeWidth={1.5} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {filteredPhotos.length > visibleCount && (
        <div style={{ textAlign: 'center', paddingBottom: '24px' }}>
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + ITEMS_PER_PAGE)}
            style={{
              padding: '10px 24px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              background: 'var(--ro-surface-elevated)',
              color: 'var(--ro-text-dim)',
              border: '1px solid var(--ro-border)',
              fontFamily: '"DM Sans"',
            }}
          >
            Load more ({filteredPhotos.length - visibleCount} remaining)
          </button>
        </div>
      )}

      {filteredPhotos.length === 0 && (
        <div style={{ fontSize: '12px', color: S.muted, textAlign: 'center', padding: '24px' }}>
          No photos match your filters.
        </div>
      )}

      {/* SECTION 6 — Lightbox */}
      {selectedSku &&
        (() => {
          const photo = photos.find((p) => p.sku === selectedSku)
          const skuRecord = skus.find((s) => s.sku === selectedSku)
          if (!photo) return null
          return (
            <div
              onClick={() => setSelectedSku(null)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.85)',
                zIndex: 999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: 'var(--ro-surface)',
                  border: '1px solid var(--ro-border-hover)',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  maxWidth: '600px',
                  width: '90vw',
                }}
              >
                <img
                  src={photo.url}
                  alt={photo.sku}
                  style={{
                    width: '100%',
                    maxHeight: '400px',
                    objectFit: 'contain',
                    background: '#000',
                    display: 'block',
                  }}
                />
                <div style={{ padding: '16px 20px' }}>
                  <div
                    style={{
                      fontFamily: '"DM Sans"',
                      fontSize: '18px',
                      letterSpacing: '1px',
                      color: 'var(--ro-heading)',
                      marginBottom: '2px',
                    }}
                  >
                    {skuRecord?.product_name || photo.filename}
                  </div>
                  <div
                    style={{
                      fontFamily: '"DM Sans"',
                      fontSize: '11px',
                      color: 'var(--ro-text-muted)',
                      marginBottom: '10px',
                    }}
                  >
                    {photo.sku}{(photo.size ?? 0) > 0 ? ` · ${((photo.size ?? 0) / 1024).toFixed(0)} KB` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedSku(null)}
                      style={{
                        padding: '7px 16px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: 'var(--ro-surface-elevated)',
                        color: 'var(--ro-text-dim)',
                        border: '1px solid var(--ro-border)',
                        fontFamily: '"DM Sans"',
                      }}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        requestDeletePhoto(photo.sku)
                        setSelectedSku(null)
                      }}
                      style={{
                        padding: '7px 16px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: 'rgba(255,51,51,0.1)',
                        color: '#ff3333',
                        border: '1px solid rgba(255,51,51,0.2)',
                        fontFamily: '"DM Sans"',
                      }}
                    >
                      <IconDelete size={14} strokeWidth={1.5} /> Delete Photo
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

      {deleteConfirmSku && (
        <div
          className="photos-delete-modal-backdrop"
          role="presentation"
          onClick={() => setDeleteConfirmSku(null)}
        >
          <div className="photos-delete-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="photos-delete-modal__title">Delete photo for {deleteConfirmSku}?</div>
            <p className="photos-delete-modal__body">This cannot be undone.</p>
            <div className="photos-delete-modal__actions">
              <button type="button" className="photos-delete-modal__btn photos-delete-modal__btn--ghost" onClick={() => setDeleteConfirmSku(null)}>
                Cancel
              </button>
              <button type="button" className="photos-delete-modal__btn photos-delete-modal__btn--danger" onClick={confirmDeletePhoto}>
                Delete photo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Naming Guide modal */}
      {showNamingGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="naming-guide-title"
          onClick={() => setShowNamingGuide(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--ro-surface)',
              border: '1px solid var(--ro-border-hover)',
              borderRadius: '16px',
              overflow: 'hidden',
              maxWidth: '640px',
              width: '100%',
            }}
          >
            <div style={{ padding: '20px 22px 16px' }}>
              <h2
                id="naming-guide-title"
                style={{
                  fontFamily: '"DM Sans"',
                  fontSize: '22px',
                  letterSpacing: '1px',
                  color: 'var(--ro-heading)',
                  margin: '0 0 12px',
                  fontWeight: 400,
                }}
              >
                Photo Naming Guide
              </h2>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--ro-text-dim)',
                  lineHeight: 1.6,
                  margin: '0 0 18px',
                  fontFamily: '"DM Sans"',
                }}
              >
                Your filename (without extension) must exactly match the SKU code in your catalog. The match is
                case-insensitive.
              </p>

              <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '11px',
                    fontFamily: '"DM Sans"',
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--ro-border-hover)' }}>
                      {['Filename', 'SKU Match', 'Result'].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: 'left',
                            padding: '10px 12px',
                            color: 'var(--ro-text-muted)',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.6px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['FIL-TRN-BRA-F-M.jpg', 'FIL-TRN-BRA-F-M', 'Match'],
                      ['fil-trn-bra-f-m.JPG', 'FIL-TRN-BRA-F-M', 'Match'],
                      ['Training Bra.jpg', '—', 'No match'],
                      ['photo_001.jpg', '—', 'No match'],
                    ].map(([filename, sku, result]) => (
                      <tr
                        key={filename}
                        style={{ borderBottom: '1px solid var(--ro-border)' }}
                      >
                        <td
                          style={{
                            padding: '10px 12px',
                            fontFamily: '"DM Sans"',
                            color: 'var(--ro-text)',
                            wordBreak: 'break-all',
                          }}
                        >
                          {filename}
                        </td>
                        <td
                          style={{
                            padding: '10px 12px',
                            fontFamily: '"DM Sans"',
                            color: 'var(--ro-text-dim)',
                          }}
                        >
                          {sku}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--ro-text-dim)', whiteSpace: 'nowrap' }}>
                          {result}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  background: 'var(--ro-surface-elevated)',
                  border: '1px solid var(--ro-border)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  fontSize: '12px',
                  color: 'var(--ro-text-dim)',
                  lineHeight: 1.55,
                  fontFamily: '"DM Sans"',
                }}
              >
                <span style={{ color: '#2dd4bf', fontWeight: 600 }}>Pro tip:</span> Export your SKU list from the
                Import CSV page, then batch-rename your photos using that list.
              </div>
            </div>

            <div style={{ padding: '0 22px 20px' }}>
              <button
                type="button"
                onClick={() => setShowNamingGuide(false)}
                style={{
                  padding: '7px 16px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: 'var(--ro-surface-elevated)',
                  color: 'var(--ro-text-dim)',
                  border: '1px solid var(--ro-border)',
                  fontFamily: '"DM Sans"',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
