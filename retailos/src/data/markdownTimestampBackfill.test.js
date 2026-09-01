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
  assert.equal(db.backfillMarkdownListItemAddedAt('2026-09-01T12:00:00.000Z'), 1)
  assert.equal(db.getMarkdownListById('historical-completed-sale').items[0].addedAt, '2026-05-02T10:05:00.000Z')
})

test('reconstructs later per-SKU additions from historical running totals', () => {
  const list = db.insertMarkdownList({
    id: 'historical-staggered-sale',
    title: 'Historical staggered sale',
    kind: 'sale',
    status: 'completed',
    createdAt: '2026-06-19T09:28:50.499Z',
    completedAt: '2026-06-19T09:29:11.578Z',
    items: [
      { skuCode: 'SKU-ORIGINAL' },
      { skuCode: 'SKU-LATER-1' },
      { skuCode: 'SKU-LATER-2' },
    ],
  })
  db.updateMarkdownList(list.id, {
    items: list.items.map((item) => {
      const withoutAddedAt = { ...item }
      delete withoutAddedAt.addedAt
      return withoutAddedAt
    }),
  })
  db.appendActivityLog({
    actorName: 'Executive', category: 'markdown', action: 'created',
    entityType: 'markdown_list', entityId: list.id, summary: 'Created',
    meta: { products: 1 },
  })
  db.appendActivityLog({
    actorName: 'Executive', category: 'markdown', action: 'items_added',
    entityType: 'markdown_list', entityId: list.id, summary: 'Added one',
    meta: { added: 1, total: 2 },
  })
  db.appendActivityLog({
    actorName: 'Executive', category: 'markdown', action: 'items_added',
    entityType: 'markdown_list', entityId: list.id, summary: 'Added another',
    meta: { added: 1, total: 3 },
  })

  assert.equal(db.backfillMarkdownListItemAddedAt('2026-09-01T12:00:00.000Z'), 1)
  const [original, laterOne, laterTwo] = db.getMarkdownListById(list.id).items
  assert.equal(original.addedAt, '2026-06-19T09:28:50.499Z')
  assert.notEqual(laterOne.addedAt, original.addedAt)
  assert.ok(new Date(laterOne.addedAt).getTime() <= new Date(laterTwo.addedAt).getTime())
})
