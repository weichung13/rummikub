export type TileColor = 'red' | 'blue' | 'yellow' | 'black'

export type Tile = {
  id: string
  color: TileColor | 'joker'
  value: number
}

export type Meld = Tile[]

export type PlayerView = {
  id: string
  name: string
  count: number
  isHost: boolean
  connected: boolean
}

export type GameView = {
  code: string
  players: PlayerView[]
  hand: Tile[]
  table: Meld[]
  currentPlayerId: string | null
  started: boolean
  finished: boolean
  winnerId: string | null
  drawCount: number
  message: string
  openedPlayers: string[]
  drawnTile: Tile | null
}

export const colors: TileColor[] = ['red', 'blue', 'yellow', 'black']

export function isValidMeld(meld: Meld): boolean {
  if (meld.length < 3) return false

  const numbered = meld.filter((tile) => tile.color !== 'joker')
  const jokers = meld.length - numbered.length
  if (numbered.length === 0) return false

  const sameValue = numbered.every((tile) => tile.value === numbered[0].value)
  if (sameValue && numbered.length + jokers <= 4) {
    const uniqueColors = new Set(numbered.map((tile) => tile.color))
    if (uniqueColors.size === numbered.length) return true
  }

  const sameColor = numbered.every((tile) => tile.color === numbered[0].color)
  if (!sameColor) return false
  const values = numbered.map((tile) => tile.value).sort((a, b) => a - b)
  if (new Set(values).size !== values.length) return false
  for (let start = 1; start + meld.length - 1 <= 13; start += 1) {
    const end = start + meld.length - 1
    if (values.every((value) => value >= start && value <= end)) return true
  }
  return false
}

export function orderMeld(meld: Meld): Meld {
  const numbered = meld.filter((tile) => tile.color !== 'joker')
  const jokers = meld.filter((tile) => tile.color === 'joker')
  const sameColor = numbered.length > 0 && numbered.every((tile) => tile.color === numbered[0].color)
  const values = numbered.map((tile) => tile.value)

  if (sameColor && new Set(values).size === values.length) {
    let bestRun: Tile[] | null = null
    let bestValue = -1
    for (let start = 1; start + meld.length - 1 <= 13; start += 1) {
      const run = Array.from({ length: meld.length }, (_, index) => start + index)
      if (!values.every((value) => run.includes(value)) || run.length - numbered.length !== jokers.length) continue
      let jokerIndex = 0
      const ordered = run.map((value) => numbered.find((tile) => tile.value === value) ?? jokers[jokerIndex++])
      const value = run.reduce((sum, number) => sum + number, 0)
      if (value > bestValue) {
        bestRun = ordered as Tile[]
        bestValue = value
      }
    }
    if (bestRun) return bestRun
    return [...meld].sort((left, right) => left.value - right.value)
  }

  const sameValue = numbered.length > 0 && numbered.every((tile) => tile.value === numbered[0].value)
  if (sameValue) {
    return [...numbered].sort((left, right) => colors.indexOf(left.color as TileColor) - colors.indexOf(right.color as TileColor)).concat(jokers)
  }
  return [...meld]
}

export function meldValue(meld: Meld): number {
  const numbered = meld.filter((tile) => tile.color !== 'joker')
  const sameValue = numbered.every((tile) => tile.value === numbered[0]?.value)
  if (sameValue) return meld.length * numbered[0].value

  let highestValue = 0
  for (let start = 1; start + meld.length - 1 <= 13; start += 1) {
    const end = start + meld.length - 1
    if (numbered.every((tile) => tile.value >= start && tile.value <= end)) {
      highestValue = Math.max(highestValue, (start + end) * meld.length / 2)
    }
  }
  return highestValue
}

export function createDeck(copies: number): Tile[] {
  const deck: Tile[] = []
  for (let copy = 0; copy < copies; copy += 1) {
    for (const color of colors) {
      for (let value = 1; value <= 13; value += 1) {
        deck.push({ id: `${copy}-${color}-${value}`, color, value })
      }
    }
  }
  const jokerCount = copies === 2 ? 2 : 4
  for (let index = 0; index < jokerCount; index += 1) {
    deck.push({ id: `joker-${index}`, color: 'joker', value: 30 })
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]]
  }
  return deck
}