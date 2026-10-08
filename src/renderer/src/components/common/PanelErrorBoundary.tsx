import { RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { rendererErrorEvents } from "../../../../shared/logging";
import { reportRendererError } from "../../services/diagnostics";

interface PanelErrorBoundaryProps {
  name: string;
  resetKey?: string;
  children: ReactNode;
  onError: (error: unknown) => void;
}

export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    reportRendererError(rendererErrorEvents.reactError, error, info.componentStack ?? undefined);
    this.props.onError(error);
  }

  override componentDidUpdate(previous: PanelErrorBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <section
        className="panel flex min-h-0 flex-col items-start gap-3 p-4"
        aria-label={this.props.name}
        role="alert"
      >
        <h2 className="m-0 text-sm font-bold">{this.props.name} could not be displayed</h2>
        <p className="m-0 text-[13px] text-[#bcc7d4]">Your library was retained.</p>
        <button
          type="button"
          className="ghost-action px-3 text-xs"
          onClick={() => {
            this.setState({ failed: false });
          }}
        >
          <RotateCcw size={15} aria-hidden />
          Retry
        </button>
      </section>
    );
  }
}
