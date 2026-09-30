import { isValidMeld, meldValue, type Meld, type Tile } from '../src/game.js'

export function validateTurn(table: Meld[], hand: Tile[], opened: boolean, submitted: { id: string }[][]): { error: string } | { canonical: Meld[]; addedIds: string[]; newIds: string[] } {
  const oldIds = table.flat().map((tile) => tile.id)
  const knownTiles = new Map([...table.flat(), ...hand].map((tile) => [tile.id, tile]))
  const candidate = submitted.map((meld) => meld.map((tile) => knownTiles.get(tile.id)))
  if (candidate.flat().some((tile) => !tile) || candidate.some((meld) => !isValidMeld(meld as Tile[]))) {
    return { error: '桌面有不合法的牌組，請檢查順子或同數字組。' }
  }
  const canonical = candidate as Meld[]
  const newIds = canonical.flat().map((tile) => tile.id)
  if (new Set(newIds).size !== newIds.length || oldIds.some((id) => !newIds.includes(id))) {
    return { error: '桌面原有的牌必須全部留在合法牌組中。' }
  }
  const handIds = new Set(hand.map((tile) => tile.id))
  const addedIds = newIds.filter((id) => !oldIds.includes(id))
  if (addedIds.length === 0 || addedIds.some((id) => !handIds.has(id))) {
    return { error: '請在桌面牌組中使用至少一張自己的手牌。' }
  }
  if (!opened) {
    const previousMelds = table.map((meld) => meld.map((tile) => tile.id).sort().join('|'))
    const unchanged = previousMelds.every((ids) => canonical.some((meld) => meld.map((tile) => tile.id).sort().join('|') === ids))
    const newMelds = canonical.filter((meld) => !previousMelds.includes(meld.map((tile) => tile.id).sort().join('|')))
    if (!unchanged || newMelds.some((meld) => meld.some((tile) => !handIds.has(tile.id)))) {
      return { error: '完成首次出牌前，不能重組桌面上其他玩家的牌組。' }
    }
    const total = newMelds.reduce((sum, meld) => sum + meldValue(meld), 0)
    if (total < 30) return { error: `首次出牌需要至少 30 點，目前是 ${total} 點。` }
  }

  return { canonical, addedIds, newIds }
}
