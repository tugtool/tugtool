/**
 * GalleryTranscriptEntry tests — render-only smoke check.
 *
 * The gallery card is purely visual mock content that exercises
 * TugTranscriptEntry's slot model. This test asserts the card mounts
 * without throwing and that all four participant rows are present in
 * the DOM. Visual review is the manual checkpoint.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { GalleryTranscriptEntry } from "@/components/tugways/cards/gallery-transcript-entry";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

afterEach(() => {
  cleanup();
});

describe("GalleryTranscriptEntry", () => {
  test("mounts without throwing and renders one row per participant", () => {
    const { container } = render(
      <ResponderChainProvider>
        <GalleryTranscriptEntry />
      </ResponderChainProvider>,
    );

    const root = container.querySelector(
      '[data-testid="gallery-transcript-entry"]',
    );
    expect(root).not.toBeNull();

    const entries = root?.querySelectorAll(
      '[data-slot="tug-transcript-entry"]',
    );
    expect(entries?.length).toBe(4);

    const participants = Array.from(entries ?? []).map((el) =>
      el.getAttribute("data-participant"),
    );
    expect(participants).toEqual(["user", "code", "shell", "command"]);
  });
});
