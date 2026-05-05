"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Error boundary that catches DOM manipulation errors (e.g. from Windows touch keyboard
 * injecting/removing nodes that conflict with React's virtual DOM) and auto-recovers
 * instead of showing a crash screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State | null {
    // Only catch DOM manipulation errors (touch keyboard, browser extensions)
    if (
      error.message?.includes("removeChild") ||
      error.message?.includes("insertBefore") ||
      error.message?.includes("not a child")
    ) {
      return { hasError: true };
    }
    // Let other errors propagate to the default error page
    throw error;
  }

  componentDidCatch(error: Error) {
    console.warn("[ErrorBoundary] Caught DOM error, auto-recovering:", error.message);
  }

  componentDidUpdate(_: Props, prevState: State) {
    if (this.state.hasError && !prevState.hasError) {
      // Auto-recover after a brief delay
      setTimeout(() => this.setState({ hasError: false }), 100);
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.children;
    }
    return this.props.children;
  }
}
