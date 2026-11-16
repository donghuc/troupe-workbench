import { createContext, useContext, useState, type ReactNode } from 'react'
import { parseBlock, answerText, answerComplete, type ReplyBlock, type StepsBlock, type ChoicesBlock, type SourcesBlock } from '../../../shared/replyBlocks'
import { Button } from './ui/Button'

// Reply blocks (D-149): `troupe-<kind>` code blocks in a reply drawn as components. The chat
// provides this context while blocks are on; without it (setting off, docs, file previews)
// MessageMarkdown leaves them as code.
export interface ReplyBlocksCtx {
  /** Saved answers to choices blocks, by `${messageId}#${blockId}`. */
  answers: ReadonlyMap<string, string[][]>
  /** Send a choices answer as the user's next message. */
  answer: (messageId: string, blockId: string, text: string, values: string[][]) => void
}
export const ReplyBlocksContext = createContext<ReplyBlocksCtx | null>(null)
export const useReplyBlocks = (): ReplyBlocksCtx | null => useContext(ReplyBlocksContext)

const KIND_LABEL: Record<string, string> = { steps: 'steps', choices: 'questions', sources: 'sources' }

interface Props {
  kind: string
  raw: string
  messageId: string
  live: boolean
  /** The block as an ordinary code block (shown when it doesn't pass). */
  fallback: ReactNode
  /** Inline markdown for step bodies, with the reply's own link handling. */
  renderMd: (text: string) => ReactNode
}

export default function ReplyBlockView({ kind, raw, messageId, live, fallback, renderMd }: Props) {
  const r = parseBlock(kind, raw)
  if (!r.ok) {
    // Still arriving: the fence is open, so the JSON is cut off — not a mistake yet.
    if (live) return <div className="rb rb-pending" role="status"><span className="activity-spinner spinner-xs" /> Preparing {KIND_LABEL[kind] ?? 'a block'}…</div>
    return <>{fallback}<div className="rb-invalid" title={r.problem}>Couldn’t show this block ({r.problem}).</div></>
  }
  return <Block block={r.block} messageId={messageId} live={live} renderMd={renderMd} />
}

function Block({ block, messageId, live, renderMd }: { block: ReplyBlock; messageId: string; live: boolean; renderMd: Props['renderMd'] }) {
  if (block.kind === 'steps') return <Steps b={block} renderMd={renderMd} />
  if (block.kind === 'sources') return <Sources b={block} />
  return <Choices b={block} messageId={messageId} live={live} />
}

function Steps({ b, renderMd }: { b: StepsBlock; renderMd: Props['renderMd'] }) {
  return (
    <div className="rb rb-steps">
      {b.title && <div className="rb-title">{b.title}</div>}
      <ol className="rb-step-list">
        {b.steps.map((s, i) => (
          <li key={i} className="rb-step">
            <span className="rb-step-num" aria-hidden>{i + 1}</span>
            <div className="rb-step-text">
              <div className="rb-step-title">{s.title}</div>
              {s.body && <div className="rb-step-body">{renderMd(s.body)}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

const hostOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

function Sources({ b }: { b: SourcesBlock }) {
  return (
    <div className="rb rb-sources" aria-label="Sources">
      {b.sources.map((s, i) => (
        <a key={i} className="rb-source" href={s.url} target="_blank" rel="noreferrer" title={`${s.title}\n${s.url}`}>
          <span className="rb-source-title truncate">{s.title}</span>
          <span className="rb-source-host">{hostOf(s.url)}</span>
        </a>
      ))}
    </div>
  )
}

function Choices({ b, messageId, live }: { b: ChoicesBlock; messageId: string; live: boolean }) {
  const ctx = useReplyBlocks()
  const saved = ctx?.answers.get(`${messageId}#${b.id}`)
  const [values, setValues] = useState<string[][]>(() => b.groups.map(() => []))
  const [sent, setSent] = useState(false)
  const locked = sent || live || !ctx
  const pick = (gi: number, opt: string, multi: boolean) => setValues((v) => v.map((cur, i) => {
    if (i !== gi) return cur
    if (!multi) return [opt]
    return cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt]
  }))
  const ready = answerComplete(b, values)
  const submit = () => {
    if (!ctx || !ready || locked) return
    setSent(true)
    ctx.answer(messageId, b.id, answerText(b, values), values)
  }
  // Answered: what was chosen, not the form again.
  if (saved) return (
    <div className="rb rb-choices answered">
      {b.title && <div className="rb-title">{b.title}</div>}
      <dl className="rb-answers">
        {b.groups.map((g, gi) => <div key={gi} className="rb-answer"><dt>{g.label}</dt><dd>{(saved[gi] ?? []).join(', ') || '—'}</dd></div>)}
      </dl>
      <span className="rb-done">Answered</span>
    </div>
  )
  return (
    <div className="rb rb-choices">
      {b.title && <div className="rb-title">{b.title}</div>}
      {b.intro && <div className="rb-intro">{b.intro}</div>}
      {b.groups.map((g, gi) => (
        <div key={gi} className="rb-group" role={g.multi ? 'group' : 'radiogroup'} aria-labelledby={`${messageId}-${b.id}-${gi}-l`}>
          <div className="rb-group-label" id={`${messageId}-${b.id}-${gi}-l`}>{g.label}{g.multi && <span className="rb-group-hint"> · choose any</span>}</div>
          {g.options.map((o) => (
            <label key={o} className={`rb-option${locked ? ' locked' : ''}`}>
              <input type={g.multi ? 'checkbox' : 'radio'} name={`${messageId}-${b.id}-${gi}`} disabled={locked} checked={(values[gi] ?? []).includes(o)} onChange={() => pick(gi, o, !!g.multi)} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      ))}
      <div className="rb-actions">
        <Button size="sm" variant="primary" disabled={locked || !ready} onClick={submit} title={live ? 'Answer when the reply has finished' : !ready ? 'Answer every question first' : undefined}>{sent ? 'Sent' : b.submit}</Button>
      </div>
      {b.note && <div className="rb-note">{b.note}</div>}
    </div>
  )
}
