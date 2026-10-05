import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { io, type Socket } from 'socket.io-client'
import type { GameView } from '../src/game.js'
function update(socket: Socket): Promise<GameView> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Missing room update')), 4000)
    socket.once('room:update', view => { clearTimeout(timeout); resolve(view) })
  })
}
test('server timeout draws once, advances, survives reconnect and skips an empty deck', { timeout: 20000 }, async () => {
  const server = spawn(process.execPath, ['--import', 'tsx', '--import', './tests/helpers/virtual-time.ts', 'server/index.ts'], { env: { ...process.env, PORT: '0', NODE_NO_WARNINGS: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
  const clients: Socket[] = []
  try {
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No server')), 4000)
      server.stdout.on('data', chunk => { const match = String(chunk).match(/listening on (\d+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
      server.stderr.on('data', chunk => { clearTimeout(timer); reject(new Error(String(chunk))) })
    })
    for (let i = 0; i < 2; i++) {
      const socket = io(`http://localhost:${port}`, { autoConnect: false, reconnection: false, transports: ['websocket'] })
      clients.push(socket)
      await new Promise<void>(resolve => { socket.once('connect', resolve); socket.connect() })
    }
    const [host, guest] = clients
    let next = update(host)
    host.emit('room:create', { name: '甲', timerEnabled: true })
    const lobby = await next
    assert.equal(lobby.turnDeadline, null)
    next = update(guest)
    const hostJoined = update(host)
    guest.emit('room:join', { name: '乙', code: lobby.code })
    await Promise.all([next, hostJoined])
    next = update(host)
    const guestStart = update(guest)
    host.emit('game:start')
    let view = await next; await guestStart
    assert.equal(view.turnDeadline! - view.serverNow, 180000)
    const firstPlayer = view.currentPlayerId
    next = update(host)
    const guestTimeout = update(guest)
    server.stdin.write('180000\n')
    ;[view] = await Promise.all([next, guestTimeout])
    assert.notEqual(view.currentPlayerId, firstPlayer)
    assert.equal(view.players.find(p => p.id === firstPlayer)?.count, 15)
    assert.equal(view.drawCount, 77)
    assert.match(view.message, /時間到/)
    assert.equal(view.turnDeadline! - view.serverNow, 180000)
    // Each timeout after the deck empties counts as a pass and eventually ends the round.
    for (let i = 0; i < 80 && !view.finished; i++) {
      next = update(host)
      const other = update(guest)
      server.stdin.write('180000\n')
      ;[view] = await Promise.all([next, other])
    }
    assert.equal(view.finished, true)
    assert.equal(view.drawCount, 0)
    assert.equal(view.turnDeadline, null)
    next = update(host)
    host.emit('game:start')
    view = await next
    assert.equal(view.timerEnabled, true)
    assert.equal(view.turnDeadline! - view.serverNow, 180000)
    assert.equal(view.hand.length, 14)
  } finally { clients.forEach(client => client.disconnect()); server.kill() }
})
