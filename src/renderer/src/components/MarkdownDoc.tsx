import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'

interface Props {
  root: string
  relPath: string
  // bumps when the watcher reports this file changed on disk
  externalChangeToken: number
  // when set (from a search hit), jump to this 1-based line; nonce forces re-jump
  jumpTo?: { line: number; nonce: number } | null
}

export default function MarkdownDoc({ root, relPath, externalChangeToken, jumpTo }: Props) {
  const [content, setContent] = useState('')
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [externalWhileEditing, setExternalWhileEditing] = useState(false)
  const isMd = /\.(md|markdown)$/i.test(relPath)
  const lastLoaded = useRef(0)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const plainRef = useRef<HTMLPreElement>(null)

  const load = async () => {
    const text = await api.files.readFile(root, relPath)
    setContent(text)
    setDraft(text)
    setDirty(false)
    setExternalWhileEditing(false)
  }

  // load on file switch
  useEffect(() => { setMode('preview'); load() /* eslint-disable-next-line */ }, [root, relPath])

  // react to external disk changes
  useEffect(() => {
    if (externalChangeToken === lastLoaded.current) return
    lastLoaded.current = externalChangeToken
    if (externalChangeToken === 0) return
    if (mode === 'edit' && dirty) { setExternalWhileEditing(true); return }
    load()
    /* eslint-disable-next-line */
  }, [externalChangeToken])

  // jump to a line from a search hit — md opens Edit and selects the line; plain scrolls to it.
  // Retries across frames because the file content loads asynchronously.
  useEffect(() => {
    if (!jumpTo?.line) return
    const line = jumpTo.line
    if (isMd) setMode('edit')
    let tries = 0
    let raf = 0
    const apply = (): boolean => {
      if (isMd) {
        const ta = editorRef.current
        if (!ta || !ta.value) return false
        const lines = ta.value.split('\n')
        let start = 0
        for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1
        const end = start + (lines[Math.min(line, lines.length) - 1]?.length ?? 0)
        ta.focus()
        try { ta.setSelectionRange(start, end) } catch { /* ignore */ }
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20
        ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight / 2)
        return true
      }
      const pre = plainRef.current
      if (!pre) return false
      const lh = parseFloat(getComputedStyle(pre).lineHeight) || 18
      pre.scrollTop = Math.max(0, (line - 1) * lh - pre.clientHeight / 2)
      return true
    }
    const tick = () => { if (!apply() && tries++ < 30) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    /* eslint-disable-next-line */
  }, [jumpTo?.nonce])

  const save = async () => {
    await api.files.writeFile(root, relPath, draft)
    setContent(draft)
    setDirty(false)
    setSavedAt(Date.now())
    setExternalWhileEditing(false)
  }

  return (
    <div className="doc">
      <div className="doc-toolbar">
        <span className="doc-path truncate">{relPath}</span>
        <div className="doc-actions">
          {isMd && (
            <div className="seg">
              <button className={mode === 'preview' ? 'seg-on' : ''} onClick={() => setMode('preview')}>Preview</button>
              <button className={mode === 'edit' ? 'seg-on' : ''} onClick={() => setMode('edit')}>Edit</button>
            </div>
          )}
          {mode === 'edit' && (
            <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={save}>Save</button>
          )}
        </div>
      </div>

      {externalWhileEditing && (
        <div className="doc-banner">
          This file changed on disk while you were editing.
          <button className="link-btn" onClick={load}>Reload &amp; discard my changes</button>
        </div>
      )}

      {mode === 'preview' || !isMd ? (
        isMd ? (
          <div className="doc-preview markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <pre className="doc-plain" ref={plainRef}>{content}</pre>
        )
      ) : (
        <textarea
          ref={editorRef}
          className="doc-editor"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setDirty(e.target.value !== content) }}
          spellCheck={false}
        />
      )}

      <div className="doc-status">
        {dirty ? 'Unsaved changes' : savedAt ? 'Saved' : ''}
      </div>
    </div>
  )
}
