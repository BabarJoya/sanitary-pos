// Product search: typos, Roman-Urdu words, sounds-alike spellings, best sellers first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, soundKey, editDistance, buildSearchIndex, searchProducts } from '../src/utils/productSearch.js'

const products = [
  { id: 1, name: 'Basin Mixer Chrome', brand: 'Sonex', sku: '8964000111' },
  { id: 2, name: 'PPR Pipe 1 inch', brand: 'Popular', sku: 'PPR-1' },
  { id: 3, name: 'Pillar Tap', brand: 'Faisal', sku: '' },
  { id: 4, name: 'Commode Seat Cover', brand: 'Porta', sku: '' },
  { id: 5, name: 'Elbow 1/2', brand: 'Popular', sku: '' },
  { id: 6, name: 'Shower Head Round', brand: 'Sonex', sku: '' },
  { id: 7, name: 'Gate Valve 3/4', brand: 'Faisal', sku: '' },
  { id: 8, name: 'Mixer Wall', brand: 'Faisal', sku: '' },
]
const index = buildSearchIndex(products)
const ids = (q, sold) => searchProducts(index, q, sold).map(p => p.id)

test('helpers', () => {
  assert.equal(normalize('  Basin—MIXER  (Chrome) '), 'basin mixer chrome')
  assert.equal(soundKey('pipe'), soundKey('paip'))
  assert.equal(soundKey('valve'), soundKey('walv'))
  assert.equal(editDistance('mixar', 'mixer'), 1)
  assert.equal(editDistance('shwoer', 'shower'), 1, 'swapped letters count once')
  assert.ok(editDistance('basin', 'commode', 2) > 2)
})

test('exact words and barcodes come first', () => {
  assert.deepEqual(ids('8964000111'), [1])
  assert.deepEqual(new Set(ids('mixer')), new Set([1, 8]), 'both products with the word "mixer"')
  assert.deepEqual(ids('basin mixer'), [1])
})

test('spelling mistakes still find the item', () => {
  assert.ok(ids('mixar').includes(1))
  assert.ok(ids('shwoer').includes(6))
  assert.ok(ids('comode').includes(4))
  assert.ok(ids('elbo').includes(5))
})

test('Roman-Urdu words find the product', () => {
  assert.ok(ids('tonti').includes(3), 'tonti → tap')
  assert.ok(ids('paip').includes(2), 'paip → pipe')
  assert.ok(ids('kamod').includes(4), 'kamod → commode')
  assert.ok(ids('wal').includes(7), 'wal → valve')
})

test('unrelated words do not match', () => {
  assert.deepEqual(ids('geyser'), [])
  assert.deepEqual(ids('mixer pipe'), [], 'every word must match')
})

test('best sellers first: on ties and when nothing is typed', () => {
  const sold = { 8: 50, 1: 2 }
  assert.deepEqual(ids('mixer', sold).slice(0, 2), [8, 1])
  assert.equal(ids('', { 6: 9 })[0], 6)
  assert.equal(ids('').length, products.length)
})
