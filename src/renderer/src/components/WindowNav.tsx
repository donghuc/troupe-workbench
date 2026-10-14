import Icon from './Icon'
import { IconButton } from './ui/Button'

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
      <IconButton title={`${sidebarHidden ? 'Show' : 'Hide'} sidebar (⌘\\)`} aria-label={`${sidebarHidden ? 'Show' : 'Hide'} sidebar`} onClick={onToggleSidebar}><Icon name="sidebar" size="md" /></IconButton>
      <IconButton title="Back (⌘[)" aria-label="Back" disabled={!canBack} onClick={onBack}><Icon name="chevron-left" size="md" /></IconButton>
      <IconButton title="Forward (⌘])" aria-label="Forward" disabled={!canForward} onClick={onForward}><Icon name="chevron-right" size="md" /></IconButton>
    </div>
  )
}
