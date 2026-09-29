import express from 'express'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'
import { createDeck, isValidMeld, meldValue, type GameView, type Meld, type PlayerView, type Tile } from '../src/game.js'

type Player = {
  id: string
  key: string
  name: string
  socketId: string | null
  hand: Tile[]
  drawnTile: Tile | null
}

type Room = {
  code: string
  hostId: string
  players: Player[]
  table: Meld[]
  deck: Tile[]
  currentPlayerId: string | null
  started: boolean
  finished: boolean
  winnerId: string | null
  openedPlayers: Set<string>
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
    drawnTile: viewer?.drawnTile ?? null,
  }
}

function publish(room: Room): void {
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit('room:update', viewFor(room, player.id))
    player.drawnTile = null
  }
}

function notify(socketId: string, message: string): void {
  io.to(socketId).emit('room:error', message)
}

function currentRoom(socket: { data: { roomCode?: string; playerId?: string } }): { room: Room; player: Player } | null {
  const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined
  const player = room?.players.find((candidate) => candidate.id === socket.data.playerId)
  return room && player ? { room, player } : null
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name, key }: { name: string; key: string }) => {
    const cleanName = name.trim().slice(0, 18)
    if (!cleanName || !key) return notify(socket.id, '請輸入暱稱。')
    const code = makeCode()
    const player: Player = { id: key, key, name: cleanName, socketId: socket.id, hand: [], drawnTile: null }
    const room: Room = {
      code,
      hostId: player.id,
      players: [player],
      table: [],
      deck: [],
      currentPlayerId: null,
      started: false,
      finished: false,
      winnerId: null,
      openedPlayers: new Set(),
      passCount: 0,
      message: '房間已建立，邀請朋友加入。',
    }
    rooms.set(code, room)
    socket.data.roomCode = code
    socket.data.playerId = player.id
    publish(room)
  })

  socket.on('room:join', ({ code: requestedCode, name, key }: { code: string; name: string; key: string }) => {
    const code = requestedCode.trim().toUpperCase()
    const cleanName = name.trim().slice(0, 18)
    const room = rooms.get(code)
    if (!room) return notify(socket.id, '找不到這個房間代碼。')
    if (!cleanName || !key) return notify(socket.id, '請輸入暱稱。')
    const returning = room.players.find((player) => player.key === key)
    if (returning) {
      returning.socketId = socket.id
      socket.data.roomCode = code
      socket.data.playerId = returning.id
      publish(room)
      return
    }
    if (room.started) return notify(socket.id, '牌局已經開始，無法加入。')
    if (room.players.length >= 6) return notify(socket.id, '房間已滿，最多 6 人。')
    const player: Player = { id: key, key, name: cleanName, socketId: socket.id, hand: [], drawnTile: null }
    room.players.push(player)
    room.message = `${cleanName} 加入房間。`
    socket.data.roomCode = code
    socket.data.playerId = player.id
    publish(room)
  })

  socket.on('game:start', () => {
    const current = currentRoom(socket)
    if (!current) return
    const { room, player } = current
    if (player.id !== room.hostId) return notify(socket.id, '只有房主可以開始遊戲。')
    if (room.started || room.players.length < 2) return notify(socket.id, '至少需要 2 位玩家才能開始。')
    const copies = room.players.length <= 4 ? 2 : 3
    room.deck = createDeck(copies)
    for (let count = 0; count < 14; count += 1) {
      for (const participant of room.players) participant.hand.push(room.deck.pop()!)
    }
    room.started = true
    room.currentPlayerId = room.players[0].id
    room.message = `${room.players[0].name} 先開始。`
    publish(room)
  })

  socket.on('game:play', (submitted: Meld[][]) => {
    const current = currentRoom(socket)
    if (!current) return
    const { room, player } = current
    if (!room.started || room.finished || room.currentPlayerId !== player.id) return notify(socket.id, '現在不是你的回合。')
    if (!Array.isArray(submitted) || submitted.some((meld) => !Array.isArray(meld))) {
      return notify(socket.id, '桌面有不合法的牌組，請檢查順子或同數字組。')
    }

    const oldIds = room.table.flat().map((tile) => tile.id)
    const knownTiles = new Map([...room.table.flat(), ...player.hand].map((tile) => [tile.id, tile]))
    const candidate = submitted.map((meld) => meld.map((tile) => knownTiles.get(tile.id)))
    if (candidate.flat().some((tile) => !tile) || candidate.some((meld) => !isValidMeld(meld as Tile[]))) {
      return notify(socket.id, '桌面有不合法的牌組，請檢查順子或同數字組。')
    }
    const canonical = candidate as Meld[]
    const newIds = canonical.flat().map((tile) => tile.id)
    if (new Set(newIds).size !== newIds.length || oldIds.some((id) => !newIds.includes(id))) {
      return notify(socket.id, '桌面原有的牌必須全部留在合法牌組中。')
    }
    const handIds = new Set(player.hand.map((tile) => tile.id))
    const addedIds = newIds.filter((id) => !oldIds.includes(id))
    if (addedIds.length === 0 || addedIds.some((id) => !handIds.has(id))) {
      return notify(socket.id, '請在桌面牌組中使用至少一張自己的手牌。')
    }
    if (!room.openedPlayers.has(player.id)) {
      const previousMelds = room.table.map((meld) => meld.map((tile) => tile.id).sort().join('|'))
      const unchanged = previousMelds.every((ids) => canonical.some((meld) => meld.map((tile) => tile.id).sort().join('|') === ids))
      const newMelds = canonical.filter((meld) => !previousMelds.includes(meld.map((tile) => tile.id).sort().join('|')))
      if (!unchanged || newMelds.some((meld) => meld.some((tile) => !handIds.has(tile.id)))) {
        return notify(socket.id, '完成首次出牌前，不能重組桌面上其他玩家的牌組。')
      }
      const total = newMelds.reduce((sum, meld) => sum + meldValue(meld), 0)
      if (total < 30) return notify(socket.id, `首次出牌需要至少 30 點，目前是 ${total} 點。`)
      room.openedPlayers.add(player.id)
    }

    room.table = canonical
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
    if (room.deck.length > 0) {
      const drawnTile = room.deck.pop()!
      player.hand.push(drawnTile)
      player.drawnTile = drawnTile
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
server.listen(port, () => console.log(`Rummikub server listening on ${port}`))