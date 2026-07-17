import { useState, useRef, useId, useMemo, useEffect } from 'react'
import { useStore } from '../store/useStore'
import {
  sumIntakeInvestmentPreview,
  mergeDuplicateSkuSizeRows,
  validateReportingRow,
} from '../utils/csvParser'
import { buildSnapshot } from '../utils/salesSnapshots'
import { importStatusBadgeClass } from '../utils/statusBadge.js'
import { normalizeBarcodeValue } from '../utils/barcodeFormat.js'
import * as api from '../api/client'
import { IconPackage, IconImport, IconFolder, IconClock, IconDownload, IconLifecycle, IconDelete } from '../utils/icons.js'

/** Mirrors csvParser.validateRow — required fields for New Arrivals Intake */
function isValidSkuRow(row) {
  if (!row || typeof row !== 'object') return false
  const barcode = normalizeBarcodeValue(row.barcode).trim()
  const sku = (row.sku ?? '').toString().trim()
  const productName = (row.product_name ?? '').toString().trim()
  const importDate = row.import_date
  const quantity = row.quantity
  const qty = typeof quantity === 'number' ? quantity : parseInt(quantity, 10)
  const hasValidDate =
    importDate instanceof Date
      ? !Number.isNaN(importDate.getTime())
      : importDate != null && String(importDate).trim() !== ''
  const g = (row.gender ?? '').toString().trim()
  const validGender = g === 'M' || g === 'F' || g === 'K' || g === 'U'
  return (
    barcode !== '' &&
    sku !== '' &&
    productName !== '' &&
    hasValidDate &&
    !Number.isNaN(qty) &&
    qty >= 0 &&
    validGender
  )
}

function isValidReportingRow(row) {
  return validateReportingRow(row)
}

function formatSaleDateDdMmYy(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}.${mm}.${yy}`
}

const INTAKE_FIELD_PILLS = [
  { label: 'barcode', required: true },
  { label: 'sku', required: true },
  { label: 'product_name', required: true },
  { label: 'size', required: true },
  { label: 'price_tag', required: true },
  { label: 'cost_price', required: true },
  { label: 'quantity', required: true },
  { label: 'import_date', required: true },
  { label: 'gender [Male | Female | Kids | Unisex only]', required: true },
  { label: 'season [SS26/FW26]', required: true },
  { label: 'category', required: true },
  { label: 'brand', required: true },
]

const REPORTING_FIELD_PILLS = [
  { label: 'barcode', required: true },
  { label: 'sku', required: true },
  { label: 'size', required: true },
  { label: 'price_sold', required: true },
  { label: 'sold_quantity', required: true },
  { label: 'sale_date (DD.MM.YY)', required: true },
  { label: 'transaction_type [optional: SALE | RETURN]', required: false },
]

function formatImportDate(date) {
  if (!date) return '—'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return String(date)
  const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const timePart = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${datePart}, ${timePart}`
}

function importStatusLabel(status) {
  switch (status) {
    case 'archived':
      return 'Archived'
    case 'processing':
      return 'Processing'
    case 'failed':
      return 'Failed'
    case 'imported':
    case 'success':
      return 'Success'
    default:
      return status ? String(status) : '—'
  }
}

const S = {
  surface: 'var(--ro-surface)',
  surface2: 'var(--ro-surface-elevated)',
  border: 'var(--ro-border)',
  text2: 'var(--ro-text-dim)',
  muted: 'var(--ro-text-muted)',
  accent: '#ff3333',
}

const IMPORT_COST_AUDIT_TOLERANCE = 1
const LARGE_CSV_PROGRESS_BYTES = 1024 * 1024

function createImportCsvWorker() {
  return new Worker(new URL('../workers/importCsv.worker.js', import.meta.url), { type: 'module' })
}

function initialParseProgress(file, label = 'Preparing CSV') {
  const mb = file?.size ? file.size / (1024 * 1024) : 0
  const sizeLabel = file?.size >= LARGE_CSV_PROGRESS_BYTES ? ` (${mb.toFixed(1)} MB)` : ''
  return {
    phase: 'queued',
    progress: 0,
    detail: `${label}${sizeLabel}`,
  }
}

