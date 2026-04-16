/**
 * Gallery card rendering test for `<GalleryPromptEntry>`. Exercises the
 * underlying `TugPromptEntry` against a `MockTugConnection`-backed
 * `CodeSessionStore` and confirms the split-pane layout wraps the entry.
 *
 * Note: setup-rtl MUST be the first import.
 */
import "../../../../__tests__/setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import { GalleryPromptEntry } from "../gallery-prompt-entry";
import { ResponderChainProvider } from "../../responder-chain-provider";

afterEach(() => {
  cleanup();
});

describe("GalleryPromptEntry — gallery card", () => {
  it("renders the split pane and mounts TugPromptEntry in the bottom panel", () => {
    const { container } = render(
      <ResponderChainProvider>
        <GalleryPromptEntry />
      </ResponderChainProvider>,
    );

    // The card wrapper, the split pane, and the nested entry all land.
    expect(
      container.querySelector('[data-testid="gallery-prompt-entry"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-slot="tug-split-pane"]')).not.toBeNull();
    const entryRoot = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    );
    expect(entryRoot).not.toBeNull();
    // Mock store starts idle.
    expect(entryRoot!.getAttribute("data-phase")).toBe("idle");
    expect(entryRoot!.getAttribute("data-can-interrupt")).toBe("false");
  });
});
