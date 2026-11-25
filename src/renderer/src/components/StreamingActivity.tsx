import { useEffect, useState, type MutableRefObject } from 'react'
import type { TurnActivity as Activity } from '../../../shared/turns'
import { runTimeoutMin, RUN_CEILING } from '../runLimits'
import { Button } from './ui/Button'
import Icon from './Icon'

// The live line of a running reply (D-151, "Running meters" + "Autonomy budgets"): what it's doing,
// how long and how many steps so far, and the limits — with a warning before the quiet-timeout
// stops it, and Keep waiting to give it more time.
const dur = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}s`)
const WARN_S = 120

interface Props {
  activity: Activity
  steps?: number
  lastOutput?: MutableRefObject<number>   // when the run last wrote something (text, tool, status)
  onKeepWaiting?: () => void
}

export default function StreamingActivity({ activity, steps, lastOutput, onKeepWaiting }: Props) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const now = Date.now()
  const secs = Math.max(0, Math.floor((now - activity.startedAt) / 1000))
  const limitMin = runTimeoutMin()
  const quiet = lastOutput ? Math.floor((now - lastOutput.current) / 1000) : 0
  const left = limitMin > 0 ? limitMin * 60 - quiet : Infinity
  const near = left <= WARN_S && left > 0
  return (
    <div className={`activity${near ? ' near-limit' : ''}`}>
      <div className="activity-row">
        <span className="activity-spinner" />
        <span key={activity.label} className="activity-label">{activity.label}</span>
        <span className="activity-time">{dur(secs)}{steps ? ` · ${steps} step${steps === 1 ? '' : 's'}` : ''}</span>
      </div>
      {near
        ? <div className="activity-warn"><Icon name="clock" size="xs" /> No output for {Math.floor(quiet / 60)} min — stops in {Math.max(1, Math.ceil(left / 60))} min{onKeepWaiting && <Button size="sm" onClick={() => { if (lastOutput) lastOutput.current = Date.now(); onKeepWaiting() }}>Keep waiting</Button>}</div>
        : limitMin > 0 && secs >= 60 && <div className="activity-limit">Stops after {limitMin} min without output · {limitMin * RUN_CEILING} min at most</div>}
    </div>
  )
}
