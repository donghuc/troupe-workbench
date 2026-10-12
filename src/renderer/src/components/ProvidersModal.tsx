import { useEffect, useState } from 'react'
import Modal from './Modal'
import { api } from '../api'
import type { ProviderDescriptor } from '../../../shared/agent'
import ProviderAvatar from './ProviderAvatar'

export default function ProvidersModal({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderDescriptor[] | null>(null)

  useEffect(() => { api.providers.list().then(setProviders) }, [])

  return (
    <Modal title="Providers" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {!providers && <p className="field-hint">Detecting…</p>}
      {providers?.map((p) => (
        <div key={p.id} className="provider-row">
          <div className="provider-row-head">
            <span className="provider-name"><ProviderAvatar id={p.id} size={20} /> {p.name}</span>
            <span className={`provider-badge ${p.availability.installed ? 'ok' : 'bad'}`}>
              {p.availability.installed ? '✓ Installed' : '✗ Not found'}
            </span>
            {p.availability.installed && (
              <span className={`provider-badge ${p.availability.authenticated ? 'ok' : 'bad'}`}>
                {p.availability.authenticated ? '✓ Signed in' : '✗ Signed out'}
              </span>
            )}
          </div>
          {p.availability.detail && <div className="provider-detail">{p.availability.detail}</div>}
          <div className="provider-caps">
            {p.capabilities.fileWrite && <span className="cap">file write</span>}
            {p.capabilities.shell && <span className="cap">shell</span>}
            {p.capabilities.web && <span className="cap">web</span>}
            {p.capabilities.sessionResume && <span className="cap">resume</span>}
            {p.capabilities.streamingDeltas && <span className="cap">token stream</span>}
            <span className="cap">perms: {p.capabilities.permissionModel}</span>
          </div>
        </div>
      ))}
    </Modal>
  )
}
