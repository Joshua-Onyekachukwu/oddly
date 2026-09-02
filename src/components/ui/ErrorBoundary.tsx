"use client";

import React, { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Reusable error boundary component for wrapping client-side components.
 * Catches JavaScript errors in child components and displays a fallback UI.
 *
 * @example
 * <ErrorBoundary>
 *   <MyComponent />
 * </ErrorBoundary>
 *
 * @example
 * <ErrorBoundary fallback={<CustomFallback />}>
 *   <MyComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-[300px] p-[24px]">
          <div className="text-center max-w-[400px]">
            <div className="inline-flex items-center justify-center w-[56px] h-[56px] rounded-[14px] bg-[#EF4444]/10 mb-[16px]">
              <i className="ri-error-warning-line text-[24px] text-[#EF4444]" />
            </div>
            <h3 className="font-display text-[16px] font-bold text-[#0A0F1C] mb-[6px]">
              Something went wrong
            </h3>
            <p className="text-[13px] text-gray-500 mb-[16px]">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <div className="flex gap-[8px] justify-center">
              <button
                onClick={this.handleRetry}
                className="h-[36px] px-[16px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98]"
              >
                Try again
              </button>
              <a
                href="/admin"
                className="h-[36px] px-[16px] rounded-[10px] border border-gray-200 text-[13px] font-semibold text-gray-600 transition-all hover:bg-gray-50 active:scale-[0.98] inline-flex items-center"
              >
                Back to admin
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
