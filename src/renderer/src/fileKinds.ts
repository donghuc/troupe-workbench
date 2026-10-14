// What the app can show for a file, by extension (shared by the artifact viewer and the
// project file browser). Anything not listed as previewable or as text is 'unsupported':
// we show a note and "Show in Finder" instead of reading the bytes. Unknown extensions
// are tried as text; the main process refuses binaries (FILE_BINARY) and huge files.

export type FileKind = 'md' | 'html' | 'image' | 'video' | 'pdf' | 'csv' | 'json' | 'text' | 'unsupported'

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']
const VIDEO = ['mp4', 'webm', 'mov', 'm4v']
// Known binary / app formats: never read as text.
const BINARY = new Set([
  // documents & design files
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'key', 'pages', 'numbers', 'rtfd', 'odt', 'ods', 'odp',
  'psd', 'ai', 'sketch', 'fig', 'xd', 'indd', 'eps', 'afdesign', 'afphoto',
  // images Chromium can't show
  'heic', 'heif', 'tif', 'tiff', 'raw', 'cr2', 'nef', 'dng', 'icns',
  // audio / other video
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'aif', 'aiff', 'avi', 'mkv', 'wmv', 'flv', '3gp',
  // archives & disk images
  'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'dmg', 'iso', 'pkg',
  // fonts, executables, libraries, databases
  'ttf', 'otf', 'woff', 'woff2', 'eot', 'exe', 'dll', 'so', 'dylib', 'o', 'a', 'class', 'jar', 'wasm', 'bin', 'dat',
  'sqlite', 'sqlite3', 'db', 'realm', 'mdb', 'pyc', 'node', 'plist', 'car', 'nib', 'mobileprovision', 'p12', 'cer'
])

export const extOf = (rel: string): string => {
  const name = rel.split('/').pop() ?? rel
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function kindOf(rel: string): FileKind {
  const ext = extOf(rel)
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (IMAGE.includes(ext)) return 'image'
  if (VIDEO.includes(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  if (ext === 'json') return 'json'
  if (BINARY.has(ext)) return 'unsupported'
  return 'text'
}

/** Why a text read failed in a way that means "can't preview" (not a real error). */
export function previewRefusal(e: unknown): 'binary' | 'too-large' | null {
  const m = String((e as Error)?.message ?? e)
  if (m.includes('FILE_BINARY')) return 'binary'
  if (m.includes('FILE_TOO_LARGE')) return 'too-large'
  return null
}
