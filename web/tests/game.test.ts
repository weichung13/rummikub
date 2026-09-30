import { validateTurn } from '../server/turn.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDeck, isValidMeld, meldValue, orderMeld, type Tile } from '../src/game.js'
import { validEntry, validSubmission } from '../server/validation.js'
const tile = (value: number, color: Tile['color'] = 'red'): Tile => ({ id: `${color}-${value}`, color, value })
test('deck sizes and unique physical tiles', () => {
  for (const [copies, count] of [[2, 106], [3, 160]]) {
    const deck = createDeck(copies)
    assert.equal(deck.length, count)
    assert.equal(new Set(deck.map(t => t.id)).size, count)
  }
})
test('runs, groups, jokers and opening points', () => {
  assert.equal(meldValue([tile(9), tile(10), tile(11)]), 30)
  assert.equal(meldValue([tile(8), tile(9), tile(10)]), 27)
  assert.ok(isValidMeld([tile(10), tile(10, 'blue'), tile(10, 'black')]))
  assert.ok(!isValidMeld([tile(10), tile(10), tile(10, 'blue')]))
  assert.ok(!isValidMeld([tile(12), tile(13), tile(1)]))
  const joker = tile(30, 'joker')
  assert.equal(meldValue([tile(9), tile(11), joker]), 30)
  assert.equal(orderMeld([tile(11), tile(9), joker])[1], joker)
  assert.ok(!isValidMeld([joker, joker, joker]))
  assert.equal(meldValue([]), 0)
})
test('untrusted payload validation rejects malformed and oversized requests', () => {
  for (const value of [null, [], {}, { name: 1 }, { name: 'a'.repeat(19) }]) assert.equal(validEntry(value, false), false)
  assert.ok(validEntry({ name: '小明', code: 'ABCDE' }, true))
  assert.equal(validEntry({ name: '小明', code: 'ABCDE', token: 'public-player-id' }, true), false)
  for (const value of [null, {}, [[null]], [[1]], [Array(14).fill({ id: 'x' })], Array(54).fill([{ id: 'x' }, { id: 'y' }, { id: 'z' }])]) assert.equal(validSubmission(value), false)
})

test('authoritative turns enforce opening and preserve every table tile', () => {
  const opening = [tile(9), tile(10), tile(11)]
  assert.ok(!('error' in validateTurn([], opening, false, [opening])))
  const low = [tile(8), tile(9), tile(10)]
  assert.match(errorOf(validateTurn([], low, false, [low])), /30 點/)
  const table = [[tile(1, 'blue'), tile(2, 'blue'), tile(3, 'blue')]]
  assert.match(errorOf(validateTurn(table, opening, true, [opening])), /全部留在/)
  assert.match(errorOf(validateTurn(table, opening, true, [...table, opening, opening])), /全部留在/)
  const fourth = tile(4, 'blue')
  assert.match(errorOf(validateTurn(table, [fourth], false, [[...table[0], fourth]])), /首次出牌前/)
  assert.ok(!('error' in validateTurn(table, [fourth], true, [[...table[0], fourth]])))
  const forged = opening.map(t => ({ ...t, value: 13, color: 'black' as const }))
  const result = validateTurn([], opening, false, [forged])
  assert.ok(!('error' in result)); assert.deepEqual(result.canonical[0], opening)
})

test('table jokers cannot disappear when rearranging', () => {
  const joker = tile(30, 'joker')
  const table = [[tile(9), joker, tile(11)]]
  const ten = tile(10)
  assert.match(errorOf(validateTurn(table, [ten], true, [[tile(9), ten, tile(11)]])), /全部留在/)
  assert.ok(!('error' in validateTurn(table, [ten], true, [[tile(9), ten, tile(11), joker]])))
})
function errorOf(result: ReturnType<typeof validateTurn>): string {
  assert.ok('error' in result)
  return result.error
}
