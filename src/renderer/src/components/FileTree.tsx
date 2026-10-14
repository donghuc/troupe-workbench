import { useEffect, useState } from 'react'
import type { FileNode } from '../../../shared/types'
import Icon, { type IconName } from './Icon'
import { api } from '../api'
import { Button } from './ui/Button'
import { kindOf } from '../fileKinds'

export type FileSort = 'name' | 'modified'

interface Props {
  node: FileNode
  activePath: string | null
  onOpenFile: (relPath: string) => void
  filter?: string
  sort?: FileSort
  depth?: number
  isRoot?: boolean
  // Project folder, so a folder the walk skipped (D-068) can be loaded on request.
  loadRoot?: string
}

function fileIcon(name: string): IconName {
  const k = kindOf(name)
  if (k === 'image') return 'image'
  if (k === 'video') return 'film'
  if (k === 'html') return 'globe'
  return 'file'
}

// Does this node (or any descendant) match the filter? Empty filter matches all.
function hasMatch(node: FileNode, f: string): boolean {
  if (!f) return true
  if (node.type === 'file') return node.name.toLowerCase().includes(f)
  return (node.children ?? []).some((c) => hasMatch(c, f))
}

// Sort: directories first (alpha), then files (alpha, or by mtime desc when sorting by modified).
function sortChildren(children: FileNode[], sort: FileSort): FileNode[] {
  const dirs = children.filter((c) => c.type === 'dir').sort((a, b) => a.name.localeCompare(b.name))
  const files = children.filter((c) => c.type === 'file').sort((a, b) =>
    sort === 'modified' ? (b.mtime ?? 0) - (a.mtime ?? 0) : a.name.localeCompare(b.name)
  )
  return [...dirs, ...files]
}

const SKIP_TEXT: Record<NonNullable<FileNode['truncated']>, string> = {
  heavy: 'Generated folder or bundle — not listed',
  depth: 'Deeply nested — not listed',
  limit: 'Folder is large — the rest isn’t listed'
}

export default function FileTree({ node, activePath, onOpenFile, filter = '', sort = 'name', depth = 0, isRoot = false, loadRoot }: Props) {
  // Contents of a skipped folder, once loaded on request.
  const [loaded, setLoaded] = useState<FileNode | null>(null)
  const [loading, setLoading] = useState(false)
  const loadContents = async () => {
    if (!loadRoot || loading) return
    setLoading(true)
    try { setLoaded(await api.files.listTree(loadRoot, node.relPath)) } catch { /* leave as skipped */ } finally { setLoading(false) }
  }
  const f = filter.trim().toLowerCase()
  // Folders start closed (like Finder's list view), except the ones holding the open file.
  const holdsActive = node.type === 'dir' && !!activePath && !!node.relPath && activePath.startsWith(node.relPath + '/')
  const [openState, setOpenState] = useState(holdsActive)
  // Opening a file from search (or a link) reveals it: open its folders.
  useEffect(() => { if (holdsActive) setOpenState(true) }, [holdsActive, activePath])
  // While filtering, force directories open so matches are visible.
  const open = f ? true : openState

  if (node.type === 'file') {
    return (
      <button
        className={`tree-row tree-file ${activePath === node.relPath ? 'active' : ''}`}
        style={{ paddingLeft: `calc(var(--sp-2) + ${depth} * var(--tree-indent))` }}
        onClick={() => onOpenFile(node.relPath)}
        title={node.name}
      >
        <Icon name={fileIcon(node.name)} size="sm" className="tree-ico" />
        <span className="truncate">{node.name}</span>
      </button>
    )
  }

  // dir (root has relPath '')
  const source = loaded ?? node
  const skipped = !loaded && node.truncated
  const children = sortChildren((source.children ?? []).filter((c) => hasMatch(c, f)), sort)

  if (isRoot) {
    return (
      <div className="tree-root">
        {children.map((c) => (
          <FileTree key={c.relPath} node={c} activePath={activePath} onOpenFile={onOpenFile} filter={filter} sort={sort} depth={0} loadRoot={loadRoot} />
        ))}
        {children.length === 0 && <div className="tree-empty">{f ? 'No matching files' : 'Empty folder'}</div>}
      </div>
    )
  }

  return (
    <div>
      <button
        className="tree-row tree-dir"
        style={{ paddingLeft: `calc(var(--sp-2) + ${depth} * var(--tree-indent))` }}
        onClick={() => setOpenState((o) => !o)}
      >
        <Icon name="chevron-down" size="xs" className={`tree-caret ${open ? 'open' : ''}`} />
        <Icon name="folder-open" size="sm" className="tree-ico" />
        <span className="truncate">{node.name}</span>
      </button>
      {open && !skipped && !f && children.length === 0 && (
        <div className="tree-empty" style={{ paddingLeft: `calc(var(--sp-2) + ${depth + 1} * var(--tree-indent))` }}>Empty folder</div>
      )}
      {open && skipped && !f && (
        <div className="tree-empty tree-skipped" style={{ paddingLeft: `calc(var(--sp-2) + ${depth + 1} * var(--tree-indent))` }}>
          {SKIP_TEXT[node.truncated!]}
          {loadRoot && <Button variant="link" onClick={loadContents} disabled={loading}>{loading ? 'Loading…' : 'Show contents'}</Button>}
        </div>
      )}
      {open &&
        children.map((c) => (
          <FileTree key={c.relPath} node={c} activePath={activePath} onOpenFile={onOpenFile} filter={filter} sort={sort} depth={depth + 1} loadRoot={loadRoot} />
        ))}
    </div>
  )
}
