import { useState, useRef, useId, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { parseCSV } from '../utils/csvParser'
import {
  buildReportingTemplateCsv,
  REPORTING_TEMPLATE_FILE_NAME,
  buildNewArrivalsTemplateCsv,
  NEW_ARRIVALS_TEMPLATE_FILE_NAME,
} from '../utils/csvImportSpec'
import { buildSnapshot } from '../utils/salesSnapshots'
import * as api from '../api/client'
import { IconPackage, IconImport, IconFolder, IconClock } from '../utils/icons.js'

/** Mirrors csvParser.validateRow — required fields for New Arrivals Intake */
function isValidSkuRow(row) {
  if (!row || typeof row !== 'object') return false
  const barcode = (row.barcode ?? '').toString().trim()
  const sku = (row.sku ?? '').toString().trim()
  const productName = (row.product_name ?? '').toString().trim()
  const importDate = row.import_date
  const quantity = row.quantity
  const qty = typeof quantity === 'number' ? quantity : parseInt(quantity, 10)
  const hasValidDate =
    importDate instanceof Date
      ? !Number.isNaN(importDate.getTime())
      : importDate != null && String(importDate).trim() !== ''
  return (
    barcode !== '' &&
    sku !== '' &&
    productName !== '' &&
    hasValidDate &&
    !Number.isNaN(qty) &&
    qty >= 0
  )
}

/** Reporting Import validation — requires barcode, sku, sold_quantity */
function isValidReportingRow(row) {
  if (!row || typeof row !== 'object') return false
  const barcode = (row.barcode ?? '').toString().trim()
  const sku = (row.sku ?? '').toString().trim()
  const soldQty = row.sold_quantity
  const sq = typeof soldQty === 'number' ? soldQty : parseInt(soldQty, 10)
  return barcode !== '' && sku !== '' && !Number.isNaN(sq) && sq >= 0
}

const INTAKE_FIELD_PILLS = [
  { label: 'barcode', color: '#00e676' },
  { label: 'sku', color: '#38bdf8' },
  { label: 'product_name', color: '#c084fc' },
  { label: 'size', color: '#ff8800' },
  { label: 'price_tag', color: '#eab308' },
  { label: 'cost_price', color: '#fb923c' },
  { label: 'quantity', color: '#00e676' },
  { label: 'import_date', color: '#ff3333' },
  { label: 'gender [M/F/K]', color: '#38bdf8' },
  { label: 'season [SS26/FW26]', color: '#c084fc' },
  { label: 'category', color: '#2dd4bf' },
  { label: 'brand', color: '#f472b6' },
]

const REPORTING_FIELD_PILLS = [
  { label: 'barcode', color: '#00e676' },
  { label: 'sku', color: '#38bdf8' },
  { label: 'size', color: '#ff8800' },
  { label: 'price_sold', color: '#fbbf24' },
  { label: 'sold_quantity', color: '#ff3333' },
]

const PLACEHOLDER_IMPORT_ROWS = [
  { id: 'ph-1', filename: 'ss26_footwear_batch2.csv', date: '2026-03-18', count: 47, status: 'imported' },
  { id: 'ph-2', filename: 'ss26_apparel_march.csv', date: '2026-03-12', count: 31, status: 'imported' },
  { id: 'ph-3', filename: 'ss26_accessories.csv', date: '2026-03-05', count: 18, status: 'imported' },
  { id: 'ph-4', filename: 'fw25_archive_export.csv', date: '2026-01-10', count: 166, status: 'archived' },
]

const S = {
  surface: '#111117',
  surface2: '#17171f',
  border: 'rgba(255,255,255,0.055)',
  text2: '#9090aa',
  muted: '#4a4a62',
  accent: '#ff3333',
}

const tileShell = {
  position: 'relative',
  background: '#111117',
  border: '1px solid rgba(255,255,255,0.055)',
  borderRadius: '13px',
  padding: '18px',
}

function FieldPillList({ pills }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
      {pills.map((f) => (
        <div
          key={f.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            background: '#17171f',
            border: '1px solid rgba(255,255,255,0.055)',
            borderRadius: '6px',
            padding: '3px 9px',
            fontSize: '10px',
            color: '#e4e4f0',
          }}
        >
          <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: f.color }} />
          {f.label}
        </div>
      ))}
    </div>
  )
}

