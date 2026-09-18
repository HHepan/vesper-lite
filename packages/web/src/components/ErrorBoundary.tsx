import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Global error boundary — prevents silent white-screen crashes.
 * Any render error in the subtree shows a readable message instead of
 * React unmounting #root with no feedback.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary] Render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '2em',
            fontFamily: 'system-ui, sans-serif',
            color: '#e0e0e0',
            background: '#1e1e1e',
          }}
        >
          <h2 style={{ marginBottom: '0.5em' }}>界面渲染出错（Render Error）</h2>
          <p style={{ maxWidth: '60em', wordBreak: 'break-all', marginBottom: '1em' }}>
            {this.state.error.message}
          </p>
          <pre
            style={{
              maxWidth: '60em',
              maxHeight: '20em',
              overflow: 'auto',
              padding: '1em',
              background: '#2a2a2a',
              borderRadius: '6px',
              fontSize: '0.85em',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {this.state.error.stack}
          </pre>
          <div style={{ marginTop: '1em', display: 'flex', gap: '1em' }}>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                padding: '8px 20px',
                borderRadius: '6px',
                border: 'none',
                background: '#4a9eff',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              重试
            </button>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              style={{
                padding: '8px 20px',
                borderRadius: '6px',
                border: '1px solid #888',
                background: 'transparent',
                color: '#e0e0e0',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
