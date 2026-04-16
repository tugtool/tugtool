/**
 * Gallery card rendering tests for `<GalleryPromptEntry>` (pristine) and
 * `<GalleryPromptEntrySandbox>` (interactive). Both exercise the same
 * underlying `TugPromptEntry` against a `MockTugConnection`-backed
 * `CodeSessionStore`; the sandbox test additionally clicks one of the
 * synthetic-frame buttons and verifies a phase transition reaches the
 * store's snapshot.
 *
 * Note: setup-rtl MUST be the first import.
 */
import "../../../../__tests__/setup-rtl";

import React from "react";
import { act } from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";

import { GalleryPromptEntry } from "../gallery-prompt-entry";
import { GalleryPromptEntrySandbox } from "../gallery-prompt-entry-sandbox";
import { ResponderChainProvider } from "../../responder-chain-provider";

afterEach(() => {
  cleanup();
});

describe("GalleryPromptEntry — pristine card", () => {
  it("renders without throwing and mounts a TugPromptEntry via buildMockServices", () => {
    const { container } = render(
      <ResponderChainProvider>
        <GalleryPromptEntry />
      </ResponderChainProvider>,
    );

    // The card wrapper and the nested entry both land.
    expect(
      container.querySelector('[data-testid="gallery-prompt-entry"]'),
    ).not.toBeNull();
    const entryRoot = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    );
    expect(entryRoot).not.toBeNull();
    // Mock store starts idle — this is the pristine card's whole point.
    expect(entryRoot!.getAttribute("data-phase")).toBe("idle");
    expect(entryRoot!.getAttribute("data-can-interrupt")).toBe("false");
  });
});

describe("GalleryPromptEntrySandbox — interactive driver card", () => {
  it("renders the driver buttons and drives a phase transition when turn_complete success is clicked", () => {
    const { container, getByTestId } = render(
      <ResponderChainProvider>
        <GalleryPromptEntrySandbox />
      </ResponderChainProvider>,
    );

    // Driver panel is present with the full button grid.
    expect(
      container.querySelector('[data-testid="gallery-prompt-entry-sandbox"]'),
    ).not.toBeNull();
    expect(getByTestId("sandbox-btn-session_init")).toBeDefined();
    expect(getByTestId("sandbox-btn-assistant_text partial")).toBeDefined();
    expect(getByTestId("sandbox-btn-turn_complete success")).toBeDefined();
    expect(getByTestId("sandbox-btn-control approval")).toBeDefined();
    expect(getByTestId("sandbox-btn-session_state errored")).toBeDefined();

    // Drive the store through an observable phase transition. The
    // `session_state errored` frame is handled regardless of prior
    // state (the reducer drops into `errored` from any phase), so
    // this tests the round-trip from button click to
    // `data-phase="errored"` on the entry root without needing to
    // first simulate a user-initiated send to start a turn.
    const entryRoot = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    );
    expect(entryRoot).not.toBeNull();
    expect(entryRoot!.getAttribute("data-phase")).toBe("idle");
    expect(entryRoot!.hasAttribute("data-errored")).toBe(false);

    act(() => {
      fireEvent.click(getByTestId("sandbox-btn-session_state errored"));
    });

    expect(entryRoot!.getAttribute("data-phase")).toBe("errored");
    expect(entryRoot!.hasAttribute("data-errored")).toBe(true);
  });
});