function ImportUploadTile({
  title,
  subtitle,
  emoji,
  fieldPills,
  fileInputRef,
  uploadHot,
  loading,
  error,
  onDownloadTemplate,
  onFile,
}) {
  const fileInputId = useId()
  return (
    <div className="import-tile-shell" style={tileShell}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
        }}
      >
        <span style={{ fontSize: '18px', lineHeight: 1 }}>{emoji}</span>
        <span
          style={{
            fontFamily: '"DM Sans"',
            fontSize: '13px',
            letterSpacing: '2px',
            color: '#e4e4f0',
            fontWeight: 600,
          }}
        >
          {title}
        </span>
      </div>
      {subtitle && (
        <p style={{ fontSize: '11px', color: S.text2, margin: '0 0 14px 0', lineHeight: 1.45 }}>{subtitle}</p>
      )}

      <label
        htmlFor={fileInputId}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onFile.setDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
          onFile.setDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          const next = e.relatedTarget
          if (next && e.currentTarget.contains(next)) return
          onFile.setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onFile.setDragging(false)
          const f = e.dataTransfer?.files?.[0] ?? null
          onFile.handleDrop(f)
        }}
        onMouseEnter={() => onFile.setHover(true)}
        onMouseLeave={() => onFile.setHover(false)}
        style={{
          display: 'block',
          border: `2px dashed ${uploadHot ? '#ff3333' : 'rgba(255,255,255,0.055)'}`,
          borderRadius: '12px',
          padding: '22px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.2s',
          marginBottom: '14px',
          background: uploadHot ? 'rgba(255,51,51,0.03)' : 'transparent',
          userSelect: 'none',
        }}
      >
        <div style={{ pointerEvents: 'none' }}>
          <div style={{ fontSize: '26px', marginBottom: '8px' }}>
            <IconFolder size={28} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4f0', marginBottom: '3px' }}>
            {loading ? 'Parsing...' : 'Drop your CSV here or click to browse'}
          </div>
          <div style={{ fontSize: '11px', color: '#4a4a62' }}>Supports .csv · Max 50MB</div>
        </div>
      </label>
      <input
        id={fileInputId}
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (e.target) e.target.value = ''
          if (f) onFile.handlePick(f)
        }}
      />

      {error && (
        <p style={{ color: S.accent, fontSize: '12px', marginTop: '-6px', marginBottom: '12px' }}>{error}</p>
      )}

      <div style={{ fontSize: '11px', color: '#4a4a62', marginBottom: '8px' }}>CSV columns:</div>
      <FieldPillList pills={fieldPills} />

      <button
        type="button"
        onClick={onDownloadTemplate}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '7px 13px',
          borderRadius: '8px',
          fontSize: '11px',
          fontWeight: 600,
          cursor: 'pointer',
          background: '#17171f',
          color: '#9090aa',
          border: '1px solid rgba(255,255,255,0.055)',
          fontFamily: '"DM Sans"',
        }}
      >
        Download template
      </button>
    </div>
  )
}

