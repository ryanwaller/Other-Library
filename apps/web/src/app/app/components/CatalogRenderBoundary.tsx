"use client";

import React from "react";

type Props = {
  children: React.ReactNode;
  libraryName: string;
};

type State = {
  hasError: boolean;
};

export default class CatalogRenderBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("catalog_render_failed", {
      libraryName: this.props.libraryName,
      error
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-muted" style={{ marginTop: "var(--space-md)" }}>
          Could not render some items in this catalog.
        </div>
      );
    }
    return this.props.children;
  }
}
