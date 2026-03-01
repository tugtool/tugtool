/**
 * ErrorBoundary — catches React render errors and displays them visually.
 *
 * Without this, a single component error silently kills the entire React tree,
 * leaving the user with a blank screen and no indication of what went wrong.
 */

import React from "react";

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
        <div
          style={{
            position: "fixed",
            inset: 0,
            padding: "24px",
            background: "#1a1a1a",
            color: "#ef4444",
            fontFamily: "monospace",
            fontSize: "13px",
            lineHeight: "1.5",
            overflow: "auto",
            zIndex: 99999,
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: "16px", color: "#fff" }}>
            Render Error
          </h2>
          <pre style={{ margin: "0 0 16px", whiteSpace: "pre-wrap" }}>
            {this.state.error.message}
          </pre>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              color: "#888",
              fontSize: "11px",
            }}
          >
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
