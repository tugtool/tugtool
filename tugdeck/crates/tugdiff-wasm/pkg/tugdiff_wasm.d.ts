/* tslint:disable */
/* eslint-disable */

/**
 * Parse a unified-diff string into structured hunks.
 *
 * The input may include `---` / `+++` file headers; they are ignored. Parsing
 * starts at the first `@@` hunk header and continues until end of input.
 *
 * Lines beginning with `\` (e.g. `\ No newline at end of file`) are skipped.
 * Malformed hunk headers are skipped — recovery resumes at the next `@@`.
 */
export function parse_unified_diff(text: string): any;

/**
 * Compute the unified diff between two text inputs.
 *
 * Uses the Histogram algorithm with line-level postprocessing for human-readable
 * output. The result has the same shape as [`parse_unified_diff`].
 */
export function two_text_diff(before: string, after: string): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly parse_unified_diff: (a: number, b: number) => [number, number, number];
    readonly two_text_diff: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
