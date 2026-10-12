import { useEffect, useMemo, useRef, useState } from 'react'
import { rankFileNames } from '../../../shared/fileNameSearch'
import { api } from '../api'
import FileTree, { type FileSort } from './FileTree'
import MarkdownDoc from './MarkdownDoc'
import MasterDetail from './MasterDetail'
import Icon from './Icon'
import type { FileNode, FileChange, FileSearchResult } from '../../../shared/types'

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
          <button className="icon-btn files-back" title="Back to project" onClick={onBack}><Icon name="chevron-down" size={16} className="rot90" /></button>
          <div className="files-filter">
            <Icon name="search" size={13} className="files-filter-ico" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search file names and contents…" spellCheck={false} />
            {filter && (
              <button className="icon-btn files-filter-clear" title="Clear" onClick={() => setFilter('')}><Icon name="close" size={12} /></button>
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
                    <Icon name="file" size={13} className="tree-ico" />
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
        <MarkdownDoc root={root} relPath={activePath} externalChangeToken={changeTokens[activePath] ?? 0} jumpTo={jump} />
      ) : (
        <div className="md-placeholder">Select a file to view it.</div>
      )}
    </MasterDetail>
  )
}
