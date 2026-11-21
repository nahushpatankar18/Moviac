import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendlyMessage = 'Something went wrong while syncing your data.';
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed && typeof parsed.error === 'string') {
          if (parsed.error.toLowerCase().includes('permission')) {
            friendlyMessage =
              'Permission check failed while syncing with Firebase. Please sign out and sign back in with your Gmail account.';
          } else {
            friendlyMessage = parsed.error;
          }
        }
      } catch {
        if (this.state.message) {
          friendlyMessage = this.state.message;
        }
      }

      return (
        <div className="aurora-canvas flex min-h-screen items-center justify-center p-6 text-slate-100">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-300">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="font-display text-xl font-bold text-white">
              Moviac encountered an issue
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">{friendlyMessage}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="accent-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
            >
              <RefreshCw className="h-4 w-4" />
              Reload Moviac
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
