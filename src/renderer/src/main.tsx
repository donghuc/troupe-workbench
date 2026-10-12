import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ArtifactWindow from './ArtifactWindow'
import ErrorBoundary from './components/ErrorBoundary'
import Notices from './components/Notices'
import { installGlobalErrorHandlers } from './notices'
import './styles/tokens.css'
import './styles/app.css'

const params = new URLSearchParams(location.search)
const artifactMode = params.get('artifact') === '1'

installGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Last-resort boundary: App wraps its own regions, so this only fires if App itself throws. */}
    <ErrorBoundary label={artifactMode ? 'Artifact window' : 'Troupe'}>
      {artifactMode
        ? <ArtifactWindow root={params.get('root') ?? ''} relPath={params.get('path') ?? ''} />
        : <App />}
    </ErrorBoundary>
    {artifactMode && <Notices />}
  </React.StrictMode>
)
