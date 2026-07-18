import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { detectImageExtension } from './imageFormat.js'

test('detects AVIF by its major brand', () => {
  const buffer = Buffer.alloc(24)
  buffer.write('ftyp', 4, 'ascii')
  buffer.write('avif', 8, 'ascii')
  assert.equal(detectImageExtension(buffer), '.avif')
})

test('detects AVIF by a compatible brand', () => {
  const buffer = Buffer.alloc(32)
  buffer.write('ftyp', 4, 'ascii')
  buffer.write('mif1', 8, 'ascii')
  buffer.write('avif', 16, 'ascii')
  assert.equal(detectImageExtension(buffer), '.avif')
})

test('rejects unknown image signatures', () => {
  assert.equal(detectImageExtension(Buffer.alloc(24)), null)
})
