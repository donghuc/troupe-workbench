import { describe, it, expect } from 'vitest'
import { fileCardMeta, linkTargets } from './fileCards'

describe('fileCardMeta', () => {
  it('humanises file names like the reference design', () => {
    expect(fileCardMeta('ATLAS-DESIGN-MASTER.md')).toMatchObject({ title: 'Atlas design master', subtitle: 'Document · MD', icon: 'file' })
    expect(fileCardMeta('collab/x/05-benchmark_synthesis.md').title).toBe('05 benchmark synthesis')
  })
  it('keeps mixed-case names and names each kind', () => {
    expect(fileCardMeta('HomeDashboard-Interaction-Spec.md').title).toBe('Home Dashboard Interaction Spec')
    expect(fileCardMeta('site/index.html')).toMatchObject({ subtitle: 'Web page · HTML', icon: 'globe' })
    expect(fileCardMeta('report.pdf').subtitle).toBe('PDF')
    expect(fileCardMeta('data.CSV').subtitle).toBe('Spreadsheet · CSV')
    expect(fileCardMeta('Makefile')).toMatchObject({ title: 'Makefile', subtitle: 'File' })
  })
  it('picks the designed thumbnail per type, none for code', () => {
    const t = (f: string) => fileCardMeta(f).thumb
    expect([t('a.md'), t('a.txt'), t('a.docx'), t('a.pdf'), t('a.csv'), t('a.xlsx'), t('a.json'), t('a.pptx'), t('a.png'), t('a.mov')])
      .toEqual(['markdown', 'text', 'doc', 'pdf', 'excel', 'excel', 'data', 'slide', 'image', 'video'])
    expect(t('index.html')).toBe('html')
    expect([t('app.ts'), t('Makefile')]).toEqual([null, null])
    expect(fileCardMeta('deck.pptx').subtitle).toBe('Presentation · PPTX')
  })
})

describe('linkTargets', () => {
  it('lists each markdown link target once, including <angle> targets', () => {
    expect(linkTargets('See [a](docs/a.md) and [b](<my file.md>) and [a again](docs/a.md), [w](https://x.io)'))
      .toEqual(['docs/a.md', '<my file.md>', 'https://x.io'])
  })
})
