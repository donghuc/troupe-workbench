import { handle } from './handle'
import { listTree, readTextFile, readDataUrl, writeTextFile, writeBinary, searchFiles, readPdfText, existingFiles } from '../filesystem/fsService'
import { saveAttachmentBinary, extractAttachmentPdf } from '../attachments/attachmentStore'
import { listProjectAttachments, removeProjectAttachment } from '../attachments/projectAttachments'
import { startWatch, stopWatch } from '../filesystem/watcher'
import { assertProjectRoot, assertKnownAbsolute } from '../security/roots'
import { expectString } from '../security/pathGuard'

export function registerFileIpc(): void {
  // Every root the renderer names must be a connected project folder (D-060 item 6);
  // relPaths are then kept under it by ensureInside inside fsService.
  const R = assertProjectRoot
  const S = expectString
  handle('files.listTree', (_e, root: string, sub?: string) => listTree(R(root), typeof sub === 'string' ? sub : ''))
  handle('files.readFile', (_e, root: string, relPath: string) => readTextFile(R(root), S(relPath, 'path')))
  handle('files.readDataUrl', (_e, root: string, relPath: string) => readDataUrl(R(root), S(relPath, 'path')))
  handle('files.writeBinary', (_e, root: string, relPath: string, base64: string) => writeBinary(R(root), S(relPath, 'path'), S(base64, 'data')))
  handle('files.writeFile', (_e, root: string, relPath: string, content: string) =>
    writeTextFile(R(root), S(relPath, 'path'), typeof content === 'string' ? content : '')
  )
  handle('files.watchStart', (e, root: string) => startWatch(R(root), e.sender))
  handle('files.watchStop', () => stopWatch())
  handle('files.search', (_e, root: string, query: string) => searchFiles(R(root), typeof query === 'string' ? query : ''))
  handle('files.existing', (_e, root: string, relPaths: string[]) => existingFiles(R(root), Array.isArray(relPaths) ? relPaths.filter((r) => typeof r === 'string') : []))
  handle('files.extractText', (_e, root: string, relPath: string) => readPdfText(R(root), S(relPath, 'path')))
  handle('attachments.saveBinary', (_e, base64: string, name: string) => saveAttachmentBinary(S(base64, 'data'), S(name, 'name')))
  // Absolute path: only files in the app's attachment store or a project folder.
  handle('attachments.extractPdf', (_e, absPath: string) => extractAttachmentPdf(assertKnownAbsolute(absPath)))
  handle('attachments.list', (_e, root: string) => listProjectAttachments(R(root)))
  handle('attachments.remove', (_e, root: string, relPath: string) => removeProjectAttachment(R(root), S(relPath, 'path')))
}
