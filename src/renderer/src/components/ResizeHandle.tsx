interface Props { varName: string; edge: 'left' | 'right'; min: number; max: number }

const readVar = (v: string) => parseInt(getComputedStyle(document.documentElement).getPropertyValue(v)) || 0

// Draggable divider that resizes a panel by adjusting a CSS width variable
// on :root. `edge` is which side of the panel the handle sits on.
export default function ResizeHandle({ varName, edge, min, max }: Props) {
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    // Start from the panel's real width: the variable may be unset (it has a CSS fallback).
    const start = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect().width || readVar(varName)
    const move = (ev: MouseEvent) => {
      const delta = edge === 'right' ? ev.clientX - startX : startX - ev.clientX
      const w = Math.max(min, Math.min(max, start + delta))
      document.documentElement.style.setProperty(varName, `${w}px`)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing')
      try { localStorage.setItem(`panelw:${varName}`, `${readVar(varName)}`) } catch { /* ignore */ }
    }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return <div className={`resize-handle resize-${edge}`} onMouseDown={onDown} title="Drag to resize" />
}

// Apply any persisted panel widths. Call once on app startup.
export function restorePanelWidths(vars: string[]): void {
  for (const v of vars) {
    try {
      const saved = localStorage.getItem(`panelw:${v}`)
      if (saved) document.documentElement.style.setProperty(v, `${parseInt(saved)}px`)
    } catch { /* ignore */ }
  }
}
