import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * Scopes a render failure to ONE page instead of the whole app.
 *
 * The root boundary replaces the entire document, which takes the sidebar and
 * header with it — a broken report page left the operator with no way to
 * navigate anywhere else, mid-service. This keeps the shell alive so the rest of
 * the dashboard stays usable while one page is broken.
 *
 * Reset is keyed on the route: navigating away and back clears the error without
 * a reload, so a transient failure does not strand the page permanently.
 */
type Props = {
  children: ReactNode;
  /** Changing this clears the error — pass the pathname. */
  resetKey: string;
  onError?: (error: Error, info: ErrorInfo) => void;
};

type State = { error: Error | null; resetKey: string };

export class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromProps(props: Props, state: State): State | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[PageErrorBoundary]", error, info);
    this.props.onError?.(error, info);
  }

  private retry = () => this.setState({ error: null });

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        className="mx-auto max-w-lg rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-900"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="text-base font-semibold">This page hit a problem</h2>
            <p className="mt-1 text-sm">
              The rest of the dashboard still works — use the menu to carry on, or
              try this page again.
            </p>
            <p className="mt-2 font-mono text-xs opacity-70">
              {this.state.error.message || "Unknown error"}
            </p>
            <Button className="mt-4 gap-2" onClick={this.retry}>
              <RotateCcw className="size-4" /> Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
