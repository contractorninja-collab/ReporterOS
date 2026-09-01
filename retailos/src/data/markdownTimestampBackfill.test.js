import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'retailos-markdown-timestamps-'))
process.env.DATA_DIR = dataDir
const db = await import(`./db.js?markdown-timestamp-test=${Date.now()}`)

after(() => {
  db.closeDatabaseForTests()
  delete process.env.DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})

test('backfills historical completed sale timestamps from recorded mark activity', () => {
  db.insertMarkdownList({
    id: 'historical-completed-sale',
    title: 'Historical completed sale',
    kind: 'sale',
    status: 'completed',
    createdAt: ' ',
    completedAt: null,
    items: [{ skuCode: 'SKU-OLD' }],
    item_statuses: {
      'SKU-OLD': {
        'Ring Mall': { status: 'tagged', markedAt: '2026-05-02T10:05:00.000Z' },
        Village: { status: 'tagged', markedAt: '2026-05-02T10:07:00.000Z' },
        'E-commerce': { status: 'tagged', markedAt: '2026-05-02T10:09:00.000Z' },
      },
    },
  })

  assert.equal(db.backfillMarkdownListTimestamps('2026-09-01T12:00:00.000Z'), 1)
  const list = db.getMarkdownListById('historical-completed-sale')
  assert.equal(list.createdAt, '2026-05-02T10:05:00.000Z')
  assert.equal(list.completedAt, '2026-05-02T10:09:00.000Z')
  assert.equal(db.backfillMarkdownListTimestamps('2026-09-01T12:00:00.000Z'), 0)
})
