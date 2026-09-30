import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { io, type Socket } from 'socket.io-client'
import { colors, isValidMeld, meldValue, orderMeld, type GameView, type Meld, type Tile, type TileColor } from './game'
import './App.css'

type SavedSeat = { name: string; playerId: string; token: string; code: string }
const seatStorageKey = 'rummikub-seat-v2'
function readSeat(): SavedSeat | null {
  try {
    const seat = JSON.parse(localStorage.getItem(seatStorageKey) ?? 'null')
    return seat && typeof seat.token === 'string' && typeof seat.playerId === 'string' && typeof seat.code === 'string' && typeof seat.name === 'string' ? seat : null
  } catch { return null }
}

function tileName(tile: Tile): string {
  return tile.color === 'joker' ? '鬼牌' : `${tile.value} ${colorName(tile.color)}`
}

function colorName(color: TileColor | 'joker'): string {
  return { red: '紅', blue: '藍', yellow: '黃', black: '黑', joker: '鬼' }[color]
}

type DrawFlight = {
  tile: Tile
  left: number
  top: number
  deltaX: number
  deltaY: number
}

function App() {
  const [socket] = useState<Socket>(() => io({ autoConnect: false }))
  const [room, setRoom] = useState<GameView | null>(null)
  const [name, setName] = useState(() => readSeat()?.name ?? '')
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 5) ?? '')
  const [playerKey, setPlayerKey] = useState(() => readSeat()?.playerId ?? '')
  const [connected, setConnected] = useState(false)
  const [pending, setPending] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [confirmDraw, setConfirmDraw] = useState(false)
  const versionRef = useRef('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [draft, setDraft] = useState<Meld[]>([])
  const [draftHistory, setDraftHistory] = useState<Meld[][]>([])
  const [linkCopied, setLinkCopied] = useState(false)
  const [pendingDrawTile, setPendingDrawTile] = useState<Tile | null>(null)
  const [drawFlight, setDrawFlight] = useState<DrawFlight | null>(null)
  const dockRef = useRef<HTMLElement>(null)
  const [dockHeight, setDockHeight] = useState(180)
  const drawPileRef = useRef<HTMLDivElement>(null)
  const handRackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onUpdate = (nextRoom: GameView) => {
      setRoom(nextRoom)
      const version = `${nextRoom.code}:${nextRoom.revision}`
      if (versionRef.current !== version) {
        versionRef.current = version
        setDraft(nextRoom.table)
        setDraftHistory([])
        setSelected([])
        setConfirmDraw(false)
        setPending(false)
        setError('')
      }
    }
    const onSeat = (seat: SavedSeat) => {
      localStorage.setItem(seatStorageKey, JSON.stringify(seat))
      setConnected(true)
      setPlayerKey(seat.playerId)
      setPending(false)
    }
    const onError = (message: string) => {
      setPending(false)
      if (message.startsWith('伺服器已重新啟動') || message.startsWith('重連憑證無效')) {
        localStorage.removeItem(seatStorageKey)
        setConnected(socket.connected)
        versionRef.current = ''
        setRoom(null)
        setDraft([])
        setDraftHistory([])
        setSelected([])
      }
      setError(message)
    }
    const onDrawn = (tile: Tile) => setPendingDrawTile(tile)
    const onConnect = () => {
      setConnectionError('')
      const seat = readSeat()
      setConnected(!seat)
      if (seat) socket.emit('room:join', { code: seat.code, name: seat.name, token: seat.token, reconnect: true })
    }
    const onDisconnect = (reason: string) => {
      setConnected(false)
      setPending(false)
      setConnectionError(reason === 'io server disconnect' ? '此座位已在其他分頁開啟，請關閉此頁。' : '連線中斷，正在重新連線；你的排列會保留。')
    }
    const onConnectError = () => { setConnected(false); setPending(false); setConnectionError('暫時無法連線，正在重試…') }
    socket.on('room:seat', onSeat)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('room:update', onUpdate)
    socket.on('room:error', onError)
    socket.on('game:drawn', onDrawn)
    socket.on('connect', onConnect)
    socket.connect()
    return () => {
      socket.off('room:seat', onSeat)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('room:update', onUpdate)
      socket.off('room:error', onError)
      socket.off('game:drawn', onDrawn)
      socket.off('connect', onConnect)
      socket.disconnect()
    }
  }, [socket])

  useEffect(() => {
    if (!pendingDrawTile || !room?.hand.some((tile) => tile.id === pendingDrawTile.id)) return
    const pile = drawPileRef.current?.getBoundingClientRect()
    const target = handRackRef.current?.querySelector<HTMLElement>(`[data-tile-id="${pendingDrawTile.id}"]`)?.getBoundingClientRect()
    if (!pile || !target) {
      setPendingDrawTile(null)
      return
    }

    setDrawFlight({
      tile: pendingDrawTile,
      left: pile.left + pile.width / 2 - 24,
      top: pile.top + pile.height / 2 - 32,
      deltaX: target.left + target.width / 2 - (pile.left + pile.width / 2),
      deltaY: target.top + target.height / 2 - (pile.top + pile.height / 2),
    })
    setPendingDrawTile(null)
  }, [pendingDrawTile, room])

  useEffect(() => {
    if (!drawFlight) return
    const timeout = window.setTimeout(() => setDrawFlight(null), 1050)
    return () => window.clearTimeout(timeout)
  }, [drawFlight])

  useEffect(() => {
    if (!pending) return
    const timeout = window.setTimeout(() => { setPending(false); setError('尚未收到回應，請確認連線後再試。') }, 10000)
    return () => window.clearTimeout(timeout)
  }, [pending])

  useEffect(() => {
    if (!dockRef.current) return
    const observer = new ResizeObserver(([entry]) => setDockHeight(entry.target.getBoundingClientRect().height))
    observer.observe(dockRef.current)
    return () => observer.disconnect()
  }, [room?.started, room?.finished])

  const me = room?.players.find((player) => player.id === playerKey)
  const isMyTurn = room?.currentPlayerId === playerKey
  const canAct = Boolean(isMyTurn && connected && !pending && !room?.finished)
  const opened = room?.openedPlayers.includes(playerKey) ?? false
  const tableTileIds = new Set(room?.table.flat().map((tile) => tile.id) ?? [])
  const hasNewTilesOnTable = draft.flat().some((tile) => !tableTileIds.has(tile.id))
  const newMelds = draft.filter(meld => meld.every(tile => !tableTileIds.has(tile.id)))
  const openingPoints = newMelds.reduce((sum, meld) => sum + meldValue(meld), 0)
  const validTable = draft.every(isValidMeld)
  const canSubmit = canAct && hasNewTilesOnTable && validTable && (opened || openingPoints >= 30)
  const sortedHand = useMemo(() => {
    if (!room) return []
    const draftTileIds = new Set(draft.flat().map((tile) => tile.id))
    return room.hand
      .filter((tile) => !draftTileIds.has(tile.id))
      .sort((left, right) => left.value - right.value || left.id.localeCompare(right.id))
  }, [draft, room])
  const handRows = [
    ...colors.map((color) => ({
      key: color,
      label: colorName(color),
      color,
      tiles: sortedHand.filter((tile) => tile.color === color),
    })),
    { key: 'joker', label: '鬼牌', color: 'joker' as const, tiles: sortedHand.filter((tile) => tile.color === 'joker') },
  ].filter((row) => row.tiles.length > 0)

  const enterRoom = (action: 'create' | 'join') => {
    const cleanName = name.trim()
    if (!cleanName) return setError('先輸入你的暱稱。')
    if (!connected || pending) return
    setPending(true)
    setError('')
    socket.emit(action === 'create' ? 'room:create' : 'room:join', { name: cleanName, code: code.trim().toUpperCase() })
  }

  const addToMeld = (index: number) => {
    if (!canAct || !selected.length) return
    const target = draft[index]
    if (!opened && target.some(tile => tableTileIds.has(tile.id))) return
    const tiles = selectedTiles()
    const chosen = new Set(selected)
    setDraftHistory(history => [...history, draft])
    setDraft(draft.map((meld, i) => i === index ? orderMeld([...meld.filter(tile => !chosen.has(tile.id)), ...tiles]) : meld.filter(tile => !chosen.has(tile.id))).filter(meld => meld.length))
    setSelected([])
    setError('')
  }
  const drawTile = () => {
    if (!canAct) return
    if (draftHistory.length && !confirmDraw) { setConfirmDraw(true); return }
    setConfirmDraw(false)
    setPending(true)
    socket.emit('game:draw')
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
    if (!canSubmit) return
    setPending(true)
    socket.emit('game:play', draft)
  }
  const copyRoomCode = async () => {
    if (!room) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${location.origin}/?room=${room.code}`)
      } else {
        const input = document.createElement('textarea')
        input.value = `${location.origin}/?room=${room.code}`
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
          <header className="brand-row"><span className="brand-mark">R</span><span>RUMI CLUB</span><span className="online-indicator"><i /> {connected ? '已連線' : '連線中…'}</span></header>
          <div className="entry-copy"><p className="eyebrow">THE CLASSIC TILE GAME</p><h1>一桌好牌，<br /><em>等你入局。</em></h1><p className="intro">和朋友開一桌拉密。分享房間代碼，他們就能用自己的手機加入。</p></div>
          <div className="entry-form">
            <label htmlFor="player-name">你的暱稱</label>
            <input id="player-name" maxLength={18} placeholder="輸入暱稱" value={name} onChange={(event) => setName(event.target.value)} />
            <button className="primary-button create-button" disabled={!connected || pending} onClick={() => enterRoom('create')}>建立新房間 <span>↗</span></button>
            <div className="join-divider"><span>或加入朋友的房間</span></div>
            <div className="join-row"><input aria-label="房間代碼" maxLength={5} placeholder="輸入 5 碼代碼" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /><button className="secondary-button" disabled={!connected || pending || code.length !== 5} onClick={() => enterRoom('join')}>加入房間</button></div>
            {connectionError && <p className="error-text" role="status">{connectionError}</p>}
            {pending && <p role="status">處理中…</p>}
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
    <main className="game-shell" style={{ '--dock-height': `${dockHeight}px` } as CSSProperties}>
      <header className="game-header"><a className="wordmark" href="/" onClick={(event) => { event.preventDefault(); localStorage.removeItem(seatStorageKey); window.location.reload() }}><span className="brand-mark">R</span><span>RUMI CLUB</span></a><div className="room-tag"><span>ROOM</span><strong>{room.code}</strong><button aria-label="複製邀請連結" title="複製邀請連結" onClick={copyRoomCode}>{linkCopied ? '✓' : '▢'}</button></div><div className="header-right"><span className="live-dot" /><span className="connection-label">{connected ? '已連線' : '離線'}</span><span className="player-total">{room.players.length} / 6</span></div></header>
      {connectionError && <div className="connection-banner" role="status">{connectionError}</div>}
      <section className="players-strip" aria-label="房間玩家">{room.players.map((player, index) => <div className={`player-seat ${room.currentPlayerId === player.id && room.started && !room.finished ? 'is-active' : ''}`} key={player.id}><span className={`seat-avatar avatar-${index % 6}`}>{player.name.slice(0, 1).toUpperCase()}</span><span className="seat-info"><strong>{player.name}{player.id === playerKey ? '（你）' : ''}</strong><small>{!player.connected ? '重新連線中' : player.isHost ? '房主' : '已加入'}</small></span>{room.started && <span className="tile-count">{player.id === playerKey ? sortedHand.length : player.count}<small>張</small></span>}</div>)}</section>
      <section className="table-area">
        {!room.started ? <div className="waiting-state"><div className="wait-mark">✳</div><p className="eyebrow">ROOM {room.code}</p><h1>朋友，<em>就等你了。</em></h1><p className="waiting-copy">分享房間代碼，等大家用手機入座。至少 2 位玩家即可開始。</p><button className="code-share" onClick={copyRoomCode}><span>房間代碼</span><strong>{room.code}</strong><small>{linkCopied ? '已複製' : '複製邀請連結'}</small></button><div className="waiting-bottom"><span>{room.players.length} 位玩家已入座</span>{isHost ? <button className="primary-button" disabled={room.players.length < 2 || !connected || pending} onClick={() => { setPending(true); socket.emit('game:start') }}>開始遊戲 <span>↗</span></button> : <span>等待房主開始遊戲</span>}</div></div> : <>
          <div className="table-heading"><div><p className="eyebrow">{room.finished ? 'GAME OVER' : isMyTurn ? 'YOUR TURN' : 'TABLE IN PLAY'}</p><h1>{room.finished ? winner ? `${winner.name} 獲勝` : '平手' : isMyTurn ? '輪到你了' : turnPlayer ? `${turnPlayer.name} 的回合` : '拉密桌'}</h1></div><div className="draw-status" ref={drawPileRef} aria-label={`牌堆剩餘 ${room.drawCount} 張`}><span>DRAW PILE</span><div className="draw-pile-visual"><span className="draw-pile-card draw-pile-card-back" /><span className="draw-pile-card draw-pile-card-mid" /><span className="draw-pile-card draw-pile-card-front" /><strong>{room.drawCount}</strong></div><small>張</small></div></div>
          <div className="table-surface">{draft.length === 0 ? <div className="empty-table"><span>✳</span><p>桌面還沒有牌組</p><small>選好手牌，排出第一組牌</small></div> : draft.map((meld, meldIndex) => <div className={`meld-panel ${!isValidMeld(meld) ? 'meld-invalid' : ''}`} key={meldIndex}>
            <div className="meld" role="group" aria-label={`第 ${meldIndex + 1} 組牌`} tabIndex={0}>{meld.map((tile) => <TileButton key={tile.id} tile={tile} selected={selected.includes(tile.id)} fresh={!tableTileIds.has(tile.id)} highlighted={room.recentTableTileIds.includes(tile.id)} disabled={!canAct || (!opened && tableTileIds.has(tile.id))} onClick={() => toggleTile(tile.id)} />)}</div>
            {!isValidMeld(meld) && <small className="meld-error">{meld.length < 3 ? '至少需要 3 張牌' : '需為同色連號或不同色同數字'}</small>}
            {canAct && selected.length > 0 && (opened || meld.every(tile => !tableTileIds.has(tile.id))) && <button className="meld-add" onClick={() => addToMeld(meldIndex)}>＋ 加入選取牌</button>}
          </div>)}</div>
          {room.finished && <div className="game-result">{room.message}<button className="secondary-button" onClick={() => { localStorage.removeItem(seatStorageKey); window.location.reload() }}>返回大廳</button></div>}
          {!room.finished && <div className="table-tools"><span role="status">{room.message}</span></div>}

        </>}
      </section>
      {room.started && !room.finished && <section className="hand-area"><div className="hand-heading"><div><p className="eyebrow">YOUR RACK</p><h2>{sortedHand.length} 張手牌</h2></div></div><div className="hand-rack" ref={handRackRef}>{handRows.map(({ key, label, color, tiles }) => <div className={`hand-color-row color-row-${color}`} key={key}><span className={`rack-color-label tile-${color}`}>{label}</span><div className="hand-color-tiles">{tiles.map((tile) => <TileButton key={tile.id} tile={tile} selected={selected.includes(tile.id)} dataTileId={tile.id} drawArriving={drawFlight?.tile.id === tile.id} disabled={!canAct} onClick={() => toggleTile(tile.id)} />)}</div></div>)}</div><div className="hand-foot"><span>{isMyTurn ? opened ? '選牌後可組成新組，或加入桌面牌組。' : '先用自己的手牌組出至少 30 點。' : '等候其他玩家完成回合'}</span><span>{room.openedPlayers.includes(playerKey) ? '已完成首次出牌' : '首次出牌需達 30 點'}</span></div></section>}
      {room.started && !room.finished && <section ref={dockRef} className="action-dock" aria-label="回合操作">
        <div className="selection-status"><span>{isMyTurn ? `已選 ${selected.length} 張` : '等待其他玩家出牌'}</span>{selected.length > 0 && <button className="text-button" onClick={() => setSelected([])}>取消選取</button>}<span className="opening-progress">{opened ? '已完成首次出牌' : `首次出牌 ${openingPoints}／30 點`}</span></div>
        {error && <p className="action-error" role="alert">{error}</p>}
        {confirmDraw && <div className="draw-confirm" role="alert"><span>摸牌會撤銷本回合排列。</span><button onClick={drawTile}>確認摸牌</button><button onClick={() => setConfirmDraw(false)}>繼續排牌</button></div>}
        {isMyTurn && <div className="tool-actions"><button className="text-button" disabled={!canAct || !draftHistory.length} onClick={undoLastDraftAction}>復原一步</button><button className="text-button" disabled={!canAct || !draftHistory.length} onClick={resetDraft}>全部重設</button><button className="secondary-button" disabled={!canAct || selected.length < 3} onClick={formMeld}>組牌（{selected.length}）</button><button className="primary-button" disabled={!canSubmit} onClick={submitTurn}>{pending ? '處理中…' : '提交出牌'}</button><button className="draw-button" disabled={!canAct} onClick={drawTile}>{room.drawCount > 0 ? '摸一張' : '略過回合'}</button></div>}
        {isMyTurn && hasNewTilesOnTable && !canSubmit && !pending && <small>{!validTable ? '請先修正桌面標示的牌組' : !opened && openingPoints < 30 ? '首次出牌至少需要 30 點' : !connected ? '重新連線後即可提交' : ''}</small>}
      </section>}
      {drawFlight && <div className="draw-flight" aria-hidden="true" style={{ left: drawFlight.left, top: drawFlight.top, '--flight-x': `${drawFlight.deltaX}px`, '--flight-y': `${drawFlight.deltaY}px` } as CSSProperties}><div className="draw-flight-card"><div className="draw-flight-face draw-flight-back" /><div className={`draw-flight-face draw-flight-front tile-${drawFlight.tile.color}`}><strong>{drawFlight.tile.color === 'joker' ? '★' : drawFlight.tile.value}</strong><small>{drawFlight.tile.color === 'joker' ? 'J' : '◆'}</small></div></div></div>}
      {error && (!room.started || room.finished) && <div className="toast-error" role="alert"><span>{error}</span><button aria-label="關閉訊息" onClick={() => setError('')}>×</button></div>}
    </main>
  )
}

function TileButton({ tile, selected, highlighted = false, fresh = false, disabled = false, dataTileId, drawArriving = false, onClick }: { tile: Tile; selected: boolean; highlighted?: boolean; fresh?: boolean; disabled?: boolean; dataTileId?: string; drawArriving?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} className={`tile tile-${tile.color} ${fresh ? 'is-fresh' : ''} ${selected ? 'is-selected' : ''} ${highlighted ? 'is-recent' : ''} ${drawArriving ? 'is-draw-arriving' : ''}`} data-tile-id={dataTileId} aria-label={tileName(tile)} aria-pressed={selected} onClick={onClick}><span>{tile.color === 'joker' ? '★' : tile.value}</span></button>
}

export default App
