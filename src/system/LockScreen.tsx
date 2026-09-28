import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const unlock = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === 'Escape') onUnlock()
    }
    window.addEventListener('keydown', unlock)
    return () => window.removeEventListener('keydown', unlock)
  }, [onUnlock])
  return <section className="lock-screen" aria-label="Lock screen">
    <div className="lock-content">
      <time className="lock-clock">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>
      <div className="lock-date">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <div className="lock-user">
        <div className="lock-avatar" aria-hidden="true">M</div>
        <strong>Mac User</strong>
        <button className="lock-unlock" onClick={onUnlock}>Click to unlock <ChevronRight size={15} /></button>
      </div>
    </div>
    <footer className="lock-footer"><span>Mac-NO-S</span><span>Press Enter to continue</span></footer>
  </section>
}
