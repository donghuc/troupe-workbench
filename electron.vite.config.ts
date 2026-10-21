import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import type { Plugin } from 'vite'

// Content-Security-Policy for the renderer (D-060 item 6). Injected as a <meta> tag
// at HTML transform time so it applies to the file:// load in the packaged app, where
// response-header hooks never fire. The dev server needs inline/eval scripts (Vite
// HMR + React Fast Refresh preamble) and a websocket; the packaged build does not.
//
// What each source is for:
//   script-src  'self'                      app bundle only
//   style-src   'unsafe-inline'             React inline styles, Vite-injected CSS
//   font-src    'self' + data:              the bundled Google Sans files (D-130), pdf.js embedded fonts
//   img-src     data: blob: wbfile:         data-URL previews, pdf.js canvases, project images
//   media-src   wbfile: blob:               video artifacts
//   frame-src   wbfile: blob: about:        HTML/PDF artifacts (sandboxed iframes)
//   connect-src 'self' wbfile:              pdf.js fetch() of the document
//   worker-src  'self' blob:                pdf.js worker
// Artifact documents inside wbfile:// frames carry their own (absent) policy — the
// scheme has bypassCSP — so this policy governs the app shell, not agent-made HTML.
function csp(dev: boolean): string {
  const script = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'"
  const connect = dev ? "'self' wbfile: ws://localhost:* http://localhost:*" : "'self' wbfile:"
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: wbfile:",
    'media-src wbfile: blob:',
    'frame-src wbfile: blob: about:',
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join('; ')
}

const cspPlugin = (): Plugin => ({
  name: 'workbench-csp',
  transformIndexHtml: {
    order: 'pre',
    handler(_html, ctx) {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp(!!ctx.server) }, injectTo: 'head-prepend' }]
    }
  }
})

export default defineConfig({
  // The Windows GPU build of the voice addon is an optional dependency (D-124): keep it a runtime require too.
  main: { plugins: [externalizeDepsPlugin({ include: ['@fugood/node-whisper-win32-x64-vulkan'] })] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), cspPlugin()]
  }
})
