// Advance game deadlines only; Socket.io heartbeat/network timers keep real time.
import { mock } from 'node:test'
mock.timers.enable({ apis: ['Date'], now: 1000000 })
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const gameTimers = new Map<ReturnType<typeof setTimeout>, { at: number; run: () => void }>()
globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
  const handle = realSetTimeout(callback, delay, ...args)
  if (delay === 180000) gameTimers.set(handle, { at: Date.now() + delay, run: () => callback(...args) })
  return handle
}) as typeof setTimeout
globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
  gameTimers.delete(handle)
  realClearTimeout(handle)
}) as typeof clearTimeout
process.stdin.setEncoding('utf8')
let buffer = ''
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n')
    const delta = Number(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    mock.timers.setTime(Date.now() + delta)
    for (const [handle, timer] of [...gameTimers]) {
      if (timer.at <= Date.now()) {
        gameTimers.delete(handle)
        realClearTimeout(handle)
        timer.run()
      }
    }
  }
})
