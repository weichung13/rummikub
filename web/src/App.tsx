import { useEffect, useMemo, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { colors, orderMeld, type GameView, type Meld, type Tile, type TileColor } from './game'
import './App.css'

type SavedSeat = { name: string; key: string; code?: string }
const seatStorageKey = 'rummikub-seat'
const seatKey = () => {
  const saved = localStorage.getItem(seatStorageKey)
  if (saved) return (JSON.parse(saved) as SavedSeat).key
  const key = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  localStorage.setItem(seatStorageKey, JSON.stringify({ key }))
  return key
}

function tileName(tile: Tile): string {
  return tile.color === 'joker' ? '鬼牌' : `${tile.value} ${colorName(tile.color)}`
}

function colorName(color: TileColor | 'joker'): string {
  return { red: '紅', blue: '藍', yellow: '黃', black: '黑', joker: '鬼' }[color]
}

function App() {
  const [socket] = useState<Socket>(() => io({ autoConnect: false }))
  const [room, setRoom] = useState<GameView | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [draft, setDraft] = useState<Meld[]>([])
  const [draftHistory, setDraftHistory] = useState<Meld[][]>([])
  const [sortMode, setSortMode] = useState<'color' | 'number'>('color')
  const [linkCopied, setLinkCopied] = useState(false)
  const [drawNotice, setDrawNotice] = useState<Tile | null>(null)
  const [recentDrawTileId, setRecentDrawTileId] = useState<string | null>(null)

  useEffect(() => {
    const onUpdate = (nextRoom: GameView) => {
      setRoom(nextRoom)
      setDraft(nextRoom.table)
      setDraftHistory([])
      setSelected([])
      setError('')
    }
    const onError = (message: string) => {
      if (message.startsWith('伺服器已重新啟動')) {
        const saved = localStorage.getItem(seatStorageKey)
        if (saved) {
          const seat = JSON.parse(saved) as SavedSeat
          delete seat.code
          localStorage.setItem(seatStorageKey, JSON.stringify(seat))
        }
        setRoom(null)
        setDraft([])
        setDraftHistory([])
        setSelected([])
        setCode('')
      }
      setError(message)
    }
    const onDrawn = (tile: Tile) => {
      setDrawNotice(tile)
      setRecentDrawTileId(tile.id)
    }
    const onConnect = () => {
      const saved = localStorage.getItem(seatStorageKey)
      if (!saved) return
      const seat = JSON.parse(saved) as SavedSeat
      if (seat.code && seat.name) socket.emit('room:join', { code: seat.code, name: seat.name, key: seat.key, reconnect: true })
    }
    socket.on('room:update', onUpdate)
    socket.on('room:error', onError)
    socket.on('game:drawn', onDrawn)
    socket.on('connect', onConnect)
    socket.connect()
    return () => {
      socket.off('room:update', onUpdate)
      socket.off('room:error', onError)
      socket.off('game:drawn', onDrawn)
      socket.off('connect', onConnect)
      socket.disconnect()
    }
  }, [socket])

  useEffect(() => {
    if (!drawNotice) return
    const timeout = window.setTimeout(() => setDrawNotice(null), 4500)
    return () => window.clearTimeout(timeout)
  }, [drawNotice])

  useEffect(() => {
    if (!room) return
    const saved = localStorage.getItem(seatStorageKey)
    if (!saved) return
    const seat = JSON.parse(saved) as SavedSeat
    const currentPlayer = room.players.find((player) => player.id === seat.key)
    if (currentPlayer) {
      localStorage.setItem(seatStorageKey, JSON.stringify({ ...seat, name: currentPlayer.name, code: room.code }))
    }
  }, [room])

  const playerKey = useMemo(() => seatKey(), [])
  const me = room?.players.find((player) => player.id === playerKey)
  const isMyTurn = room?.currentPlayerId === playerKey
  const tableTileIds = new Set(room?.table.flat().map((tile) => tile.id) ?? [])
  const hasNewTilesOnTable = draft.flat().some((tile) => !tableTileIds.has(tile.id))
  const sortedHand = useMemo(() => {
    if (!room) return []
    const draftTileIds = new Set(draft.flat().map((tile) => tile.id))
    return room.hand.filter((tile) => !draftTileIds.has(tile.id)).sort((left, right) => {
      if (left.color === 'joker') return 1
      if (right.color === 'joker') return -1
      if (sortMode === 'number') return left.value - right.value || colors.indexOf(left.color) - colors.indexOf(right.color)
      return colors.indexOf(left.color) - colors.indexOf(right.color) || left.value - right.value
    })
  }, [draft, room, sortMode])
  const handByColor = colors.map((color) => ({
    color,
    tiles: sortedHand.filter((tile) => tile.color === color || (color === 'black' && tile.color === 'joker')),
  }))

  const enterRoom = (action: 'create' | 'join') => {
    const cleanName = name.trim()
    if (!cleanName) return setError('先輸入你的暱稱。')
    const seat: SavedSeat = { name: cleanName, key: playerKey, ...(action === 'join' ? { code: code.trim().toUpperCase() } : {}) }
    localStorage.setItem(seatStorageKey, JSON.stringify(seat))
    setError('')
    socket.emit(action === 'create' ? 'room:create' : 'room:join', { name: cleanName, key: playerKey, code: code.trim().toUpperCase() })
  }

  const toggleTile = (tileId: string) => {
    setSelected((previous) => previous.includes(tileId) ? previous.filter((id) => id !== tileId) : [...previous, tileId])
  }

  const selectedTiles = () => {
    const available = new Map([...room!.hand, ...draft.flat()].map((tile) => [tile.id, tile]))
    return selected.map((id) => available.get(id)).filter((tile): tile is Tile => Boolean(tile))
  }

  const formMeld = () => {
    const tiles = selectedTiles()
    if (tiles.length < 3) return setError('選至少 3 張牌組成新牌組。')
    const chosen = new Set(selected)
    const remainder = draft.map((meld) => meld.filter((tile) => !chosen.has(tile.id))).filter((meld) => meld.length > 0)
    setDraftHistory((history) => [...history, draft])
    setDraft([...remainder, orderMeld(tiles)])
    setSelected([])
    setError('')
  }

  const undoLastDraftAction = () => {
    const previousDraft = draftHistory.at(-1)
    if (!previousDraft) return
    setDraft(previousDraft)
    setDraftHistory((history) => history.slice(0, -1))
    setSelected([])
  }

  const resetDraft = () => {
    if (!room) return
    setDraft(room.table)
    setDraftHistory([])
    setSelected([])
  }

  const submitTurn = () => {
    setRecentDrawTileId(null)
    socket.emit('game:play', draft)
  }
  const copyRoomCode = async () => {
    if (!room) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(room.code)
      } else {
        const input = document.createElement('textarea')
        input.value = room.code
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.append(input)
        input.select()
        const copied = document.execCommand('copy')
        input.remove()
        if (!copied) throw new Error('Clipboard unavailable')
      }
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 1600)
    } catch {
      setError(`請手動分享房間代碼：${room.code}`)
    }
  }

  if (!room) {
    return (
      <main className="entry-shell">
        <section className="entry-panel">
          <header className="brand-row"><span className="brand-mark">R</span><span>RUMI CLUB</span><span className="online-indicator"><i /> LIVE TABLES</span></header>
          <div className="entry-copy"><p className="eyebrow">THE CLASSIC TILE GAME</p><h1>一桌好牌，<br /><em>等你入局。</em></h1><p className="intro">和朋友開一桌拉密。分享房間代碼，他們就能用自己的手機加入。</p></div>
          <div className="entry-form">
            <label htmlFor="player-name">你的暱稱</label>
            <input id="player-name" maxLength={18} placeholder="輸入暱稱" value={name} onChange={(event) => setName(event.target.value)} />
            <button className="primary-button create-button" onClick={() => enterRoom('create')}>建立新房間 <span>↗</span></button>
            <div className="join-divider"><span>或加入朋友的房間</span></div>
            <div className="join-row"><input aria-label="房間代碼" maxLength={5} placeholder="輸入 5 碼代碼" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /><button className="secondary-button" onClick={() => enterRoom('join')}>加入房間</button></div>
            {error && <p className="error-text" role="alert">{error}</p>}
          </div>
          <footer className="entry-foot"><span>2–6 PLAYERS</span><span>106 / 160 TILES</span><span>NO SCORE, JUST THE WIN</span></footer>
        </section>
        <aside className="entry-art" aria-hidden="true"><div className="art-caption"><span>01 / 04</span><span>CLASSIC RUMMY</span></div><div className="tile-stack"><div className="hero-tile tile-red"><span>7</span><small>◆</small></div><div className="hero-tile tile-blue"><span>8</span><small>◆</small></div><div className="hero-tile tile-yellow"><span>9</span><small>◆</small></div><div className="hero-tile tile-black"><span>10</span><small>◆</small></div><div className="hero-tile tile-joker"><span>★</span><small>JOKER</small></div></div><div className="art-note"><span>MAKE YOUR RUN</span><span>YOUR TABLE, YOUR MOVE.</span></div></aside>
      </main>
    )
  }

  const winner = room.players.find((player) => player.id === room.winnerId)
  const turnPlayer = room.players.find((player) => player.id === room.currentPlayerId)
  const isHost = Boolean(me?.isHost)

  return (
    <main className="game-shell">
      <header className="game-header"><a className="wordmark" href="/" onClick={(event) => { event.preventDefault(); localStorage.removeItem(seatStorageKey); window.location.reload() }}><span className="brand-mark">R</span><span>RUMI CLUB</span></a><div className="room-tag"><span>ROOM</span><strong>{room.code}</strong><button aria-label="複製房間代碼" title="複製房間代碼" onClick={copyRoomCode}>{linkCopied ? '✓' : '▢'}</button></div><div className="header-right"><span className="live-dot" /><span className="header-label">PRIVATE TABLE</span><span className="player-total">{room.players.length} / 6</span></div></header>
      <section className="players-strip" aria-label="房間玩家">{room.players.map((player, index) => <div className={`player-seat ${room.currentPlayerId === player.id && room.started && !room.finished ? 'is-active' : ''}`} key={player.id}><span className={`seat-avatar avatar-${index % 6}`}>{player.name.slice(0, 1).toUpperCase()}</span><span className="seat-info"><strong>{player.name}{player.id === playerKey ? '（你）' : ''}</strong><small>{player.isHost ? '房主' : player.connected ? '已加入' : '重新連線中'}</small></span>{room.started && <span className="tile-count">{player.id === playerKey ? sortedHand.length : player.count}<small>張</small></span>}</div>)}</section>
      <section className="table-area">
        {!room.started ? <div className="waiting-state"><div className="wait-mark">✳</div><p className="eyebrow">ROOM {room.code}</p><h1>朋友，<em>就等你了。</em></h1><p className="waiting-copy">分享房間代碼，等大家用手機入座。至少 2 位玩家即可開始。</p><button className="code-share" onClick={copyRoomCode}><span>房間代碼</span><strong>{room.code}</strong><small>{linkCopied ? '已複製' : '點擊複製'}</small></button><div className="waiting-bottom"><span>{room.players.length} 位玩家已入座</span>{isHost ? <button className="primary-button" disabled={room.players.length < 2} onClick={() => socket.emit('game:start')}>開始遊戲 <span>↗</span></button> : <span>等待房主開始遊戲</span>}</div></div> : <>
          <div className="table-heading"><div><p className="eyebrow">{room.finished ? 'GAME OVER' : isMyTurn ? 'YOUR TURN' : 'TABLE IN PLAY'}</p><h1>{room.finished ? winner ? `${winner.name} 獲勝` : '平手' : isMyTurn ? '輪到你了' : turnPlayer ? `${turnPlayer.name} 的回合` : '拉密桌'}</h1></div><div className="draw-status"><span>DRAW PILE</span><strong>{room.drawCount}</strong><small>張</small></div></div>
          <div className="table-surface">{draft.length === 0 ? <div className="empty-table"><span>✳</span><p>桌面還沒有牌組</p><small>選好手牌，排出第一組牌</small></div> : draft.map((meld, meldIndex) => <div className="meld" key={meldIndex}>{meld.map((tile) => <TileButton key={tile.id} tile={tile} selected={selected.includes(tile.id)} highlighted={room.recentTableTileIds.includes(tile.id)} onClick={() => isMyTurn && room.openedPlayers.includes(playerKey) && toggleTile(tile.id)} />)}</div>)}</div>
          {room.finished && <div className="game-result">{room.message}<button className="secondary-button" onClick={() => { localStorage.removeItem(seatStorageKey); window.location.reload() }}>返回大廳</button></div>}
          {!room.finished && <div className="table-tools"><span>{room.message}</span>{isMyTurn && <div className="tool-actions"><button className="text-button" disabled={draftHistory.length === 0} onClick={undoLastDraftAction}>復原上一步</button><button className="text-button" disabled={draftHistory.length === 0} onClick={resetDraft}>全部重設</button><button className="secondary-button" disabled={selected.length < 3} onClick={formMeld}>將選取牌組成一組</button><button className="primary-button" disabled={!hasNewTilesOnTable} onClick={submitTurn}>提交出牌 <span>↗</span></button><button className="draw-button" onClick={() => socket.emit('game:draw')}>{room.drawCount > 0 ? '摸一張' : '略過回合'} <span>＋</span></button></div>}</div>}
        </>}
      </section>
      {room.started && !room.finished && <section className="hand-area"><div className="hand-heading"><div><p className="eyebrow">YOUR RACK</p><h2>{sortedHand.length} 張手牌</h2></div><label className="sort-control">排序 <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'color' | 'number')}><option value="color">依顏色</option><option value="number">依數字</option></select></label></div><div className="hand-rack">{handByColor.map(({ color, tiles }) => <div className={`hand-color-row color-row-${color}`} key={color}><span className={`rack-color-label tile-${color}`}>{colorName(color)}{color === 'black' ? '／鬼牌' : ''}</span><div className="hand-color-tiles">{tiles.map((tile) => <TileButton key={tile.id} tile={tile} selected={selected.includes(tile.id)} highlighted={tile.id === recentDrawTileId} onClick={() => isMyTurn && toggleTile(tile.id)} />)}</div></div>)}</div><div className="hand-foot"><span>{isMyTurn ? '選擇手牌，也可選桌面上的牌重新組合。' : '等候其他玩家完成回合'}</span><span>{room.openedPlayers.includes(playerKey) ? '已完成首次出牌' : '首次出牌需達 30 點'}</span></div></section>}
      {drawNotice && <div className="draw-notice" role="status" aria-live="polite"><span className={`drawn-tile tile-${drawNotice.color}`} aria-hidden="true"><strong>{drawNotice.color === 'joker' ? '★' : drawNotice.value}</strong><small>{drawNotice.color === 'joker' ? 'J' : '◆'}</small></span><span><small>你摸到</small><strong>{tileName(drawNotice)}</strong></span><button type="button" aria-label="關閉摸牌提示" onClick={() => setDrawNotice(null)}>×</button></div>}
      {error && <div className="toast-error" role="alert"><span>{error}</span><button aria-label="關閉訊息" onClick={() => setError('')}>×</button></div>}
    </main>
  )
}

function TileButton({ tile, selected, highlighted = false, onClick }: { tile: Tile; selected: boolean; highlighted?: boolean; onClick: () => void }) {
  return <button type="button" className={`tile tile-${tile.color} ${selected ? 'is-selected' : ''} ${highlighted ? 'is-recent' : ''}`} aria-label={tileName(tile)} aria-pressed={selected} onClick={onClick}><span>{tile.color === 'joker' ? '★' : tile.value}</span><small>{tile.color === 'joker' ? 'J' : '◆'}</small></button>
}

export default App
