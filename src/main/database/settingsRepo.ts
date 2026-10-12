import { getDb } from './db'

export function getSetting(key: string): string | null {
  const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return r?.value ?? null
}
export function setSetting(key: string, value: string): void {
  getDb().prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
}
export function listSettingsWithPrefix(prefix: string): { key: string; value: string }[] {
  return getDb().prepare("SELECT key, value FROM settings WHERE substr(key, 1, length(?)) = ?").all(prefix, prefix) as { key: string; value: string }[]
}
export function getNumberSetting(key: string, fallback: number): number {
  const v = getSetting(key); const n = v == null ? NaN : Number(v)
  return Number.isFinite(n) ? n : fallback
}
