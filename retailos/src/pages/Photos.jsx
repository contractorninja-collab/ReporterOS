import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
import {
  IconCamera,
  IconFolder,
  IconImageOff,
  IconClose,
  IconList,
  IconSearch,
  IconEdit,
  IconDelete,
} from '../utils/icons.js'

const S = {
  surface: '#111117',
  surface2: '#17171f',
  border: 'rgba(255,255,255,0.055)',
  text2: '#9090aa',
  muted: '#4a4a62',
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
  const assignments = useStore((s) => s.assignments)
  const updateAssignment = useStore((s) => s.updateAssignment)

  const resolvePhotoTasks = (skuCodes) => {
    const pending = assignments.filter((a) => a.type === 'photo_needed' && a.status === 'pending')
    for (const code of skuCodes) {
      const task = pending.find((a) => a.skuCode === code)
      if (task) updateAssignment(task.id, { status: 'done' })
    }
  }

  const productCount = useMemo(() => aggregateSkus(skus).length, [skus])

  const [photos, setPhotos] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStats, setUploadStats] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [viewMode, setViewMode] = useState('grid')
  const [selectedSku, setSelectedSku] = useState(null)
  const [showNamingGuide, setShowNamingGuide] = useState(false)
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE)
  const fileInputRef = useRef(null)
  const replaceInputRef = useRef(null)
  const replaceSkuRef = useRef(null)

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

  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE)
  }, [searchQuery, filterStatus])

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
      let matchedCount = 0
      let unmatchedCount = 0
      const unmatchedNames = []

      files.forEach((file) => {
        const skuCode = matchFilenameToSku(file.name, skus)
        if (skuCode) {
          toSave.push({ skuCode, file })
          matchedCount++
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
      resolvePhotoTasks(Object.keys(newPhotoMap))
      setUploadStats({
        saved,
        failed,
        unmatched: unmatchedCount,
        unmatchedNames: unmatchedNames.slice(0, 5),
      })
      setIsUploading(false)
      setUploadProgress(100)
    },
    [skus, photoMap, setPhotoMap, setPhotoCount, assignments, updateAssignment],
  )

  const handleDelete = async (skuCode) => {
    await deletePhoto(skuCode)
    setPhotos((prev) => prev.filter((p) => p.sku !== skuCode))
    removePhotoFromMap(skuCode)
    setPhotoCount((prev) => prev - 1)
    if (selectedSku === skuCode) setSelectedSku(null)
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
    resolvePhotoTasks([skuCode])
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
    <div data-sku-count={productCount}>
      {/* SECTION 1 — Header */}
      <div
        className="fade-up delay-1"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div
          style={{
            fontFamily: '"DM Sans"',
            fontSize: '16px',
            letterSpacing: '2px',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#2dd4bf',
              animation: 'blink 2s infinite',
            }}
          />
          PRODUCT PHOTOS
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span
            style={{
              background: 'rgba(45,212,191,0.1)',
              color: '#2dd4bf',
              fontFamily: '"DM Sans", monospace',
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid rgba(45,212,191,0.2)',
            }}
          >
            {photos.length} photos stored
          </span>
          <button
            type="button"
            onClick={() => setShowNamingGuide(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              background: 'transparent',
              color: '#9090aa',
              border: '1px solid rgba(255,255,255,0.055)',
              fontFamily: '"DM Sans"',
            }}
          >
            Naming Guide
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              background: S.accent,
              color: '#fff',
              border: 'none',
              fontFamily: '"DM Sans"',
            }}
          >
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

      {/* SECTION 2 — Info banner */}
      <div
        style={{
          background: '#17171f',
          border: '1px solid rgba(255,255,255,0.055)',
          borderRadius: '10px',
          padding: '10px 14px',
          marginBottom: '14px',
          fontSize: '11px',
          color: '#9090aa',
          lineHeight: 1.6,
        }}
        className="fade-up delay-1"
      >
        <IconCamera size={28} strokeWidth={1.5} /> Name your photo files using the SKU code and drop them here — the system links them to product cards instantly.{' '}
        <span style={{ color: '#e4e4f0', fontWeight: 600 }}>Accepted formats: JPG, PNG, WEBP.</span>{' '}
        Example filename:{' '}
        <span
          style={{
            fontFamily: '"DM Sans"',
            fontSize: '10px',
            color: '#38bdf8',
            background: 'rgba(56,189,248,0.08)',
            padding: '1px 6px',
            borderRadius: '4px',
          }}
        >
          FIL-TRN-BRA-F-M.jpg
        </span>
        {' '}
        → auto-matches SKU{' '}
        <span style={{ fontFamily: '"DM Sans"', fontSize: '10px', color: '#38bdf8' }}>FIL-TRN-BRA-F-M</span>
      </div>

      {/* SECTION 3 — Drop zone + upload stats */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div
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
        style={{
          border: `2px dashed ${isDragging ? '#2dd4bf' : 'rgba(255,255,255,0.055)'}`,
          borderRadius: '12px',
          padding: isUploading ? '20px' : '36px 20px',
          textAlign: 'center',
          cursor: isUploading ? 'default' : 'pointer',
          transition: 'all 0.2s',
          marginBottom: '16px',
          background: isDragging ? 'rgba(45,212,191,0.03)' : 'transparent',
        }}
        className="fade-up delay-1"
      >
        {isUploading ? (
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4f0', marginBottom: '12px' }}>
              Uploading photos… {uploadProgress}%
            </div>
            <div
              style={{
                height: '4px',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '2px',
                overflow: 'hidden',
                maxWidth: '300px',
                margin: '0 auto',
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: '#2dd4bf',
                  borderRadius: '2px',
                  width: `${uploadProgress}%`,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>
              <IconFolder size={28} strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4f0', marginBottom: '4px' }}>
              Drop photos here or click to browse
            </div>
            <div style={{ fontSize: '11px', color: '#4a4a62' }}>
              Drop hundreds at once — bulk upload supported · JPG, PNG, WEBP
            </div>
          </div>
        )}
      </div>

      {/* Empty state — no photos yet */}
      {photos.length === 0 && !isUploading && (
        <div
          style={{ textAlign: 'center', padding: '48px 20px', color: '#4a4a62' }}
          className="fade-up delay-2"
        >
          <div style={{ fontSize: '48px', marginBottom: '14px', opacity: 0.4 }}>
            <IconImageOff size={36} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#9090aa', marginBottom: '6px' }}>
            No photos uploaded yet
          </div>
          <div style={{ fontSize: '12px', marginBottom: '20px', lineHeight: 1.6 }}>
            Drop your product photos above.
            <br />
            Name each file with its SKU code and the system does the rest.
          </div>
          <div
            style={{
              background: '#17171f',
              border: '1px solid rgba(255,255,255,0.055)',
              borderRadius: '10px',
              padding: '12px 16px',
              display: 'inline-block',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                fontSize: '10px',
                color: '#4a4a62',
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
              <span style={{ color: '#9090aa' }}> photos saved</span>
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
                  <span style={{ color: '#9090aa' }}> files didn&apos;t match any SKU</span>
                </span>
                {uploadStats.unmatchedNames?.length > 0 && (
                  <div
                    style={{
                      fontFamily: '"DM Sans"',
                      fontSize: '9px',
                      color: '#4a4a62',
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
              color: '#4a4a62',
              border: '1px solid rgba(255,255,255,0.055)',
              fontFamily: '"DM Sans"',
            }}
          >
            <IconClose size={14} strokeWidth={1.5} /> Dismiss
          </button>
        </div>
      )}

      {/* SECTION 4 — Toolbar: search + filter + view + stats */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '14px',
          flexWrap: 'wrap',
        }}
        className="fade-up delay-2"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            background: '#17171f',
            border: '1px solid rgba(255,255,255,0.055)',
            borderRadius: '8px',
            padding: '6px 11px',
            width: '220px',
          }}
        >
          <span style={{ color: '#4a4a62', fontSize: '13px' }}>
            <IconSearch size={13} strokeWidth={1.5} />
          </span>
          <input
            type="text"
            placeholder="Search SKU or product name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              color: '#e4e4f0',
              fontSize: '12px',
              fontFamily: '"DM Sans"',
              width: '100%',
            }}
          />
          {searchQuery ? (
            <span
              role="button"
              tabIndex={0}
              onClick={() => setSearchQuery('')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSearchQuery('')
                }
              }}
              style={{ color: '#4a4a62', cursor: 'pointer', fontSize: '12px' }}
            >
              <IconClose size={14} strokeWidth={1.5} />
            </span>
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
          <div
            key={f.filterKey}
            role="button"
            tabIndex={0}
            onClick={() => setFilterStatus(f.filterKey)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setFilterStatus(f.filterKey)
              }
            }}
            style={{
              padding: '5px 11px',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.13s',
              background: filterStatus === f.filterKey ? 'rgba(255,51,51,0.1)' : '#17171f',
              border:
                filterStatus === f.filterKey
                  ? '1px solid rgba(255,51,51,0.25)'
                  : '1px solid rgba(255,255,255,0.055)',
              color: filterStatus === f.filterKey ? '#ff3333' : '#4a4a62',
            }}
          >
            {f.label}
          </div>
        ))}

        <div style={{ flex: 1 }} />

        <div style={{ fontSize: '11px', color: '#4a4a62', fontFamily: '"DM Sans"' }}>
          {filteredPhotos.length} photos
        </div>

        <div
          style={{
            display: 'flex',
            background: '#17171f',
            border: '1px solid rgba(255,255,255,0.055)',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          {[
            { mode: 'grid', icon: 'Grid' },
            {
              mode: 'list',
              icon: <IconList size={14} strokeWidth={1.5} />,
            },
          ].map((v) => (
            <div
              key={v.mode}
              role="button"
              tabIndex={0}
              onClick={() => setViewMode(v.mode)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setViewMode(v.mode)
                }
              }}
              style={{
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: '14px',
                background: viewMode === v.mode ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: viewMode === v.mode ? '#e4e4f0' : '#4a4a62',
                transition: 'all 0.13s',
              }}
            >
              {v.icon}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 5A — Grid view */}
      {viewMode === 'grid' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '10px',
            marginBottom: '22px',
          }}
          className="fade-up delay-2"
        >
          {visiblePhotos.map((photo) => {
            const skuRecord = skus.find((s) => s.sku === photo.sku)
            const isMatched = !!skuRecord

            return (
              <div
                key={photo.sku}
                style={{
                  background: '#111117',
                  border: `1px solid ${isMatched ? 'rgba(255,255,255,0.055)' : 'rgba(255,136,0,0.2)'}`,
                  borderRadius: '11px',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'all 0.18s',
                  position: 'relative',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = isMatched ? 'rgba(255,255,255,0.09)' : 'rgba(255,136,0,0.4)'
                  e.currentTarget.style.transform = 'scale(1.02)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = isMatched ? 'rgba(255,255,255,0.055)' : 'rgba(255,136,0,0.2)'
                  e.currentTarget.style.transform = ''
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '6px',
                    left: '6px',
                    zIndex: 2,
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    letterSpacing: '0.5px',
                    background: isMatched ? 'rgba(0,230,118,0.15)' : 'rgba(255,136,0,0.15)',
                    color: isMatched ? '#00e676' : '#ff8800',
                  }}
                >
                  {isMatched ? 'Matched' : '! No SKU'}
                </div>

                <div style={{ height: '120px', overflow: 'hidden', position: 'relative', background: '#000' }}>
                  <img
                    src={photo.url}
                    alt={photo.sku}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'center',
                      display: 'block',
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedSku(photo.sku)
                    }}
                  />
                </div>

                <div style={{ padding: '8px 10px' }}>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#e4e4f0',
                      marginBottom: '1px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {skuRecord ? skuRecord.product_name : photo.filename}
                  </div>
                  <div
                    style={{
                      fontFamily: '"DM Sans"',
                      fontSize: '9px',
                      color: '#4a4a62',
                      marginBottom: '6px',
                    }}
                  >
                    {photo.sku}
                  </div>
                  <div style={{ fontSize: '9px', color: '#4a4a62', marginBottom: '6px' }}>
                    {((photo.size ?? 0) / 1024).toFixed(0)} KB
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onReplaceClick(photo.sku)
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 7px',
                        borderRadius: '6px',
                        fontSize: '9px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: '#17171f',
                        color: '#9090aa',
                        border: '1px solid rgba(255,255,255,0.055)',
                        fontFamily: '"DM Sans"',
                      }}
                    >
                      <IconEdit size={14} strokeWidth={1.5} /> Replace
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(photo.sku)
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 7px',
                        borderRadius: '6px',
                        fontSize: '9px',
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
                </div>
              </div>
            )
          })}

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            style={{
              background: '#111117',
              border: '2px dashed rgba(255,255,255,0.055)',
              borderRadius: '11px',
              overflow: 'hidden',
              cursor: 'pointer',
              transition: 'all 0.18s',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '200px',
              gap: '8px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(45,212,191,0.3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.055)'
            }}
          >
            <div style={{ fontSize: '28px', color: '#4a4a62' }}>＋</div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#4a4a62' }}>Add more</div>
          </div>
        </div>
      )}

      {/* SECTION 5B — List view */}
      {viewMode === 'list' && (
        <div
          className="fade-up delay-2"
          style={{
            background: '#111117',
            border: '1px solid rgba(255,255,255,0.055)',
            borderRadius: '13px',
            overflow: 'hidden',
            marginBottom: '22px',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
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
                      color: '#4a4a62',
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
                      borderBottom: '1px solid rgba(255,255,255,0.055)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#17171f'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = ''
                    }}
                  >
                    <td style={{ padding: '8px 14px' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedSku(photo.sku)}
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          background: '#17171f',
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
                        color: '#9090aa',
                      }}
                    >
                      {photo.sku}
                    </td>

                    <td style={{ padding: '9px 14px', fontSize: '12px', fontWeight: 600, color: '#e4e4f0' }}>
                      {skuRecord?.product_name || (
                        <span style={{ color: '#4a4a62', fontStyle: 'italic' }}>Not found in catalog</span>
                      )}
                    </td>

                    <td style={{ padding: '9px 14px', fontSize: '12px', color: '#9090aa' }}>
                      {skuRecord?.brand || '—'}
                    </td>

                    <td
                      style={{
                        padding: '9px 14px',
                        fontFamily: '"DM Sans"',
                        fontSize: '11px',
                        color: '#9090aa',
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
                            background: '#17171f',
                            color: '#9090aa',
                            border: '1px solid rgba(255,255,255,0.055)',
                            fontFamily: '"DM Sans"',
                          }}
                        >
                          <IconEdit size={14} strokeWidth={1.5} /> Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(photo.sku)}
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
              background: '#17171f',
              color: '#9090aa',
              border: '1px solid rgba(255,255,255,0.055)',
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
                  background: '#111117',
                  border: '1px solid rgba(255,255,255,0.09)',
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
                      color: '#fff',
                      marginBottom: '2px',
                    }}
                  >
                    {skuRecord?.product_name || photo.filename}
                  </div>
                  <div
                    style={{
                      fontFamily: '"DM Sans"',
                      fontSize: '11px',
                      color: '#4a4a62',
                      marginBottom: '10px',
                    }}
                  >
                    {photo.sku} · {((photo.size ?? 0) / 1024).toFixed(0)} KB
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
                        background: '#17171f',
                        color: '#9090aa',
                        border: '1px solid rgba(255,255,255,0.055)',
                        fontFamily: '"DM Sans"',
                      }}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleDelete(photo.sku)
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
              background: '#111117',
              border: '1px solid rgba(255,255,255,0.09)',
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
                  color: '#fff',
                  margin: '0 0 12px',
                  fontWeight: 400,
                }}
              >
                Photo Naming Guide
              </h2>
              <p
                style={{
                  fontSize: '13px',
                  color: '#9090aa',
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
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.09)' }}>
                      {['Filename', 'SKU Match', 'Result'].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: 'left',
                            padding: '10px 12px',
                            color: '#4a4a62',
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
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.055)' }}
                      >
                        <td
                          style={{
                            padding: '10px 12px',
                            fontFamily: '"DM Sans"',
                            color: '#e4e4f0',
                            wordBreak: 'break-all',
                          }}
                        >
                          {filename}
                        </td>
                        <td
                          style={{
                            padding: '10px 12px',
                            fontFamily: '"DM Sans"',
                            color: '#9090aa',
                          }}
                        >
                          {sku}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#9090aa', whiteSpace: 'nowrap' }}>
                          {result}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  background: '#17171f',
                  border: '1px solid rgba(255,255,255,0.055)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  fontSize: '12px',
                  color: '#9090aa',
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
                  background: '#17171f',
                  color: '#9090aa',
                  border: '1px solid rgba(255,255,255,0.055)',
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
