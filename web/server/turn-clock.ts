export const TURN_DURATION_MS = 180_000
export type TimedRoom = { timerEnabled: boolean; turnDeadline: number | null; started: boolean; finished: boolean }

/** One deadline per room. Reconnection/presence updates never restart this clock. */
export class TurnClock<T extends TimedRoom> {
  private timers = new Map<T, ReturnType<typeof setTimeout>>()
  private readonly expire: (room: T) => void
  constructor(expire: (room: T) => void) { this.expire = expire }

  stop(room: T): void {
    const timer = this.timers.get(room)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(room)
    room.turnDeadline = null
  }

  start(room: T): void {
    this.stop(room)
    if (!room.timerEnabled || !room.started || room.finished) return
    room.turnDeadline = Date.now() + TURN_DURATION_MS
    const deadline = room.turnDeadline
    const check = () => {
      if (room.turnDeadline !== deadline) return
      this.timers.delete(room)
      if (!this.expireIfDue(room)) {
        this.timers.set(room, setTimeout(check, Math.max(1, deadline - Date.now())))
      }
    }
    this.timers.set(room, setTimeout(check, TURN_DURATION_MS))
  }

  expireIfDue(room: T): boolean {
    if (!room.timerEnabled || !room.started || room.finished || room.turnDeadline === null || Date.now() < room.turnDeadline) return false
    this.stop(room)
    this.expire(room)
    return true
  }
}
