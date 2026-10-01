import { randomUUID, randomBytes } from 'node:crypto'
import { validateTurn } from './turn.js'
import { validEntry, validSubmission } from './validation.js'
import express from 'express'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'
import { createDeck, orderMeld, type GameView, type Meld, type PlayerView, type Tile } from '../src/game.js'

type Player = {
  id: string
  key: string
  name: string
  socketId: string | null
  hand: Tile[]
}

type Room = {
  code: string
  revision: number
  hostId: string
  players: Player[]
  table: Meld[]
  deck: Tile[]
  currentPlayerId: string | null
  started: boolean
  finished: boolean
  winnerId: string | null
  openedPlayers: Set<string>
  recentTableTileIds: string[]
  passCount: number
  message: string
}

const app = express()
const server = createServer(app)
const io = new Server(server, { cors: { origin: '*' } })
const rooms = new Map<string, Room>()
const clientDirectory = fileURLToPath(new URL('../dist', import.meta.url))

app.get('/healthz', (_request, response) => response.sendStatus(200))
app.use(express.static(clientDirectory))
app.get(/.*/, (_request, response) => response.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url))))

function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  } while (rooms.has(code))
  return code
}

function meldSignature(meld: Meld): string {
  return meld.map((tile) => tile.id).sort().join('|')
}

function viewFor(room: Room, playerId: string): GameView {
  const viewer = room.players.find((player) => player.id === playerId)
  const players: PlayerView[] = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    count: player.hand.length,
    isHost: player.id === room.hostId,
    connected: player.socketId !== null,
  }))
  return {
    code: room.code,
    revision: room.revision,
    players,
    hand: viewer?.hand ?? [],
    table: room.table,
    currentPlayerId: room.currentPlayerId,
    started: room.started,
    finished: room.finished,
    winnerId: room.winnerId,
    drawCount: room.deck.length,
    message: room.message,
    openedPlayers: [...room.openedPlayers],
    recentTableTileIds: room.recentTableTileIds,
  }
}

function publish(room: Room): void {
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit('room:update', viewFor(room, player.id))
  }
}

function notify(socketId: string, message: string): void {
  io.to(socketId).emit('room:error', message)
}

function currentRoom(socket: { id: string; data: { roomCode?: string; playerId?: string } }): { room: Room; player: Player } | null {
  const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined
  const player = room?.players.find((candidate) => candidate.id === socket.data.playerId)
  return room && player && player.socketId === socket.id ? { room, player } : null
}

