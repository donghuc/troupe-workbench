import { api } from './api'

export type ThemeChoice = 'system' | 'light' | 'dark'

export const DEFAULT_CHAT_FONT = 15
export const MIN_CHAT_FONT = 12
export const MAX_CHAT_FONT = 20

// Artifact viewer text (markdown, plain text, CSV, JSON). 14px matches the viewer's
// size before this setting existed. HTML, PDF and images keep their own sizing.
export const DEFAULT_ARTIFACT_FONT = 14
export const MIN_ARTIFACT_FONT = 12
export const MAX_ARTIFACT_FONT = 22

const clamp = (n: number, min: number, max: number, def: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(n) && n > 0 ? n : def)))
const clampFont = (n: number) => clamp(n, MIN_CHAT_FONT, MAX_CHAT_FONT, DEFAULT_CHAT_FONT)
export const clampArtifactFont = (n: number) => clamp(n, MIN_ARTIFACT_FONT, MAX_ARTIFACT_FONT, DEFAULT_ARTIFACT_FONT)

// Apply theme + font sizes to the document root immediately (no reload needed).
export function applyAppearance(theme: ThemeChoice, chatFontPx: number, artifactFontPx: number = DEFAULT_ARTIFACT_FONT): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  root.style.setProperty('--chat-fs', `${clampFont(chatFontPx)}px`)
  root.style.setProperty('--artifact-fs', `${clampArtifactFont(artifactFontPx)}px`)
}

// Read persisted appearance settings and apply them. Called on startup of the main
// window and of each artifact pop-out window.
export async function loadAndApplyAppearance(): Promise<{ theme: ThemeChoice; font: number; artifactFont: number }> {
  const [t, f, a] = await Promise.all([api.settings.get('theme'), api.settings.get('chat_font_px'), api.settings.get('artifact_font_px')])
  const theme = (t === 'light' || t === 'dark' || t === 'system' ? t : 'system') as ThemeChoice
  const font = clampFont(Number(f))
  const artifactFont = clampArtifactFont(Number(a))
  applyAppearance(theme, font, artifactFont)
  return { theme, font, artifactFont }
}
