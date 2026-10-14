import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import FileTree from './FileTree'
import { api } from '../api'
import type { FileNode } from '../../../shared/types'
import { Button } from './ui/Button'

interface Props { projectId: string; folderPath: string | null; onClose: () => void }

const DOC_EXT = ['md', 'markdown', 'mdx', 'txt', 'rst', 'adoc', 'org', 'csv']
const NOISE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', 'vendor', '.cache'])
const MAX_SUGGESTIONS = 6

const collectFiles = (node: FileNode, acc: string[] = []): string[] => {
  if (node.type === 'file') acc.push(node.relPath)
  node.children?.forEach((c) => collectFiles(c, acc))
  return acc
}
const extOf = (rel: string) => rel.split('.').pop()?.toLowerCase() ?? ''
const isNoise = (rel: string) => rel.split('/').some((seg) => NOISE.has(seg))
const isDoc = (rel: string) => DOC_EXT.includes(extOf(rel))
// Lower score = suggested first: prose docs, READMEs, shallower paths.
const score = (rel: string) => {
  const name = rel.split('/').pop()!.toLowerCase()
  const ext = extOf(rel)
  const base = ['md', 'markdown', 'mdx'].includes(ext) ? 0 : ext === 'txt' ? 1 : 2
  const readme = name.startsWith('readme') ? -1 : 0
  return base + readme + rel.split('/').length * 0.1
}

export default function ContextManager({ projectId, folderPath, onClose }: Props) {
  const [files, setFiles] = useState<string[]>([])
  const [tree, setTree] = useState<FileNode | null>(null)
  const [adding, setAdding] = useState(false)

  const refresh = async () => setFiles(await api.context.list(projectId))
  useEffect(() => { refresh() }, [projectId])
  // Load the tree up front so suggestions can be computed (spec §57).
  useEffect(() => { if (folderPath) api.files.listTree(folderPath).then(setTree) }, [folderPath])

  const add = async (rel: string) => { await api.context.add(projectId, rel); await refresh() }
  const remove = async (rel: string) => { await api.context.remove(projectId, rel); await refresh() }

  const suggestions = useMemo(() => {
    if (!tree) return []
    const inContext = new Set(files)
    return collectFiles(tree)
      .filter((rel) => isDoc(rel) && !isNoise(rel) && !inContext.has(rel))
      .sort((a, b) => score(a) - score(b) || a.localeCompare(b))
      .slice(0, MAX_SUGGESTIONS)
  }, [tree, files])

  return (
    <Modal title="Persistent Context" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      {files.length === 0 && <p className="field-hint">No context files yet.</p>}
      {files.map((f) => (
        <div key={f} className="ctx-file-row">
          <span className="truncate">{f}</span>
          <Button variant="link" onClick={() => remove(f)}>Remove</Button>
        </div>
      ))}

      {suggestions.length > 0 && (
        <div className="ctx-suggest">
          <div className="ctx-suggest-head">Suggested documents</div>
          {suggestions.map((rel) => (
            <div key={rel} className="ctx-file-row">
              <span className="truncate" title={rel}>{rel}</span>
              <Button variant="link" onClick={() => add(rel)}>Add</Button>
            </div>
          ))}
        </div>
      )}

      {!folderPath && <p className="field-hint">Connect a project folder to add context files.</p>}
      {folderPath && !adding && <Button size="sm" onClick={() => setAdding(true)}>+ Add another file</Button>}
      {folderPath && adding && (
        <div className="ctx-picker">
          <div className="field-hint">Click a file to add it:</div>
          {tree && <FileTree node={tree} activePath={null} onOpenFile={(rel) => add(rel)} loadRoot={folderPath ?? undefined} />}
          <Button size="sm" onClick={() => setAdding(false)}>Done adding</Button>
        </div>
      )}
    </Modal>
  )
}
