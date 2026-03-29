/**
 * ErrorBoundary — catches React render errors and displays them with TugBanner.
 *
 * Without this, a single component error silently kills the entire React tree,
 * leaving the user with a blank screen and no indication of what went wrong.
 *
 * Uses TugBanner (error variant) for consistent token-driven styling. The class
 * component must remain — React requires class components for getDerivedStateFromError.
 */

import React from "react";
import { TugBanner } from "@/components/tugways/tug-banner";
import { TugPushButton } from "@/components/tugways/tug-push-button";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <TugBanner
          variant="error"
          visible={true}
          tone="danger"
          message={this.state.error.message}
        >
          <pre style={{ margin: "0 0 16px", whiteSpace: "pre-wrap" }}>
            {this.state.error.stack}
          </pre>
          <TugPushButton
            emphasis="outlined"
            role="danger"
            onClick={() => window.location.reload()}
          >
            Reload
          </TugPushButton>
        </TugBanner>
      );
    }
    return this.props.children;
  }
}
