import test from 'node:test'
import assert from 'node:assert/strict'
import {
  brandKey,
  buildCanonicalBrandMap,
  canonicalizeBrand,
  normalizeBrandInput,
} from './brand.js'

test('normalizes brand whitespace and keys brands case-insensitively', () => {
  assert.equal(normalizeBrandInput('  Diadora  '), 'Diadora')
  assert.equal(brandKey('  Diadora  '), 'diadora')
})

test('prefers an established all-caps spelling for case-only duplicates', () => {
  const brands = buildCanonicalBrandMap(['Diadora', 'DIADORA', 'Diadora'])
  assert.equal(brands.get('diadora'), 'DIADORA')
  assert.equal(canonicalizeBrand('diadora', brands), 'DIADORA')
  assert.equal(canonicalizeBrand('DiAdOrA', brands), 'DIADORA')
})

test('preserves the first spelling for a genuinely new brand within a batch', () => {
  const brands = buildCanonicalBrandMap(['NEW BALANCE'])
  assert.equal(canonicalizeBrand('Acme Sports', brands), 'Acme Sports')
  assert.equal(canonicalizeBrand('acme sports', brands), 'Acme Sports')
})

test('keeps an established mixed-case spelling when a later import uses capitals', () => {
  const brands = buildCanonicalBrandMap(['New Brand'])
  assert.equal(canonicalizeBrand('NEW BRAND', brands), 'New Brand')
})
