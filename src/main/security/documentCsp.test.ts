import { describe, it, expect } from 'vitest'
import { DOCUMENT_CSP, isDocumentMime } from './documentCsp'
import { isSafeExternalUrl, isSafeSegment } from './pathGuard'

describe('document CSP', () => {
  it('applies to html and svg only', () => {
    expect(isDocumentMime('text/html; charset=utf-8')).toBe(true)
    expect(isDocumentMime('image/svg+xml')).toBe(true)
    expect(isDocumentMime('application/pdf')).toBe(false)
    expect(isDocumentMime('image/png')).toBe(false)
  })
  it('keeps wbfile: out of connect-src', () => {
    const connect = DOCUMENT_CSP.split(';').find((d) => d.trim().startsWith('connect-src'))!
    expect(connect).not.toMatch(/wbfile|\*/)
  })
})

describe('isSafeExternalUrl', () => {
  it('allows web and mail links only', () => {
    for (const u of ['https://a.com', 'http://a.com/x', 'mailto:a@b.c']) expect(isSafeExternalUrl(u)).toBe(true)
    for (const u of ['smb://host/share', 'file:///Applications/X.app', 'x-myapp://run', 'javascript:alert(1)', 'wbfile://file/?root=/']) expect(isSafeExternalUrl(u)).toBe(false)
  })
})

describe('isSafeSegment', () => {
  it('refuses separators, dot names and empty', () => {
    for (const s of ['my-skill', 'skill_2', 'Ünïcode']) expect(isSafeSegment(s)).toBe(true)
    for (const s of ['', '.', '..', '../x', 'a/b', 'a\\b']) expect(isSafeSegment(s)).toBe(false)
  })
})