function FieldPillList({ pills }) {
  return (
    <div className="import-field-pills">
      {pills.map((f) => (
        <span
          key={f.label}
          className={`import-field-pill${f.required ? ' import-field-pill--required' : ' import-field-pill--optional'}`}
        >
          <span className="import-field-pill__dot" aria-hidden="true" />
          {f.label}
        </span>
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
  isDragging,
  isHover,
  loading,
  error,
  progress,
  onDownloadTemplate,
  onFile,
}) {
  const fileInputId = useId()
  const dropzoneClass = [
    'import-dropzone',
    isDragging ? 'import-dropzone--drag' : isHover ? 'import-dropzone--hover' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="import-upload-section">
      <div className="import-upload-section__head">
        <span className="import-upload-section__icon">{emoji}</span>
        <span className="import-upload-section__title">{title}</span>
      </div>
      {subtitle && <p className="import-upload-section__desc">{subtitle}</p>}

      <label
        htmlFor={fileInputId}
        className={dropzoneClass}
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
      >
        <div className="import-dropzone__inner">
          <div className="import-dropzone__icon">
            <IconFolder size={28} strokeWidth={1.5} />
          </div>
          <div className="import-dropzone__label">
            {loading ? (progress?.phase === 'grouping' ? 'Preparing import...' : 'Parsing...') : 'Drop your CSV here or click to browse'}
          </div>
          <div className="import-dropzone__hint">Supports .csv · Max 50MB</div>
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

      {error && <p className="import-upload-section__error">{error}</p>}
      {progress && (
        <div className="import-upload-progress" role="status" aria-live="polite">
          <div className="import-upload-progress__meta">
            <span>{progress.detail || progress.phase || 'Working'}</span>
            <span>{Math.max(0, Math.min(100, Math.round(progress.progress || 0)))}%</span>
          </div>
          <div className="import-upload-progress__track" aria-hidden="true">
            <div
              className="import-upload-progress__bar"
              style={{ width: `${Math.max(4, Math.min(100, Math.round(progress.progress || 0)))}%` }}
            />
          </div>
        </div>
      )}

      <div className="import-field-pills-label">CSV columns:</div>
      <FieldPillList pills={fieldPills} />

      <button type="button" className="import-template-btn" onClick={onDownloadTemplate}>
        <IconDownload size={14} strokeWidth={1.75} className="import-template-btn__icon" />
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
  const repairedDateRows = isReporting
    ? pendingSkus.filter((row) => row.sale_date_repaired)
    : []
  const mergedForStats = validRows.length
    ? mergeDuplicateSkuSizeRows(validRows, { allowSignedSold: isReporting })
    : []
  const distinctProductCount = new Set(validRows.map((s) => s.sku)).size
  const totalUnitsCount = mergedForStats.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)

  const unrecognizedSkuSet = isReporting && knownSkuCodes
    ? new Set(validRows.filter((s) => !knownSkuCodes.has(s.sku)).map((s) => s.sku))
    : new Set()
  const recognizedCount = isReporting && knownSkuCodes
    ? validRows.filter((s) => knownSkuCodes.has(s.sku)).length
    : validCount

  const intakeInvestmentPreview =
    !isReporting && validCount > 0 ? sumIntakeInvestmentPreview(mergedForStats) : null

  const headers = isReporting
    ? ['SKU', 'Sizes', 'Price Sold Total', 'Sold Qty']
    : ['SKU', 'Product', 'Sizes', 'Total Qty', 'Tag', 'Category', 'Brand']

  return (
    <section className="fade-up delay-2" style={{ marginTop: '8px' }}>
      <div
        className="import-preview-header"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '12px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
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
          {intakeInvestmentPreview != null && (
            <div
              className="import-preview-investment"
              style={{
                marginTop: '8px',
                fontSize: '12px',
                letterSpacing: '0.04em',
                color: '#fb923c',
                fontWeight: 600,
                fontFamily: '"DM Sans", sans-serif',
              }}
            >
              Σ Investment (preview): €
              {intakeInvestmentPreview.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              <span style={{ fontWeight: 400, color: S.text2, fontSize: '11px' }}>
                — quantity × unit cost; columns <code style={{ fontSize: '10px' }}>cost_price</code> or{' '}
                <code style={{ fontSize: '10px' }}>line_total</code> (row amount ÷ qty)
              </span>
            </div>
          )}
        </div>
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
            disabled={validCount === 0 || invalidCount > 0 || confirming}
            title={invalidCount > 0 ? 'Fix all validation errors before importing' : validCount === 0 ? 'Fix validation errors first' : undefined}
            style={{
              padding: '7px 13px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: validCount === 0 || invalidCount > 0 || confirming ? 'not-allowed' : 'pointer',
              opacity: validCount === 0 || invalidCount > 0 || confirming ? 0.5 : 1,
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
            ? 'No valid rows — Confirm import stays disabled until barcode, sku, sold_quantity, and sale_date (DD.MM.YY) are filled on each row.'
            : 'No valid rows — Confirm import stays disabled until barcode, sku, product_name, import_date, quantity, and gender (Male, Female, Kids, or Unisex only) are filled on each row.'}
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

      {repairedDateRows.length > 0 && (
        <div
          style={{
            marginBottom: '12px',
            padding: '12px',
            borderRadius: '8px',
            background: 'rgba(251,191,36,0.1)',
            border: '1px solid rgba(251,191,36,0.25)',
            color: '#fbbf24',
            fontSize: '12px',
          }}
        >
          Repaired an accidental leading minus in sale_date for {repairedDateRows.length} return row{repairedDateRows.length === 1 ? '' : 's'}.
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
          <div style={{ marginTop: '4px', color: 'var(--ro-text-dim)', fontSize: '11px' }}>
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
                g.sizes.push({
                  size: row.size,
                  qty: Number(row.quantity) || 0,
                  sold: Number(row.sold_quantity) || 0,
                  saleLabel: isReporting ? formatSaleDateDdMmYy(row.sale_date) : '',
                })
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
                        color: 'var(--ro-text)',
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
                            background: 'var(--ro-fill-muted)',
                            border: '1px solid var(--ro-border-hover)',
                            color: 'var(--ro-text)',
                            fontFamily: "'DM Sans', sans-serif",
                          }}
                        >
                          {sz.size}{' '}
                          <span style={{ color: S.text2 }}>
                            ×{isReporting ? sz.sold : sz.qty}
                            {isReporting && sz.saleLabel && sz.saleLabel !== '—' ? ` · ${sz.saleLabel}` : ''}
                          </span>
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
                      <td style={{ padding: '8px 14px', fontSize: '12px', fontFamily: "'DM Sans', sans-serif", fontWeight: 700, color: 'var(--ro-text)' }}>
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
    return 'Could not reach the API or the request timed out. If this is the live server, ask your host to raise nginx proxy_read_timeout and client_max_body_size (see DEPLOYMENT-SECURITY.md), then retry.'
  }
  return err.message || 'Import failed'
}

async function assertProductLookupCostMatchesLedger() {
  const [ledgerAudit, productReport] = await Promise.all([
    api.fetchImportCostAudit(),
    api.fetchProductReport(''),
  ])
  const ledgerTotal = Number(ledgerAudit?.ledgerInvestment) || 0
  const productLookupTotal = Number(productReport?.totals?.totalInvestment) || 0
  const diff = Math.abs(ledgerTotal - productLookupTotal)
  if (diff > IMPORT_COST_AUDIT_TOLERANCE) {
    throw new Error(
      `Product Lookup cost audit failed: import ledger €${ledgerTotal.toFixed(2)} but Product Lookup shows €${productLookupTotal.toFixed(2)}.`,
    )
  }
}

export function ImportCSV() {
  const importSkusBatch = useStore((s) => s.importSkusBatch)
  const setSkus = useStore((s) => s.setSkus)
  const addImportRecord = useStore((s) => s.addImportRecord)
  const deleteImport = useStore((s) => s.deleteImport)
  const importHistory = useStore((s) => s.importHistory)
  const addAssignments = useStore((s) => s.addAssignments)
  const addSalesSnapshot = useStore((s) => s.addSalesSnapshot)
  const refreshSkuImportTotals = useStore((s) => s.refreshSkuImportTotals)
  const refreshWeeklySales = useStore((s) => s.refreshWeeklySales)
  const refreshImportHistory = useStore((s) => s.refreshImportHistory)
  const activeUser = useStore((s) => s.activeUser)
  const users = useStore((s) => s.users)
  const skus = useStore((s) => s.skus)

  const knownSkuCodes = useMemo(() => new Set(skus.map((s) => s.sku)), [skus])

  const [deletingId, setDeletingId] = useState(null)
  const [reprocessingId, setReprocessingId] = useState(null)
  const [reprocessConfirmRow, setReprocessConfirmRow] = useState(null)

  const fileInputIntakeRef = useRef(null)
  const fileInputReportingRef = useRef(null)
  const workerRef = useRef(null)
  const workerTasksRef = useRef(new Map())
  const workerTaskSeqRef = useRef(0)
  const activeIntakeParseRef = useRef(null)
  const activeReportingParseRef = useRef(null)

  const [isDraggingIntake, setIsDraggingIntake] = useState(false)
  const [isHoverIntake, setIsHoverIntake] = useState(false)
  const [pendingFileIntake, setPendingFileIntake] = useState(null)
  const [pendingSkusIntake, setPendingSkusIntake] = useState([])
  const [validationErrorsIntake, setValidationErrorsIntake] = useState([])
  const [loadingIntake, setLoadingIntake] = useState(false)
  const [errorIntake, setErrorIntake] = useState(null)
  const [confirmingIntake, setConfirmingIntake] = useState(false)
  const [parseProgressIntake, setParseProgressIntake] = useState(null)

  const [isDraggingReporting, setIsDraggingReporting] = useState(false)
  const [isHoverReporting, setIsHoverReporting] = useState(false)
  const [pendingFileReporting, setPendingFileReporting] = useState(null)
  const [pendingSkusReporting, setPendingSkusReporting] = useState([])
  const [validationErrorsReporting, setValidationErrorsReporting] = useState([])
  const [loadingReporting, setLoadingReporting] = useState(false)
  const [errorReporting, setErrorReporting] = useState(null)
  const [confirmingReporting, setConfirmingReporting] = useState(false)
  const [parseProgressReporting, setParseProgressReporting] = useState(null)

  /** Shown after a successful confirm — cleared on next upload or dismiss */
  const [successBanner, setSuccessBanner] = useState(null)

  useEffect(() => {
    refreshImportHistory()
  }, [refreshImportHistory])

  useEffect(() => () => {
    workerRef.current?.terminate()
    workerRef.current = null
    for (const task of workerTasksRef.current.values()) {
      task.reject(new Error('CSV processing was cancelled.'))
    }
    workerTasksRef.current.clear()
  }, [])

  function getImportWorker() {
    if (workerRef.current) return workerRef.current
    const worker = createImportCsvWorker()
    worker.onmessage = (event) => {
      const { type, id, progress, phase, detail, result, error } = event.data || {}
      const task = workerTasksRef.current.get(id)
      if (!task) return
      if (type === 'progress') {
        task.onProgress?.({ phase, progress, detail })
        return
      }
      workerTasksRef.current.delete(id)
      if (type === 'result') {
        task.resolve(result)
      } else {
        task.reject(new Error(error || 'CSV processing failed'))
      }
    }
    worker.onerror = (event) => {
      const err = new Error(event.message || 'CSV worker failed')
      for (const task of workerTasksRef.current.values()) task.reject(err)
      workerTasksRef.current.clear()
      workerRef.current?.terminate()
      workerRef.current = null
    }
    workerRef.current = worker
    return worker
  }

  function runWorkerTask(task, payload, onProgress) {
    const worker = getImportWorker()
    const id = `import-${Date.now()}-${workerTaskSeqRef.current += 1}`
    return new Promise((resolve, reject) => {
      workerTasksRef.current.set(id, { resolve, reject, onProgress })
      worker.postMessage({ id, task, payload })
    })
  }

  function runValidation(skus) {
    const errors = []
    skus.forEach((sku, i) => {
      if (!isValidSkuRow(sku)) {
        const g = (sku.gender ?? '').toString().trim()
        const genderOk = g === 'M' || g === 'F' || g === 'K' || g === 'U'
        const reason = !genderOk
          ? 'gender must be exactly Male, Female, Kids, or Unisex (no other values)'
          : 'Missing required fields (barcode, sku, product_name, import_date, quantity)'
        errors.push({
          row: i + 1,
          sku: sku.sku || '(blank)',
          reason,
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
          reason: 'Missing or invalid fields (barcode, sku, sold_quantity, sale_date as DD.MM.YY)',
        })
      }
    })
    return errors
  }

  async function handleFileIntake(file) {
    if (!file) {
      setErrorIntake('No file received on drop. Use click to browse, or drag a .csv from File Explorer.')
      setParseProgressIntake(null)
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorIntake('Please choose a .csv file')
      setParseProgressIntake(null)
      return
    }
    setErrorIntake(null)
    setSuccessBanner(null)
    setLoadingIntake(true)
    setValidationErrorsIntake([])
    setParseProgressIntake(initialParseProgress(file, 'Preparing intake CSV'))
    const parseToken = Symbol('intake-parse')
    activeIntakeParseRef.current = parseToken
    try {
      const { rows: skus, validationErrors } = await runWorkerTask(
        'parse',
        { file, mode: 'intake' },
        (progress) => {
          if (activeIntakeParseRef.current === parseToken) setParseProgressIntake(progress)
        },
      )
      if (activeIntakeParseRef.current !== parseToken) return
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
      setValidationErrorsIntake(Array.isArray(validationErrors) ? validationErrors : runValidation(skus))
    } catch (err) {
      setErrorIntake(formatImportError(err) || 'Failed to parse CSV')
      setPendingFileIntake(null)
      setPendingSkusIntake([])
      setValidationErrorsIntake([])
    } finally {
      if (activeIntakeParseRef.current === parseToken) {
        setLoadingIntake(false)
        window.setTimeout(() => {
          if (activeIntakeParseRef.current === parseToken) setParseProgressIntake(null)
        }, 500)
      }
    }
  }

  async function handleFileReporting(file) {
    if (!file) {
      setErrorReporting('No file received on drop. Use click to browse, or drag a .csv from File Explorer.')
      setParseProgressReporting(null)
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorReporting('Please choose a .csv file')
      setParseProgressReporting(null)
      return
    }
    setErrorReporting(null)
    setSuccessBanner(null)
    setLoadingReporting(true)
    setValidationErrorsReporting([])
    setParseProgressReporting(initialParseProgress(file, 'Preparing reporting CSV'))
    const parseToken = Symbol('reporting-parse')
    activeReportingParseRef.current = parseToken
    try {
      const { rows: skus, validationErrors } = await runWorkerTask(
        'parse',
        { file, mode: 'reporting' },
        (progress) => {
          if (activeReportingParseRef.current === parseToken) setParseProgressReporting(progress)
        },
      )
      if (activeReportingParseRef.current !== parseToken) return
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
      setValidationErrorsReporting(Array.isArray(validationErrors) ? validationErrors : runReportingValidation(skus))
    } catch (err) {
      setErrorReporting(formatImportError(err) || 'Failed to parse CSV')
      setPendingFileReporting(null)
      setPendingSkusReporting([])
      setValidationErrorsReporting([])
    } finally {
      if (activeReportingParseRef.current === parseToken) {
        setLoadingReporting(false)
        window.setTimeout(() => {
          if (activeReportingParseRef.current === parseToken) setParseProgressReporting(null)
        }, 500)
      }
    }
  }

  async function commitImport(validSkus, pendingFile, options = {}) {
    const {
      importKind = 'intake',
      presetImportId = null,
      attachImportIdToSkus = importKind === 'intake',
      persistSkus = true,
      persistImportHistory = importKind === 'intake',
      summaryUnits,
      summaryLabel,
    } = options
    const importId = presetImportId || crypto.randomUUID?.() || `imp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const rollbackOnFailure = importKind === 'intake' && persistImportHistory
    let importRecordAttempted = false
    const normalized = validSkus.map((s) => ({
      ...s,
      _importId: attachImportIdToSkus ? importId : null,
      import_date: s.import_date instanceof Date ? s.import_date.toISOString() : s.import_date,
    }))
    const merged = mergeDuplicateSkuSizeRows(normalized, {
      allowSignedSold: importKind === 'reporting',
    })
    try {
      let seasonRollover = null
      if (persistImportHistory) {
        importRecordAttempted = true
        await addImportRecord({
          id: importId,
          filename: pendingFile?.name || 'import.csv',
          date: new Date().toISOString(),
          count: merged.length,
          productCount: new Set(merged.map((s) => s.sku)).size,
          totalUnits: summaryUnits ?? merged.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0),
        })
      }
      if (persistSkus) {
        seasonRollover = await importSkusBatch(merged)
      }
      if (importKind === 'intake' && persistSkus) {
        const expectedTotal = sumIntakeInvestmentPreview(merged)
        const audit = await api.fetchImportCostAudit({ importId, expectedTotal })
        const diff = Math.abs(Number(audit?.difference) || 0)
        if (diff > IMPORT_COST_AUDIT_TOLERANCE) {
          throw new Error(
            `Import cost audit failed: preview €${expectedTotal.toFixed(2)} but saved ledger €${Number(audit?.ledgerInvestment || 0).toFixed(2)}.`,
          )
        }
      }
      if (pendingFile) {
        await api.postImportCsvFile({
          importId,
          filename: pendingFile.name || 'import.csv',
          file: pendingFile,
        })
      }
      if (importKind === 'intake' && persistSkus && persistImportHistory) {
        await assertProductLookupCostMatchesLedger()
      }

      if (persistSkus) {
        const uniqueSkuCodes = [...new Set(merged.map((s) => s.sku))]
        const skuFirstRow = new Map()
        for (const s of merged) {
          if (!skuFirstRow.has(s.sku)) skuFirstRow.set(s.sku, s)
        }
        const currentPhotoMap = useStore.getState().photoMap
        const manager = users.find((u) => u.role === 'manager') || users[0]
        const photoTasks = []
        for (const code of uniqueSkuCodes) {
          if (!currentPhotoMap[code]) {
            const product = skuFirstRow.get(code)
            photoTasks.push({
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
        if (photoTasks.length > 0) addAssignments(photoTasks)

        const allSkus = useStore.getState().skus
        addSalesSnapshot(buildSnapshot(allSkus))
      }

      const distinctProducts = new Set(merged.map((s) => s.sku)).size
      const totalUnits = merged.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)

      return {
        count: merged.length,
        distinctProducts,
        totalUnits: summaryUnits ?? totalUnits,
        totalUnitsLabel: summaryLabel ?? 'total units',
        filename: pendingFile?.name || 'import.csv',
        seasonRollover,
      }
    } catch (err) {
      if (rollbackOnFailure && importRecordAttempted) {
        let rollbackOk = true
        try {
          await api.deleteImportById(importId)
        } catch {
          rollbackOk = false
        }
        const [freshSkus, freshHistory] = await Promise.all([
          api.fetchSkus().catch(() => null),
          api.fetchImportHistory().catch(() => null),
        ])
        if (Array.isArray(freshSkus)) setSkus(freshSkus)
        if (Array.isArray(freshHistory)) useStore.setState({ importHistory: freshHistory })
        await Promise.all([
          refreshSkuImportTotals(),
          refreshWeeklySales(),
        ])
        if (!rollbackOk) {
          throw new Error(
            `${err?.message || 'Import failed'} Import rollback could not be verified; check Recent Imports before retrying.`,
          )
        }
        throw new Error(`${err?.message || 'Import failed'} The failed intake import was rolled back; no import history row was kept.`)
      }
      throw err
    }
  }

  async function handleConfirmIntake() {
    const validSkus = pendingSkusIntake.filter((s) => isValidSkuRow(s))
    if (validSkus.length === 0) {
      setErrorIntake(
        'No valid rows to import. Fix the highlighted rows or required fields (barcode, sku, product_name, import_date, quantity). Gender must be exactly Male, Female, Kids, or Unisex.',
      )
      return
    }
    setConfirmingIntake(true)
    setErrorIntake(null)
    try {
      const result = await commitImport(validSkus, pendingFileIntake, {
        importKind: 'intake',
      })
      refreshImportHistory()
      setSuccessBanner({
        kind: 'intake',
        count: result.count,
        distinctProducts: result.distinctProducts,
        totalUnits: result.totalUnits,
        totalUnitsLabel: result.totalUnitsLabel,
        filename: result.filename,
        seasonRollover: result.seasonRollover,
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
    if (validSkus.length !== pendingSkusReporting.length) {
      setErrorReporting('Fix all invalid reporting rows before confirming the import. No rows were imported.')
      return
    }
    if (validSkus.length === 0) {
      setErrorReporting(
        'No valid rows to import. Fix the highlighted rows or required fields (barcode, sku, sold_quantity, sale_date as DD.MM.YY).',
      )
      return
    }
    setConfirmingReporting(true)
    setErrorReporting(null)
    const reportingImportId = crypto.randomUUID?.() || `imp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let salesEventsAttempted = false
    try {
      const existingSkus = useStore.getState().skus
      setParseProgressReporting({ phase: 'grouping', progress: 0, detail: 'Preparing reporting rows' })
      const {
        mergedSkus,
        salesEvents,
        skippedCount,
        skippedSkus,
        recognizedCount,
        reportingNetUnits,
      } = await runWorkerTask(
        'buildReportingPlan',
        { rows: validSkus, existingSkus, reportingImportId },
        (progress) => setParseProgressReporting(progress),
      )

      if (recognizedCount === 0) {
        setErrorReporting(
          skippedCount > 0
            ? `All ${skippedCount} rows belong to unrecognized SKUs (not imported via New Arrivals). Import only processes products that exist in the system.`
            : 'No valid rows to import.',
        )
        setConfirmingReporting(false)
        return
      }

      const result = await commitImport(mergedSkus, pendingFileReporting, {
        importKind: 'reporting',
        presetImportId: reportingImportId,
        attachImportIdToSkus: false,
        persistSkus: false,
        persistImportHistory: true,
        summaryUnits: reportingNetUnits,
        summaryLabel: 'net units',
      })

      // Sales dashboards are updated only after the import record and source CSV archive both exist.
      if (salesEvents.length > 0) {
        salesEventsAttempted = true
        await api.postSalesEvents(salesEvents, true)
      }
      const freshSkus = await api.fetchSkus().catch(() => null)
      if (Array.isArray(freshSkus)) setSkus(freshSkus)
      refreshSkuImportTotals()
      refreshWeeklySales()
      refreshImportHistory()
      setSuccessBanner({
        kind: 'reporting',
        count: result.count,
        distinctProducts: result.distinctProducts,
        totalUnits: result.totalUnits,
        totalUnitsLabel: result.totalUnitsLabel,
        filename: result.filename,
        skippedCount,
        skippedSkus,
      })
      setPendingFileReporting(null)
      setPendingSkusReporting([])
      setValidationErrorsReporting([])
    } catch (err) {
      let salesRollbackOk = true
      try {
        if (salesEventsAttempted) {
          try {
            await api.deleteSalesEventsByImportId(reportingImportId)
          } catch {
            salesRollbackOk = false
          }
        }
        await api.deleteImportById(reportingImportId).catch(() => null)
        refreshWeeklySales()
        refreshImportHistory()
        const freshSkus = await api.fetchSkus().catch(() => null)
        if (Array.isArray(freshSkus)) setSkus(freshSkus)
      } catch {
        /* best-effort cleanup; show the original import error below */
      }
      const message = formatImportError(err)
      setErrorReporting(
        salesEventsAttempted
          ? salesRollbackOk
            ? `${message} Sales dashboard changes for this import were rolled back; refresh the page if the totals still look stale.`
            : `${message} Import status is uncertain because rollback could not be verified. Refresh the page and check sales totals before importing again.`
          : message,
      )
    } finally {
      setConfirmingReporting(false)
      window.setTimeout(() => setParseProgressReporting(null), 500)
    }
  }

  function handleClearIntake() {
    activeIntakeParseRef.current = null
    setPendingFileIntake(null)
    setPendingSkusIntake([])
    setValidationErrorsIntake([])
    setErrorIntake(null)
    setParseProgressIntake(null)
    setSuccessBanner(null)
  }

  function handleClearReporting() {
    activeReportingParseRef.current = null
    setPendingFileReporting(null)
    setPendingSkusReporting([])
    setValidationErrorsReporting([])
    setErrorReporting(null)
    setParseProgressReporting(null)
    setSuccessBanner(null)
  }

  function handleDownloadNewArrivalsTemplate() {
    window.location.assign('/api/templates/new-arrivals.csv')
  }

  function handleDownloadReportingTemplate() {
    window.location.assign('/api/templates/reporting.csv')
  }

  function handleDownloadOriginalCsv(importId) {
    if (!importId) return
    window.location.assign(`/api/import-files/${encodeURIComponent(importId)}/download`)
  }

  async function handleReprocessReporting(row) {
    if (!row?.id || !row.csvFilePath || reprocessingId) return
    setReprocessConfirmRow(null)
    setReprocessingId(row.id)
    setErrorReporting(null)
    setSuccessBanner(null)
    try {
      const result = await api.reprocessReportingImport(row.id)
      const freshSkus = await api.fetchSkus().catch(() => null)
      if (Array.isArray(freshSkus)) setSkus(freshSkus)
      refreshSkuImportTotals()
      refreshWeeklySales()
      refreshImportHistory()
      setSuccessBanner({
        kind: 'reprocess',
        filename: result.filename || row.filename,
        rowsRecognized: Number(result.rowsRecognized) || 0,
        rowsStillSkipped: Number(result.rowsStillSkipped) || 0,
        salesEventsWritten: Number(result.salesEventsWritten) || 0,
        skippedSkus: Array.isArray(result.skippedSkus) ? result.skippedSkus : [],
      })
    } catch (err) {
      setErrorReporting(formatImportError(err))
    } finally {
      setReprocessingId(null)
    }
  }

  async function handleDeleteImport(importId) {
    if (!importId) return
    try {
      await deleteImport(importId)
      setSuccessBanner(null)
    } catch (err) {
      setErrorIntake(formatImportError(err))
    } finally {
      setDeletingId(null)
    }
  }

  const displayHistory = importHistory.map((h) => ({ ...h, status: h.csvFilePath ? 'archived' : 'imported' }))
  const reprocessingImport = reprocessingId
    ? displayHistory.find((row) => row.id === reprocessingId)
    : null

  return (
    <div className="import-page">
      <div className="fade-up delay-1 page-hero-mobile-hide import-page-header">
        <h1 className="import-page-header__title">Import CSV data</h1>
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
          <div style={{ fontSize: '13px', color: 'var(--ro-text)', lineHeight: 1.5 }}>
            {successBanner.kind === 'reprocess' ? (
              <>
                <strong style={{ color: '#00e676' }}>Reporting reprocessed.</strong>{' '}
                Re-read <span style={{ fontFamily: "'DM Sans', sans-serif" }}>{successBanner.filename}</span> and wrote{' '}
                {successBanner.salesEventsWritten} sales event{successBanner.salesEventsWritten === 1 ? '' : 's'} from{' '}
                {successBanner.rowsRecognized} recognized row{successBanner.rowsRecognized === 1 ? '' : 's'}.
                {successBanner.rowsStillSkipped > 0 && (
                  <span style={{ color: '#fbbf24' }}>
                    {' '}Still skipped {successBanner.rowsStillSkipped} row{successBanner.rowsStillSkipped === 1 ? '' : 's'} for{' '}
                    {successBanner.skippedSkus.length} SKU{successBanner.skippedSkus.length === 1 ? '' : 's'} not yet in New Arrivals.
                  </span>
                )}
                <span style={{ color: S.text2 }}> Intake quantities and costs were not changed.</span>
              </>
            ) : (
              <>
                <strong style={{ color: '#00e676' }}>Import successful.</strong>{' '}
                Saved {successBanner.distinctProducts} product{successBanner.distinctProducts === 1 ? '' : 's'}{' '}
                ({successBanner.count} size row{successBanner.count === 1 ? '' : 's'}, {successBanner.totalUnits} {successBanner.totalUnitsLabel || 'total units'}) from{' '}
                <span style={{ fontFamily: "'DM Sans', sans-serif" }}>{successBanner.filename}</span>
                {successBanner.kind === 'intake' ? ' (New Arrivals Intake)' : ' (Reporting Import)'}.
                {successBanner.skippedCount > 0 && (
                  <span style={{ color: '#fbbf24' }}>
                    {' '}Skipped {successBanner.skippedCount} row{successBanner.skippedCount === 1 ? '' : 's'} for{' '}
                    {successBanner.skippedSkus.length} unrecognized SKU{successBanner.skippedSkus.length === 1 ? '' : 's'} (not in New Arrivals).
                  </span>
                )}
                <span style={{ color: S.text2 }}> All sizes are combined per product in the catalog and dashboard.</span>
              </>
            )}
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
              border: '1px solid var(--ro-border-hover)',
              color: S.text2,
              fontFamily: '"DM Sans"',
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {reprocessingImport && (
        <div className="fade-up delay-1 import-reprocess-progress" role="status" aria-live="polite">
          <div className="import-reprocess-progress__meta">
            <span className="import-reprocess-progress__eyebrow">Reprocessing reporting import</span>
            <span className="import-reprocess-progress__file">{reprocessingImport.filename}</span>
          </div>
          <div className="import-reprocess-progress__track" aria-hidden="true">
            <div className="import-reprocess-progress__bar" />
          </div>
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
        <div className="import-upload-panel">
          <ImportUploadTile
            title="New Arrivals Intake"
            subtitle="Register incoming stock with ticket price (price_tag). No price_sold or sold_quantity columns — those stay 0 until reporting import or point-of-sale updates."
            emoji={<IconPackage size={28} strokeWidth={1.5} />}
            fieldPills={INTAKE_FIELD_PILLS}
            fileInputRef={fileInputIntakeRef}
            isDragging={isDraggingIntake}
            isHover={isHoverIntake}
            loading={loadingIntake}
            error={errorIntake}
            progress={parseProgressIntake}
            onDownloadTemplate={handleDownloadNewArrivalsTemplate}
            onFile={{
              setDragging: setIsDraggingIntake,
              setHover: setIsHoverIntake,
              handleDrop: handleFileIntake,
              handlePick: handleFileIntake,
            }}
          />

          <div className="import-upload-panel__divider" aria-hidden="true" />

          <ImportUploadTile
            title="Reporting Import"
            subtitle="Per row: units sold on sale_date (DD.MM.YY), price_sold as the total money for that row, and current stock from New Arrivals. Example: 3 units at €99 each means sold_quantity 3 and price_sold 297.00. You can provide optional transaction_type values like SALE or RETURN; if missing, a negative sold_quantity is treated as a customer return."
            emoji={<IconImport size={28} strokeWidth={1.5} />}
            fieldPills={REPORTING_FIELD_PILLS}
            fileInputRef={fileInputReportingRef}
            isDragging={isDraggingReporting}
            isHover={isHoverReporting}
            loading={loadingReporting}
            error={errorReporting}
            progress={parseProgressReporting}
            onDownloadTemplate={handleDownloadReportingTemplate}
            onFile={{
              setDragging: setIsDraggingReporting,
              setHover: setIsHoverReporting,
              handleDrop: handleFileReporting,
              handlePick: handleFileReporting,
            }}
          />
        </div>

        <div className="import-history-panel">
          <div className="import-history-panel__head">
            <span className="import-history-panel__icon">
              <IconClock size={14} strokeWidth={1.5} />
            </span>
            <span className="import-history-panel__title">Recent Imports</span>
          </div>

          <div className="import-table-wrap import-history-table-wrap">
            <table className="import-history-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Date</th>
                  <th className="import-history-table__num">Products</th>
                  <th className="import-history-table__num">Units</th>
                  <th>Status</th>
                  <th className="import-history-table__actions" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {displayHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="import-history-table__empty">
                      No imports yet. After you confirm an upload, completed files will appear here.
                    </td>
                  </tr>
                ) : (
                displayHistory.map((row) => {
                  const units = row.totalUnits
                  const unitsNegative = units != null && Number(units) < 0
                  return (
                  <tr key={row.id ?? row.filename} className="import-history-table__row">
                    <td className="import-history-table__file" title={row.filename}>
                      {row.filename}
                    </td>
                    <td className="import-history-table__date">{formatImportDate(row.date)}</td>
                    <td className="import-history-table__num import-history-table__count">
                      {row.productCount ?? row.count}
                    </td>
                    <td className={`import-history-table__num import-history-table__units${unitsNegative ? ' import-history-table__units--error' : ''}`}>
                      {units != null ? units : '—'}
                    </td>
                    <td>
                      <span className={importStatusBadgeClass(row.status)}>
                        {importStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="import-history-table__actions">
                      {importHistory.length > 0 && (
                        <div className="import-history-actions">
                          <button
                            type="button"
                            className="import-history-actions__btn"
                            disabled={!row.csvFilePath}
                            title={row.csvFilePath ? 'Download original CSV' : 'Original CSV was not archived for this older import'}
                            onClick={() => handleDownloadOriginalCsv(row.id)}
                          >
                            <IconDownload size={12} strokeWidth={1.75} className="import-history-actions__icon" />
                            Download
                          </button>
                          <button
                            type="button"
                            className="import-history-actions__btn"
                            disabled={!row.csvFilePath || reprocessingId === row.id}
                            title={row.csvFilePath ? 'Reprocess archived reporting CSV' : 'Original CSV was not archived for this older import'}
                            onClick={() => setReprocessConfirmRow(row)}
                          >
                            <IconLifecycle size={12} strokeWidth={1.75} className="import-history-actions__icon" />
                            {reprocessingId === row.id ? 'Working…' : 'Reprocess'}
                          </button>
                          <button
                            type="button"
                            className="import-history-actions__delete"
                            title={`Delete ${row.filename}`}
                            aria-label={`Delete ${row.filename}`}
                            onClick={() => setDeletingId(row.id)}
                          >
                            <IconDelete size={15} strokeWidth={1.75} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  )
                })
                )}
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
                background: 'var(--ro-surface)',
                border: '1px solid var(--ro-border-hover)',
                borderRadius: '14px',
                padding: '28px 32px',
                maxWidth: '420px',
                width: '90vw',
                boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="import-delete-modal__title">
                Delete {rec.filename}?
              </div>
              <div className="import-delete-modal__copy">
                This will remove the import record. This cannot be undone.
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

      {reprocessConfirmRow && (
        <div className="import-reprocess-modal-backdrop" onClick={() => setReprocessConfirmRow(null)}>
          <div className="import-reprocess-modal" onClick={(e) => e.stopPropagation()}>
            <div className="import-reprocess-modal__kicker">Safe sales replay</div>
            <div className="import-reprocess-modal__title">Reprocess reporting CSV?</div>
            <div className="import-reprocess-modal__copy">
              This will re-read the archived reporting CSV and replace matching sales events for SKU/date/size.
              It will not change intake quantities or costs.
            </div>
            <div className="import-reprocess-modal__file">{reprocessConfirmRow.filename}</div>
            <div className="import-reprocess-modal__actions">
              <button
                type="button"
                className="import-reprocess-modal__button import-reprocess-modal__button--ghost"
                onClick={() => setReprocessConfirmRow(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="import-reprocess-modal__button import-reprocess-modal__button--primary"
                onClick={() => handleReprocessReporting(reprocessConfirmRow)}
              >
                Reprocess now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
