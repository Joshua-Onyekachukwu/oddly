"use client";

import React, { Component, type ReactNode } from "react";

interface GlobalErrorBoundaryProps {
  children: ReactNode;
}

interface GlobalErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Global Error Boundary — wraps the entire app layout.
 * Catches all unhandled JavaScript errors and displays a full-screen fallback UI.
 * Logs errors to console for debugging and provides retry/home navigation.
 *
 * Usage in layout.tsx:
 *   <body>
 *     <GlobalErrorBoundary>
 *       <AuthProvider>{children}</AuthProvider>
 *     </GlobalErrorBoundary>
 *   </body>
 */
export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<GlobalErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[GlobalErrorBoundary]", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#FAFBFC] px-[16px]">
          <div className="max-w-[480px] text-center">
            {/* Icon */}
            <div className="inline-flex items-center justify-center w-[72px] h-[72px] rounded-[18px] bg-[#EF4444]/10 mb-[24px]">
              <i className="ri-error-warning-line text-[32px] text-[#EF4444]" />
            </div>

            {/* Title */}
            <h1 className="font-display text-[26px] font-bold text-[#0A0F1C] mb-[8px]">
              Something went wrong
            </h1>

            {/* Error message */}
            <p className="text-[14px] text-gray-500 mb-[8px]">
              The application encountered an unexpected error.
            </p>

            {/* Error details (dev hint) */}
            {this.state.error?.message && (
              <div className="mb-[24px] p-[12px] bg-gray-50 rounded-[10px] border border-gray-100">
                <p className="text-[12px] font-mono text-gray-400 text-left break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-[10px] justify-center">
              <button
                onClick={this.handleRetry}
                className="h-[44px] px-[24px] rounded-[12px] bg-[#1B2A4A] text-white text-[14px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98]"
              >
                Try again
              </button>
              <button
                onClick={this.handleGoHome}
                className="h-[44px] px-[24px] rounded-[12px] border border-gray-200 text-[14px] font-semibold text-gray-600 transition-all hover:bg-gray-50 active:scale-[0.98]"
              >
                Go home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
