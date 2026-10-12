// Render-crash containment (audit #14). Without this a throw anywhere in the
// tree unmounts the whole app to a blank window (D-061's empty-snapshot bug).
// Each boundary contains one region; `resetKey` changing (e.g. switching chat)
// clears the error so navigating away recovers without a reload. Turn state
// lives in main (D-061), so "Reload window" never loses a running agent.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '../notices'
import { cleanErrorMessage, formatErrorDetails } from '../../../shared/errors'
import { api } from '../api'

type Props = { label: string; resetKey?: unknown; compact?: boolean; children: ReactNode }
type State = { error: unknown; componentStack?: string; copied: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false }

  static getDerivedStateFromError(error: unknown): Partial<State> { return { error: error ?? new Error('Unknown render error') } }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const componentStack = info.componentStack?.trim().split('\n').slice(0, 8).join('\n')
    this.setState({ componentStack })
    reportError(this.props.label, error, { silent: true, extra: componentStack ? `Components:\n${componentStack}` : undefined })
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset()
  }

  reset = (): void => this.setState({ error: null, componentStack: undefined, copied: false })

  copy = async (): Promise<void> => {
    const text = formatErrorDetails(this.props.label, this.state.error, this.state.componentStack ? `Components:\n${this.state.componentStack}` : undefined)
    try { await navigator.clipboard.writeText(text); this.setState({ copied: true }) } catch { /* clipboard unavailable */ }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className={`crash${this.props.compact ? ' crash-compact' : ''}`} role="alert">
        <div className="crash-title">{this.props.label} hit an error</div>
        <div className="crash-msg">{cleanErrorMessage(this.state.error)}</div>
        <div className="crash-hint">Running agents are not affected. Try again, or reload the window if it keeps happening.</div>
        <div className="crash-actions">
          <button className="btn btn-primary" onClick={this.reset}>Try again</button>
          <button className="btn" onClick={() => location.reload()}>Reload window</button>
          <button className="btn" onClick={this.copy}>{this.state.copied ? 'Copied' : 'Copy details'}</button>
          <button className="link-btn" onClick={() => { void api.system.openLogs() }}>Show log</button>
        </div>
      </div>
    )
  }
}
