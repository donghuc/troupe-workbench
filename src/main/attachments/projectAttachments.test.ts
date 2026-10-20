import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
vi.mock('../conversations/conversationsRepo', () => ({ getConversation: (id: string) => (id === 'c1' ? { title: 'Taxes' } : null) }))
const { listProjectAttachments, removeProjectAttachment } = await import('./projectAttachments')

describe('project attachments (D-126)', () => {
  it('lists per-chat and older files, deletes only inside the attachments folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-'))
    const base = join(root, '.workbench', 'attachments')
    mkdirSync(join(base, 'c1'), { recursive: true }); mkdirSync(join(base, 'c2'))
    writeFileSync(join(base, 'c1', '1700000000000-tax.pdf'), 'x')
    writeFileSync(join(base, 'c2', '1700000000001-old-chat.png'), 'yy')
    writeFileSync(join(base, '1600000000000-shared.txt'), 'zzz')
    writeFileSync(join(root, 'secret.txt'), 's')
    const l = await listProjectAttachments(root)
    expect(l.map((a) => [a.name, a.chatId, a.chatTitle]).sort()).toEqual([['old-chat.png', 'c2', null], ['shared.txt', null, null], ['tax.pdf', 'c1', 'Taxes']])
    await expect(removeProjectAttachment(root, 'secret.txt')).rejects.toThrow()
    await expect(removeProjectAttachment(root, '.workbench/attachments/../../secret.txt')).rejects.toThrow()
    await removeProjectAttachment(root, '.workbench/attachments/c1/1700000000000-tax.pdf')
    expect(existsSync(join(base, 'c1'))).toBe(false)       // emptied chat folder removed
    expect(existsSync(join(root, 'secret.txt'))).toBe(true)
    expect(await listProjectAttachments(mkdtempSync(join(tmpdir(), 'pa-')))).toEqual([])
  })
})
