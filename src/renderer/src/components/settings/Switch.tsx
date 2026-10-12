// Shared by the settings tabs and ToolsSettings.
// iOS-style switch; a <button role="switch"> so it works with keyboard and screen readers.
export default function Switch({ on, onChange, disabled, label, title }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={title} disabled={disabled}
      className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  )
}
