import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { Project, NewProjectInput, ProjectPatch, ConnectFolderResult } from '../../../shared/types'

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setProjects(await api.projects.list())
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (input: NewProjectInput) => {
    const p = await api.projects.create(input)
    await refresh()
    return p
  }, [refresh])

  const reorder = useCallback(async (orderedIds: string[]) => {
    setProjects((prev) => orderedIds.map((id) => prev.find((p) => p.id === id)).filter((p): p is Project => !!p))
    await api.projects.reorder(orderedIds)
  }, [])

  const update = useCallback(async (id: string, patch: ProjectPatch) => {
    const p = await api.projects.update(id, patch)
    setProjects((prev) => prev.map((x) => (x.id === id ? p : x)))
    return p
  }, [])

  // Main-side, because connecting a folder also migrates memory into it (D-055).
  const connectFolder = useCallback(async (id: string, folderPath: string): Promise<ConnectFolderResult> => {
    const res = await api.projects.connectFolder(id, folderPath)
    setProjects((prev) => prev.map((x) => (x.id === id ? res.project : x)))
    return res
  }, [])

  // Additional folders (D-054): read-write places outside the primary folder.
  const addFolder = useCallback(async (id: string, folderPath: string) => {
    const p = await api.projects.addFolder(id, folderPath)
    setProjects((prev) => prev.map((x) => (x.id === id ? p : x)))
    return p
  }, [])

  const removeFolder = useCallback(async (id: string, folderPath: string) => {
    const p = await api.projects.removeFolder(id, folderPath)
    setProjects((prev) => prev.map((x) => (x.id === id ? p : x)))
    return p
  }, [])

  const touch = useCallback(async (id: string) => {
    await api.projects.touch(id)
    await refresh()
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    await api.projects.remove(id)
    await refresh()
  }, [refresh])

  return {
    projects, loading, reorder, refresh, create, update, remove, touch, connectFolder, addFolder, removeFolder }
}
