type Entry = { timerEnabled?: boolean; name: string; code?: string; token?: string; reconnect?: boolean }
export function validEntry(value: unknown, joining: boolean): value is Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  return typeof entry.name === 'string' && entry.name.trim().length > 0 && entry.name.length <= 18
    && (!joining || (typeof entry.code === 'string' && /^[A-Z2-9]{5}$/i.test(entry.code)))
    && (entry.token === undefined || (typeof entry.token === 'string' && /^[a-f0-9]{64}$/.test(entry.token)))
    && (entry.timerEnabled === undefined || typeof entry.timerEnabled === 'boolean')
    && (entry.reconnect === undefined || typeof entry.reconnect === 'boolean')
}
export function validSubmission(value: unknown): value is { id: string }[][] {
  return Array.isArray(value) && value.length <= 53 && value.every(meld =>
    Array.isArray(meld) && meld.length >= 3 && meld.length <= 13 && meld.every(tile =>
      tile !== null && typeof tile === 'object' && typeof tile.id === 'string' && tile.id.length <= 64))
    && value.reduce((total, meld) => total + meld.length, 0) <= 160
}
