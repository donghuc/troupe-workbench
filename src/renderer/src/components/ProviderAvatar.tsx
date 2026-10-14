import { useState } from 'react'
import type { ProviderId } from '../../../shared/types'
import { metaFor } from './providerMeta'

/** DS Avatar sizes (Dimension › avatar-size/*): sm 18, md 22, lg 28, xl 36. */
export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'
interface Props { id: ProviderId | null; size?: AvatarSize }

export default function ProviderAvatar({ id, size = 'md' }: Props) {
  const meta = metaFor(id)
  const [imgOk, setImgOk] = useState(!!meta.logo)
  // monogram size steps are tokens (font-size/avatar-sm/md/lg ≈ 0.42 × the tile; xl uses lg)
  const fontSize = `var(--fs-avatar-${size === 'xl' ? 'lg' : size})`
  const style = { width: `var(--avatar-${size})`, height: `var(--avatar-${size})`, background: meta.color, color: meta.fg, fontSize }
  return (
    <span className="pv-avatar" style={style} title={meta.name}>
      {imgOk && meta.logo
        ? <img src={meta.logo} alt={meta.name} onError={() => setImgOk(false)} />
        : <span className="pv-mono">{meta.mono}</span>}
    </span>
  )
}
