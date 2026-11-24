// Supplier rate list: column detection, matching, cost changes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRateRows, compareRateList } from '../src/utils/rateList.js'

const products = [
  { id: 1, name: 'Basin Mixer Chrome', sku: '8964000111', cost_price: 1000 },
  { id: 2, name: 'PPR Pipe 1 inch', sku: 'PPR-1', cost_price: 300 },
  { id: 3, name: 'Gate Valve 3/4', sku: '', cost_price: 200 },
  { id: 4, name: 'Shower Head Round', sku: '', cost_price: 650 },
]

test('finds the name / code / rate columns whatever they are called', () => {
  const { entries, columns } = parseRateRows([
    { 'S.No': 1, 'Item Description': 'Gate Valve 3/4', 'Art No': '', 'Trade Price (Rs)': 'Rs. 230' },
    { 'S.No': 2, 'Item Description': 'Empty rate row', 'Art No': '', 'Trade Price (Rs)': '' },
  ])
  assert.deepEqual(columns, { name: 'Item Description', code: 'Art No', rate: 'Trade Price (Rs)' })
  assert.deepEqual(entries, [{ name: 'Gate Valve 3/4', code: '', rate: 230 }])
})

test('explains when the sheet has no usable columns', () => {
  assert.match(parseRateRows([{ a: 1, b: 2 }]).error, /columns/)
})

test('matches by code, exact name, then close name; reports changes', () => {
  const { matched, unmatched } = compareRateList(products, [
    { code: '8964000111', name: 'Mixer basin (new pack)', rate: 1100 },
    { code: '', name: 'gate valve 3/4', rate: 230 },
    { code: '', name: 'Shower Haed Round', rate: 650 },
    { code: '', name: 'Geyser 25 Gallon', rate: 18000 },
  ])
  const by = Object.fromEntries(matched.map(m => [m.product.id, m]))
  assert.equal(by[1].how, 'code')
  assert.equal(by[1].change, 100)
  assert.equal(by[1].changePct, 10)
  assert.equal(by[3].how, 'name')
  assert.equal(by[3].change, 30)
  assert.equal(by[4].how, 'close', 'spelling mistake in the supplier list')
  assert.equal(by[4].change, 0)
  assert.deepEqual(unmatched.map(e => e.name), ['Geyser 25 Gallon'])
})

test('one product is matched once', () => {
  const { matched, unmatched } = compareRateList(products, [
    { code: 'PPR-1', name: '', rate: 320 },
    { code: '', name: 'PPR Pipe 1 inch', rate: 330 },
  ])
  assert.equal(matched.length, 1)
  assert.equal(unmatched.length, 1)
})
