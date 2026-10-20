// Inline file cards (D-066): what a file looks like as a card in the conversation —
// a readable title and a "Kind · EXT" subtitle — plus which files a reply links to.
// Pure; tested in fileCards.test.ts.

export type FileCardIcon = 'file' | 'globe' | 'image' | 'film' | 'mic'
// Designed file-type thumbnails (Hien, assets/file-thumbs → renderer/src/assets/file-thumbs).
// Types without one (code, unknown) fall back to the icon tile.
export type FileThumb = 'markdown' | 'text' | 'doc' | 'pdf' | 'excel' | 'data' | 'slide' | 'image' | 'video' | 'html'
export interface FileCardMeta { title: string; subtitle: string; icon: FileCardIcon; ext: string; thumb: FileThumb | null }

const THUMBS: [RegExp, FileThumb][] = [
  [/^(md|markdown|mdx)$/, 'markdown'],
  [/^(txt|text|rtf|log)$/, 'text'],
  [/^(docx?|odt|pages)$/, 'doc'],
  [/^pdf$/, 'pdf'],
  [/^(csv|tsv|xlsx?|xlsm|ods|numbers)$/, 'excel'],
  [/^(json|jsonl|ya?ml|toml|xml|ini)$/, 'data'],
  [/^(pptx?|key|odp)$/, 'slide'],
  [/^(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/, 'image'],
  [/^(mp4|webm|mov|m4v)$/, 'video'],
  [/^(html?|xhtml)$/, 'html']
]

const KINDS: [RegExp, string, FileCardIcon][] = [
  [/^(md|markdown|mdx|txt|text|rtf|log|docx?|odt|pages)$/, 'Document', 'file'],
  [/^html?$/, 'Web page', 'globe'],
  [/^pdf$/, 'PDF', 'file'],
  [/^(csv|tsv|xlsx?|xlsm|ods|numbers)$/, 'Spreadsheet', 'file'],
  [/^(json|jsonl|ya?ml|toml|xml|ini)$/, 'Data', 'file'],
  [/^(pptx?|key|odp)$/, 'Presentation', 'file'],
  [/^(png|jpe?g|gif|webp|svg|bmp|avif)$/, 'Image', 'image'],
  [/^(mp4|webm|mov|m4v)$/, 'Video', 'film'],
  [/^(mp3|m4a|aac|wav|ogg|oga|opus|flac|aiff?)$/, 'Audio', 'mic'],
  [/^(ts|tsx|js|jsx|py|swift|kt|java|go|rs|css|sh)$/, 'Code', 'file']
]

/** "ATLAS-DESIGN-MASTER.md" → { title: "Atlas design master", subtitle: "Document · MD" }. */
export function fileCardMeta(relPath: string): FileCardMeta {
  const name = relPath.split('/').pop() || relPath
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const stem = dot > 0 ? name.slice(0, dot) : name
  const words = stem.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim()
  // Sentence case only when the name was all one case (SHOUTY or lower); keep mixed case as written.
  const title = !words ? name : (words === words.toUpperCase() || words === words.toLowerCase())
    ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
    : words
  const kind = KINDS.find(([re]) => re.test(ext))
  const label = kind ? kind[1] : 'File'
  const subtitle = !ext ? label : label === 'PDF' ? 'PDF' : `${label} · ${ext.toUpperCase()}`
  const thumb = THUMBS.find(([re]) => re.test(ext))?.[1] ?? null
  return { title, subtitle, icon: kind ? kind[2] : 'file', ext, thumb }
}

/** Link targets in a Markdown reply ([text](target)), in order, de-duplicated. */
export function linkTargets(markdown: string): string[] {
  const out: string[] = []
  for (const m of markdown.matchAll(/\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)/g)) {
    const t = m[1]
    if (!out.includes(t)) out.push(t)
  }
  return out
}
