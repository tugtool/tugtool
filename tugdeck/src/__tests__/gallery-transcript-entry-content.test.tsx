/**
 * GalleryTranscriptEntry tests — render-only smoke check.
 *
 * The gallery card is purely visual mock content that exercises
 * TugTranscriptEntry's slot model. This test asserts the card mounts
 * without throwing and that all four participant rows are present in
 * the DOM. Visual review is the manual checkpoint.
 *
 * The `code` row's body embeds a TugMarkdownView, which calls into the
 * tugmark-wasm bindings on mount. happy-dom does not auto-load the WASM
 * module the way Vite's `?url` loader does in main.tsx, so the test
 * initializes the module synchronously from disk in beforeAll — mirroring
 * the pattern used by the existing tugmark-wasm logic tests.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { initSync } from "../../crates/tugmark-wasm/pkg/tugmark_wasm.js";
import { GalleryTranscriptEntry } from "@/components/tugways/cards/gallery-transcript-entry";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

const WASM_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm",
);

beforeAll(() => {
  initSync({ module: readFileSync(WASM_PATH) });
});

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
