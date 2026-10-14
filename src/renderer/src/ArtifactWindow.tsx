import { useEffect } from 'react'
import ArtifactViewer from './components/ArtifactViewer'
import { loadAndApplyAppearance } from './appearance'

// Standalone artifact-only view rendered in a detached pop-out window.
export default function ArtifactWindow({ root, relPath }: { root: string; relPath: string }) {
  // A pop-out is its own renderer: apply the saved theme and font sizes here too.
  useEffect(() => { void loadAndApplyAppearance().catch(() => {}) }, [])
  return (
    <div className="artifact-window" data-surface="paper">
      <ArtifactViewer root={root} relPath={relPath} onClose={() => window.close()} />
    </div>
  )
}