function PreviewSection({
  label,
  variant,
  pendingSkus,
  validationErrors,
  onClear,
  onConfirm,
  confirming,
  knownSkuCodes,
}) {
  const isReporting = variant === 'reporting'
  const rowValidator = isReporting ? isValidReportingRow : isValidSkuRow
  const validRows = pendingSkus.filter((s) => rowValidator(s))
  const validCount = validRows.length
  const invalidCount = pendingSkus.length - validCount
  const distinctProductCount = new Set(validRows.map((s) => s.sku)).size
  const totalUnitsCount = validRows.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)

  const unrecognizedSkuSet = isReporting && knownSkuCodes
    ? new Set(validRows.filter((s) => !knownSkuCodes.has(s.sku)).map((s) => s.sku))
    : new Set()
  const recognizedCount = isReporting && knownSkuCodes
    ? validRows.filter((s) => knownSkuCodes.has(s.sku)).length
    : validCount

  const headers = isReporting
    ? ['SKU', 'Sizes', 'Price Sold', 'Sold Qty']
    : ['SKU', 'Product', 'Sizes', 'Total Qty', 'Tag', 'Category', 'Brand']

  return (
    <section className="fade-up delay-2" style={{ marginTop: '8px' }}>
      <div
        className="import-preview-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <h3
          style={{
            fontFamily: '"DM Sans"',
            fontSize: '14px',
            letterSpacing: '2px',
            color: S.muted,
            margin: 0,
            fontWeight: 600,
          }}
        >
          {label} — {distinctProductCount} product{distinctProductCount === 1 ? '' : 's'}, {totalUnitsCount} units
          <span style={{ marginLeft: '8px', color: S.text2, fontWeight: 400 }}>
            ({pendingSkus.length} size row{pendingSkus.length === 1 ? '' : 's'})
          </span>
          {invalidCount > 0 && (
            <span style={{ marginLeft: '8px', color: S.accent, fontWeight: 400 }}>
              · {invalidCount} invalid
            </span>
          )}
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={onClear}
            style={{
              padding: '7px 13px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              background: S.surface2,
              border: `1px solid ${S.border}`,
              color: S.text2,
              fontFamily: '"DM Sans"',
            }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={validCount === 0 || confirming}
            title={validCount === 0 ? 'Fix validation errors first' : undefined}
            style={{
              padding: '7px 13px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: validCount === 0 || confirming ? 'not-allowed' : 'pointer',
              opacity: validCount === 0 || confirming ? 0.5 : 1,
              background: S.accent,
              border: 'none',
              color: '#fff',
              fontFamily: '"DM Sans"',
            }}
          >
            {confirming ? 'Importing...' : 'Confirm import'}
          </button>
        </div>
      </div>

      {validCount === 0 && pendingSkus.length > 0 && (
        <p style={{ fontSize: '12px', color: S.accent, marginBottom: '12px', marginTop: 0 }}>
          {isReporting
            ? 'No valid rows — Confirm import stays disabled until barcode, sku, and quantity are filled on each row.'
            : 'No valid rows — Confirm import stays disabled until barcode, sku, product_name, import_date, and quantity are filled on each row.'}
        </p>
      )}

      {validationErrors.length > 0 && (
        <div
          style={{
            marginBottom: '12px',
            padding: '12px',
            borderRadius: '8px',
            background: 'rgba(255,51,51,0.1)',
            border: '1px solid rgba(255,51,51,0.2)',
            color: S.accent,
            fontSize: '12px',
          }}
        >
          Validation errors: {validationErrors.length} row(s) with missing required fields.
          {validationErrors.slice(0, 3).map((ev) => (
            <div key={ev.row} style={{ marginTop: '6px', fontFamily: "'DM Sans', sans-serif" }}>
              Row {ev.row} ({ev.sku}): {ev.reason}
            </div>
          ))}
          {validationErrors.length > 3 && <div style={{ marginTop: '6px' }}>...and {validationErrors.length - 3} more</div>}
        </div>
      )}

      {unrecognizedSkuSet.size > 0 && (
        <div
          style={{
            marginBottom: '12px',
            padding: '12px',
            borderRadius: '8px',
            background: 'rgba(251,191,36,0.1)',
            border: '1px solid rgba(251,191,36,0.2)',
            color: '#fbbf24',
            fontSize: '12px',
          }}
        >
          {unrecognizedSkuSet.size} SKU{unrecognizedSkuSet.size === 1 ? '' : 's'} not found
          in New Arrivals and will be skipped:
          {' '}{[...unrecognizedSkuSet].slice(0, 8).join(', ')}
          {unrecognizedSkuSet.size > 8 && ` ...and ${unrecognizedSkuSet.size - 8} more`}
          <div style={{ marginTop: '4px', color: '#9090aa', fontSize: '11px' }}>
            Only {recognizedCount} row{recognizedCount === 1 ? '' : 's'} for recognized products will be imported.
          </div>
        </div>
      )}

      <div
        className="import-table-wrap"
        style={{
          background: S.surface,
          border: `1px solid ${S.border}`,
          borderRadius: '13px',
          overflow: 'hidden',
          maxHeight: '360px',
          overflowY: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: S.surface, zIndex: 1 }}>
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: S.muted,
                    padding: '8px 14px',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const grouped = new Map()
              for (const row of pendingSkus) {
                const key = row.sku
                if (!grouped.has(key)) {
                  grouped.set(key, {
                    sku: row.sku,
                    product_name: row.product_name,
                    category: row.category,
                    brand: row.brand,
                    price_tag: row.price_tag,
                    price_sold: row.price_sold,
                    sizes: [],
                    totalQty: 0,
                    totalSold: 0,
                    hasInvalid: false,
                  })
                }
                const g = grouped.get(key)
                g.sizes.push({ size: row.size, qty: Number(row.quantity) || 0, sold: Number(row.sold_quantity) || 0 })
                g.totalQty += Number(row.quantity) || 0
                g.totalSold += Number(row.sold_quantity) || 0
                if (!rowValidator(row)) g.hasInvalid = true
              }
              const entries = [...grouped.values()].slice(0, 15)
              return entries.map((g) => {
                const isUnrecognized = unrecognizedSkuSet.has(g.sku)
                return (
                <tr
                  key={g.sku}
                  style={{
                    borderTop: `1px solid ${S.border}`,
                    background: isUnrecognized ? 'rgba(251,191,36,0.06)' : g.hasInvalid ? 'rgba(255,51,51,0.05)' : 'transparent',
                    opacity: isUnrecognized ? 0.5 : 1,
                  }}
                >
                  <td style={{ padding: '8px 14px', fontSize: '12px', fontFamily: "'DM Sans', sans-serif" }}>
                    {g.sku}
                    {isUnrecognized && (
                      <span style={{ marginLeft: '6px', fontSize: '9px', fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' }}>
                        Skipped
                      </span>
                    )}
                  </td>
                  {!isReporting && (
                    <td
                      style={{
                        padding: '8px 14px',
                        fontSize: '12px',
                        color: '#fff',
                        maxWidth: '160px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {g.product_name}
                    </td>
                  )}
                  <td style={{ padding: '8px 14px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {g.sizes.map((sz, idx) => (
                        <span
                          key={idx}
                          style={{
                            display: 'inline-block',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: 600,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            color: '#e4e4f0',
                            fontFamily: "'DM Sans', sans-serif",
                          }}
                        >
                          {sz.size} <span style={{ color: S.text2 }}>×{sz.qty}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  {isReporting ? (
                    <>
                      <td style={{ padding: '8px 14px', fontSize: '12px', fontFamily: "'DM Sans', sans-serif", color: '#fbbf24' }}>
                        {g.price_sold ? `€${g.price_sold}` : '—'}
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: '12px', fontFamily: "'DM Sans', sans-serif", color: '#00e676' }}>
                        {g.totalSold}
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '8px 14px', fontSize: '12px', fontFamily: "'DM Sans', sans-serif", fontWeight: 700, color: '#e4e4f0' }}>
                        {g.totalQty}
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: '12px', fontFamily: "'DM Sans', sans-serif" }}>
                        {g.price_tag ?? 0}
                      </td>
                    </>
                  )}
                  {!isReporting && (
                    <>
                      <td style={{ padding: '8px 14px', fontSize: '12px' }}>{g.category}</td>
                      <td style={{ padding: '8px 14px', fontSize: '12px' }}>{g.brand}</td>
                    </>
                  )}
                </tr>
              )})
            })()}
          </tbody>
        </table>
      </div>
      {distinctProductCount > 15 && (
        <p style={{ fontSize: '12px', color: S.muted, marginTop: '8px' }}>
          Showing first 15 of {distinctProductCount} products
        </p>
      )}
    </section>
  )
}

