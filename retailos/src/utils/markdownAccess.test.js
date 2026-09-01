import test from 'node:test'
import assert from 'node:assert/strict'
import { markdownListVisibleToUser } from './markdownAccess.js'

test('Change Location Web lists are visible only to executives', () => {
  const list = {
    kind: 'location_change',
    shop: 'E-commerce',
    createdBy: 'outlet-user',
    assignedTo: 'exec-1,manager-1,marketing-1',
  }

  assert.equal(markdownListVisibleToUser(list, { id: 'exec-1', role: 'executive' }), true)
  assert.equal(markdownListVisibleToUser(list, { id: 'manager-1', role: 'manager', shop: 'Ring Mall' }), false)
  assert.equal(markdownListVisibleToUser(list, { id: 'marketing-1', role: 'marketing', shop: 'E-commerce' }), false)
  assert.equal(markdownListVisibleToUser(list, { id: 'outlet-user', role: 'outlet', shop: 'Outlet' }), false)
})

test('regular Markdown list visibility remains unchanged', () => {
  const list = { kind: 'sale', shop: 'Ring Mall', createdBy: 'manager-1', assignedTo: 'manager-2' }
  assert.equal(markdownListVisibleToUser(list, { id: 'exec-1', role: 'executive' }), true)
  assert.equal(markdownListVisibleToUser(list, { id: 'marketing-1', role: 'marketing' }), true)
  assert.equal(markdownListVisibleToUser(list, { id: 'manager-1', role: 'manager' }), true)
  assert.equal(markdownListVisibleToUser(list, { id: 'manager-2', role: 'staff' }), true)
  assert.equal(markdownListVisibleToUser(list, { id: 'staff-2', role: 'staff', shop: 'Village' }), false)
})
