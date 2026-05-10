/**
 * `loadTugdiffWasm` — singleton lazy loader for the `tugdiff-wasm`
 * crate.
 *
 * Per [D10] the diff engine is excluded from the boot bundle: a Tide
 * card that never renders a `<DiffBlock>` pays no cost for it. This
 * module wraps the dynamic import + WASM init in a single promise so
 * concurrent calls share one fetch and one instantiation.
 *
 * Consumers only need:
 *
 *   const engine = await loadTugdiffWasm();
 *   const hunks = engine.two_text_diff(before, after);
 *
 * The first call kicks off the fetch; subsequent calls (from the same
 * card or any sibling) await the same in-flight promise.
 *
 * @module lib/lazy/load-tugdiff-wasm
 */

import type { DiffHunk } from "@/lib/diff/types";

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

let inflight: Promise<TugdiffEngine> | null = null;

/**
 * Resolve to the `tugdiff-wasm` engine, lazy-initializing on first
 * call. Errors during fetch / instantiation reject the promise; callers
 * should surface them to the user (the body kind catches rejection and
 * falls back to JS-only parsing for unified-diff input, or a plain
 * "diff unavailable" placeholder for two-text input).
 */
export function loadTugdiffWasm(): Promise<TugdiffEngine> {
  if (inflight === null) {
    inflight = (async () => {
      type WasmModule = {
        default: (arg?: unknown) => Promise<unknown>;
        parse_unified_diff(text: string): unknown;
        two_text_diff(before: string, after: string): unknown;
      };
      const mod = (await import(
        "../../../crates/tugdiff-wasm/pkg/tugdiff_wasm.js"
      )) as WasmModule;
      // wasm-pack's generated init resolves `tugdiff_wasm_bg.wasm` next
      // to its own JS module via `import.meta.url` when called with no
      // argument, which Vite rewrites correctly at build time.
      await mod.default();
      return {
        parse_unified_diff: (text) =>
          mod.parse_unified_diff(text) as DiffHunk[],
        two_text_diff: (before, after) =>
          mod.two_text_diff(before, after) as DiffHunk[],
      };
    })();
    // Reset on rejection so a future caller can retry (e.g. if the
    // first attempt failed because of a transient fetch error).
    inflight.catch(() => {
      inflight = null;
    });
  }
  return inflight;
}

/**
 * Test hook: clear the cached promise / engine. Use only from test
 * setup so each test starts with a fresh load state.
 */
export function resetTugdiffWasmForTests(): void {
  inflight = null;
}

/**
 * Test hook: pre-populate the loader with a stub engine so consumers
 * can run synchronously without the real WASM module. Resolves the
 * cached promise immediately on next `loadTugdiffWasm()` call.
 */
export function injectTugdiffWasmForTests(engine: TugdiffEngine): void {
  inflight = Promise.resolve(engine);
}
