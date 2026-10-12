import Icon from './Icon'

// D-086: window chrome like the Claude desktop app — hide/show the sidebar and walk the
// per-window navigation history. Lives in the sidebar's brand row when the sidebar is
// shown, and floats beside the traffic lights when it is hidden.
export interface WindowNavProps {
  sidebarHidden: boolean
  onToggleSidebar: () => void
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
}

export default function WindowNav({ sidebarHidden, onToggleSidebar, canBack, canForward, onBack, onForward }: WindowNavProps) {
  return (
    <div className="window-nav">
      <button className="icon-btn" title={`${sidebarHidden ? 'Show' : 'Hide'} sidebar (⌘\\)`} aria-label={`${sidebarHidden ? 'Show' : 'Hide'} sidebar`} onClick={onToggleSidebar}><Icon name="sidebar" size={16} /></button>
      <button className="icon-btn" title="Back (⌘[)" aria-label="Back" disabled={!canBack} onClick={onBack}><Icon name="chevron-left" size={16} /></button>
      <button className="icon-btn" title="Forward (⌘])" aria-label="Forward" disabled={!canForward} onClick={onForward}><Icon name="chevron-right" size={16} /></button>
    </div>
  )
}
