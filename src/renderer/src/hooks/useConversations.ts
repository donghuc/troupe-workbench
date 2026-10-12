import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { Conversation, ProviderId } from '../../../shared/types'

export function useConversations(projectId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([])

  const refresh = useCallback(async () => {
    if (!projectId) { setConversations([]); return }
    setConversations(await api.conversations.list(projectId))
  }, [projectId])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (title: string, provider: ProviderId) => {
    if (!projectId) throw new Error('no project')
    const c = await api.conversations.create(projectId, title, provider)
    await refresh()
    return c
  }, [projectId, refresh])

  return { conversations, refresh, create }
}
