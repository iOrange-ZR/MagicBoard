import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 可选：出错时显示的标题 */
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * 全局错误边界：捕获子组件树中的 JS 错误并显示在页面上，便于排查白屏问题。
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] 捕获到渲染错误:', error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      const { error, errorInfo } = this.state;
      const title = this.props.fallbackTitle ?? '页面渲染出错';
      return (
        <div
          style={{
            padding: 24,
            maxWidth: 800,
            margin: '40px auto',
            fontFamily: 'system-ui, sans-serif',
            background: '#1e1e2e',
            color: '#e0e0e0',
            borderRadius: 12,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}
        >
          <h1 style={{ color: '#f87171', marginBottom: 12, fontSize: 20 }}>
            {title}
          </h1>
          <p style={{ marginBottom: 8, fontWeight: 600 }}>{error.message}</p>
          {error.stack && (
            <pre
              style={{
                padding: 12,
                background: '#0d0d14',
                borderRadius: 8,
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 200,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {error.stack}
            </pre>
          )}
          {errorInfo?.componentStack && (
            <>
              <p style={{ marginTop: 16, marginBottom: 4, fontWeight: 600 }}>
                组件堆栈:
              </p>
              <pre
                style={{
                  padding: 12,
                  background: '#0d0d14',
                  borderRadius: 8,
                  fontSize: 11,
                  overflow: 'auto',
                  maxHeight: 180,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {errorInfo.componentStack}
              </pre>
            </>
          )}
          <p style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>
            请将上述错误信息截图或复制，便于排查。刷新页面可重试。
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
