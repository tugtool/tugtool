/**
 * GalleryListView tests — render-only smoke check.
 *
 * The gallery card is mock content that exercises `TugListView`'s
 * full primitive shape (data source, delegate, cell-renderer
 * dispatch, SmartScroll integration, streaming binding via the
 * shared `PropertyStore`). This test mounts the card without throwing
 * and confirms the documented `data-slot` shape is present plus the
 * header bar's mutator buttons. Visual review of streaming behavior,
 * insert/remove, and lifecycle logging is the manual checkpoint.
 *
 * WASM init mirrors the `TugMarkdownBlock` test pattern: `initSync`
 * once at module scope so the markdown-static / markdown-streaming
 * cells can lex through the helper.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import React from "react";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { initSync } from "../../crates/tugmark-wasm/pkg/tugmark_wasm.js";

import { GalleryListView } from "@/components/tugways/cards/gallery-list-view";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPath = join(__dir, "../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm");

beforeAll(() => {
  const wasmBytes = readFileSync(wasmPath);
  initSync({ module: wasmBytes });
});

afterEach(() => {
  cleanup();
});

describe("GalleryListView", () => {
  test("mounts without throwing and renders the documented list-view DOM shape", () => {
    const { container } = render(
      <ResponderChainProvider>
        <GalleryListView />
      </ResponderChainProvider>,
    );

    const root = container.querySelector('[data-testid="gallery-list-view"]');
    expect(root).not.toBeNull();

    // The list-view primitive is mounted with the documented data-slot
    // and tabIndex shape per [#dom-shape].
    const listView = root?.querySelector('[data-slot="tug-list-view"]');
    expect(listView).not.toBeNull();
    expect(listView?.getAttribute("tabindex")).toBe("0");
  });

  test("at least one rendered cell appears for the initial 50-item window", () => {
    const { container } = render(
      <ResponderChainProvider>
        <GalleryListView />
      </ResponderChainProvider>,
    );

    const cells = container.querySelectorAll(".tug-list-view-cell");
    expect(cells.length).toBeGreaterThan(0);
  });

  test("header bar exposes the four documented mutator buttons", () => {
    const { container } = render(
      <ResponderChainProvider>
        <GalleryListView />
      </ResponderChainProvider>,
    );

    const root = container.querySelector('[data-testid="gallery-list-view"]');
    const buttonLabels = Array.from(
      root?.querySelectorAll("button") ?? [],
    ).map((b) => b.textContent?.trim());
    expect(buttonLabels).toContain("Insert top");
    expect(buttonLabels).toContain("Insert bottom");
    expect(buttonLabels).toContain("Remove last");
    expect(buttonLabels).toContain("Reset");
  });
});
