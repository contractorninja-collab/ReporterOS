export function toTitleCase(value) {
  if (value == null || value === '') return ''
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length === 1) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}
