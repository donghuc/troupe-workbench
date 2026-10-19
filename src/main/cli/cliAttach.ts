import { promises as fs } from 'fs'
import { basename, isAbsolute, join } from 'path'
import { ensureInside, looksBinary, extractPdfText } from '../filesystem/fsService'
import { saveAttachmentBinary } from '../attachments/attachmentStore'
import { CliError, isSecretPath, CLI_MAX_ATTACH, CLI_MAX_ATTACH_BYTES } from '../../shared/cliProtocol'
import type { TurnAttachment } from '../../shared/turns'

// D-118: `troupe send … --attach <file>`. Same handling as a file dropped into the
// composer (renderer/src/attachments.ts): a copy goes into the project's
// .workbench/attachments (or the app's attachment store when the project has no folder);
// text is inlined, PDFs have their text extracted, images and other files go by path.

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i
const PDF = /\.pdf$/i
const MAX_PDF_CHARS = 200_000

export async function attachFiles(paths: string[], cwd: string | null): Promise<TurnAttachment[]> {
  if (paths.length > CLI_MAX_ATTACH) throw new CliError(`At most ${CLI_MAX_ATTACH} attachments per message.`)
  const out: TurnAttachment[] = []
  for (const p of paths) out.push(await attachOne(p, cwd))
  return out
}

async function attachOne(src: string, cwd: string | null): Promise<TurnAttachment> {
  if (!isAbsolute(src)) throw new CliError(`Attachment paths must be absolute: ${src}`)
  if (isSecretPath(src)) throw new CliError(`${basename(src)} looks like a key or credentials file; it can't be attached.`)
  let st
  try { st = await fs.lstat(src) } catch { throw new CliError(`No such file: ${src}`, 404) }
  if (!st.isFile()) throw new CliError(`Not a regular file: ${src}`)
  if (st.size > CLI_MAX_ATTACH_BYTES) throw new CliError(`${basename(src)} is larger than ${CLI_MAX_ATTACH_BYTES / 1024 / 1024} MB.`)
  const buf = await fs.readFile(src)
  const name = basename(src)
  const safe = name.replace(/[^\w.\-]+/g, '_')
  const isText = !looksBinary(buf) && !IMAGE.test(name) && !PDF.test(name)
  // Save a copy where the agent and the app can read it.
  let path: string; let absolute = false
  if (cwd) {
    path = `.workbench/attachments/${Date.now()}-${safe}`
    const abs = ensureInside(cwd, path)
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, buf)
  } else {
    path = await saveAttachmentBinary(buf.toString('base64'), name); absolute = true
  }
  if (isText) return { path, content: buf.toString('utf8'), viewable: !absolute }
  if (IMAGE.test(name)) return { path, image: true, viewable: !absolute }
  if (PDF.test(name)) {
    const text = extractPdfText(absolute ? path : ensureInside(cwd!, path))
    if (text.trim()) return { path, content: text.length > MAX_PDF_CHARS ? text.slice(0, MAX_PDF_CHARS) + '\n\n…(truncated)' : text, viewable: !absolute }
  }
  return { path, doc: true, viewable: !absolute }
}
