import { useEffect, useMemo, useRef, useState } from 'react'
import { rankFileNames } from '../../../shared/fileNameSearch'
import { api } from '../api'
import FileTree, { type FileSort } from './FileTree'
import MarkdownDoc from './MarkdownDoc'
import FilePreview, { normalizePath } from './FilePreview'
import { kindOf } from '../fileKinds'
import MasterDetail from './MasterDetail'
import Icon from './Icon'
import type { FileNode, FileChange, FileSearchResult } from '../../../shared/types'
import { IconButton } from './ui/Button'

interface Props {
  root: string
  onBack: () => void
}

// Split a line around the query so the match can be emphasised (case-insensitive).
// Mark every query word in a file name (words may be separated by - _ . or spaces).
function highlightWords(text: string, q: string) {
  const words = q.toLowerCase().split(/[-_.\s]+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!words.length) return text
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'))
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>
}

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0 || !q) return text
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export default function FilesView({ root, onBack }: Props) {
  const [tree, setTree] = useState<FileNode | null>(null)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [jump, setJump] = useState<{ line: number; nonce: number } | null>(null)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<FileSort>('name')
  const [hits, setHits] = useState<FileSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  // per-file change tokens so an open doc knows when *it* changed on disk
  const [changeTokens, setChangeTokens] = useState<Record<string, number>>({})
  const activeRef = useRef<string | null>(null)
  activeRef.current = activePath

  const refreshTree = async () => setTree(await api.files.listTree(root))

  useEffect(() => {
    refreshTree()
    api.files.watchStart(root)
    const off = api.files.onChanged((c: FileChange) => {
      refreshTree()
      if (c.relPath) setChangeTokens((m) => ({ ...m, [c.relPath]: (m[c.relPath] ?? 0) + 1 }))
    })
    return () => { off(); api.files.watchStop() }
    /* eslint-disable-next-line */
  }, [root])

  // Debounced full-text search across the folder as the query changes.
  const q = filter.trim()
  useEffect(() => {
    if (q.length < 2) { setHits([]); setSearching(false); return }
    setSearching(true)
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await api.files.search(root, q)
        if (!cancelled) setHits(r)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
    /* eslint-disable-next-line */
  }, [q, root])

  // A link inside a previewed file (relative to that file, or an absolute path in the project).
  const openLink = (href: string) => {
    let h = href
    if (h.startsWith(root + '/')) h = h.slice(root.length + 1)
    else if (!h.startsWith('/') && activePath) {
      const dir = activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/')) : ''
      h = normalizePath(dir ? `${dir}/${h}` : h)
    }
    setActivePath(h); setJump(null)
  }

  const hitCount = hits.reduce((n, r) => n + r.hits.length, 0)

  // File-name matches (D-069), ranked, from the already-loaded tree — every file type,
  // not just text. Content matches follow below.
  const allFiles = useMemo(() => {
    const out: string[] = []
    const walk = (n: FileNode) => { if (n.type === 'file') out.push(n.relPath); else (n.children ?? []).forEach(walk) }
    if (tree) walk(tree)
    return out
  }, [tree])
  const nameHits = useMemo(() => (q.length >= 2 ? rankFileNames(allFiles, q, 30) : []), [allFiles, q])

  return (
    <MasterDetail
      contentClassName="files-doc-content"
      listHeader={
        <>
          <IconButton className="files-back" title="Back to project" onClick={onBack}><Icon name="chevron-down" size="md" className="rot90" /></IconButton>
          <div className="files-filter">
            <Icon name="search" size="sm" className="files-filter-ico" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search file names and contents…" spellCheck={false} />
            {filter && (
              <IconButton className="files-filter-clear" title="Clear" onClick={() => setFilter('')}><Icon name="close" size="xs" /></IconButton>
            )}
          </div>
          <div className="files-sort" role="tablist" aria-label="Sort files">
            <button className={sort === 'name' ? 'active' : ''} onClick={() => setSort('name')}>Name</button>
            <button className={sort === 'modified' ? 'active' : ''} onClick={() => setSort('modified')}>Modified</button>
          </div>
        </>
      }
      list={
        <>
          {q.length >= 2 && (
            <div className="file-search">
              <div className="file-search-head">File names · {nameHits.length === 0 ? 'no matches' : nameHits.length >= 30 ? 'top 30' : nameHits.length}</div>
              {nameHits.map((m) => {
                const name = m.relPath.split('/').pop() || m.relPath
                const dir = m.relPath.slice(0, m.relPath.length - name.length).replace(/\/$/, '')
                return (
                  <button key={m.relPath} className={`file-search-name ${activePath === m.relPath ? 'active' : ''}`} onClick={() => { setActivePath(m.relPath); setJump(null) }} title={m.relPath}>
                    <Icon name="file" size="sm" className="tree-ico" />
                    <span className="file-search-name-main truncate">{highlightWords(name, q)}</span>
                    {dir && <span className="file-search-name-dir truncate">{dir}</span>}
                  </button>
                )
              })}
              <div className="file-search-head file-search-head-contents">
                In file contents · {searching ? 'searching…' : `${hitCount} match${hitCount === 1 ? '' : 'es'} in ${hits.length} file${hits.length === 1 ? '' : 's'}`}
              </div>
              {hits.map((r) => (
                <div key={r.relPath} className="file-search-group">
                  <div className={`file-search-file truncate ${activePath === r.relPath ? 'active' : ''}`} title={r.relPath}>{r.relPath}</div>
                  {r.hits.map((h, i) => (
                    <button key={i} className="file-search-hit" onClick={() => { setActivePath(r.relPath); setJump({ line: h.line, nonce: Date.now() }) }} title={h.text}>
                      <span className="file-search-line">{h.line}</span>
                      <span className="file-search-snippet truncate">{highlight(h.text, q)}</span>
                    </button>
                  ))}
                </div>
              ))}
              {!searching && hits.length === 0 && <div className="file-search-empty">No content matches</div>}
            </div>
          )}
          {tree && q.length < 2 && <FileTree node={tree} isRoot loadRoot={root} activePath={activePath} onOpenFile={(p) => { setActivePath(p); setJump(null) }} filter={filter} sort={sort} />}
        </>
      }
    >
      {activePath ? (
        // Markdown and text open in the editor (edit, save, jump to a search hit); every other
        // kind uses the artifact viewer's preview, and unsupported files say so (no raw bytes).
        kindOf(activePath) === 'md' || kindOf(activePath) === 'text' ? (
          <MarkdownDoc root={root} relPath={activePath} externalChangeToken={changeTokens[activePath] ?? 0} jumpTo={jump} />
        ) : (
          <div className="doc">
            <div className="doc-toolbar">
              <span className="doc-path truncate">{activePath}</span>
              <div className="doc-actions">
                <IconButton title="Show in Finder" onClick={() => api.system.revealItem(root, activePath)}><Icon name="folder-open" size="md" /></IconButton>
                <IconButton title="Open in default app" onClick={() => api.system.openItem(root, activePath)}><Icon name="external" size="md" /></IconButton>
              </div>
            </div>
            <div className="doc-preview-file" key={`${activePath}:${changeTokens[activePath] ?? 0}`}>
              <FilePreview root={root} relPath={activePath} onOpenLink={(href) => openLink(href)} />
            </div>
          </div>
        )
      ) : (
        <div className="md-placeholder">Select a file to view it.</div>
      )}
    </MasterDetail>
  )
}
