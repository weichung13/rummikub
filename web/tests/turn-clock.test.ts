import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TurnClock, TURN_DURATION_MS, type TimedRoom } from '../server/turn-clock.js'

test('timer expires at 180 seconds once and preserves real elapsed time', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const room: TimedRoom = { timerEnabled: true, turnDeadline: null, started: true, finished: false }
  let expired = 0
  const clock = new TurnClock(() => { expired += 1 })
  clock.start(room)
  assert.equal(room.turnDeadline, 181000)
  context.mock.timers.tick(TURN_DURATION_MS - 1)
  assert.equal(expired, 0)
  context.mock.timers.tick(1)
  assert.equal(expired, 1)
  assert.equal(room.turnDeadline, null)
  assert.equal(clock.expireIfDue(room), false)
})

test('new turns cancel old deadlines; stopping, untimed and ended games do not expire', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const room: TimedRoom = { timerEnabled: true, turnDeadline: null, started: true, finished: false }
  let expired = 0
  const clock = new TurnClock(() => { expired += 1 })
  clock.start(room)
  context.mock.timers.tick(90000)
  clock.start(room)
  context.mock.timers.tick(90000)
  assert.equal(expired, 0)
  clock.stop(room)
  context.mock.timers.tick(180000)
  assert.equal(expired, 0)
  room.timerEnabled = false
  clock.start(room)
  assert.equal(room.turnDeadline, null)
  room.timerEnabled = true
  room.finished = true
  clock.start(room)
  assert.equal(room.turnDeadline, null)
})

test('late requests enforce timeout before a delayed timer callback', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const room: TimedRoom = { timerEnabled: true, turnDeadline: null, started: true, finished: false }
  let expired = 0
  const clock = new TurnClock(() => { expired += 1; clock.start(room) })
  clock.start(room)
  context.mock.timers.setTime(181000)
  assert.equal(clock.expireIfDue(room), true)
  assert.equal(expired, 1)
  assert.equal(room.turnDeadline, 361000)
  context.mock.timers.tick(1)
  assert.equal(expired, 1)
  clock.stop(room)
})
