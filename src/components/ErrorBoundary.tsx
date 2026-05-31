import { Component, type ReactNode, type ErrorInfo } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Global error boundary that catches unhandled React errors.
 * Prevents full-page crashes and shows a recovery UI.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);

    // In production, send to error reporting service
    // e.g., Sentry.captureException(error, { extra: errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="size-16 mx-auto rounded-full bg-red-100 flex items-center justify-center">
              <svg
                className="size-8 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>

            <div>
              <h2 className="text-lg font-bold text-foreground">
                Something went wrong
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                An unexpected error occurred. Your data is safe.
              </p>
            </div>

            {this.state.error && (
              <details className="text-left rounded-xl border border-border p-4 bg-muted">
                <summary className="text-xs font-mono cursor-pointer text-muted-foreground">
                  Technical details
                </summary>
                <pre className="mt-2 text-[10px] font-mono text-red-600 whitespace-pre-wrap overflow-auto max-h-32">
                  {this.state.error.message}
                  {"\n"}
                  {this.state.error.stack?.split("\n").slice(0, 5).join("\n")}
                </pre>
              </details>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={this.handleReset}
                className="w-full bg-foreground text-background py-3 rounded-xl text-sm font-bold"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="w-full border border-border py-3 rounded-xl text-sm text-muted-foreground"
              >
                Reload Page
              </button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              If this keeps happening, contact support.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
