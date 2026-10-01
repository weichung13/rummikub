import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { io, type Socket } from 'socket.io-client'
import type { GameView } from '../src/game.js'
type Seat = { playerId: string; token: string; code: string; name: string }
function event<T>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timeout: ${name}`)) }, 4000)
    function handler(value: T) { clearTimeout(timer); resolve(value) }
    socket.once(name, handler)
  })
}
test('private seats, malformed messages, reconnects and revisions', { timeout: 20000 }, async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const clients: Socket[] = []
  try {
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server did not start')), 5000)
      child.stdout.on('data', chunk => { const match = String(chunk).match(/listening on (\d+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
      child.stderr.on('data', chunk => { clearTimeout(timer); reject(new Error(String(chunk))) })
    })
    const connect = async () => { const client = io(`http://127.0.0.1:${port}`, { autoConnect: false, reconnection: false }); clients.push(client); const ready = event(client, 'connect'); client.connect(); await ready; return client }
    const first = await connect()
    for (const payload of [null, {}, { name: 12 }]) {
      const error = event<string>(first, 'room:error'); first.emit('room:create', payload); assert.match(await error, /格式/)
    }
    const seatEvent = event<Seat>(first, 'room:seat'); const initial = event<GameView>(first, 'room:update')
    first.emit('room:create', { name: '甲' }); const seat = await seatEvent; await initial
    assert.notEqual(seat.playerId, seat.token)
    const second = await connect()
    const denial = event<string>(second, 'room:error')
    second.emit('room:join', { name: '冒用', code: seat.code, token: seat.playerId, reconnect: true })
    assert.match(await denial, /格式/)
    const seat2Event = event<Seat>(second, 'room:seat'); const joined = event<GameView>(first, 'room:update')
    second.emit('room:join', { name: '乙', code: seat.code }); const seat2 = await seat2Event; const view = await joined
    assert.ok(!JSON.stringify(view).includes(seat.token)); assert.ok(!JSON.stringify(view).includes(seat2.token))
    const started1 = event<GameView>(first, 'room:update'); const started2 = event<GameView>(second, 'room:update'); first.emit('game:start')
    const [v1, v2] = await Promise.all([started1, started2]); assert.equal(v1.revision, 1); assert.equal(v1.hand.length, 14)
    assert.ok(v1.hand.every(t => !v2.hand.some(other => other.id === t.id)))
    const active = v1.currentPlayerId === seat.playerId ? first : second
    const malformed = event<string>(active, 'room:error'); active.emit('game:play', [[null]]); assert.match(await malformed, /不合法/)
    const unknown = event<string>(active, 'room:error'); active.emit('game:play', [[{ id: 'fake1' }, { id: 'fake2' }, { id: 'fake3' }]]); assert.match(await unknown, /不合法/)
    const replacement = await connect(); const replaced = event(first, 'disconnect'); const restored = event<GameView>(replacement, 'room:update')
    const observerRestored = event<GameView>(second, 'room:update')
    replacement.emit('room:join', { name: seat.name, code: seat.code, token: seat.token, reconnect: true })
    const restoredView = await restored; await replaced; await observerRestored
    assert.equal(restoredView.revision, v1.revision)
    assert.deepEqual(restoredView.hand, v1.hand)
    assert.equal(restoredView.players.find(p => p.id === seat.playerId)?.connected, true)
    const current = v1.currentPlayerId === seat.playerId ? replacement : second
    const drawn = event<GameView>(replacement, 'room:update')
    const otherDrawn = event<GameView>(second, 'room:update')
    current.emit('game:draw')
    const [afterDraw] = await Promise.all([drawn, otherDrawn])
    assert.equal(afterDraw.revision, 2)
    // Exhaust the deck and pass a full round to finish without depending on random hands.
    let round: GameView = afterDraw
    for (let turn = 0; turn < 110 && !round.finished; turn += 1) {
      const actor = round.currentPlayerId === seat.playerId ? replacement : second
      const update1 = event<GameView>(replacement, 'room:update')
      const update2 = event<GameView>(second, 'room:update')
      actor.emit('game:draw')
      ;[round] = await Promise.all([update1, update2])
    }
    assert.equal(round.finished, true)
    const deniedRematch = event<string>(second, 'room:error')
    second.emit('game:start'); assert.match(await deniedRematch, /房主/)
    const restart1 = event<GameView>(replacement, 'room:update')
    const restart2 = event<GameView>(second, 'room:update')
    replacement.emit('game:start')
    const [fresh, fresh2] = await Promise.all([restart1, restart2])
    assert.equal(fresh.code, seat.code)
    assert.equal(fresh.finished, false)
    assert.equal(fresh.winnerId, null)
    assert.equal(fresh.hand.length, 14)
    assert.equal(fresh2.hand.length, 14)
    assert.equal(fresh.drawCount, 78)
    assert.deepEqual(fresh.table, [])
    assert.deepEqual(fresh.openedPlayers, [])
    assert.deepEqual(fresh.recentTableTileIds, [])
    assert.equal(fresh.revision, round.revision + 1)
    assert.ok(fresh.players.some(player => player.id === fresh.currentPlayerId))
    const duplicateStart = event<string>(replacement, 'room:error')
    replacement.emit('game:start'); assert.match(await duplicateStart, /進行中/)
    const left = event(replacement, 'room:left')
    const ended = event<GameView>(second, 'room:update')
    replacement.emit('room:leave')
    await left
    const endedView = await ended
    assert.equal(endedView.finished, true)
    assert.equal(endedView.currentPlayerId, null)
    assert.equal(endedView.players.length, 1)
    assert.equal(endedView.players[0].isHost, true)
    const stale = event<string>(replacement, 'room:error')
    replacement.emit('room:join', { ...seat, token: seat.token, reconnect: true })
    assert.match(await stale, /憑證無效/)
    const lastLeft = event(second, 'room:left'); second.emit('room:leave'); await lastLeft
    const missing = event<string>(replacement, 'room:error')
    replacement.emit('room:join', { name: '甲', code: seat.code })
    assert.match(await missing, /找不到/)
    const newSeat = event<Seat>(replacement, 'room:seat')
    replacement.emit('room:create', { name: '新房主' })
    const lobby = await newSeat
    const guestJoined = event<Seat>(second, 'room:seat')
    const guestView = event<GameView>(second, 'room:update')
    second.emit('room:join', { name: '新朋友', code: lobby.code }); await guestJoined; await guestView
    const hostLeft = event(replacement, 'room:left')
    const transferred = event<GameView>(second, 'room:update')
    replacement.emit('room:leave'); await hostLeft
    const remaining = await transferred
    assert.equal(remaining.started, false)
    assert.equal(remaining.players.length, 1)
    assert.equal(remaining.players[0].isHost, true)
    const lobbyRejoin = event<Seat>(replacement, 'room:seat')
    replacement.emit('room:join', { name: '回來了', code: lobby.code }); await lobbyRejoin
  } finally { clients.forEach(client => client.disconnect()); child.kill() }
})
