import { useEffect, useState } from 'react'
import type { TurnActivity as Activity } from '../../../shared/turns'

export default function StreamingActivity({ activity }: { activity: Activity }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const secs = Math.max(0, Math.floor((Date.now() - activity.startedAt) / 1000))
  return (
    <div className="activity">
      <span className="activity-spinner" />
      <span key={activity.label} className="activity-label">{activity.label}</span>
      <span className="activity-time">{secs}s</span>
    </div>
  )
}
