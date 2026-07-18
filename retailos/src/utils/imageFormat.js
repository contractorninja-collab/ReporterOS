/**
 * Detect supported product-photo formats from their file signatures.
 * This deliberately uses magic bytes rather than a client-provided MIME type.
 */
export function detectImageExtension(buffer) {
  if (!buffer || buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return '.png'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp'

  // AVIF is an ISO-BMFF file. The first box is `ftyp`; the major brand or
  // one of the compatible brands identifies AVIF as `avif` or `avis`.
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const scanEnd = Math.min(buffer.length, 64)
    for (let offset = 8; offset + 4 <= scanEnd; offset += 4) {
      const brand = buffer.toString('ascii', offset, offset + 4)
      if (brand === 'avif' || brand === 'avis') return '.avif'
    }
  }
  return null
}
