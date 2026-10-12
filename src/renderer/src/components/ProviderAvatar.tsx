import { useState } from 'react'
import type { ProviderId } from '../../../shared/types'
import { metaFor } from './providerMeta'

interface Props { id: ProviderId | null; size?: number }

export default function ProviderAvatar({ id, size = 22 }: Props) {
  const meta = metaFor(id)
  const [imgOk, setImgOk] = useState(!!meta.logo)
  const style = { width: size, height: size, background: meta.color, color: meta.fg, fontSize: size * 0.42 }
  return (
    <span className="pv-avatar" style={style} title={meta.name}>
      {imgOk && meta.logo
        ? <img src={meta.logo} alt={meta.name} onError={() => setImgOk(false)} />
        : <span className="pv-mono">{meta.mono}</span>}
    </span>
  )
}
