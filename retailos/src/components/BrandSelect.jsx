import { useCallback, useEffect, useRef, useState } from 'react'
import { IconChevronDown, IconCheck } from '../utils/icons.js'

/**
 * Shared brand filter dropdown — Bestsellers + Product Lookup.
 * Controlled open state optional (for toolbar menus that close each other).
 */
export default function BrandSelect({
  value,
  onChange,
  options = [],
  allValue = 'All',
  allLabel = 'All Brands',
  className = '',
  isOpen: controlledOpen,
  onOpenChange,
}) {
  const wrapperRef = useRef(null)
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : internalOpen

  const setOpen = useCallback((next) => {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }, [isControlled, onOpenChange])

  const isActiveFilter = value !== allValue
  const allOption = { value: allValue, label: allLabel }
  const menuOptions = [allOption, ...options]
  const selected = menuOptions.find((o) => o.value === value) || allOption
  const triggerLabel = isActiveFilter ? selected.label : allLabel

  useEffect(() => {
    if (!isOpen) return undefined
    function onDocClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [isOpen, setOpen])

  return (
    <div
      className={`brand-select-wrapper${isOpen ? ' is-open' : ''}${isActiveFilter ? ' has-value' : ''}${className ? ` ${className}` : ''}`}
      ref={wrapperRef}
    >
      <button
        type="button"
        className="brand-select-trigger"
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="brand-select-trigger__label">{triggerLabel}</span>
        <IconChevronDown className="brand-select-trigger__caret" size={14} strokeWidth={2} aria-hidden />
      </button>
      {isOpen && (
        <div className="brand-select-panel" role="listbox">
          {menuOptions.map((o) => {
            const isSelected = o.value === value
            const isAll = o.value === allValue
            return (
              <button
                key={o.value || '_all'}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`brand-option${isSelected ? ' is-selected' : ''}${isAll ? ' brand-option--all' : ''}`}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                <span className="brand-option__label">{o.label}</span>
                {isSelected && !isAll ? (
                  <IconCheck className="brand-option__check" size={14} strokeWidth={2.5} aria-hidden />
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
