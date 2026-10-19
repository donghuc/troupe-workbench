// Policy for HTML/SVG files served over wbfile:// (security review 2026-10). A previewed
// page runs in an opaque-origin sandbox, but wbfile:// answers any origin (pdf.js needs
// that), so without this a page could fetch() every other file in the project and send it
// anywhere. connect-src leaves out wbfile:, which blocks reading other project files from
// script; images, styles and scripts next to the page (and from the web) still load, so
// agent-made dashboards keep working. Confirmed in Electron 44 (fetch refused by CSP).
export const DOCUMENT_CSP =
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src https: data: blob:; object-src 'none'; base-uri 'none'"

export function isDocumentMime(mime: string): boolean {
  return /^(text\/html|image\/svg\+xml)\b/i.test(mime)
}
