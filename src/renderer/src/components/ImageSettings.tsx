import { useEffect, useState } from 'react'
import Icon from './Icon'
import { Stack, Field } from './Form'
import { api } from '../api'
import { failed, IMAGE_FOLDER_EVENT } from '../notices'

// Settings ▸ Image (D-088): the Image feature's folder is chosen and changed only here,
// never from the canvas (Hien, 2026-10-05). Applies immediately, like adding an MCP server.
export default function ImageSettings() {
  const [folder, setFolder] = useState<string | null | undefined>(undefined)
  useEffect(() => { api.image.folder().then((f: string | null) => setFolder(f)).catch(() => setFolder(null)) }, [])
  const choose = async () => {
    const f: string | null | undefined = await api.image.pickFolder().catch(failed('Choose folder'))
    if (f) { setFolder(f); window.dispatchEvent(new CustomEvent(IMAGE_FOLDER_EVENT, { detail: f })) }
  }
  return (
    <Stack>
      <Field label="Image folder" hint="Stores the canvas, references, generated and saved images. Changing it opens that folder’s canvas.">
        <div className="image-folder-row">
          <span className={`image-folder-path truncate${folder ? '' : ' empty'}`} title={folder ?? undefined}>{folder === undefined ? 'Loading…' : folder ?? 'No folder chosen yet'}</span>
          {folder && <button className="btn btn-sm" title="Show in Finder" onClick={() => api.system.revealItem(folder, '').catch(failed('Show in Finder'))}><Icon name="folder-open" size={13} /> Show</button>}
          <button className={`btn btn-sm${folder ? '' : ' btn-primary'}`} onClick={choose}>{folder ? 'Change…' : 'Choose folder…'}</button>
        </div>
      </Field>
    </Stack>
  )
}
