import { useEffect, useId, useState } from 'react'
import './TurnHourglass.css'

export function TurnHourglass({ deadline, serverNow }: { deadline: number; serverNow: number }) {
  const clipId = useId()
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - serverNow))
  useEffect(() => {
    const receivedAt = performance.now()
    const update = () => setRemaining(Math.max(0, deadline - serverNow - (performance.now() - receivedAt)))
    const timer = window.setInterval(update, 100)
    update()
    return () => window.clearInterval(timer)
  }, [deadline, serverNow])
  const seconds = Math.ceil(remaining / 1000)
  const fraction = Math.min(1, remaining / 180000)
  return <div className={`turn-hourglass ${seconds <= 30 ? 'is-urgent' : ''}`}>
    <svg viewBox="0 0 64 88" aria-hidden="true">
      <defs><clipPath id={clipId}><path d="M12 10H52C52 28 43 35 34 44C43 53 52 60 52 78H12C12 60 21 53 30 44C21 35 12 28 12 10Z" /></clipPath></defs>
      <g clipPath={`url(#${clipId})`} className="hourglass-sand">
        <rect x="12" y={44 - 34 * fraction} width="40" height={34 * fraction} />
        <rect x="12" y={78 - 34 * (1 - fraction)} width="40" height={34 * (1 - fraction)} />
        {seconds > 0 && <path className="sand-stream" d="M32 43V78" />}
      </g>
      <path className="hourglass-glass" d="M12 10H52C52 28 43 35 34 44C43 53 52 60 52 78H12C12 60 21 53 30 44C21 35 12 28 12 10Z" />
      <path className="hourglass-frame" d="M8 7H56M8 81H56" />
    </svg>
    <div><span>本回合剩餘</span><strong role="timer" aria-label={`本回合剩餘 ${seconds} 秒`}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</strong><small>{seconds === 0 ? '時間到' : '3 分鐘沙漏'}</small></div>
  </div>
}