io.on('connection', (socket) => {
  socket.on('room:create', (input: unknown) => {
    if (!validEntry(input, false)) return notify(socket.id, '房間資料格式不正確。')
    if (currentRoom(socket)) return notify(socket.id, '你已經在房間內。')
    const { name } = input
    const key = randomBytes(32).toString('hex')
    const cleanName = name.trim().slice(0, 18)
    if (!cleanName) return notify(socket.id, '請輸入暱稱。')
    const code = makeCode()
    const player: Player = { id: randomUUID(), key, name: cleanName, socketId: socket.id, hand: [] }
    const room: Room = {
      code,
      revision: 0,
      hostId: player.id,
      players: [player],
      table: [],
      deck: [],
      currentPlayerId: null,
      started: false,
      finished: false,
      winnerId: null,
      openedPlayers: new Set(),
      recentTableTileIds: [],
      passCount: 0,
      message: '房間已建立，邀請朋友加入。',
    }
    rooms.set(code, room)
    socket.data.roomCode = code
    socket.data.playerId = player.id
    socket.emit('room:seat', { playerId: player.id, token: key, code, name: cleanName })
    publish(room)
  })

  socket.on('room:join', (input: unknown) => {
    if (!validEntry(input, true)) return notify(socket.id, '房間資料格式不正確。')
    const { code: requestedCode, name, token, reconnect } = input
    const code = requestedCode!.trim().toUpperCase()
    const cleanName = name.trim().slice(0, 18)
    const room = rooms.get(code)
    if (!room) return notify(socket.id, reconnect ? '伺服器已重新啟動，房間暫存已清除。請建立新房間。' : '找不到這個房間代碼。')
    if (!cleanName) return notify(socket.id, '請輸入暱稱。')
    const existing = currentRoom(socket)
    if (existing && existing.room.code !== code) return notify(socket.id, '你已經在其他房間內。')
    const returning = room.players.find((player) => player.key === token)
    if (returning) {
      const previousSocket = returning.socketId
      returning.socketId = socket.id
      if (previousSocket && previousSocket !== socket.id) {
        io.sockets.sockets.get(previousSocket)?.disconnect(true)
      }
      socket.data.roomCode = code
      socket.data.playerId = returning.id
      room.message = `${returning.name} 已重新連線。`
      socket.emit('room:seat', { playerId: returning.id, token: returning.key, code, name: returning.name })
      publish(room)
      return
    }
    if (token || reconnect) return notify(socket.id, '重連憑證無效，請重新加入房間。')
    if (currentRoom(socket)) return notify(socket.id, '你已經在房間內。')
    if (room.started && !room.finished) return notify(socket.id, '牌局已經開始，無法加入。')
    if (room.players.length >= 6) return notify(socket.id, '房間已滿，最多 6 人。')
    const key = randomBytes(32).toString('hex')
    const player: Player = { id: randomUUID(), key, name: cleanName, socketId: socket.id, hand: [] }
    socket.emit('room:seat', { playerId: player.id, token: key, code, name: cleanName })
    room.players.push(player)
    room.message = `${cleanName} 加入房間。`
    socket.data.roomCode = code
    socket.data.playerId = player.id
    publish(room)
  })

  socket.on('room:leave', () => {
    const current = currentRoom(socket)
    if (current) {
      const { room, player } = current
      room.players = room.players.filter(candidate => candidate.id !== player.id)
      room.openedPlayers.delete(player.id)
      if (room.players.length === 0) {
        rooms.delete(room.code)
      } else {
        if (room.hostId === player.id) room.hostId = (room.players.find(candidate => candidate.socketId) ?? room.players[0]).id
        if (room.started && !room.finished) {
          room.finished = true
          room.currentPlayerId = null
          room.winnerId = null
          room.revision += 1
          room.message = `${player.name} 離開房間，本局結束。`
        } else if (!room.finished) {
          room.message = `${player.name} 離開房間。`
        }
        publish(room)
      }
    }
    delete socket.data.roomCode
    delete socket.data.playerId
    socket.emit('room:left')
  })

  socket.on('game:start', () => {
    const current = currentRoom(socket)
    if (!current) return
    const { room, player } = current
    if (player.id !== room.hostId) return notify(socket.id, '只有房主可以開始遊戲。')
    if (room.started && !room.finished) return notify(socket.id, '牌局正在進行中。')
    if (room.players.length < 2) return notify(socket.id, '至少需要 2 位玩家才能開始。')
    if (room.players.some(participant => !participant.socketId)) return notify(socket.id, '請等待所有玩家重新連線後再開始。')
    room.table = []
    room.finished = false
    room.winnerId = null
    room.openedPlayers.clear()
    room.passCount = 0
    for (const participant of room.players) participant.hand = []
    const copies = room.players.length <= 4 ? 2 : 3
    room.deck = createDeck(copies)
    for (let count = 0; count < 14; count += 1) {
      for (const participant of room.players) participant.hand.push(room.deck.pop()!)
    }
    room.revision += 1
    room.started = true
    const starter = room.players[Math.floor(Math.random() * room.players.length)]
    room.currentPlayerId = starter.id
    room.recentTableTileIds = []
    room.message = `${starter.name} 先開始。`
    publish(room)
  })

  socket.on('game:play', (submitted: unknown) => {
    const current = currentRoom(socket)
    if (!current) return
    const { room, player } = current
    if (!room.started || room.finished || room.currentPlayerId !== player.id) return notify(socket.id, '現在不是你的回合。')
    if (!validSubmission(submitted)) {
      return notify(socket.id, '桌面有不合法的牌組，請檢查順子或同數字組。')
    }

    const result = validateTurn(room.table, player.hand, room.openedPlayers.has(player.id), submitted)
    if ('error' in result) return notify(socket.id, result.error)
    const { canonical, addedIds, newIds } = result
    room.openedPlayers.add(player.id)

    const newMeldSignatures = new Set(canonical.map(meldSignature))
    const movedTiles = room.table
      .filter((meld) => !newMeldSignatures.has(meldSignature(meld)))
      .flat()
      .filter((tile) => newIds.includes(tile.id))
    room.recentTableTileIds = [...new Set([...addedIds, ...movedTiles.map((tile) => tile.id)])]
    room.revision += 1
    room.table = canonical.map(orderMeld)
    player.hand = player.hand.filter((tile) => !addedIds.includes(tile.id))
    room.passCount = 0
    if (player.hand.length === 0) {
      room.finished = true
      room.winnerId = player.id
      room.message = `${player.name} 出完手牌，獲勝！`
    } else {
      advance(room)
      room.message = `${player.name} 出牌完成。`
    }
    publish(room)
  })

  socket.on('game:draw', () => {
    const current = currentRoom(socket)
    if (!current) return
    const { room, player } = current
    if (!room.started || room.finished || room.currentPlayerId !== player.id) return notify(socket.id, '現在不是你的回合。')
    room.revision += 1
    if (room.deck.length > 0) {
      const drawnTile = room.deck.pop()!
      player.hand.push(drawnTile)
      io.to(socket.id).emit('game:drawn', drawnTile)
      room.passCount = 0
      room.message = `${player.name} 摸了一張牌。`
    } else {
      room.passCount += 1
      if (room.passCount >= room.players.length) {
        room.finished = true
        room.message = '牌堆已空且全體一輪無法出牌，平手。'
      } else {
        room.message = `${player.name} 無法出牌，略過回合。`
      }
    }
    if (!room.finished) advance(room)
    publish(room)
  })

  socket.on('disconnect', () => {
    const current = currentRoom(socket)
    if (!current) return
    current.player.socketId = null
    current.room.message = `${current.player.name} 連線中斷，回來後可重新加入。`
    publish(current.room)
  })
})

function advance(room: Room): void {
  const currentIndex = room.players.findIndex((player) => player.id === room.currentPlayerId)
  room.currentPlayerId = room.players[(currentIndex + 1) % room.players.length].id
}

const port = Number(process.env.PORT ?? 3001)
server.listen(port, () => console.log(`Rummikub server listening on ${(server.address() as { port: number }).port}`))
