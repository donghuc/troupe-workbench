import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import { createVoiceService, type WhisperCtx } from './voiceService'
import type { VoiceDownloadEvent, VoiceModel } from '../../shared/voice'

const body = Buffer.from('fake ggml model bytes '.repeat(1000))
const sha = createHash('sha256').update(body).digest('hex')
const MODELS: VoiceModel[] = [
  { id: 'base', label: 'Fast', file: 'base.bin', bytes: body.length, sha256: sha, note: '' },
  { id: 'small', label: 'Balanced', file: 'small.bin', bytes: body.length, sha256: sha, note: '' }
]
const stream = (buf: Buffer) => new Response(new ReadableStream({
  start(c) { for (let i = 0; i < buf.length; i += 4096) c.enqueue(new Uint8Array(buf.subarray(i, i + 4096))); c.close() }
}))

function setup(over: { fetchBody?: Buffer; settings?: Record<string, string>; locale?: string; gate?: Promise<void> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'voice-'))
  const events: VoiceDownloadEvent[] = []
  const log: string[] = []
  const fakeCtx = (path: string): WhisperCtx => ({
    transcribeData: (pcm, opts) => {
      log.push(`transcribe ${basename(path)} ${pcm.byteLength} ${opts.language}`)
      return { stop: async () => { log.push('stop') }, promise: (over.gate ?? Promise.resolve()).then(() => { log.push('done'); return { result: ' hello there ', language: 'en', isAborted: false } }) }
    },
    release: async () => { log.push(`release ${basename(path)}`) },
    backend: 'gpu'
  })
  const settings: Record<string, string> = { ...over.settings }
  const svc = createVoiceService({
    dir, models: MODELS, idleMs: 10_000,
    fetch: async () => stream(over.fetchBody ?? body),
    initWhisper: async (p) => { log.push(`load ${basename(p)}`); return fakeCtx(p) },
    getSetting: (k) => settings[k] ?? null,
    setSetting: (k, v) => { settings[k] = v },
    systemLocale: () => over.locale ?? 'en-US',
    emit: (e) => events.push(e)
  })
  return { dir, svc, events, log, settings }
}

describe('voice service (D-124)', () => {
  it('downloads a model, checks its hash and reports progress', async () => {
    const { dir, svc, events } = setup()
    expect((await svc.status()).active).toBeNull()
    await svc.download('small')
    expect(readFileSync(join(dir, 'small.bin'))).toEqual(body)
    expect(events.at(-1)).toMatchObject({ id: 'small', state: 'done', received: body.length, total: body.length })
    const st = await svc.status()
    expect(st.selected).toBe('small')
    expect(st.active).toBe('small')
    expect(st.models.find((m) => m.id === 'small')?.installed).toBe(true)
    expect(st.language).toBe('en')   // never Whisper's guess
  })

  it('throws away a download whose bytes don’t match', async () => {
    const bad = Buffer.from(body); bad[10] ^= 1
    const { dir, svc, events } = setup({ fetchBody: bad })
    await expect(svc.download('base')).rejects.toThrow(/damaged/)
    expect(readdirSync(dir)).toEqual([])
    expect(events.at(-1)).toMatchObject({ state: 'error' })
  })

  it('uses an installed model when the selected one is missing; transcribes one at a time', async () => {
    const { svc, log } = setup({ settings: { voice_model: 'small', voice_language: 'vi' } })
    await expect(svc.transcribe(new ArrayBuffer(3200))).rejects.toThrow(/Settings ▸ Tools ▸ Voice/)
    await svc.download('base')
    const st = await svc.status()
    expect(st.selected).toBe('small')
    expect(st.active).toBe('base')
    const [a, b] = await Promise.all([svc.transcribe(new ArrayBuffer(3200)), svc.transcribe(new ArrayBuffer(6400))])
    expect(a.text).toBe(' hello there ')
    expect(b.language).toBe('en')
    expect(log).toEqual(['load base.bin', 'transcribe base.bin 3200 vi', 'done', 'transcribe base.bin 6400 vi', 'done'])   // loaded once
    await svc.release()
    expect(log.at(-1)).toBe('release base.bin')
  })

  it('prepare loads the model ahead, so the transcription doesn’t wait for it', async () => {
    const { svc, log } = setup()
    await svc.prepare()                       // nothing installed: no-op
    expect(log).toEqual([])
    await svc.download('base')
    await svc.prepare(); await svc.prepare()
    expect(log).toEqual(['load base.bin'])
    await svc.transcribe(new ArrayBuffer(3200))
    expect(log.filter((l) => l.startsWith('load'))).toHaveLength(1)
    await svc.release()
  })

  it('remembers how fast this computer is, says what runs it, and dictates in the system language until one is picked', async () => {
    const { svc, settings } = setup({ locale: 'vi-VN' })
    await svc.download('base')
    expect((await svc.status()).language).toBe('vi')
    expect((await svc.status()).backend).toBeNull()
    expect((await svc.status()).models[0].secPer20s).toBeNull()
    await svc.transcribe(new ArrayBuffer(32_000 * 5))   // 5 s of audio
    const st = await svc.status()
    expect(st.backend).toBe('gpu')
    expect(typeof st.models[0].secPer20s).toBe('number')
    expect(JSON.parse(settings.voice_speed)).toHaveProperty('base')
    settings.voice_language = 'en'
    expect((await svc.status()).language).toBe('en')
    await svc.release()
  })

  it('refuses empty and over-long audio', async () => {
    const { svc } = setup()
    await expect(svc.transcribe(new ArrayBuffer(0))).rejects.toThrow(/No audio/)
    await expect(svc.transcribe(new ArrayBuffer(16_000 * 2 * 601))).rejects.toThrow(/10 minutes/)
  })

  it('removing the loaded model releases it first', async () => {
    const { dir, svc, log } = setup()
    await svc.download('base')
    await svc.transcribe(new ArrayBuffer(3200))
    await svc.remove('base')
    expect(log).toContain('release base.bin')
    expect(existsSync(join(dir, 'base.bin'))).toBe(false)
    expect((await svc.status()).active).toBeNull()
  })
  it('freeing or removing the model waits for a running transcription (audit #11)', async () => {
    let open!: () => void
    const { svc, log } = setup({ gate: new Promise<void>((r) => { open = r }) })
    await svc.download('base')
    const t = svc.transcribe(new ArrayBuffer(3200))
    await new Promise((r) => setTimeout(r, 5))           // the transcription is under way
    const rel = svc.release()
    const rm = svc.remove('base')
    await new Promise((r) => setTimeout(r, 5))
    expect(log).not.toContain('release base.bin')       // not freed under the running job
    open()
    await t; await rel; await rm
    expect(log.indexOf('done')).toBeLessThan(log.indexOf('release base.bin'))
  })
})
