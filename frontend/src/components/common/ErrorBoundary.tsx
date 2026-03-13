import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

/**
 * Generic error boundary that catches render errors in child components.
 * Displays a styled fallback UI with a retry button.
 */
export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false, error: null };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("[ErrorBoundary]", error, info.componentStack);
	}

	render() {
		if (this.state.hasError) {
			return (
				this.props.fallback ?? (
					<div className="flex h-full items-center justify-center bg-bg p-8">
						<div className="max-w-md text-center">
							<div className="icon-circle-error mx-auto mb-4">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<title>Error icon</title>
									<circle cx="12" cy="12" r="10" />
									<line x1="15" y1="9" x2="9" y2="15" />
									<line x1="9" y1="9" x2="15" y2="15" />
								</svg>
							</div>
							<h2 className="mb-2 text-label text-error">Something went wrong</h2>
							<p className="mb-5 text-body-secondary">{this.state.error?.message ?? "An unexpected error occurred."}</p>
							<button
								type="button"
								onClick={() => this.setState({ hasError: false, error: null })}
								className="btn-ghost"
							>
								Try again
							</button>
						</div>
					</div>
				)
			);
		}
		return this.props.children;
	}
}
