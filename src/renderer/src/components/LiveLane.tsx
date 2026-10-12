import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TurnLane } from '../../../shared/turns'
import { laneRenderDelay } from '../liveText'
import StreamingActivity from './StreamingActivity'
import ProviderAvatar from './ProviderAvatar'
import MessageMarkdown from './MessageMarkdown'

interface Props {
  lane: TurnLane
  name: string
  root?: string
  onOpenArtifact?: (rel: string) => void
  onOpenMedia?: (rel: string) => void
}

/** The text to render for a streaming lane, throttled by what rendering it costs (D-098). */
function useThrottledText(text: string, done: boolean): { shown: string; markRendered: (ms: number) => void } {
  const [shown, setShown] = useState(text)
  const latest = useRef(text); latest.current = text
  const lastAt = useRef(0); const cost = useRef(0)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (text === shown) return
    const flush = () => { timer.current = null; lastAt.current = performance.now(); setShown(latest.current) }
    // Done, or a different reply in this slot (next agent in a chain): show it now (D-100).
    if (done || !text.startsWith(shown)) { if (timer.current !== null) clearTimeout(timer.current); flush(); return }
    if (timer.current !== null) return
    const wait = laneRenderDelay(cost.current) - (performance.now() - lastAt.current)
    if (wait <= 0) flush(); else timer.current = window.setTimeout(flush, wait)
  }, [text, done, shown])
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
  return { shown, markRendered: (ms) => { cost.current = ms } }
}

function LiveLane({ lane, name, root, onOpenArtifact, onOpenMedia }: Props) {
  const { shown, markRendered } = useThrottledText(lane.text, lane.done)
  const started = performance.now()
  // Render + commit time of this lane, which is almost all markdown parsing.
  useLayoutEffect(() => { markRendered(performance.now() - started) }, [shown])   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="msg msg-assistant">
      <div className="msg-author"><ProviderAvatar id={lane.provider} /><span>{name}</span></div>
      {lane.activity && <StreamingActivity activity={lane.activity} />}
      {shown && (
        <div className="msg-body markdown-body stream-body">
          <MessageMarkdown onOpenArtifact={onOpenArtifact} onOpenMedia={onOpenMedia} root={root}>{shown}</MessageMarkdown>
          {!lane.done && <span className="stream-spider" aria-hidden="true">🕷️</span>}
        </div>
      )}
    </div>
  )
}

export default memo(LiveLane)
