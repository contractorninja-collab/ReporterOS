import { useEffect, useState } from 'react'
import useStore from '../store/useStore.js'
import { genderShortLabel } from '../utils/gender.js'

const GENDER_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'K', label: 'Kids' },
  { value: 'U', label: 'Unisex' },
]

function fullGenderLabel(value) {
  const code = genderShortLabel(value)
  return GENDER_OPTIONS.find((option) => option.value === code)?.label || 'Unspecified'
}

export default function ProductGenderEditor({ sku, compact = false }) {
  const activeUser = useStore((state) => state.activeUser)
  const saveSkuGender = useStore((state) => state.saveSkuGender)
  const canManage = activeUser?.role === 'executive' || activeUser?.role === 'manager'
  const [savedGender, setSavedGender] = useState(() => genderShortLabel(sku.gender))
  const [draftGender, setDraftGender] = useState(() => genderShortLabel(sku.gender))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const current = genderShortLabel(sku.gender)
    setSavedGender(current)
    setDraftGender(current)
    setEditing(false)
    setSaving(false)
    setSaved(false)
    setError('')
  }, [sku.sku, sku.gender])

  const stopCardClick = (event) => event.stopPropagation()

  const handleSave = async (event) => {
    event.stopPropagation()
    if (!draftGender || saving) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const result = await saveSkuGender(sku.sku, draftGender)
      setSavedGender(result.gender)
      setDraftGender(result.gender)
      setEditing(false)
      setSaved(true)
    } catch (err) {
      setError(err?.message || 'Could not save gender')
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return <span>{fullGenderLabel(savedGender)}</span>
  }

  return (
    <span
      onClick={stopCardClick}
      onKeyDown={stopCardClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', minWidth: 0 }}
    >
      {editing ? (
        <>
          <select
            value={draftGender}
            onChange={(event) => setDraftGender(event.target.value)}
            disabled={saving}
            aria-label={`Gender for ${sku.product_name || sku.sku}`}
            autoFocus
            style={{
              minHeight: compact ? 26 : 28,
              maxWidth: 92,
              padding: '3px 22px 3px 6px',
              borderRadius: 6,
              border: '1px solid var(--ro-border-hover)',
              background: 'var(--ro-surface)',
              color: 'var(--ro-text)',
              fontSize: compact ? 9 : 10,
              fontWeight: 700,
            }}
          >
            {GENDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            aria-label={`Save gender for ${sku.product_name || sku.sku}`}
            title="Save gender"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              border: '1px solid rgba(34,197,94,0.3)',
              background: 'rgba(34,197,94,0.12)',
              color: '#22c55e',
              fontSize: 13,
              fontWeight: 800,
              cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving ? '…' : '✓'}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setDraftGender(savedGender)
              setEditing(false)
              setError('')
            }}
            disabled={saving}
            aria-label={`Cancel gender edit for ${sku.product_name || sku.sku}`}
            title="Cancel"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              border: '1px solid var(--ro-border)',
              background: 'transparent',
              color: 'var(--ro-text-muted)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setEditing(true)
            setSaved(false)
            setError('')
          }}
          aria-label={`Edit gender for ${sku.product_name || sku.sku}`}
          title="Edit gender"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            minHeight: compact ? 22 : 24,
            padding: compact ? '2px 6px' : '3px 7px',
            borderRadius: 6,
            border: '1px solid var(--ro-border)',
            background: 'var(--ro-track-bg)',
            color: 'var(--ro-text-muted)',
            fontSize: compact ? 8 : 9,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <span>{fullGenderLabel(savedGender)}</span>
          <span style={{ color: 'var(--ro-accent, #60a5fa)' }}>{saved ? '✓' : 'Edit'}</span>
        </button>
      )}
      {error && (
        <span role="alert" title={error} style={{ color: '#ef4444', fontSize: 9, fontWeight: 700 }}>
          Save failed
        </span>
      )}
    </span>
  )
}
