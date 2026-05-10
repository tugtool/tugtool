/**
 * `loadTugdiffWasm` — singleton lazy loader for the `tugdiff-wasm`
 * crate. Built on the generic `wasmInit` helper so this file declares
 * only the shape of the engine; the singleton-promise plumbing lives
 * in one place ([wasm-init.ts](./wasm-init.ts)).
 *
 * Per [D10] the diff engine is excluded from the boot bundle: a Tide
 * card that never renders a `<DiffBlock>` pays no cost for it.
 *
 * @module lib/lazy/load-tugdiff-wasm
 */

import type { DiffHunk } from "@/lib/diff/types";

import { wasmInit } from "./wasm-init";

export interface TugdiffEngine {
  /**
   * Parse a unified-diff string into structured hunks. Mirrors the
   * pure-JS `parseUnifiedDiffText`; the WASM version is faster on
   * large inputs.
   */
  parse_unified_diff(text: string): DiffHunk[];
  /**
   * Compute hunks between two text inputs using `imara-diff`'s
   * Histogram algorithm with line-level postprocessing.
   */
  two_text_diff(before: string, after: string): DiffHunk[];
}

const loader = wasmInit<TugdiffEngine, typeof import("../../../crates/tugdiff-wasm/pkg/tugdiff_wasm.js")>(
  () => import("../../../crates/tugdiff-wasm/pkg/tugdiff_wasm.js"),
  (mod) => ({
    parse_unified_diff: (text) => mod.parse_unified_diff(text) as DiffHunk[],
    two_text_diff: (before, after) =>
      mod.two_text_diff(before, after) as DiffHunk[],
  }),
);

export const loadTugdiffWasm = loader.load;
export const resetTugdiffWasmForTests = loader.reset;
export const injectTugdiffWasmForTests = loader.inject;
