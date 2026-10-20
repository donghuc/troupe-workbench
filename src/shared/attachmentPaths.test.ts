import { describe, expect, it } from 'vitest'
import { attachmentRel, attachmentDisplayName, safeAttachName } from './attachmentPaths'

describe('attachment paths (D-126)', () => {
  it('puts each chat’s files in its own folder and keeps Vietnamese names readable', () => {
    expect(attachmentRel('c-123', 'Báo cáo tháng 10.pdf', 1700000000000)).toBe('.workbench/attachments/c-123/1700000000000-Báo_cáo_tháng_10.pdf')
    expect(attachmentRel(undefined, 'a.png', 5)).toBe('.workbench/attachments/5-a.png')
    expect(attachmentRel('../x', 'a.png', 5)).toBe('.workbench/attachments/x/5-a.png')
    expect(safeAttachName('../../etc/passwd')).toBe('__.._etc_passwd')   // no slashes left
    expect(safeAttachName('')).toBe('file')
    expect(attachmentDisplayName('1700000000000-Báo_cáo.pdf')).toBe('Báo_cáo.pdf')
  })
})