function formatImportError(err) {
  if (!err) return 'Import failed'
  if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
    return 'Could not reach the API. Start the RetailOS server (npm run server on port 3001), keep Vite running, then retry.'
  }
  return err.message || 'Import failed'
}

export function ImportCSV() {
  const addSkus = useStore((s) => s.addSkus)
  const addImportRecord = useStore((s) => s.addImportRecord)
  const deleteImport = useStore((s) => s.deleteImport)
  const importHistory = useStore((s) => s.importHistory)
  const photoMap = useStore((s) => s.photoMap)
  const addAssignment = useStore((s) => s.addAssignment)
  const addSalesSnapshot = useStore((s) => s.addSalesSnapshot)
  const refreshSkuImportTotals = useStore((s) => s.refreshSkuImportTotals)
  const refreshWeeklySales = useStore((s) => s.refreshWeeklySales)
  const activeUser = useStore((s) => s.activeUser)
  const users = useStore((s) => s.users)
  const skus = useStore((s) => s.skus)

  const knownSkuCodes = useMemo(() => new Set(skus.map((s) => s.sku)), [skus])

  const [deletingId, setDeletingId] = useState(null)

  const fileInputIntakeRef = useRef(null)
  const fileInputReportingRef = useRef(null)

  const [isDraggingIntake, setIsDraggingIntake] = useState(false)
  const [isHoverIntake, setIsHoverIntake] = useState(false)
  const [pendingFileIntake, setPendingFileIntake] = useState(null)
  const [pendingSkusIntake, setPendingSkusIntake] = useState([])
  const [validationErrorsIntake, setValidationErrorsIntake] = useState([])
  const [loadingIntake, setLoadingIntake] = useState(false)
  const [errorIntake, setErrorIntake] = useState(null)
  const [confirmingIntake, setConfirmingIntake] = useState(false)

  const [isDraggingReporting, setIsDraggingReporting] = useState(false)
  const [isHoverReporting, setIsHoverReporting] = useState(false)
  const [pendingFileReporting, setPendingFileReporting] = useState(null)
  const [pendingSkusReporting, setPendingSkusReporting] = useState([])
  const [validationErrorsReporting, setValidationErrorsReporting] = useState([])
  const [loadingReporting, setLoadingReporting] = useState(false)
  const [errorReporting, setErrorReporting] = useState(null)
  const [confirmingReporting, setConfirmingReporting] = useState(false)

  /** Shown after a successful confirm — cleared on next upload or dismiss */
  const [successBanner, setSuccessBanner] = useState(null)

  function runValidation(skus) {
    const errors = []
    skus.forEach((sku, i) => {
      if (!isValidSkuRow(sku)) {
        errors.push({
          row: i + 1,
          sku: sku.sku || '(blank)',
          reason: 'Missing required fields (barcode, sku, product_name, import_date, quantity)',
        })
      }
    })
    return errors
  }

  function runReportingValidation(skus) {
    const errors = []
    skus.forEach((sku, i) => {
      if (!isValidReportingRow(sku)) {
        errors.push({
          row: i + 1,
          sku: sku.sku || '(blank)',
          reason: 'Missing required fields (barcode, sku, quantity)',
        })
      }
    })
    return errors
  }

  async function handleFileIntake(file) {
    if (!file) {
      setErrorIntake('No file received on drop. Use click to browse, or drag a .csv from File Explorer.')
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorIntake('Please choose a .csv file')
      return
    }
    setErrorIntake(null)
    setSuccessBanner(null)
    setLoadingIntake(true)
    setValidationErrorsIntake([])
    try {
      const skus = await parseCSV(file)
      if (skus.length === 0) {
        setErrorIntake(
          'No rows loaded. Add at least one data row with barcode and sku, keep the header row exactly as in the template, and use comma or semicolon separators (Excel EU: export as CSV or use semicolons).',
        )
        setPendingFileIntake(null)
        setPendingSkusIntake([])
        setValidationErrorsIntake([])
        return
      }
      setPendingFileIntake(file)
      setPendingSkusIntake(skus)
      setValidationErrorsIntake(runValidation(skus))
    } catch (err) {
      setErrorIntake(formatImportError(err) || 'Failed to parse CSV')
      setPendingFileIntake(null)
      setPendingSkusIntake([])
      setValidationErrorsIntake([])
    } finally {
      setLoadingIntake(false)
    }
  }

  async function handleFileReporting(file) {
    if (!file) {
      setErrorReporting('No file received on drop. Use click to browse, or drag a .csv from File Explorer.')
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorReporting('Please choose a .csv file')
      return
    }
    setErrorReporting(null)
    setSuccessBanner(null)
    setLoadingReporting(true)
    setValidationErrorsReporting([])
    try {
      const skus = await parseCSV(file)
      if (skus.length === 0) {
        setErrorReporting(
          'No rows loaded. Add at least one data row with barcode and sku, keep the header row exactly as in the template, and use comma or semicolon separators (Excel EU: export as CSV or use semicolons).',
        )
        setPendingFileReporting(null)
        setPendingSkusReporting([])
        setValidationErrorsReporting([])
        return
      }
      setPendingFileReporting(file)
      setPendingSkusReporting(skus)
      setValidationErrorsReporting(runReportingValidation(skus))
    } catch (err) {
      setErrorReporting(formatImportError(err) || 'Failed to parse CSV')
      setPendingFileReporting(null)
      setPendingSkusReporting([])
      setValidationErrorsReporting([])
    } finally {
      setLoadingReporting(false)
    }
  }

  function commitImport(validSkus, pendingFile) {
    const importId = crypto.randomUUID?.() ?? `imp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const normalized = validSkus.map((s) => ({
      ...s,
      _importId: importId,
      import_date: s.import_date instanceof Date ? s.import_date.toISOString() : s.import_date,
    }))
    addSkus(normalized)
    addImportRecord({
      id: importId,
      filename: pendingFile?.name || 'import.csv',
      date: new Date().toISOString(),
      count: validSkus.length,
      productCount: new Set(validSkus.map((s) => s.sku)).size,
      totalUnits: validSkus.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0),
    })

    const uniqueSkuCodes = [...new Set(normalized.map((s) => s.sku))]
    const currentPhotoMap = useStore.getState().photoMap
    const manager = users.find((u) => u.role === 'manager') || users[0]
    for (const code of uniqueSkuCodes) {
      if (!currentPhotoMap[code]) {
        const product = normalized.find((s) => s.sku === code)
        addAssignment({
          type: 'photo_needed',
          skuCode: code,
          productName: product?.product_name || code,
          assignedTo: manager?.id || '',
          assignedBy: activeUser?.id || '',
          shop: manager?.shop || '',
          status: 'pending',
          note: 'No product photo — please upload one',
        })
      }
    }

    const allSkus = useStore.getState().skus
    addSalesSnapshot(buildSnapshot(allSkus))

    const distinctProducts = new Set(normalized.map((s) => s.sku)).size
    const totalUnits = normalized.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)

    return {
      count: validSkus.length,
      distinctProducts,
      totalUnits,
      filename: pendingFile?.name || 'import.csv',
    }
  }

  function handleConfirmIntake() {
    const validSkus = pendingSkusIntake.filter((s) => isValidSkuRow(s))
    if (validSkus.length === 0) {
      setErrorIntake('No valid rows to import. Fix the highlighted rows or required fields (barcode, sku, product_name, import_date, quantity).')
      return
    }
    setConfirmingIntake(true)
    setErrorIntake(null)
    try {
      const result = commitImport(validSkus, pendingFileIntake)
      setSuccessBanner({
        kind: 'intake',
        count: result.count,
        distinctProducts: result.distinctProducts,
        totalUnits: result.totalUnits,
        filename: result.filename,
      })
      setPendingFileIntake(null)
      setPendingSkusIntake([])
      setValidationErrorsIntake([])
    } catch (err) {
      setErrorIntake(formatImportError(err))
    } finally {
      setConfirmingIntake(false)
    }
  }

  async function handleConfirmReporting() {
    const validSkus = pendingSkusReporting.filter((s) => isValidReportingRow(s))
    if (validSkus.length === 0) {
      setErrorReporting('No valid rows to import. Fix the highlighted rows or required fields (barcode, sku, quantity).')
      return
    }
    setConfirmingReporting(true)
    setErrorReporting(null)
    try {
      const existingSkus = useStore.getState().skus
      const knownSkuCodes = new Set(existingSkus.map((s) => s.sku))
      const existingMap = new Map()
      for (const s of existingSkus) {
        existingMap.set(`${s.sku}|${s.size ?? ''}`, s)
      }

      const recognized = validSkus.filter((row) => knownSkuCodes.has(row.sku))
      const skippedCount = validSkus.length - recognized.length
      const skippedSkus = [...new Set(
        validSkus.filter((row) => !knownSkuCodes.has(row.sku)).map((row) => row.sku),
      )]

      if (recognized.length === 0) {
        setErrorReporting(
          skippedCount > 0
            ? `All ${skippedCount} rows belong to unrecognized SKUs (not imported via New Arrivals). Import only processes products that exist in the system.`
            : 'No valid rows to import.',
        )
        setConfirmingReporting(false)
        return
      }

      const mergedSkus = recognized.map((row) => {
        const key = `${row.sku}|${row.size ?? ''}`
        const existing = existingMap.get(key)
        return {
          ...row,
          product_name: existing?.product_name || row.product_name || '',
          price_tag: existing?.price_tag ?? row.price_tag ?? 0,
          cost_price: existing?.cost_price ?? row.cost_price ?? 0,
          import_date: existing?.import_date || row.import_date || new Date().toISOString(),
          quantity: existing?.quantity ?? row.quantity ?? 0,
          gender: existing?.gender || row.gender || '',
          season: existing?.season || row.season || '',
          category: existing?.category || row.category || '',
          brand: existing?.brand || row.brand || '',
        }
      })

      let soldMap = {}
      try { soldMap = await api.fetchSoldQuantityMap() } catch { /* offline — skip delta */ }

      const today = new Date().toISOString().slice(0, 10)
      const salesEvents = []
      for (const row of mergedSkus) {
        const key = `${row.sku}|${row.size ?? ''}`
        const oldSold = soldMap[key] ?? 0
        const newSold = Number(row.sold_quantity) || 0
        const delta = newSold - oldSold
        if (delta > 0) {
          salesEvents.push({
            sku: row.sku,
            product_name: row.product_name ?? '',
            size: row.size ?? '',
            units_sold: delta,
            price_sold: Number(row.price_sold) || 0,
            revenue: delta * (Number(row.price_sold) || 0),
            event_date: today,
          })
        }
      }
      if (salesEvents.length > 0) {
        api.postSalesEvents(salesEvents).catch(() => {})
      }

      const result = commitImport(mergedSkus, pendingFileReporting)
      refreshSkuImportTotals()
      refreshWeeklySales()
      setSuccessBanner({
        kind: 'reporting',
        count: result.count,
        distinctProducts: result.distinctProducts,
        totalUnits: result.totalUnits,
        filename: result.filename,
        skippedCount,
        skippedSkus,
      })
      setPendingFileReporting(null)
      setPendingSkusReporting([])
      setValidationErrorsReporting([])
    } catch (err) {
      setErrorReporting(formatImportError(err))
    } finally {
      setConfirmingReporting(false)
    }
  }

  function handleClearIntake() {
    setPendingFileIntake(null)
    setPendingSkusIntake([])
    setValidationErrorsIntake([])
    setErrorIntake(null)
    setSuccessBanner(null)
  }

  function handleClearReporting() {
    setPendingFileReporting(null)
    setPendingSkusReporting([])
    setValidationErrorsReporting([])
    setErrorReporting(null)
    setSuccessBanner(null)
  }

  function handleDownloadNewArrivalsTemplate() {
    const blob = new Blob([buildNewArrivalsTemplateCsv()], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = NEW_ARRIVALS_TEMPLATE_FILE_NAME
    a.rel = 'noopener'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleDownloadReportingTemplate() {
    const blob = new Blob([buildReportingTemplateCsv()], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = REPORTING_TEMPLATE_FILE_NAME
    a.rel = 'noopener'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleDeleteImport(importId) {
    deleteImport(importId)
    setDeletingId(null)
  }

  const displayHistory =
    importHistory.length > 0
      ? importHistory.map((h) => ({ ...h, status: 'imported' }))
      : PLACEHOLDER_IMPORT_ROWS

  const uploadHotIntake = isDraggingIntake || isHoverIntake
  const uploadHotReporting = isDraggingReporting || isHoverReporting

  return (
    <div className="import-page">
      <div
        className="fade-up delay-1"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px',
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
              background: '#38bdf8',
              animation: 'blink 2s infinite',
            }}
          />
          IMPORT CSV DATA
        </div>
      </div>

      {successBanner && (
        <div
          className="fade-up delay-1 import-success-banner"
          role="status"
          style={{
            marginBottom: '14px',
            padding: '12px 16px',
            borderRadius: '10px',
            background: 'rgba(0,230,118,0.12)',
            border: '1px solid rgba(0,230,118,0.35)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: '13px', color: '#e4e4f0', lineHeight: 1.5 }}>
            <strong style={{ color: '#00e676' }}>Import successful.</strong>{' '}
            Saved {successBanner.distinctProducts} product{successBanner.distinctProducts === 1 ? '' : 's'}{' '}
            ({successBanner.count} size row{successBanner.count === 1 ? '' : 's'}, {successBanner.totalUnits} total units) from{' '}
            <span style={{ fontFamily: "'DM Sans', sans-serif" }}>{successBanner.filename}</span>
            {successBanner.kind === 'intake' ? ' (New Arrivals Intake)' : ' (Reporting Import)'}.
            {successBanner.skippedCount > 0 && (
              <span style={{ color: '#fbbf24' }}>
                {' '}Skipped {successBanner.skippedCount} row{successBanner.skippedCount === 1 ? '' : 's'} for{' '}
                {successBanner.skippedSkus.length} unrecognized SKU{successBanner.skippedSkus.length === 1 ? '' : 's'} (not in New Arrivals).
              </span>
            )}
            <span style={{ color: S.text2 }}> All sizes are combined per product in the catalog and dashboard.</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              background: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: S.text2,
              fontFamily: '"DM Sans"',
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div
        className="fade-up delay-1 import-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '14px',
          marginBottom: '22px',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <ImportUploadTile
            title="New Arrivals Intake"
            subtitle="Register incoming stock with ticket price (price_tag). No price_sold or sold_quantity columns — those stay 0 until reporting import or point-of-sale updates."
            emoji={<IconPackage size={28} strokeWidth={1.5} />}
            fieldPills={INTAKE_FIELD_PILLS}
            fileInputRef={fileInputIntakeRef}
            uploadHot={uploadHotIntake}
            loading={loadingIntake}
            error={errorIntake}
            onDownloadTemplate={handleDownloadNewArrivalsTemplate}
            onFile={{
              setDragging: setIsDraggingIntake,
              setHover: setIsHoverIntake,
              handleDrop: handleFileIntake,
              handlePick: handleFileIntake,
            }}
          />

          <ImportUploadTile
            title="Reporting Import"
            subtitle="Update sales data with price_sold, sold_quantity, and current stock. Product name, price tag, cost price, and import date are inherited from New Arrivals."
            emoji={<IconImport size={28} strokeWidth={1.5} />}
            fieldPills={REPORTING_FIELD_PILLS}
            fileInputRef={fileInputReportingRef}
            uploadHot={uploadHotReporting}
            loading={loadingReporting}
            error={errorReporting}
            onDownloadTemplate={handleDownloadReportingTemplate}
            onFile={{
              setDragging: setIsDraggingReporting,
              setHover: setIsHoverReporting,
              handleDrop: handleFileReporting,
              handlePick: handleFileReporting,
            }}
          />
        </div>

        <div
          className="import-tile-shell"
          style={{
            ...tileShell,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '14px',
            }}
          >
            <span style={{ fontSize: '18px', lineHeight: 1 }}>
              <IconClock size={14} strokeWidth={1.5} />
            </span>
            <span
              style={{
                fontFamily: '"DM Sans"',
                fontSize: '13px',
                letterSpacing: '2px',
                color: '#e4e4f0',
                fontWeight: 600,
              }}
            >
              Recent Imports
            </span>
          </div>

          <div
            className="import-table-wrap"
            style={{
              background: S.surface,
              border: `1px solid ${S.border}`,
              borderRadius: '13px',
              flex: 1,
              maxHeight: '320px',
              overflowY: 'auto',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: S.surface, zIndex: 1 }}>
                <tr>
                  {['File', 'Date', 'Products', 'Units', 'Status', ''].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        fontSize: '9px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: S.muted,
                        padding: '8px 14px',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayHistory.map((row) => (
                  <tr key={row.id ?? row.filename} style={{ borderTop: `1px solid ${S.border}` }}>
                    <td
                      style={{
                        padding: '8px 14px',
                        fontSize: '12px',
                        fontFamily: "'DM Sans', sans-serif",
                        color: '#e4e4f0',
                      }}
                    >
                      {row.filename}
                    </td>
                    <td style={{ padding: '8px 14px', fontSize: '12px', color: S.text2 }}>{row.date}</td>
                    <td
                      style={{
                        padding: '8px 14px',
                        fontSize: '12px',
                        fontFamily: "'DM Sans', sans-serif",
                        color: '#e4e4f0',
                      }}
                    >
                      {row.productCount ?? row.count}
                    </td>
                    <td
                      style={{
                        padding: '8px 14px',
                        fontSize: '12px',
                        fontFamily: "'DM Sans', sans-serif",
                        color: S.text2,
                      }}
                    >
                      {row.totalUnits ?? '—'}
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      {row.status === 'archived' ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: 700,
                            background: 'rgba(255,255,255,0.05)',
                            color: '#4a4a62',
                          }}
                        >
                          Archived
                        </span>
                      ) : (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: 700,
                            background: 'rgba(0,230,118,0.1)',
                            color: '#00e676',
                          }}
                        >
                          Imported
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                      {importHistory.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setDeletingId(row.id)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: 'rgba(255,51,51,0.08)',
                            border: '1px solid rgba(255,51,51,0.18)',
                            color: '#ff3333',
                            fontFamily: '"DM Sans"',
                            transition: 'all 0.15s',
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {pendingSkusIntake.length > 0 && (
        <PreviewSection
          label="Preview · New Arrivals Intake"
          variant="intake"
          pendingSkus={pendingSkusIntake}
          validationErrors={validationErrorsIntake}
          onClear={handleClearIntake}
          onConfirm={handleConfirmIntake}
          confirming={confirmingIntake}
        />
      )}

      {pendingSkusReporting.length > 0 && (
        <PreviewSection
          label="Preview · Reporting Import"
          variant="reporting"
          pendingSkus={pendingSkusReporting}
          validationErrors={validationErrorsReporting}
          onClear={handleClearReporting}
          onConfirm={handleConfirmReporting}
          confirming={confirmingReporting}
          knownSkuCodes={knownSkuCodes}
        />
      )}

      {deletingId && (() => {
        const rec = importHistory.find((r) => r.id === deletingId)
        if (!rec) return null
        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(6px)',
            }}
            onClick={() => setDeletingId(null)}
          >
            <div
              style={{
                background: '#111117',
                border: '1px solid rgba(255,255,255,0.09)',
                borderRadius: '14px',
                padding: '28px 32px',
                maxWidth: '420px',
                width: '90vw',
                boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#e4e4f0', marginBottom: '10px' }}>
                Delete import?
              </div>
              <div style={{ fontSize: '12px', color: S.text2, lineHeight: 1.6, marginBottom: '20px' }}>
                This will permanently remove <strong style={{ color: '#e4e4f0' }}>{rec.count} SKU row{rec.count === 1 ? '' : 's'}</strong> imported
                from <span style={{ fontFamily: "'DM Sans', sans-serif", color: '#e4e4f0' }}>{rec.filename}</span> and
                the import record itself.
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setDeletingId(null)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: S.surface2,
                    border: `1px solid ${S.border}`,
                    color: S.text2,
                    fontFamily: '"DM Sans"',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteImport(deletingId)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: '#ff3333',
                    border: 'none',
                    color: '#fff',
                    fontFamily: '"DM Sans"',
                  }}
                >
                  Delete import
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
